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
- **Match index, score correction, live roster changes, player
  profiles and a steadier connection (v1.7.0):**
  - **Matches tab** — every fixture of the draw in one list, grouped by
    round, playable in any order once its entrants are known. A saved
    score can be **corrected** from the same list while nothing has
    been played on top of it; one undo step takes a correction back.
    Knockout slots stay "to be decided" until the round before them
    resolves, so brackets never skip ahead.
  - **Roster changes during a tournament** — a late player (or
    football squad) joins the running group stage and gets fixtures
    against everyone; a leaver's played matches are **annulled and
    the table rebuilt** (the international rule), or their knockout
    match is forfeited (3–0 / 11–0) and the opponent advances.
  - **Player profiles + separate team ranks (table tennis)** — the
    season leaderboard now ranks *players*, because partners rotate
    daily; pairings that actually played together get their own
    "Team ranks" table. Tap any row for a profile card: rating, W–L,
    titles, best finish, form, favourite partners, UID.
    Football gets team profile cards (squad, captain, UID, record).
  - **The football ladder follows the FIFA criteria exactly:**
    points, goal difference, goals scored, then head-to-head among
    the level teams (points, GD, goals), then a seeded drawing of
    lots. Penalty shootouts stay knockout-only; a shootout counts as
    a draw in the tables, as it should.
  - **No more blank live page** — a dropped connection (Render
    restart, cold database) used to wipe the whole sheet to a
    "Connecting…" shell. Now the last state stays on screen under a
    reconnecting banner, the retry backs off 1.5 s → 15 s, and a
    drawing error shows a card instead of freezing the page.
  - **Football's spectator flag no longer leaks into table tennis**
    (the login page wrote the wrong key — a football spectator could
    claim the open-mode admin seat and silently close the room).
  - A paused tournament saved at the first format-choice screen now
    restores correctly (snapshots used to demand a draw that didn't
    exist yet).
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
