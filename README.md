# Tournament Hub

Table Tennis and Football on one server, one port, with a landing page to pick a game.

    npm install
    npm start          # http://localhost:3000  (landing page) -> /table-tennis/ and /football/

- Each app is independent: own tournament state, season archive, live video and
  WebSocket room. Data lives in `data/table-tennis/` and `data/football/`
  (override the root with `DATA_DIR`) — or in one Postgres `season_data` table
  when `DATABASE_URL` is set; see the last bullet.
- The landing page at `/` has two cards, Table Tennis and Football. Each game page has an "All games" link back to it.
- Admin tokens: `ADMIN_TOKENS` sets one shared token list for both apps, or give each
  app its own with `ADMIN_TOKENS_table_tennis` / `ADMIN_TOKENS_football` (the per-app
  variables win when set; comma-separated lists mean one token per admin, as before).
  Each app signs in separately — the login is kept per app in sessionStorage, so two
  different tokens never fight over one tab. Changed a secret? Redeploy — env changes
  apply at deploy time, not to a running instance.
- Season backups in the browser are stored separately (`ttSeasonBackup` / `fbSeasonBackup`).
- v1.5.0 polish: one drawn SVG icon set across all pages (no emoji), favicons and
  theme colours, a sticky tab bar while scrolling, number-pad score inputs, themed
  selection/scrollbars, animated connecting dots, screen-reader-friendly toasts,
  and a softer squad dialog on the football side.
- **Neon / Postgres storage (v1.5.1):** set `DATABASE_URL` to a Postgres
  connection string (Neon's, with `?sslmode=require`) and each app's season,
  live tournament state and live video move out of `data/` JSON files into one
  shared `season_data` table — key `TEXT PRIMARY KEY`, value `JSONB`, rows
  prefixed `table-tennis:` / `football:` so both apps share it. The table is
  created automatically, and the first boot imports any existing JSON file whose
  key isn't in the database yet, leaving the file untouched as a backup. Without
  `DATABASE_URL` nothing changes — same JSON files as before. See what's stored
  with `node scripts/neon-check.js`; note that an unreachable database stops the
  process at boot, and Render then keeps restarting it until the database
  answers.
- **Saved players / teams with UIDs (v1.6.0):** everyone who enters a tournament
  is saved to the database automatically (`players` key in `season_data`, so it
  rides Neon or the JSON files). The roster screen shows them as chips — one
  click adds a player (or a whole football squad) to the next tournament, no
  typing. Each entry carries a stable UID (`p-xxxxxxxx`, shown in the chip
  tooltip); `✕` forgets an entry, "Save these players" stores the current list
  by hand. `GET /api/players` lists them read-only.
- **Back to setup (v1.6.0):** the "Back to setup — edit players/teams" button
  drops the draw and returns to the roster with everything pre-filled —
  unselect whoever is out and rebuild. A restart after played matches archives
  the run as abandoned, exactly like closing the room.
- **Football plays international rules:** 3 points for a win, 1 for a draw,
  goal difference then goals scored, group draws stand, knockout matches level
  after full time are settled by a penalty shootout (and still count as draws
  in the table, per FIFA statistics), dead-level teams are separated by the
  head-to-head between them before a seeded drawing of lots, and walkovers are
  3-0. Table tennis keeps the house rules: point-limit scoring, win-by-2 in
  strict mode, the 7-0 instant win, and no more than 2 matches in a row.
- **Test suites (v1.6.0):** `node scripts/test-suite-tt-logic.js`,
  `test-suite-fb-logic.js`, `test-suite-persistence.js` and `test-suite-hub.js`
  run 585 cases per change (engine rules, persistence including a stubbed
  Postgres driver, and full hub integration: routes, auth, restart, registry).
