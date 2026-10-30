# Changes — v1.3 "logins, viewers, resume"

A dedicated **login page** where every visitor picks a role — admin
with a token, or spectator with one click — token authentication
built for a **public repo**, fully-open read-only viewing for
everyone else, and a resume system that picks tournaments up exactly
where they stopped — even across a server restart. Nothing sensitive
ever lives in the source.

## The headline features

### 1. A login page: choose admin or spectator
- The app now opens on **`/login`** — two cards, one choice, built
  from the app's own design tokens so it looks like home.
- **Admin card**: type the token, *Sign in* — it travels the same
  hardened WebSocket path (SHA-256 digest + timing-safe compare +
  per-IP rate limit), lands in the tab's sessionStorage, and you're
  dropped straight into the admin panel. Wrong tokens get an inline
  error with the attempts countdown; a live chip shows what's on
  the table (name, matches played) and how many are watching.
- **Spectator card**: one click — *Watch the scoreboard* — and
  you're in, read-only. The choice is remembered locally so reloads
  don't ask again; signing in as admin clears it.
- The page asks `GET /api/auth-info` which mode the server is in
  **before opening any socket**: in open mode the admin card becomes
  a plain “Enter as host” (no token form), and the page never
  connects — so it can't accidentally claim the admin seat.
- The scoreboard itself (`/`) bounces role-less visitors to `/login`;
  the viewer bar's **Admin login** button leads there too.

### 2. Admin login with tokens (hardened for a public repo)
- Tokens come from the `ADMIN_TOKENS` environment variable only
  (comma-separated: one per admin — you, your partner, …). Never in
  code, defaults, logs, or error text. The server keeps SHA-256
  **digests**, not the tokens.
- `crypto.timingSafeEqual` on the digests, compared against **every**
  configured token with no early exit — constant time, no length or
  position leaks.
- **Per-IP rate limiting**: 5 failures / 15 min → 15 min lockout, with
  attempt countdown in the messages. Tunable (`AUTH_FAIL_MAX`,
  `AUTH_WINDOW_MS`, `AUTH_LOCK_MS`). Submitted tokens are length-capped
  (≤512 chars) and never echoed.
- Browser keeps the token in **sessionStorage** (dies with the tab):
  typed once on the login page, silent re-login on reconnect,
  explicit Log-out button, never in localStorage/cookies/URLs.
- Any number of admins concurrently; short-token warning at boot.
- **No token configured = open mode**: first-connect-admin, exactly the
  v1.x behaviour (local/casual use). The login page says so plainly.

### 3. Viewers: everything visible, nothing changeable
- With tokens set, every visitor is a viewer: Live / Flow / Season all
  fully live and read-only. Server-side rejection plus disabled UI.
- **Admins no longer end the session**: when the last admin leaves in
  token mode, the room stays open, the tournament freezes, viewers keep
  watching, and any admin's return continues it — no reset, no loss.
  Open mode keeps the classic close-on-admin-leave behaviour.

### 4. Resume a saved tournament
- The running tournament auto-saves to `data/tournament-state.json`
  after every change (atomic writes; `draftScore` keystrokes excluded).
- On boot, a saved tournament restores **paused**: viewers browse
  freely; the first admin chooses **▶ Resume** (exact draw, scores,
  standings, next match) or **Start fresh** (archived as abandoned,
  unrated). Mutations are blocked while paused — even for admins.
- **Tournament tools** (Season tab, admin): download the tournament as
  `.json`, load one back — validated whole-file; foreign or corrupt
  files are rejected without touching the running state. Tournament
  IDs are seed-guarded against the season file, so a restart on the
  standings screen can never double-record a champion.

### 5. Engineering note: JSON's array-property trap, again
- Round arrays carry custom properties (`eliminated`, `stageLabel`)
  that `JSON.stringify` silently drops — the same quirk that broke
  v1.0's wire format would have corrupted resume files. Snapshots
  deep-walk the state and lift array-with-props into
  `{__arr, items, …}` wrappers; the loader revives them and validates
  the whole structure (version, step, entrants, draw shape, round
  pointer, undo stack) before swapping anything in.

## File-by-file
- `public/login.html` (new) — the role-choice front door: admin token
  form (with show/hide, inline errors, shake, live chip) and the
  spectator button; mode-aware via `/api/auth-info`; its sign-in
  socket is page-level (a local one can be garbage-collected
  mid-handshake and never fire — found by the browser journey).
- `server.js` — auth (digests, timing-safe compare, per-IP limiter),
  multi-admin role bookkeeping, viewer-mode welcome/broadcast fields
  (`authRequired`), auto-persist + boot-restore with suspension,
  `auth`/`logout`/`resumeTournament`/`stateFull`/`stateImport`
  messages, suspended-mutation allowlist, open-mode legacy path
  preserved, `GET /api/auth-info` + `GET /login` for the login page.
- `logic.js` — `saveStateSnapshot`/`loadStateSnapshot` (deep-safe
  serializer + validator), `isSuspended`/`setSuspended`, wire carries
  `suspended`/`pausedAt`.
- `season.js` — `saveTournamentState`/`loadTournamentState`/
  `clearTournamentState` for `data/tournament-state.json`.
- `public/index.html` — the login gate (no token, no spectator choice
  → `/login`), role-bar login/logout controls pointing at the page,
  paused/waiting notices, the resume card, tournament tools, silent
  re-auth, authOk/authFail handling, import toast.
- `README.md` / `CHANGES.md` — the v1.3 guide (Render env-var setup,
  token generation, honest threat model). Version 1.3.0.

## Compatibility notes
- Open mode (no `ADMIN_TOKENS`) behaves like v1.2 in-session; the only
  change is crash recovery: a hard restart now offers Resume instead
  of silently losing the tournament.
- Token mode changes room semantics: viewers are never kicked, and
  admin departures freeze rather than abandon. Abandoned records now
  only happen on an explicit reset.
- Old `data/` dirs keep working; `tournament-state.json` simply appears
  on first run.

## Tests
- `26` login-page assertions (`/login` served with both roles and the
  app's tokens, `/api/auth-info` in both modes, the login gate in `/`,
  the exact page sign-in flow over the wire: wrong token → countdown,
  right token → admin, live-tournament reporting on the login page) —
  `test-login-v13.js`.
- `45` new logic assertions (snapshot round-trips incl. the
  array-property survival, undo across a snapshot, validation of ~12
  foreign/corrupt file shapes, suspension flag) — `test-v13.js`.
- `41` new WebSocket end-to-end assertions (viewer lockout, wrong
  token countdown, lockout + expiry, multi-admin, logout, freeze on
  last-admin-leave, hard-restart suspension, resume-to-champion,
  no-double-record across two restarts, state export/import, open-mode
  session-end + crash recovery) — `test-ws-v13.js`.
- All v1.2 suites still green (87 logic + 39 ws) — open mode is
  regression-covered.
- Browser journey verified with screenshots (the login page in both
  modes, wrong-token error, token → admin panel, resume card, viewer
  read-only, spectator through the login page) and zero console
  errors.

---

# Changes — v1.2 "the season, the map, the stars"

The tournament grows a longer memory and a bigger picture: a flowchart of
the whole event, a season archive that judges players across the whole
year, automatic star players, and a choice system with a random option
everywhere. Still the same single server, same one-page client, same
zero-database simplicity — the season lives in one JSON file.

## The headline features

### 1. Flow tab — the whole tournament as one map
- A stage pipeline strip (`1 · Pools ×4 → 2 · Knockout → 🏆`) with
  finished stages ticked and the current stage highlighted.
- Per-stage boards: pool cards with qualifiers highlighted, a knockout
  **bracket with connector lines** (winners visually feed the next round,
  the live match flashes "UP NEXT"), round-robin standings, and hybrid
  two-part boards. Legacy `format: auto` draws render as one stage.
- A **decision log** — every draw decision (random draws, hand picks,
  lotteries) is recorded under the map, so the bracket is always
  explainable after the fact.
- Byes show as "— bye —" rows; eliminated players get OUT-styled rows
  right inside the bracket.

### 2. Season archive — judge players across the year
- New `season.js` module: every tournament is recorded to
  `data/season.json` (relocatable with the `DATA_DIR` env var). Atomic
  writes (tmp+rename), tolerant of read-only disks, validated on load.
- Champions complete the record; resets/abandons mid-play are archived as
  "abandoned" (kept in history, never counted toward ratings); tournaments
  that never scored a match aren't recorded at all. Each tournament
  records exactly once (unique seed guard).
- **Season tab**: ELO leaderboard (start 1000, K=32, replayed from the
  full match history so undo/re-records can't double-count), W–L, win%,
  point diff, titles, top-2s, best finish, last-5 form dots — on a
  **sortable table** — plus the full tournament history with podiums.
- **Export / Import** the season as JSON, **start a new season**, and an
  automatic browser-side mirror (localStorage) that offers to restore the
  archive if the server's copy is ever lost. `GET /api/season` exposes the
  public view too.
- Guests get the full read-only season view; only the admin can star,
  import, or reset the season.

### 3. Star players ⭐
- Automatic stars for clearly-better numbers: rating 1080+ over 6+
  matches, or 65%+ win rate over 8+ matches, or 2+ titles. The reasons
  show on hover.
- Admin can hand-star anyone (☆/★ toggle in the season leaderboard).
- Stars appear everywhere a name does: live standings, brackets, pools,
  season history, the champion block.

### 4. Choice system — pick it yourself, or draw it at random
- **Format**: "🎲 Can't decide? Draw the format at random" on the
  stage-choice screen (draws format + a sensible pool shape).
- **Qualifiers** (every boundary): standings order (default), 🎲 random
  draw, or ✋ pick-by-hand checklist.
- **Bracket seeding**: cross-seed from pools, 🎲 random, ⭐ by season ELO
  rating, or ✋ by hand (tap players in order; permutation-validated).
- **Pool splitting**: 🎲 random or ⭐ snake deal by season rating
  (strongest spread across pools).
- All random/hand decisions are recorded in the decision log + toasts.

### 5. UI refresh (same language, clearer picture)
- Three tabs across the top: **Live / Flow / Season**, built from the
  app's own design tokens (same palette, same fonts, same red/green/gold
  semantics). The live sheet keeps its familiar look.
- Toast notifications for errors and season events; eliminated rows,
  qualifier rows, live match and bye states all have dedicated visual
  treatments; sortable column headers; collapsible history entries.

## File-by-file
- `season.js` (new) — the season store: recording, derived stats, ELO,
  stars, export/import, new-season, caching.
- `logic.js` — choice-system engine (qmode/seedMode/seedOrder/splitMode
  resolution with ratings injected), event log (`noteEvent`), tournament
  record snapshot (`getTournamentRecord`), pool split by rating, manual
  seed-order validation.
- `server.js` — season wiring: records completed/abandoned tournaments,
  `seasonStar`/`seasonImport`/`seasonNew` actions, `seasonFull` download
  request, season view attached to every broadcast and welcome, admin
  mirror hand-off, `GET /api/season`.
- `public/index.html` — tabs, the flow map, the season view, stars,
  toasts, the choice-system controls (all additive; the live screens'
  behaviour unchanged).
- `README.md` / `CHANGES.md` — documentation. Version 1.2.0.

## Compatibility notes
- Deploying over a running v1.1/v1.0 session resets the live tournament
  (as always). First run creates `data/season.json`.
- Render **free tier** wipes disk on every deploy: use Export before
  pushing and Import after (or the browser mirror restore bar). Any host
  with persistent disk keeps the archive automatically.
- Everything from v1.1 still works: directives, pools, byes, undo, strict
  scoring, `format: auto` legacy path — covered by regression tests.

## Tests
- `87` logic-level assertions (all v1.1 regression + qualifier modes,
  seed modes, pool split modes, tournament record snapshots, season
  store: ELO math, stars, persistence round-trips, undo interplay).
- `39` WebSocket end-to-end assertions (roles, guest lockout, choice
  modes over the wire, flow/season data in broadcasts, star toggle,
  export/import round-trip, abandoned recording on reset, session end).
- Full browser journey screenshot-verified (admin + guest), zero console
  errors, including the flow bracket, season leaderboard, and star views.

---

# Changes — v1.1 "you choose the format"

Multi-stage tournaments for Table Tennis Live. Same look, same flow,
same single-file deploy — the tournament engine underneath got a lot
more flexible.

## The headline features

### 1. The format is a choice, not a guess
- With no configuration, the app now **asks** how to draw the
  tournament (Round Robin / Elimination / Hybrid / Pools) instead of
  inferring it from the player count. Each card shows the projected
  match count.
- `format: rr|elim|hybrid|pools|auto` in the roster skips the prompt.
  `format: auto` reproduces the exact v1.0 behaviour (including the
  21-match guard and the "too many" screen).
- Round robin is now available for any count (8 players → 28 matches
  is allowed if you picked it knowingly). Elimination works for any
  count too — the bracket pads to the next power of two with BYEs.

### 2. Pools (n pools, x_i players, w_i winners)
- Auto mode: `pools: N` + `qualify: W` deals the entrants into N
  balanced pools (snake seeding, shuffled).
- Manual mode: blank lines in the roster split blocks; each block is
  a pool with its own size; a `qualify: N` line inside a block sets
  that pool's winners (a `qualify:` before any names is the global
  default).
- Pools work at the first stage AND at any later boundary (e.g.
  12 qualifiers → 4 pools of 3 → 4 winners → semifinals).
- Teams mode is fully supported via pool counts (typed name-groups
  are player-level, so they're singles-only — the app says so if you
  try).

### 3. Full flexibility at every boundary
- When a stage ends, its qualifiers are shown and the app asks what
  runs next: the same four formats, again, forever (pools → pools →
  rr → elim → … ) until a champion is crowned.
- A round robin picked at a boundary can either finish the
  tournament (classic top-2 final) or **advance top N** into yet
  another stage.
- `then: rr:4, elim` pre-declares the chain; the boundary screen
  preselects it but you can still override live.
- If a stage produces exactly one qualifier, that player is the
  champion on the spot.

### 4. Edge cases resolved
- **Non-power-of-two knockouts**: BYE padding to the next power of
  two; byes auto-resolve as 11–0 walkovers, never appear in
  standings, never show as "undefined", and are filtered from
  eliminated lists.
- **Odd pool sizes**: the round-robin generator's BYE handling now
  feeds through pools correctly.
- **Tie-break termination**: v1.0 could loop forever regenerating
  tie-break replays when players stayed fully tied (a 3-cycle with
  equal scores does this deterministically!). Now: one replay, then
  a deterministic ladder, then a recorded lottery. It always ends.
- **Double-save corruption**: saving a score over an already-played
  match used to double-count wins/points. Now blocked ("use Undo").
- **Wire-format bug (v1.0)**: `round.eliminated` was stored as a
  property of a round ARRAY — `JSON.stringify` silently drops those,
  so the elimination banner and OUT tags **never reached any
  browser**. Rounds now project that data into
  `schedule.roundMeta` and the banner/tags actually display.
- **2-player tournaments**: legal now (the single match is the
  final). Roster minimum is 2.
- Validation everywhere: pool of one, winners ≥ pool size, too many
  pools, duplicate names in groups, advance-N out of range, hybrid
  with the wrong field size, bad directive values — all rejected
  with messages that say what to fix.

## Bonus features
- **Undo last score** (admin, play screen): reverts the most recent
  save — match state and the standings table snap back. Seals once
  the round advances.
- **Cross-pool seeding**: a knockout fed by pools seeds all pool
  winners (by pool record) ahead of all runners-up and pairs seed i
  vs seed P+1-i — the classic 1A vs 2B draw, so pool rivals only
  meet late.
- **Head-to-head tie-break ladder** for pools/round robins: wins →
  h2h wins → h2h point diff → overall diff → points for → (recorded)
  lottery. The standings table shows the server's authoritative
  order, so what you see matches who actually qualifies.
- **Strict scoring** (`rules: strict`): 11-point win-by-2 game
  scores or best-of-3/5 match scores only.
- **Configurable cap**: `limit: N` raises (or lowers) the per-stage
  match cap. Default 21 still applies to `format: auto` draws only.

## File-by-file
- `logic.js` — restructured around a stage engine
  (`S.stages`, boundaries, `buildStage`, pool advancement, the
  ranking ladder, directive parsing, undo, strict scoring). All v1.0
  functions/flows preserved; `format: auto` is the untouched legacy
  path. New exports: `pickStage`, `undoScore`, `getStateForWire`,
  `confirmTeamsAndDraw`.
- `server.js` — two new admin actions (`pickStage`, `undoScore`);
  state broadcasts use the wire-safe projection.
- `public/index.html` — additive render branches only, all built
  from the app's existing CSS classes: the stage-choice screen, pool
  badges on rounds, the undo button, and the roundMeta reads. Zero
  styling changes, zero changes to the existing screens' markup —
  the roster, mode, pairing, teams and standings screens are
  byte-for-byte identical renders (verified by screenshot diff).
- `README.md` / `CHANGES.md` — documentation.

## Compatibility notes
- Deploying this over a running v1.0 resets in-memory tournaments
  (same as any v1.0 redeploy).
- Guest behaviour, admin handoff, session-end semantics: unchanged.
- `format: auto` + no directives behaves like v1.0 except: the app
  now asks for the first format instead of auto-drawing (use
  `format: auto` to skip the prompt entirely), and elimination
  banners/OUT tags now actually appear (they were dead code before).

## Tests
- `117` logic-level assertions (legacy regression, every format,
  pools of every shape, tie-break ladders incl. 3-cycles, undo,
  strict scoring, ~20 validation edge cases) — run 8× to confirm
  no randomness flakes.
- `24` WebSocket end-to-end assertions (admin/guest roles, guest
  lockout, full pools→elim over the wire, undo round-trip, unknown
  actions, reset, session-end).
- Browser walk-through of the full user journey + screenshot diff
  against the original app.
