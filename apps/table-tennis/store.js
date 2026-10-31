/* Storage — one key/value store per app.
   Without DATABASE_URL everything stays in JSON files inside DATA_DIR,
   exactly as before. With DATABASE_URL (Neon or any Postgres) the same
   keys live in one season_data table (key TEXT PRIMARY KEY, value
   JSONB), prefixed "table-tennis:" / "football:" so both apps can
   share it. The first boot against a ready database imports any
   existing JSON file whose key is missing — files are kept untouched
   as backups. Writes are queued in call order and retried through
   connection drops (Neon cold starts). */
"use strict";
const fs = require("fs");
const path = require("path");

const APP = path.basename(__dirname);   // "table-tennis" / "football"
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
// only a Postgres URL switches storage away from JSON files — other
// DATABASE_URL values (sqlite, mysql…) belong to other tools and are ignored
const DATABASE_URL = /^(postgres|postgresql):\/\//i.test(String(process.env.DATABASE_URL || "").trim())
  ? String(process.env.DATABASE_URL).trim() : "";
const TABLE = "season_data";
const KEYS = {
  season: "season.json",
  tournamentState: "tournament-state.json",
  liveVideo: "live-video.json"
};

const USE_PG = DATABASE_URL !== "";
let pool = null;
const memory = new Map();        // pg mode: key -> value
let chain = Promise.resolve();   // pg mode: writes run one at a time, in order

function fileOf(key) { return path.join(DATA_DIR, KEYS[key]); }

function fileRead(key) {
  try { return JSON.parse(fs.readFileSync(fileOf(key), "utf8")); }
  catch (_) { return null; }
}

function fileWrite(key, value) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  const tmp = fileOf(key) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, key === "season" ? 2 : 0));
  fs.renameSync(tmp, fileOf(key));
}

function enqueue(job) {
  chain = chain.then(job, job);
  return chain;
}

async function query(sql, params) {
  for (let attempt = 0; ; attempt++) {
    try { return await pool.query(sql, params); }
    catch (err) {
      const s = String((err && err.code) || (err && err.message) || "");
      if (attempt >= 2 || !/ECONN|ETIMEDOUT|EAI_AGAIN|terminated|timeout|57P0/i.test(s)) throw err;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

async function init() {
  if (!USE_PG) return;
  const { Pool } = require("pg");
  let ssl = true;
  try {
    ssl = !/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(new URL(DATABASE_URL).hostname);
  } catch (_) {}
  if (/sslmode=disable/i.test(DATABASE_URL)) ssl = false;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 3, idleTimeoutMillis: 20000, connectionTimeoutMillis: 10000
  });
  await enqueue(async () => {
    await query("CREATE TABLE IF NOT EXISTS " + TABLE +
      " (key TEXT PRIMARY KEY, value JSONB NOT NULL)");
    const rows = (await query("SELECT key, value FROM " + TABLE +
      " WHERE key LIKE $1", [APP + ":%"])).rows;
    for (const r of rows) memory.set(r.key.slice(APP.length + 1), r.value);
    // first boot with a database: carry over any file it hasn't seen
    for (const key of Object.keys(KEYS)) {
      if (memory.has(key)) continue;
      const fromFile = fileRead(key);
      if (fromFile == null) continue;
      await query("INSERT INTO " + TABLE + " (key, value) VALUES ($1, $2::jsonb)" +
        " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [APP + ":" + key, JSON.stringify(fromFile)]);
      memory.set(key, fromFile);
      console.log(APP + ": imported " + KEYS[key] + " into Postgres (file kept as backup)");
    }
  });
}

function get(key) {
  if (!USE_PG) return fileRead(key);
  const v = memory.get(key);
  return v === undefined ? null : v;
}

function set(key, value) {
  if (!USE_PG) { fileWrite(key, value); return; }
  memory.set(key, value);
  const text = JSON.stringify(value);
  enqueue(() => query("INSERT INTO " + TABLE + " (key, value) VALUES ($1, $2::jsonb)" +
    " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [APP + ":" + key, text]))
    .catch(err => console.error(APP + ": saving " + KEYS[key] + " failed:", err.message));
}

function del(key) {
  if (!USE_PG) { try { fs.unlinkSync(fileOf(key)); } catch (_) {} return; }
  memory.delete(key);
  enqueue(() => query("DELETE FROM " + TABLE + " WHERE key = $1", [APP + ":" + key]))
    .catch(err => console.error(APP + ": clearing " + KEYS[key] + " failed:", err.message));
}

module.exports = { init, get, set, del };
