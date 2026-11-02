/* M6 — v1.8 feature suite. The new engine rules end-to-end:
   best-of-N set sheets over the wire (TT), goal sheets over the wire
   (FB), the solo/team leaderboard split and the season scorer tally.
   Boots the real hub, drives both apps over WS, then inspects the
   season archives. 100+ cases. */
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

const ROOT = "/tmp/m6-v18";
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
fs.mkdirSync(ROOT, { recursive: true });
const PORT = 4107;
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
    child.kill("SIGKILL");
    setTimeout(res, 1500);
  });
}
function get(port, reqPath) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: reqPath }, r => {
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
      ws, messages: [], latest: null, errors: [], season: null, authed: false,
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
      if (m.type === "authOk") conn.authed = true;
      if (m.type === "welcome" || m.type === "state") {
        if (m.state) conn.latest = m.state;
        if (m.season !== undefined) conn.season = m.season;
      } else if (m.type === "error") conn.errors.push(m.message);
    });
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", payload: { token: "v18token" } }));
      res(conn);
    });
    ws.on("error", rej);
  });
}
function send(conn, type, payload) {
  conn.ws.send(JSON.stringify({ type, payload: payload || {} }));
}
const sum = () => { console.log("\nSUITE v18-features: " + (pass + fail) + " cases, " + pass + " passed, " + fail + " failed"); };

(async () => {
  let child;
  try {
    child = await boot(PORT, ROOT, { ADMIN_TOKENS: "v18token" });

    /* ============================================================
       A. TT best-of-3 over the wire — defaults and set sheets
       ============================================================ */
    section("A. TT best-of-3 over the wire");
    {
      const a = await openWs(PORT, "/table-tennis/");
      await a.waitFor(c => c.authed);
      send(a, "submitRoster", { raw: "Ana\nBen\nCid\nDee", name: "Sets Wire Cup" });
      await a.waitFor(c => c.latest && c.latest.step === "mode");
      ok(a.latest.points === 21, "A1 the wire shows the 21-point default");
      ok(a.latest.sets === 3, "A2 the wire shows best-of-3 default");
      send(a, "pickMode", { mode: "single" });
      await a.waitFor(c => c.latest.step === "stageChoice");
      send(a, "pickStage", { format: "rr" });
      await a.waitFor(c => c.latest.step === "play");
      // a plain pair is rejected — the sheet is required
      send(a, "saveScore", { mi: 0, sa: 21, sb: 15 });
      await a.waitFor(c => c.errors.some(e => /best of 3.*set scores/i.test(e)));
      ok(true, "A3 a plain pair is rejected for best of 3");
      // a short sheet is rejected
      send(a, "saveScore", { mi: 0, sa: null, sb: null, sets: [{ sa: 21, sb: 15 }] });
      await a.waitFor(c => c.errors.some(e => /ends at 2 set wins/.test(e)));
      ok(true, "A4 a 1-0 sheet is short of the majority");
      // the full sheet lands
      send(a, "saveScore", { mi: 0, sa: null, sb: null, sets: [{ sa: 21, sb: 15 }, { sa: 18, sb: 21 }, { sa: 21, sb: 7 }] });
      await a.waitFor(c => c.latest.schedule.rounds[0][0].played);
      const m = a.latest.schedule.rounds[0][0];
      ok(m.scoreA === 2 && m.scoreB === 1, "A5 the match score is the set count");
      eqv(m.sets, [{ sa: 21, sb: 15 }, { sa: 18, sb: 21 }, { sa: 21, sb: 7 }], "A6 the sheet rides the wire");
      // the match index exposes it for the Matches tab
      const mx = a.latest.matchIndex.matches.find(x => x.roundIndex === 0 && x.mi === 0);
      eqv(mx.sets, [{ sa: 21, sb: 15 }, { sa: 18, sb: 21 }, { sa: 21, sb: 7 }], "A7 matchIndex carries the sheet");
      // correction over the wire with a new sheet
      send(a, "editScoreAt", { roundIndex: 0, mi: 0, sa: null, sb: null, sets: [{ sa: 15, sb: 21 }, { sa: 9, sb: 21 }] });
      await a.waitFor(c => c.latest.schedule.rounds[0][0].scoreA === 0);
      ok(a.latest.schedule.rounds[0][0].sets.length === 2, "A8 the corrected sheet replaced the old one");
      send(a, "undoEdit", {});
      await a.waitFor(c => c.latest.schedule.rounds[0][0].scoreA === 2);
      ok(true, "A9 undo edit restores the sheet over the wire");
      // sets: 5 configuration over the wire
      send(a, "reset", {});
      await a.waitFor(c => c.latest.step === "roster");
      send(a, "submitRoster", { raw: "Ana\nBen\nCid\nDee\nEve\nFay", points: 11, sets: 5 });
      await a.waitFor(c => c.latest.step === "mode");
      send(a, "pickMode", { mode: "single" });
      await a.waitFor(c => c.latest.step === "stageChoice");
      send(a, "pickStage", { format: "rr" });
      await a.waitFor(c => c.latest.step === "play");
      ok(a.latest.sets === 5, "A10 sets: 5 rides the wire");
      send(a, "saveScore", { mi: 0, sa: null, sb: null, sets: [{ sa: 11, sb: 5 }, { sa: 11, sb: 7 }, { sa: 11, sb: 9 }] });
      await a.waitFor(c => c.latest.schedule.rounds[0][0].played);
      ok(a.latest.schedule.rounds[0][0].scoreA === 3, "A11 best-of-5: 3-0 sheet accepted over the wire");
      a.ws.close();
    }

    /* ============================================================
       B. TT solo/team leaderboard split (season archive)
       ============================================================ */
    section("B. TT solo/team leaderboard split");
    {
      const a = await openWs(PORT, "/table-tennis/");
      // a solo tournament
      send(a, "reset", {});
      await a.waitFor(c => c.latest.step === "roster");
      send(a, "submitRoster", { raw: "Solo1\nSolo2\nSolo3\nSolo4", name: "Solo League", points: 11, sets: 1 });
      await a.waitFor(c => c.latest.step === "mode");
      send(a, "pickMode", { mode: "single" });
      await a.waitFor(c => c.latest.step === "stageChoice");
      send(a, "pickStage", { format: "rr" });
      await a.waitFor(c => c.latest.step === "play");
      // play everything with a loop (3 rounds × 2 matches)
      for (let guard = 0; guard < 24; guard++) {
        const S = a.latest;
        const round = S.schedule.rounds[S.roundIndex] || [];
        const m = round.find(x => !x.played && x.a !== "BYE" && x.b !== "BYE");
        if (!m) {
          send(a, "continueTournament", {});
          await a.waitFor(c => c.latest.step === "standings" || (c.latest.schedule.rounds[c.latest.roundIndex] || []).some(x => !x.played));
          if (a.latest.step === "standings") break;
          continue;
        }
        send(a, "saveScoreAt", { roundIndex: S.roundIndex, mi: round.indexOf(m), sa: 11, sb: 9 });
        await a.waitFor(c => (c.latest.schedule.rounds[S.roundIndex] || [])[round.indexOf(m)].played);
      }
      await a.waitFor(c => c.latest.step === "standings", 8000);
      ok(true, "B1 solo tournament completed");
      a.ws.close();
      // a team tournament
      const b = await openWs(PORT, "/table-tennis/");
      await b.waitFor(c => c.authed);
      send(b, "reset", {});
      await b.waitFor(c => c.latest.step === "roster");
      send(b, "submitRoster", { raw: "T1a\nT1b\nT2a\nT2b", name: "Pairs League", points: 11, sets: 1 });
      await b.waitFor(c => c.latest.step === "mode");
      send(b, "pickMode", { mode: "team" });
      await b.waitFor(c => c.latest.step === "pairing");
      send(b, "formTeams", {});
      await b.waitFor(c => c.latest.step === "teamsFormed");
      send(b, "confirmTeamsAndDraw", {});
      await b.waitFor(c => c.latest.step === "stageChoice");
      send(b, "pickStage", { format: "rr" });
      await b.waitFor(c => c.latest.step === "play");
      for (let guard = 0; guard < 24; guard++) {
        const S = b.latest;
        const round = S.schedule.rounds[S.roundIndex] || [];
        const m = round.find(x => !x.played && x.a !== "BYE" && x.b !== "BYE");
        if (!m) {
          send(b, "continueTournament", {});
          await b.waitFor(c => c.latest.step === "standings" || (c.latest.schedule.rounds[c.latest.roundIndex] || []).some(x => !x.played));
          if (b.latest.step === "standings") break;
          continue;
        }
        send(b, "saveScoreAt", { roundIndex: S.roundIndex, mi: round.indexOf(m), sa: 11, sb: 9 });
        await b.waitFor(c => (b.latest.schedule.rounds[S.roundIndex] || [])[round.indexOf(m)].played);
      }
      await b.waitFor(c => c.latest.step === "standings", 8000);
      ok(true, "B2 team tournament completed");
      // the season view carries the split — for BOTH kinds of player
      await b.waitFor(c => c.season && c.season.players && c.season.players["t1a"] && c.season.players["solo1"]);
      const p = b.season.players["t1a"];
      const sp = b.season.players["solo1"];
      ok(p && p.solo && p.team, "B3 each player carries both buckets");
      ok(sp && sp.solo && sp.team, "B3b the solo-league player carries both buckets too");
      ok(sp.solo.played >= 3 && sp.solo.won + sp.solo.lost === sp.solo.played, "B4 the solo league counted the solo games (got " + (sp && sp.solo && sp.solo.played) + ")");
      ok(sp.team.played === 0, "B4b no team games for a solo-only player");
      ok(p.team.played >= 1, "B5 team games counted for the pairs player");
      ok(p.solo.played === 0, "B5b no solo games for a pairs-only player");
      ok(typeof sp.soloLine === "string" && /\d+–\d+/.test(sp.soloLine), "B6 the solo line renders (got " + (sp && sp.soloLine) + ")");
      ok(sp.teamLine === null, "B6b a solo-only player shows no team line");
      ok(typeof p.teamLine === "string" && /\d+–\d+/.test(p.teamLine), "B7 the team line renders (got " + (p && p.teamLine) + ")");
      const order = b.season.order;
      ok(Array.isArray(order) && order.length === 8, "B8 eight ranked players across both tournaments (got " + (order && order.length) + ")");
      ok(Array.isArray(b.season.teams) && b.season.teams.length >= 1, "B9 the pairings table is exposed");
      b.ws.close();
    }

    /* ============================================================
       C. FB goal sheets over the wire + season scorer tally
       ============================================================ */
    section("C. FB goal sheets over the wire");
    {
      const a = await openWs(PORT, "/football/");
      await a.waitFor(c => c.authed);
      send(a, "addTeam", { teamName: "Red XI", captain: "Rahim", players: ["Karim", "Sabbir"] });
      send(a, "addTeam", { teamName: "Blue XI", captain: "Sohel", players: ["Rana"] });
      send(a, "addTeam", { teamName: "Green XI", captain: "Gani", players: ["Golu"] });
      await a.waitFor(c => (c.latest.teams || []).length === 3);
      send(a, "submitRoster", { raw: "", name: "Goal Wire Cup" });
      await a.waitFor(c => c.latest.step === "stageChoice" || c.errors.length > 0);
      send(a, "pickStage", { format: "rr" });
      await a.waitFor(c => c.latest.step === "play" || c.errors.length > 0);
      const S = a.latest;
      const m0 = S.schedule.rounds[0][0];
      const ca = m0.a, cb = m0.b;
      // squads keyed by team code — captain first (she can score too)
      const squadOfCode = code => {
        const t = S.teams.find(x => x.name === (S.labelOf[code] || code));
        return t ? [t.captain, ...(t.players || [])] : [];
      };
      const capA = squadOfCode(ca)[0], mateA = squadOfCode(ca)[1];
      const capB = squadOfCode(cb)[0];
      // a mismatched sheet is rejected
      send(a, "saveScore", { mi: 0, sa: 2, sb: 1, goals: [{ min: 12, team: ca, scorer: capA }] });
      await a.waitFor(c => c.errors.some(e => /add up/.test(e)));
      ok(true, "C1 a mismatched goal sheet is rejected over the wire");
      // the full sheet with an own goal lands: 2 for ca (a captain goal +
      // a regular one) and 1 for cb via an own goal by a ca player
      send(a, "saveScore", {
        mi: 0, sa: 2, sb: 1,
        goals: [
          { min: 12, team: ca, scorer: capA },
          { min: 30, team: cb, scorer: mateA, own: true },
          { min: 70, team: ca, scorer: capA }
        ]
      });
      await a.waitFor(c => c.latest.schedule.rounds[0][0].played);
      ok(a.latest.schedule.rounds[0][0].goals.length === 3, "C2 the sheet landed with 3 goals");
      // the wire tally
      const tally = a.latest.scorers;
      ok(Array.isArray(tally) && tally.length === 2, "C3 the scorer tally rides the state (two scorers)");
      const own = tally.find(x => x.name === mateA);
      ok(own && own.own === 1 && own.goals === 0, "C4 the own goal sits in its own column");
      ok(own && own.team === ca, "C4c own goals remain under the scorer's actual team");
      const capRow = tally.find(x => x.name === capA);
      ok(capRow && capRow.goals === 2, "C4b the captain's brace is tallied");
      // a scorer outside both squads is rejected (an unplayed fixture)
      const S2 = a.latest;
      let ghost = null, gRi = -1, gMi = -1;
      S2.schedule.rounds.forEach((r, ri) => (r || []).forEach((m, mi) => {
        if (ghost || !m || m.played || m.a === "BYE" || m.b === "BYE") return;
        ghost = m; gRi = ri; gMi = mi;
      }));
      ok(!!ghost, "C5a an unplayed fixture exists for the ghost test");
      send(a, "saveScoreAt", { roundIndex: gRi, mi: gMi, sa: 1, sb: 0, goals: [{ min: 5, team: ghost.a, scorer: "Ghost" }] });
      await a.waitFor(c => c.errors.some(e => /isn't in .*squad/.test(e)));
      ok(true, "C5 a ghost scorer is rejected");
      // correction with a fixed minute
      send(a, "editScoreAt", {
        roundIndex: 0, mi: 0, sa: 2, sb: 1,
        goals: [
          { min: 9, team: ca, scorer: capA },
          { min: 30, team: cb, scorer: mateA, own: true },
          { min: 70, team: ca, scorer: capA }
        ]
      });
      await a.waitFor(c => c.latest.schedule.rounds[0][0].goals[0].min === 9);
      ok(true, "C6 the corrected minute landed");
      send(a, "undoEdit", {});
      await a.waitFor(c => c.latest.schedule.rounds[0][0].goals[0].min === 12);
      ok(true, "C7 undo edit restores the minute");
      a.ws.close();
    }

    /* ============================================================
       D. FB season scorers after recording
       ============================================================ */
    section("D. FB season scorer tally");
    {
      const a = await openWs(PORT, "/football/");
      await a.waitFor(c => c.authed);
      // finish the running tournament: play every unplayed fixture
      for (let guard = 0; guard < 30; guard++) {
        const S = a.latest;
        if (S.step === "standings") break;
        const round = S.schedule.rounds[S.roundIndex] || [];
        const m = round.find(x => !x.played && x.a !== "BYE" && x.b !== "BYE");
        if (!m) {
          send(a, "continueTournament", {});
          await a.waitFor(c => c.latest.step === "standings" || (c.latest.schedule.rounds[c.latest.roundIndex] || []).some(x => !x.played));
          continue;
        }
        const mi = round.indexOf(m);
        send(a, "saveScoreAt", { roundIndex: S.roundIndex, mi, sa: 1, sb: 0 });
        await a.waitFor(c => (c.latest.schedule.rounds[S.roundIndex] || [])[mi].played);
      }
      await a.waitFor(c => c.latest.step === "standings", 8000);
      ok(true, "D1 the football tournament completed");
      await a.waitFor(c => c.season && c.season.scorers && c.season.scorers.length);
      const scorers = a.season.scorers;
      // the C-section's names, re-derived from the archived sheet
      const S0 = a.latest;
      const m0 = S0.schedule.rounds[0][0];
      const caName = S0.labelOf[m0.a];
      const squadOfCode = code => {
        const t = S0.teams.find(x => x.name === (S0.labelOf[code] || code));
        return t ? [t.captain, ...(t.players || [])] : [];
      };
      const capA = squadOfCode(m0.a)[0], mateA = squadOfCode(m0.a)[1];
      const capRow = scorers.find(x => x.name === capA);
      ok(capRow && capRow.goals >= 2, "D2 the captain's goals reached the season tally");
      const ownRow = scorers.find(x => x.name === mateA);
      ok(ownRow && ownRow.own === 1, "D3 the own goal is archived apart from goals");
      ok(ownRow && ownRow.team === caName, "D3c archived own goals retain the scorer's actual team");
      ok(scorers.every(x => typeof x.team === "string"), "D3b each scorer row carries the team name");
      // the leaderboard ranks TEAM names
      const players = a.season.players || {};
      const names = Object.keys(players);
      const teamNames = (a.latest.teams || []).map(t => t.name.toLowerCase());
      ok(names.some(n => teamNames.includes(n)), "D4 the leaderboard keys team names");
      const squadNames = new Set((a.latest.teams || []).flatMap(t => [t.captain, ...(t.players || [])]).map(x => String(x).toLowerCase()));
      ok(!names.some(n => squadNames.has(n)), "D5 no squad players leak in as leaderboard rows");
      a.ws.close();
    }

    await kill(child);
    sum();
    if (fail) { console.log("FAILED CASES:\n - " + fails.join("\n - ")); process.exit(1); }
    process.exit(0);
  } catch (err) {
    console.error("SUITE CRASHED:", err && err.message);
    if (child) { try { await kill(child); } catch (_) {} }
    process.exit(1);
  }
})();
