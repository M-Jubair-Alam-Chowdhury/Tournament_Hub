# Tournament Hub

Table Tennis and Football on one server, one port, with a landing page to pick a game.

    npm install
    npm start          # http://localhost:3000  (landing page) -> /table-tennis/ and /football/

- Each app is independent: own tournament state, season archive, live video and
  WebSocket room. Data lives in `data/table-tennis/` and `data/football/`
  (override the root with `DATA_DIR`).
- The landing page at `/` has two cards, Table Tennis and Football. Each game page has an "All games" link back to it.
- `ADMIN_TOKENS` works as before; the token is kept in sessionStorage, so one
  login covers both apps in the same tab.
- Season backups in the browser are stored separately (`ttSeasonBackup` / `fbSeasonBackup`).
