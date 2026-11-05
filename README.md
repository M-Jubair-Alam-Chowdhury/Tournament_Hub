# Tournament Hub

Table Tennis and Football on one server, one port, with a landing page to pick a game.

## The cut line moves; the golden boot; scorers after the whistle (v2.4)

Football gets three tournament-running upgrades (table tennis is
untouched — its qualifiers are chosen on its own stage-choice cards):

- **How many advance is a live setting.** While a round robin or a
  pool stage runs, a "Who advances" panel under the standings sets
  the number — one for a round robin, one per pool — and it can be
  changed at any point before the stage wraps up, **with matches
  already played** (the whole round robin can even sit scored,
  waiting on Continue). Played matches, the table and the ladder
  never move; only the cut line does, and the boundary takes
  whatever the setting says when it fires. Clearing the number
  finishes the tournament at that stage instead — the table leader
  is crowned. Every change lands in the decision log and survives
  restarts.
- **A golden boot that refreshes after every match.** The goal
  scorer leaderboard (player, team, goals, own goals apart) lives on
  the play screen, the Flow tab and the standings screen, and it is
  recomputed from every finished match on every state broadcast —
  save a score or fix a scorer and every screen, admin and
  spectator alike, updates together.
- **Who scored can be filled in after the match finished.** Every
  finished match carries an "Add scorers" (or "Goal sheet") button
  for the admin — even one whose score can no longer be corrected,
  even while the next stage's choice screen is up, even after the
  champion was crowned. The sheet-only form shows the final
  scoreline as fixed text: the result, the table and every later
  stage are untouched by construction, only the scorer list
  changes. The sheet must still account for every goal exactly,
  own goals credit the benefiting side, the golden boot refreshes
  with it — and if the tournament was already archived, the season
  entry is re-recorded from the live state so the season tallies
  carry the correction. Undo is surgical: a goal-sheet edit
  remembers only that one sheet, so undoing it never un-plays
  anything that happened after it.

Validated with a new 90-case suite (live cuts, per-pool cuts,
post-whistle sheets, tally refresh, archive re-record over a real
server) and the full browser journey — all 11 suites green
(1,188 assertions), every tab swept clean of markup artifacts, both
themes, 390px mobile, zero console errors.

## The flow strip renders its arrows again (v2.3.1)

The football flow tab was painting its stage summary as literal
markup — "Round robin `<svg …>` top 4" — in the flow strip chips and
the stage badges. An arrow icon had been embedded inside a string the
display sites HTML-escape, so the icon's own markup was escaped into
visible text. The summary is plain text again, and a dedicated
`stageBadgeHTML()` renders the real arrow icon where the summary is
displayed as markup (static literals and numbers only — nothing
user-entered passes through unescaped). The whole site was swept for
the same class of break — a static scan of every `esc()` wrapping of
an icon-bearing function, plus a scripted browser journey that walks
a full two-stage tournament in each app and asserts the visible text
on every tab (live, matches, flow, standings, season, video) never
contains markup artifacts, in light and dark mode and at 390px,
through to the crowned champion. The table-tennis app was never
affected (its summaries use a plain-text arrow) and sweeps clean.

## Matches carry their number — type one to jump there (v2.3)

- **The match index is numbered (both apps).** The Matches tab reads
  like a numbered sheet: `#1` is the first match of the draw, `#2` the
  second, straight through to the last (byes don't count). Spectators
  see a badge; the admin sees a small number input at the start of
  every movable fixture.
- **Type a number, press Enter — the fixture jumps straight there.**
  The v1.9 chevrons still nudge a fixture into the adjacent round;
  the number moves it any distance in one hop (match #10 becomes
  match #2 without eight clicks). The jump is one validated swap
  with whatever fixture holds the target number: the displaced
  fixture takes the old place, nothing else moves, and a jump either
  lands exactly on the asked number or nothing changes. Same rules
  as the arrows — same stage, same pool, both fixtures unplayed
  (football: clock stopped) — so rounds keep their size and their
  played count and the standings never notice. Jumps land in the
  event log, broadcast to everyone, and persist across restarts.

## Spectate on arrival — sign in from the corner button (v2.0)

There is no login page any more. Anyone who opens an app lands on the live
scoreboard straight away and spectates — the connection announces itself as a
spectator, so it can never take the admin seat by accident. The one control an
admin needs is the small round button in the top right corner of every page:

- **Token servers** (ADMIN_TOKENS set): the button opens a compact card —
  type the admin password, get the controls. Wrong passwords show an inline
  error; the same rate limiting and lockout as before still applies.
- **Open servers** (no tokens): the card offers "Claim the host seat". The
  claim is refused while someone else runs the show; the host seat is
  remembered for the tab so a refresh takes it straight back.
- Old `/login` bookmarks redirect into the app. The big role-selection pages
  and their `/api/auth-info` preflight are gone.

## Broadcast scoreline and light by default (v2.2)

- **Scorers read like a TV scoreline (football).** Goal chips in a
  single wrapped row are gone. Every match card — live and finished —
  now shows the goals the way a real-life broadcast does: the scoreline
  on top (`Team A 2–1 Team B`), and under it each goal on its own line
  beneath the team it counted for, minutes toward the middle (left
  side: `Player 1 12'`, right side: `25' Player 23`), own goals flagged
  `og`, newest-last within a side. The live card places the sheet
  between the scoreline and the clock, so the score reads as one
  block; the match index rows carry the same two-column sheet in a
  compact size (live matches included).
- **Light is the hub-wide default.** A first visit — or any fresh
  device — starts in light mode, even when the OS prefers dark. Dark
  mode remains one moon-button away and the choice still follows the
  visitor across the hub (one stored preference). The pre-paint
  bootstrap and the shared `hubApplyTheme` now resolve the same way,
  so a stored dark choice survives reloads exactly (previously the
  load-time pass could strip it).

## Pools by hand, adjustable added time, dark mode (v2.1)

- **The pool draft board (football).** On the format screen, picking
  "Pools" now deals a board you can shape by hand: move any team to
  any other pool with the select beside its name, rename the pools
  ("East", "Group of Death"…), and set each pool's own qualifier
  count. The deal starts from the split settings (random / by season
  rating / entry order) and **Re-deal** throws again. Build draw sends
  the exact board — validated server-side (every team placed once, ≥2
  per pool, qualifiers within bounds) and recorded in the decision
  log; the custom names flow through round headers, per-pool tables,
  the Flow tab and snapshots.
- **Take added time back (football).** The "Extra time" panel shows
  the current allowance with −1/+1 steppers and a **Set to N** field
  (0–15): announce 4 minutes, then set it to 2 and the whistle line
  moves with it — a running clock carries on to the new line, and a
  reduction below the played clock ends the half on the new line
  immediately. A −1 min quick button joins +1/+3/+5 at the whistle.
- **Dark mode (everywhere).** A moon button beside the corner admin
  button — and on the hub landing page — flips the whole hub to a
  night palette. The choice is shared across the hub and both apps;
  since v2.2 light is the default and dark is always the visitor's
  explicit choice. It's applied before first paint so there's no
  flash.

## Interface and live football clock

The hub and both sports use regular geometric layouts, solid surfaces,
consistent SVG icons, and responsive controls. No emoji, irregular
card shapes, or handwritten styling. Shared assets live in `public/ui.css`,
`public/ui.js`, and `public/icons.js`.

Football's **Record goal / finish match** button opens the match centre:

- **Kick off / Pause / Resume** controls a server-owned clock for that fixture.
  The same clock and live score appear for spectators and in the match index.
- **The whistle blows itself (v2.0).** Each half has a hard limit — half the
  configured match duration (45:00 on a 90-minute match), and full time at the
  full duration. A running clock is stopped exactly on the line by the server
  (checked every second, broadcast to everyone), and the status reads
  "1st half ended" / "Match ended". **Extra time** — the referee's added
  minutes — quick +1 / +3 / +5 buttons appear at the whistle (a −1 joins
  them once time is added), and the panel **sets** the allowance (0–15),
  so announced minutes can be taken back mid-half; adding or raising
  time after the half ended resumes the clock on its own. Half-time still
  moves the match on explicitly.
- **Half-time** freezes match time and shows the configured break countdown.
  **Start 2nd half** starts at half of the configured match duration.
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
validation, rejected roster changes, server restart recovery, and — since
v2.0 — the half limits, the automatic whistle, added time (including snapshot
round-trips), using isolated temporary data and local port 4119. Since v2.1
it also covers **extraSet** — replacing the announced added time in either
direction, including the immediate whistle when the allowance shrinks below
the played clock.

The existing football, table-tennis, hub, persistence, v17, v18, reorder and
live-clock suites are also applicable — `node scripts/test-suite-reorder.js`
now passes in full (91 cases) since v1.9.0 implemented the `moveMatch`,
`canUp` and `canDown` engine API it was written against. The hub suite grew
to 133 cases for the corner-button flow (instant spectate, `claimHost`, the
`/login` redirect, the removed preflight) and — since v2.3 — the numbered
jumps over the wire, including their survival across a hard restart. The
football suite gained a hand-drawn-pools section (196 cases), and `node
scripts/smoke-v21.js` walks the draft board and the adjustable added time
end-to-end against a real server. The v2.2 release was verified with a
scripted browser journey (scorer columns on played/live/index cards,
own-goal flag, sorted minutes, light default under an emulated dark OS,
toggle persistence across tabs, spectator and 390px mobile checks — zero
console errors). v2.3 adds `node scripts/test-suite-numbering.js` (117
cases across both apps: numbering with byes, exact two-fixture jumps,
rejections, pool boundaries, running-clock locks, snapshot round-trips)
and its own browser journey (numbered rows, an Enter-committed jump, the
arrows beside it, out-of-range toast, live-round "up now", spectator
badges, dark mode and 390px mobile — zero console errors). v2.3.1 adds
the raw-markup sweep: a static scan of every `esc()` call that wraps an
icon-bearing function (the football flow strip and stage badges were the
only two leaks), and a browser journey that drives a full two-stage
tournament in each app to the champion and asserts the visible text on
every tab — live, matches, flow, standings, season, video — never
contains markup artifacts (`<svg`, `</span>`, `&lt;`, `class="ic"` …),
in light and dark mode and at 390px, zero console errors.


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
  Each app signs in separately — the sign-in is kept per app in sessionStorage, so two
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
  it. The hub landing page and both apps share the
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
