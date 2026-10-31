/* Player registry — entrants saved with a UID so the next tournament
   can pick them without typing anything. Rides the same store as the
   season (JSON files, or the season_data table on Postgres/Neon), so
   "the database" is whichever persistence is configured. Identity is
   the normalised name: saving an existing player updates him (same
   UID), never duplicates him. Table-tennis entries are plain names. */
"use strict";
const crypto = require("crypto");
const store = require("./store.js");

const MAX_ENTRIES = 1000;

let data = { v: 1, entries: [] };

function normKey(name){ return String(name || "").trim().toLowerCase(); }

function newUid(){
  return "p-" + crypto.randomBytes(4).toString("hex");
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
        name: String(e.name).trim().slice(0, 60),
        addedAt: e.addedAt || null,
        lastUsed: e.lastUsed || null
      });
    }
  }
}

function save(){ store.set("players", data); }

// items: array of names (strings). Returns what happened.
function upsertMany(items){
  const list = (Array.isArray(items) ? items : [items])
    .map(x => String(x == null ? "" : x).trim().slice(0, 60))
    .filter(Boolean);
  const byKey = new Map(data.entries.map(e => [normKey(e.name), e]));
  let added = 0, updated = 0;
  const now = new Date().toISOString();
  for (const name of list){
    const key = normKey(name);
    const found = byKey.get(key);
    if (found){
      found.name = name;              // keep the latest spelling
      found.lastUsed = now;
      updated++;
    } else {
      const entry = { uid: newUid(), name, addedAt: now, lastUsed: now };
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
    .map(e => ({ uid: e.uid, name: e.name, addedAt: e.addedAt, lastUsed: e.lastUsed }));
}

function count(){ return data.entries.length; }

module.exports = { load, list, upsertMany, remove, count, _reloadForTests: load };
