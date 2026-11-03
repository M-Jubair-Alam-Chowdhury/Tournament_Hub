# Table Tennis Live

A shared, realtime scoreboard for table tennis tournaments. Open the
link and you're spectating the live sheet straight away — the small
round button in the top right corner is the admin door: **password
sign-in** on token servers, **claim the host seat** on open ones.
Spectators watch everything live (all three tabs) and can't change a
thing. Multi-stage draws, a flow map of the whole bracket, and a
season archive with ELO ratings and star players. The site opens in
**light mode** (v2.2) — dark mode (v2.1)
is one moon-button away, beside the corner admin button, shared
with the rest of the hub. The Matches tab is **numbered** (v2.3):
every match carries its place in the playing order, and the admin
can type a new number to jump a fixture straight there — the
chevron arrows still nudge it one round at a time.

**Match scoring**: a match is **best of 1, 3, 5 or 7 games**
(default 3 — set it on the roster screen or with `sets: 5`), each
game to a configurable points target (**default 21** — `points: 11`
brings back the classic sprint). A game ends the moment someone
reaches the target, so the winner's score is exactly it (with
`rules: strict`, real deuce endings win by exactly 2 past it), and
7–0 is an instant win. The score sheet records every game — per-game
pills show under played matches, and the season archive keeps them.
The leaderboard splits each player's **solo** and **team** records.
Odd-sized knockout fields play **3-player round-robin play-ins**
(top 2 qualify) instead of getting free byes — nobody wins without
playing. A hand-picked format is never match-capped; `limit:` guards
only `format: auto`.

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
  (`table-tennis:`-prefixed keys, imports existing files once).
- `public/index.html` — the app: Live / Flow / Season tabs,
  read-only for spectators, with the corner sign-in button (v2.0 —
  the old `login.html` role page is gone; `/login` redirects here).

Version history: see **[CHANGELOG.md](CHANGELOG.md)**.
