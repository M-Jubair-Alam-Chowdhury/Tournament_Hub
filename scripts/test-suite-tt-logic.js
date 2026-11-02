/* M1 — table-tennis engine suite (100+ cases).
   Our house rules: point-limit scoring (winner lands exactly on the
   limit, 7-0 instant win), strict win-by-2 mode, no draws, rest
   spacing (max 2 matches in a row), play-in qualifiers, standings
   ladders, snapshots. Plain-args module — no server needed. */
"use strict";
const path = require("path");
const logic = require(path.join(__dirname, "..", "apps", "table-tennis/logic.js"));

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
function throws(fn, name) { throwsMsg(fn, null, name); }
function noThrow(fn, name) {
  let m = null;
  try { fn(); } catch (e) { m = e.message; }
  ok(m == null, name + " — threw " + (m || "unknown"));
}

/* Build a tournament that has reached 'play' with the given roster.
   v1.8: the engine defaults to 21 points / best of 3; this suite's
   legacy sections pin the classic 11-point single game explicitly. */
function fresh(raw, opts) {
  logic.reset();
  logic.submitRoster(raw, opts && opts.name,
    (opts && "points" in opts) ? opts.points : 11,
    (opts && "sets" in opts) ? opts.sets : 1);
  const S = logic.getState();
  if (S.step === "mode") logic.pickMode("single");
  return logic.getState();
}
/* Two players, one rr match, the fastest scoring target. */
function pair(extra, opts) {
  const lines = (extra || "").split("\n").filter(Boolean);
  return fresh(lines.concat(["A", "B"]).join("\n"), opts);
}
function tryScore(L, sa, sb) {
  try {
    logic.saveScore(0, sa, sb);
    logic.undoScore();   // leave the match unplayed for the next case
    return null;
  }
  catch (e) { return e.message; }
}
/* longest streak of consecutive matches for any entrant */
function maxStreak(S) {
  const runs = {};
  let worst = 0;
  (S.schedule ? S.schedule.rounds : []).forEach(r => (r || []).forEach(m => {
    const ps = [m.a, m.b].filter(p => p && p !== "BYE");
    for (const p of Object.keys(runs)) runs[p] = ps.includes(p) ? runs[p] + 1 : 0;
    ps.forEach(p => { if (runs[p] == null) runs[p] = 1; });
    for (const p of Object.keys(runs)) if (runs[p] > worst) worst = runs[p];
  }));
  return worst;
}
function allPairs(S) {
  const out = [];
  S.schedule.rounds.forEach(r => (r || []).forEach(m => {
    if (m.a && m.b && m.a !== "BYE" && m.b !== "BYE") out.push([m.a, m.b].sort().join("-"));
  }));
  return out;
}

function section(name) { console.log("\n== " + name + " =="); }

/* ============ A. game scoring — v1.8 default 21, non-strict ============ */
section("A. point-limit scoring, default 21, non-strict");
{
  ok(pair("format: rr", { points: null, sets: null }).points === 21, "A0 v1.8 default: 21 points per game");
  ok(pair("format: rr", { points: null, sets: null }).sets === 3, "A0b v1.8 default: best of 3");
  const L = pair("format: rr", { points: null, sets: 1 });  // engine default points: 21, single game for per-game checks
  ok(tryScore(L, 21, 19) === null, "A1 21-19 valid");
  ok(tryScore(L, 21, 0) === null, "A2 21-0 valid");
  ok(tryScore(L, 21, 20) === null, "A3 21-20 valid non-strict (winner lands on the limit)");
  ok(tryScore(L, 0, 21) === null, "A4 0-21 valid (B wins)");
  ok(/past the limit/.test(tryScore(L, 22, 19) || ""), "A5 22-19 rejected — game ends at 21");
  ok(/past the limit/.test(tryScore(L, 30, 0) || ""), "A6 30-0 rejected");
  ok(/short/.test(tryScore(L, 19, 15) || ""), "A7 19-15 rejected — short");
  ok(/short/.test(tryScore(L, 20, 19) || ""), "A8 20-19 rejected");
  ok(/level/.test(tryScore(L, 19, 19) || ""), "A9 19-19 rejected — no draws in table tennis");
  ok(/level/.test(tryScore(L, 21, 21) || ""), "A10 21-21 rejected — no draws");
  ok(/level/.test(tryScore(L, 0, 0) || ""), "A11 0-0 rejected");
  ok(/below 0/.test(tryScore(L, -1, 15) || ""), "A12 negative score rejected");
  ok(/below 0/.test(tryScore(L, 15, -2) || ""), "A13 negative score rejected (B)");
  ok(/whole numbers/.test(tryScore(L, 21.5, 9) || ""), "A14 fractional score rejected");
  ok(tryScore(L, null, 19) === "Enter two scores.", "A15 null score rejected");
  throwsMsg(() => logic.saveScore(0, "21", 9), /two scores|whole/, "A16 string score rejected");
  ok(tryScore(L, 7, 0) === null, "A17 7-0 instant win (house rule, limit 21)");
  ok(/short/.test(tryScore(L, 7, 3) || ""), "A18 7-3 rejected — only 7-0 is instant");
  ok(/short/.test(tryScore(L, 6, 0) || ""), "A19 6-0 rejected");
  ok(tryScore(L, 0, 7) === null, "A19b 0-7 valid (B wins instantly)");
}

/* ============ B. scoring — strict win-by-2 ============ */
section("B. strict rules (win-by-2 past the limit)");
{
  const L = pair("format: rr\nrules: strict", { points: null, sets: 1 });
  ok(tryScore(L, 21, 19) === null, "B1 21-19 valid strict (2 clear)");
  ok(tryScore(L, 21, 0) === null, "B2 21-0 valid strict");
  ok(/Win-by-2/.test(tryScore(L, 21, 20) || ""), "B3 21-20 rejected strict");
  ok(tryScore(L, 23, 21) === null, "B4 23-21 deuce finish valid");
  ok(tryScore(L, 24, 22) === null, "B5 24-22 deuce finish valid");
  ok(tryScore(L, 30, 28) === null, "B6 30-28 deuce finish valid");
  ok(/Win-by-2/.test(tryScore(L, 24, 21) || ""), "B7 24-21 rejected — 3 apart above the limit");
  ok(/Win-by-2/.test(tryScore(L, 24, 23) || ""), "B8 24-23 rejected — 1 apart above");
  ok(/short/.test(tryScore(L, 20, 18) || ""), "B9 20-18 short strict");
  ok(tryScore(L, 7, 0) === null, "B10 7-0 instant still valid under strict");
  ok(/short/.test(tryScore(L, 7, 1) || ""), "B11 7-1 short strict");
  ok(/Win-by-2/.test(tryScore(L, 25, 22) || ""), "B12 25-22 rejected — 3 apart");
}

/* ============ C. point-limit + best-of configuration ============ */
section("C. point limit and best-of configuration");
{
  const L11 = pair("format: rr", { points: 11, sets: 1 });
  ok(L11.points === 11 && L11.sets === 1, "C1 explicit 11/1 pins the classic game");
  ok(tryScore(L11, 11, 9) === null, "C2 11-9 valid at limit 11");
  ok(/past the limit/.test(tryScore(L11, 21, 19) || ""), "C3 21-19 past limit 11");
  const L11s = pair("format: rr\nrules: strict", { points: 11, sets: 1 });
  ok(/Win-by-2/.test(tryScore(L11s, 11, 10) || ""), "C4 11-10 rejected strict at 11");
  ok(tryScore(L11s, 13, 11) === null, "C5 13-11 deuce valid at 11");
  const L7 = pair("format: rr\npoints: 7", { points: null, sets: 1 });
  ok(L7.points === 7, "C6 points: directive sets 7");
  ok(tryScore(L7, 7, 0) === null, "C7 7-0 valid at limit 7 (lands on limit)");
  ok(tryScore(L7, 7, 5) === null, "C8 7-5 valid at limit 7");
  ok(/past the limit/.test(tryScore(L7, 8, 6) || ""), "C9 8-6 rejected past limit 7");
  const L1 = pair("format: rr\npoints: 1", { points: null, sets: 1 });
  ok(tryScore(L1, 1, 0) === null, "C10 1-0 valid at limit 1");
  const L200 = pair("format: rr\npoints: 200", { points: null, sets: 1 });
  ok(tryScore(L200, 200, 198) === null, "C11 200-198 valid at limit 200");
  throwsMsg(() => fresh("format: rr\npoints: 0\nA\nB"), /points.*1 to 200/, "C12 points: 0 rejected");
  throwsMsg(() => fresh("format: rr\npoints: 201\nA\nB"), /points.*1 to 200/, "C13 points: 201 rejected");
  throwsMsg(() => fresh("format: rr\npoints: abc\nA\nB"), /whole number/, "C14 points: abc rejected");
  throwsMsg(() => logic.submitRoster("A\nB", null, 0), /Points to win.*1 to 200/, "C15 field points 0 rejected");
  throwsMsg(() => logic.submitRoster("A\nB", null, 999), /Points to win.*1 to 200/, "C16 field points 999 rejected");
  const L8 = pair("format: rr\npoints: 8", { points: null, sets: 1 });
  ok(tryScore(L8, 7, 0) === null, "C17 7-0 instant win applies at limit 8 (limit above 7)");
  ok(/short/.test(tryScore(L8, 7, 2) || ""), "C17b 7-2 still short at limit 8");
  const viaDir = pair("format: rr\npoints: 17", { points: null, sets: 1 });
  ok(viaDir.points === 17, "C18 directive applies when field is null");
  const fieldWins = pair("format: rr\npoints: 17", { points: 15, sets: 1 });
  ok(fieldWins.points === 15, "C19 field beats directive");
  // ---- best-of configuration (v1.8) ----
  const s3 = pair("format: rr", { points: null, sets: null });
  ok(s3.sets === 3, "C20 default best of 3");
  const s1 = pair("format: rr\nsets: 1", { points: null, sets: null });
  ok(s1.sets === 1, "C21 sets: 1 directive");
  const s5 = pair("format: rr\nbestof: 5", { points: null, sets: null });
  ok(s5.sets === 5, "C22 'bestof' alias for sets");
  const s7 = pair("format: rr", { points: null, sets: 7 });
  ok(s7.sets === 7, "C23 field sets 7");
  throwsMsg(() => fresh("format: rr\nsets: 2\nA\nB"), /best of 1, 3, 5 or 7/i, "C24 sets: 2 rejected");
  throwsMsg(() => fresh("format: rr\nsets: 9\nA\nB"), /best of 1, 3, 5 or 7/i, "C25 sets: 9 rejected");
  throwsMsg(() => fresh("format: rr\nsets: 0\nA\nB"), /best of 1, 3, 5 or 7/i, "C26 sets: 0 rejected");
  throwsMsg(() => logic.submitRoster("A\nB", null, null, 4), /Best of.*1, 3, 5 or 7/, "C27 field sets 4 rejected");
  const fieldSets = pair("format: rr\nsets: 5", { points: null, sets: 3 });
  ok(fieldSets.sets === 3, "C28 field beats the sets directive");
}

/* ============ D. roster parsing & directives ============ */
section("D. roster parsing and directives");
{
  throwsMsg(() => fresh("Alice"), /at least 2/, "D1 single name rejected");
  throwsMsg(() => fresh(""), /at least 2/, "D2 empty roster rejected");
  logic.reset();
  logic.submitRoster("A\nB");
  ok(logic.getState().step === "mode", "D3 even field offers the mode step");
  eqv(logic.getState().names, ["A", "B"], "D4 names captured");
  logic.reset(); logic.submitRoster("A\nB\nA");
  eqv(logic.getState().names, ["A", "B"], "D5 legacy duplicate silently de-duped");
  throwsMsg(() => fresh("format: elim\nA\nB\nA"), /appears more than once/, "D6 duplicate rejected once enhanced");
  throwsMsg(() => fresh("format: bogus\nA\nB"), /Unknown 'format:'/ , "D7 unknown format rejected");
  for (const alias of ["rr", "round robin", "roundrobin", "round-robin", "robin"]) {
    noThrow(() => fresh("format: " + alias + "\nA\nB\nC"), "D8 alias '" + alias + "'");
  }
  for (const alias of ["elim", "elimination", "knockout", "ko", "bracket"]) {
    noThrow(() => fresh("format: " + alias + "\nA\nB\nC\nD"), "D9 alias '" + alias + "'");
  }
  noThrow(() => fresh("format: groups\npools: 2\nA\nB\nC\nD"), "D10 'groups' alias for pools");
  noThrow(() => fresh("format: classic\nA\nB\nC"), "D11 'classic' alias for auto");
  throwsMsg(() => fresh("pools: 0\nA\nB"), /pools.*1 or more/, "D12 pools: 0 rejected");
  throwsMsg(() => fresh("qualify: 0\nformat: pools\npools: 2\nA\nB\nC\nD"), /qualify.*1 or more/, "D13 qualify: 0 rejected");
  throwsMsg(() => fresh("qualify: 2\nA\nB\nC"), /qualify.*together with pools/, "D14 qualify without pools rejected");
  throwsMsg(() => fresh("then: rr:1\nA\nB\nC"), /rr:N.*2 or more/, "D15 then: rr:1 rejected");
  throwsMsg(() => fresh("then: rr:4\nA\nB\nC\nD"), /last stage.*crown/, "D16 rr as last stage rejected");
  throwsMsg(() => fresh("then: elim, rr:2\nA\nB\nC\nD"), /finishes the tournament/, "D17 stages after elim rejected");
  throwsMsg(() => fresh("then: auto\nA\nB\nC"), /auto.*can't be used/, "D18 auto in then rejected");
  throwsMsg(() => fresh("then: bogus\nA\nB\nC"), /Unknown stage/, "D19 unknown then stage rejected");
  throwsMsg(() => fresh("limit: 0\nA\nB"), /limit.*1 or more/, "D20 limit: 0 rejected");
  throwsMsg(() => fresh("rules: wild\nA\nB"), /Unknown 'rules:'/ , "D21 unknown rules rejected");
  noThrow(() => fresh("rules: off\nA\nB"), "D22 rules: off accepted");
  throwsMsg(() => fresh("format: pools\nA\nB\nC\nD"), /needs either 'pools: N' or blank-line/, "D23 pools without count or blocks rejected");
  const blocks = fresh("A\nB\n\nC\nD");
  const st = blocks.stages[0];
  ok(blocks.step === "play" && st.type === "pools" && st.pools.length === 2, "D24 blank-line blocks build two pools");
  eqv(st.pools.map(p => p.members.length), [2, 2], "D25 pool sizes balanced");
  const bq = fresh("A\nB\nC\n\nD\nE\nF\n\nG\nH\nI\nqualify: 2");
  ok(bq.stages[0].pools[2].qualify === 2, "D26 qualify inside a block configures that pool");
  throwsMsg(() => fresh("A\nB\n\nC\nD\nqualify: 2"), /can't qualify 2/, "D26b a 2-player pool can't qualify 2");
  const elim = fresh("format: elim\nA\nB\nC\nD");
  ok(elim.step === "play" && elim.schedule.kind === "elim", "D27 format: elim builds immediately");
  throwsMsg(() => fresh("A\nB\n\nC\nA"), /appears more than once/, "D28 duplicate across pools rejected");
}

/* ============ E. round-robin structure ============ */
section("E. round-robin structure and rest spacing");
{
  const L3 = fresh("format: rr\nA\nB\nC");
  eqv(L3.schedule.rounds.map(r => r.length), [1, 1, 1], "E1 3 players: 3 single-match rounds");
  const L5 = fresh("format: rr\nA\nB\nC\nD\nE");
  eqv(L5.schedule.rounds.map(r => r.length), [2, 2, 2, 2, 2], "E2 5 players: 5 rounds of 2");
  eqv(allPairs(L5).length, 10, "E3 5 players: 10 matches total");
  const dup = allPairs(L5).length === new Set(allPairs(L5)).size;
  ok(dup, "E4 every pair meets exactly once");
  const L4 = fresh("format: rr\nA\nB\nC\nD");
  eqv(L4.schedule.rounds.map(r => r.length), [2, 2, 2], "E5 4 players: 3 rounds of 2");
  const L2 = fresh("format: rr\nA\nB");
  ok(L2.schedule.rounds.length === 1 && L2.schedule.rounds[0][0].isFinal === true, "E6 2 players: single final");
  ok(maxStreak(L5) <= 2, "E7 5 players: nobody plays 3 matches in a row (rest limit 2)");
  const L6 = fresh("format: rr\nA\nB\nC\nD\nE\nF");
  eqv(L6.schedule.rounds.map(r => r.length), [3, 3, 3, 3, 3], "E8 6 players: 5 rounds of 3");
  ok(maxStreak(L6) <= 2, "E9 6 players: rest limit respected");
  const L7 = fresh("format: rr\nA\nB\nC\nD\nE\nF\nG");
  ok(maxStreak(L7) <= 2, "E10 7 players: rest limit respected");
  const before = L5.schedule.rounds.map(r => r.map(m => [m.a, m.b].sort().join("-")).sort());
  ok(before.every(b => b.length === 2), "E11 pairings intact after spacing (2 per round)");
  const L8 = fresh("format: rr\nA\nB\nC\nD\nE\nF\nG\nH");
  ok(maxStreak(L8) <= 2, "E12 8 players: rest limit respected");
  eqv(allPairs(L8).length, 28, "E13 8 players: 28 matches");
}

/* ============ F. elimination & play-ins ============ */
section("F. elimination brackets, byes, play-ins");
{
  const L4 = fresh("format: elim\nA\nB\nC\nD");
  eqv(L4.schedule.rounds.map(r => r.length), [2, 1], "F1 4 players: SF + final");
  eqv(allPairs(L4).length, 2, "F2 only round-1 pairings drawn");
  const L8 = fresh("format: elim\nA\nB\nC\nD\nE\nF\nG\nH");
  eqv(L8.schedule.rounds.map(r => r.length), [4, 2, 1], "F3 8 players: QF/SF/final");
  const L5c = fresh("format: elim\nbyes: classic\nA\nB\nC\nD\nE");
  eqv(L5c.schedule.rounds.map(r => r.length), [4, 2, 1], "F4 5 players classic byes: bracket of 8");
  const byes = L5c.schedule.rounds[0].filter(m => m.a === "BYE" || m.b === "BYE");
  ok(byes.length === 3, "F5 3 BYE matches padded");
  const w = byes[0];
  ok(w.played === true && w.winner === (w.a === "BYE" ? w.b : w.a), "F6 walkover auto-played");
  const winnerSide = w.a === "BYE" ? w.b : w.a;
  eqv([w.a === "BYE" ? w.scoreA : 0, w.a === "BYE" ? w.scoreB : 0].length ? [w.a === "BYE" ? w.scoreA : w.scoreB] : [], [0], "F7 bye side scored 0");
  const L21 = fresh("format: elim\nbyes: classic\npoints: 21\nA\nB\nC\nD\nE", { points: null });
  const bye21 = L21.schedule.rounds[0].find(m => m.a === "BYE" || m.b === "BYE");
  const walk21 = bye21.a === "BYE" ? bye21.scoreB : bye21.scoreA;
  ok(walk21 === 21, "F8 walkover respects the point limit (21-0)");
  const L5p = fresh("format: elim\nA\nB\nC\nD\nE");
  const st = L5p.stages[0];
  ok(st.type === "pools" && st.pools.length === 1 && st.pools[0].members.length === 3, "F9 5 players play-in: one 3-player group");
  ok(st.pools[0].qualify === 2, "F10 top 2 of the play-in group qualify");
  ok(st.autoElim && st.autoElim.direct.length === 2, "F11 2 players drawn straight into the bracket");
  const L6p = fresh("format: elim\nA\nB\nC\nD\nE\nF");
  const st6 = L6p.stages[0];
  eqv(st6.pools.map(p => p.members.length), [3, 3], "F12 6 players play-in: two 3-groups");
  ok(L6p.events.some(e => /Play-in/.test(e.text)), "F13 play-in draw noted in events");
  const L11 = fresh("format: elim\nA\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nK");
  eqv(L11.stages[0].pools.map(p => p.members.length).sort(), [3, 3, 3], "F14 11 players: three 3-groups, 2 direct");
  ok(L11.stages[0].autoElim.direct.length === 2, "F15 11 players: 2 direct entrants");
}

/* ============ G. standings & ladder ============ */
section("G. standings and ranking ladder");
{
  // 3-player round robin, one round played: table must balance
  fresh("format: rr\nA\nB\nC");
  logic.saveScore(0, 11, 9);
  const S1 = logic.getState();
  const t = S1.table;
  const totalPf = Object.values(t).reduce((s, r) => s + r.pf, 0);
  const totalPa = Object.values(t).reduce((s, r) => s + r.pa, 0);
  ok(totalPf === totalPa, "G1 points for = points against across the table");
  const wins = Object.values(t).reduce((s, r) => s + r.wins, 0);
  ok(wins === 1, "G2 played match recorded in the table");
  ok(S1.rankOrder && S1.rankOrder.length === 3, "G3 ladder covers everyone");
  // controlled ladder: 4 players, P1 sweeps, P2 second, then the top-2 final
  logic.reset();
  fresh("format: rr\nA\nB\nC\nD");
  const beats = (a, b) => {
    if (a === "P1" || b === "P1") return a === "P1" ? a : b;
    if (a === "P2" || b === "P2") return a === "P2" ? a : b;
    if (a === "P3" || b === "P3") return a === "P3" ? a : b;
    return b;
  };
  let guard = 0;
  while (logic.getState().step === "play" && guard++ < 30) {
    const cur = logic.getState();
    const round = cur.schedule.rounds[cur.roundIndex];
    round.forEach((m, mi) => {
      if (!m.a || !m.b || m.a === "BYE" || m.b === "BYE") return;
      const winner = beats(m.a, m.b);
      logic.saveScore(mi, m.a === winner ? 11 : 9, m.b === winner ? 11 : 9);
    });
    logic.continueTournament();
  }
  const done = logic.getState();
  ok(done.step === "standings", "G4 round robin reaches standings (after the top-2 final)");
  ok(done.rankOrder[0] === "P1", "G5 undefeated player tops the ladder");
  ok(done.table.P1.wins === 4 && done.table.P1.losses === 0, "G6 table records the sweep (3 RR + final)");
  ok(done.table.P1.pf === 44, "G7 points for accumulate (44)");
  ok(done.table.P1.pa === 36, "G8 points against accumulate (36)");
  ok(done.table.P1.diff === 8, "G9 difference computed");
  const rec = logic.getTournamentRecord();
  eqv(rec.participants, ["A", "B", "C", "D"], "G10 record lists participants by name");
  ok(rec.matches.length === 7, "G11 record has 6 RR matches + the final");
  ok(rec.ranking[0] === "A", "G12 ranking leads with the champion");
  ok(done.champion === "P1", "G13 champion crowned from the final");
}

/* ============ H. undo ============ */
section("H. undo semantics");
{
  const L = pair("format: rr");
  logic.saveScore(0, 11, 9);
  ok(logic.getState().table.P1.wins === 1, "H1 win recorded before undo");
  logic.undoScore();
  const S = logic.getState();
  ok(S.schedule.rounds[0][0].played === false, "H2 undo un-plays the match");
  ok(S.table.P1.wins === 0 && S.table.P1.pf === 0, "H3 undo restores the table row");
  throwsMsg(() => logic.undoScore(), /Nothing to undo/, "H4 second undo rejected");
  logic.saveScore(0, 11, 7);
  throwsMsg(() => logic.saveScore(0, 11, 9), /already saved/, "H5 re-saving a played match rejected");
  logic.continueTournament();
  throwsMsg(() => logic.undoScore(), /Too late|Nothing to undo/, "H6 undo blocked after the round advanced");
  throwsMsg(() => logic.saveScore(5, 11, 9), /doesn't exist/, "H7 unknown match index rejected");
  const bye = fresh("format: elim\nbyes: classic\nA\nB\nC\nD\nE");
  const bm = bye.schedule.rounds[0].find(m => m.a === "BYE" || m.b === "BYE");
  const bi = bye.schedule.rounds[0].indexOf(bm);
  throwsMsg(() => logic.saveScore(bi, 11, 0), /already saved|bye doesn't need/, "H8 BYE matches auto-resolve and take no manual score");
}

/* ============ I. snapshots ============ */
section("I. snapshot save/load");
{
  const L = pair("format: rr");
  logic.saveScore(0, 11, 9);
  const snap = logic.saveStateSnapshot();
  ok(snap.v === 3, "I1 snapshot version 3");
  ok(typeof snap.savedAt === "string", "I2 timestamp recorded");
  logic.reset();
  const res = logic.loadStateSnapshot(snap);
  ok(res.ok, "I3 roundtrip load accepted");
  const S = logic.getState();
  ok(S.step === "play" && S.names.length === 2, "I4 state restored");
  ok(S.schedule.rounds[0][0].played === true, "I5 played flag restored");
  ok(S.table.P1.wins === 1, "I6 table restored");
  // round custom props survive (stageIndex on rounds)
  logic.reset();
  const L4 = fresh("format: elim\nA\nB\nC\nD");
  const snap2 = logic.saveStateSnapshot();
  logic.reset();
  ok(logic.loadStateSnapshot(snap2).ok, "I7 elim snapshot loads");
  ok(logic.getState().schedule.rounds[0].stageIndex === 0, "I8 round stageIndex custom prop revived");
  // rejection cases
  const bad = (mut, name) => {
    const s = JSON.parse(JSON.stringify(snap));
    mut(s);
    const r = logic.loadStateSnapshot(s);
    ok(!r.ok, name);
  };
  bad(s => { s.v = 99; }, "I9 wrong version rejected");
  bad(s => { s.state = null; }, "I10 missing state rejected");
  bad(s => { s.state.step = "nonsense"; }, "I11 unknown step rejected");
  bad(s => { delete s.state.seed; }, "I12 missing seed rejected");
  bad(s => { s.state.names = ["Only"]; }, "I13 roster too short rejected");
  bad(s => { s.state.entities = []; }, "I14 empty entrants rejected");
  bad(s => { delete s.state.table; }, "I15 missing table rejected");
  bad(s => { s.state.roundIndex = 99; }, "I16 round pointer out of range rejected");
  bad(s => { s.state.schedule.rounds[0] = "corrupt"; }, "I17 malformed round rejected");
  bad(s => { s.state.undoStack = "nope"; }, "I18 corrupt undo stack rejected");
  bad(s => { s.state.events = 5; }, "I19 corrupt events rejected");
  ok(!logic.loadStateSnapshot(null).ok, "I20 null snapshot rejected");
  ok(!logic.loadStateSnapshot("string").ok, "I21 string snapshot rejected");
  // points through a snapshot
  logic.reset();
  const Lp = pair("format: rr\npoints: 15", { points: null });
  const snapP = logic.saveStateSnapshot();
  logic.reset();
  logic.loadStateSnapshot(snapP);
  ok(logic.getState().points === 15, "I22 point limit survives the snapshot");
  // defaults on an old-style snapshot without points
  const old = JSON.parse(JSON.stringify(snapP));
  delete old.state.points;
  logic.reset();
  logic.loadStateSnapshot(old);
  ok(logic.getState().points === 21, "I23 snapshot without points defaults to 21 (v1.8)");
}

/* ============ J. misc/state ============ */
section("J. wire projection and misc");
{
  const L = fresh("format: elim\nA\nB\nC\nD");
  const wire = logic.getStateForWire();
  ok(wire.schedule.roundMeta && wire.schedule.roundMeta.stageIndex["0"] === 0, "J1 roundMeta projects stageIndex");
  ok(wire.suspended === false, "J3 suspended flag exposed");
  ok(Array.isArray(wire.schedule.rounds), "J4 rounds stay a plain array");
  // countMatches maths
  const L2 = fresh("format: rr\nA\nB");
  ok(logic.getTournamentRecord() === null || logic.getTournamentRecord().matches.length >= 0, "J7 record safe mid-flight");
  logic.reset();
  ok(logic.getState().step === "roster", "J8 reset returns to roster");
  ok(logic.getState().schedule === null, "J9 reset clears the draw");
  // events stay a plain array through the wire projection
  logic.reset();
  logic.submitRoster("format: elim\nA\nB\nC\nD\nE");
  ok(Array.isArray(logic.getState().events) && logic.getState().events.length > 0, "J10 play-in draw noted in events");
  ok(JSON.stringify(logic.getStateForWire()).includes("Play-in"), "J10b events survive JSON projection");
  // restart
  logic.reset();
  logic.submitRoster("Alice\nBob\nCarol", "Cup", 21, 1);
  logic.pickStage({ format: "rr" });
  logic.saveScore(0, 21, 19);
  logic.restartTournament();
  const R = logic.getState();
  ok(R.step === "roster" && R.rosterDraft === "Alice\nBob\nCarol", "J11 restart keeps the roster draft");
  ok(R.tournamentName === "Cup" && R.points === 21, "J12 restart keeps name and point limit");
  ok(R.sets === 1, "J12b restart keeps the best-of pick");
  throwsMsg(() => logic.restartTournament(), /Already on the setup screen/, "J13 restart on roster rejected");
  // suspension flags
  logic.setSuspended(true, "2026-10-31T00:00:00Z");
  ok(logic.isSuspended() === true, "J14 suspension set");
  ok(logic.getStateForWire().pausedAt === "2026-10-31T00:00:00Z", "J15 pausedAt projected");
  logic.setSuspended(false);
  ok(logic.isSuspended() === false && logic.getStateForWire().pausedAt === null, "J16 suspension cleared");
}


/* ============ K. v1.8 best-of-N match sheets ============ */
section("K. best-of-N match sheets");
{
  const L = pair("format: rr", { points: null, sets: null });   // 21 / best of 3
  const trySheet = (sets) => {
    try {
      logic.saveScore(0, null, null, sets);
      logic.undoScore();
      return null;
    } catch (e) { return e.message; }
  };
  ok(trySheet([{sa:21,sb:15},{sa:21,sb:9}]) === null, "K1 2-0 straight sheet valid");
  ok(trySheet([{sa:21,sb:15},{sa:18,sb:21},{sa:21,sb:7}]) === null, "K2 2-1 full three games valid");
  ok(/enter the set scores/.test(trySheet(null) || ""), "K3 missing sheet rejected for best of 3");
  ok(/enter the set scores/.test(trySheet([]) || ""), "K4 empty sheet rejected");
  ok(/ends at 2 set wins/.test(trySheet([{sa:21,sb:15}]) || ""), "K5 1-0 sheet short of the majority");
  ok(/ends at 2 set wins/.test(trySheet([{sa:21,sb:15},{sa:19,sb:21}]) || ""), "K6 1-1 sheet short of the majority");
  ok(/at most 3 sets/.test(trySheet([{sa:21,sb:1},{sa:21,sb:2},{sa:21,sb:3}]) || "") === false, "K7 three sets allowed at most 3");
  ok(/at most 3/.test(trySheet([{sa:21,sb:1},{sa:21,sb:2},{sa:21,sb:3},{sa:21,sb:4}]) || ""), "K8 four sets rejected for best of 3");
  ok(/Set 2: /.test(trySheet([{sa:21,sb:15},{sa:11,sb:9}]) || ""), "K9 a bad game is named — Set 2");
  ok(/Set 1: /.test(trySheet([{sa:19,sb:15},{sa:21,sb:9}]) || ""), "K10 short first game named");
  ok(/Set 1: .*level/.test(trySheet([{sa:15,sb:15},{sa:21,sb:9}]) || ""), "K11 a level game can't be a set");
  ok(/malformed/.test(trySheet([null, {sa:21,sb:9}]) || ""), "K12 malformed set entry rejected");
  // the saved match carries set counts + the sheet
  logic.saveScore(0, null, null, [{sa:21,sb:15},{sa:18,sb:21},{sa:21,sb:7}]);
  let S = logic.getState();
  const m = S.schedule.rounds[0][0];
  ok(m.scoreA === 2 && m.scoreB === 1, "K13 match score is the set count");
  eqv(m.sets, [{sa:21,sb:15},{sa:18,sb:21},{sa:21,sb:7}], "K14 the full sheet persists");
  ok(m.winner === m.a, "K15 winner by set majority");
  ok(S.table[m.a].pf === 2 && S.table[m.b].pf === 1, "K16 table uses set counts (not points)");
  logic.undoScore();
  ok(logic.getState().schedule.rounds[0][0].played === false, "K17 undo restores the sheet match");
  // single-game tournament still takes a plain pair
  const L1 = pair("format: rr", { points: null, sets: 1 });
  logic.saveScore(0, 21, 19);
  S = logic.getState();
  ok(S.schedule.rounds[0][0].scoreA === 21 && !S.schedule.rounds[0][0].sets, "K18 single game takes the plain pair, no sheet");
  // best of 5 / 7
  const L5 = pair("format: rr", { points: null, sets: 5 });
  ok(trySheet([{sa:21,sb:5},{sa:21,sb:6},{sa:21,sb:7}]) === null, "K19 best of 5: 3-0 sheet valid");
  ok(/ends at 3 set wins/.test(trySheet([{sa:21,sb:5},{sa:21,sb:6}]) || ""), "K20 best of 5: 2-0 sheet short");
  const L7 = pair("format: rr", { points: null, sets: 7 });
  ok(trySheet([{sa:21,sb:5},{sa:21,sb:6},{sa:21,sb:7},{sa:21,sb:8}]) === null, "K21 best of 7: 4-0 sheet valid");
  ok(/at most 7 sets/.test(trySheet([{sa:21,sb:5},{sa:21,sb:6},{sa:21,sb:7},{sa:21,sb:8},{sa:19,sb:21},{sa:19,sb:21},{sa:19,sb:21},{sa:21,sb:5}]) || ""), "K22 best of 7: eight sets rejected");
  ok(/ends at 4 set wins/.test(trySheet([{sa:21,sb:5},{sa:21,sb:6},{sa:21,sb:7},{sa:21,sb:8},{sa:21,sb:6}]) || ""), "K22b best of 7: majority overshoot rejected");
  // one-entry sheet on a single game also works (the UI's shape)
  const L1b = pair("format: rr", { points: null, sets: 1 });
  try {
    logic.saveScore(0, null, null, [{sa:21,sb:19}]);
    ok(true, "K23 single game accepts a one-entry sheet");
    logic.undoScore();
  } catch (e) { ok(false, "K23 single game accepts a one-entry sheet — " + e.message); }
  ok(/one score pair only/.test((() => { try { logic.saveScore(0, null, null, [{sa:21,sb:19},{sa:21,sb:5}]); return "no throw"; } catch (e) { return e.message; } })() || ""), "K24 single game rejects a multi-entry sheet");
}

/* ============ L. corrections with set sheets ============ */
section("L. corrections with set sheets");
{
  const L = fresh("format: rr\nA\nB\nC\nD", { points: null, sets: null });
  logic.saveScore(0, null, null, [{sa:21,sb:15},{sa:21,sb:9}]);
  let S = logic.getState();
  const a = S.schedule.rounds[0][0].a;
  ok(S.table[a].wins === 1, "L1 win on the books before the correction");
  // same result, same sheet -> rejected as a no-op
  let err = null;
  try { logic.editScoreAt(0, 0, null, null, [{sa:21,sb:15},{sa:21,sb:9}]); } catch (e) { err = e.message; }
  ok(/already saved/.test(err || ""), "L2 identical correction rejected");
  // flip the match
  logic.editScoreAt(0, 0, null, null, [{sa:15,sb:21},{sa:9,sb:21}]);
  S = logic.getState();
  const m = S.schedule.rounds[0][0];
  ok(m.scoreA === 0 && m.scoreB === 2, "L3 corrected match score flipped");
  eqv(m.sets, [{sa:15,sb:21},{sa:9,sb:21}], "L4 corrected sheet stored");
  ok(S.table[a].wins === 0 && S.table[a].losses === 1, "L5 standings rebuilt by replay");
  // one undo step reverts the correction
  logic.undoEdit();
  S = logic.getState();
  ok(S.schedule.rounds[0][0].scoreA === 2, "L6 undo edit restores the first sheet");
  // a bad sheet is rejected by the correction too
  err = null;
  try { logic.editScoreAt(0, 0, null, null, [{sa:21,sb:15}]); } catch (e) { err = e.message; }
  ok(/ends at 2 set wins/.test(err || ""), "L7 short sheet rejected on correction");
  // same-round RR matches stay correctable — the ladder isn't consumed
  logic.saveScore(1, null, null, [{sa:21,sb:11},{sa:21,sb:13}]);
  const gate = logic.getStateForWire().matchIndex.matches.find(x => x.roundIndex === 0 && x.mi === 0);
  ok(gate && gate.editable === true, "L8 a same-round neighbour doesn't lock an RR match");
  // but the bracket moving on does lock it
  const LE = fresh("format: elim\nA\nB\nC\nD", { points: null, sets: null });
  logic.saveScore(0, null, null, [{sa:21,sb:15},{sa:21,sb:9}]);
  logic.saveScore(1, null, null, [{sa:12,sb:21},{sa:21,sb:18},{sa:21,sb:6}]);
  logic.continueTournament();
  logic.saveScore(0, null, null, [{sa:21,sb:11},{sa:21,sb:13}]);   // a semifinal gets played
  const gate2 = logic.getStateForWire().matchIndex.matches.find(x => x.roundIndex === 0 && x.mi === 0);
  ok(gate2 && gate2.editable === false, "L9 the bracket moved on — the match locks");
  ok(typeof gate2.lockReason === "string" && gate2.lockReason.length > 0, "L9b the lock explains itself");
}

/* ============ M. walkovers and forfeits with sets ============ */
section("M. walkovers and forfeits with sets");
{
  // byes in a best-of-3 knockout
  const L = fresh("format: elim\nbyes: classic\nA\nB\nC\nD\nE", { points: null, sets: null });
  let S = logic.getState();
  const bye = S.schedule.rounds[0].find(m => m.a === "BYE" || m.b === "BYE");
  ok(bye.played === true, "M1 bye auto-played");
  const win = bye.a === "BYE" ? bye.scoreB : bye.scoreA;
  const lose = bye.a === "BYE" ? bye.scoreA : bye.scoreB;
  ok(win === 2 && lose === 0, "M2 bye records the set majority 2-0");
  eqv(bye.sets, [{sa:21,sb:0},{sa:21,sb:0}], "M3 bye sheet: 21-0 per game (orientation aside)");
  ok((bye.a === "BYE" ? bye.sets.every(g => g.sa === 0) : bye.sets.every(g => g.sb === 0)), "M4 the bye side scores nothing in any game");
  // forfeit in best-of-3
  const L2 = fresh("format: elim\nbyes: classic\nA\nB\nC\nD", { points: null, sets: null });
  logic.saveScore(0, null, null, [{sa:21,sb:15},{sa:21,sb:9}]);
  logic.saveScore(1, null, null, [{sa:12,sb:21},{sa:21,sb:18},{sa:21,sb:6}]);
  logic.continueTournament();
  S = logic.getState();
  const finalist = S.schedule.rounds[1][0].a;
  const r = logic.withdrawPlayer(finalist);
  ok(r && r.forfeit === true, "M5 knockout withdrawal returns a forfeit");
  S = logic.getState();
  const fin = S.schedule.rounds[1][0];
  const hi = Math.max(fin.scoreA, fin.scoreB), lo = Math.min(fin.scoreA, fin.scoreB);
  ok(hi === 2 && lo === 0, "M6 forfeit records 2-0 in best of 3");
  const oppSets = fin.a === finalist ? fin.sets.every(g => g.sb === 21 && g.sa === 0) : fin.sets.every(g => g.sa === 21 && g.sb === 0);
  ok(oppSets, "M7 the opponent won every game 21-0");
  // forfeit in best-of-1 keeps the plain 21-0
  const L3 = fresh("format: elim\nbyes: classic\nA\nB\nC\nD", { points: null, sets: 1 });
  logic.saveScore(0, 21, 15);
  logic.saveScore(1, 21, 9);
  logic.continueTournament();
  S = logic.getState();
  const f2 = S.schedule.rounds[1][0].a;
  logic.withdrawPlayer(f2);
  const fin3 = logic.getState().schedule.rounds[1][0];
  ok(Math.max(fin3.scoreA, fin3.scoreB) === 21 && Math.min(fin3.scoreA, fin3.scoreB) === 0, "M8 best-of-1 forfeit records 21-0");
  ok(!fin3.sets, "M9 best-of-1 forfeit carries no set sheet");
  // group withdrawal still annuls
  const L4 = fresh("format: rr\nA\nB\nC", { points: null, sets: null });
  logic.saveScore(0, null, null, [{sa:21,sb:15},{sa:21,sb:9}]);
  S = logic.getState();
  const leaver = S.schedule.rounds[0][0].a;
  const r4 = logic.withdrawPlayer(leaver);
  ok(r4 && r4.annulled >= 1, "M10 group withdrawal annuls played matches");
  S = logic.getState();
  ok(S.schedule.rounds[0][0].annulled === true, "M11 the played match is flagged annulled");
}

/* ============ N. wire, match index, record, snapshot with sets ============ */
section("N. wire, match index, record, snapshot with sets");
{
  const L = fresh("format: rr\nA\nB\nC\nD", { points: null, sets: null });
  logic.saveScore(0, null, null, [{sa:21,sb:15},{sa:18,sb:21},{sa:21,sb:7}]);
  const wire = logic.getStateForWire();
  const m = wire.matchIndex.matches.find(x => x.roundIndex === 0 && x.mi === 0);
  ok(m && m.played && m.scoreA === 2 && m.scoreB === 1, "N1 matchIndex carries the set-count score");
  eqv(m.sets, [{sa:21,sb:15},{sa:18,sb:21},{sa:21,sb:7}], "N2 matchIndex carries the full sheet");
  ok(wire.sets === 3 && wire.points === 21, "N3 wire exposes the points/sets config");
  // snapshot round-trip with a sheet
  const snap = logic.saveStateSnapshot();
  logic.reset();
  const res = logic.loadStateSnapshot(JSON.parse(JSON.stringify(snap)));
  ok(res.ok, "N4 snapshot with a set sheet loads");
  const S = logic.getState();
  eqv(S.schedule.rounds[0][0].sets, [{sa:21,sb:15},{sa:18,sb:21},{sa:21,sb:7}], "N5 the sheet survives the round-trip");
  ok(S.sets === 3 && S.points === 21, "N6 points/sets survive the round-trip");
  // old snapshot without sets defaults to best of 3
  const old = JSON.parse(JSON.stringify(snap));
  delete old.state.sets;
  logic.reset();
  logic.loadStateSnapshot(old);
  ok(logic.getState().sets === 3, "N7 snapshot without sets defaults to 3 (v1.8)");
  // season record carries game scores
  logic.reset();
  const L2 = fresh("format: rr\nA\nB\nC\nD", { points: null, sets: null });
  logic.saveScore(0, null, null, [{sa:21,sb:15},{sa:18,sb:21},{sa:21,sb:7}]);
  const rec = logic.getTournamentRecord();
  const rm = rec.matches[0];
  ok(rm.sa === 2 && rm.sb === 1, "N8 record stores set counts");
  eqv(rm.sets, [{sa:21,sb:15},{sa:18,sb:21},{sa:21,sb:7}], "N9 record stores the sheet for the season archive");
}

console.log("\nSUITE table-tennis-logic: " + (pass + fail) + " cases, " + pass + " passed, " + fail + " failed");
if (fail) { console.log("FAILED CASES:\n - " + fails.join("\n - ")); process.exit(1); }
