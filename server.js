const path = require("path");
const express = require("express");

const PORT = process.env.PORT || 3000;
const BASE_DATA = process.env.DATA_DIR || path.join(__dirname, "data");

// Each app keeps its own state, season archive and data folder.
// Both read DATA_DIR and ADMIN_TOKENS once when loaded, so both are
// set just before each require. Admin tokens can be shared or per
// app: ADMIN_TOKENS_table_tennis / ADMIN_TOKENS_football win over
// the shared ADMIN_TOKENS when they are set.
const SHARED_TOKENS = process.env.ADMIN_TOKENS;

function load(name, tokenVars) {
  process.env.DATA_DIR = path.join(BASE_DATA, name);
  const perApp = tokenVars
    .map(v => process.env[v])
    .find(v => v != null && String(v).trim() !== "");
  process.env.ADMIN_TOKENS = perApp != null ? perApp : SHARED_TOKENS || "";
  const app = require("./apps/" + name + "/server.js");
  // the app captured its tokens at load time — put the shared value back
  process.env.ADMIN_TOKENS = SHARED_TOKENS || "";
  return app;
}
const tt = load("table-tennis", ["ADMIN_TOKENS_table_tennis", "ADMIN_TOKENS_TABLE_TENNIS"]);
const fb = load("football", ["ADMIN_TOKENS_football", "ADMIN_TOKENS_FOOTBALL"]);

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
