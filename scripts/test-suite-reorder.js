/* Match reordering: moving an unplayed match into the current round
   puts it Live; knockouts/finals/played matches are locked.
   (v1.9: the table-tennis score call carries a set sheet — matches
   have been best-of-N to 21 since v1.8, so a bare pair is rejected.) */
"use strict";
const path = require("path");
let pass = 0, fail = 0;
function ok(c, n) { if (c) pass++; else { fail++; console.log("  FAIL:", n); } }
function T(fn) { try { return fn(); } catch (e) { return e; } }
const setup = (L, game, fmt, names) => {
  if (game === "football") {
    names.forEach((n, i) => L.addTeam(n, "Cap" + i, []));
    L.submitRoster("format: " + fmt, "Cup", 90, 15);
  } else {
    L.submitRoster("format: " + fmt + "\n" + names.join("\n"), "Cup", 11);
  }
  let S = L.getState();
  if (S.step === "mode") L.pickMode("single");
  if (S.step === "pairing") L.goToPairing();
  S = L.getState();
  if (S.step === "teamsFormed") L.confirmTeamsAndDraw();
};
for (const [game, fmt] of [["football", "format: rr\nFIFA\n"], ["table-tennis", "format: rr\nTT\n"]]) {
  const p = path.join(__dirname, "..", "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  const names = ["Ant","Bee","Cat","Dog","Eel","Fox"].map(n => n + " " + game.slice(0,2));
  const r = T(() => setup(L, game, "rr", names));
  if (r instanceof Error) { console.log(game, "setup error", r.message); fail++; continue; }
  let S = L.getState();
  console.log(game, "step", S.step, "rounds", S.schedule && S.schedule.rounds.length);
  const live = () => L.getState().schedule.rounds[L.getState().roundIndex].map(m => m.a + "-" + m.b);
  const before = live();
  const all = L.listMatches().filter(m => !m.bye);
  const last = all[all.length - 1];
  ok(last.canUp && !last.canDown, game + " last: up only");
  ok(all[0].canDown && !all[0].canUp, game + " first: down only");
  // move the last match up repeatedly until it lands in the live round
  let guard = 0, cur = last;
  while (cur.roundIndex > L.getState().roundIndex && guard++ < 100) {
    const e = T(() => L.moveMatch(cur.roundIndex, cur.mi, -1));
    ok(!(e instanceof Error), game + " move ok " + (e && e.message));
    cur = L.listMatches().find(m => m.a === last.a && m.b === last.b);
  }
  ok(cur.roundIndex === L.getState().roundIndex, game + " reached live round");
  ok(live().includes(last.a + "-" + last.b), game + " now in live list");
  ok(JSON.stringify(live()) !== JSON.stringify(before), game + " live changed");
  // total sizes preserved, nothing duplicated
  const flat = L.getState().schedule.rounds.flat().map(m => m.a + "-" + m.b);
  ok(new Set(flat).size === flat.length, game + " no duplicates");
  // it can be scored through the live path now
  const mi = L.getState().schedule.rounds[L.getState().roundIndex].findIndex(m => m.a === last.a && m.b === last.b);
  const s = T(() => game === "football" ? L.saveScore(mi, 2, 1) : L.saveScore(mi, 11, 4, [{sa:11,sb:4},{sa:9,sb:11},{sa:11,sb:6}]));
  ok(!(s instanceof Error), game + " live score ok " + (s && s.message));
  // played match can't move
  ok(T(() => L.moveMatch(L.getState().roundIndex, mi, 1)) instanceof Error, game + " played locked");
  // first match can't move up
  const f = L.listMatches().find(m => m.canDown && !m.canUp);
  if (f) ok(T(() => L.moveMatch(f.roundIndex, f.mi, -1)) instanceof Error, game + " edge rejected");
  // snapshot round-trips
  const snap = JSON.parse(JSON.stringify(L.saveStateSnapshot()));
  ok(L.loadStateSnapshot(snap).ok, game + " snapshot ok");
}
// knockouts are fixed
for (const game of ["football", "table-tennis"]) {
  const p = path.join(__dirname, "..", "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  const r = T(() => setup(L, game, "elim", ["A","B","C","D","E","F","G","H"].map(x => x + game.slice(0,1))));
  if (r instanceof Error) { console.log("elim setup", game, r.message); fail++; continue; }
  const ms = L.listMatches();
  ok(ms.length > 0 && ms.every(m => !m.canUp && !m.canDown), game + " knockout has no moves");
  ok(T(() => L.moveMatch(0, 0, 1)) instanceof Error, game + " knockout move rejected");
}
// hybrid brackets are positionally wired — locked too
for (const game of ["football", "table-tennis"]) {
  const p = path.join(__dirname, "..", "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  const r = T(() => setup(L, game, "hybrid", ["A","B","C","D","E","F"].map(x => x + game.slice(0,1))));
  if (r instanceof Error) { console.log("hybrid setup", game, r.message); fail++; continue; }
  const ms = L.listMatches();
  ok(ms.every(m => !m.canUp && !m.canDown), game + " hybrid has no moves");
  ok(T(() => L.moveMatch(0, 0, 1)) instanceof Error, game + " hybrid move rejected");
}
// bad references and directions
for (const game of ["football", "table-tennis"]) {
  const p = path.join(__dirname, "..", "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  const r = T(() => setup(L, game, "rr", ["A","B","C","D"].map(x => x + game.slice(0,1))));
  if (r instanceof Error) { console.log("edge setup", game, r.message); fail++; continue; }
  ok(T(() => L.moveMatch(0, 0, 0)) instanceof Error, game + " dir 0 rejected");
  ok(T(() => L.moveMatch(0, 0, 2)) instanceof Error, game + " dir 2 rejected");
  ok(T(() => L.moveMatch(0, 99, -1)) instanceof Error, game + " bad mi rejected");
  ok(T(() => L.moveMatch(-1, 0, -1)) instanceof Error, game + " bad round rejected");
  ok(T(() => L.moveMatch(0, 0, -1)) instanceof Error, game + " top edge rejected");
  const lastRi = L.getState().schedule.rounds.length - 1;
  ok(T(() => L.moveMatch(lastRi, 0, 1)) instanceof Error, game + " bottom edge rejected");
  // a small league still swaps even when every partner shares an entrant
  const all = L.listMatches().filter(m => !m.bye);
  const deep = all[all.length - 1];
  const r2 = T(() => L.moveMatch(deep.roundIndex, deep.mi, -1));
  ok(!(r2 instanceof Error), game + " small league overlap swap ok " + (r2 && r2.message));
  const moved = L.listMatches().find(m => m.a === deep.a && m.b === deep.b);
  ok(moved && moved.roundIndex === deep.roundIndex - 1, game + " overlap swap landed");
  const flat = L.getState().schedule.rounds.flat().map(m => m.a + "-" + m.b);
  ok(new Set(flat).size === flat.length, game + " overlap swap keeps the fixture set");
}
// moving into a completed round is refused (no free partner)
for (const game of ["football", "table-tennis"]) {
  const p = path.join(__dirname, "..", "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  const r = T(() => setup(L, game, "rr", ["A","B","C","D","E","F"].map(x => x + game.slice(0,1))));
  if (r instanceof Error) { console.log("full setup", game, r.message); fail++; continue; }
  // play the whole live round, advance, then probe the round borders
  const ri = L.getState().roundIndex;
  const round = L.getState().schedule.rounds[ri];
  for (let mi = 0; mi < round.length; mi++) {
    if (game === "football") T(() => L.saveScore(mi, 2, 1));
    else T(() => L.saveScore(mi, 11, 4, [{ sa: 11, sb: 4 }, { sa: 9, sb: 11 }, { sa: 11, sb: 6 }]));
  }
  T(() => L.continueTournament());
  const cur = L.getState().roundIndex;
  ok(cur > ri, game + " advanced past the completed round");
  // the completed round behind the live one offers no free partner
  const liveRow = L.listMatches().filter(m => m.roundIndex === cur && !m.bye);
  ok(liveRow.length > 0 && liveRow.every(m => !m.canUp), game + " no moving back into a completed round");
  // but a later fixture can still be pulled into the live round
  const up = L.listMatches().find(m => m.roundIndex > cur && m.canUp);
  ok(!!up, game + " a later fixture can still be pulled forward");
  if (up) {
    const e = T(() => L.moveMatch(up.roundIndex, up.mi, -1));
    ok(!(e instanceof Error), game + " moving into the live round works " + (e && e.message));
    const moved = L.listMatches().find(m => m.a === up.a && m.b === up.b);
    ok(moved && moved.roundIndex === cur, game + " pulled into the live round");
  }
}
// undo still works after a move lands in the live round
for (const game of ["football", "table-tennis"]) {
  const p = path.join(__dirname, "..", "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  const r = T(() => setup(L, game, "rr", ["A","B","C","D","E","F"].map(x => x + game.slice(0,1))));
  if (r instanceof Error) { console.log("undo setup", game, r.message); fail++; continue; }
  const all = L.listMatches().filter(m => !m.bye);
  const last = all[all.length - 1];
  let guard = 0, cur = last;
  while (cur.roundIndex > L.getState().roundIndex && guard++ < 100) {
    T(() => L.moveMatch(cur.roundIndex, cur.mi, -1));
    cur = L.listMatches().find(m => m.a === last.a && m.b === last.b);
  }
  const ri = L.getState().roundIndex;
  const mi = L.getState().schedule.rounds[ri].findIndex(m => m.a === last.a && m.b === last.b);
  const s = T(() => game === "football" ? L.saveScore(mi, 2, 1) : L.saveScore(mi, 11, 4, [{ sa: 11, sb: 4 }, { sa: 9, sb: 11 }, { sa: 11, sb: 6 }]));
  ok(!(s instanceof Error), game + " undo-setup score ok " + (s && s.message));
  const u = T(() => L.undoScore());
  ok(!(u instanceof Error), game + " undo works after a move " + (u && u.message));
  const back = L.listMatches().find(m => m.a === last.a && m.b === last.b);
  ok(back && !back.played && back.roundIndex === ri, game + " undone match sits unplayed where it landed");
}
// pools: no swapping across pool boundaries
for (const game of ["football", "table-tennis"]) {
  const p = path.join(__dirname, "..", "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  let r;
  if (game === "football") {
    ["A","B","C","D","E","F"].forEach((n, i) => L.addTeam(n + " FC", "Cap" + i, []));
    r = T(() => L.submitRoster("format: pools\npools: 2\nqualify: 1", "Pool Cup", 90, 15));
  } else {
    r = T(() => L.submitRoster("format: pools\npools: 2\nA p\nB p\nC p\nD p\nE p\nF p", "Pool Cup", 11));
    if (!(r instanceof Error) && L.getState().step === "mode") r = T(() => L.pickMode("single"));
  }
  if (r instanceof Error) { console.log("pool setup", game, r.message); fail++; continue; }
  const S = L.getState();
  const st = S.stages[0];
  ok(st && st.type === "pools" && st.pools.length === 2, game + " two pools drawn");
  if (!(st && st.pools && st.pools.length === 2)) continue;
  const p0end = st.pools[0].roundStart + st.pools[0].roundCount - 1; // last round of pool 1
  const m = L.listMatches().find(x => x.roundIndex === p0end && !x.bye);
  // the round after the last pool-1 round belongs to pool 2: pushing down must fail
  const e = T(() => L.moveMatch(p0end, m.mi, 1));
  ok(e instanceof Error && /another pool/.test(e.message), game + " cross-pool push refused " + (e && e.message));
  const flags = L.listMatches().find(x => x.roundIndex === p0end && !x.bye);
  ok(flags && !flags.canDown, game + " cross-pool flag off");
  // inside the same pool it still works
  if (p0end > st.pools[0].roundStart) {
    const e2 = T(() => L.moveMatch(p0end, m.mi, -1));
    ok(!(e2 instanceof Error), game + " in-pool move ok " + (e2 && e2.message));
  }
}
// snapshot preserves the moved positions
for (const game of ["football", "table-tennis"]) {
  const p = path.join(__dirname, "..", "apps", game, "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  const r = T(() => setup(L, game, "rr", ["A","B","C","D","E","F"].map(x => x + game.slice(0,1))));
  if (r instanceof Error) { console.log("snap setup", game, r.message); fail++; continue; }
  const all = L.listMatches().filter(m => !m.bye);
  const last = all[all.length - 1];
  T(() => L.moveMatch(last.roundIndex, last.mi, -1));
  const moved = L.listMatches().find(m => m.a === last.a && m.b === last.b);
  const snap = JSON.parse(JSON.stringify(L.saveStateSnapshot()));
  const load = T(() => L.loadStateSnapshot(snap));
  ok(!(load instanceof Error) && load && load.ok, game + " snapshot after move ok");
  const after = L.listMatches().find(m => m.a === last.a && m.b === last.b);
  ok(after && after.roundIndex === moved.roundIndex && after.mi === moved.mi, game + " snapshot keeps the moved slot");
}
// football: a running clock locks the fixture; a paused clock travels with it
{
  const p = path.join(__dirname, "..", "apps", "football", "logic.js");
  delete require.cache[require.resolve(p)];
  const L = require(p);
  const r = T(() => setup(L, "football", "rr", ["A","B","C","D","E","F"].map(x => x + " FB")));
  if (r instanceof Error) { console.log("clock setup error", r.message); fail++; }
  else {
    const all = L.listMatches().filter(m => !m.bye);
    const m = all[0]; // live round fixture
    const S = L.getState();
    const pl = { seed: S.seed, roundIndex: m.roundIndex, mi: m.mi, a: m.a, b: m.b, revision: 0 };
    const start = T(() => L.controlClock({ ...pl, action: "start" }));
    ok(!(start instanceof Error), "fb clock start ok " + (start && start.message));
    const locked = L.listMatches().find(x => x.id === m.id);
    ok(locked && !locked.canUp && !locked.canDown && /Stop the match clock/.test(locked.moveReason || ""), "fb running clock locks the fixture");
    const e = T(() => L.moveMatch(m.roundIndex, m.mi, 1));
    ok(e instanceof Error && /Stop the match clock/.test(e.message), "fb moving a ticking fixture refused");
    const pause = T(() => L.controlClock({ ...pl, revision: 1, action: "pause" }));
    ok(!(pause instanceof Error), "fb clock pause ok " + (pause && pause.message));
    // a paused clock with live goals travels with the fixture
    const goals = T(() => L.updateLiveGoals({ ...pl, revision: 2, goals: [{ min: 12, team: m.a, scorer: "Cap0", own: false }] }));
    ok(!(goals instanceof Error), "fb live goal ok " + (goals && goals.message));
    const move = T(() => L.moveMatch(m.roundIndex, m.mi, 1));
    ok(!(move instanceof Error), "fb a paused fixture moves " + (move && move.message));
    const carried = L.listMatches().find(x => x.a === m.a && x.b === m.b);
    ok(carried && carried.roundIndex === m.roundIndex + 1, "fb moved down a round");
    ok(carried && carried.live && carried.live.goals.length === 1 && carried.live.goals[0].scorer === "Cap0", "fb the clock and goal travelled with it");
    const live2 = T(() => L.controlClock({ ...carried, seed: S.seed, revision: 3, action: "start" }));
    ok(!(live2 instanceof Error), "fb the clock restarts at the new slot " + (live2 && live2.message));
  }
}
console.log("pass", pass, "fail", fail);
process.exit(fail ? 1 : 0);
