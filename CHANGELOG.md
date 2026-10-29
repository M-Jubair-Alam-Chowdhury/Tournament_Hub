# Changelog

All notable changes to **Table Tennis Live**. Newest version first.

The README stays short on purpose — this file is where the version
history lives.

## v1.3.1 — spectator means spectator

### Fixed

- **Choosing Spectator on the login page could still land you in the
  admin seat.** In open mode (no `ADMIN_TOKENS` configured), the
  server handed the admin role to the first socket to connect — even
  one from a tab that had explicitly clicked *Watch the scoreboard*.
  Now the spectator choice travels with the socket (`?viewer=1`), and
  the server never gives that connection the controls: not in token
  mode (impossible anyway) and not in open mode (where the first
  **non-spectator** to enter as host runs the show, as before).
- **Open-mode "Enter as host" trapped you in a redirect loop.** The
  login gate on `/` bounced any tab without a stored role back to
  `/login` — including a host who had just picked *Enter as host*,
  since that path stored no flag. Host entry now sets a tab-local
  `ttHost` flag the gate understands, and signing in as admin /
  switching to spectator cleans all the flags up properly.
- The signed-in note on `/login` ("This tab is already signed in")
  no longer risks dropping this tab's admin token on the floor.

### Changed

- The open-mode login card now **says what open mode means**: no
  token is configured, the token form is hidden, and anyone entering
  as host gets the controls. It explains how to lock things down —
  set `ADMIN_TOKENS` in the host's environment (on Render:
  Environment → Add environment variable) and **deploy again**, since
  environment changes apply at deploy time, not to a running
  instance.
- Open-mode guests with no admin around see a **Become the host**
  button in the role bar (it leads to the login page) instead of a
  bare "no admin connected" note.
- README rewritten to be short and simple; the version history moved
  here. `CHANGES.md` is gone — this file replaces it.

## v1.3.0 — logins, viewers, resume

### Added

- **A login page (`/login`)**: pick a role before anything else —
  admin with a token, or spectator with one click. The scoreboard
  (`/`) bounces role-less visitors there; a spectator can take over
  mid-event via the viewer bar's *Admin login* button.
- **Token authentication built for a public repo**: tokens live only
  in the `ADMIN_TOKENS` environment variable (comma-separated, one
  per admin). The server holds SHA-256 digests only, compares them
  with `crypto.timingSafeEqual` against every configured token (no
  early exit), rate-limits wrong attempts per IP (5 fails / 15 min →
  15 min lockout; tunable via `AUTH_FAIL_MAX`, `AUTH_WINDOW_MS`,
  `AUTH_LOCK_MS`), caps submitted token lengths, and answers with
  generic failure text. The browser keeps the token in
  sessionStorage (dies with the tab), re-signs in silently on
  reconnect, and offers an explicit log-out.
- **Viewer mode**: with tokens configured, everyone else gets all
  three tabs — live scores, flow map, season — fully live and
  strictly read-only, enforced by the server, not just hidden
  buttons. When the last admin leaves, the tournament freezes for
  everyone and continues when any admin returns.
- **Tournament resume**: the running tournament auto-saves to
  `data/tournament-state.json` after every change (atomic writes;
  keystroke drafts excluded). A cold boot restores it **paused**;
  the first admin picks **Resume** (exact draw, scores, standings)
  or **Start fresh** (archived as abandoned, unrated). Tournament
  tools in the Season tab can download / load a tournament as JSON —
  validated whole-file, seed-guarded against double-recording.
- `GET /api/auth-info` — the login page asks the server which mode
  it's in (token or open) and what's live before opening any socket.

### Notes

- No `ADMIN_TOKENS` set = open mode: first-connect-admin, the
  v1.x behaviour, for local/casual use.
- Snapshots deep-walk the state so array-with-properties
  (`round.eliminated`, `stageLabel`) survive `JSON.stringify` — the
  same JSON quirk that silently broke v1.0's wire format.

## v1.2.0 — the season, the map, the stars

### Added

- **Flow tab**: the whole tournament as one map — a stage strip
  (`1 · Pools ×4 → 2 · Knockout → 🏆`), pool cards with qualifiers
  highlighted, a knockout bracket with connector lines (live matches
  flash "UP NEXT"), round-robin standings boards, and a **decision
  log** recording every draw choice. Legacy `format: auto`
  tournaments render as one big stage.
- **Season archive** (`season.js`, `data/season.json`): every
  tournament is archived — champions complete, mid-play resets as
  "abandoned" (kept, unrated). The Season tab derives **ELO ratings**
  (start 1000, K=32, replayed from full match history so undo can
  never double-count), W–L, win rate, point diff, titles, top-2s,
  best finish and last-5 form on a sortable leaderboard, plus full
  tournament history. Export / import as JSON, start a new season,
  and an automatic browser-side mirror that offers to restore a
  lost archive. `GET /api/season` exposes the public view.
- **Star players** ⭐: earned automatically at rating 1080+ over 6+
  matches, or 65%+ win rate over 8+ matches, or 2+ titles — and
  hand-starrable by the admin. Stars follow a name everywhere it
  appears; hovering shows why it was given.
- **A choice system**: format cards plus *draw the format at random*;
  qualifiers by standings, random draw, or hand-picked checklist;
  bracket seeding cross-seeded from pools, random, by season ELO, or
  by hand (permutation-validated); pool splitting random or snake
  deal by rating. Random decisions land in the decision log and as
  toasts.
- Three-tab UI (Live / Flow / Season) built from the app's own
  design tokens.

## v1.1.0 — you choose the format

### Added

- **Multi-stage tournaments**: the draw is a chain of stages and the
  app asks which format each one runs — Round Robin, Elimination,
  Hybrid, or Pools — with projected match counts on the cards. The
  same choice at every stage boundary until a champion is crowned.
- **Pools**: n pools with individual sizes and qualifier counts; a
  blank line between name groups makes each block a pool with its
  own `qualify: N`. Pools can feed pools, knockouts, or a final
  round robin.
- **Roster directives**: `format:`, `pools:`, `qualify:`, `then:`,
  `limit:`, `rules: strict` (11-point win-by-2 or best-of match
  scores).
- **Undo last score**, cross-pool seeding (1A vs 2B …), and a
  head-to-head tie-break ladder that always terminates (h2h wins →
  h2h points → overall diff → points for → recorded lottery).

### Fixed

- **v1.0 wire bug**: `round.eliminated` was stored as a property of
  a round array — `JSON.stringify` drops those silently, so the
  elimination banner and OUT tags never reached any browser. Rounds
  now project that data into `schedule.roundMeta`.
- Three-way ties could loop forever regenerating replays; the ladder
  now ends in a recorded lottery.
- Saving over an already-played match double-counted wins/points —
  now blocked with "use Undo".
- Non-power-of-two knockouts pad with BYEs (auto 11–0 walkovers);
  2-player tournaments are legal; ~20 new validation cases with
  actionable messages.

## v1.0.0 — first release

The original Match Sheet: one shared sheet everyone opens — the host
enters names, the app draws the tournament (round robin for odd
counts, knockout for powers of two, hybrid otherwise), keeps live
scores, standings and elimination tags in sync over a WebSocket, and
crowns a champion. Teams mode with forbidden pairings included.
