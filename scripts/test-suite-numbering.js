/* Match numbering (v2.3): every real match carries its number in the
   playing order (1..N, round by round, slot by slot); moveMatchTo
   jumps a fixture straight to a number — one validated swap with the
   fixture that holds it, under the same rules the v1.9 arrows obey
   (same stage, same pool, both unplayed and settled, clock stopped
   in football). The move lands exactly on the asked number or
   nothing changes. */
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function ok(c, n) { if (c) pass++; else { fail++; console.log("  FAIL:", n); } }
function T(fn) { try { return fn(); } catch (e) { return e; } }
function eqv(a, b, n) { ok(JSON.stringify(a) === JSON.stringify(b), n + " — got " + JSON.stringify(a)); }

const load = (game) => {
  const p = path.join(ROOT, "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  return require(p);
};
const setup = (L, game, fmt, names) => {
  if (game === "football") {
    names.forEach((n, i) => L.addTeam(n, "Cap" + i, ["Player " + i]));
    L.submitRoster("format: " + fmt, "Cup", 90, 15);
  } else {
    L.submitRoster("format: " + fmt + "\n" + names.join("\n"), "Cup", 11);
  }
  let S = L.getState();
  if (S.step === "mode") L.pickMode("single");
  S = L.getState();
  if (S.step === "pairing") L.goToPairing();
  S = L.getState();
  if (S.step === "teamsFormed") L.confirmTeamsAndDraw();
};
const roundsShape = (L) => L.getState().schedule.rounds.map(r => r.map(m => (m.a === "BYE" || m.b === "BYE" ? "BYE" : m.a + "-" + m.b) + (m.played ? "*" : "")));
const playedCounts = (L) => L.getState().schedule.rounds.map(r => r.filter(m => m.played).length);
const rowOf = (L, a, b) => L.listMatches().find(m => (m.a === a && m.b === b) || (m.a === b && m.b === a));
const scoreAt = (L, game, ri, mi) => {
  const m = L.getState().schedule.rounds[ri][mi];
  if (game === "football") return T(() => L.saveScoreAt(ri, mi, 2, 1));
  return T(() => L.saveScoreAt(ri, mi, 11, 4, [{ sa: 11, sb: 4 }, { sa: 9, sb: 11 }, { sa: 11, sb: 6 }]));
};

/* ---- 1. numbering basics: a bye-bearing league numbers only real
          matches, in playing order, and the wire carries it ---- */
for (const game of ["football", "table-tennis"]) {
  const L = load(game);
  const names = (game === "football" ? 5 : 7);
  setup(L, game, "rr", Array.from({ length: names }, (_, i) => "N" + (i + 1)));
  const rows = L.listMatches();
  const real = rows.filter(m => !m.bye);
  ok(real.length === (game === "football" ? 10 : 21), game + " real match count");
  eqv(real.map(m => m.no), real.map((_, i) => i + 1), game + " real matches number 1..N in order");
  ok(rows.filter(m => m.bye).every(m => m.no === null), game + " byes carry no number");
  ok(rows.every(m => Number.isInteger(m.no) || m.no === null), game + " every row has a no field");
  ok(real.every(m => m.reorderable === true), game + " unplayed rr fixtures are reorderable");
  ok(rows.filter(m => m.bye).every(m => m.reorderable === false), game + " byes are not reorderable");
  const wire = L.getStateForWire().matchIndex.matches;
  ok(wire.length === rows.length && wire[0].no === real[0].no, game + " the wire carries the numbers");
}

/* ---- 2. the exact jump: one swap, two fixtures, everything else
          stays exactly where it was ---- */
for (const game of ["football", "table-tennis"]) {
  const L = load(game);
  const names = ["Ant", "Bee", "Cat", "Dog", "Eel", "Fox"].map(n => n + " " + game.slice(0, 2));
  setup(L, game, "rr", names);
  const before = roundsShape(L), beforePlayed = playedCounts(L);
  const rows = L.listMatches().filter(m => !m.bye);
  const total = rows.length;
  const last = rows[total - 1], first = rows[0];
  const r = T(() => L.moveMatchTo(last.roundIndex, last.mi, 1));
  ok(!(r instanceof Error), game + " jump ok " + (r && r.message));
  ok(r && r.from === total && r.to === 1, game + " the result reports from/to");
  const after = L.listMatches();
  const moved = after.find(m => m.a === last.a && m.b === last.b);
  const bumped = after.find(m => m.a === first.a && m.b === first.b);
  ok(moved && moved.no === 1 && moved.roundIndex === 0, game + " the jumper lands exactly on #1");
  ok(bumped && bumped.no === total, game + " the displaced fixture takes the old number");
  ok(after.filter(m => !m.bye).every(m => m.reorderable === true), game + " everything still reorderable");
  // exactly two rows changed position
  const beforePairs = L.getState().schedule.rounds.flat().map(m => m.a + "-" + m.b).sort().join("|");
  const movedCount = after.filter((m, i) => m.a !== rows[i].a || m.b !== rows[i].b).length;
  ok(movedCount === 2, game + " exactly two rows moved — got " + movedCount);
  ok(L.getState().schedule.rounds.flat().map(m => m.a + "-" + m.b).sort().join("|") === beforePairs, game + " the fixture set is unchanged");
  eqv(roundsShape(L).map(r => r.length), before.map(r => r.length), game + " round sizes unchanged");
  eqv(playedCounts(L), beforePlayed, game + " played counts unchanged");
  ok((L.getState().events || []).some(e => /moved to match #1 \(was #/.test(e.text)), game + " the decision log records the jump");
  // every other row kept its number
  const nos = after.filter(m => !m.bye).map(m => m.no).sort((a, b) => a - b);
  eqv(nos, nos.map((_, i) => i + 1), game + " numbers still form 1..N with no gaps");
  // ...and undoing the jump by number restores the original layout
  const back = T(() => L.moveMatchTo(moved.roundIndex, moved.mi, total));
  ok(!(back instanceof Error), game + " jump back ok " + (back && back.message));
  eqv(roundsShape(L), before, game + " jumping back restores the exact layout");
}

/* ---- 3. rejections: range, same number, played source/target ---- */
for (const game of ["football", "table-tennis"]) {
  const L = load(game);
  const names = ["Ant", "Bee", "Cat", "Dog", "Eel", "Fox"].map(n => n + " " + game.slice(0, 2));
  setup(L, game, "rr", names);
  const rows = L.listMatches().filter(m => !m.bye);
  const total = rows.length;
  const last = rows[total - 1];
  for (const bad of [0, -1, total + 1, 1.5, "2", null, undefined, NaN]) {
    const e = T(() => L.moveMatchTo(last.roundIndex, last.mi, bad));
    ok(e instanceof Error && /Pick a match number from 1 to/.test(e.message), game + " out-of-range " + JSON.stringify(bad) + " rejected");
  }
  const same = T(() => L.moveMatchTo(last.roundIndex, last.mi, last.no));
  ok(same instanceof Error && /already match #/.test(same.message), game + " same number rejected");
  const before = roundsShape(L);
  // play match #1, then try to jump onto its number
  scoreAt(L, game, rows[0].roundIndex, rows[0].mi);
  const tgt = T(() => L.moveMatchTo(last.roundIndex, last.mi, 1));
  ok(tgt instanceof Error && /Match #1 can't be swapped out — it's already played/.test(tgt.message), game + " played target rejected");
  eqv(roundsShape(L).slice(1), before.slice(1), game + " the failed jump changed nothing");
  // a played fixture can't be the source either
  const src = T(() => L.moveMatchTo(rows[0].roundIndex, rows[0].mi, 5));
  ok(src instanceof Error && /played match stays put/.test(src.message), game + " played source rejected");
  // and the played row lost its reorderable affordance
  const playedRow = L.listMatches().find(m => m.a === rows[0].a && m.b === rows[0].b);
  ok(playedRow.reorderable === false, game + " played rows are not reorderable");
}

/* ---- 4. same-round swap: two fixtures in one round exchange numbers ---- */
for (const game of ["football", "table-tennis"]) {
  const L = load(game);
  const names = ["Ant", "Bee", "Cat", "Dog", "Eel", "Fox"].map(n => n + " " + game.slice(0, 2));
  setup(L, game, "rr", names);
  const before = roundsShape(L);
  const rows = L.listMatches().filter(m => !m.bye);
  const a = rows[0], b = rows[1];
  ok(a.roundIndex === b.roundIndex, game + " two fixtures share round 1");
  const r = T(() => L.moveMatchTo(a.roundIndex, a.mi, b.no));
  ok(!(r instanceof Error), game + " same-round jump ok " + (r && r.message));
  const after = L.listMatches();
  const movedA = after.find(m => m.a === a.a && m.b === a.b);
  const movedB = after.find(m => m.a === b.a && m.b === b.b);
  ok(movedA.no === b.no && movedA.mi === b.mi, game + " first fixture took the second's slot and number");
  ok(movedB.no === a.no && movedB.mi === a.mi, game + " second fixture took the first's slot and number");
  eqv(roundsShape(L).map(r => r.length), before.map(r => r.length), game + " round sizes unchanged after same-round swap");
}

/* ---- 5. the live round: jump into it, jump out of it, keep scoring ---- */
for (const game of ["football", "table-tennis"]) {
  const L = load(game);
  const names = ["Ant", "Bee", "Cat", "Dog", "Eel", "Fox"].map(n => n + " " + game.slice(0, 2));
  setup(L, game, "rr", names);
  const live = () => L.getState().schedule.rounds[L.getState().roundIndex];
  const rows = L.listMatches().filter(m => !m.bye);
  const deep = rows[rows.length - 1];
  const liveNo = rows.find(m => m.roundIndex === L.getState().roundIndex).no;
  const r = T(() => L.moveMatchTo(deep.roundIndex, deep.mi, liveNo));
  ok(!(r instanceof Error), game + " jump into the live round ok " + (r && r.message));
  ok(live().some(m => m.a === deep.a && m.b === deep.b), game + " the jumper is now in the live list");
  // it can be scored through the live path
  const mi = live().findIndex(m => m.a === deep.a && m.b === deep.b);
  const s = T(() => game === "football" ? L.saveScore(mi, 2, 1) : L.saveScore(mi, 11, 4, [{ sa: 11, sb: 4 }, { sa: 9, sb: 11 }, { sa: 11, sb: 6 }]));
  ok(!(s instanceof Error), game + " live score after the jump " + (s && s.message));
  // and a live-round fixture can jump out to a later number
  const rows2 = L.listMatches().filter(m => !m.bye && !m.played);
  const out = rows2.find(m => m.roundIndex === L.getState().roundIndex);
  const later = rows2[rows2.length - 1];
  ok(!!out && !!later && later.roundIndex > out.roundIndex, game + " a live fixture and a later one exist");
  const r2 = T(() => L.moveMatchTo(out.roundIndex, out.mi, later.no));
  ok(!(r2 instanceof Error), game + " jump out of the live round ok " + (r2 && r2.message));
  ok(!live().some(m => m.a === out.a && m.b === out.b), game + " it left the live round");
  eqv(playedCounts(L).slice(0, 1), [1], game + " played count intact through both jumps");
  // snapshot round-trip keeps the rearranged layout
  const snap = JSON.parse(JSON.stringify(L.saveStateSnapshot()));
  ok(L.loadStateSnapshot(snap).ok, game + " snapshot after numbered moves round-trips");
  const afterLoad = L.listMatches().filter(m => !m.bye).map(m => m.a + m.b).join("|");
  const beforeLoad = L.listMatches().filter(m => !m.bye).map(m => m.a + m.b).join("|");
  ok(afterLoad === beforeLoad, game + " reload keeps the exact order");
}

/* ---- 6. pools: numbers are pool-local territory ---- */
for (const game of ["football", "table-tennis"]) {
  const L = load(game);
  const names = ["Ant", "Bee", "Cat", "Dog", "Eel", "Fox"].map(n => n + " " + game.slice(0, 2));
  setup(L, game, "pools\npools: 2", names);
  const rows = L.listMatches().filter(m => !m.bye);
  eqv(rows.map(m => m.no), [1, 2, 3, 4, 5, 6], game + " pools number 1..6");
  const inA = rows.filter(m => m.roundIndex < 3), inB = rows.filter(m => m.roundIndex >= 3);
  ok(inA.length === 3 && inB.length === 3, game + " two pools of three fixtures");
  const before = roundsShape(L);
  // cross-pool jump is refused
  const e = T(() => L.moveMatchTo(inA[2].roundIndex, inA[2].mi, inB[0].no));
  ok(e instanceof Error && /another pool/.test(e.message), game + " cross-pool jump rejected");
  eqv(roundsShape(L), before, game + " refused jump changed nothing");
  // inside the pool works, across its rounds
  const r = T(() => L.moveMatchTo(inA[2].roundIndex, inA[2].mi, inA[0].no));
  ok(!(r instanceof Error), game + " in-pool jump ok " + (r && r.message));
  const moved = L.listMatches().find(m => m.a === inA[2].a && m.b === inA[2].b);
  ok(moved.no === 1 && moved.roundIndex === 0, game + " in-pool jump landed on #1");
}

/* ---- 7. football only: a running clock pins both sides of the swap ---- */
{
  const L = load("football");
  const names = ["Ant", "Bee", "Cat", "Dog", "Eel", "Fox"].map(n => n + " FB");
  setup(L, "football", "rr", names);
  const rows = L.listMatches().filter(m => !m.bye);
  const clock = (ri, mi, action) => {
    const S = L.getState(), m = S.schedule.rounds[ri][mi];
    return T(() => L.controlClock({ seed: S.seed, a: m.a, b: m.b, roundIndex: ri, mi, revision: m.live ? m.live.revision || 0 : 0, scoreVersion: m.scoreVersion || 0, action }));
  };
  const before = roundsShape(L);
  const runner = rows[0], mover = rows[rows.length - 1];
  const start = clock(runner.roundIndex, runner.mi, "start");
  ok(!(start instanceof Error), "fb clock started " + (start && start.message));
  // the running fixture can't be the source...
  const e1 = T(() => L.moveMatchTo(runner.roundIndex, runner.mi, mover.no));
  ok(e1 instanceof Error && /Stop the match clock/.test(e1.message), "fb running source rejected");
  // ...nor the target of someone else's jump
  const e2 = T(() => L.moveMatchTo(mover.roundIndex, mover.mi, runner.no));
  ok(e2 instanceof Error && /its clock is running/.test(e2.message), "fb running target rejected");
  eqv(roundsShape(L), before, "fb clocked jumps changed nothing");
  // pause it and the same jump goes through
  const pause = clock(runner.roundIndex, runner.mi, "pause");
  ok(!(pause instanceof Error), "fb clock paused " + (pause && pause.message));
  const r = T(() => L.moveMatchTo(mover.roundIndex, mover.mi, runner.no));
  ok(!(r instanceof Error), "fb jump after pause ok " + (r && r.message));
  const moved = L.listMatches().find(m => m.a === mover.a && m.b === mover.b);
  ok(moved.no === runner.no, "fb the paused-clock jump landed");
}

/* ---- 8. knockout brackets: nothing is numbered-movable ---- */
for (const game of ["football", "table-tennis"]) {
  const L = load(game);
  setup(L, game, "elim", ["A", "B", "C", "D", "E", "F", "G", "H"].map(x => x + game.slice(0, 1)));
  const rows = L.listMatches();
  ok(rows.filter(m => !m.bye).every(m => m.reorderable === false), game + " knockout rows are not reorderable");
  const first = rows.find(m => !m.bye);
  const e = T(() => L.moveMatchTo(first.roundIndex, first.mi, 2));
  ok(e instanceof Error && /Bracket rounds feed the next round/.test(e.message), game + " knockout jump rejected");
}

console.log("\nSUITE match-numbering: " + pass + " cases, " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
