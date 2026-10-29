# Table Tennis Live

A shared, realtime scoreboard for table tennis tournaments. Open the
link, pick a role on the login page — **admin** (with a token) runs
the draw and enters scores, **spectators** watch everything live
(all three tabs) and can't change a thing. Multi-stage draws, a flow
map of the whole bracket, and a season archive with ELO ratings and
star players.

**Match scoring**: the points-to-win target is configurable
(default 11 — set it on the roster screen or with `points: 21`); the
winner must reach it, and a 7–0 score is an instant win. Odd-sized
knockout fields play **3-player round-robin play-ins** (top 2
qualify) instead of getting free byes — nobody wins without playing.

## Quick start (local)

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Open `http://localhost:3000`. No token set = **open mode**: whoever
enters as host first runs the show (handy for casual games). To
require a token locally:

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
> commit*). If the login page shows an "Enter as host — no token
> needed" card instead of a token field, the server is still in open
> mode — that's the signal to check this step.

Free-tier notes: the service spins down when idle (first visitor
after a quiet spell sees a short "Connecting…" pause), and each
deploy wipes the disk — use the Season tab's **Export / Import**
buttons (and the tournament tools) to carry data across redeploys.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_TOKENS` | *(unset)* | Comma-separated admin tokens. Unset = open mode (first host runs the show). |
| `AUTH_FAIL_MAX` | `5` | Wrong tokens before a lockout. |
| `AUTH_WINDOW_MS` | `900000` | Failure-counting window (ms). |
| `AUTH_LOCK_MS` | `900000` | Lockout duration (ms). |
| `DATA_DIR` | `./data` | Where `season.json` and `tournament-state.json` live. |
| `PORT` | `3000` | HTTP/WebSocket port. |

## How it works

One Node process, no database:

- `server.js` — holds the shared state, pushes updates over a
  WebSocket, authenticates admins against `ADMIN_TOKENS`
  (SHA-256 digests, constant-time compare, per-IP rate limiting),
  auto-saves the running tournament, archives finished ones.
- `logic.js` — the tournament engine: multi-stage draws, pools,
  byes, head-to-head tie-breaks, the choice system, snapshot
  save/load for resume.
- `season.js` — the season archive: ELO, stats, stars,
  export/import.
- `public/login.html` — pick a role.
- `public/index.html` — the app: Live / Flow / Season tabs,
  read-only for spectators.

Version history: see **[CHANGELOG.md](CHANGELOG.md)**.
