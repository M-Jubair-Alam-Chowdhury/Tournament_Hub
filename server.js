const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer } = require("ws");
const logic = require("./logic.js");
const season = require("./season.js");

const PORT = process.env.PORT || 3000;

/* ============================================================
   ADMIN AUTHENTICATION (v1.3)

   The repo is public, so the tokens are NOT in the source. They
   come from the ADMIN_TOKENS environment variable (comma-
   separated — one per admin, e.g. you and your partner):

     ADMIN_TOKENS="one long random string,another long random string"

   Hardening, in the order it matters:
   1. Tokens never appear in code, defaults, logs, or error
      messages. The server only ever holds SHA-256 digests of
      them, so even a memory dump of the process shows hashes.
   2. Submission is compared with crypto.timingSafeEqual on the
      digests — constant time, and length-independent because
      the digest is always 32 bytes. Every configured token is
      checked (no early exit, so timing can't reveal WHICH
      token matched).
   3. Per-IP rate limiting: MAX_FAILURES wrong tokens inside
      WINDOW_MS locks that IP out for LOCK_MS. Tunable via env
      for tests and stricter deployments.
   4. Submitted tokens are length-capped (no memory abuse), and
      failures get a generic message — no way to tell "no such
      token" from "wrong token".
   5. The browser keeps the token in sessionStorage (dies with
      the tab) — never localStorage, never a cookie, never in
      the URL.
   6. Everything travels over WebSocket, which is TLS-encrypted
      whenever the app is served over HTTPS (as on Render).

   No token configured = open mode: the first person to connect
   runs the show, exactly like v1.x (for local/casual use). The
   admin banner says so, and the README says how to lock it down.
   ============================================================ */

const ADMIN_TOKENS = String(process.env.ADMIN_TOKENS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const AUTH_MODE = ADMIN_TOKENS.length > 0;
const TOKEN_DIGESTS = ADMIN_TOKENS.map(t =>
  crypto.createHash("sha256").update(t, "utf8").digest());

if (AUTH_MODE) {
  ADMIN_TOKENS.forEach((t, i) => {
    if (t.length < 8) console.warn(
      "warning: ADMIN_TOKENS entry " + (i + 1) + " is shorter than 8 characters — use a long random string.");
  });
}

const MAX_FAILURES = parseInt(process.env.AUTH_FAIL_MAX || "5", 10) || 5;
const WINDOW_MS = parseInt(process.env.AUTH_WINDOW_MS || "900000", 10) || 900000;   // 15 min
const LOCK_MS = parseInt(process.env.AUTH_LOCK_MS || "900000", 10) || 900000;       // 15 min
const authFails = new Map(); // ip -> {count, windowStart, lockedUntil}

function ipOf(req) {
  const xf = req && req.headers && req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return (req && req.socket && req.socket.remoteAddress) || "unknown";
}

function pruneAuthFails(now) {
  for (const [ip, e] of authFails) {
    if (now > e.windowStart + WINDOW_MS && now > (e.lockedUntil || 0)) authFails.delete(ip);
  }
}

function authCheck(ip) {
  const now = Date.now();
  pruneAuthFails(now);
  const e = authFails.get(ip);
  if (e && e.lockedUntil && now < e.lockedUntil) {
    return { allowed: false, locked: true, retryAfterSec: Math.ceil((e.lockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

// Records a failure; returns what to tell the client.
function noteAuthFailure(ip) {
  const now = Date.now();
  let e = authFails.get(ip);
  if (!e || now > e.windowStart + WINDOW_MS) e = { count: 0, windowStart: now };
  e.count++;
  let lockedForSec = 0;
  if (e.count >= MAX_FAILURES) {
    e.lockedUntil = now + LOCK_MS;
    lockedForSec = Math.ceil(LOCK_MS / 1000);
  }
  authFails.set(ip, e);
  return { lockedForSec, attemptsLeft: Math.max(0, MAX_FAILURES - e.count) };
}

function noteAuthSuccess(ip) { authFails.delete(ip); }

function tokenMatches(submitted) {
  if (typeof submitted !== "string" || submitted.length === 0 || submitted.length > 512) return false;
  const digest = crypto.createHash("sha256").update(submitted, "utf8").digest();
  let match = false;
  for (const d of TOKEN_DIGESTS) match = crypto.timingSafeEqual(digest, d) || match;
  return match;
}

/* ============================================================
   APP + ROLES
   ============================================================ */

const app = express();
app.use(express.static(path.join(__dirname, "public")));

// season archive on disk — survives restarts; export/import covers
// hosts with ephemeral disks (see README)
app.get("/api/season", (req, res) => {
  res.json(season.getPublicView());
});

const server = app.listen(PORT, () => {
  console.log(`Table Tennis Live listening on port ${PORT}` + (AUTH_MODE ? " (token auth on)" : " (open mode)"));
});

const wss = new WebSocketServer({ server });

// role bookkeeping — one shared game per server process.
// In auth mode everyone connects as a viewer; admins are the
// sockets that authenticated with a valid token (any number of
// them, concurrently). In open mode the first socket is the
// admin, like it's always been.
const clients = new Map(); // ws -> { role: 'admin' | 'guest', ip }

function adminCount() {
  let n = 0;
  for (const info of clients.values()) if (info.role === "admin") n++;
  return n;
}
function hasAdmin() { return adminCount() > 0; }
function guestCount() {
  let n = 0;
  for (const info of clients.values()) if (info.role === "guest") n++;
  return n;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastState() {
  const msg = JSON.stringify({
    type: "state",
    state: logic.getStateForWire(),
    season: season.getPublicView(),
    guestCount: guestCount(),
    hasAdmin: hasAdmin(),
    authRequired: AUTH_MODE
  });
  for (const client of clients.keys()) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

/* ---- tournament persistence (v1.3 resume) ---------------------
   The live state is auto-saved after every admin action. A cold
   boot with a saved (incomplete or complete) tournament restores
   it SUSPENDED: viewers can look around, an admin must click
   Resume (or start fresh). draftScore isn't persisted — it fires
   per keystroke and carries no match results. */
const recordedIds = new Set();

function persistTournament() {
  const S = logic.getState();
  if (S.step === "roster") { season.clearTournamentState(); return; }
  try { season.saveTournamentState(logic.saveStateSnapshot()); }
  catch (err) { console.error("tournament state save failed:", err.message); }
}

function restoreOnBoot() {
  const saved = season.loadTournamentState();
  if (!saved) return;
  const res = logic.loadStateSnapshot(saved);
  const S = logic.getState();
  if (!res.ok || S.step === "roster") {
    // nothing usable (or a pristine roster) — start clean
    logic.reset();
    season.clearTournamentState();
    return;
  }
  logic.setSuspended(true, saved.savedAt);
  console.log("restored a saved tournament (suspended, awaiting resume)");
}

// guard against re-recording tournaments that are already in the
// season file (matters after a restart on a mid-standings state)
for (const t of season.getPublicView().tournaments) recordedIds.add(t.id);

restoreOnBoot();

/* ---- season bookkeeping ---------------------------------------
   A finished tournament (champion crowned) is archived exactly once
   (S.seed is unique per tournament). In open mode, resetting or
   abandoning mid-play records it with status "abandoned": kept in
   history, never counted toward ratings. In auth mode the state
   survives admin departures, so an abandon record only happens on
   an explicit reset — everything else is resumable. */
function hasPlayedMatches(S) {
  return !!(S.schedule && S.schedule.rounds &&
    S.schedule.rounds.some(r => r && r.some(m => m && m.played && m.a && m.b && m.a !== "BYE" && m.b !== "BYE")));
}

function maybeRecordCompleted() {
  const S = logic.getState();
  if (S.step === "standings" && S.champion && S.schedule && !recordedIds.has(S.seed)) {
    recordedIds.add(S.seed);
    try { season.recordTournament(logic.getTournamentRecord(), "complete"); }
    catch (err) { console.error("season record failed:", err.message); }
  }
}

function maybeRecordAbandoned() {
  const S = logic.getState();
  if (recordedIds.has(S.seed)) return;
  if (!S.schedule || !S.step) return;
  if (["roster", "mode", "pairing", "teamsFormed", "toomany"].includes(S.step)) return;
  if (!hasPlayedMatches(S)) return; // never started scoring — nothing worth keeping
  try {
    recordedIds.add(S.seed);
    season.recordTournament(logic.getTournamentRecord(), "abandoned");
  } catch (err) { console.error("season record (abandoned) failed:", err.message); }
}

// Actions a client is allowed to trigger, and how their payload maps
// onto the logic module's function arguments.
const ACTIONS = {
  reset: () => { maybeRecordAbandoned(); logic.reset(); logic.setSuspended(false); season.clearTournamentState(); },
  submitRoster: (p) => logic.submitRoster(p && p.raw, p && p.name),
  pickMode: (p) => logic.pickMode(p && p.mode),
  addForbidden: (p) => logic.addForbidden(p && p.x, p && p.y),
  removeForbidden: (p) => logic.removeForbidden(p && p.index),
  formTeams: () => logic.formTeams(),
  goToPairing: () => logic.goToPairing(),
  confirmTeamsAndDraw: () => logic.confirmTeamsAndDraw(),
  draftScore: (p) => logic.draftScore(p.mi, p.which, p.value),
  saveScore: (p) => logic.saveScore(p.mi, p.sa, p.sb),
  continueTournament: () => logic.continueTournament(),
  pickStage: (p) => logic.pickStage(p && {
    format: p.format, advance: p.advance, poolCount: p.poolCount, poolQualify: p.poolQualify,
    qmode: p.qmode, picks: p.picks, seedMode: p.seedMode, seedOrder: p.seedOrder, splitMode: p.splitMode
  }, { ratings: season.getRatings() }),
  undoScore: () => logic.undoScore(),
  seasonStar: (p) => season.toggleStar(p && p.name),
  seasonImport: (p) => season.importJSON(p && p.text),
  seasonNew: (p) => season.newSeason(p && p.name),
  resumeTournament: () => {
    if (!logic.isSuspended()) throw new Error("Nothing is paused right now.");
    logic.setSuspended(false);
  },
  stateImport: (p) => {
    let snap;
    try { snap = JSON.parse(String(p && p.text)); }
    catch (_) { throw new Error("That file isn't valid JSON."); }
    const res = logic.loadStateSnapshot(snap);
    if (!res.ok) throw new Error(res.reason);
    // if this tournament was already archived, don't re-record it
    if (recordedIds.has(logic.getState().seed)) { /* already known */ }
    else {
      const known = season.getPublicView().tournaments.some(t => t.id === logic.getState().seed);
      if (known) recordedIds.add(logic.getState().seed);
    }
  }
};

// While a restored tournament is suspended, only these actions are
// allowed: resume it, start fresh, or manage season/state files.
const ALLOWED_WHEN_SUSPENDED = new Set([
  "resumeTournament", "reset",
  "seasonStar", "seasonImport", "seasonNew", "stateImport"
]);

wss.on("connection", (ws, req) => {
  let role;
  if (!AUTH_MODE && !hasAdmin()) {
    role = "admin"; // open mode: first one in runs the show (v1.x)
  } else {
    role = "guest";
  }
  const ip = ipOf(req);
  clients.set(ws, { role, ip });

  send(ws, {
    type: "welcome",
    role,
    state: logic.getStateForWire(),
    season: season.getPublicView(),
    // full archive once per admin connection — the browser keeps a
    // local mirror so a wiped host (ephemeral disk) can be restored
    fullSeason: role === "admin" ? season.getFullJSON() : undefined,
    guestCount: guestCount(),
    hasAdmin: hasAdmin(),
    authRequired: AUTH_MODE
  });
  // let everyone else know the head count changed
  broadcastState();

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const info = clients.get(ws);
    if (!info) return;

    // --- login: the one message a viewer is allowed to send -------
    if (msg.type === "auth") {
      const gate = authCheck(info.ip);
      if (!gate.allowed) {
        send(ws, {
          type: "authFail",
          message: "Too many wrong attempts from your network — try again in " +
            Math.ceil(gate.retryAfterSec / 60) + " minute" + (gate.retryAfterSec > 60 ? "s" : "") + "."
        });
        return;
      }
      if (info.role === "admin") { send(ws, { type: "authOk", already: true }); return; }
      if (tokenMatches(msg.payload && msg.payload.token)) {
        noteAuthSuccess(info.ip);
        info.role = "admin";
        send(ws, { type: "authOk" });
        broadcastState();
      } else {
        const r = noteAuthFailure(info.ip);
        send(ws, {
          type: "authFail",
          message: r.lockedForSec
            ? "That token isn't right — and there were too many attempts. Locked for " +
              Math.ceil(r.lockedForSec / 60) + " minute" + (r.lockedForSec > 60 ? "s" : "") + "."
            : "That token isn't right." + (r.attemptsLeft > 0 ? " " + r.attemptsLeft +
              " attempt" + (r.attemptsLeft > 1 ? "s" : "") + " left before a short lock." : "")
        });
      }
      return;
    }

    // --- full-archive downloads are requests, not state changes ---
    if (msg.type === "seasonFull" || msg.type === "stateFull") {
      if (info.role !== "admin") {
        send(ws, { type: "error", message: "Only the admin can make changes." });
        return;
      }
      send(ws, msg.type === "seasonFull"
        ? { type: "seasonFull", text: season.getFullJSON() }
        : { type: "stateFull", text: JSON.stringify(logic.saveStateSnapshot()) });
      return;
    }

    // --- logout: an admin steps down to viewer --------------------
    if (msg.type === "logout") {
      if (info.role === "admin" && AUTH_MODE) {
        info.role = "guest";
        broadcastState();
      }
      return;
    }

    if (info.role !== "admin") {
      send(ws, { type: "error", message: "Only the admin can make changes." });
      return;
    }

    // --- a paused tournament accepts only conscious choices -------
    if (logic.isSuspended() && !ALLOWED_WHEN_SUSPENDED.has(msg.type)) {
      send(ws, { type: "error", message: "This tournament is paused — resume it (or start fresh) first." });
      return;
    }

    const handler = ACTIONS[msg.type];
    if (!handler) {
      send(ws, { type: "error", message: "Unknown action: " + msg.type });
      return;
    }
    try {
      handler(msg.payload || {});
      maybeRecordCompleted();
      if (msg.type !== "draftScore") persistTournament();
      broadcastState();
    } catch (err) {
      send(ws, { type: "error", message: err.message || "Something went wrong." });
    }
  });

  ws.on("close", () => {
    const info = clients.get(ws);
    const wasAdmin = !!(info && info.role === "admin");
    clients.delete(ws);

    if (AUTH_MODE) {
      // The tournament freezes for the viewers and waits: state is
      // already persisted, so any admin who signs back in (or the
      // next server boot) picks it up exactly where it stopped.
      broadcastState();
      return;
    }

    if (wasAdmin) {
      // Open mode keeps the classic v1.x behaviour: the room closes
      // for everyone, the unfinished tournament is archived as
      // abandoned, and the resume file is cleared.
      maybeRecordAbandoned();
      season.clearTournamentState();
      const endMsg = JSON.stringify({ type: "sessionEnded" });
      for (const client of clients.keys()) {
        if (client.readyState === client.OPEN) client.send(endMsg);
        client.close();
      }
      clients.clear();
      logic.reset();
      logic.setSuspended(false);
    } else {
      broadcastState();
    }
  });
});
