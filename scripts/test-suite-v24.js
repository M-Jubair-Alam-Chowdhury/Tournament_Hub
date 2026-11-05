/* M11 — v2.4 suite: adjustable qualifiers (setAdvance / setPoolQualify),
   goal sheets after the final whistle (editGoalsAt), and the golden
   boot tally that refreshes with every saved match. Logic sections run
   straight against apps/football/logic.js; the wire section boots the
   real hub server and drives the actions over WebSocket, including the
   season-archive refresh after a post-champion goal edit. */
"use strict";
const path = require("path");
const LOGIC = path.join(__dirname, "..", "apps", "football", "logic.js");

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

/* ---- logic harness ---- */
const logic = require(LOGIC);
function teamsF(list, directives, opts) {
  logic.reset();
  (list || []).forEach(t => logic.addTeam(t.name, t.captain || ("C" + t.name), t.players || []));
  logic.submitRoster(directives || "", opts && opts.name, opts && opts.duration, opts && opts.breakMins);
  const S = logic.getState();
  if (S.step === "mode") logic.pickMode("single");
  return logic.getState();
}
const T = n => ({ name: n });
const P = i => "P" + i;
function playAll(winSide) {
  // score every unplayed real match in the CURRENT round, then continue;
  // stops at any non-play step (stageChoice / standings)
  let guard = 0;
  while (guard++ < 60) {
    const S = logic.getState();
    if (S.step !== "play") break;
    const round = S.schedule.rounds[S.roundIndex] || [];
    round.forEach((m, mi) => {
      if (!m.played && m.a !== "BYE" && m.b !== "BYE") {
        try {
          if (winSide === "a") logic.saveScore(mi, 2, 0);
          else if (winSide === "b") logic.saveScore(mi, 0, 2);
          else logic.saveScore(mi, 1, 1);
        } catch (_) {}
      }
    });
    try { logic.continueTournament(); } catch (_) { break; }
  }
  return logic.getState();
}
const lastEvent = () => {
  const ev = logic.getState().events || [];
  return ev.length ? ev[ev.length - 1].text : "";
};
const findRow = (ri, mi) => logic.listMatches().find(x => x.roundIndex === ri && x.mi === mi);

/* ============ A. setAdvance — the live cut line ============ */
section("A. setAdvance — how many leave the round robin");
{
  const five = [T("Reds"), T("Blues"), T("Greens"), T("Yellows"), T("Pinks")];

  // A1 the setting moves with matches already played
  {
    teamsF(five);
    logic.pickStage({ format: "rr", advance: 4 });
    logic.saveScore(0, 2, 1); // one match played
    const r = logic.setAdvance(2);
    const S = logic.getState();
    ok(r && r.advance === 2 && r.entrants === 5, "A1a setAdvance returns the new cut");
    ok(S.stages[0].advance === 2, "A1b the stage now advances top 2");
    ok(S.schedule.rounds[0][0].played && S.schedule.rounds[0][0].scoreA === 2, "A1c the played match is untouched");
    ok(/Qualifiers set: top 2 of 5 advance/.test(lastEvent()), "A1d the decision is logged");
    ok(/was top 4/.test(lastEvent()), "A1e the previous setting is logged too");
  }

  // A2 guard rails
  {
    teamsF(five);
    logic.pickStage({ format: "rr", advance: 4 });
    throwsMsg(() => logic.setAdvance(1), /2 or more/, "A2a advance below 2 rejected");
    throwsMsg(() => logic.setAdvance(5), /can't advance 5/, "A2b advance = every entrant rejected");
    throwsMsg(() => logic.setAdvance("x"), /2 or more/, "A2c non-numeric rejected");
    throwsMsg(() => logic.setAdvance(4), /setting already/, "A2d the same number is a no-op");
  }

  // A3 clearing the number finishes the tournament at this stage
  {
    teamsF(five);
    logic.pickStage({ format: "rr", advance: 4 });
    logic.setAdvance(null);
    const S = logic.getState();
    ok(S.stages[0].advance === null, "A3a clearing leaves advance null");
    ok(/finishes here/.test(lastEvent()), "A3b the finish-here decision is logged");
  }

  // A4 after the boundary fired the stage is sealed
  {
    teamsF(five);
    logic.pickStage({ format: "rr", advance: 2 });
    const S1 = playAll("a");
    ok(S1.step === "stageChoice", "A4a the rr completed onto the choice screen");
    throwsMsg(() => logic.setAdvance(3), /already decided/, "A4b setAdvance is refused after the boundary");
  }

  // A5 THE case: the whole round robin is played, the last round sits
  // scored waiting on Continue — and the cut still moves
  {
    teamsF(five);
    logic.pickStage({ format: "rr", advance: 4 });
    // play every round but stop before the Continue that fires the boundary
    let guard = 0;
    while (guard++ < 60) {
      const S = logic.getState();
      if (S.step !== "play") break;
      const round = S.schedule.rounds[S.roundIndex] || [];
      const allPlayed = round.every(m => m.played || m.a === "BYE" || m.b === "BYE");
      if (allPlayed && S.roundIndex === S.schedule.rounds.length - 1) break; // last round done, hold
      round.forEach((m, mi) => { if (!m.played && m.a !== "BYE" && m.b !== "BYE") { try { logic.saveScore(mi, 2, 0); } catch (_) {} } });
      if (allPlayed) { try { logic.continueTournament(); } catch (_) { break; } }
    }
    const held = logic.getState();
    ok(held.step === "play" && held.roundIndex === held.schedule.rounds.length - 1
      && held.schedule.rounds[held.roundIndex].every(m => m.played), "A5a every match scored, boundary not yet fired");
    logic.setAdvance(2);
    const S2 = playAll("a");
    // playAll continues past the held round → boundary fires with top 2
    ok(S2.step === "stageChoice" && S2.stageChoice && S2.stageChoice.entrants.length === 2,
      "A5b the boundary took the LATE setting: exactly 2 advanced (got " + (S2.stageChoice ? S2.stageChoice.entrants.length : "?") + ")");
  }

  // A6 clearing on a finished-here rr crowns the table leader
  {
    teamsF(five);
    logic.pickStage({ format: "rr", advance: 2 });
    let guard = 0;
    while (guard++ < 60) {
      const S = logic.getState();
      if (S.step !== "play") break;
      const round = S.schedule.rounds[S.roundIndex] || [];
      const allPlayed = round.every(m => m.played || m.a === "BYE" || m.b === "BYE");
      if (allPlayed && S.roundIndex === S.schedule.rounds.length - 1) break;
      round.forEach((m, mi) => { if (!m.played && m.a !== "BYE" && m.b !== "BYE") { try { logic.saveScore(mi, 2, 0); } catch (_) {} } });
      if (allPlayed) { try { logic.continueTournament(); } catch (_) { break; } }
    }
    logic.setAdvance(null);
    const S = playAll("a");
    ok(S.step === "standings" && S.champion === P(1), "A6a clearing crowns the table leader (P1 won every match)");
  }

  // A7 a changed cut survives a snapshot round-trip
  {
    teamsF(five);
    logic.pickStage({ format: "rr", advance: 4 });
    logic.saveScore(0, 1, 0);
    logic.setAdvance(3);
    const snap = logic.saveStateSnapshot();
    logic.reset();
    const res = logic.loadStateSnapshot(snap);
    ok(res.ok && logic.getState().stages[0].advance === 3, "A7a the live cut survives save/load");
    ok(logic.getState().schedule.rounds[0][0].scoreA === 1, "A7b the played match survives with it");
  }

  // A8 the rank order is refreshed with the new cut in place
  {
    teamsF(five);
    logic.pickStage({ format: "rr", advance: 4 });
    logic.saveScore(0, 3, 0);
    logic.setAdvance(2);
    const ro = logic.getState().rankOrder;
    ok(Array.isArray(ro) && ro.length === 5 && new Set(ro).size === 5, "A8a rankOrder is a permutation of the entrants");
  }

  // A9 wrong stages / steps refuse the setting
  {
    teamsF(five);
    logic.pickStage({ format: "elim" });
    throwsMsg(() => logic.setAdvance(2), /isn't a round robin/, "A9a an elimination stage refuses setAdvance");
    logic.reset();
    throwsMsg(() => logic.setAdvance(2), /while the stage is running/, "A9b the roster step refuses setAdvance");
  }
}

/* ============ B. setPoolQualify — the per-pool cut line ============ */
section("B. setPoolQualify — pool winners, adjustable mid-flight");
{
  const six = [T("Alpha"), T("Beta"), T("Gamma"), T("Delta"), T("Epsilon"), T("Zeta")];

  // B1 a pool's count moves with matches already played
  {
    teamsF(six);
    logic.pickStage({ format: "pools", pools: [
      { name: "East", members: [P(1), P(2), P(3)], qualify: 1 },
      { name: "West", members: [P(4), P(5), P(6)], qualify: 1 }
    ] });
    logic.saveScore(0, 2, 0); // one pool match played
    const r = logic.setPoolQualify(1, 2);
    ok(r && r.pool === 1 && r.qualify === 2, "B1a setPoolQualify returns the change");
    ok(logic.getState().stages[0].pools[1].qualify === 2, "B1b the pool now qualifies 2");
    ok(/Pool West: top 2 qualif/.test(lastEvent()), "B1c the decision is logged");
  }

  // B2 guard rails
  {
    teamsF(six);
    logic.pickStage({ format: "pools", pools: [
      { members: [P(1), P(2), P(3)], qualify: 1 },
      { members: [P(4), P(5), P(6)], qualify: 2 }
    ] });
    throwsMsg(() => logic.setPoolQualify(0, 0), /between 1 and 2/, "B2a qualify 0 rejected");
    throwsMsg(() => logic.setPoolQualify(0, 3), /between 1 and 2/, "B2b qualify = pool size rejected");
    throwsMsg(() => logic.setPoolQualify(9, 1), /doesn't exist/, "B2c a missing pool rejected");
    throwsMsg(() => logic.setPoolQualify(0, 1), /setting already/, "B2d the same count is a no-op");
    throwsMsg(() => logic.setAdvance(2), /isn't a round robin/, "B2e setAdvance refuses a pools stage");
  }

  // B3 a pool that already decided is locked
  {
    teamsF(six);
    logic.pickStage({ format: "pools", pools: [
      { name: "East", members: [P(1), P(2), P(3)], qualify: 1 },
      { name: "West", members: [P(4), P(5), P(6)], qualify: 1 }
    ] });
    // East rounds come first: play through them so East decides
    let guard = 0;
    while (guard++ < 30) {
      const S = logic.getState();
      if (S.step !== "play") break;
      const round = S.schedule.rounds[S.roundIndex] || [];
      const stage = S.stages[S.stageIndex];
      const east = stage.pools[0];
      const inEast = S.roundIndex >= east.roundStart && S.roundIndex < east.roundStart + east.roundCount;
      const allPlayed = round.every(m => m.played || m.a === "BYE" || m.b === "BYE");
      if (!inEast) break; // East block finished
      round.forEach((m, mi) => { if (!m.played && m.a !== "BYE" && m.b !== "BYE") { try { logic.saveScore(mi, 2, 0); } catch (_) {} } });
      if (allPlayed) { try { logic.continueTournament(); } catch (_) { break; } }
    }
    throwsMsg(() => logic.setPoolQualify(0, 2), /already decided/, "B3a a decided pool is locked");
    noThrowB4();
    function noThrowB4() {
      // West is still open — its cut moves
      let m = null;
      try { logic.setPoolQualify(1, 2); } catch (e) { m = e.message; }
      ok(m == null, "B3b the undecided pool still moves (threw " + (m || "nothing") + ")");
    }
  }

  // B4 the late cut is what the boundary takes (journey)
  {
    teamsF(six);
    logic.pickStage({ format: "pools", pools: [
      { name: "East", members: [P(1), P(2), P(3)], qualify: 1 },
      { name: "West", members: [P(4), P(5), P(6)], qualify: 1 }
    ] });
    logic.saveScore(0, 2, 0); // some play already in
    logic.setPoolQualify(1, 2); // West now sends TWO
    const S = playAll("a");
    ok(S.step === "stageChoice" && S.stageChoice && S.stageChoice.entrants.length === 3,
      "B4a the boundary took the late per-pool cut: 1 + 2 = 3 advanced (got " + (S.stageChoice ? S.stageChoice.entrants.length : "?") + ")");
    const snap = logic.saveStateSnapshot();
    logic.reset();
    const res = logic.loadStateSnapshot(snap);
    ok(res.ok && logic.getState().stages[0].pools[1].qualify === 2, "B4b the per-pool cut survives a snapshot");
  }
}

/* ============ C. editGoalsAt — goal sheets after the whistle ============ */
section("C. editGoalsAt — who scored, even after the match finished");
{
  const four = [
    { name: "Reds", captain: "Rcap", players: ["R1", "R2"] },
    { name: "Blues", captain: "Bcap", players: ["B1", "B2"] },
    { name: "Greens", captain: "Gcap", players: ["G1", "G2"] },
    { name: "Yellows", captain: "Ycap", players: ["Y1", "Y2"] }
  ];
  const g = (min, team, scorer, own) => ({ min, team, scorer, own: !!own });
  // the RR pairing order isn't fixed — look each side's squad up
  const teamOf = code => {
    const S = logic.getState();
    return four.find(x => x.name === S.labelOf[code]) || null;
  };
  const capOf = code => { const t = teamOf(code); return t ? t.captain : null; };
  const playerOf = (code, i) => { const t = teamOf(code); return t ? (t.players[i] || t.captain) : null; };

  // C1 the plain case: a finished match with no sheet gets one
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    logic.saveScore(0, 2, 1, null, null, null); // no goal sheet
    const m0 = logic.getState().schedule.rounds[0][0];
    ok(m0.played && !(m0.goals && m0.goals.length), "C1a the match finished without a sheet");
    const tableBefore = JSON.stringify(logic.getState().table);
    const rankBefore = JSON.stringify(logic.getState().rankOrder);
    logic.editGoalsAt(0, 0, [g(10, m0.a, capOf(m0.a)), g(30, m0.a, playerOf(m0.a, 0)), g(70, m0.b, capOf(m0.b))]);
    const S = logic.getState();
    const m1 = S.schedule.rounds[0][0];
    eqv(m1.goals, [{ min: 10, team: m0.a, scorer: capOf(m0.a), own: false }, { min: 30, team: m0.a, scorer: playerOf(m0.a, 0), own: false }, { min: 70, team: m0.b, scorer: capOf(m0.b), own: false }], "C1b the sheet lands after the whistle");
    ok(JSON.stringify(S.table) === tableBefore, "C1c the table is untouched");
    ok(JSON.stringify(S.rankOrder) === rankBefore, "C1d the ladder is untouched");
    ok(/Goal sheet added/.test(lastEvent()), "C1e the edit is logged");
    const tally = logic.scorerTally();
    ok(tally.some(x => x.name === capOf(m0.a) && x.goals === 1) && tally.some(x => x.name === playerOf(m0.a, 0) && x.goals === 1) && tally.some(x => x.name === capOf(m0.b) && x.goals === 1), "C1f the tally picks the scorers up");
  }

  // C2 THE case: the stage already moved on — the sheet still lands
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    const S1 = playAll("a");
    ok(S1.step === "stageChoice", "C2a the tournament moved past the round robin");
    const row = findRow(0, 0);
    ok(row.played && !(row.goals && row.goals.length), "C2b round 1's first match has no sheet yet");
    const m = S1.schedule.rounds[0][0];
    logic.editGoalsAt(0, 0, [g(5, m.a, capOf(m.a)), g(70, m.a, capOf(m.a))]);
    ok((logic.getState().schedule.rounds[0][0].goals || []).length === 2, "C2c the sheet lands after the boundary fired");
  }

  // C3 after the champion is crowned — and the record carries it
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    const S1 = playAll("a"); // rr done
    logic.pickStage({ format: "elim" });
    const S2 = playAll("a"); // knockout done
    ok(S2.step === "standings" && S2.champion, "C3a a champion was crowned");
    const m = S2.schedule.rounds[0][0];
    logic.editGoalsAt(0, 0, [g(12, m.a, capOf(m.a)), g(88, m.a, capOf(m.a))]);
    const rec = logic.getTournamentRecord();
    const first = rec.matches.find(x => x.round === 1);
    eqv(first.goals.map(x => [x.min, x.scorer]), [[12, capOf(m.a)], [88, capOf(m.a)]], "C3b the season record carries the post-champion sheet");
  }

  // C4 corrections replace the sheet; undo restores it
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    const m = logic.getState().schedule.rounds[0][0];
    const capA = capOf(m.a), capB = capOf(m.b);
    const other = playerOf(m.a, 0);
    logic.saveScore(0, 2, 1, null, null, [g(10, m.a, capA), g(25, m.a, other), g(40, m.b, capB)]);
    logic.editGoalsAt(0, 0, [g(10, m.a, capA), g(22, m.a, other), g(40, m.b, capB)]);
    const m1 = logic.getState().schedule.rounds[0][0];
    eqv(m1.goals.map(x => [x.min, x.scorer]), [[10, capA], [22, other], [40, capB]], "C4a a corrected sheet replaces the old one");
    logic.undoEdit();
    const m2 = logic.getState().schedule.rounds[0][0];
    eqv(m2.goals.map(x => [x.min, x.scorer]), [[10, capA], [25, other], [40, capB]], "C4b undoEdit restores the previous sheet");
  }

  // C4b a goal edit's undo is SURGICAL: nothing played after it moves.
  // Edit a sheet, play the rest of the round robin, crown a champion —
  // then undo: only the sheet reverts; every later result stands.
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    const m = logic.getState().schedule.rounds[0][0];
    const capA = capOf(m.a);
    logic.saveScore(0, 2, 0, null, null, [g(10, m.a, capA), g(30, m.a, capA)]);
    logic.editGoalsAt(0, 0, [g(10, m.a, capA), g(30, m.a, playerOf(m.a, 0))]);
    const S1 = playAll("a");          // finish the round robin
    logic.pickStage({ format: "elim" });
    const S2 = playAll("a");          // crown the champion
    ok(S2.step === "standings" && S2.champion, "C4c a champion was crowned after the goal edit");
    const champion = S2.champion;
    const playedCount = S2.matchIndex ? S2.matchIndex.played : logic.listMatches().filter(x => x.played).length;
    logic.undoEdit();
    const S3 = logic.getState();
    ok(S3.step === "standings" && S3.champion === champion, "C4d the goal-edit undo keeps the champion and the step");
    const playedAfter = S3.matchIndex ? S3.matchIndex.played : logic.listMatches().filter(x => x.played).length;
    ok(playedAfter === playedCount, "C4e every match played after the edit stays played (" + playedAfter + "/" + playedCount + ")");
    eqv(S3.schedule.rounds[0][0].goals.map(x => [x.min, x.scorer]), [[10, capA], [30, capA]], "C4f only the edited sheet reverted");
  }

  // C5 guard rails
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    const m = logic.getState().schedule.rounds[0][0];
    const capA = capOf(m.a), capB = capOf(m.b);
    const plA = playerOf(m.a, 0);
    const full = [g(10, m.a, capA), g(25, m.a, plA), g(40, m.b, capB)];
    logic.saveScore(0, 2, 1, null, null, full);
    throwsMsg(() => logic.editGoalsAt(0, 0, full), /already saved/, "C5a a no-op edit is rejected");
    throwsMsg(() => logic.editGoalsAt(0, 0, [g(10, m.a, capA)]), /doesn't add up/, "C5b a short sheet is rejected");
    throwsMsg(() => logic.editGoalsAt(0, 0, [g(10, m.a, capA), g(40, m.a, capB, true)]), /doesn't add up/, "C5c a wrong-side sheet is rejected (own-goal credit)");
    throwsMsg(() => logic.editGoalsAt(0, 0, [g(10, m.a, "Nobody"), g(40, m.a, "Nobody2", true)]), /isn't in .* squad/, "C5d a scorer outside the squad is rejected");
    throwsMsg(() => logic.editGoalsAt(0, 0, "junk"), /malformed/, "C5e a malformed sheet is rejected");
    throwsMsg(() => logic.editGoalsAt(0, 0, full, 99), /another session/, "C5f a stale scoreVersion is rejected");
    throwsMsg(() => logic.editGoalsAt(0, 1, [g(10, m.a, capA)]), /hasn't been scored/, "C5g an unplayed match refuses a sheet");
    logic.reset();
    throwsMsg(() => logic.editGoalsAt(0, 0, []), /while the tournament is running/, "C5h the roster step refuses the edit");
  }

  // C6 own goals: credited to the benefiting side's tally as og
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    const m = logic.getState().schedule.rounds[0][0];
    const capA = capOf(m.a), capB = capOf(m.b);
    logic.saveScore(0, 2, 0, null, null, null);
    logic.editGoalsAt(0, 0, [g(10, m.a, capA), g(55, m.a, capB, true)]); // B's captain own goal, counts for A
    const tally = logic.scorerTally();
    const og = tally.find(x => x.name === capB);
    ok(og && og.goals === 0 && og.own === 1, "C6a an own goal tallies under og, not goals");
    ok(tally.some(x => x.name === capA && x.goals === 1 && x.own === 0), "C6b the regular goal tallies normally");
  }

  // C7 the match index exposes the flag the UI keys on
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    logic.saveScore(0, 1, 0);
    const row = findRow(0, 0);
    ok(row.goalEditable === true, "C7a a played match is goalEditable on the wire");
    ok(findRow(0, 1).goalEditable === false, "C7b an unplayed match is not");
  }

  // C8 a forfeited match is not goal-editable
  {
    teamsF(four);
    logic.pickStage({ format: "elim" });
    const S = logic.getState();
    // withdraw one semifinalist → their match becomes a 3-0 walkover
    const m = S.schedule.rounds[0][0];
    logic.withdrawPlayer(m.a);
    const S2 = logic.getState();
    const wo = S2.schedule.rounds[0].find(x => x.forfeit);
    if (wo) {
      const row = findRow(0, S2.schedule.rounds[0].indexOf(wo));
      ok(row && row.goalEditable === false, "C8a a walkover is not goalEditable");
      throwsMsg(() => logic.editGoalsAt(0, S2.schedule.rounds[0].indexOf(wo), []), /walkover has no scorers/, "C8b the engine refuses a walkover sheet");
    } else {
      ok(false, "C8a setup failed — no walkover produced");
    }
  }
}

/* ============ D. the golden boot tally (auto-refresh) ============ */
section("D. the golden boot tally — refreshes with every saved match");
{
  const four = [
    { name: "Reds", captain: "Rcap", players: ["R1", "R2"] },
    { name: "Blues", captain: "Bcap", players: ["B1"] },
    { name: "Greens", captain: "Gcap", players: ["G1"] },
    { name: "Yellows", captain: "Ycap", players: ["Y1"] }
  ];
  const g = (min, team, scorer, own) => ({ min, team, scorer, own: !!own });
  const teamOf = code => four.find(x => x.name === logic.getState().labelOf[code]) || null;
  const capOf = code => { const t = teamOf(code); return t ? t.captain : null; };
  const playerOf = (code, i) => { const t = teamOf(code); return t ? (t.players[i] || t.captain) : null; };

  // D1 the wire carries the tally after every save — no extra action
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    ok(logic.getStateForWire().scorers.length === 0, "D1a the tally starts empty");
    const m0 = logic.getState().schedule.rounds[0][0];
    const m0a = capOf(m0.a), m0a2 = playerOf(m0.a, 0);
    logic.saveScore(0, 2, 0, null, null, [g(9, m0.a, m0a), g(60, m0.a, m0a)]);
    let wire = logic.getStateForWire();
    ok(wire.scorers.length === 1 && wire.scorers[0].name === m0a && wire.scorers[0].goals === 2, "D1b one saved match → the tally updates");
    const m1 = logic.getState().schedule.rounds[0][1];
    logic.saveScore(1, 1, 1, null, null, [g(20, m1.a, capOf(m1.a)), g(80, m1.b, capOf(m1.b))]);
    wire = logic.getStateForWire();
    ok(wire.scorers.length === 3, "D1c the second saved match grows the tally");
    ok(wire.scorers[0].name === m0a && wire.scorers[0].goals === 2, "D1d sorted: the top scorer leads");
    // a post-whistle edit refreshes it too
    logic.editGoalsAt(0, 0, [g(9, m0.a, m0a), g(60, m0.a, m0a2)]);
    wire = logic.getStateForWire();
    const fixed = wire.scorers.find(x => x.name === m0a2);
    ok(fixed && fixed.goals === 1, "D1e a scorer fix refreshes the tally");
  }

  // D2 the tally feeds the team profile shape (name, teamName, goals, own)
  {
    teamsF(four);
    logic.pickStage({ format: "rr", advance: 2 });
    const m0 = logic.getState().schedule.rounds[0][0];
    logic.saveScore(0, 1, 1, null, null, [g(9, m0.a, capOf(m0.a)), g(90, m0.b, capOf(m0.b))]);
    const s = logic.getStateForWire().scorers;
    ok(s.every(x => x.teamName && x.name && typeof x.goals === "number" && typeof x.own === "number"), "D2a every tally row is profile-ready");
  }
}

/* ============ E. over the wire + the season re-record ============ */
(async () => {
  const { spawn } = require("child_process");
  const fs = require("fs");
  const http = require("http");
  const WebSocket = require("ws");
  const HUB = path.join(__dirname, "..");

  const PORT = 4207;
  const DIR = "/tmp/m11-v24";
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
  const getJson = (p) => new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
      let b = ""; r.on("data", c => b += c); r.on("end", () => res(JSON.parse(b)));
    }).on("error", rej);
  });
  function openWs(wsPath) {
    return new Promise((res, rej) => {
      const ws = new WebSocket("ws://127.0.0.1:" + PORT + wsPath);
      const conn = {
        ws, messages: [], latest: null, errors: [], role: null,
        waitFor: (pred, ms) => new Promise((r2, rj2) => {
          const check = () => { try { return !!pred(conn); } catch (_) { return false; } };
          if (check()) return r2(true);
          const timer = setInterval(() => { if (check()) { clearInterval(timer); r2(true); } }, 20);
          setTimeout(() => { clearInterval(timer); rj2(new Error("waitFor timeout")); }, ms || 5000);
        })
      };
      ws.on("message", d => {
        const m = JSON.parse(d);
        conn.messages.push(m);
        if (m.type === "welcome" || m.type === "state") { if (m.role) conn.role = m.role; if (m.state) conn.latest = m.state; }
        else if (m.type === "error") conn.errors.push(m.message);
        else if (m.type === "authOk") conn.role = "admin";
      });
      ws.on("open", () => setTimeout(() => res(conn), 150));
      ws.on("error", rej);
    });
  }
  const send = (conn, type, payload) => conn.ws.send(JSON.stringify({ type, payload: payload || {} }));

  section("E. over the wire: qualifiers, scorer sheets, the archive");
  const child = await boot(PORT, DIR);
  try {
    const admin = await openWs("/football/");
    ok(admin.role === "admin", "E1 the football admin seat opens");

    // four squads with real player lists
    const SQUADS = [
      { teamName: "Reds", captain: "Rcap", players: "R1\nR2" },
      { teamName: "Blues", captain: "Bcap", players: "B1\nB2" },
      { teamName: "Greens", captain: "Gcap", players: "G1\nG2" },
      { teamName: "Yellows", captain: "Ycap", players: "Y1\nY2" }
    ];
    for (const t of SQUADS) {
      send(admin, "addTeam", t);
      await admin.waitFor(c => (c.latest.teams || []).some(x => x.name === t.teamName));
    }
    const wireTeam = code => {
      const st = admin.latest;
      const nm = st.labelOf[code];
      return (st.teams || []).find(x => x.name === nm) || null;
    };
    const wireCap = code => { const t = wireTeam(code); return t ? t.captain : null; };
    const wirePlayer = (code, i) => { const t = wireTeam(code); return t ? (t.players[i] || t.captain) : null; };
    send(admin, "submitRoster", { raw: "", name: "Late Cut Cup" });
    await admin.waitFor(c => c.latest.step === "stageChoice");
    send(admin, "pickStage", { format: "rr", advance: 3 });
    await admin.waitFor(c => c.latest.step === "play");

    // play one match WITH goals, one without
    const r0m0 = admin.latest.schedule.rounds[0][0];
    send(admin, "saveScoreAt", { roundIndex: 0, mi: 0, sa: 2, sb: 1, goals: [
      { min: 10, team: r0m0.a, scorer: wirePlayer(r0m0.a, 0) }, { min: 42, team: r0m0.a, scorer: wirePlayer(r0m0.a, 1) }, { min: 88, team: r0m0.b, scorer: wirePlayer(r0m0.b, 0) }
    ] });
    await admin.waitFor(c => c.latest.schedule.rounds[0][0].played);
    send(admin, "saveScoreAt", { roundIndex: 0, mi: 1, sa: 1, sb: 0 });
    await admin.waitFor(c => c.latest.schedule.rounds[0][1].played);
    ok(admin.latest.scorers.length === 3, "E2 the wire tally carries every scorer after each save");
    ok(admin.latest.scorers[0].goals === 1, "E3 the tally is sorted (no one has 2+ yet) — refresh landed");

    // the qualifiers move over the wire, with play already underway
    send(admin, "setAdvance", { advance: 2 });
    await admin.waitFor(c => c.latest.stages[c.latest.stageIndex].advance === 2);
    ok(true, "E4 setAdvance lands over the wire");
    const evs = (admin.latest.events || []).map(e => e.text).join(" | ");
    ok(/Qualifiers set: top 2 of 4/.test(evs), "E5 the decision log carries the change");

    // guest lockout
    const guest = await openWs("/football/?viewer=1");
    send(guest, "setAdvance", { advance: 3 });
    await guest.waitFor(c => c.errors.some(e => /Only the admin/.test(e)));
    ok(true, "E6 guests cannot move the cut line");
    send(guest, "editGoalsAt", { roundIndex: 0, mi: 1, goals: [] });
    await guest.waitFor(c => c.errors.some(e => /Only the admin/.test(e)));
    ok(true, "E7 guests cannot edit goal sheets");
    guest.ws.close();

    // play everything out (home side wins every time)
    let guard = 0;
    while (guard++ < 60) {
      const S = admin.latest;
      if (S.step !== "play") break;
      const round = S.schedule.rounds[S.roundIndex] || [];
      round.forEach((m, mi) => { if (!m.played && m.a !== "BYE" && m.b !== "BYE") send(admin, "saveScoreAt", { roundIndex: S.roundIndex, mi, sa: 1, sb: 0 }); });
      await admin.waitFor(c => (c.latest.schedule.rounds[c.latest.roundIndex] || []).every(m => m.played || m.a === "BYE" || m.b === "BYE"));
      send(admin, "continueTournament", {});
      await sleep(120);
    }
    await admin.waitFor(c => c.latest.step === "stageChoice" && c.latest.stageChoice, 6000);
    ok(admin.latest.stageChoice.entrants.length === 2, "E8 the LATE cut of 2 is what advanced (got " + admin.latest.stageChoice.entrants.length + ")");

    // goal sheet while the choice screen is up (boundary already fired)
    const target = admin.latest.matchIndex.matches.find(m => m.roundIndex === 0 && m.mi === 1);
    ok(target && target.goalEditable === true, "E9 the finished sheetless match is goalEditable on the wire");
    send(admin, "editGoalsAt", { roundIndex: 0, mi: 1, goals: [{ min: 66, team: target.a, scorer: wireCap(target.a) }] });
    await admin.waitFor(c => {
      const m = c.latest.matchIndex.matches.find(x => x.roundIndex === 0 && x.mi === 1);
      return m && (m.goals || []).length === 1;
    });
    ok(true, "E10 a goal sheet lands while the stage choice is up");
    ok(admin.latest.scorers.some(x => x.name === wireCap(target.a) && x.goals === 1), "E11 the tally refreshes after the post-boundary edit");

    // finish: knockout → champion → archived
    send(admin, "pickStage", { format: "elim" });
    await admin.waitFor(c => c.latest.step === "play");
    guard = 0;
    while (guard++ < 30) {
      const S = admin.latest;
      if (S.step !== "play") break;
      const round = S.schedule.rounds[S.roundIndex] || [];
      round.forEach((m, mi) => { if (!m.played && m.a !== "BYE" && m.b !== "BYE") send(admin, "saveScoreAt", { roundIndex: S.roundIndex, mi, sa: 2, sb: 0 }); });
      await admin.waitFor(c => (c.latest.schedule.rounds[c.latest.roundIndex] || []).every(m => m.played || m.a === "BYE" || m.b === "BYE"));
      send(admin, "continueTournament", {});
      await sleep(120);
    }
    await admin.waitFor(c => c.latest.step === "standings" && c.latest.champion, 6000);
    ok(true, "E12 the tournament crowned a champion");

    // the season archive has the entry
    let seasonApi = await getJson("/football/api/season");
    const archived1 = (seasonApi.tournaments || []).find(t => t.id === admin.latest.seed);
    ok(!!archived1, "E13 the completed tournament is archived");
    const scorers1 = JSON.stringify(seasonApi.scorers || []);

    // THE case: add a scorer AFTER the champion — the archive refreshes.
    // pick a 1-0 match with NO sheet yet so the tally actually changes
    const oneNil = admin.latest.matchIndex.matches.filter(m => m.played && m.goalEditable && m.scoreA === 1 && m.scoreB === 0 && !(m.goals && m.goals.length));
    ok(oneNil.length > 0, "E13b a sheetless 1-0 finished match exists to edit");
    const finalRow = oneNil[0];
    const lateScorer = wireCap(finalRow.a);
    send(admin, "editGoalsAt", { roundIndex: finalRow.roundIndex, mi: finalRow.mi, goals: [{ min: 90, team: finalRow.a, scorer: lateScorer }] });
    await admin.waitFor(c => {
      const m = c.latest.matchIndex.matches.find(x => x.roundIndex === finalRow.roundIndex && x.mi === finalRow.mi);
      return m && (m.goals || []).length === 1 && (m.goals[0].scorer === lateScorer);
    });
    ok(true, "E14 a goal sheet lands after the champion was crowned");
    await sleep(150);
    seasonApi = await getJson("/football/api/season");
    const archived2 = (seasonApi.tournaments || []).find(t => t.id === admin.latest.seed);
    ok(!!archived2, "E15 the archive still has exactly one entry for this seed");
    const scorers2 = JSON.stringify(seasonApi.scorers || []);
    ok(scorers1 !== scorers2, "E16 the season scorer tally CHANGED after the post-champion edit");
    const lateRow = (seasonApi.scorers || []).find(x => x.name === lateScorer);
    ok(lateRow && lateRow.goals >= 1, "E17 the late scorer's season tally includes the goal");

    // undo also refreshes the archive (no stale entry)
    send(admin, "undoEdit", {});
    await admin.waitFor(c => {
      const m = c.latest.matchIndex.matches.find(x => x.roundIndex === finalRow.roundIndex && x.mi === finalRow.mi);
      return m && !(m.goals && m.goals.length);
    });
    await sleep(150);
    seasonApi = await getJson("/football/api/season");
    const preEdit = JSON.parse(scorers1).find(x => x.name === lateScorer);
    const postUndo = (seasonApi.scorers || []).find(x => x.name === lateScorer);
    ok((preEdit ? preEdit.goals : 0) === (postUndo ? postUndo.goals : 0),
      "E18 undoEdit re-recorded the archive — the late goal is gone from the season tally");
    const archived3 = (seasonApi.tournaments || []).filter(t => t.id === admin.latest.seed);
    ok(archived3.length === 1, "E19 the archive holds ONE entry after the undo (re-recorded, not duplicated)");
  } catch (e) {
    ok(false, "E-wire section crashed — " + e.message);
  } finally {
    try { await kill(child); } catch (_) {}
  }

  console.log("\nSUITE v2.4: " + (pass + fail) + " cases, " + pass + " passed, " + fail + " failed");
  if (fail) { console.log("FAILED CASES:\n - " + fails.join("\n - ")); process.exit(1); }
})();
