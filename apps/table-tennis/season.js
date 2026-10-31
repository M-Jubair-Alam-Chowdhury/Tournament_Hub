/* Season store — long-term player judging across tournaments.
   Every tournament (complete or abandoned) is kept in the store
   (./store.js — JSON files in DATA_DIR, or the season_data table when
   DATABASE_URL points at Postgres/Neon); stats are derived on read:
   ELO rating (start 1000, K=32) replayed from full history, W/L/
   points, titles, form, and stars (earned automatically or marked by
   hand). The stored season is the only source of truth; load() runs
   from the app's init(), before the hub starts listening. */
"use strict";
const store = require("./store.js");

const START_RATING = 1000;
const K = 32;

let season = null;
let cache = { dirty: true, view: null };

function normKey(name){ return String(name || "").trim().toLowerCase(); }

function blankSeason(){
  return {
    v: 1,
    name: "Season " + new Date().getFullYear(),
    createdAt: new Date().toISOString(),
    tournaments: [],
    manualStars: {}
  };
}

function save(){
  store.set("season", season);
  cache.dirty = true;
}

function validateSeason(parsed){
  return !!(parsed
    && parsed.v === 1
    && Array.isArray(parsed.tournaments)
    && parsed.tournaments.every(t => t && typeof t === "object"
      && Array.isArray(t.participants) && Array.isArray(t.matches)));
}

function load(){
  const parsed = store.get("season");
  if (validateSeason(parsed)) {
    season = parsed;
    if (!season.manualStars) season.manualStars = {};
    if (!season.name) season.name = blankSeason().name;
    if (!season.createdAt) season.createdAt = new Date().toISOString();
  } else {
    // missing or malformed -> start fresh
    season = blankSeason();
    try { save(); } catch (_) {} // a read-only disk must not crash
  }
  cache.dirty = true;
}

/* ---- recording ---- */

function recordTournament(rec, status){
  if (!rec || !Array.isArray(rec.participants)) throw new Error("Nothing to record.");
  const st = status === "abandoned" ? "abandoned" : "complete";
  const entry = {
    id: rec.id,
    date: rec.date || new Date().toISOString(),
    name: rec.name || ("Tournament #" + (season.tournaments.length + 1)),
    mode: rec.mode || "single",
    stages: rec.stages || [],
    participants: rec.participants.slice(),
    matches: (rec.matches || []).slice(),
    ranking: (rec.ranking || []).slice(),
    champion: rec.champion || null,
    events: (rec.events || []).slice(),
    status: st
  };
  season.tournaments.push(entry);
  save();
  return entry;
}

/* ---- derived stats (pure, recomputed on demand) ---- */

function computeStats(){
  const players = {};   // normKey -> aggregate
  const ratings = {};   // normKey -> current ELO
  const display = {};   // normKey -> latest spelling of the name

  function P(key, name){
    if (!players[key]){
      players[key] = {
        key, name, played: 0, won: 0, lost: 0, pf: 0, pa: 0,
        titles: 0, top2: 0, tourneys: 0, best: null, form: []
      };
    }
    if (name) display[key] = name;
    return players[key];
  }

  for (const t of season.tournaments){
    if (t.status && t.status !== "complete") continue; // abandoned: history only
    t.participants.forEach(nm => P(normKey(nm), nm));
    t.participants.map(normKey).forEach(k => { players[k].tourneys++; });

    for (const m of (t.matches || [])){
      const ka = normKey(m.a), kb = normKey(m.b);
      const A = P(ka, m.a), B = P(kb, m.b);
      A.played++; B.played++;
      A.pf += m.sa; A.pa += m.sb; B.pf += m.sb; B.pa += m.sa;
      const aWon = m.sa > m.sb;
      if (aWon) { A.won++; B.lost++; } else { B.won++; A.lost++; }
      A.form.push(aWon ? "W" : "L");
      B.form.push(!aWon ? "W" : "L");
      // ELO over the whole season, match by match, oldest first
      const ra = ratings[ka] != null ? ratings[ka] : START_RATING;
      const rb = ratings[kb] != null ? ratings[kb] : START_RATING;
      const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const score = aWon ? 1 : 0;
      ratings[ka] = Math.round(ra + K * (score - ea));
      ratings[kb] = Math.round(rb + K * ((1 - score) - (1 - ea)));
    }

    (t.ranking || []).forEach((nm, i) => {
      const p = players[normKey(nm)];
      if (!p) return;
      if (i === 0) p.titles++;
      if (i < 2) p.top2++;
      if (p.best == null || i + 1 < p.best) p.best = i + 1;
    });
  }

  Object.values(players).forEach(p => {
    p.rating = ratings[p.key] != null ? ratings[p.key] : START_RATING;
    p.name = display[p.key] || p.name;
    p.form = p.form.slice(-5);
    p.winPct = p.played ? Math.round(100 * p.won / p.played) : 0;
    p.diff = p.pf - p.pa;
    // star: comparably better than the field — any one of these earns it
    p.reasons = [];
    if (p.played >= 6 && p.rating >= START_RATING + 80)
      p.reasons.push("rating " + p.rating + " (+" + (p.rating - START_RATING) + " over the season start)");
    if (p.played >= 8 && p.winPct >= 65)
      p.reasons.push(p.winPct + "% win rate over " + p.played + " matches");
    if (p.titles >= 2)
      p.reasons.push(p.titles + " titles");
    p.autoStar = p.reasons.length > 0;
    p.star = p.autoStar || !!season.manualStars[p.key];
    if (season.manualStars[p.key] && !p.autoStar) p.reasons.push("marked by the admin");
  });

  const order = Object.values(players).sort((a, b) =>
    (b.rating - a.rating) || (b.won - a.won) || ((b.pf - b.pa) - (a.pf - a.pa)) || a.name.localeCompare(b.name));
  return { players, order };
}

/* ---- public faces ---- */

function getPublicView(){
  if (!cache.dirty && cache.view) return cache.view;
  const stats = computeStats();
  cache.view = {
    name: season.name,
    createdAt: season.createdAt,
    tournamentCount: season.tournaments.length,
    completedCount: season.tournaments.filter(t => !t.status || t.status === "complete").length,
    abandonedCount: season.tournaments.filter(t => t.status === "abandoned").length,
    tournaments: season.tournaments.map(t => ({
      id: t.id, date: t.date, name: t.name, champion: t.champion,
      participants: t.participants.length,
      matches: (t.matches || []).length,
      status: t.status || "complete",
      ranking: (t.ranking || []).slice(0, 3)
    })).reverse(),
    players: stats.players,   // keyed by normalised name
    order: stats.order.map(p => p.key),
    starCount: stats.order.filter(p => p.star).length
  };
  cache.dirty = false;
  return cache.view;
}

function getRatings(){
  const stats = computeStats();
  const m = {};
  Object.values(stats.players).forEach(p => {
    m[p.key] = p.rating;      // normalised key — robust to casing
    m[p.name] = p.rating;     // current spelling — robust to display
  });
  return m;
}

function toggleStar(name){
  const key = normKey(name);
  if (!key) throw new Error("Who should get the star?");
  if (season.manualStars[key]) delete season.manualStars[key];
  else season.manualStars[key] = true;
  save();
  return !!season.manualStars[key];
}

function getFullJSON(){ return JSON.stringify(season, null, 2); }

function importJSON(text){
  let parsed;
  try { parsed = JSON.parse(String(text)); }
  catch (_) { throw new Error("That doesn't look like season data — the file isn't valid JSON."); }
  if (!validateSeason(parsed))
    throw new Error("That file isn't a season archive exported from this app.");
  season = parsed;
  if (!season.manualStars) season.manualStars = {};
  save();
  return { count: season.tournaments.length };
}

function newSeason(name){
  season = blankSeason();
  if (name && String(name).trim()) season.name = String(name).trim().slice(0, 60);
  save();
  return getPublicView();
}

/* ---- live tournament state (resume) ----
   Auto-saved after every admin action so a restart can resume. */

function saveTournamentState(snapshot){
  store.set("tournamentState", snapshot);
}

function loadTournamentState(){
  const parsed = store.get("tournamentState");
  if (!parsed || typeof parsed !== "object" || parsed.v !== 3 || !parsed.state) return null;
  return parsed;
}

function clearTournamentState(){
  store.del("tournamentState");
}

function tournamentCount(){ return season ? season.tournaments.length : 0; }

module.exports = {
  recordTournament,
  getPublicView,
  getRatings,
  toggleStar,
  getFullJSON,
  importJSON,
  newSeason,
  tournamentCount,
  saveTournamentState,
  loadTournamentState,
  clearTournamentState,
  load,
  _reloadForTests: load
};
