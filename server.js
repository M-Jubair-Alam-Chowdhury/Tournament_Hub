const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");
const logic = require("./logic.js");
const season = require("./season.js");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, "public")));

// season archive on disk — survives restarts; export/import covers
// hosts with ephemeral disks (see README)
app.get("/api/season", (req, res) => {
  res.json(season.getPublicView());
});

const server = app.listen(PORT, () => {
  console.log(`Table Tennis Live listening on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

// role bookkeeping — one shared game per server process
let adminSocket = null;
const clients = new Map(); // ws -> { role: 'admin' | 'guest' }

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
    hasAdmin: !!adminSocket
  });
  for (const client of clients.keys()) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

/* ---- season bookkeeping --------------------------------------
   A finished tournament (champion crowned) is archived exactly once
   (S.seed is unique per tournament). Resetting or abandoning mid-
   play records it with status "abandoned": kept in history, never
   counted toward ratings. */
const recordedIds = new Set();

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
  reset: () => { maybeRecordAbandoned(); logic.reset(); },
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
  seasonNew: (p) => season.newSeason(p && p.name)
};

wss.on("connection", (ws) => {
  let role;
  if (!adminSocket) {
    adminSocket = ws;
    role = "admin";
  } else {
    role = "guest";
  }
  clients.set(ws, { role });

  send(ws, {
    type: "welcome",
    role,
    state: logic.getStateForWire(),
    season: season.getPublicView(),
    // full archive once per admin connection — the browser keeps a
    // local mirror so a wiped host (ephemeral disk) can be restored
    fullSeason: role === "admin" ? season.getFullJSON() : undefined,
    guestCount: guestCount(),
    hasAdmin: !!adminSocket
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
    if (!info || info.role !== "admin") {
      send(ws, { type: "error", message: "Only the admin can make changes." });
      return;
    }
    // full-archive download is a request, not a state change
    if (msg.type === "seasonFull") {
      send(ws, { type: "seasonFull", text: season.getFullJSON() });
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
      broadcastState();
    } catch (err) {
      send(ws, { type: "error", message: err.message || "Something went wrong." });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    if (ws === adminSocket) {
      // Admin left — the fun's over for everyone else too.
      maybeRecordAbandoned();
      const endMsg = JSON.stringify({ type: "sessionEnded" });
      for (const client of clients.keys()) {
        if (client.readyState === client.OPEN) client.send(endMsg);
        client.close();
      }
      clients.clear();
      adminSocket = null;
      logic.reset();
    } else {
      broadcastState();
    }
  });
});
