/* Check what's stored in Postgres: lists every season_data row and,
   when the matching JSON file still exists locally, deep-compares the
   two. Run it with DATABASE_URL set:

     DATABASE_URL="postgres://..." node scripts/neon-check.js          */
"use strict";
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { isDeepStrictEqual } = require("util");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!/^(postgres|postgresql):\/\//i.test(DATABASE_URL)) {
  console.log("Set DATABASE_URL to your Postgres/Neon connection string first.");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILES = {
  season: "season.json",
  tournamentState: "tournament-state.json",
  liveVideo: "live-video.json"
};

function ssl() {
  try {
    if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(new URL(DATABASE_URL).hostname))
      return undefined;
  } catch (_) {}
  return { rejectUnauthorized: false };
}

function summary(key, v) {
  if (/season$/.test(key)) {
    const rated = v.tournaments.filter(t => t.status !== "abandoned").length;
    return '"' + (v.name || "?") + '" — ' + v.tournaments.length + " tournaments, " + rated + " rated";
  }
  if (/tournamentState$/.test(key))
    return v.state && v.state.step ? 'tournament at step "' + v.state.step + '"' : "?";
  if (/liveVideo$/.test(key)) return "video " + v.id;
  return "";
}

(async () => {
  const pool = new Pool({
    connectionString: DATABASE_URL, ssl: ssl(), connectionTimeoutMillis: 10000
  });
  const { rows } = await pool.query("SELECT key, value FROM season_data ORDER BY key");
  await pool.end();
  if (!rows.length) { console.log("season_data is empty — nothing stored yet."); return; }
  for (const r of rows) {
    console.log("  " + r.key.padEnd(32) + summary(r.key, r.value));
    const m = r.key.match(/^([^:]+):(season|tournamentState|liveVideo)$/);
    const file = m && path.join(DATA_DIR, m[1], FILES[m[2]]);
    if (file && fs.existsSync(file)) {
      let same = false;
      try { same = isDeepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), r.value); } catch (_) {}
      console.log("      " + (same
        ? "matches the local file (backup)"
        : "differs from the local file (file is the pre-migration backup)"));
    }
  }
  console.log("\n" + rows.length + " row(s).");
})().catch(err => {
  console.error("check failed:", (err && (err.code || err.message)) || err);
  process.exit(1);
});
