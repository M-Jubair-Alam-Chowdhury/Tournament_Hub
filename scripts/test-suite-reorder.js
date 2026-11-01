/* Match reordering: moving an unplayed match into the current round
   puts it Live; knockouts/finals/played matches are locked. */
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
  const s = T(() => game === "football" ? L.saveScore(mi, 2, 1) : L.saveScore(mi, 11, 4));
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
console.log("pass", pass, "fail", fail);
process.exit(fail ? 1 : 0);
