"use strict";

// Persist timestamps, not interval ticks. Every viewer derives the same elapsed
// time; reconnecting and background tabs never reset the match clock.
const MAX_MS = 360 * 60 * 1000;
function elapsed(clock, now = Date.now()) {
  if (!clock) return 0;
  return Math.min(MAX_MS, Math.max(0, clock.elapsedMs +
    (clock.startedAt == null ? 0 : Math.max(0, now - clock.startedAt))));
}
function initial() {
  return { elapsedMs: 0, startedAt: null, period: "first", breakAt: null, revision: 0, goals: [] };
}
function transition(clock, action, duration, seconds, now = Date.now()) {
  const next = { ...clock, elapsedMs: elapsed(clock, now) };
  if (action === "start") {
    if (clock.period === "half" || clock.period === "finished") throw new Error("Start the second half, or correct the paused clock first.");
    if (clock.startedAt != null) throw new Error("The clock is already running.");
    if (next.elapsedMs >= MAX_MS) throw new Error("Correct the clock before restarting it.");
    next.startedAt = now;
  } else if (action === "pause") {
    next.startedAt = null;
  } else if (action === "half") {
    if (clock.period !== "first") throw new Error("Half-time is only available in the first half.");
    next.startedAt = null;
    next.period = "half";
    next.breakAt = now;
  } else if (action === "second") {
    if (clock.period !== "half") throw new Error("Call half-time before starting the second half.");
    next.elapsedMs = duration * 30 * 1000;
    next.startedAt = now;
    next.period = "second";
    next.breakAt = null;
  } else if (action === "finish") {
    next.startedAt = null;
    next.period = "finished";
  } else if (action === "adjust") {
    if (clock.startedAt != null) throw new Error("Pause the clock before correcting its time.");
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_MS / 1000) throw new Error("Enter a time between 0:00 and 360:00.");
    next.elapsedMs = seconds * 1000;
    next.period = seconds >= duration * 30 ? "second" : "first";
    next.breakAt = null;
  } else throw new Error("Unknown clock action.");
  next.revision++;
  return next;
}
function restore(raw) {
  if (!raw || !Number.isFinite(raw.elapsedMs) || raw.elapsedMs < 0 || raw.elapsedMs > MAX_MS ||
      !["first", "half", "second", "finished"].includes(raw.period) ||
      !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.goals)) return null;
  // A saved snapshot contains the elapsed time at save time. Downtime is not play.
  return { elapsedMs: raw.elapsedMs, startedAt: null, period: raw.period,
    breakAt: null, revision: raw.revision + 1, goals: raw.goals };
}
module.exports = { elapsed, initial, transition, restore, MAX_MS };
