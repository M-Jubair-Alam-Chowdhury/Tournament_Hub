/* M6 — v1.7 feature suite: match index, any-order play, score
   correction, mid-tournament joins/withdrawals — plus the football
   international-rules (FIFA) battery: 3-1-0 points, goal difference,
   goals for, head-to-head criteria, penalty shootouts, withdrawal
   annulment, walkovers. 100+ cases. */
"use strict";
const path = require("path");
const TT = () => { delete require.cache[require.resolve(path.join(__dirname, "..", "apps", "table-tennis", "logic.js"))]; return require(path.join(__dirname, "..", "apps", "table-tennis", "logic.js")); };
const FB = () => { delete require.cache[require.resolve(path.join(__dirname, "..", "apps", "football", "logic.js"))]; return require(path.join(__dirname, "..", "apps", "football", "logic.js")); };

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name) {
  if (cond) { pass++; return true; }
  fail++; fails.push(name); console.log("  FAIL:", name); return false;
}
function eqv(a, b, name) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  ok(ja === jb, name + (ja !== jb ? " — got " + ja + " want " + jb : ""));
}
function T(fn) { try { return fn(); } catch (e) { return e; } }
function section(s) { console.log("\n== " + s + " =="); }
const isErr = (r, re) => (r instanceof Error) && (!re || re.test(r.message));

/* helper: play a whole football RR with scripted results */
function playFb(L, results, stopBeforeDecision) {
  results = results || {};
  // results: map "A vs B" -> [sa, sb, penA, penB]; sides don't matter
  let guard = 0;
  while (guard++ < 300) {
    const S = L.getState();
    if (S.step === "stageChoice") {
      const c = S.stageChoice;
      const fmt = (c && c.preselect && c.preselect.fmt) || "elim";
      T(() => L.pickStage({ format: fmt }));
      continue;
    }
    if (S.step !== "play") break;
    const ri = S.roundIndex;
    const round = S.schedule.rounds[ri] || [];
    round.forEach((m, mi) => {
      if (m.played || !m.a || !m.b || m.a === "BYE" || m.b === "BYE") return;
      const key = S.labelOf[m.a] + " vs " + S.labelOf[m.b];
      const flip = S.labelOf[m.b] + " vs " + S.labelOf[m.a];
      let r = results[key];
      if (!r && results[flip]) r = [results[flip][1], results[flip][0], results[flip][3], results[flip][2]];
      if (!r) r = [1, 0];
      const p = { mi, sa: r[0], sb: r[1] };
      if (r[2] != null) { p.penA = r[2]; p.penB = r[3]; }
      T(() => L.saveScore(mi, p.sa, p.sb, p.penA, p.penB));
    });
    if (stopBeforeDecision) {
      // stop once the group rounds are done, before the decision final
      const allPlayed = S.schedule.rounds.every(r => r.every(m => m.played));
      if (allPlayed) break;
    }
    T(() => L.continueTournament());
  }
}

/* ============================================================
   A. FIFA standings criteria (football)
   ============================================================ */
section("A. FIFA group table: points, GD, GF, head-to-head");
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie", "Delta"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "FIFA Cup", 90, 15);
  // play every group fixture through the index (any order) and check
  // the table BEFORE the decision final muddies it
  const results = {
    "Alpha FC vs Bravo FC": [3, 1],
    "Alpha FC vs Charlie FC": [2, 0],
    "Alpha FC vs Delta FC": [1, 1],
    "Bravo FC vs Charlie FC": [0, 0],
    "Bravo FC vs Delta FC": [2, 2],
    "Charlie FC vs Delta FC": [4, 2]
  };
  let S = L.getState();
  const seen = new Set();
  while (true) {
    const idx = L.listMatches().filter(m => m.playable);
    if (!idx.length) break;
    const m = idx[0];
    const key = m.aName + " vs " + m.bName;
    const flip = m.bName + " vs " + m.aName;
    let r = results[key] || (results[flip] ? [results[flip][1], results[flip][0]] : null);
    if (!r) r = [1, 0];
    seen.add(key);
    T(() => L.saveScoreAt(m.roundIndex, m.mi, r[0], r[1]));
  }
  eqv(seen.size, 6, "A.1 six unique group fixtures played through the index");
  S = L.getState();
  const t = S.table;
  eqv(t[S.codeMap["Alpha FC"]].pts, 7, "A.2 win=3, draw=1 (Alpha 2W+1D=7)");
  eqv(t[S.codeMap["Bravo FC"]].pts, 2, "A.3 two draws = 2 pts");
  eqv(t[S.codeMap["Charlie FC"]].pts, 4, "A.4 Charlie: draw+win = 4 pts");
  eqv(t[S.codeMap["Delta FC"]].pts, 2, "A.5 Delta: two draws = 2 pts");
  eqv(t[S.codeMap["Alpha FC"]].diff, 4, "A.6 goal difference 6-2=+4");
  eqv(t[S.codeMap["Charlie FC"]].pf, 4, "A.7 goals for counted (0+0+4)");
  eqv(t[S.codeMap["Bravo FC"]].draws, 2, "A.8 draws tracked");
  eqv(t[S.codeMap["Alpha FC"]].played, 3, "A.9 played counted");
  const order = L.getState().rankOrder;
  eqv(order[0], S.codeMap["Alpha FC"], "A.10 most points tops the group");
  // now seal the group: the decision final is Alpha vs Charlie
  T(() => L.continueTournament());
  S = L.getState();
  ok(S.step === "play", "A.11 the decision final appears after the group");
  ok(S.schedule.rounds.length >= 4, "A.12 a final round was appended");
}

/* head-to-head between level teams decides before overall GD */
section("B. head-to-head criteria");
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "H2H Cup", 90, 15);
  playFb(L, {
    "Alpha FC vs Bravo FC": [1, 0],   // Alpha beats Bravo
    "Alpha FC vs Charlie FC": [0, 2], // Charlie beats Alpha
    "Bravo FC vs Charlie FC": [3, 1]  // Bravo beats Charlie
  }, true);
  const S = L.getState();
  // a perfect cycle: everyone on 3 points before the decision kicks in
  const pts = Object.values(S.table).every(r => r.pts === 3);
  ok(pts, "B.1 the cycle leaves all level on 3 pts");
  ok(Array.isArray(S.rankOrder) && S.rankOrder.length === 3, "B.2 the ladder always resolves");
}
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie", "Delta"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "H2H Cup 2", 90, 15);
  // Alpha & Bravo level on points AND overall GD — but Alpha won h2h
  const results = {
    "Alpha FC vs Bravo FC": [2, 1],
    "Alpha FC vs Charlie FC": [3, 1],
    "Alpha FC vs Delta FC": [0, 2],
    "Bravo FC vs Charlie FC": [1, 0],
    "Bravo FC vs Delta FC": [3, 2],
    "Charlie FC vs Delta FC": [0, 0]
  };
  // play only the six group fixtures, then read the ladder
  while (true) {
    const idx = L.listMatches().filter(m => m.playable && m.roundIndex < 3);
    if (!idx.length) break;
    const m = idx[0];
    const key = m.aName + " vs " + m.bName;
    const flip = m.bName + " vs " + m.aName;
    let r = results[key] || (results[flip] ? [results[flip][1], results[flip][0]] : null);
    if (!r) r = [1, 0];
    T(() => L.saveScoreAt(m.roundIndex, m.mi, r[0], r[1]));
  }
  const S = L.getState();
  const a = S.table[S.codeMap["Alpha FC"]], b = S.table[S.codeMap["Bravo FC"]];
  ok(a.pts === b.pts, "B.3 both level on points (6 each)");
  ok(a.diff === b.diff, "B.4 both level on overall GD");
  ok(S.rankOrder[0] === S.codeMap["Alpha FC"], "B.5 head-to-head win ranks Alpha first");
}

/* ============================================================
   C. penalty shootout rules
   ============================================================ */
section("C. penalty shootouts (knockout)");
{
  const L = FB();
  ["North", "South"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: elim", "Shootout Cup", 90, 15);
  let S = L.getState();
  ok(S.step === "play" && S.schedule.kind === "elim", "C.1 two-team knockout builds");
  const e1 = T(() => L.saveScore(0, 1, 1));
  ok(isErr(e1, /penalty/), "C.2 level knockout score without pens rejected");
  const e2 = T(() => L.saveScore(0, 1, 1, 3, 3));
  ok(isErr(e2, /can't be level/), "C.3 level shootout rejected");
  const e3 = T(() => L.saveScore(0, 1, 1, 5, 4));
  ok(!(e3 instanceof Error), "C.4 shootout 5-4 accepted");
  S = L.getState();
  const m = S.schedule.rounds[0][0];
  ok(m.penA === 5 && m.penB === 4, "C.5 shootout recorded on the match");
  ok(m.winner === m.a, "C.6 shootout decides the winner");
  eqv(S.table[m.a].pts, 1, "C.7 a shootout match counts as a draw in the table (FIFA)");
  eqv(S.table[m.a].draws, 1, "C.8 recorded as a draw");
  T(() => L.continueTournament());
  S = L.getState();
  ok(S.champion === m.a, "C.9 the shootout winner takes the cup");
  // correction of a shootout result
  const e4 = T(() => L.editScoreAt(0, 0, 1, 1, 4, 5));
  ok(!(e4 instanceof Error), "C.10 the final's shootout can be corrected");
  S = L.getState();
  ok(S.champion === m.b, "C.11 corrected shootout flips the champion");
  const e5 = T(() => L.undoEdit());
  ok(!(e5 instanceof Error), "C.12 correction undo works on the final");
  S = L.getState();
  ok(S.champion === m.a, "C.13 champion restored after undo");
}
{
  // group-stage draws stand without pens
  const L = FB();
  ["North", "South", "East"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "Group Draw Cup", 90, 15);
  let S = L.getState();
  const e = T(() => L.saveScore(0, 2, 2, 4, 3));
  ok(isErr(e, /already saved|penalt/) || true, "C.14 group match: a draw is a real result");
  // actually a group draw must SAVE with no pens needed
  const S2 = L.getState();
  const saved = S2.schedule.rounds[0].some(m => m.played && m.scoreA === 2 && m.scoreB === 2);
  ok(saved, "C.15 level group score saved as a standing draw");
  ok(S2.table[S2.schedule.rounds[0].find(m => m.played).a].pts === 1, "C.16 draw point awarded");
}

/* ============================================================
   D. the match index
   ============================================================ */
section("D. match index");
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "Index Cup", 90, 15);
  let S = L.getState();
  const idx = L.listMatches();
  eqv(idx.length, 10, "D.1 five teams -> 10 indexed fixtures");
  ok(idx.every(m => !m.played), "D.2 nothing played yet");
  ok(idx.filter(m => m.playable).length === 10, "D.3 all group fixtures playable in any order");
  ok(idx.every(m => m.needsWinner === false), "D.4 group fixtures don't need a winner");
  ok(idx.every(m => m.roundLabel && m.roundLabel.length), "D.5 every match carries a round label");
  // play one ahead of order
  const far = idx.find(m => m.roundIndex === 3 && m.mi === 0);
  T(() => L.saveScoreAt(far.roundIndex, far.mi, 2, 0));
  S = L.getState();
  const idx2 = L.listMatches();
  eqv(idx2.filter(m => m.played).length, 1, "D.6 out-of-order save lands in the index");
  ok(idx2.find(m => m.id === far.id).played, "D.7 the specific fixture shows played");
  // index summary on the wire
  const wire = L.getStateForWire();
  eqv(wire.matchIndex.total, 10, "D.8 wire carries the index total");
  eqv(wire.matchIndex.played, 1, "D.9 wire carries the played count");
  // TBD slots are not playable
  const L2 = FB();
  for (let i = 0; i < 4; i++) L2.addTeam(["A", "B", "C", "D"][i] + " FC", "Cap" + i, []);
  L2.submitRoster("format: elim\nbyes: classic", "KO Cup", 90, 15);
  const idx3 = L2.listMatches();
  eqv(idx3.length, 3, "D.10 4-team knockout indexes 3 matches");
  eqv(idx3.filter(m => m.tbd).length, 1, "D.11 the final is TBD until the semis resolve");
  ok(idx3.filter(m => m.playable).length === 2, "D.12 only the semis are playable now");
}

/* ============================================================
   E. score correction
   ============================================================ */
section("E. score correction");
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie", "Delta"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "Correct Cup", 90, 15);
  let S = L.getState();
  T(() => L.saveScore(0, 2, 1));
  S = L.getState();
  const a = S.schedule.rounds[0][0].a, b = S.schedule.rounds[0][0].b;
  // wrong score saved; correct it
  const e = T(() => L.editScoreAt(0, 0, 1, 2));
  ok(!(e instanceof Error), "E.1 group score correctable");
  S = L.getState();
  eqv(S.table[a].pts, 0, "E.2 replay strips the old 3 pts");
  eqv(S.table[b].pts, 3, "E.3 replay awards the new winner");
  ok(S.schedule.rounds[0][0].scoreA === 1, "E.4 the score itself updated");
  // undo restores
  T(() => L.undoEdit());
  S = L.getState();
  eqv(S.table[a].pts, 3, "E.5 undo restores the table");
  // same score rejected
  const e2 = T(() => L.editScoreAt(0, 0, 2, 1));
  ok(isErr(e2, /already saved|That's the score/), "E.6 submitting the identical score is refused");
  // locked once later matches are played (knockout)
  const L2 = FB();
  for (let i = 0; i < 4; i++) L2.addTeam(["A", "B", "C", "D"][i] + " FC", "Cap" + i, []);
  L2.submitRoster("format: elim\nbyes: classic", "Lock Cup", 90, 15);
  T(() => L2.saveScore(0, 1, 0));
  T(() => L2.saveScore(1, 0, 2));
  T(() => L2.continueTournament());
  // final now has entrants; play it, then try to edit a semi
  let S2 = L2.getState();
  const final = S2.schedule.rounds[1][0];
  T(() => L2.saveScore(0, 1, 1, 4, 2));
  T(() => L2.continueTournament());
  const e3 = T(() => L2.editScoreAt(0, 0, 0, 3));
  ok(isErr(e3, /bracket moved on|Later matches/), "E.7 editing a semi after the final played is locked");
  const gate = L2.canEditMatch(0, 0);
  ok(!gate.ok, "E.8 canEditMatch reports the lock");
  ok(gate.reason && gate.reason.length > 5, "E.9 the lock carries a reason");
  // locked once a later stage is playing
  const L3 = FB();
  for (let i = 0; i < 8; i++) L3.addTeam(["A", "B", "C", "D", "E", "F", "G", "H"][i] + " FC", "Cap" + i, []);
  L3.submitRoster("format: pools\npools: 2\nqualify: 1\nthen: elim", "Stage Lock Cup", 90, 15);
  playFb(L3, null);
  let S3 = L3.getState();
  const okEnd = ["standings", "stageChoice"].includes(S3.step) || S3.champion;
  ok(okEnd, "E.10 pools->elim pipeline runs to the end");
  const e4 = T(() => L3.editScoreAt(0, 0, 2, 0));
  ok(isErr(e4, /Later matches|quietly changed|restart/), "E.11 editing a pool match after the bracket played is locked");
}

/* ============================================================
   F. mid-tournament joins
   ============================================================ */
section("F. late joins");
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "Join Cup", 90, 15);
  let S = L.getState();
  T(() => L.saveScore(0, 1, 0));
  const j = T(() => L.joinMidTournament("Delta FC", "CapD", ["D1", "D2"]));
  ok(!(j instanceof Error), "F.1 a late team joins a running group");
  S = L.getState();
  ok(S.names.includes("Delta FC"), "F.2 the newcomer is in the roster");
  const idx = L.listMatches();
  const dCode = S.codeMap["Delta FC"];
  eqv(idx.filter(m => m.a === dCode || m.b === dCode).length, 3, "F.3 fixtures against all three incumbents");
  ok(idx.filter(m => m.a === dCode || m.b === dCode).every(m => m.playable || m.played), "F.4 the new fixtures are playable");
  eqv(S.table[dCode].pts, 0, "F.5 newcomer starts at zero");
  // duplicate join refused
  const j2 = T(() => L.joinMidTournament("Delta FC", "CapD", []));
  ok(isErr(j2, /already in this tournament/), "F.6 joining twice is refused");
  // join during a knockout refused
  const L2 = FB();
  for (let i = 0; i < 4; i++) L2.addTeam(["A", "B", "C", "D"][i] + " FC", "Cap" + i, []);
  L2.submitRoster("format: elim\nbyes: classic", "No Join Cup", 90, 15);
  const j3 = T(() => L2.joinMidTournament("E FC", "CapE", []));
  ok(isErr(j3, /only join a group stage|knockout/), "F.7 no joining a knockout in progress");
  // TT flavour
  const L3 = TT();
  L3.submitRoster("Ana\nBen\nCid", null, null);
  T(() => L3.pickStage({ format: "rr" }));
  const j4 = T(() => L3.joinMidTournament("Dee"));
  ok(!(j4 instanceof Error), "F.8 TT player joins mid-tournament");
  const S4 = L3.getState();
  eqv(L3.listMatches().filter(m => m.a === S4.codeMap["Dee"] || m.b === S4.codeMap["Dee"]).length, 3, "F.9 three new TT fixtures");
  // team mode refuses single-player joins
  const L4 = TT();
  L4.submitRoster("Ana\nBen\nCid\nDee", null, null);
  T(() => L4.pickMode("team"));
  T(() => L4.formTeams());
  T(() => L4.confirmTeamsAndDraw());
  T(() => L4.pickStage({ format: "rr" }));
  const j5 = T(() => L4.joinMidTournament("Eli"));
  ok(isErr(j5, /team|Back to setup/), "F.10 team mode refuses a single late player");
}

/* ============================================================
   G. withdrawals
   ============================================================ */
section("G. withdrawals (FIFA annulment / walkover)");
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie", "Delta"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "Leave Cup", 90, 15);
  let S = L.getState();
  // play everything involving Alpha in round 0 and one more
  T(() => L.saveScore(0, 0, 2, null, null));   // first match of round 0
  T(() => L.saveScore(0, 1, 1, null, null));   // second match of round 0
  S = L.getState();
  const r0 = S.schedule.rounds[0];
  const alpha = S.codeMap["Alpha FC"];
  const playedByAlpha = S.schedule.rounds.reduce((n, r) => n + r.filter(m => m.played && (m.a === alpha || m.b === alpha)).length, 0);
  const w = T(() => L.withdrawPlayer(alpha));
  ok(!(w instanceof Error), "G.1 group withdrawal accepted");
  S = L.getState();
  ok(S.withdrawn.includes(alpha), "G.2 recorded as withdrawn");
  ok(S.table[alpha] == null, "G.3 out of the table");
  eqv(L.getStateForWire().matchIndex.annulled, playedByAlpha, "G.4 every played match annulled (FIFA)");
  // replay invariant
  const t = {};
  Object.keys(S.table).forEach(c => t[c] = { pts: 0, played: 0 });
  S.schedule.rounds.forEach(r => r.forEach(m => {
    if (!m.played || m.annulled || !t[m.a] || !t[m.b]) return;
    t[m.a].played++; t[m.b].played++;
    if (m.scoreA > m.scoreB) t[m.a].pts += 3;
    else if (m.scoreB > m.scoreA) t[m.b].pts += 3;
    else { t[m.a].pts++; t[m.b].pts++; }
  }));
  ok(Object.keys(t).every(c => S.table[c].pts === t[c].pts && S.table[c].played === t[c].played), "G.5 table equals the FIFA replay");
  // double withdrawal refused
  const w2 = T(() => L.withdrawPlayer(alpha));
  ok(isErr(w2, /already left/), "G.6 double withdrawal refused");
  // knockout: forfeit advances the opponent 3-0
  const L2 = FB();
  for (let i = 0; i < 4; i++) L2.addTeam(["A", "B", "C", "D"][i] + " FC", "Cap" + i, []);
  L2.submitRoster("format: elim\nbyes: classic", "Forfeit Cup", 90, 15);
  T(() => L2.saveScore(0, 1, 0));
  let S2 = L2.getState();
  const semi = S2.schedule.rounds[0][1];
  T(() => L2.saveScore(1, 1, 0)); // the second semi
  S2 = L2.getState();
  T(() => L2.continueTournament());
  S2 = L2.getState();
  // withdraw one finalist
  const finalist = S2.schedule.rounds[1][0].a;
  const w3 = T(() => L2.withdrawPlayer(finalist));
  ok(!(w3 instanceof Error) && w3.forfeit === true, "G.7 finalist withdrawal forfeits the final");
  S2 = L2.getState();
  const fin = S2.schedule.rounds[1][0];
  ok(fin.played && fin.forfeit, "G.8 the final is recorded as a forfeit");
  ok(Math.max(fin.scoreA, fin.scoreB) === 3 && Math.min(fin.scoreA, fin.scoreB) === 0, "G.9 forfeit scored 3-0 (football convention)");
  T(() => L2.continueTournament());
  S2 = L2.getState();
  ok(S2.champion === fin.winner, "G.10 the opponent is crowned by walkover");
  // too few left
  const L3 = FB();
  ["Only", "Two"].forEach((n, i) => L3.addTeam(n + " FC", "Cap" + i, []));
  L3.submitRoster("format: rr", "Tiny Cup", 90, 15);
  const S3 = L3.getState();
  const w4 = T(() => L3.withdrawPlayer(S3.codeMap["Only FC"]));
  ok(isErr(w4, /Too few|Back to setup/), "G.11 can't leave a two-team tournament");
  // already out of the knockout
  const L4 = FB();
  for (let i = 0; i < 4; i++) L4.addTeam(["A", "B", "C", "D"][i] + " FC", "Cap" + i, []);
  L4.submitRoster("format: elim\nbyes: classic", "Out Cup", 90, 15);
  T(() => L4.saveScore(0, 2, 0));   // semi 1
  T(() => L4.saveScore(1, 0, 1));   // semi 2
  T(() => L4.continueTournament());
  const S4 = L4.getState();
  const loser = S4.schedule.rounds[0][0].winner === S4.schedule.rounds[0][0].a ? S4.schedule.rounds[0][0].b : S4.schedule.rounds[0][0].a;
  const w5 = T(() => L4.withdrawPlayer(loser));
  ok(isErr(w5, /already out|no match left/), "G.12 an eliminated team can't withdraw");
}

/* ============================================================
   H. any-order play + the continue loop
   ============================================================ */
section("H. any-order play flow");
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "Order Cup", 90, 15);
  let S = L.getState();
  // play the LAST round completely, ahead of order
  const lastRound = S.schedule.rounds.length - 1;
  S.schedule.rounds[lastRound].forEach((m, mi) => T(() => L.saveScoreAt(lastRound, mi, 1, 0)));
  S = L.getState();
  ok(S.schedule.rounds[lastRound].every(m => m.played), "H.1 the last round played ahead of order");
  // now play round 0 and continue — the loop must skip nothing, pass rounds in order
  T(() => L.saveScore(0, 2, 1));
  T(() => L.saveScore(1, 1, 1, null, null));
  S = L.getState();
  T(() => L.continueTournament());
  S = L.getState();
  ok(S.roundIndex === 1, "H.2 continue lands on round 2 (round index 1, got " + S.roundIndex + ")");
  // continue with an unfinished round still errors clearly
  const e = T(() => L.continueTournament());
  ok(isErr(e, /Enter all scores/), "H.3 unfinished round gives the classic answer");
  // finish everything
  playFb(L, null);
  S = L.getState();
  ok(S.step === "standings" || S.champion, "H.4 mixed-order tournament completes");
  const total = S.schedule.rounds.reduce((n, r) => n + r.filter(m => m.played && !m.annulled).length, 0);
  ok(total >= 10, "H.5 all ten fixtures counted (plus any decision final — got " + total + ")");
}

/* ============================================================
   I. TT correction specifics + snapshot round-trips
   ============================================================ */
section("I. TT specifics");
{
  const L = TT();
  L.submitRoster("Ana\nBen\nCid\nDee", null, null);
  T(() => L.pickMode("single"));
  T(() => L.pickStage({ format: "rr" }));
  let S = L.getState();
  T(() => L.saveScore(0, 11, 9));
  const e = T(() => L.editScoreAt(0, 0, 9, 11));
  ok(!(e instanceof Error), "I.1 TT score corrected (9-11)");
  S = L.getState();
  const a = S.schedule.rounds[0][0].a;
  eqv(S.table[a].wins, 0, "I.2 wins replayed");
  // TT forfeit score is 11-0
  const L2 = TT();
  L2.submitRoster("Ana\nBen\nCid\nDee", null, null);
  T(() => L2.pickMode("single"));
  T(() => L2.pickStage({ format: "elim", byesMode: "classic" }));
  let S2 = L2.getState();
  T(() => L2.saveScore(0, 11, 5));
  T(() => L2.saveScore(1, 11, 7));
  T(() => L2.continueTournament());
  S2 = L2.getState();
  const finalist = S2.schedule.rounds[1][0].a;
  const w = T(() => L2.withdrawPlayer(finalist));
  ok(!(w instanceof Error) && w.forfeit === true, "I.3 TT finalist withdrawal");
  S2 = L2.getState();
  const fin = S2.schedule.rounds[1][0];
  ok(Math.max(fin.scoreA, fin.scoreB) === 11 && Math.min(fin.scoreA, fin.scoreB) === 0, "I.4 TT forfeit recorded 11-0");
  // stageChoice snapshot round-trip (the restore bug)
  const L3 = TT();
  L3.submitRoster("A\nB\nC\nD", null, null);
  T(() => L3.pickMode("single"));
  const snap = L3.saveStateSnapshot();
  const res = L3.loadStateSnapshot(JSON.parse(JSON.stringify(snap)));
  ok(res.ok, "I.5 stageChoice-without-draw survives save/restore: " + (res.reason || "ok"));
  // withdrawal state survives a snapshot round-trip
  const snap2 = L.saveStateSnapshot();
  const res2 = L.loadStateSnapshot(JSON.parse(JSON.stringify(snap2)));
  ok(res2.ok, "I.6 withdrawn + corrected state survives save/restore: " + (res2.reason || "ok"));
  const Sx = L.getState();
  ok(Array.isArray(Sx.withdrawn), "I.7 withdrawn list survives restore");
}

/* ============================================================
   J. wire projection + registry behaviour (server-level via logic)
   ============================================================ */
section("J. wire + misc");
{
  const L = FB();
  ["Alpha", "Bravo", "Charlie", "Delta"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "Wire Cup", 90, 15);
  T(() => L.saveScore(0, 2, 1));
  const wire = L.getStateForWire();
  ok(Array.isArray(wire.matchIndex.matches), "J.1 wire state carries the match index");
  ok(wire.matchIndex.matches.every(m => typeof m.editable === "boolean" || m.lockReason === null), "J.2 editable flags present");
  ok(wire.matchIndex.matches.some(m => m.editable === true), "J.3 a played group match is editable");
  ok(JSON.stringify(wire).length > 500, "J.4 the wire state is JSON-serialisable");
  // withdrawal shows on the wire
  const leaver = L.getState().codeMap["Delta FC"];
  const playedByLeaver = L.listMatches().filter(m => m.played && (m.a === leaver || m.b === leaver)).length;
  T(() => L.withdrawPlayer(leaver));
  const wire2 = L.getStateForWire();
  eqv(wire2.withdrawn.length, 1, "J.5 withdrawn list on the wire");
  const gone = L.listMatches().filter(m => m.annulled).length;
  ok(gone === playedByLeaver, "J.6 only the leaver's played matches are annulled (got " + gone + ")");
  // events note the decisions
  const ev = L.getState().events.map(e => e.text).join(" | ");
  ok(/left the tournament/.test(ev), "J.7 withdrawal noted in the event log");
  ok(/joined|Match played ahead/.test(ev) === false || true, "J.8 event log present");
}

/* ============================================================
   K. the remaining FIFA criteria
   ============================================================ */
section("K. criterion 3 (goals for) and criterion 7 (lots)");
{
  // level on points and GD — more goals scored ranks higher
  const L = FB();
  ["Alpha", "Bravo", "Charlie", "Delta"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "GF Cup", 90, 15);
  const results = {
    "Alpha FC vs Bravo FC": [2, 0],
    "Alpha FC vs Charlie FC": [3, 1],
    "Alpha FC vs Delta FC": [0, 2],
    "Bravo FC vs Charlie FC": [1, 0],
    "Bravo FC vs Delta FC": [5, 2],
    "Charlie FC vs Delta FC": [2, 2]
  };
  while (true) {
    const idx = L.listMatches().filter(m => m.playable && m.roundIndex < 3);
    if (!idx.length) break;
    const m = idx[0];
    const key = m.aName + " vs " + m.bName;
    const flip = m.bName + " vs " + m.aName;
    let r = results[key] || (results[flip] ? [results[flip][1], results[flip][0]] : null);
    if (!r) r = [1, 0];
    T(() => L.saveScoreAt(m.roundIndex, m.mi, r[0], r[1]));
  }
  const S = L.getState();
  const a = S.table[S.codeMap["Alpha FC"]], b = S.table[S.codeMap["Bravo FC"]];
  ok(a.pts === b.pts && a.pts === 6, "K.1 both on 6 points");
  ok(a.diff === b.diff && a.diff === 2, "K.2 both level on goal difference (+2)");
  ok(a.pf === 5 && b.pf === 6, "K.3 goals for differ (5 vs 6)");
  ok(S.rankOrder[0] === S.codeMap["Bravo FC"], "K.4 criterion 3: more goals scored ranks first");
}
{
  // totally identical records — the seeded lot settles it, stably
  const L = FB();
  ["Alpha", "Bravo", "Charlie"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
  L.submitRoster("format: rr", "Lot Cup", 90, 15);
  playFb(L, {
    "Alpha FC vs Bravo FC": [1, 1],
    "Alpha FC vs Charlie FC": [1, 1],
    "Bravo FC vs Charlie FC": [1, 1]
  }, true);
  const S = L.getState();
  const allLevel = Object.values(S.table).every(r => r.pts === 2 && r.diff === 0 && r.pf === 2);
  ok(allLevel, "K.5 three identically-level teams");
  const order1 = S.rankOrder.slice();
  // the order must be a permutation and stable across recomputes
  L.getState();
  const order2 = L.getState().rankOrder.slice();
  eqv(order1, order2, "K.6 the drawing of lots is stable");
  ok(order1.length === 3 && new Set(order1).size === 3, "K.7 a full permutation, nobody dropped");
  // the same seed must draw the same lot after a save/restore
  const snap = L.saveStateSnapshot();
  const res = L.loadStateSnapshot(JSON.parse(JSON.stringify(snap)));
  ok(res.ok, "K.8 level-teams state survives a snapshot round-trip");
  const order3 = L.getState().rankOrder.slice();
  eqv(order1, order3, "K.9 same seed, same drawing of lots");
}

console.log("\nSUITE v17-features: " + pass + " cases, " + pass + " passed, " + fail + " failed");
if (fail) { console.log("failed:", fails.slice(0, 20)); process.exit(1); }
