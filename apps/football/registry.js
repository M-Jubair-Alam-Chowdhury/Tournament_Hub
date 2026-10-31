/* Team registry — squads saved with a UID so the next tournament can
   pick them without typing anything. Rides the same store as the
   season (JSON files, or the season_data table on Postgres/Neon), so
   "the database" is whichever persistence is configured. Identity is
   the normalised team name: saving an existing team updates it (same
   UID, latest captain and squad), never duplicates it. */
"use strict";
const crypto = require("crypto");
const store = require("./store.js");

const MAX_ENTRIES = 1000;

let data = { v: 1, entries: [] };

function normKey(name){ return String(name || "").trim().toLowerCase(); }

function newUid(){
  return "p-" + crypto.randomBytes(4).toString("hex");
}

function cleanSquad(players){
  return (Array.isArray(players) ? players : String(players || "").split(/\r?\n|,/))
    .map(x => String(x == null ? "" : x).trim().slice(0, 40)).filter(Boolean).slice(0, 40);
}

function load(){
  const saved = store.get("players");
  data = { v: 1, entries: [] };
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
  if (Array.isArray(saved.entries)){
    for (const e of saved.entries){
      if (!e || typeof e.name !== "string" || !e.name.trim()) continue;
      data.entries.push({
        uid: (typeof e.uid === "string" && e.uid) ? e.uid : newUid(),
        name: String(e.name).trim().slice(0, 40),
        captain: (typeof e.captain === "string" && e.captain.trim()) ? e.captain.trim().slice(0, 40) : "",
        players: cleanSquad(e.players),
        addedAt: e.addedAt || null,
        lastUsed: e.lastUsed || null
      });
    }
  }
}

function save(){ store.set("players", data); }

// items: array of {name, captain, players} (a registered squad list).
function upsertMany(items){
  const list = Array.isArray(items) ? items : [items];
  const byKey = new Map(data.entries.map(e => [normKey(e.name), e]));
  let added = 0, updated = 0;
  const now = new Date().toISOString();
  for (const raw of list){
    const name = String(raw && raw.name || "").trim().slice(0, 40);
    if (!name) continue;
    const captain = String(raw && raw.captain || "").trim().slice(0, 40);
    const players = cleanSquad(raw && raw.players);
    const key = normKey(name);
    const found = byKey.get(key);
    if (found){
      found.name = name;              // keep the latest spelling
      if (captain) found.captain = captain;
      if (players.length) found.players = players;
      found.lastUsed = now;
      updated++;
    } else {
      const entry = { uid: newUid(), name, captain, players, addedAt: now, lastUsed: now };
      data.entries.push(entry);
      byKey.set(key, entry);
      added++;
    }
  }
  // cap the registry: forget the least recently used
  if (data.entries.length > MAX_ENTRIES){
    data.entries.sort((a, b) => String(b.lastUsed || "").localeCompare(String(a.lastUsed || "")));
    data.entries = data.entries.slice(0, MAX_ENTRIES);
  }
  if (added || updated) save();
  return { added, updated, total: data.entries.length };
}

function remove(uid){
  const i = data.entries.findIndex(e => e.uid === uid);
  if (i < 0) return false;
  data.entries.splice(i, 1);
  save();
  return true;
}

// most recently used first — that's the handy order for picking
function list(){
  return data.entries
    .slice()
    .sort((a, b) => String(b.lastUsed || "").localeCompare(String(a.lastUsed || "")) ||
           a.name.localeCompare(b.name))
    .map(e => ({ uid: e.uid, name: e.name, captain: e.captain, players: e.players.slice(),
                 addedAt: e.addedAt, lastUsed: e.lastUsed }));
}

function count(){ return data.entries.length; }

module.exports = { load, list, upsertMany, remove, count, _reloadForTests: load };
