# Table Tennis Live

A shared, realtime version of the Match Sheet tournament tool 

"THAT MULTIPLE FREE AIs WROTE AND 'NOT ME' (BUT YOU CAN APPRECIATE MY LOGICAL PART)"

- Everyone who opens the link sees the **same** tournament.
- The **first person to connect** becomes the admin and runs the draw.
- Everyone after that is a **guest** — they watch the scores and standings
  update live, but can't click anything.
- If the admin closes their tab, the session ends for everyone (the app
  resets, so the next person to open the link starts a fresh tournament).

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

## How it works

- `server.js` — a small Node server. It holds the one shared tournament
  state in memory and pushes updates to every connected browser over a
  WebSocket.
- `logic.js` — the tournament rules (multi-stage draws: round robin,
  knockout with byes, hybrid, pools; head-to-head tie-breaks; the
  stage-picker state machine). Only the server runs this; it's the
  single source of truth.
- `public/index.html` — the page everyone loads. It just displays whatever
  state the server sends it, and for the admin, sends button clicks back to
  the server as actions.

Because the state lives only in the server's memory, restarting the server
(or your host redeploying it) clears the tournament. That's expected for a
project like this — no database needed.

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
(and the tournament resets, since it only lives in memory).

Free-tier Render services "spin down" after periods of no traffic and take
a few seconds to wake back up on the next visit — that's fine for a casual
project like this, just know the first person to open the link after a
quiet spell might see "Connecting…" for a moment.
