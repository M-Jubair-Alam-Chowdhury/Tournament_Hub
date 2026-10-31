/* M3 — persistence suite (100+ cases): store.js (JSON files AND the
   Postgres/Neon code path against a stub driver), season.js (ELO,
   3-1-0 stats, stars, import/export), registry.js (the UID player
   store), and tournament-state snapshots. Fresh module instances are
   loaded per scenario so DATA_DIR / DATABASE_URL are captured anew. */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

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
function noThrow(fn, name) {
  let m = null;
  try { fn(); } catch (e) { m = e.message; }
  ok(m == null, name + " — threw " + (m || "unknown"));
}
function section(name) { console.log("\n== " + name + " =="); }

const HUB = path.join(__dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m3-store-"));
let seq = 0;
function newDir() { return path.join(tmpRoot, "d" + (++seq)); }

/* Load fresh store/season/registry instances for an app. */
function freshApp(app, opts) {
  opts = opts || {};
  const base = path.join(HUB, "apps", app);
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(base + path.sep)) delete require.cache[key];
  }
  const prevData = process.env.DATA_DIR, prevDb = process.env.DATABASE_URL;
  process.env.DATA_DIR = opts.dataDir || newDir();
  process.env.DATABASE_URL = opts.databaseUrl || "";
  const store = require(path.join(base, "store.js"));
  const season = require(path.join(base, "season.js"));
  const registry = require(path.join(base, "registry.js"));
  const dir = process.env.DATA_DIR;
  process.env.DATA_DIR = prevData;
  process.env.DATABASE_URL = prevDb;
  return { store, season, registry, dir };
}

/* ---- a stub Postgres driver standing in for `pg` ----
   Implements exactly the statements store.js issues, over an
   in-memory season_data table, with failure injection. */
const PG_PATH = require.resolve("pg", { paths: [HUB] });
function installStubPg() {
  const state = { table: new Map(), queries: [], pools: [], failNext: 0, failCode: null };
  class Pool {
    constructor(opts) { state.pools.push(opts); this.opts = opts; }
    async query(sql, params) {
      state.queries.push({ sql: String(sql), params: params ? params.slice() : [] });
      if (state.failNext > 0) {
        state.failNext--;
        const err = new Error("connection terminated");
        err.code = state.failCode || "ECONNRESET";
        throw err;
      }
      const s = String(sql);
      if (/CREATE TABLE IF NOT EXISTS/i.test(s)) return { rows: [] };
      let m = s.match(/SELECT key, value FROM \w+ WHERE key LIKE \$1/i);
      if (m) {
        const pat = String(params[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
        const rx = new RegExp("^" + pat + "$");
        const rows = [];
        for (const [k, v] of state.table) if (rx.test(k)) rows.push({ key: k, value: v });
        return { rows };
      }
      m = s.match(/INSERT INTO \w+ \(key, value\) VALUES \(\$1, \$2(::jsonb)?\)/i);
      if (m) {
        state.table.set(params[0], typeof params[1] === "string" ? JSON.parse(params[1]) : params[1]);
        return { rows: [] };
      }
      m = s.match(/DELETE FROM \w+ WHERE key = \$1/i);
      if (m) { state.table.delete(params[0]); return { rows: [] }; }
      throw new Error("stub pg: unexpected SQL: " + s.slice(0, 60));
    }
  }
  const stub = { Pool, __state: state };
  require.cache[PG_PATH] = { id: PG_PATH, filename: PG_PATH, loaded: true, exports: stub };
  return stub;
}
function uninstallStubPg() { delete require.cache[PG_PATH]; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {

/* ============ JSON store ============ */
section("A. store — JSON file mode (no DATABASE_URL)");
{
  const { store, dir } = freshApp("table-tennis");
  ok(store.get("season") === null, "A1 missing key reads null");
  store.set("season", { name: "S1", tournaments: [] });
  eqv(store.get("season"), { name: "S1", tournaments: [] }, "A2 set/get roundtrip");
  ok(fs.existsSync(path.join(dir, "season.json")), "A3 season.json written");
  ok(fs.readFileSync(path.join(dir, "season.json"), "utf8").includes("\n"), "A4 season file pretty-printed");
  store.set("tournamentState", { v: 3, state: { x: 1 } });
  ok(!fs.readFileSync(path.join(dir, "tournament-state.json"), "utf8").includes("\n"), "A5 state file compact");
  store.set("players", { v: 1, entries: [{ uid: "p-1", name: "A" }] });
  ok(fs.existsSync(path.join(dir, "players.json")), "A6 players.json written (new key)");
  store.del("players");
  ok(store.get("players") === null, "A7 del removes the key");
  ok(!fs.existsSync(path.join(dir, "players.json")), "A8 file unlinked");
  noThrow(() => store.del("players"), "A9 del of a missing key is safe");
  const files = fs.readdirSync(dir);
  ok(!files.some(f => f.endsWith(".tmp")), "A10 no .tmp left behind (atomic rename)");
  fs.writeFileSync(path.join(dir, "live-video.json"), "{not json");
  ok(store.get("liveVideo") === null, "A11 corrupt file reads null, no crash");
  fs.writeFileSync(path.join(dir, "season.json"), "42");
  eqv(store.get("season"), 42, "A12 non-object JSON still parses (season validation guards)");
  const a = freshApp("table-tennis");
  const b = freshApp("table-tennis");
  a.store.set("season", { who: "a" });
  ok(b.store.get("season") === null, "A13 two data dirs stay isolated");
  for (const url of ["", "mysql://x/y", "sqlite:./db", "mongodb://z"]) {
    const f = freshApp("table-tennis", { databaseUrl: url });
    f.store.set("season", { mode: url });
    ok(fs.existsSync(path.join(f.dir, "season.json")), "A14 file mode kept for DATABASE_URL=" + JSON.stringify(url));
  }
  const nested = path.join(newDir(), "deep", "deeper");
  const n = freshApp("table-tennis", { dataDir: nested });
  n.store.set("liveVideo", { id: "abc12345678" });
  ok(fs.existsSync(path.join(nested, "live-video.json")), "A15 nested DATA_DIR created on write");
  const fbFile = freshApp("football");
  fbFile.store.set("season", { app: "fb" });
  ok(fs.existsSync(path.join(fbFile.dir, "season.json")), "A16 football store writes its own folder");
}

/* ============ Postgres store (stub driver) ============ */
section("B. store — Postgres/Neon mode (season_data table)");
{
  uninstallStubPg();
  const stub = installStubPg();
  const url = "postgres://user:pass@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require";
  const { store } = freshApp("table-tennis", { databaseUrl: url });
  await store.init();
  ok(stub.__state.queries.some(q => /CREATE TABLE IF NOT EXISTS season_data/i.test(q.sql)), "B2 season_data table created");
  ok(stub.__state.pools.length === 1 && stub.__state.pools[0].connectionString === url, "B3 pool built from DATABASE_URL");
  ok(stub.__state.pools[0].ssl && stub.__state.pools[0].ssl.rejectUnauthorized === false, "B4 SSL on for a Neon hostname");
  ok(store.get("season") === null, "B5 empty database reads null");
  store.set("season", { name: "Neon Season" });
  eqv(store.get("season"), { name: "Neon Season" }, "B6 set/get over Postgres");
  await sleep(80);
  eqv(stub.__state.table.get("table-tennis:season"), { name: "Neon Season" }, "B7 row stored under the app-namespaced key");
  store.del("season");
  ok(store.get("season") === null, "B8 del clears the row (memory)");
  await sleep(80);
  ok(!stub.__state.table.has("table-tennis:season"), "B9 DELETE issued for the namespaced key");
  const before = stub.__state.queries.length;
  store.set("season", { n: 1 }); store.set("liveVideo", { n: 2 }); store.set("players", { n: 3 });
  await sleep(80);
  const inserts = stub.__state.queries.slice(before).filter(q => /INSERT INTO/.test(q.sql));
  eqv(inserts.map(q => q.params[0]), ["table-tennis:season", "table-tennis:liveVideo", "table-tennis:players"], "B10 writes serialized in call order");
  eqv(inserts.map(q => JSON.parse(q.params[1])), [{ n: 1 }, { n: 2 }, { n: 3 }], "B11 values JSONB-encoded");
  stub.__state.failNext = 1;
  store.set("season", { retry: true });
  await sleep(900);   // the retry backs off 400ms
  eqv(stub.__state.table.get("table-tennis:season"), { retry: true }, "B12 a dropped connection is retried (Neon cold start)");
  stub.__state.failNext = 1; stub.__state.failCode = "42601";
  store.set("season", { bad: true });
  await sleep(50);   // fail while failCode is set, so it is NOT retried
  stub.__state.failCode = null;
  eqv(stub.__state.table.get("table-tennis:season"), { retry: true }, "B13 a non-connection error is reported, not retried");
  // init retry path: one dropped connection during CREATE TABLE
  stub.__state.failNext = 1;
  const r = freshApp("table-tennis", { databaseUrl: url });
  await r.store.init();
  ok(true, "B14 init survives one dropped connection");
  await sleep(50);
  stub.__state.failNext = 3; // three failures exhaust the retries
  const r2 = freshApp("table-tennis", { databaseUrl: url });
  let rejected = false;
  try { await r2.store.init(); } catch (e) { rejected = true; }
  ok(rejected, "B15 a dead database makes init reject (Render restarts until it answers)");
  stub.__state.failNext = 0;
  // two apps share one table without collisions
  const fb = freshApp("football", { databaseUrl: url, dataDir: newDir() });
  await fb.store.init();
  fb.store.set("season", { app: "football" });
  await sleep(50);
  eqv(stub.__state.table.get("football:season"), { app: "football" }, "B16 football rows live under their own prefix");
  eqv(store.get("season"), { bad: true }, "B17 table-tennis data untouched by football writes");
  // first boot imports existing JSON files, keeps them as backups
  const importDir = newDir();
  fs.mkdirSync(importDir, { recursive: true });
  fs.writeFileSync(path.join(importDir, "season.json"), JSON.stringify({ name: "FromFile", tournaments: [] }));
  const stub2 = installStubPg();
  const migrated = freshApp("table-tennis", { databaseUrl: "postgres://u@localhost/db", dataDir: importDir });
  await migrated.store.init();
  ok(stub2.__state.pools.length === 1 && stub2.__state.pools[0].ssl === undefined, "B18 localhost connections skip SSL");
  eqv(migrated.store.get("season"), { name: "FromFile", tournaments: [] }, "B19 JSON file imported into Postgres on first boot");
  ok(fs.existsSync(path.join(importDir, "season.json")), "B20 the original file is kept as a backup");
  ok(stub2.__state.queries.some(q => /INSERT INTO/.test(q.sql) && q.params[0] === "table-tennis:season"), "B21 the import issued an INSERT for the missing key");
  stub2.__state.queries.length = 0;
  const again = freshApp("table-tennis", { databaseUrl: "postgres://u@localhost/db", dataDir: importDir });
  await again.store.init();
  const reInserts = stub2.__state.queries.filter(q => /INSERT INTO/.test(q.sql));
  eqv(reInserts.length, 0, "B22 a key already in the database is never re-imported");
  eqv(again.store.get("season"), { name: "FromFile", tournaments: [] }, "B23 the database row is served after re-init");
  const stub3 = installStubPg();
  const noSsl = freshApp("table-tennis", { databaseUrl: "postgres://u@ep-x.neon.tech/db?sslmode=disable", dataDir: newDir() });
  await noSsl.store.init();
  ok(stub3.__state.pools[0].ssl === undefined, "B24 sslmode=disable drops SSL");
  const stub4 = installStubPg();
  const pgsql = freshApp("table-tennis", { databaseUrl: "postgresql://u@ep-y.neon.tech/db", dataDir: newDir() });
  await pgsql.store.init();
  ok(stub4.__state.pools[0].ssl, "B25 the postgresql:// scheme also engages Postgres mode");
  eqv(stub4.__state.table.size, 0, "B26 an empty database stays empty until a write");
  uninstallStubPg();
}

/* ============ season: recording and derived stats ============ */
section("C. season — recording and the stats ladder");
{
  const { season } = freshApp("football");
  season.load();
  const view = season.getPublicView();
  ok(/^Season \d{4}$/.test(view.name), "C1 a blank season gets a default name");
  ok(view.tournamentCount === 0 && view.order.length === 0, "C2 empty season is empty");
  throwsMsg(() => season.recordTournament(null), /Nothing to record/, "C3 invalid record rejected");
  season.recordTournament({
    id: "t1", name: "Cup One",
    participants: ["Alice", "Bob", "Carol"],
    matches: [
      { a: "Alice", b: "Bob", sa: 2, sb: 1 },
      { a: "Carol", b: "Alice", sa: 1, sb: 1 },
      { a: "Bob", b: "Carol", sa: 0, sb: 3 }
    ],
    ranking: ["Carol", "Alice", "Bob"],
    champion: "Carol"
  }, "complete");
  const v1 = season.getPublicView();
  ok(v1.tournamentCount === 1, "C4 tournament recorded");
  eqv(v1.tournaments[0].name, "Cup One", "C5 entry keeps the name");
  ok(v1.tournaments[0].status === "complete", "C6 status complete by default");
  eqv(v1.tournaments[0].matches, 3, "C6b match count archived");
  eqv(v1.tournaments[0].ranking.slice(0, 3), ["Carol", "Alice", "Bob"], "C6c podium archived");
  const P = v1.players;
  ok(P.alice && P.bob && P.carol, "C7 players keyed by normalised name");
  eqv(P.alice.played, 2, "C8 Alice played 2");
  eqv(P.alice.pf, 3, "C9 goals for accumulate (2+1)");
  eqv(P.alice.pa, 2, "C10 goals against accumulate (1+1)");
  eqv(P.alice.won, 1, "C11 win counted");
  eqv(P.alice.drawn, 1, "C12 draw counted");
  eqv(P.alice.lost, 0, "C13 no losses");
  eqv(P.carol.titles, 1, "C14 the champion earns a title");
  eqv(P.alice.top2, 1, "C15 runner-up counted in top 2");
  eqv(P.bob.best, 3, "C16 best finish tracked");
  eqv(P.alice.tourneys, 1, "C17 tournament count per player");
  eqv(P.alice.form, ["W", "D"], "C18 form letters in match order");
  eqv(P.alice.rating, 1015, "C19 Alice: win (+16) then draw against a lower-rated side nets 1015");
  eqv(P.bob.rating, 969, "C20 Bob: loss (-16) then loss to the rising Carol (-15)");
  eqv(P.carol.rating, 1016, "C21 Carol: draw then win nets +15");
  eqv(v1.order[0], "carol", "C22 order leads with a top rating");
  ok(v1.order.indexOf("alice") < v1.order.indexOf("bob"), "C23 Alice rated above Bob");
  eqv(P.alice.diff, 1, "C24 season goal difference tracked");
  season.recordTournament({
    id: "t2", participants: ["Alice", "Bob"],
    matches: [{ a: "Alice", b: "Bob", sa: 5, sb: 0 }],
    ranking: ["Alice", "Bob"]
  }, "abandoned");
  const v2 = season.getPublicView();
  ok(v2.tournamentCount === 2, "C25 abandoned kept in history");
  ok(v2.abandonedCount === 1, "C26 abandoned counted separately");
  ok(v2.completedCount === 1, "C27 completed counted separately");
  eqv(v2.players.alice.played, 2, "C28 abandoned matches do NOT feed the stats");
  eqv(v2.players.alice.tourneys, 1, "C29 abandoned doesn't count as an appearance");
  season.recordTournament({
    id: "t3", participants: ["D", "E"],
    matches: [
      { a: "D", b: "E", sa: 1, sb: 0 }, { a: "D", b: "E", sa: 1, sb: 0 },
      { a: "D", b: "E", sa: 1, sb: 0 }, { a: "D", b: "E", sa: 1, sb: 0 },
      { a: "D", b: "E", sa: 1, sb: 0 }, { a: "D", b: "E", sa: 1, sb: 0 },
      { a: "D", b: "E", sa: 1, sb: 0 }
    ],
    ranking: ["D", "E"]
  }, "complete");
  const v3 = season.getPublicView();
  eqv(v3.players.d.form, ["W", "W", "W", "W", "W"], "C30 form capped to the last 5");
  eqv(v3.players.d.played, 7, "C31 seven matches played");
  eqv(v3.players.d.winPct, 100, "C32 win percentage computed");
  ok(v3.players.d.autoStar === true, "C33 auto star: 100% over 7 matches with a high rating");
  ok((v3.players.d.reasons || []).length >= 1, "C34 star reasons listed");
  ok(season.toggleStar("Bob") === true, "C35 manual star toggled on");
  ok(season.getPublicView().players.bob.star === true, "C36 manual star shows");
  ok(season.toggleStar("Bob") === false, "C37 manual star toggled off");
  throwsMsg(() => season.toggleStar("  "), /Who should get/, "C38 empty star name rejected");
  const ratings = season.getRatings();
  ok(ratings.alice != null && ratings.Alice === ratings.alice, "C39 ratings keyed by normalised AND display name");
  const full = season.getFullJSON();
  ok(typeof full === "string" && JSON.parse(full).v === 1, "C40 full archive exports as JSON");
  throwsMsg(() => season.importJSON("not json"), /isn't valid JSON/, "C41 import of garbage rejected");
  throwsMsg(() => season.importJSON(JSON.stringify({ v: 1 })), /isn't a season archive/, "C42 import of a wrong shape rejected");
  eqv(season.importJSON(full).count, 3, "C43 a valid archive re-imports");
  eqv(season.newSeason("  Autumn 2026  ").name, "Autumn 2026", "C44 new season name trimmed");
  ok(season.getPublicView().tournamentCount === 0, "C45 new season starts empty");
  eqv(season.newSeason("L".repeat(80)).name.length, 60, "C46 season name capped at 60");
  ok(season.tournamentCount() === 0, "C47 tournamentCount after reset");
  const broken = freshApp("football");
  fs.mkdirSync(broken.dir, { recursive: true });
  fs.writeFileSync(path.join(broken.dir, "season.json"), "][");
  broken.season.load();
  ok(broken.season.getPublicView().tournamentCount === 0, "C48 malformed season file falls back to blank");
  // name casing tracked for display
  const casing = freshApp("football");
  casing.season.load();
  casing.season.recordTournament({ id: "c1", participants: ["ada"], matches: [], ranking: ["ada"] }, "complete");
  casing.season.recordTournament({ id: "c2", participants: ["ADA"], matches: [], ranking: ["ADA"] }, "complete");
  ok(casing.season.getPublicView().players.ada.tourneys === 2, "C49 same player under different casings merges");
}

/* ============ season: ELO maths, precisely ============ */
section("D. season — ELO replay maths (K=32, start 1000)");
{
  const { season } = freshApp("table-tennis");
  season.load();
  const START = 1000, K = 32;
  const expected = {};
  const rate = k => expected[k] != null ? expected[k] : START;
  const feed = (a, b, sa, sb) => {
    const ra = rate(a), rb = rate(b);
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const score = sa === sb ? 0.5 : sa > sb ? 1 : 0;
    expected[a] = Math.round(ra + K * (score - ea));
    expected[b] = Math.round(rb + K * ((1 - score) - (1 - ea)));
  };
  const hero = "Hero", opps = Array.from({ length: 6 }, (_, i) => "Opp" + i);
  const matches = [];
  for (const o of opps) { matches.push({ a: hero, b: o, sa: 11, sb: 9 }); feed(hero, o, 11, 9); }
  matches.push({ a: opps[0], b: opps[1], sa: 11, sb: 7 }); feed(opps[0], opps[1], 11, 7);
  matches.push({ a: opps[1], b: opps[2], sa: 11, sb: 0 }); feed(opps[1], opps[2], 11, 0);
  season.recordTournament({
    id: "elo", participants: [hero, ...opps],
    matches, ranking: [hero, ...opps]
  }, "complete");
  const P = season.getPublicView().players;
  for (const name of [hero, ...opps]) {
    ok(P[name.toLowerCase()].rating === expected[name], "D rating replayed exactly for " + name);
  }
  ok(expected[hero] >= 1080, "D1 six straight wins lift the rating past 1080 (" + expected[hero] + ")");
  ok(P[hero.toLowerCase()].autoStar === true, "D2 auto star earned by rating");
  ok((P[hero.toLowerCase()].reasons || []).some(r => /rating/.test(r)), "D3 the rating reason is recorded");
  // draw maths (the football app — table tennis has no draws)
  const { season: s2 } = freshApp("football");
  s2.load();
  s2.recordTournament({ id: "d", participants: ["X", "Y", "Z"], matches: [
    { a: "X", b: "Z", sa: 2, sb: 1 },   // X 1000 -> 1016
    { a: "X", b: "Y", sa: 3, sb: 3 }    // draw vs a lower-rated Y
  ], ranking: ["X", "Y", "Z"] }, "complete");
  const sv2 = s2.getPublicView();
  eqv(sv2.players.x.rating, 1015, "D4 a favourite drawing concedes a point (1016 -> 1015)");
  eqv(sv2.players.y.rating, 1001, "D5 the underdog gains from the draw (1000 -> 1001)");
  eqv(sv2.players.x.drawn, 1, "D5b draws tracked in the football season");
  eqv(sv2.players.x.form, ["W", "D"], "D5c form letters W/D");
  const { season: s3 } = freshApp("table-tennis");
  s3.load();
  s3.recordTournament({ id: "u1", participants: ["Lo", "Hi"], matches: [{ a: "Lo", b: "Hi", sa: 1, sb: 0 }], ranking: ["Lo", "Hi"] }, "complete");
  // prime Hi's rating first: replayed matches give Hi 1100+ before Lo's win
  const hiBefore = s3.getPublicView().players.hi.rating;
  s3.recordTournament({ id: "u2", participants: ["Lo", "Hi"], matches: [{ a: "Lo", b: "Hi", sa: 1, sb: 0 }], ranking: ["Lo", "Hi"] }, "complete");
  const lo = s3.getPublicView().players.lo.rating;
  const hi = s3.getPublicView().players.hi.rating;
  ok(lo > 1000 && hi < hiBefore, "D6 favourites lose more than they gain (" + lo + "/" + hi + ")");
  ok(s3.getRatings().lo === lo, "D7 the ratings map stays in sync");
  ok(s3.getRatings().Lo === lo, "D8 the display spelling also resolves");
}

/* ============ registry ============ */
section("E. registry — the UID player store (table tennis)");
{
  const { registry } = freshApp("table-tennis");
  registry.load();
  eqv(registry.list(), [], "E1 empty registry lists nothing");
  const r1 = registry.upsertMany(["Alice", "Bob"]);
  eqv([r1.added, r1.updated], [2, 0], "E2 first save adds both");
  const [a1] = registry.list();
  ok(/^p-[0-9a-f]{8}$/.test(a1.uid), "E3 UIDs look like p-xxxxxxxx");
  ok(a1.name === "Alice" && a1.addedAt && a1.lastUsed, "E4 entry carries name and timestamps");
  const uidA = a1.uid;
  const r2 = registry.upsertMany(["alice", "Carol"]);
  eqv([r2.added, r2.updated], [1, 1], "E5 same name (any case) updates, never duplicates");
  eqv(registry.count(), 3, "E6 three players total");
  ok(registry.list().find(e => e.uid === uidA).name === "alice", "E7 the latest spelling is kept, UID unchanged");
  ok(registry.remove(uidA), "E8 remove by UID works");
  ok(!registry.remove(uidA), "E9 removing twice returns false");
  eqv(registry.count(), 2, "E10 count after removal");
  eqv(registry.upsertMany([]), { added: 0, updated: 0, total: 2 }, "E11 an empty save changes nothing");
  eqv(registry.upsertMany(null), { added: 0, updated: 0, total: 2 }, "E12 a null payload is tolerated");
  ok(registry.upsertMany(["   ", ""]).total === 2, "E13 blank names skipped");
  registry.upsertMany(["N".repeat(80)]);
  ok(registry.list().some(e => e.name.length === 60), "E14 names capped at 60 chars");
  registry.upsertMany(["Bob"]);
  ok(registry.list()[0].name === "Bob", "E15 the most recently used leads the list");
  const dirR = newDir();
  const first = freshApp("table-tennis", { dataDir: dirR });
  first.registry.load();
  first.registry.upsertMany(["Persist", "Me"]);
  const second = freshApp("table-tennis", { dataDir: dirR });
  second.registry.load();
  eqv(second.registry.list().map(e => e.name).sort(), ["Me", "Persist"], "E16 registry survives a reload (file mode)");
  const uidP = second.registry.list().find(e => e.name === "Persist").uid;
  ok(uidP === first.registry.list().find(e => e.name === "Persist").uid, "E17 UIDs are stable across reloads");
  const dirC = newDir();
  fs.mkdirSync(dirC, { recursive: true });
  fs.writeFileSync(path.join(dirC, "players.json"), "[1,2,3]");
  const corrupted = freshApp("table-tennis", { dataDir: dirC });
  noThrow(() => corrupted.registry.load(), "E18 corrupt players.json tolerated");
  eqv(corrupted.registry.count(), 0, "E19 corrupt data drops to empty");
  fs.writeFileSync(path.join(dirC, "players.json"), JSON.stringify({ v: 1, entries: [{ name: "NoUid" }] }));
  const fixed = freshApp("table-tennis", { dataDir: dirC });
  fixed.registry.load();
  ok(/^p-/.test(fixed.registry.list()[0].uid), "E20 an entry without a UID is repaired");
  // registry over the Postgres path
  uninstallStubPg();
  const stub = installStubPg();
  const pgApp = freshApp("table-tennis", { databaseUrl: "postgres://u@localhost/db", dataDir: newDir() });
  await pgApp.store.init();
  pgApp.registry.load();
  pgApp.registry.upsertMany(["Neon Player"]);
  await sleep(50);
  ok(stub.__state.table.get("table-tennis:players").entries.length === 1, "E21 the registry rides the season_data table (Neon path)");
  const pgAgain = freshApp("table-tennis", { databaseUrl: "postgres://u@localhost/db", dataDir: newDir() });
  await pgAgain.store.init();
  pgAgain.registry.load();
  ok(pgAgain.registry.list().some(e => e.name === "Neon Player"), "E22 the registry reloads from Postgres");
  uninstallStubPg();
}

/* ============ registry — football squads ============ */
section("F. registry — football squads (captain + players)");
{
  const { registry } = freshApp("football");
  registry.load();
  registry.upsertMany([
    { name: "Red Lions", captain: "Rahim", players: "Karim\nSabbir" },
    { name: "Blue Stars", captain: "Tanvir", players: ["Imran", "Jamal"] }
  ]);
  eqv(registry.count(), 2, "F1 squads registered");
  const lions = registry.list().find(e => e.name === "Red Lions");
  eqv(lions.captain, "Rahim", "F2 captain saved");
  eqv(lions.players, ["Karim", "Sabbir"], "F3 newline player list parsed");
  const stars = registry.list().find(e => e.name === "Blue Stars");
  eqv(stars.players, ["Imran", "Jamal"], "F4 array player list accepted");
  registry.upsertMany([{ name: "red lions", captain: "New Cap" }]);
  const upd = registry.list().find(e => e.uid === lions.uid);
  eqv(upd.captain, "New Cap", "F5 captain updates, same UID");
  eqv(upd.players, ["Karim", "Sabbir"], "F6 squad kept when the update has none");
  registry.upsertMany([{ name: "red lions", captain: "New Cap", players: ["Only"] }]);
  eqv(registry.list().find(e => e.uid === lions.uid).players, ["Only"], "F7 a real squad list replaces it");
  ok(registry.list().every(e => typeof e.captain === "string"), "F8 entries always carry a captain field");
  noThrow(() => registry.upsertMany([{ name: "" }, null, { name: "Good" }]), "F9 malformed entries skipped");
  eqv(registry.count(), 3, "F10 only the valid entry landed");
  const big = freshApp("football");
  big.registry.load();
  big.registry.upsertMany([{ name: "Squad", captain: "C", players: Array.from({ length: 50 }, (_, i) => "P" + i) }]);
  eqv(big.registry.list()[0].players.length, 40, "F11 squad capped at 40 players");
}

/* ============ tournament state snapshots ============ */
section("G. live tournament state persistence");
{
  const { season, dir } = freshApp("table-tennis");
  season.load();
  ok(season.loadTournamentState() === null, "G1 nothing saved reads null");
  const snap = { v: 3, savedAt: "2026-10-31T10:00:00.000Z", state: { step: "play", seed: "x" } };
  season.saveTournamentState(snap);
  eqv(season.loadTournamentState(), snap, "G2 roundtrip through the store");
  ok(fs.existsSync(path.join(dir, "tournament-state.json")), "G3 the file lands in the data dir");
  season.clearTournamentState();
  ok(season.loadTournamentState() === null, "G4 cleared");
  season.saveTournamentState({ v: 2, state: {} });
  ok(season.loadTournamentState() === null, "G5 a wrong version is ignored on read");
  season.saveTournamentState({ v: 3 });
  ok(season.loadTournamentState() === null, "G6 a missing state is ignored on read");
  // over Postgres
  uninstallStubPg();
  const stub = installStubPg();
  const pgApp = freshApp("table-tennis", { databaseUrl: "postgres://u@localhost/db", dataDir: newDir() });
  await pgApp.store.init();
  pgApp.season.load();
  pgApp.season.saveTournamentState(snap);
  await sleep(50);
  eqv(stub.__state.table.get("table-tennis:tournamentState"), snap, "G7 the resume file rides the table (Neon path)");
  uninstallStubPg();
}

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
console.log("\nSUITE persistence: " + (pass + fail) + " cases, " + pass + " passed, " + fail + " failed");
if (fail) { console.log("FAILED CASES:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
})().catch(e => { console.error("SUITE CRASHED:", e); process.exit(1); });
