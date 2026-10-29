# Table Tennis Live

A shared, realtime version of the Match Sheet tournament tool 

"THAT MULTIPLE FREE AIs WROTE AND 'NOT ME' (BUT YOU CAN APPRECIATE MY LOGICAL PART)"

- Everyone who opens the link sees the **same** tournament.
- The app opens on a **login page** where you pick your role: enter a
  token to run the show as **admin** (tokens are set on the server,
  never in the code — see below), or click once to **spectate** —
  spectators see everything — live scores, the flow map, the season —
  but can't change a thing.
- No token configured? The login page says so and the app falls back
  to **open mode**: the first person to connect runs the draw, like it
  always did.
- The whole tournament shows as a **flow map** (bracket, pools, stage
  pipeline), and every finished tournament is archived into a **season** —
  ELO ratings, titles, star players — so you can judge players across the
  whole year.
- The running tournament **auto-saves** after every change: if the server
  restarts (or the host redeploys), an admin gets a **Resume** button and
  picks up exactly where it stopped. The state can also be exported as a
  `.json` file and loaded on any server.

There are no accounts and no personal data — just a shared token for
the people running the table, and an open door for everyone who just
wants to watch. It's built for game night, not for anything sensitive.

## What's new in v1.3 — logins, viewers, resume

### The login page — pick a role first

Opening the app lands on **`/login`**: two cards, one choice.

- **Admin** — type the token, hit *Sign in*: it travels the same
  hardened path described below, lands in the tab's sessionStorage,
  and you're dropped straight into the admin panel. A wrong token
  gets an inline error with the attempts countdown; a live chip
  shows what's on the table right now (tournament name, matches
  played, who's watching).
- **Spectator** — one click on *Watch the scoreboard* and you're in,
  read-only. The choice is remembered locally so reloads don't ask
  again (signing in as admin clears it).

The page asks the server which mode it's in (`GET /api/auth-info`)
before doing anything: in open mode the admin card becomes a plain
"Enter as host" — no token form — and the page never opens a socket,
so it can't accidentally claim the admin seat. The scoreboard itself
(`/`) bounces visitors who haven't picked a role back to `/login`,
and the viewer bar's **Admin login** button leads there too — so a
spectator can take over mid-event.

### Admin login with a token (and a hardening story)

Since this repo is public, the login is designed so nothing sensitive
can leak from the source:

- **The tokens live only in the `ADMIN_TOKENS` environment variable**
  (comma-separated — one for you, one for your partner, more if you
  like). They're never in the code, in defaults, in logs, or in error
  messages. The server holds only SHA-256 **digests** of them.
- **Constant-time comparison**: submissions are hashed and compared
  with `crypto.timingSafeEqual` against every configured digest, with
  no early exit — timing can't reveal which token matched or how long
  it is.
- **Per-IP rate limiting**: 5 wrong tokens inside 15 minutes locks
  that network out for 15 minutes (the message counts the attempts
  down). Tunable via `AUTH_FAIL_MAX`, `AUTH_WINDOW_MS`, `AUTH_LOCK_MS`.
- **Generic failures**: a wrong token gets the same message whether
  it's close or miles off; submitted tokens are length-capped and
  never echoed back.
- **In the browser** the token is typed once on the login page and
  kept in `sessionStorage` — it dies with the tab, is never written
  to localStorage or a cookie, and the tab silently re-signs-in on
  reconnect while it's open. An explicit **Log out** button steps an
  admin down to viewer.
- Everything travels over WebSocket, which is TLS-encrypted whenever
  the app is served over HTTPS (as Render does).

Set it up on Render: **Dashboard → your service → Environment →
Add environment variable** → key `ADMIN_TOKENS`, value
`a-long-random-string-for-you,another-one-for-your-partner`. That's
the whole setup — redeploy and the login is live. Locally:

```bash
ADMIN_TOKENS="local-dev-token" npm start
```

Generate strong tokens with either of these:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
openssl rand -hex 24
```

One honest caveat: this protects the *controls*, not the content —
anyone with the link can still watch, which is the point. And like
any token system, share them over a decent channel (not a public
group chat).

### Viewers see everything, touch nothing

With tokens configured, everyone who opens the link lands as a
**viewer**: all three tabs (Live / Flow / Season), every score,
bracket, standing and season stat — fully live, strictly read-only.
The server rejects any change they try to send, and the UI disables
their controls. When no admin is around, a banner says scores are
paused; the room stays open and the state stays put.

Admins don't kick anyone anymore, either: when the last admin signs
out or closes their tab in token mode, the tournament simply freezes
(viewers keep watching) and continues the moment any admin returns —
no reset, no lost scores. In open mode (no tokens), the classic
behaviour remains: the room closes when the admin leaves.

### Resume exactly where you stopped

The running tournament is auto-saved to `data/tournament-state.json`
after every change. On a server restart (or a redeploy on a host with
a persistent disk), the tournament comes back **paused**: viewers can
browse everything, and the first admin to sign in gets a choice —

- **▶ Resume tournament** — same draw, same scores, same standings,
  continue from the exact match that was next; or
- **Start fresh instead** — archive it as abandoned (it lands in the
  season history, unrated) and begin a new one.

The **Season tab → Tournament tools** can also **download** the
current tournament as a `.json` file and **load** one back — perfect
for moving a tournament between hosts, or carrying it across a
redeploy on an ephemeral-disk host like Render's free tier. Loaded
files are validated before anything is applied; a foreign or
corrupted file is rejected whole.

## What's new in v1.1 — you choose the format

The old draw picked its format for you (round robin for odd counts,
knockout for powers of two, hybrid otherwise). Now the tournament is a
chain of **stages**, and you pick every stage:

- After the roster (and teams, if any), the app asks how to draw it:
  **Round Robin**, **Elimination**, **Hybrid**, or **Pools** — each card
  shows the match count before you commit.
- **Pools**: n pools, each with its own size and its own number of
  qualifiers. Pools can even feed into more pools, then a knockout, or
  a final round robin — whatever you pick at each boundary.
- When a stage ends, the qualifiers are shown and the app asks what
  runs next. The same choice, every time, until a champion is crowned.
- Odd-sized fields are no longer a problem: elimination brackets pad
  with **byes** (auto-walkovers, shown as 11–0), and pools handle odd
  sizes with a fair sit-out round.

### Roster directives (optional, type them above the names)

```
format: rr        rr | elim | hybrid | pools | auto (classic behaviour)
pools: 4          auto-split into 4 balanced pools
qualify: 2        2 winners per pool (default 1)
then: rr:4, elim  pre-declare later stages (still changeable live)
limit: 60         per-stage match cap (default 21 on 'auto' only)
rules: strict     11-point, win-by-2 scoring (or best-of match scores)
```

Leave a **blank line** between groups of names and each block becomes
one pool — with its own size, and an optional `qualify: N` line inside
the block for that pool's winners:

```
qualify: 2
Alice
Bob
Carol

qualify: 1
Dave
Emma

Frank
Grace
Helen
Iris
```

→ Pool A (3 players, top 2 advance), Pool B (2 players, top 1), Pool C
(4 players, top 2 — the global default). Five qualifiers move on, and
the app asks what they play next. Mixed sizes and mixed qualifier
counts are the whole point. (Typed groups work in singles mode; teams
use pool counts instead.)

### Everything else that got smarter

- **Tie-breaks that always finish**: pool and round-robin ties are
  settled by head-to-head result, then head-to-head points, then
  overall difference, then points for — and only if players are still
  dead even, a recorded lottery. No more infinite replay loops.
- **Cross-pool seeding**: a knockout fed by pools pairs 1A vs 2B, 1B
  vs 2A … so pool rivals only meet late in the bracket.
- **Undo last score**: the admin can take back the most recent score
  while the round is still open (misclick rescue).
- **Strict scoring** (opt-in with `rules: strict`): game scores must
  reach 11 and win by 2 (11–7, 13–11 …) or be a match score (2–0,
  2–1, 3–0, 3–1, 3–2).
- **Bug fix from v1.0**: the "Eliminated after Round N" banner and the
  OUT tags in the standings never actually displayed (the data was
  dropped on its way to the browser). They work now.
- The classic one-shot behaviour is still there — put
  `format: auto` in the roster and nothing asks you anything.

## What's new in v1.2 — the season, the map, the stars

The tournament now lives in a bigger picture: three tabs across the top —
**Live** (the running sheet), **Flow** (the whole tournament as one map),
and **Season** (the year-long record).

### The Flow tab — the whole tournament on one screen

A flowchart of everything that has happened and what's still to come:

- A **stage strip** along the top: `1 · Pools ×4 → 2 · Knockout → 🏆`,
  with the finished stages ticked green and the current stage glowing red.
- Below it, one board per stage: **pool cards** with the qualifiers
  highlighted, a full **knockout bracket** with connector lines feeding
  each winner into the next round (live matches flash "UP NEXT"), or a
  **round-robin standings** card. Hybrid draws show both parts.
- A **decision log** records every draw you made — random draws, hand
  picks, lotteries — so the bracket can always be explained afterwards.
- Legacy `format: auto` tournaments render on it too, as one big stage.

### The Season tab — judge players across the whole year

Every tournament the app runs is archived to `data/season.json` on the
server (champions completed, resets mid-play recorded as "abandoned"),
and the season view derives the long-run numbers from that full match
history:

- **ELO ratings** (start 1000, K=32) — replayed match-by-match from the
  season history, so an undo or a re-recorded score can never
  double-count.
- Wins/losses, point difference, win rate, **titles**, top-2 finishes,
  best finish, and a **form line** (last five results as dots).
- A **sortable leaderboard** (tap any column) plus the full tournament
  history — newest first, champion and podium of each event.
- **Export / Import** season data as a JSON file, and **Start a new
  season** for a fresh year. The admin's browser also keeps an automatic
  mirror of the archive and offers to restore it if the server's data is
  ever lost.

On hosts that wipe the disk on every deploy (Render's free tier does
this), the export/import pair is the way to carry a season across
redeploys — download before pushing, import after. Set the `DATA_DIR`
environment variable to store the archive somewhere else.

### Star players ⭐

Players who are comparably better than the field get a gold star —
next to their name everywhere: standings, brackets, pools, history,
the champion block. It's earned automatically by any one of:

- a season rating of **1080+** (80 over the start) across 6+ matches,
- a **65%+ win rate** across 8+ matches, or
- **2+ titles**.

The admin can also star (or unstar) anyone by hand — tap the ☆ next to
a name in the season leaderboard. Hovering a star shows why it was given.

### A choice system — or let the dice decide

Every setup decision now has explicit options, and each one also has a
**random** way out:

- **Format**: the four cards as before, plus *"🎲 Can't decide? Draw the
  format at random"* — a lucky dip that picks the format (and a sensible
  pool shape) for you.
- **Who advances** from a stage: keep the standings order, **🎲 draw the
  qualifiers at random**, or **✋ pick them by hand** from a checklist.
- **Bracket seeding**: cross-seed from pools (default), random, **by
  season ELO rating** (the strongest records get separated into different
  bracket quarters), or **by hand** — drag-free: tap players in order.
- **Pool splitting**: random, or a **snake deal by season rating** so the
  strongest players land in different pools.

Random choices are recorded in the decision log and shown as toasts,
so a lucky draw is always visible to everyone in the room.

## How it works

- `server.js` — a small Node server. It holds the one shared tournament
  state in memory and pushes updates to every connected browser over a
  WebSocket. It authenticates admins against the `ADMIN_TOKENS` env
  var (SHA-256 digests, constant-time compare, per-IP rate limiting),
  auto-saves the running tournament after every change, and archives
  finished tournaments into the season file.
- `logic.js` — the tournament rules (multi-stage draws: round robin,
  knockout with byes, hybrid, pools; head-to-head tie-breaks; the
  stage-picker state machine; qualifier/seeding choice modes; snapshot
  save/load for resume). Only the server runs this; it's the single
  source of truth.
- `season.js` — the long-term archive: recording tournaments to
  `data/season.json`, ELO ratings, season stats, star players, the
  export/import/new-season tools, and the tournament-state file that
  powers resume.
- `public/index.html` — the page everyone loads. It just displays whatever
  state the server sends it, and for the admin, sends button clicks back to
  the server as actions. The three tabs (Live / Flow / Season) are all in
  this one file.
- `public/login.html` — the front door: pick a role (admin token or
  spectator), then enter. It checks `/api/auth-info` first, so in open
  mode it never opens a socket and can't claim the admin seat.

The running tournament is written to `data/tournament-state.json` after
every change, so a restart restores it (paused, awaiting an admin's
resume). In token mode the room stays open for viewers even with no
admin connected; in open mode the classic rules apply — the admin
leaving closes the room. The **season archive** is on disk too and
survives restarts; only a host that wipes the disk entirely (Render
free tier redeploys) loses either file, which is what the Export
buttons (season **and** tournament) are for.

## Running it yourself, locally

You'll need [Node.js](https://nodejs.org) installed (18 or newer).

```bash
npm install
npm start
```

Then open `http://localhost:3000` — you'll land on the login page, and
in open mode (no tokens set) the first tab to enter runs the show.
Open the same address in another tab, another browser, or your phone
(on the same Wi-Fi, using your computer's local IP instead of `localhost`)
and pick **Spectator** to watch — or start the server with
`ADMIN_TOKENS="some-token" npm start` to require tokens locally too.

## Putting it on GitHub

1. Create a new repository on GitHub (e.g. `table-tennis-live`).
2. In this folder, run:
   ```bash
   git init
   git add .
   git commit -m "Table tennis live"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

That gets your code onto GitHub. **GitHub itself can only serve static
files** — it can't keep a server running to hold shared state or push live
updates. So for other people to actually use the app, you need to deploy it
somewhere that runs a Node process. [Render](https://render.com) has a free
tier and connects directly to a GitHub repo:

1. Sign up at render.com and choose **New → Web Service**.
2. Connect your GitHub account and pick this repository.
3. Render should auto-detect Node. If it asks:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Click **Create Web Service**. After a minute or two, Render gives you a
   public URL like `https://table-tennis-live.onrender.com`.
5. Share that link — with `ADMIN_TOKENS` set, the people holding a
   token sign in as admins and everyone else watches live; without it,
   the first person to open the link is the admin (open mode).
6. While you're in the settings: **Environment → Add environment
   variable** → `ADMIN_TOKENS` = your tokens (comma-separated). See
   “What's new in v1.3” above for the full auth story.

Every time you push new commits to GitHub, Render redeploys automatically
(and the live tournament resets, since it only lives in memory). The
**season archive survives restarts** — but note that Render's *free tier*
wipes the whole disk on each deploy/redeploy, so the archive resets too.
If you're keeping a real season going there: **Export** the season data
before you push, and **Import** it back after the redeploy (the admin's
browser also keeps an automatic mirror and will offer to restore it);
the **Tournament tools** do the same for a half-finished tournament. A
paid tier with a persistent disk — or any host with real storage — keeps
both files across deploys on its own, and then a redeploy simply comes
back paused with a **Resume** button.

Free-tier Render services "spin down" after periods of no traffic and take
a few seconds to wake back up on the next visit — that's fine for a casual
project like this, just know the first person to open the link after a
quiet spell might see "Connecting…" for a moment.
