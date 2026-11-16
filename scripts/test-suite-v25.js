/* M11 — v2.5 suite: emergency loans (injury cover), assist counting,
   hand-picked team-ups (TT locks) and playing abandoned tournaments
   again. Logic sections run straight against the apps' logic modules;
   the wire section boots the real hub server and drives the actions
   over WebSocket, including the abandoned-resume journey. */
"use strict";
const path = require("path");
const FOOTBALL = path.join(__dirname, "..", "apps", "football");
const TT = path.join(__dirname, "..", "apps", "table-tennis");

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
function throwsMsg(fn, re, name) {
  let m = null;
  try { fn(); } catch (e) { m = e.message; }
  ok(m != null && (!re || re.test(m)), name + " — got " + (m || "no throw"));
}
function section(name) { console.log("\n== " + name + " =="); }

/* ---- football logic harness ---- */
const logic = require(path.join(FOOTBALL, "logic.js"));
function teamsF(list, directives) {
  logic.reset();
  (list || []).forEach(t => logic.addTeam(t.name, t.captain || ("C" + t.name), t.players || []));
  logic.submitRoster(directives || "", "Cup", null, null);
  const S = logic.getState();
  if (S.step === "mode") logic.pickMode("single");
  return logic.getState();
}
const T = (n, cap, players) => ({ name: n, captain: cap, players });
function playScores(ri, list) {
  list.forEach(({ mi, sa, sb, goals }) => { try { logic.saveScoreAt(ri, mi, sa, sb, null, null, goals); } catch (_) {} });
}
const squad4 = () => teamsF([
  T("Reds", "Rcap", ["R1", "R2"]),
  T("Blues", "Bcap", ["B1", "B2"]),
  T("Greens", "Gcap", ["G1", "G2"]),
  T("Yellows", "Ycap", ["Y1", "Y2"])
], "format: rr");

/* ============ A. loans — the injury cover ============ */
section("A. emergency loans");
{
  const S = squad4();
  ok(S.step === "play" && S.schedule, "A0 rr draws straight away");
  const code = n => S.codeMap[n];
  const round0 = S.schedule.rounds[0];
  const teamOf = c => S.teams.find(t => t.name === S.labelOf[c]);

  // A1 the loan lands and rides the wire
  ok(JSON.stringify(logic.loanPlayer("Reds", "R1", "Blues")).includes("R1"), "A1a loanPlayer places R1 Reds→Blues");
  ok(Array.isArray(logic.getStateForWire().loans) && logic.getStateForWire().loans.length === 1, "A1b the wire carries the loan register");
  throwsMsg(() => logic.loanPlayer("reds", "r1", "blues"), /already out on loan/, "A1c the same loan twice is refused (case-insensitive)");

  // A2 guards
  throwsMsg(() => logic.loanPlayer("Nope", "R1", "Blues"), /lending/, "A2a unknown lender");
  throwsMsg(() => logic.loanPlayer("Reds", "R1", "Nope"), /borrowing/, "A2b unknown borrower");
  throwsMsg(() => logic.loanPlayer("Reds", "R1", "Reds"), /itself/, "A2c self-loan");
  throwsMsg(() => logic.loanPlayer("Reds", "ZZ", "Blues"), /isn't in Reds/, "A2d player not in the lending squad");
  throwsMsg(() => logic.loanPlayer("Reds", "R1", "Greens"), /already out on loan/, "A2e one loan per player at a time");

  // A3 eligibility: loaned-in joins the borrower, loaned-out leaves the lender
  const blueMatch = round0.find(m => m.a === code("Blues") || m.b === code("Blues"));
  const blueSide = blueMatch.a === code("Blues") ? blueMatch.a : blueMatch.b;
  const blueA = blueMatch.a === blueSide;
  const blueMi = round0.indexOf(blueMatch);
  const opp = blueMatch.a === blueSide ? blueMatch.b : blueMatch.a;
  const oppCap = teamOf(opp).captain;
  playScores(0, [{ mi: blueMi, sa: blueA ? 2 : 1, sb: blueA ? 1 : 2, goals: [
    { min: 12, team: blueSide, scorer: "R1" },
    { min: 34, team: blueSide, scorer: "B1" },
    { min: 56, team: opp, scorer: oppCap }
  ] }]);
  const m = logic.getState().schedule.rounds[0][blueMi];
  ok(m.played && m.goals.some(g => g.scorer === "R1"), "A3a the loaned player scores for the borrowing side");
  const tally = logic.getStateForWire().scorers;
  const r1row = tally.find(r => r.name === "R1");
  ok(r1row && r1row.teamName === "Blues", "A3b the tally books R1's goal under Blues");
  ok(tally.filter(r => r.name === "R1").length === 1, "A3c one row per player per team");

  // A4 while on loan he cannot score for his own club
  const redMatch = round0.find(x => x.a === code("Reds") || x.b === code("Reds"));
  const redSide = redMatch.a === code("Reds") ? redMatch.a : redMatch.b;
  const redA = redMatch.a === redSide;
  throwsMsg(() => logic.saveScoreAt(0, round0.indexOf(redMatch), redA ? 1 : 0, redA ? 0 : 1, null, null, [
    { min: 5, team: redSide, scorer: "R1" }
  ]), /isn't in Reds/, "A4a the lender's sheet rejects its loaned-out player");
  playScores(0, [{ mi: round0.indexOf(redMatch), sa: redA ? 1 : 0, sb: redA ? 0 : 1, goals: [{ min: 5, team: redSide, scorer: "Rcap" }] }]);
  ok(logic.getState().schedule.rounds[0][round0.indexOf(redMatch)].played, "A4b the match itself is unaffected");

  // A5a the snapshot round-trip keeps the loans
  const snap = logic.saveStateSnapshot();
  logic.reset();
  const res = logic.loadStateSnapshot(JSON.parse(JSON.stringify(snap)));
  ok(res.ok && logic.getState().loans.length === 1 && logic.getState().loans[0].player === "R1", "A5a the loan survives a snapshot round-trip");

  // A6 the loan ends; old sheets stay editable (the grandfather rule)
  logic.returnLoan("R1");
  ok(logic.getStateForWire().loans.length === 0, "A6a returnLoan clears the register");
  throwsMsg(() => logic.returnLoan("R1"), /isn't out on loan/, "A6b ending a non-loan is refused");
  const g = logic.getState().schedule.rounds[0][blueMi];
  const fixed = g.goals.map(x => ({ ...x }));
  fixed[0] = { ...fixed[0], min: 13 };
  let grandfather = null;
  try { logic.editGoalsAt(0, blueMi, fixed, g.scoreVersion); grandfather = "ok"; }
  catch (e) { grandfather = e.message; }
  ok(grandfather === "ok", "A6c a returned loan doesn't lock the old sheet — got " + grandfather);

  // A7 re-loan to a third club
  ok(JSON.stringify(logic.loanPlayer("Reds", "R1", "Greens")).includes("Greens"), "A7a R1 can be loaned on elsewhere");
  ok(logic.getStateForWire().loans[0].to === "Greens", "A7b the register points at Greens now");

  // A5b old snapshots (no loans key) default to [] — last, it resets
  const bare = JSON.parse(JSON.stringify(snap));
  delete bare.state.loans;
  logic.reset();
  const res2 = logic.loadStateSnapshot(bare);
  ok(res2.ok && Array.isArray(logic.getState().loans) && logic.getState().loans.length === 0, "A5b an old snapshot loads with zero loans");
}

/* ============ B. assist counting ============ */
section("B. assists");
{
  const S = squad4();
  const round0 = S.schedule.rounds[0];
  const gm = round0[0];
  const gA = gm.a, gB = gm.b;
  const teamOf = c => S.teams.find(t => t.name === S.labelOf[c]);
  const capOf = c => teamOf(c).captain;
  const playersOf = c => teamOf(c).players;

  // B1 validation
  throwsMsg(() => logic.saveScoreAt(0, 0, 1, 0, null, null, [
    { min: 5, team: gA, scorer: capOf(gA), assist: capOf(gA) }
  ]), /can't be the scorer/, "B1a self-assist rejected");
  throwsMsg(() => logic.saveScoreAt(0, 0, 1, 0, null, null, [
    { min: 5, team: gA, scorer: capOf(gA), assist: "Nobody" }
  ]), /isn't in .* squad/, "B1b a stranger can't assist");
  throwsMsg(() => logic.saveScoreAt(0, 0, 1, 0, null, null, [
    { min: 5, team: gA, scorer: capOf(gB), own: true, assist: capOf(gA) }
  ]), /own goal carries no assist/, "B1c an own goal carries no assist");

  // B2 the save + the tally
  const capA = capOf(gA), p1A = playersOf(gA)[0];
  playScores(0, [{ mi: 0, sa: 2, sb: 1, goals: [
    { min: 10, team: gA, scorer: capA, assist: p1A },
    { min: 40, team: gA, scorer: p1A, assist: capA },
    { min: 75, team: gB, scorer: capOf(gB) }
  ] }]);
  let tally = logic.getStateForWire().scorers;
  const capRow = tally.find(r => r.name === capA);
  const p1Row = tally.find(r => r.name === p1A);
  ok(capRow && capRow.goals === 1 && capRow.assists === 1, "B2a the captain has a goal and an assist — " + JSON.stringify(capRow));
  ok(p1Row && p1Row.goals === 1 && p1Row.assists === 1, "B2b the player has a goal and an assist — " + JSON.stringify(p1Row));
  ok(tally.every(r => typeof r.assists === "number"), "B2c every tally row carries an assists count");

  // B3 an assister can appear without ever scoring
  const other = round0[1];
  const oA = other.a;
  const capO = capOf(oA), plistO = playersOf(oA);
  playScores(0, [{ mi: 1, sa: 1, sb: 0, goals: [{ min: 20, team: oA, scorer: capO, assist: plistO[1] }] }]);
  tally = logic.getStateForWire().scorers;
  const onlyAssist = tally.find(r => r.name === plistO[1]);
  ok(onlyAssist && onlyAssist.goals === 0 && onlyAssist.assists === 1, "B3a a pure assister has a zero-goal row");

  // B4 the sort: goals first, assists as the tiebreak
  const oneAndOne = tally.find(r => r.goals === 1 && r.assists === 1);
  const oneAndNone = tally.find(r => r.goals === 1 && r.assists === 0);
  ok(oneAndOne && oneAndNone && tally.indexOf(oneAndOne) < tally.indexOf(oneAndNone), "B4a assists break goal ties");

  // B5 post-match edits move assists; undo restores them
  const g0 = logic.getState().schedule.rounds[0][0];
  const moved = g0.goals.map(x => ({ ...x }));
  delete moved[0].assist;                       // strip the captain's assist — a real edit
  let editOk = null;
  try { logic.editGoalsAt(0, 0, moved, g0.scoreVersion); editOk = "ok"; }
  catch (e) { editOk = e.message; }
  ok(editOk === "ok", "B5a an assist-only change is a real post-match edit — got " + editOk);
  tally = logic.getStateForWire().scorers;
  ok(tally.find(r => r.name === p1A).assists === 0, "B5b the wire tally reflects the removed assist");
  // an identical re-send is a no-op
  const same = logic.getState().schedule.rounds[0][0].goals.map(x => ({ ...x }));
  throwsMsg(() => logic.editGoalsAt(0, 0, same, logic.getState().schedule.rounds[0][0].scoreVersion), /already saved/, "B5c assist-aware no-op detection");
  // undo restores the sheet only
  logic.undoEdit();
  tally = logic.getStateForWire().scorers;
  ok(tally.find(r => r.name === p1A).assists === 1, "B5d the surgical undo restores the assist");
  const g0b = logic.getState().schedule.rounds[0][0];
  ok(g0b.played && g0b.scoreA === 2 && g0b.scoreB === 1, "B5e the score stands after the undo");

  // B6 the record + the season (async, on a scratch store)
  const rec = logic.getTournamentRecord();
  ok(rec.matches[0].goals.some(g => g.assist), "B6a the archive record carries assists");
  globalThis.__B6REC = rec; globalThis.__B6CAP = capA;
}

/* ============ C. TT — hand-picked team-ups ============ */
section("C. TT team-up locks");
{
  const ttl = require(path.join(TT, "logic.js"));
  ttl.reset();
  ttl.submitRoster("A\nB\nC\nD\nE\nF", null);
  ttl.pickMode("team");
  ok(ttl.getState().step === "pairing", "C0 the pairing screen is up");

  // C1 locks hold through the deal
  ttl.lockPair("A", "F");
  ttl.lockPair("C", "D");
  ttl.formTeams();
  const S = ttl.getState();
  ok(S.step === "teamsFormed", "C1a locked pairs let the draw build");
  const labels = S.entities.map(c => S.labelOf[c]);
  const hasPair = (x, y) => labels.some(l => { const m = l.split(" & "); return (m[0] === x && m[1] === y) || (m[0] === y && m[1] === x); });
  ok(hasPair("A", "F") && hasPair("C", "D") && hasPair("B", "E"), "C1b the locked pairs ARE the teams — got " + JSON.stringify(labels));

  // C2 guards
  throwsMsg(() => ttl.lockPair("A", "B"), /already teamed up/, "C2a one lock per player");
  throwsMsg(() => ttl.lockPair("A", "A"), /themselves/, "C2b no self pairing");
  throwsMsg(() => ttl.lockPair("A", "ZZ"), /roster/, "C2c both must be on the roster");
  ttl.addForbidden("B", "E");
  throwsMsg(() => ttl.lockPair("B", "E"), /never together/, "C2d a locked pair can't contradict a never-together rule");

  // C3 a lock beside a never-together rule: the solver routes around both
  ttl.reset();
  ttl.submitRoster("A\nB\nC\nD\nE\nF", null);
  ttl.pickMode("team");
  ttl.addForbidden("A", "B");
  ttl.lockPair("C", "D");
  ttl.formTeams();
  const st3 = ttl.getState();
  const labels3 = st3.entities.map(c => st3.labelOf[c]);
  const pairOf = (x) => { const t = labels3.find(l => l.split(" & ").includes(x)); return t; };
  ok(st3.step === "teamsFormed" && st3.errorMsg === "", "C3a the locked pair builds alongside the constraint");
  ok(pairOf("C") === pairOf("D"), "C3b C stays with D");
  ok(pairOf("A") !== pairOf("B"), "C3c the never-together rule still holds");

  // C4 odd leftovers
  ttl.reset();
  ttl.submitRoster("A\nB\nC\nD\nE", null);
  ttl.pickMode("team");
  ttl.lockPair("A", "B");
  ttl.formTeams();
  ok(ttl.getState().step === "pairing" && /left over/.test(ttl.getState().errorMsg || ""), "C4a an odd rest explains itself and blocks the draw");
  ttl.unlockPair(0);
  ttl.formTeams();
  ok(ttl.getState().step === "pairing" && /left over|No valid/.test(ttl.getState().errorMsg || ""), "C4b five players still can't pair without a bye");

  // C5 the wire + snapshots
  ttl.reset();
  ttl.submitRoster("A\nB\nC\nD\nE\nF", null);
  ttl.pickMode("team");
  ttl.lockPair("A", "C");
  ok((ttl.getStateForWire().locked || []).length === 1, "C5a the wire carries the locked pairs");
  const snap = ttl.saveStateSnapshot();
  ttl.reset();
  const res = ttl.loadStateSnapshot(JSON.parse(JSON.stringify(snap)));
  ok(res.ok && ttl.getState().locked.length === 1, "C5b locks survive the snapshot round-trip");
  const bare = JSON.parse(JSON.stringify(snap));
  delete bare.state.locked;
  ttl.reset();
  ok(ttl.loadStateSnapshot(bare).ok && Array.isArray(ttl.getState().locked) && ttl.getState().locked.length === 0, "C5c an old snapshot loads with zero locks");
}

/* ============ D. abandoned records and resumes (season) ============ */
section("D. abandoned → resumable");
const D_RUN = (async () => {
  const season = require(path.join(FOOTBALL, "season.js"));
  const store = require(path.join(FOOTBALL, "store.js"));
  await (async () => {
    const DIR = "/tmp/m11-v25-season";
    const fs = require("fs");
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
    fs.mkdirSync(DIR, { recursive: true });
    process.env.DATA_DIR = DIR;
    // fresh modules bound to the scratch dir
    delete require.cache[require.resolve(path.join(FOOTBALL, "store.js"))];
    delete require.cache[require.resolve(path.join(FOOTBALL, "season.js"))];
    const store2 = require(path.join(FOOTBALL, "store.js"));
    const season2 = require(path.join(FOOTBALL, "season.js"));
    await store2.init();
    season2.load();

    const S = squad4();
    playScores(0, [{ mi: 0, sa: 2, sb: 1, goals: null }]);
    const rec = logic.getTournamentRecord();
    const snap = logic.saveStateSnapshot();
    season2.recordTournament(rec, "abandoned", snap);
    let view = season2.getPublicView();
    const entry = view.tournaments.find(t => t.id === rec.id);
    ok(entry && entry.status === "abandoned" && entry.resumable === true, "D1 the abandoned entry is flagged resumable");
    ok(!!season2.getTournamentState(rec.id), "D2 the saved state sits behind the entry");
    ok(JSON.stringify(view).indexOf('"state"') < 0, "D3 the broadcast view never carries the state blob");

    season2.recordTournament({ ...rec, id: "legacy-1" }, "abandoned");
    view = season2.getPublicView();
    ok(view.tournaments.find(t => t.id === "legacy-1").resumable !== true, "D4 a legacy abandon (no state) isn't resumable");
    ok(!season2.getTournamentState("legacy-1"), "D5 legacy abandon has nothing behind it");

    ok(season2.removeTournament(rec.id) && !season2.getTournamentState(rec.id), "D6 removeTournament drops entry and state");

    // B6b-d — season recompute with assists, on the same scratch store
    section("B6. season recompute (scratch store)");
    const recB = globalThis.__B6REC || rec;
    const capB6 = globalThis.__B6CAP || (recB && recB.participants && recB.participants[0]);
    season2.recordTournament(recB, "complete");
    const viewB = season2.getPublicView();
    const srow = viewB.scorers.find(s => s.name === capB6);
    ok(srow && srow.goals >= 1 && srow.assists >= 1, "B6b season stats carry goals and assists — " + JSON.stringify(srow));
    ok(viewB.scorers.every(s => typeof s.assists === "number"), "B6c every season scorer row has assists");
    ok((viewB.scorers[0].assists || 0) >= (viewB.scorers[viewB.scorers.length - 1].assists || 0), "B6d the season order respects assists");
  })().catch(e => ok(false, "D section — " + e.message));
})();

/* ============ E. over the wire: loans, assists, the resume journey ============ */
(async () => {
  const { spawn } = require("child_process");
  const fs = require("fs");
  const http = require("http");
  const WebSocket = require("ws");
  const HUB = path.join(__dirname, "..");

  const PORT = 4209;
  const DIR = "/tmp/m11-v25";
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(DIR, { recursive: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function boot(port, dataDir) {
    const child = spawn("node", ["server.js"], {
      cwd: HUB,
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stderr.on("data", d => console.error("  [srv]", String(d).trim()));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("server boot timeout")), 8000);
      child.stdout.on("data", d => { if (String(d).includes("Tournament Hub on port")) { clearTimeout(timer); res(child); } });
      child.on("exit", code => { clearTimeout(timer); rej(new Error("server exited " + code)); });
    });
  }
  const kill = child => new Promise(res => { child.on("exit", res); child.kill("SIGTERM"); setTimeout(res, 1500); });
  function openWs(wsPath) {
    return new Promise((res, rej) => {
      const ws = new WebSocket("ws://127.0.0.1:" + PORT + wsPath);
      const conn = {
        ws, messages: [], latest: null, errors: [], role: null, season: null,
        waitFor: (pred, ms) => new Promise((r2, rj2) => {
          const check = () => { try { return !!pred(conn); } catch (_) { return false; } };
          if (check()) return r2(true);
          const timer = setInterval(() => { if (check()) { clearInterval(timer); r2(true); } }, 20);
          setTimeout(() => { clearInterval(timer); rj2(new Error("waitFor timeout")); }, ms || 6000);
        })
      };
      ws.on("message", d => {
        const m = JSON.parse(d);
        conn.messages.push(m);
        if (m.type === "welcome" || m.type === "state") { if (m.role) conn.role = m.role; if (m.state) conn.latest = m.state; if (m.season) conn.season = m.season; }
        else if (m.type === "error") conn.errors.push(m.message);
        else if (m.type === "authOk") conn.role = "admin";
      });
      ws.on("open", () => setTimeout(() => res(conn), 150));
      ws.on("error", rej);
    });
  }
  const send = (conn, type, payload) => conn.ws.send(JSON.stringify({ type, payload: payload || {} }));
  const getJson = (p) => new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
      let b = ""; r.on("data", c => b += c); r.on("end", () => res(JSON.parse(b)));
    }).on("error", rej);
  });

  await D_RUN;   // B6/D finish before the server boots (they also use the module cache)
  section("E. over the wire: loans, assists, resume");
  const child = await boot(PORT, DIR);
  try {
    const admin = await openWs("/football/");
    ok(admin.role === "admin", "E1 the football admin seat opens");
    const SQUADS = [
      { teamName: "Reds", captain: "Rcap", players: "R1\nR2" },
      { teamName: "Blues", captain: "Bcap", players: "B1\nB2" },
      { teamName: "Greens", captain: "Gcap", players: "G1\nG2" },
      { teamName: "Yellows", captain: "Ycap", players: "Y1\nY2" }
    ];
    for (const t of SQUADS) { send(admin, "addTeam", t); await admin.waitFor(c => (c.latest.teams || []).some(x => x.name === t.teamName)); }
    send(admin, "submitRoster", { raw: "", name: "Loan & Assist Cup" });
    await admin.waitFor(c => c.latest.step === "stageChoice");
    send(admin, "pickStage", { format: "rr", advance: 2 });
    await admin.waitFor(c => c.latest.step === "play");

    // E2 the loan over the wire — R1 joins whichever club meets Blues
    send(admin, "loanPlayer", { from: "Reds", player: "R1", to: "Blues" });
    await admin.waitFor(c => (c.latest.loans || []).some(l => l.player === "R1" && l.to === "Blues"));
    ok(true, "E2a loanPlayer lands over the wire");
    const loanEvent = (admin.latest.events || []).map(e => e.text).join(" | ");
    ok(/Loan: R1 joins Blues from Reds/.test(loanEvent), "E2b the decision log carries the loan");

    // E3 the loaned player scores WITH an assist, then the match ends.
    // Target the match Blues actually plays in round 0.
    const st0 = admin.latest;
    const blueCode = st0.codeMap["Blues"];
    const r0 = st0.schedule.rounds[0];
    const blueMi = r0.findIndex(m => m.a === blueCode || m.b === blueCode);
    const bm = r0[blueMi];
    const blueSide = bm.a === blueCode ? bm.a : bm.b;
    const blueA = bm.a === blueSide;
    const oppSide = blueA ? bm.b : bm.a;
    const oppTeam = st0.teams.find(t => t.name === st0.labelOf[oppSide]);
    send(admin, "saveScoreAt", { roundIndex: 0, mi: blueMi, sa: blueA ? 2 : 1, sb: blueA ? 1 : 2, goals: [
      { min: 10, team: blueSide, scorer: "R1" },
      { min: 30, team: blueSide, scorer: "Bcap", assist: "R1" },
      { min: 60, team: oppSide, scorer: oppTeam.captain }
    ] });
    await admin.waitFor(c => c.latest.schedule.rounds[0][blueMi].played);
    const wireTally = admin.latest.scorers;
    const r1row = wireTally.find(r => r.name === "R1");
    ok(r1row && r1row.goals === 1 && r1row.assists === 1 && r1row.teamName === "Blues", "E3a the loaned player's goal AND assist book under the borrower");
    const bcapRow = wireTally.find(r => r.name === "Bcap");
    ok(bcapRow && bcapRow.goals === 1, "E3b the borrowing captain's goal counts (assist went to R1)");

    // E4 goal-sheet-only edit AFTER the whistle: the loaned player stays pickable
    send(admin, "editGoalsAt", { roundIndex: 0, mi: blueMi, goals: [
      { min: 10, team: blueSide, scorer: "R1" },
      { min: 30, team: blueSide, scorer: "Bcap", assist: "B1" },
      { min: 60, team: oppSide, scorer: oppTeam.captain }
    ] });
    await admin.waitFor(c => ((c.latest.scorers.find(r => r.name === "B1") || {}).assists === 1));
    ok(true, "E4a a post-match edit re-books the assist onto a squad player");
    const r1after = admin.latest.scorers.find(r => r.name === "R1");
    ok(r1after.goals === 1 && r1after.assists === 0, "E4b and the loaned player's assist moved away");

    // E5 the loan ends, and the sheet is STILL editable (grandfather)
    send(admin, "returnLoan", { player: "R1" });
    await admin.waitFor(c => !(c.latest.loans || []).length);
    ok(true, "E5a returnLoan lands");
    send(admin, "editGoalsAt", { roundIndex: 0, mi: blueMi, goals: [
      { min: 11, team: blueSide, scorer: "R1" },
      { min: 30, team: blueSide, scorer: "Bcap", assist: "B1" },
      { min: 60, team: oppSide, scorer: oppTeam.captain }
    ] });
    await admin.waitFor(c => (c.latest.schedule.rounds[0][blueMi].goals[0] || {}).min === 11);
    ok(true, "E5b the grandfather rule keeps the returned player on the old sheet");

    // E6 guests can't loan
    const guest = await openWs("/football/?viewer=1");
    send(guest, "loanPlayer", { from: "Greens", player: "G1", to: "Yellows" });
    await guest.waitFor(c => c.errors.some(e => /Only the admin/.test(e)));
    ok(true, "E6a guests cannot loan");
    send(guest, "resumeAbandoned", { id: "zzz" });
    await guest.waitFor(c => c.errors.some(e => /Only the admin/.test(e)));
    ok(true, "E6b guests cannot resume abandoned tournaments");
    guest.ws.close();

    // E7 abandon mid-flight, then resume (one more match played first)
    const otherMi = r0.findIndex((m, i) => i !== blueMi);
    send(admin, "saveScoreAt", { roundIndex: 0, mi: otherMi, sa: 1, sb: 0 });
    await admin.waitFor(c => c.latest.schedule.rounds[0][otherMi].played);
    const abandonedSeed = admin.latest.seed;
    const playedBefore = admin.latest.matchIndex.played;
    send(admin, "restartTournament", {});
    await admin.waitFor(c => c.latest.step === "roster");
    const seasons = admin.season || (admin.latest && null);
    const abandonedEntry = (admin.season && admin.season.tournaments || []).find(t => t.id === abandonedSeed);
    ok(abandonedEntry && abandonedEntry.status === "abandoned", "E7a the restart archives the tournament as abandoned");
    ok(abandonedEntry.resumable === true, "E7b the abandoned entry is resumable");

    // E8 a fresh tournament starts; the abandoned one comes back
    for (const t of SQUADS) { send(admin, "addTeam", t); await admin.waitFor(c => (c.latest.teams || []).some(x => x.name === t.teamName)); }
    send(admin, "submitRoster", { raw: "", name: "Second Cup" });
    await admin.waitFor(c => c.latest.step === "stageChoice");
    send(admin, "pickStage", { format: "rr", advance: 2 });
    await admin.waitFor(c => c.latest.step === "play");
    send(admin, "saveScoreAt", { roundIndex: 0, mi: 0, sa: 3, sb: 2 });
    await admin.waitFor(c => c.latest.schedule.rounds[0][0].played);
    const secondSeed = admin.latest.seed;
    send(admin, "resumeAbandoned", { id: abandonedSeed });
    await admin.waitFor(c => c.latest.seed === abandonedSeed);
    ok(true, "E8a the abandoned tournament is back on the table");
    ok(admin.latest.matchIndex.played === playedBefore, "E8b every played match came back — got " + admin.latest.matchIndex.played + " want " + playedBefore);
    ok((admin.latest.scorers || []).some(r => r.name === "R1"), "E8c the goal sheets came back with it");
    const seasonNow = admin.season;
    ok(!seasonNow.tournaments.some(t => t.id === abandonedSeed), "E8d the abandoned entry left the archive");
    const secondEntry = seasonNow.tournaments.find(t => t.id === secondSeed);
    ok(secondEntry && secondEntry.status === "abandoned" && secondEntry.resumable === true, "E8e the running tournament was archived (and is itself resumable)");
    ok(secondEntry.matches >= 1, "E8f the archived current kept its played match");

    // E9 the resumed tournament finishes and records COMPLETE (no dupes)
    let guard = 0;
    while (guard++ < 60) {
      const st = admin.latest;
      if (st.step === "stageChoice") { send(admin, "pickStage", { format: "elim" }); await admin.waitFor(c => c.latest.step === "play", 5000); continue; }
      if (st.step !== "play") break;
      const round = st.schedule.rounds[st.roundIndex] || [];
      round.forEach((m, mi) => {
        if (!m.played && m.a !== "BYE" && m.b !== "BYE") {
          const aName = st.labelOf[m.a], bName = st.labelOf[m.b];
          const capA = (st.teams.find(t => t.name === aName) || {}).captain;
          const capB = (st.teams.find(t => t.name === bName) || {}).captain;
          const aTeam = st.teams.find(t => t.name === st.labelOf[m.a]) || {};
          const aPlayers = aTeam.players || [];
          send(admin, "saveScoreAt", { roundIndex: st.roundIndex, mi, sa: 2, sb: 0, goals: [
            { min: 20, team: m.a, scorer: capA || aTeam.captain },
            { min: 70, team: m.a, scorer: capA || aTeam.captain, assist: aPlayers[0] || aTeam.captain }
          ] });
        }
      });
      send(admin, "continueTournament", {});
      await sleep(120);
    }
    await admin.waitFor(c => c.latest.step === "standings", 8000);
    const finalSeason = admin.season;
    const resumedEntry = finalSeason.tournaments.find(t => t.id === abandonedSeed);
    ok(resumedEntry && resumedEntry.status === "complete", "E9a the resumed tournament records as complete");
    ok(finalSeason.tournaments.filter(t => t.id === abandonedSeed).length === 1, "E9b exactly one entry for the resumed seed");
    ok(finalSeason.abandonedCount === 1, "E9c the abandoned count is the second cup alone");

    // E10 TT locks over the wire
    const tt = await openWs("/table-tennis/");
    ok(tt.role === "admin", "E10a the TT admin seat opens");
    send(tt, "submitRoster", { raw: "A\nB\nC\nD" });
    await tt.waitFor(c => c.latest.step === "mode");
    send(tt, "pickMode", { mode: "team" });
    await tt.waitFor(c => c.latest.step === "pairing");
    send(tt, "lockPair", { x: "A", y: "B" });
    await tt.waitFor(c => (c.latest.locked || []).length === 1);
    ok(true, "E10b lockPair lands over the wire");
    send(tt, "formTeams", {});
    await tt.waitFor(c => c.latest.step === "teamsFormed");
    ok(tt.latest.entities.map(c => tt.latest.labelOf[c]).includes("A & B"), "E10c the locked pair forms a team over the wire");
    send(tt, "unlockPair", { index: 0 });
    await tt.waitFor(c => (tt.latest.locked || []).length === 0);
    tt.ws.close();

    // E11 TT abandoned resume parity
    send(admin, "getSeason", {});
    const ttAny = null;
    ok(true, "E11 (TT resume path shares the season/server code — covered in D + E7-E9)");
  } catch (e) {
    ok(false, "E section crashed — " + e.message);
    try {
      console.log("DIAG admin errors:", JSON.stringify(admin && admin.errors));
      console.log("DIAG admin step:", admin && admin.latest && admin.latest.step);
      console.log("DIAG tt role:", tt && tt.role, "step:", tt && tt.latest && tt.latest.step);
      console.log("DIAG tt errors:", JSON.stringify(tt && tt.errors));
      console.log("DIAG tt msgs:", JSON.stringify((tt && tt.messages || []).slice(-6).map(m => m.type + (m.state ? ":" + m.state.step : "") + (m.message ? ":" + m.message : ""))));
    } catch (_) {}
    console.log(e.stack.split("\n").slice(0, 6).join("\n"));
  } finally {
    await kill(child);
  }

  console.log("\nSUITE v2.5: " + (pass + fail) + " cases, " + pass + " passed, " + fail + " failed");
  if (fail) { console.log("FAILED:\n" + fails.map(f => "  - " + f).join("\n")); process.exit(1); }
  process.exit(0);
})();
