# Table Tennis Live

A shared, realtime version of the Match Sheet tournament tool 

"THAT MULTIPLE FREE AIs WROTE AND 'NOT ME' (BUT YOU CAN APPRECIATE MY LOGICAL PART)"

- Everyone who opens the link sees the **same** tournament.
- The **first person to connect** becomes the admin and runs the draw.
- Everyone after that is a **guest** — they watch the scores and standings
  update live, but can't click anything.
- If the admin closes their tab, the session ends for everyone (the app
  resets, so the next person to open the link starts a fresh tournament).
- The whole tournament shows as a **flow map** (bracket, pools, stage
  pipeline), and every finished tournament is archived into a **season** —
  ELO ratings, titles, star players — so you can judge players across the
  whole year.

There's no login, no accounts, no security beyond "first one in runs the
show" — it's built for a quick, casual game night, not for anything
sensitive.

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
  WebSocket. It also archives finished tournaments into the season file.
- `logic.js` — the tournament rules (multi-stage draws: round robin,
  knockout with byes, hybrid, pools; head-to-head tie-breaks; the
  stage-picker state machine; qualifier/seeding choice modes). Only the
  server runs this; it's the single source of truth.
- `season.js` — the long-term archive: recording tournaments to
  `data/season.json`, ELO ratings, season stats, star players, and the
  export/import/new-season tools.
- `public/index.html` — the page everyone loads. It just displays whatever
  state the server sends it, and for the admin, sends button clicks back to
  the server as actions. The three tabs (Live / Flow / Season) are all in
  this one file.

Because the live tournament state lives only in the server's memory,
restarting the server (or your host redeploying it) clears the current
tournament — same as always. The **season archive**, though, is on disk
and survives restarts; only a host that wipes the disk entirely (Render
free tier redeploys) loses it, which is what Export/Import is for.

## Running it yourself, locally

You'll need [Node.js](https://nodejs.org) installed (18 or newer).

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a browser tab — that tab becomes the
admin. Open the same address in another tab, another browser, or your phone
(on the same Wi-Fi, using your computer's local IP instead of `localhost`)
to join as a guest.

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
5. Share that link — the first person to open it is the admin, everyone
   else who opens it afterward is a guest watching live.

Every time you push new commits to GitHub, Render redeploys automatically
(and the live tournament resets, since it only lives in memory). The
**season archive survives restarts** — but note that Render's *free tier*
wipes the whole disk on each deploy/redeploy, so the archive resets too.
If you're keeping a real season going there: **Export** the season data
before you push, and **Import** it back after the redeploy (the admin's
browser also keeps an automatic mirror and will offer to restore it). A
paid tier with a persistent disk — or any host with real storage — keeps
the archive across deploys on its own.

Free-tier Render services "spin down" after periods of no traffic and take
a few seconds to wake back up on the next visit — that's fine for a casual
project like this, just know the first person to open the link after a
quiet spell might see "Connecting…" for a moment.
