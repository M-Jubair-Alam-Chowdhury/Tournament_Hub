# Tournament Hub

Table Tennis and Football on one server, one port, with a landing page to pick a game.

## Interface and live football clock

The hub, both sports, and sign-in pages use regular geometric layouts, solid
surfaces, consistent SVG icons, and responsive controls. No emoji, irregular
card shapes, or handwritten styling. Shared assets live in `public/ui.css`,
`public/ui.js`, and `public/icons.js`.

Football's **Record goal / finish match** button opens the match centre:

- **Kick off / Pause / Resume** controls a server-owned clock for that fixture.
  The same clock and live score appear for spectators and in the match index.
- **Half-time** freezes match time and shows the configured break countdown.
  **Start 2nd half** starts at half of the configured match duration. Period
  changes are explicit, so stoppage time never ends a half automatically.
- **Adjust time** accepts minutes and seconds while paused. It preserves goals.
- A new goal uses the clock's current minute; a manually entered minute is kept
  until **Use clock** is selected again. Own goals select the opposing squad's
  scorer and credit the selected scoring team. Adding, editing, or removing a
  goal updates the live totals immediately.
- **Save final score** validates the goal totals and any required shootout,
  stops the clock, and updates standings. Live goals alone do not change rankings.
  A rejected score leaves the clock and the form intact.
- Competing admin edits use match identity and revision checks. Stale changes
  are rejected instead of replacing another admin's changes. Disconnected clients
  show an error rather than silently discarding or queueing actions.

Closing the goal sheet does not stop the clock. In token-authenticated rooms,
losing the last admin pauses running clocks. Clock state and live goals are
saved after each action; ticking clocks are also checkpointed every five seconds.
After a server restart or snapshot import, clocks restore paused at the saved
elapsed time (a hard crash can lose up to the last checkpoint interval).
Server downtime is not counted as playing time. The existing open-mode behavior
still applies: leaving the host session closes that room.

### Validation

Run the new clock suite with `npm run test:clock`. It covers clock transitions,
invalid input, concurrent admins, spectators, goals, final scores, snapshot
validation, rejected roster changes, and server restart recovery using isolated
temporary data and local port 4119.

The existing football, table-tennis, hub, persistence, v17, v18, reorder and
live-clock suites are also applicable — `node scripts/test-suite-reorder.js`
now passes in full (91 cases) since v1.9.0 implemented the `moveMatch`,
`canUp` and `canDown` engine API it was written against.


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
- **The hand-drawn edition (v1.8.0):** every icon on every page is a
  hand-drawn SVG (no emoji anywhere), cards and chips get wobbly
  sketch radii with a wavy rule under section headings and handwritten
  notes in Caveat. A rejected score sheet no longer wipes what you
  typed — the form stays open with the draft until the server accepts
  it. The hub landing page, both apps and both login pages share the
  same kit.
- **Fixtures can be moved between rounds (v1.9.0):** in the Matches tab
  every unplayed fixture with settled entrants carries two small
  chevron buttons — pull it forward into the round that's up now, or
  push it back. Each move is a swap with a free fixture in the adjacent
  round (a partner sharing no entrants when one exists), so rounds
  keep their size and their played count: a round can never silently
  complete itself, and undo entries keep pointing where they should.
  A pulled-forward fixture is immediately live — score it through the
  normal sheet. Played matches, byes, TBD slots, finals, whole knockout
  and hybrid brackets (their rounds feed the next one positionally),
  tie-breaks and anything across a stage or pool boundary stay locked,
  and so does a football fixture whose clock is running (pause it and
  the clock, its goals and its elapsed time travel with the fixture).
  Moves persist across restarts, are refused while a tournament is
  suspended, and land in the event log. The reorder suite covers all
  of this end to end.
- **Table tennis plays games and matches (v1.8.0):** a match is best
  of 1, 3, 5 or 7 games (default 3) to 21 points a game (7–0 still
  wins a game outright; strict win-by-2 mode unchanged). The score
  sheet sits right under the match: one row per game with a live set
  tally, add/remove games, and per-game pills under every played
  match. Corrections, walkovers and forfeits all carry the full sheet
  (a forfeit is 2–0 on 21–0 games); the season archive stores it too.
- **Football goal sheets (v1.8.0):** every score can carry who scored,
  when and for whom — a running clock fills the minute in, the scorer
  is picked from the squad list (the captain included — she's a player
  too), own goals credit the other side and sit in their own column,
  and the golden boot table ranks the season's scorers. Wrong data?
  Correct any goal — minute, scorer, own-goal flag — or the whole
  score, with one undo step.
- **Solo and team apart (v1.8.0):** the table tennis leaderboard shows
  each player's singles record and pairs record in separate columns
  (and the profile card splits them too); football's leaderboard ranks
  teams by name with the squad and per-player goals a tap away.
- **Test suites (v1.8.0):** `node scripts/test-suite-v18.js` joins the
  pack — 800+ cases now cover the set sheets, goal sheets, solo/team
  split, walkovers and corrections end to end.
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
  run the regression pack per change (engine rules, persistence including a
  stubbed Postgres driver, and full hub integration: routes, auth, restart,
  registry) — see the v1.8.0 bullet above for the current totals.
