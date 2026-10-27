const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");
const logic = require("./logic.js");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, () => {
  console.log(`Table Tennis Live listening on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

// role bookkeeping — one shared game per server process
let adminSocket = null;
const clients = new Map(); // ws -> { role: 'admin' | 'guest' }

function guestCount() {
  let n = 0;
  for (const info of clients.values()) if (info.role === "guest") n++;
  return n;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastState() {
  const msg = JSON.stringify({
    type: "state",
    state: logic.getStateForWire(),
    guestCount: guestCount(),
    hasAdmin: !!adminSocket
  });
  for (const client of clients.keys()) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

// Actions a client is allowed to trigger, and how their payload maps
// onto the logic module's function arguments.
const ACTIONS = {
  reset: () => logic.reset(),
  submitRoster: (p) => logic.submitRoster(p && p.raw),
  pickMode: (p) => logic.pickMode(p && p.mode),
  addForbidden: (p) => logic.addForbidden(p && p.x, p && p.y),
  removeForbidden: (p) => logic.removeForbidden(p && p.index),
  formTeams: () => logic.formTeams(),
  goToPairing: () => logic.goToPairing(),
  confirmTeamsAndDraw: () => logic.confirmTeamsAndDraw(),
  draftScore: (p) => logic.draftScore(p.mi, p.which, p.value),
  saveScore: (p) => logic.saveScore(p.mi, p.sa, p.sb),
  continueTournament: () => logic.continueTournament(),
  pickStage: (p) => logic.pickStage(p && {format: p.format, advance: p.advance, poolCount: p.poolCount, poolQualify: p.poolQualify}),
  undoScore: () => logic.undoScore()
};

wss.on("connection", (ws) => {
  let role;
  if (!adminSocket) {
    adminSocket = ws;
    role = "admin";
  } else {
    role = "guest";
  }
  clients.set(ws, { role });

  send(ws, {
    type: "welcome",
    role,
    state: logic.getStateForWire(),
    guestCount: guestCount(),
    hasAdmin: !!adminSocket
  });
  // let everyone else know the head count changed
  broadcastState();

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const info = clients.get(ws);
    if (!info || info.role !== "admin") {
      send(ws, { type: "error", message: "Only the admin can make changes." });
      return;
    }
    const handler = ACTIONS[msg.type];
    if (!handler) {
      send(ws, { type: "error", message: "Unknown action: " + msg.type });
      return;
    }
    try {
      handler(msg.payload || {});
      broadcastState();
    } catch (err) {
      send(ws, { type: "error", message: err.message || "Something went wrong." });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    if (ws === adminSocket) {
      // Admin left — the fun's over for everyone else too.
      const endMsg = JSON.stringify({ type: "sessionEnded" });
      for (const client of clients.keys()) {
        if (client.readyState === client.OPEN) client.send(endMsg);
        client.close();
      }
      clients.clear();
      adminSocket = null;
      logic.reset();
    } else {
      broadcastState();
    }
  });
});
