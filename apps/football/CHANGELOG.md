# Changelog

All notable changes to **Table Tennis Live**. Newest version first.

The README stays short on purpose — this file is where the version
history lives.

## v1.4.4 — interface polish pass

### Added

- **Every control now shows keyboard focus, hover and press feedback.**
  A single interaction layer gives buttons, chips, format cards,
  pick cells, tabs, sort headers and inputs a 160ms transition, a
  hover state, a press response, and the same gold focus ring the
  tabs already had. Tiny controls (star toggles, pill close
  buttons, table sort headers) get expanded touch areas without
  changing their visual size, and everything switches off under
  `prefers-reduced-motion`.
- **Pinch-zoom works again.** The viewport no longer caps
  `maximum-scale` at 1, so low-vision users can zoom the sheet
  like any other page (WCAG 1.4.4).
- The hub landing page cards now carry drawn vector icons (paddle
  + ball, football) instead of emoji, a hover lift with the arrow
  sliding forward, and a gentle entrance that respects reduced
  motion.

## v1.4.3 — nobody plays more than two matches in a row

### Added

- **Rest spacing across the whole draw.** Round robins now respect a
  hard limit of 2 consecutive matches per player — in the play-in
  groups, in pools, at the pool → knockout boundary and through the
  tie-break replays. Every round is a "one match per player" wave, so
  back-to-backs only ever appear at round edges; a 3-player group in
  particular always ends with one player on a 2-match streak, and the
  knockout used to start immediately with that player's match — a
  guaranteed third in a row for 5-player fields (the bracket's first
  semi pairs the group's winner and runner-up, and the streaking
  player is always one of them). Whenever fresh rounds join the
  schedule the engine now walks the played history, clocks each
  player's rest, and re-orders matches *within* their round so a
  streaking player never opens the next round when another match can
  go first. Pairings, bracket structure, pool bookkeeping and saved
  scores are untouched — only the order inside a round changes. At
  most one player can be on a streak at any moment, so any round with
  two or more matches always has a clean opener; the one case left
  alone is a one-match final straight after a 3-way round robin,
  where there is simply nothing to swap in front of it.

### Verified

- Same engine as table-tennis, ported with the v1.4.3 patch: the
  football draw gets the identical rest-spacing pass. Node suite run
  against this app: play-in fields of 5, 6, 7, 9–13 teams, pools →
  elim (including a 3-team pool), round robin advancing its top 2,
  and a round robin that plays out to a final — all capped at 2 in a
  row, with pair sets, stage bookkeeping and champions intact.
  Snapshots keep the spaced order across a save/load round-trip, and
  undo still works inside a re-ordered round.

## v1.4.2 — the knockout finally draws itself (after pools)

### Fixed

- **The elimination flow diagram now renders after pool winners are
  decided.** The engine always built the bracket — play-ins and
  pools-then-knockout both worked — but the Flow tab showed the
  knockout stage heading with *nothing under it*. Cause: each round
  carries its stage number as a property on the round array, and
  `JSON.stringify` silently drops those (the same JSON quirk behind
  the v1.1 `round.eliminated` bug). The server projected only
  `eliminated`/`stageLabel` into `roundMeta` — not `stageIndex` — so
  every browser grouped all rounds under stage 1 and the bracket
  stage got an empty round list, rendering nothing. `stageIndex` now
  rides the wire in `roundMeta`, and the client groups rounds from
  it. Verified end-to-end in a browser: 7-player play-ins show
  "1 · Pools ×2 → 2 · Knockout" with Semifinals/Final columns, and
  the pools → elimination boundary does too.
- **A tournament saved mid-bracket can resume again.** The snapshot
  validator rejected any match whose `a`/`b` was `null` — but that's
  exactly what a not-yet-decided slot later in a bracket looks like.
  Saving between bracket rounds (e.g. a Render redeploy after the
  semifinal draw) produced a snapshot that failed validation on the
  next boot, so the server silently reset the tournament. TBD slots
  are now valid; matches still must carry both keys and anything
  non-string-but-non-null stays rejected.

### Changed

- **Leaner screens.** The wordy explainer texts are gone: the
  per-round scoring lecture under the round title, the "Can't
  decide?" button label, panel descriptions on the stage-choice
  screen (Filling the bracket / Bracket seeding / Pool split now
  show just their title, chips and one short line), the standings
  tie-break footnote, the star-player legend paragraph, the two
  data-dir/redeploy essays under the season tools, the roster's
  long points-to-win and player-code hints, and the flow tab's empty
  state. Controls, badges and validation errors are untouched —
  shorter copy, same function.

## v1.4.1 — two scoring/draw fixes

### Fixed

- **Scores past the winning limit can't win anymore.** The winner's
  score is now exactly the points-to-win target — the game ends the
  moment someone reaches it. A 21–999 (or 999–21) entry is rejected
  with "the game ends at 21 — 999 is past the limit"; so is every
  other over-limit score, by however little (22–20 at a target of
  21). Below the target is still rejected too. `rules: strict`
  keeps real deuce endings: take the target with a 2-point lead
  (21–19), or win by exactly 2 past it (22–20, 25–23); anything
  else above the target is refused. The 7–0 instant win still wins
  outright whenever the target is above 7; at a target of 7 or less
  the normal target rules apply (the game would have ended first).
  Walkover scores follow the target as before.
- **Round robin is never blocked.** Three unblocking fixes: (1) a
  hand-picked stage ignores the `limit:` match cap — the card shows
  the match count before you click, so a deliberate choice is
  respected (going over a set cap is noted in the decision log);
  `limit:` now guards only `format: auto` draws; (2) the automatic
  draw's "too many matches" screen is no longer a dead end — a new
  *Pick the format myself* button opens the stage-choice screen, and
  a round robin of any size builds from there; (3) typed numbers on
  the stage-choice screen (Advance top N, pool counts) no longer
  leak into a NEW tournament with the same player count — the
  choice cache is keyed by tournament, so a rejected "6 of 6
  advance" can't silently poison the next attempt.

### Changed

- Code comments across `logic.js`, `server.js`, `season.js`, and
  both HTML files were rewritten shorter and simpler, and stale
  version banners dropped. Test expectations that asserted the old
  over-limit behaviour (13–11 winning without strict mode) were
  updated to the new rules.

## v1.4.0 — play-ins, the refined scoring, standings, spectator tabs

### Fixed

- **Nobody wins without playing anymore.** An elimination draw over a
  field that isn't a power of two used to pad its bracket with BYEs —
  free walkovers, a player "winning" a match they never played. Now
  the field **plays its way down**: randomly drawn **3-player round
  robins where the top 2 qualify** (exactly as specified), with
  4-player groups only where the maths forces it (7, 13, 14, 15
  players …). Leftover players are drawn at random and go **straight
  into the bracket** — a later start, never a free win. When the
  play-ins finish, the bracket builds itself, cross-seeded: group
  winners, then the drawn-straight players, then runners-up, so group
  rivals only meet late. The random draw is recorded in the decision
  log. `byes: classic` (or the *Classic byes* choice on the stage
  screen) keeps the old short-but-free behaviour for whoever wants
  it. Works at stage boundaries too, not just the first draw.
- **Spectators can finally switch tabs.** The read-only CSS froze
  every button — including the Live / Flow / Season tab buttons, so
  viewers were stuck on whatever tab was active and could never see
  the tournament flow or the season standings. Tabs, the leaderboard
  sort headers, and the "see the flow / season" shortcuts are now
  explicitly re-enabled for viewers; everything that changes shared
  state stays frozen (and the server rejects viewer writes anyway).
- **Standings show the right positions.** Three fixes: (1) during
  pool play the standings table mixed all pools into one list, so a
  2-0 player in pool B sat below a 0-2 player in pool A — pools now
  get their own labelled tables ("Pool A · top 2 advance"); (2) a
  knockout now ranks as a proper ladder — survivors above eliminated,
  latest exits highest, and at the end exactly champion, runner-up,
  semifinal losers, … (previously an opaque wins-only sort); (3) the
  tables now show a **Pts** column (points scored) next to Diff, so
  the ranking is legible, with a note that ties go head-to-head
  first.
- **Clicking a format card never showed its options.** A pre-v1.2
  bug: choosing *Elimination* (or *Round Robin* with its advance-N
  field) toggled card styling but never re-rendered, so the seeding
  panel — and the new play-in/byes panel — never appeared. Card
  clicks now re-render; typed field values survive.

### Changed — the scoring rules (as specified)

- **Points to win is configurable**: a *Points to win* field on the
  roster screen (default 11) or a `points:` line in the roster
  (1–200). The winner must **reach the limit** — anything below it
  can't win. Want 21-point matches? Type 21.
- Scores are whole numbers **0 or more** — no negatives, no
  fractions, no level scores.
- **The 7–0 house rule, exactly as specified**: a score of exactly
  7–0 (or 0–7) is an instant win for the player with 7, whatever the
  limit. Exactly 7 and exactly 0 — 7–1, 8–0 and 0–6 are ordinary
  scores that follow the limit rule.
- `rules: strict` now means **win by 2** on top of the limit
  (11–10 rejected, 13–11 fine). The old best-of-match shortcuts
  (2–0, 3–1 …) are gone — the limit is the rule now.
- The play screen shows a *first to N* badge with the 7–0 reminder,
  and validation errors explain exactly what's wrong. Bye walkovers
  in classic mode follow the limit too (21–0 when playing to 21).

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
