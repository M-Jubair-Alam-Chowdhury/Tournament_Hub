const path = require("path");
const express = require("express");

const PORT = process.env.PORT || 3000;
const BASE_DATA = process.env.DATA_DIR || path.join(__dirname, "data");

// Each app keeps its own state, season archive and data folder.
// Both read DATA_DIR once when loaded, so set it before each require.
function load(name) {
  process.env.DATA_DIR = path.join(BASE_DATA, name);
  return require("./apps/" + name + "/server.js");
}
const tt = load("table-tennis");
const fb = load("football");

const hub = express();
hub.use(express.static(path.join(__dirname, "public")));
hub.use("/table-tennis", tt.app);
hub.use("/football", fb.app);

const server = hub.listen(PORT, () => {
  console.log(`Tournament Hub on port ${PORT} — /table-tennis and /football`);
});

// WebSocket upgrades are routed to the right app by path prefix.
server.on("upgrade", (req, socket, head) => {
  const url = String(req.url || "");
  const target = url.startsWith("/table-tennis") ? tt.wss
               : url.startsWith("/football") ? fb.wss : null;
  if (!target) { socket.destroy(); return; }
  target.handleUpgrade(req, socket, head, ws => target.emit("connection", ws, req));
});
