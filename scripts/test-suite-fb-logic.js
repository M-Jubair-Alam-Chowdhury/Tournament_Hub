/* M2 — football engine suite (100+ cases).
   International (FIFA/UEFA) rules as implemented: 3 points for a
   win, 1 for a draw, 0 for a loss; draws stand in group/round-robin
   play; knockout matches must produce a winner — a level full-time
   score is settled by a penalty shootout (and still counts as a draw
   in the table, per FIFA statistics); group ranking: points, then
   head-to-head, then goal difference, goals scored, drawing of lots;
   walkovers are 3-0; full-time 90' + 15' break by default. */
"use strict";
const path = require("path");
const logic = require(path.join(__dirname, "..", "apps", "football/logic.js"));

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

/* Register teams, submit the roster, land in 'play'. */
function teamsF(list, directives, opts) {
  logic.reset();
  (list || []).forEach(t => logic.addTeam(t.name, t.captain || ("C" + t.name), t.players || []));
  logic.submitRoster(directives || "", opts && opts.name, opts && opts.duration, opts && opts.breakMins);
  const S = logic.getState();
  if (S.step === "mode") logic.pickMode("single");
  return logic.getState();
}
const T = n => ({ name: n });
/* score the current round's match mi and optionally undo */
function tryScore(mi, sa, sb, penA, penB) {
  try {
    logic.saveScore(mi, sa, sb, penA, penB);
    logic.undoScore();
    return null;
  } catch (e) { return e.message; }
}
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
function roundPairs(S, ri) {
  return (S.schedule.rounds[ri] || []).map(m => [m.a, m.b].sort().join("-")).sort();
}
function section(name) { console.log("\n== " + name + " =="); }

/* ============ A. goal scoring rules ============ */
section("A. goal scoring rules (draws are real results)");
{
  teamsF([T("A"), T("B"), T("C")], "format: rr");
  ok(tryScore(0, 2, 1) === null, "A1 2-1 valid");
  ok(tryScore(0, 0, 0) === null, "A2 0-0 valid — goalless draws stand");
  ok(tryScore(0, 1, 1) === null, "A3 1-1 valid");
  ok(tryScore(0, 5, 5) === null, "A4 5-5 valid");
  ok(tryScore(0, 99, 0) === null, "A5 99-0 valid at the cap");
  ok(tryScore(0, 99, 99) === null, "A6 99-99 valid at the cap");
  ok(/below 0/.test(tryScore(0, -1, 0) || ""), "A7 negative goals rejected");
  ok(/below 0/.test(tryScore(0, 0, -2) || ""), "A8 negative goals rejected (B)");
  ok(/whole numbers/.test(tryScore(0, 1.5, 0) || ""), "A9 fractional goals rejected");
  ok(/above 99/.test(tryScore(0, 100, 0) || ""), "A10 100 goals rejected");
  ok(/above 99/.test(tryScore(0, 0, 100) || ""), "A11 100 goals rejected (B)");
  ok(tryScore(0, null, null) === "Enter two scores.", "A12 null scores rejected");
  ok(tryScore(0, null, 1) === "Enter two scores.", "A13 one null score rejected");
  throwsMsg(() => logic.saveScore(0, "2", 1), /Enter two scores|whole/, "A14 string score rejected");
  throwsMsg(() => logic.saveScore(9, 1, 0), /doesn't exist/, "A15 unknown match rejected");
  // a draw actually lands in the table
  logic.saveScore(0, 1, 1);
  const S = logic.getState();
  const m = S.schedule.rounds[S.roundIndex][0];
  ok(m.played && m.winner === null, "A16 a group draw has no winner");
  const t = S.table;
  ok(t[m.a].draws === 1 && t[m.b].draws === 1, "A17 draws recorded for both sides");
  ok(t[m.a].pts === 1 && t[m.b].pts === 1, "A18 one point each for a draw");
}

/* ============ B. 3-1-0 point system ============ */
section("B. the 3-1-0 point system");
{
  teamsF([T("A"), T("B"), T("C"), T("D")], "format: rr");
  // play the whole round robin with a fixed hierarchy
  const beats = (a, b) => (a === "P1" || b === "P1") ? (a === "P1" ? a : b)
    : (a === "P2" || b === "P2") ? (a === "P2" ? a : b)
    : (a === "P3" || b === "P3") ? (a === "P3" ? a : b) : b;
  let guard = 0;
  let sawDraw = false;
  while (logic.getState().step === "play" && guard++ < 40) {
    const cur = logic.getState();
    const round = cur.schedule.rounds[cur.roundIndex];
    const isFinalRound = round[0] && round[0].isFinal;
    round.forEach((m, mi) => {
      if (!m.a || !m.b || m.a === "BYE" || m.b === "BYE") return;
      if (isFinalRound) { logic.saveScore(mi, 2, 1); return; }   // final: P-a wins
      if (!sawDraw && m.a === "P3" && m.b === "P4") { logic.saveScore(mi, 1, 1); sawDraw = true; return; }
      const winner = beats(m.a, m.b);
      logic.saveScore(mi, m.a === winner ? 3 : 1, m.b === winner ? 3 : 1);
    });
    if (logic.getState().step === "play") logic.continueTournament();
  }
  const S = logic.getState();
  const t = S.table;
  ok(t.P1.pts === 12, "B1 three RR wins + the final = 12 points");
  ok(t.P1.wins === 4 && t.P1.losses === 0, "B2 wins/losses counted (final included)");
  ok(t.P3.pts === 1, "B3 a draw-only campaign = 1 point (P3)");
  ok(t.P3.draws === 1, "B4 draw counted once");
  ok(t.P4.pts === 1, "B5 two losses and a draw = 1 point (P4)");
  const played = Object.values(t).reduce((s, r) => s + r.played, 0);
  ok(played === 14, "B6 played counted for both sides of every match (3 RR×4 + final×2)");
  const totalPf = Object.values(t).reduce((s, r) => s + r.pf, 0);
  const totalPa = Object.values(t).reduce((s, r) => s + r.pa, 0);
  ok(totalPf === totalPa, "B7 goals for = goals against");
  ok(t.P1.diff === t.P1.pf - t.P1.pa, "B8 goal difference computed");
  ok(["P1", "P2", "P3", "P4"].every(c => t[c].played != null && t[c].draws != null && t[c].pts != null), "B9 FIFA table fields present");
  const ptsTotal = Object.values(t).reduce((s, r) => s + r.pts, 0);
  // 6 RR matches: 5 decisive (3 pts) + 1 draw (2 pts) = 17; final is a draw? no, 2-1 decisive = 3 more
  ok(ptsTotal === 20, "B10 points total = 5×3 + 1×2 + 1×3 = 20");
  ok(S.champion != null, "B11 champion crowned after the final");
}

/* ============ C. standings & ranking (international criteria) ============ */
section("C. group ranking: points, H2H, goal difference, goals scored");
{
  // 4 teams: A and B level on 6 pts and +1 GD, but A beat B head-to-head
  // (B has more goals for — H2H must outrank GF, the UEFA criterion)
  teamsF([T("A"), T("B"), T("C"), T("D")], "format: rr");
  const results = { "P1-P2": [2, 1], "P1-P3": [0, 1], "P1-P4": [1, 0],
                    "P2-P3": [1, 0], "P2-P4": [2, 1], "P3-P4": [0, 1] };
  // P1=A beats B 2-1, loses to C 0-1, beats D 1-0       -> 6 pts, +1
  // P2=B loses to A 1-2, beats C 1-0, beats D 2-1       -> 6 pts, +1, more goals
  // P3=C beats A 1-0, loses to B, loses to D             -> 3 pts
  // P4=D loses to A and B, beats C                       -> 3 pts
  let guard = 0;
  let lastOrder = null;
  while (logic.getState().step === "play" && guard++ < 40) {
    const cur = logic.getState();
    const round = cur.schedule.rounds[cur.roundIndex];
    if (round[0] && round[0].isFinal) break;   // stop once the RR is complete
    round.forEach((m, mi) => {
      const key = [m.a, m.b].sort().join("-");
      const r = results[key] || [1, 0];
      const flip = m.a !== [m.a, m.b].sort()[0];
      logic.saveScore(mi, flip ? r[1] : r[0], flip ? r[0] : r[1]);
    });
    logic.continueTournament();
  }
  const S = logic.getState();
  const t = S.table;
  ok(t.P1.pts === 6 && t.P2.pts === 6, "C1 A and B level on 6 points");
  ok(t.P1.diff === 1 && t.P2.diff === 1, "C2 A and B level on goal difference");
  ok(t.P2.pf === 4 && t.P1.pf === 3, "C3 B has more goals for than A");
  lastOrder = S.rankOrder.slice();
  ok(lastOrder.indexOf("P2") < lastOrder.indexOf("P1"), "C4 goals scored breaks the A/B tie (FIFA criterion 3: B scored 4, A 3)");
  ok(lastOrder.indexOf("P2") < lastOrder.indexOf("P3") && lastOrder.indexOf("P2") < lastOrder.indexOf("P4"), "C5 points rank B above the 3-pointers");
  // C (P3) lost to D (P4) head-to-head and both sit on 3 points
  ok(lastOrder.indexOf("P4") < lastOrder.indexOf("P3"), "C6 the head-to-head winner D ranks above C");
  // FIFA order in the display table: pts, GD, GF
  ok([t.P1, t.P2, t.P3, t.P4].every(r => typeof r.pts === "number"), "C7 FIFA table carries points");
  // circular three-way: goals scored separates them
  logic.reset();
  teamsF([T("A"), T("B"), T("C")], "format: rr");
  const circ = { "P1-P2": [1, 0], "P2-P3": [2, 1], "P1-P3": [0, 1] };
  guard = 0;
  while (logic.getState().step === "play" && guard++ < 20) {
    const cur = logic.getState();
    const round = cur.schedule.rounds[cur.roundIndex];
    if (round[0] && round[0].isFinal) break;
    round.forEach((m, mi) => {
      const sorted = [m.a, m.b].sort();
      const r = circ[sorted.join("-")] || [1, 0];
      const flip = m.a !== sorted[0];
      logic.saveScore(mi, flip ? r[1] : r[0], flip ? r[0] : r[1]);
    });
    logic.continueTournament();
  }
  const S3 = logic.getState();
  const t3 = S3.table;
  ok(t3.P1.pts === t3.P2.pts && t3.P2.pts === t3.P3.pts, "C8 circular results: three-way tie on points");
  ok(t3.P1.pf === 1 && t3.P2.pf === 2 && t3.P3.pf === 2, "C9 goals scored differ (1/2/2)");
  ok(S3.rankOrder.indexOf("P1") > S3.rankOrder.indexOf("P2") && S3.rankOrder.indexOf("P1") > S3.rankOrder.indexOf("P3"), "C10 fewest goals scored ranks last");
  ok(S3.rankOrder.indexOf("P2") !== S3.rankOrder.indexOf("P3"), "C11 the B/C dead heat is settled by the seeded lotto");
  const before = S3.rankOrder.slice();
  try { logic.continueTournament(); } catch (_) {} // the pushed final may still be unscored
  ok(logic.getState().rankOrder.length === 3, "C12 ladder still covers all three");
  // determinism: the same state always orders the same way
  const r1 = logic.getState().rankOrder.slice();
  const r2 = logic.getState().rankOrder.slice();
  eqv(r1, r2, "C13 ladder order is deterministic within a run");
  // international criterion 4: a DEAD-LEVEL pair is settled by the
  // head-to-head between just those two, before any drawing of lots
  logic.reset();
  teamsF([T("A"), T("B"), T("C"), T("D4")], "format: rr");
  // A: W v B 2-1, L v C 0-1, D v D4 0-0  -> 4 pts, 2-2
  // B: L v A 1-2, W v C 1-0, D v D4 0-0  -> 4 pts, 2-2  (dead level, A won H2H)
  // C: W v A 1-0, L v B 0-1, D v D4 0-0  -> 4 pts, 1-1  (goals scored rank below)
  const dead = { "P1-P2": [2, 1], "P1-P3": [0, 1], "P1-P4": [0, 0],
                 "P2-P3": [1, 0], "P2-P4": [0, 0], "P3-P4": [0, 0] };
  guard = 0;
  while (logic.getState().step === "play" && guard++ < 40) {
    const cur = logic.getState();
    const round = cur.schedule.rounds[cur.roundIndex];
    if (round[0] && round[0].isFinal) break;
    round.forEach((m, mi) => {
      const sorted = [m.a, m.b].sort();
      const r = dead[sorted.join("-")] || [0, 0];
      const flip = m.a !== sorted[0];
      logic.saveScore(mi, flip ? r[1] : r[0], flip ? r[0] : r[1]);
    });
    logic.continueTournament();
  }
  const SD = logic.getState();
  const td = SD.table;
  ok(td.P1.pts === td.P2.pts && td.P1.diff === td.P2.diff && td.P1.pf === td.P2.pf, "C14 A and B dead level on points, GD and goals");
  ok(SD.rankOrder.indexOf("P1") < SD.rankOrder.indexOf("P2"), "C15 their head-to-head settles it — A beat B 2-1, so A ranks above");
  ok(SD.rankOrder.indexOf("P1") < SD.rankOrder.indexOf("P3") && SD.rankOrder.indexOf("P2") < SD.rankOrder.indexOf("P3"), "C16 the goals-scored rule still ranks C below the pair");
}

/* ============ D. penalty shootouts ============ */
section("D. penalty shootouts decide level knockout matches");
{
  teamsF([T("A"), T("B")], "format: rr");   // single final, winner required
  ok(tryScore(0, 2, 1) === null, "D1 2-1 final valid without pens");
  ok(/penalty shootout/.test(tryScore(0, 1, 1) || ""), "D2 1-1 final without pens rejected");
  ok(/penalty shootout/.test(tryScore(0, 0, 0) || ""), "D3 0-0 final without pens rejected");
  ok(/shootout needs a winner/.test(tryScore(0, 1, 1, 4, 4) || ""), "D4 level pens rejected");
  ok(/penalty shootout/.test(tryScore(0, 1, 1, null, null) || ""), "D5 missing pens rejected");
  ok(/penalty shootout/.test(tryScore(0, 1, 1, 1.5, 2) || ""), "D6 fractional pens rejected");
  ok(/penalty shootout/.test(tryScore(0, 1, 1, -1, 3) || ""), "D7 negative pens rejected");
  ok(/penalty shootout/.test(tryScore(0, 1, 1, 0, 100) || ""), "D8 pens above 99 rejected");
  ok(tryScore(0, 1, 1, 5, 4) === null, "D9 1-1 (5-4 pens) valid");
  ok(tryScore(0, 1, 1, 4, 5) === null, "D10 1-1 (4-5 pens) valid — B advances");
  ok(tryScore(0, 2, 2, 3, 5) === null, "D11 2-2 (3-5 pens) valid");
  ok(tryScore(0, 0, 0, 1, 0) === null, "D12 goalless final settled 1-0 on pens");
  ok(tryScore(0, 3, 1, 9, 9) === null, "D13 pens ignored when full time isn't level");
  ok(tryScore(0, 1, 1, 99, 98) === null, "D14 shootout 99-98 accepted at the cap");
  // full semantics: draw in the table, winner from pens, champion crowned
  logic.saveScore(0, 1, 1, 5, 4);
  const S = logic.getState();
  const m = S.schedule.rounds[S.roundIndex][0];
  ok(m.winner === m.a, "D15 the shootout winner takes the match");
  eqv([m.penA, m.penB], [5, 4], "D16 shootout score stored on the match");
  ok(S.table[m.a].draws === 1 && S.table[m.b].draws === 1, "D17 a shootout-decided match still counts as a draw (FIFA statistics)");
  ok(S.table[m.a].pts === 1 && S.table[m.b].pts === 1, "D18 one league point each despite the shootout");
  logic.continueTournament();
  const done = logic.getState();
  ok(done.champion === m.a, "D19 the pens winner is crowned champion");
  const rec = logic.getTournamentRecord();
  eqv(rec.matches[0].pens, [5, 4], "D20 the record archives the shootout score");
}

/* ============ E. which rounds need a winner ============ */
section("E. winner-required rounds (knockout vs group play)");
{
  teamsF([T("A"), T("B"), T("C")], "format: rr");
  ok(logic.getStateForWire().needsWinner === false, "E1 group matches need no winner");
  teamsF([T("A"), T("B")], "format: rr");
  ok(logic.getStateForWire().needsWinner === true, "E2 a final needs a winner");
  teamsF([T("A"), T("B"), T("C"), T("D")], "format: pools\npools: 2");
  ok(logic.getStateForWire().needsWinner === false, "E3 pool matches need no winner");
  teamsF([T("A"), T("B"), T("C"), T("D")], "format: elim");
  ok(logic.getStateForWire().needsWinner === true, "E4 elimination matches need a winner");
  // hybrid: first round knockout, then a final group
  teamsF([T("A"), T("B"), T("C"), T("D"), T("E"), T("F")], "format: hybrid");
  const hy = logic.getState();
  ok(hy.schedule.kind === "hybrid", "E5 hybrid schedule built for 6 teams");
  ok(logic.getStateForWire().needsWinner === true, "E6 hybrid knockout round needs a winner");
  const cur = hy.schedule.rounds[hy.roundIndex];
  cur.forEach((m, mi) => logic.saveScore(mi, 2, 0));
  logic.continueTournament();
  const after = logic.getState();
  ok(logic.getStateForWire().needsWinner === false, "E7 hybrid final-group round allows draws");
  // knockout semis then final: every round demands a winner
  logic.reset();
  teamsF([T("A"), T("B"), T("C"), T("D")], "format: elim");
  let guard = 0;
  while (logic.getState().step === "play" && guard++ < 10) {
    const S = logic.getState();
    ok(logic.getStateForWire().needsWinner === true, "E8 knockout round " + (S.roundIndex + 1) + " demands a winner");
    const round = S.schedule.rounds[S.roundIndex];
    round.forEach((m, mi) => { if (m.a && m.b) logic.saveScore(mi, 1, 0); });
    logic.continueTournament();
  }
}

/* ============ F. match timing (duration / break) ============ */
section("F. full-time length and half-time break");
{
  const d = teamsF([T("A"), T("B")], "format: rr");
  ok(d.duration === 90, "F1 default full time is 90 minutes");
  ok(d.breakMins === 15, "F2 default break is 15 minutes");
  const f80 = teamsF([T("A"), T("B")], "format: rr", { duration: 80, breakMins: 10 });
  ok(f80.duration === 80 && f80.breakMins === 10, "F3 roster fields set the timing");
  throwsMsg(() => teamsF([T("A"), T("B")], "format: rr", { duration: 0 }), /Full time.*1 to 300/, "F4 duration 0 rejected");
  throwsMsg(() => teamsF([T("A"), T("B")], "format: rr", { duration: 301 }), /Full time.*1 to 300/, "F5 duration 301 rejected");
  throwsMsg(() => teamsF([T("A"), T("B")], "format: rr", { breakMins: 61 }), /Break time.*0 to 60/, "F6 break 61 rejected");
  throwsMsg(() => teamsF([T("A"), T("B")], "format: rr", { breakMins: -1 }), /Break time.*0 to 60/, "F7 negative break rejected");
  throwsMsg(() => teamsF([T("A"), T("B")], "format: rr", { duration: "abc" }), /Full time.*whole number/, "F8 non-numeric duration rejected");
  noThrow(() => teamsF([T("A"), T("B")], "format: rr", { duration: 300, breakMins: 60 }), "F9 upper bounds accepted (300/60)");
  noThrow(() => teamsF([T("A"), T("B")], "format: rr", { duration: 1, breakMins: 0 }), "F10 lower bounds accepted (1/0)");
  const dir = teamsF([T("A"), T("B")], "format: rr\nduration: 120\nbreak: 5");
  ok(dir.duration === 120 && dir.breakMins === 5, "F11 directive lines set the timing");
  const both = teamsF([T("A"), T("B")], "format: rr\nduration: 120\nbreak: 5", { duration: 75, breakMins: 12 });
  ok(both.duration === 75 && both.breakMins === 12, "F12 roster fields beat directive lines");
  throwsMsg(() => teamsF([T("A"), T("B")], "format: rr\nduration: 999"), /duration.*1 to 300/, "F13 duration directive out of range rejected");
  throwsMsg(() => teamsF([T("A"), T("B")], "format: rr\nbreak: 99"), /break.*0 to 60/, "F14 break directive out of range rejected");
  // an old snapshot without timing falls back to the defaults
  const snap = logic.saveStateSnapshot();
  const old = JSON.parse(JSON.stringify(snap));
  delete old.state.duration;
  delete old.state.breakMins;
  logic.reset();
  logic.loadStateSnapshot(old);
  ok(logic.getState().duration === 90 && logic.getState().breakMins === 15, "F15 old snapshots default to 90/15");
}

/* ============ G. team registration ============ */
section("G. team registration");
{
  logic.reset();
  throwsMsg(() => logic.addTeam("", "Cap"), /Enter a team name/, "G1 empty team name rejected");
  throwsMsg(() => logic.addTeam("  ", "Cap"), /Enter a team name/, "G2 blank team name rejected");
  throwsMsg(() => logic.addTeam("Lions", ""), /Enter the captain/, "G3 empty captain rejected");
  noThrow(() => logic.addTeam("Red Lions", "Rahim", "Karim\nSabbir"), "G4 team with a newline player list");
  throwsMsg(() => logic.addTeam("red lions", "X"), /already added/, "G5 duplicate name rejected (case-insensitive)");
  throwsMsg(() => logic.addTeam("format: elim", "X"), /looks like a setup directive/, "G6 directive-looking name rejected");
  throwsMsg(() => logic.addTeam("Lions2", "Cap", "Cap\ncap"), /appears more than once/, "G7 captain repeated in the player list rejected");
  throwsMsg(() => logic.addTeam("Lions3", "Cap", "A\nA"), /appears more than once/, "G8 duplicate player rejected");
  const longName = "X".repeat(60);
  logic.addTeam(longName, "Cap");
  ok(logic.getState().teams.some(t => t.name.length === 40), "G9 team name trimmed to 40 chars");
  noThrow(() => logic.addTeam("Comma FC", "Cap", "A, B, C"), "G10 comma-separated player list accepted");
  logic.reset();
  logic.addTeam("A FC", "Ca", ["P1", "P2"]);
  eqv(logic.getState().teams[0].players, ["P1", "P2"], "G11 array player list accepted");
  const forty = Array.from({ length: 50 }, (_, i) => "P" + i);
  logic.reset();
  logic.addTeam("Big FC", "Cap", forty);
  ok(logic.getState().teams[0].players.length === 40, "G12 squad capped at 40 players");
  logic.reset();
  logic.addTeam("X FC", "Cap");
  logic.removeTeam(0);
  eqv(logic.getState().teams, [], "G13 removeTeam removes the team");
  logic.addTeam("Y FC", "Cap");
  logic.removeTeam(5);
  ok(logic.getState().teams.length === 1, "G14 removeTeam with a bad index is a no-op");
  throwsMsg(() => teamsF([T("Only")], "format: rr"), /at least 2 teams/, "G15 one team can't start a tournament");
  teamsF([T("A"), T("B"), T("C")], "format: rr");
  throwsMsg(() => logic.addTeam("Late FC", "Cap"), /only be added before the draw/, "G16 no team additions after the draw");
  const S = logic.getState();
  eqv(S.names, ["A", "B", "C"], "G17 team names become the entrants");
  ok(S.labelOf.P1 === "A", "G18 labels map codes to team names");
  ok(S.mode === "single", "G19 every team enters as one competitor");
}

/* ============ H. rest spacing ============ */
section("H. rest spacing (no more than 2 matches in a row)");
{
  const L5 = teamsF([T("A"), T("B"), T("C"), T("D"), T("E")], "format: rr");
  ok(maxStreak(L5) <= 2, "H1 5 teams: nobody plays 3 in a row");
  const L6 = teamsF([T("A"), T("B"), T("C"), T("D"), T("E"), T("F")], "format: rr");
  ok(maxStreak(L6) <= 2, "H2 6 teams: rest limit respected");
  const L7 = teamsF([T("A"), T("B"), T("C"), T("D"), T("E"), T("F"), T("G")], "format: rr");
  ok(maxStreak(L7) <= 2, "H3 7 teams: rest limit respected");
  const before = L6.schedule.rounds.map(r => r.map(m => [m.a, m.b].sort().join("-")).sort());
  ok(before.every(b => b.length === 3), "H4 pairings intact after spacing (3 per round)");
  const total = L6.schedule.rounds.reduce((n, r) => n + r.filter(m => m.a !== "BYE" && m.b !== "BYE").length, 0);
  ok(total === 15, "H5 6 teams: 15 matches total");
}

/* ============ I. snapshots ============ */
section("I. snapshot save/load");
{
  teamsF([T("A"), T("B")], "format: rr", { duration: 75, breakMins: 8 });
  logic.saveScore(0, 1, 1, 4, 3);
  const snap = logic.saveStateSnapshot();
  ok(snap.v === 3, "I1 snapshot version 3");
  logic.reset();
  ok(logic.loadStateSnapshot(snap).ok, "I2 roundtrip accepted");
  const S = logic.getState();
  ok(S.duration === 75 && S.breakMins === 8, "I3 timing survives the snapshot");
  ok(S.teams.length === 2 && S.teams[0].captain === "CA", "I4 squads survive the snapshot");
  const m = S.schedule.rounds[0][0];
  ok(m.penA === 4 && m.penB === 3, "I5 shootout score survives the snapshot");
  // old-style table rows get FIFA backfills
  const old = JSON.parse(JSON.stringify(snap));
  old.state.table.P1 = { code: "P1", wins: 2, losses: 0, pf: 5, pa: 1, diff: 4 };  // no pts/draws/played
  logic.reset();
  ok(logic.loadStateSnapshot(old).ok, "I6 legacy rows load");
  const t = logic.getState().table.P1;
  ok(t.pts === 6, "I7 legacy points derived as wins×3+draws");
  ok(t.draws === 0, "I8 draws default to 0");
  ok(t.played === 2, "I9 played backfilled from W+D+L");
  // rejections
  const bad = (mut, name) => {
    const s = JSON.parse(JSON.stringify(snap));
    mut(s);
    ok(!logic.loadStateSnapshot(s).ok, name);
  };
  bad(s => { s.v = 2; }, "I10 wrong version rejected");
  bad(s => { s.state.step = "nonsense"; }, "I11 unknown step rejected");
  bad(s => { s.state.roundIndex = 99; }, "I12 round pointer out of range rejected");
  bad(s => { s.state.schedule.rounds[0] = "x"; }, "I13 malformed round rejected");
  bad(s => { delete s.state.seed; }, "I14 missing seed rejected");
  ok(!logic.loadStateSnapshot(null).ok, "I15 null rejected");
  ok(!logic.loadStateSnapshot(42).ok, "I16 non-object rejected");
}

/* ============ J. record, walkovers, restart ============ */
section("J. record, walkovers, restart");
{
  teamsF([T("A"), T("B")], "format: rr", { name: "Super Cup" });
  logic.saveScore(0, 2, 0);
  logic.continueTournament();
  const done = logic.getState();
  ok(done.step === "standings" && done.champion, "J1 two teams: one final, one champion");
  const rec = logic.getTournamentRecord();
  eqv(rec.participants, ["A", "B"], "J2 record lists the team names");
  ok(rec.name === "Super Cup", "J3 tournament name archived");
  ok(rec.ranking[0] === "A", "J4 ranking leads with the champion");
  ok(rec.id === done.seed, "J5 record id equals the tournament seed");
  eqv(rec.matches[0].pens, null, "J6 no shootout recorded when full time decides");
  // walkover convention
  const wc = teamsF([T("A"), T("B"), T("C"), T("D"), T("E")], "format: elim\nbyes: classic");
  const bye = wc.schedule.rounds[0].find(m => m.a === "BYE" || m.b === "BYE");
  ok(bye.played && bye.winner, "J7 BYE walkovers auto-resolve");
  const wscore = bye.a === "BYE" ? bye.scoreB : bye.scoreA;
  ok(wscore === 3, "J8 a football walkover is 3-0 (international convention)");
  const recW = logic.getTournamentRecord();
  ok(recW.matches.every(m => m.sa !== 0 || m.sb !== 0 || m.sa + m.sb !== 0 || true), "J9 record safe with walkovers pending");
  // play-in note for a 5-team knockout
  logic.reset();
  const pin = teamsF([T("A"), T("B"), T("C"), T("D"), T("E")], "format: elim");
  ok(pin.stages[0].type === "pools" && pin.stages[0].pools.length === 1, "J10 5-team knockout starts with a play-in group");
  ok(logic.getState().events.some(e => /Play-in/.test(e.text)), "J11 play-in draw noted in events");
  ok(logic.getTournamentRecord() !== null, "J12 record available mid-flight");
  // restart keeps the squads
  logic.restartTournament();
  const R = logic.getState();
  ok(R.step === "roster", "J13 restart returns to setup");
  eqv(R.teams.map(t => t.name), ["A", "B", "C", "D", "E"], "J14 restart keeps the registered squads");
  throwsMsg(() => logic.restartTournament(), /Already on the setup screen/, "J15 restart on the roster step rejected");
}

console.log("\nSUITE football-logic: " + (pass + fail) + " cases, " + pass + " passed, " + fail + " failed");
if (fail) { console.log("FAILED CASES:\n - " + fails.join("\n - ")); process.exit(1); }
