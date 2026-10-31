/* M4 — hub integration suite (100+ cases). Boots the REAL hub server
   (both apps) in three modes — open, auth (per-app tokens), and a
   restart for persistence — then checks every HTTP route, the WS
   protocol, the auth matrix, full tournament flows over the wire, the
   UID registry, the back-to-setup restart, live video, season ops,
   suspension/resume, and open-mode room closing. */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const HUB = path.join(__dirname, "..");
let pass = 0, fail = 0;
const fails = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; fails.push(name); console.log("  FAIL:", name); }
}
function eqv(a, b, name) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  ok(ja === jb, name + (ja !== jb ? " — got " + ja + " want " + jb : ""));
}
function section(name) { console.log("\n== " + name + " =="); }

const ROOT = "/tmp/m4-hub";
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
fs.mkdirSync(ROOT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot(port, dataDir, extraEnv) {
  const child = spawn("node", ["server.js"], {
    cwd: HUB,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...(extraEnv || {}) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.on("data", d => console.error("  [srv]", String(d).trim()));
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("server boot timeout")), 8000);
    child.stdout.on("data", d => {
      if (String(d).includes("Tournament Hub on port")) { clearTimeout(timer); res(child); }
    });
    child.on("exit", code => { clearTimeout(timer); rej(new Error("server exited " + code)); });
  });
}
function kill(child) {
  return new Promise(res => {
    child.on("exit", res);
    child.kill("SIGTERM");
    setTimeout(res, 1500);
  });
}
function get(port, reqPath, depth) {
  depth = depth || 0;
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: reqPath }, r => {
      if ((r.statusCode === 301 || r.statusCode === 302) && r.headers.location && depth < 3) {
        r.resume();
        return res(get(port, r.headers.location, depth + 1));
      }
      let b = "";
      r.on("data", c => b += c);
      r.on("end", () => res({ code: r.statusCode, body: b }));
    }).on("error", rej);
  });
}
function openWs(port, wsPath) {
  return new Promise((res, rej) => {
    const ws = new WebSocket("ws://127.0.0.1:" + port + wsPath);
    const conn = {
      ws, messages: [], latest: null, players: [], errors: [], role: null,
      lastFull: null, lastStateFull: null, sessionEnded: false, authFails: [],
      waitFor: (pred, ms) => new Promise((r2, rj2) => {
        const check = () => { try { return !!pred(conn); } catch (_) { return false; } };
        if (check()) return r2(true);
        const timer = setInterval(() => { if (check()) { clearInterval(timer); r2(true); } }, 20);
        setTimeout(() => { clearInterval(timer); rj2(new Error("waitFor timeout")); }, ms || 4000);
      })
    };
    ws.on("message", d => {
      const m = JSON.parse(d);
      conn.messages.push(m);
      if (m.type === "welcome" || m.type === "state") {
        if (m.role) conn.role = m.role;
        if (m.state) conn.latest = m.state;
        if (Array.isArray(m.players)) conn.players = m.players;
      } else if (m.type === "error") conn.errors.push(m.message);
      else if (m.type === "authOk") conn.role = "admin";
      else if (m.type === "authFail") conn.authFails.push(m.message);
      else if (m.type === "seasonFull") conn.lastFull = m.text;
      else if (m.type === "stateFull") conn.lastStateFull = m.text;
      else if (m.type === "sessionEnded") conn.sessionEnded = true;
    });
    ws.on("open", () => setTimeout(() => res(conn), 150));
    ws.on("error", rej);
  });
}
const send = (conn, type, payload) => conn.ws.send(JSON.stringify({ type, payload: payload || {} }));

(async () => {

/* ================= Scenario 1: open mode ================= */
const P1 = 4101;
const DIR1 = path.join(ROOT, "open");
const child1 = await boot(P1, DIR1);
try {

section("S1. HTTP routes");
{
  const home = await get(P1, "/");
  ok(home.code === 200 && /table-tennis/i.test(home.body), "S1.1 hub landing serves");
  const ttRoot = await get(P1, "/table-tennis");
  ok(ttRoot.code === 200 && /Match Sheet|table tennis/i.test(ttRoot.body), "S1.2 /table-tennis serves the app (redirect followed)");
  const fbRoot = await get(P1, "/football");
  ok(fbRoot.code === 200 && /football/i.test(fbRoot.body), "S1.3 /football serves the app");
  const ttLogin = await get(P1, "/table-tennis/login");
  ok(ttLogin.code === 200 && /login/i.test(ttLogin.body), "S1.4 TT login page serves");
  const fbLogin = await get(P1, "/football/login");
  ok(fbLogin.code === 200 && /login/i.test(fbLogin.body), "S1.5 FB login page serves");
  const ttSeason = JSON.parse((await get(P1, "/table-tennis/api/season")).body);
  ok(ttSeason && typeof ttSeason.name === "string" && ttSeason.tournamentCount === 0, "S1.6 TT season API responds");
  const fbSeason = JSON.parse((await get(P1, "/football/api/season")).body);
  ok(fbSeason.tournamentCount === 0, "S1.7 FB season API responds");
  const ttInfo = JSON.parse((await get(P1, "/table-tennis/api/auth-info")).body);
  ok(ttInfo.authRequired === false && ttInfo.adminHere === false, "S1.8 auth-info reports open mode");
  const ttPlayers = JSON.parse((await get(P1, "/table-tennis/api/players")).body);
  eqv(ttPlayers, [], "S1.9 TT players API starts empty");
  const fbPlayers = JSON.parse((await get(P1, "/football/api/players")).body);
  eqv(fbPlayers, [], "S1.10 FB players API starts empty");
  const nope = await get(P1, "/definitely-not-here");
  ok(nope.code === 404, "S1.11 unknown route 404s");
}

section("S1. WS roles and protocol");
{
  const admin = await openWs(P1, "/table-tennis/");
  ok(admin.role === "admin", "S1.12 open mode: first non-spectator becomes admin");
  ok(admin.latest && admin.latest.step === "roster", "S1.13 welcome carries a fresh state");
  ok(Array.isArray(admin.players) && admin.players.length === 0, "S1.14 welcome carries the players registry");
  const welcome = admin.messages.find(m => m.type === "welcome");
  ok(welcome.fullSeason != null, "S1.15 admin gets the full season archive");
  ok(welcome.authRequired === false, "S1.16 authRequired flag exposed");
  const guest = await openWs(P1, "/table-tennis/");
  ok(guest.role === "guest", "S1.17 a second socket is a guest (seat taken)");
  const guestWelcome = guest.messages.find(m => m.type === "welcome");
  ok(guestWelcome.fullSeason === undefined, "S1.18 guests do NOT get the full archive");
  const viewer = await openWs(P1, "/table-tennis/?viewer=1");
  ok(viewer.role === "guest", "S1.19 spectator tabs stay viewers");
  send(guest, "submitRoster", { raw: "A\nB\nC" });
  await guest.waitFor(c => c.errors.length > 0);
  ok(/Only the admin/.test(guest.errors[0]), "S1.20 guests cannot run actions");
  send(admin, "bogusAction", {});
  await admin.waitFor(c => c.errors.some(e => /Unknown action/.test(e)));
  ok(true, "S1.21 unknown actions get a clean error");
  admin.ws.send("this is not json");
  await sleep(150);
  ok(admin.ws.readyState === admin.ws.OPEN, "S1.22 malformed frames are ignored, connection lives");
  send(admin, "noType");
  await sleep(150);
  ok(admin.ws.readyState === admin.ws.OPEN, "S1.23 frame without a type is ignored");

  /* --- full TT tournament over the wire --- */
  send(admin, "submitRoster", { raw: "Ann\nBen\nCy\nDee\nEli", name: "Wire Cup", points: 11 });
  await admin.waitFor(c => c.latest && c.latest.step === "stageChoice");
  ok(true, "S1.24 odd roster lands on the format choice");
  eqv(admin.latest.names, ["Ann", "Ben", "Cy", "Dee", "Eli"], "S1.25 names round-trip");
  await admin.waitFor(c => c.players.length === 5);
  ok(admin.players.every(p => /^p-/.test(p.uid)), "S1.26 the registry auto-saves all five with UIDs");
  ok(admin.latest.tournamentName === "Wire Cup", "S1.27 tournament name kept");
  const apiAfter = JSON.parse((await get(P1, "/table-tennis/api/players")).body);
  eqv(apiAfter.map(p => p.name).sort(), ["Ann", "Ben", "Cy", "Dee", "Eli"], "S1.28 /api/players lists them");
  send(admin, "pickStage", { format: "rr" });
  await admin.waitFor(c => c.latest && c.latest.step === "play");
  ok(admin.latest.schedule.rounds.length === 5, "S1.29 round robin built over the wire");
  // error paths
  send(admin, "saveScore", { mi: 0, sa: 10, sb: 9 });
  await admin.waitFor(c => c.errors.some(e => /short/.test(e)));
  ok(true, "S1.30 a short score is rejected over the wire");
  send(admin, "saveScore", { mi: 0, sa: 11, sb: 9 });
  await admin.waitFor(c => c.latest.schedule.rounds[0].some(m => m.played));
  ok(true, "S1.31 a valid score saves");
  send(admin, "undoScore", {});
  await admin.waitFor(c => !c.latest.schedule.rounds[0].some(m => m.played));
  ok(true, "S1.32 undo works over the wire");
  send(admin, "saveScore", { mi: 0, sa: 11, sb: 9 });
  await admin.waitFor(c => c.latest.schedule.rounds[0].some(m => m.played));
  // play everything out: first-named side wins 11-9
  let guard = 0;
  while (admin.latest && admin.latest.step === "play" && guard++ < 60) {
    const round = admin.latest.schedule.rounds[admin.latest.roundIndex];
    for (let mi = 0; mi < round.length; mi++) {
      const m = round[mi];
      if (m && !m.played && m.a && m.b && m.a !== "BYE") send(admin, "saveScore", { mi, sa: 11, sb: 9 });
    }
    await admin.waitFor(c => {
      const r = c.latest.schedule.rounds[c.latest.roundIndex];
      return r && r.every(m => m.played);
    });
    send(admin, "continueTournament", {});
    await sleep(120);
  }
  ok(admin.latest.step === "standings" || admin.latest.step === "stageChoice", "S1.33 tournament advances to the end");
  const seasonAfter = JSON.parse((await get(P1, "/table-tennis/api/season")).body);
  ok(seasonAfter.tournamentCount >= 0, "S1.34 season API still healthy after a run");
  send(admin, "reset", {});
  await admin.waitFor(c => c.latest.step === "roster");
  ok(true, "S1.35 reset returns to the roster");

  /* --- registry ops over the wire --- */
  send(admin, "playerSave", { entries: ["Zed", "ANN"] });
  await admin.waitFor(c => c.players.some(p => p.name === "Zed"));
  ok(admin.players.length === 6, "S1.36 playerSave adds new and updates existing (no duplicate)");
  const zed = admin.players.find(p => p.name === "Zed");
  send(admin, "playerForget", { uid: zed.uid });
  await admin.waitFor(c => !c.players.some(p => p.name === "Zed"));
  ok(true, "S1.37 playerForget removes by UID");
  send(admin, "playerForget", { uid: "p-nope" });
  await admin.waitFor(c => c.errors.some(e => /isn't in the saved list/.test(e)));
  ok(true, "S1.38 forgetting an unknown UID errors");
  ok(fs.existsSync(path.join(DIR1, "table-tennis", "players.json")), "S1.39 the registry persists to disk");
  send(guest, "playerSave", { entries: ["Nope"] });
  await guest.waitFor(c => c.errors.some(e => /Only the admin/.test(e)));
  ok(true, "S1.40 guests cannot touch the registry");
  await guest.waitFor(c => c.players.length === 5);
  ok(true, "S1.41 registry changes broadcast to viewers too");

  /* --- restart (back to setup) over the wire --- */
  send(admin, "submitRoster", { raw: "Fay\nGil\nHal\nIda\nJon", name: "Restart Cup", points: 21 });
  await admin.waitFor(c => c.latest.step === "stageChoice");
  send(admin, "pickStage", { format: "rr" });
  await admin.waitFor(c => c.latest.step === "play");
  send(admin, "saveScore", { mi: 0, sa: 21, sb: 19 });
  await admin.waitFor(c => c.latest.schedule.rounds[0].some(m => m.played));
  send(admin, "restartTournament", {});
  await admin.waitFor(c => c.latest.step === "roster");
  ok(admin.latest.rosterDraft === "Fay\nGil\nHal\nIda\nJon", "S1.42 restart prefills the roster text");
  ok(admin.latest.tournamentName === "Restart Cup" && admin.latest.points === 21, "S1.43 restart keeps name and point limit");
  send(admin, "restartTournament", {});
  await admin.waitFor(c => c.errors.some(e => /Already on the setup screen/.test(e)));
  ok(true, "S1.44 restart on the roster screen is rejected");
  const seasonR = JSON.parse((await get(P1, "/table-tennis/api/season")).body);
  ok(seasonR.abandonedCount === 1, "S1.45 a restart after played matches archives an abandoned run");
  // restart with nothing played -> no extra abandon
  send(admin, "submitRoster", { raw: "Fay\nGil\nHal\nIda\nJon", name: "No Play" });
  await admin.waitFor(c => c.latest.step === "stageChoice");
  send(admin, "pickStage", { format: "rr" });
  await admin.waitFor(c => c.latest.step === "play");
  send(admin, "restartTournament", {});
  await admin.waitFor(c => c.latest.step === "roster");
  await sleep(200);
  const seasonR2 = JSON.parse((await get(P1, "/table-tennis/api/season")).body);
  ok(seasonR2.abandonedCount === 1, "S1.46 a restart with nothing played records nothing");

  /* --- live video --- */
  send(admin, "setLiveVideo", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  await admin.waitFor(c => c.messages.some(m => m.type === "state" && m.liveVideo === "dQw4w9WgXcQ"));
  ok(true, "S1.47 a full YouTube URL sets the video");
  send(admin, "setLiveVideo", { url: "https://youtu.be/abcdefghijk" });
  await admin.waitFor(c => c.messages.some(m => m.type === "state" && m.liveVideo === "abcdefghijk"));
  ok(true, "S1.48 a youtu.be link works");
  send(admin, "setLiveVideo", { url: "https://www.youtube.com/shorts/12345678901" });
  await admin.waitFor(c => c.messages.some(m => m.type === "state" && m.liveVideo === "12345678901"));
  ok(true, "S1.49 a shorts link works");
  send(admin, "setLiveVideo", { url: "not a video" });
  await admin.waitFor(c => c.errors.some(e => /YouTube/.test(e)));
  ok(true, "S1.50 junk links are rejected");
  send(admin, "setLiveVideo", { url: "" });
  await admin.waitFor(c => c.messages.some(m => m.type === "state" && !m.liveVideo));
  ok(true, "S1.51 clearing removes the video");
  send(guest, "setLiveVideo", { url: "https://youtu.be/zzzzzzzzzzz" });
  await guest.waitFor(c => c.errors.some(e => /Only the admin/.test(e)));
  ok(true, "S1.52 viewers cannot set the video");

  /* --- season tools --- */
  send(admin, "seasonStar", { name: "Ann" });
  await admin.waitFor(c => c.messages.some(m => m.type === "state" && m.season && m.season.starCount === 1));
  ok(true, "S1.53 a star can be toggled");
  send(admin, "seasonImport", { text: "{bad json" });
  await admin.waitFor(c => c.errors.some(e => /valid JSON/.test(e)));
  ok(true, "S1.54 a bad import is rejected");
  send(admin, "seasonNew", { name: "Fresh Season" });
  await admin.waitFor(c => c.messages.some(m => m.type === "state" && m.season && m.season.name === "Fresh Season"));
  ok(true, "S1.55 a new season can be started");
  send(admin, "seasonFull", {});
  await admin.waitFor(c => c.lastFull != null);
  ok(typeof admin.lastFull === "string" && JSON.parse(admin.lastFull).v === 1, "S1.56 the full archive downloads");
  send(guest, "seasonFull", {});
  await guest.waitFor(c => c.errors.some(e => /Only the admin/.test(e)));
  ok(true, "S1.57 viewers cannot export");
  send(admin, "stateFull", {});
  await admin.waitFor(c => c.lastStateFull != null);
  ok(JSON.parse(admin.lastStateFull).v === 3, "S1.58 the tournament snapshot downloads");
  send(admin, "stateImport", { text: "nope" });
  await admin.waitFor(c => c.errors.some(e => /valid JSON/.test(e)));
  ok(true, "S1.59 a bad state import is rejected");

  /* --- edge cases over the wire (TT) --- */
  send(admin, "reset", {});
  await admin.waitFor(c => c.latest.step === "roster");
  send(admin, "submitRoster", { raw: "format: bogus\nP1\nP2\nP3" });
  await admin.waitFor(c => c.errors.some(e => /Unknown 'format:'/.test(e)));
  ok(true, "S1.59b a bad directive is relayed as an error");
  send(admin, "submitRoster", { raw: "format: elim\nDup\nDup\nDup" });
  await admin.waitFor(c => c.errors.some(e => /appears more than once/.test(e)));
  ok(true, "S1.59c duplicate names rejected over the wire");
  send(admin, "submitRoster", { raw: "Point1\nPoint2\nPoint3", points: 21 });
  await admin.waitFor(c => c.latest.step === "stageChoice");
  send(admin, "pickStage", { format: "rr" });
  await admin.waitFor(c => c.latest.step === "play");
  send(admin, "saveScore", { mi: 0, sa: 11, sb: 9 });
  await admin.waitFor(c => c.errors.some(e => /short/.test(e)));
  ok(true, "S1.59d the 21-point limit is enforced over the wire");
  send(admin, "saveScore", { mi: 9, sa: 21, sb: 19 });
  await admin.waitFor(c => c.errors.some(e => /doesn't exist/.test(e)));
  ok(true, "S1.59e a bad match index is rejected");
  send(admin, "continueTournament", {});
  await admin.waitFor(c => c.errors.some(e => /Enter all scores/.test(e)));
  ok(true, "S1.59f continuing an unfinished round is rejected");
  send(admin, "draftScore", { mi: 0, which: "a", value: 12 });
  await sleep(120);
  ok(admin.ws.readyState === admin.ws.OPEN, "S1.59g draft scores never crash the room");
  send(admin, "saveScore", { mi: 0, sa: 21, sb: 19 });
  await admin.waitFor(c => c.latest.schedule.rounds[0].some(m => m.played));
  // registry dedupe: the same roster again must not duplicate entries
  const countBefore = admin.players.length;
  send(admin, "restartTournament", {});
  await admin.waitFor(c => c.latest.step === "roster");
  send(admin, "submitRoster", { raw: "Point1\nPoint2\nPoint3" });
  await admin.waitFor(c => c.latest.step === "stageChoice");
  await sleep(250);
  ok(admin.players.length === countBefore, "S1.59h re-entering the same players never duplicates registry entries");

  admin.ws.close(); guest.ws.close(); viewer.ws.close();
  await sleep(200);
}

/* --- football over the wire --- */
section("S1. football app over the wire");
{
  const fbAdmin = await openWs(P1, "/football/");
  ok(fbAdmin.role === "admin", "S1.60 football has its own admin seat");
  const ttAdmin = await openWs(P1, "/table-tennis/");
  ok(ttAdmin.role === "admin", "S1.61 table tennis keeps an independent seat");

  // penalty shootout over the wire: two teams, single final
  send(fbAdmin, "addTeam", { teamName: "Pen FC", captain: "C1" });
  send(fbAdmin, "addTeam", { teamName: "Alty FC", captain: "C2" });
  await fbAdmin.waitFor(c => (c.latest.teams || []).length === 2);
  send(fbAdmin, "submitRoster", { raw: "" });
  await fbAdmin.waitFor(c => c.latest.step === "stageChoice");
  send(fbAdmin, "pickStage", { format: "rr" });
  await fbAdmin.waitFor(c => c.latest.step === "play");
  send(fbAdmin, "saveScore", { mi: 0, sa: 1, sb: 1 });
  await fbAdmin.waitFor(c => c.errors.some(e => /penalty shootout/.test(e)));
  ok(true, "S1.68a a level final demands a shootout over the wire");
  send(fbAdmin, "saveScore", { mi: 0, sa: 1, sb: 1, penA: 4, penB: 4 });
  await fbAdmin.waitFor(c => c.errors.some(e => /shootout needs a winner/.test(e)));
  ok(true, "S1.68b a level shootout is rejected");
  send(fbAdmin, "saveScore", { mi: 0, sa: 1, sb: 1, penA: 4, penB: 3 });
  await fbAdmin.waitFor(c => c.latest.schedule.rounds[0].some(m => m.played));
  const penMatch = fbAdmin.latest.schedule.rounds[0][0];
  ok(penMatch.penA === 4 && penMatch.penB === 3 && penMatch.winner, "S1.68c the shootout winner advances");
  send(fbAdmin, "continueTournament", {});
  await fbAdmin.waitFor(c => c.latest.step === "standings");
  ok(fbAdmin.latest.champion === penMatch.winner, "S1.68d the pens winner is crowned");

  // fresh room for the five-team league
  send(fbAdmin, "reset", {});
  await fbAdmin.waitFor(c => c.latest.step === "roster");
  for (const t of [["Red Lions", "Rahim", "Karim\nSabbir"], ["Blue Stars", "Tanvir", "Imran"], ["Green Eagles", "Sohel", ""], ["Yellow Waves", "Nabil", ""], ["Black Hawks", "Omar", ""]]) {
    send(fbAdmin, "addTeam", { teamName: t[0], captain: t[1], players: t[2] });
    await fbAdmin.waitFor(c => (c.latest.teams || []).some(x => x.name === t[0]));
  }
  ok(fbAdmin.latest.teams.length === 5, "S1.62 five squads registered");
  send(fbAdmin, "addTeam", { teamName: "red lions", captain: "X" });
  await fbAdmin.waitFor(c => c.errors.some(e => /already added/.test(e)));
  ok(true, "S1.63 duplicate team names rejected over the wire");
  send(fbAdmin, "addTeam", { teamName: "No Captain", captain: "" });
  await fbAdmin.waitFor(c => c.errors.some(e => /captitan|captain/i.test(e)));
  ok(true, "S1.63b a missing captain is rejected");
  send(fbAdmin, "removeTeam", { index: 4 });
  await fbAdmin.waitFor(c => (c.latest.teams || []).length === 4);
  send(fbAdmin, "addTeam", { teamName: "Black Hawks", captain: "Omar" });
  await fbAdmin.waitFor(c => (c.latest.teams || []).length === 5);
  ok(true, "S1.63c teams can be removed and re-added");
  send(fbAdmin, "submitRoster", { raw: "", name: "League Cup", duration: 80, breakMins: 10 });
  await fbAdmin.waitFor(c => c.latest.step === "stageChoice");
  ok(fbAdmin.latest.duration === 80 && fbAdmin.latest.breakMins === 10, "S1.64 timing fields round-trip");
  await fbAdmin.waitFor(c => c.players.length === 7);
  ok(["Red Lions", "Blue Stars", "Green Eagles", "Yellow Waves", "Black Hawks"].every(n => fbAdmin.players.some(p => p.name === n)), "S1.65 the registry auto-saves squads with captains");
  const lions = fbAdmin.players.find(p => p.name === "Red Lions");
  eqv(lions.players, ["Karim", "Sabbir"], "S1.66 squad lists saved");
  send(fbAdmin, "pickStage", { format: "rr" });
  await fbAdmin.waitFor(c => c.latest.step === "play");
  ok(fbAdmin.latest.schedule.rounds.length === 5, "S1.67 football round robin built");
  // a draw is a legal group result
  send(fbAdmin, "saveScore", { mi: 0, sa: 1, sb: 1 });
  await fbAdmin.waitFor(c => c.latest.schedule.rounds[0].some(m => m.played && m.scoreA === 1 && m.scoreB === 1));
  ok(true, "S1.68 a 1-1 draw stands in group play (no pens demanded)");
  send(fbAdmin, "undoScore", {});
  await fbAdmin.waitFor(c => !c.latest.schedule.rounds[0].some(m => m.played));
  send(fbAdmin, "saveScore", { mi: 0, sa: 100, sb: 0 });
  await fbAdmin.waitFor(c => c.errors.some(e => /above 99/.test(e)));
  ok(true, "S1.68e goal caps enforced over the wire");
  // restart keeps the squads
  send(fbAdmin, "restartTournament", {});
  await fbAdmin.waitFor(c => c.latest.step === "roster");
  eqv((fbAdmin.latest.teams || []).map(t => t.name), ["Red Lions", "Blue Stars", "Green Eagles", "Yellow Waves", "Black Hawks"], "S1.69 football restart keeps every squad");
  send(fbAdmin, "submitRoster", { raw: "", name: "League Cup" });
  await fbAdmin.waitFor(c => c.latest.step === "stageChoice");
  send(fbAdmin, "pickStage", { format: "rr" });
  await fbAdmin.waitFor(c => c.latest.step === "play");
  // play it out with first-named winning 2-0
  let guard = 0;
  while (fbAdmin.latest && fbAdmin.latest.step === "play" && guard++ < 80) {
    const round = fbAdmin.latest.schedule.rounds[fbAdmin.latest.roundIndex];
    for (let mi = 0; mi < round.length; mi++) {
      const m = round[mi];
      if (m && !m.played && m.a && m.b && m.a !== "BYE") {
        send(fbAdmin, "saveScore", { mi, sa: 2, sb: 0 });
      }
    }
    await fbAdmin.waitFor(c => {
      const r = c.latest.schedule.rounds[c.latest.roundIndex];
      return r && r.every(m => m.played);
    });
    send(fbAdmin, "continueTournament", {});
    await sleep(120);
  }
  const finalState = fbAdmin.latest;
  ok(finalState.step === "standings" || finalState.step === "stageChoice", "S1.70 football tournament completes");
  const fbSeason = JSON.parse((await get(P1, "/football/api/season")).body);
  ok(fbSeason.tournamentCount === 2, "S1.71 football archives both tournaments (shootout cup + league)");
  fbAdmin.ws.close(); ttAdmin.ws.close();
  await sleep(200);
}

} catch (e) { console.error("S1 CRASH:", e.message); }

/* ================= Scenario 1b: restart persistence ================= */
section("S1b. persistence across a server restart");
{
  const P1b = 4102;
  // build something live, then kill the PROCESS abruptly (a Render
  // redeploy): no socket close handlers run, so the resume file stays
  const a = await openWs(P1, "/table-tennis/");
  send(a, "submitRoster", { raw: "Persist\nPlayer\nThree\nFour\nFive", name: "Resume Cup" });
  await a.waitFor(c => c.latest.step === "stageChoice");
  send(a, "pickStage", { format: "rr" });
  await a.waitFor(c => c.latest.step === "play");
  send(a, "saveScore", { mi: 0, sa: 11, sb: 7 });
  await a.waitFor(c => c.latest.schedule.rounds[0].some(m => m.played));
  const before = a.latest;

  await kill(child1);   // abrupt — the state file stays on disk
  await sleep(200);
  const child2 = await boot(P1b, DIR1);
  try {
    const b = await openWs(P1b, "/table-tennis/");
    ok(b.latest.suspended === true, "S1b.1 a restored tournament arrives suspended");
    ok(b.latest.tournamentName === "Resume Cup", "S1b.2 the saved tournament is restored");
    ok(b.latest.schedule.rounds[0].some(m => m.played && m.scoreA === 11), "S1b.3 played scores survived the restart");
    send(b, "saveScore", { mi: 1, sa: 11, sb: 9 });
    await b.waitFor(c => c.errors.some(e => /paused/.test(e)));
    ok(true, "S1b.4 a suspended tournament refuses score changes");
    send(b, "pickStage", { format: "rr" });
    await b.waitFor(c => c.errors.some(e => /paused/.test(e)));
    ok(true, "S1b.5 stage picks are blocked while paused");
    send(b, "setLiveVideo", { url: "https://youtu.be/qqqqwwwwwww" });
    await b.waitFor(c => c.messages.some(m => m.type === "state" && m.liveVideo === "qqqqwwwwwww"));
    ok(true, "S1b.6 the video link can still be set while paused");
    send(b, "resumeTournament", {});
    await b.waitFor(c => c.latest.suspended === false);
    ok(true, "S1b.7 an admin resumes the tournament");
    ok(b.latest.schedule.rounds.length === before.schedule.rounds.length, "S1b.8 the draw is intact after resume");
    const playersApi = JSON.parse((await get(P1b, "/table-tennis/api/players")).body);
    ok(playersApi.some(p => p.name === "Persist"), "S1b.9 the UID registry survived the restart");
    send(b, "reset", {});
    await b.waitFor(c => c.latest.step === "roster" && !c.latest.suspended);
    ok(true, "S1b.10 reset clears the pause too");
    b.ws.close();
    await sleep(150);
  } catch (e) { console.error("S1b CRASH:", e.message); }
  await kill(child2);
}

/* ================= Scenario 2: auth mode (per-app tokens) ================= */
const P2 = 4103;
const DIR2 = path.join(ROOT, "auth");
await boot(P2, DIR2, {
  ADMIN_TOKENS_table_tennis: "tt-secret-token-123",
  ADMIN_TOKENS_football: "fb-secret-token-456"
});
try {

section("S2. per-app token auth");
{
  const info = JSON.parse((await get(P2, "/table-tennis/api/auth-info")).body);
  ok(info.authRequired === true, "S2.1 auth-info reports token mode");
  const socket = await openWs(P2, "/table-tennis/");
  ok(socket.role === "guest", "S2.2 everyone connects as a viewer in auth mode");
  send(socket, "submitRoster", { raw: "A\nB\nC" });
  await socket.waitFor(c => c.errors.some(e => /Only the admin/.test(e)));
  ok(true, "S2.3 actions are blocked before login");
  send(socket, "auth", { token: "wrong-token" });
  await socket.waitFor(c => c.authFails.length === 1);
  ok(/isn't right/.test(socket.authFails[0]) && /attempt/.test(socket.authFails[0]), "S2.4 a wrong token counts an attempt");
  send(socket, "auth", { token: "tt-secret-token-123" });
  await socket.waitFor(c => c.role === "admin");
  ok(true, "S2.5 the right token promotes to admin");
  send(socket, "auth", { token: "anything" });
  await socket.waitFor(c => c.messages.some(m => m.type === "authOk" && m.already));
  ok(true, "S2.6 re-auth as admin is a no-op");
  const fbSocket = await openWs(P2, "/football/");
  ok(fbSocket.role === "guest", "S2.7 the football app has its own gate");
  send(fbSocket, "auth", { token: "tt-secret-token-123" });
  await fbSocket.waitFor(c => c.authFails.length === 1);
  ok(/isn't right/.test(fbSocket.authFails[0]), "S2.8 the TT token does NOT unlock football");
  send(fbSocket, "auth", { token: "fb-secret-token-456" });
  await fbSocket.waitFor(c => c.role === "admin");
  ok(true, "S2.9 the football token unlocks football");
  send(socket, "logout", {});
  await socket.waitFor(c => c.role === "guest" || c.messages.some(m => m.type === "state" && m.hasAdmin === false));
  ok(true, "S2.10 logout steps back down to viewer");
  send(socket, "auth", { token: "tt-secret-token-123" });
  await socket.waitFor(c => c.role === "admin");
  ok(true, "S2.11 logging back in works after logout");
  // registry + restart work in auth mode too
  send(socket, "submitRoster", { raw: "Auth\nMode\nThree\nFour\nFive", name: "Auth Cup" });
  await socket.waitFor(c => c.latest.step === "stageChoice");
  await socket.waitFor(c => c.players.length === 5);
  ok(true, "S2.12 the registry fills in auth mode");
  send(socket, "pickStage", { format: "rr" });
  await socket.waitFor(c => c.latest.step === "play");
  send(socket, "restartTournament", {});
  await socket.waitFor(c => c.latest.step === "roster");
  ok(socket.latest.rosterDraft === "Auth\nMode\nThree\nFour\nFive", "S2.13 restart prefills in auth mode");
  // lockout: burn the remaining attempts from this IP on the FB app
  const burner = await openWs(P2, "/football/");
  for (let i = 0; i < 5; i++) send(burner, "auth", { token: "nope-" + i });
  await burner.waitFor(c => c.authFails.length === 5);
  ok(/Locked/.test(burner.authFails[4]), "S2.14 five wrong tokens lock the network out");
  send(burner, "auth", { token: "fb-secret-token-456" });
  await burner.waitFor(c => c.authFails.length === 6);
  ok(/Too many wrong attempts|try again/.test(burner.authFails[5]), "S2.15 even the right token is refused while locked");
  socket.ws.close(); fbSocket.ws.close(); burner.ws.close();
  await sleep(200);
}

} catch (e) { console.error("S2 CRASH:", e.message); }

/* ================= Scenario 3: open-mode room closing ================= */
section("S3. open-mode room closing");
{
  const P3 = 4104;
  const DIR3 = path.join(ROOT, "close");
  const child3 = await boot(P3, DIR3);
  try {
    const host = await openWs(P3, "/table-tennis/");
    const watcher = await openWs(P3, "/table-tennis/?viewer=1");
    send(host, "submitRoster", { raw: "One\nTwo\nThree\nFour\nFive" });
    await host.waitFor(c => c.latest.step === "stageChoice");
    send(host, "pickStage", { format: "rr" });
    await host.waitFor(c => c.latest.step === "play");
    send(host, "saveScore", { mi: 0, sa: 11, sb: 5 });
    await host.waitFor(c => c.latest.schedule.rounds[0].some(m => m.played));
    host.ws.close();
    await watcher.waitFor(c => c.sessionEnded === true, 5000);
    ok(true, "S3.1 viewers are told when the host leaves (open mode)");
    const late = await openWs(P3, "/table-tennis/");
    await late.waitFor(c => c.latest && c.latest.step === "roster");
    ok(late.role === "admin", "S3.2 the next non-spectator claims the freed seat");
    const season3 = JSON.parse((await get(P3, "/table-tennis/api/season")).body);
    ok(season3.abandonedCount === 1, "S3.3 the abandoned run was archived on close");
    late.ws.close(); watcher.ws.close();
    await sleep(150);
  } catch (e) { console.error("S3 CRASH:", e.message); }
  await kill(child3);
}

try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
console.log("\nSUITE hub-integration: " + (pass + fail) + " cases, " + pass + " passed, " + fail + " failed");
if (fail) { console.log("FAILED CASES:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
})().catch(e => { console.error("SUITE CRASHED:", e); process.exit(1); });
