# Tournament Hub

Table Tennis and Football on one server, one port, with a landing page to pick a game.

    npm install
    npm start          # http://localhost:3000  (landing page) -> /table-tennis/ and /football/

- Each app is independent: own tournament state, season archive, live video and
  WebSocket room. Data lives in `data/table-tennis/` and `data/football/`
  (override the root with `DATA_DIR`).
- The landing page at `/` has two cards, Table Tennis and Football. Each game page has an "All games" link back to it.
- Admin tokens: `ADMIN_TOKENS` sets one shared token list for both apps, or give each
  app its own with `ADMIN_TOKENS_table_tennis` / `ADMIN_TOKENS_football` (the per-app
  variables win when set; comma-separated lists mean one token per admin, as before).
  Each app signs in separately — the login is kept per app in sessionStorage, so two
  different tokens never fight over one tab. Changed a secret? Redeploy — env changes
  apply at deploy time, not to a running instance.
- Season backups in the browser are stored separately (`ttSeasonBackup` / `fbSeasonBackup`).
