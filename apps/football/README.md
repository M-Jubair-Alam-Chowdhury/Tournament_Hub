# Football Tournament Live

A shared, realtime scoreboard for football tournaments. Open the
link and you're spectating the live sheet straight away — the small
round button in the top right corner is the admin door: **password
sign-in** on token servers, **claim the host seat** on open ones.
Spectators watch everything live (all tabs) and can't change a thing.
Multi-stage draws, a flow map of the whole bracket, and a season
archive with ELO ratings and star players. Group stages start from a
**pool draft board** (v2.1): pick Pools on the format screen and move
team by team, rename the pools, and set each pool's qualifiers by
hand — or let the split deal them. Dark mode is one moon-button away.

**Match scoring**: register each team (name, captain, players), set the
full-time length and half-time break, and enter goals — optionally with a
**goal sheet**: minute (a running clock fills it in), scorer picked from
the squad (the captain included), and own goals credited to the other
side. The clock **stops itself at the end of each half** (45:00 on a
90-minute match, full time at the end) and the admin **sets the referee's
extra time** (0–15 min — raise it, or take announced minutes back, and
the whistle line moves with it) to keep playing.
The golden boot table ranks the scorers, and each team profile
shows the squad with per-player goals. Draws stand in round-robin and
pool matches (3 pts win, 1 pt draw); knockout rounds settle level scores
with a penalty shootout. Odd-sized knockout fields play **3-team
round-robin play-ins** (top 2 qualify) instead of free byes.

## Quick start (local)

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Open `http://localhost:3000`. No token set = **open mode**: everyone
spectates, and the first to press **Claim the host seat** (the corner
button) runs the show (handy for casual games). To require a password
locally:

```bash
ADMIN_TOKENS="your-secret-token" npm start
```

## Deploying on Render

1. Push this repo to GitHub, then on [Render](https://render.com):
   **New → Web Service** → pick the repo.
2. Build command `npm install`, start command `npm start`.
3. **Environment → Add environment variable**: key `ADMIN_TOKENS`,
   value one or more long random tokens, comma-separated (one per
   admin).

Generate a token:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

> **Note:** environment variables apply at **deploy time**, not to a
> running instance. After adding or changing `ADMIN_TOKENS`, trigger
> a deploy (push a commit, or *Manual Deploy → Deploy latest
> commit*). If the corner button's card shows a "Claim the host
> seat — no password needed" button instead of a password field, the
> server is still in open mode — that's the signal to check this step.

Free-tier notes: the service spins down when idle (first visitor
after a quiet spell sees a short "Connecting…" pause), and each
deploy wipes the disk — set `DATABASE_URL` (Neon or any Postgres)
to store data off the disk, or use the Season tab's **Export /
Import** buttons (and the tournament tools) to carry it by hand.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_TOKENS` | *(unset)* | Comma-separated admin tokens. Unset = open mode (first host runs the show). |
| `AUTH_FAIL_MAX` | `5` | Wrong tokens before a lockout. |
| `AUTH_WINDOW_MS` | `900000` | Failure-counting window (ms). |
| `AUTH_LOCK_MS` | `900000` | Lockout duration (ms). |
| `DATA_DIR` | `./data` | Where `season.json` and `tournament-state.json` live. |
| `DATABASE_URL` | *(unset)* | Postgres/Neon connection string — season, tournament state and live video live in the `season_data` table instead of files. |
| `PORT` | `3000` | HTTP/WebSocket port. |

## How it works

One Node process — no database needed:

- `server.js` — holds the shared state, pushes updates over a
  WebSocket, authenticates admins against `ADMIN_TOKENS`
  (SHA-256 digests, constant-time compare, per-IP rate limiting),
  auto-saves the running tournament, archives finished ones.
- `logic.js` — the tournament engine: multi-stage draws, pools,
  byes, head-to-head tie-breaks, the choice system, snapshot
  save/load for resume.
- `season.js` — the season archive: ELO, stats, stars,
  export/import.
- `store.js` — persistence: JSON files in `DATA_DIR`, or the
  `season_data` table when `DATABASE_URL` points at Postgres/Neon
  (`football:`-prefixed keys, imports existing files once).
- `public/index.html` — the app: Live / Flow / Season tabs,
  read-only for spectators, with the corner sign-in button (v2.0 —
  the old `login.html` role page is gone; `/login` redirects here).

Version history: see **[CHANGELOG.md](CHANGELOG.md)**.
