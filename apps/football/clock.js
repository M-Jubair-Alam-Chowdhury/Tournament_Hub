"use strict";

// Persist timestamps, not interval ticks. Every viewer derives the same elapsed
// time; reconnecting and background tabs never reset the match clock.
// v2.0: each half has a hard limit (duration/2 + extraFirst, duration +
// extraSecond). The server settles a running clock at its limit (see
// logic.settleClocks) and "extra" extends the current half — the referee's
// added time. The clock resumes when extra arrives after the half ended.
const MAX_MS = 360 * 60 * 1000;
const MAX_EXTRA_MIN = 15;
function elapsed(clock, now = Date.now()) {
  if (!clock) return 0;
  return Math.min(MAX_MS, Math.max(0, clock.elapsedMs +
    (clock.startedAt == null ? 0 : Math.max(0, now - clock.startedAt))));
}
function initial() {
  return { elapsedMs: 0, startedAt: null, period: "first", breakAt: null, revision: 0, goals: [], extraFirst: 0, extraSecond: 0 };
}
// The current half's whistle line: 45' (+extra) or 90' (+extra).
function periodLimitMs(clock, duration) {
  if (!clock) return 0;
  const mins = clock.period === "second" ? duration : duration / 2;
  const extra = clock.period === "second" ? (clock.extraSecond || 0) : (clock.extraFirst || 0);
  return Math.min(MAX_MS, mins * 60000 + extra * 60000);
}
function transition(clock, action, duration, seconds, now = Date.now()) {
  const next = { ...clock, elapsedMs: elapsed(clock, now) };
  if (action === "start") {
    if (clock.period === "half" || clock.period === "finished") throw new Error("Start the second half, or correct the paused clock first.");
    if (clock.startedAt != null) throw new Error("The clock is already running.");
    if (next.elapsedMs >= periodLimitMs(next, duration))
      throw new Error(clock.period === "first"
        ? "The first half is over — add extra time or call half-time."
        : "The match is over — add extra time or call full-time.");
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
  } else if (action === "extra") {
    if (clock.period !== "first" && clock.period !== "second") throw new Error("Extra time is only for a playing half.");
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_EXTRA_MIN)
      throw new Error("Extra time is 1 to " + MAX_EXTRA_MIN + " minutes.");
    const wasAtEnd = clock.startedAt == null && clock.elapsedMs >= periodLimitMs(clock, duration);
    const added = ((clock.period === "second" ? clock.extraSecond : clock.extraFirst) || 0) + seconds;
    const rawLimit = (clock.period === "second" ? duration : duration / 2) * 60000 + added * 60000;
    if (rawLimit > MAX_MS) throw new Error("That much extra time would run past the 360:00 limit.");
    if (clock.period === "first") next.extraFirst = added;
    else next.extraSecond = added;
    // the referee adds time after the whistle: play resumes on its own
    if (wasAtEnd) next.startedAt = now;
  } else throw new Error("Unknown clock action.");
  next.revision++;
  return next;
}
// The server-side whistle: a running clock that reached its limit is
// stopped exactly on the line. Returns the settled clock, or null when
// nothing needs to change.
function settle(clock, duration, now = Date.now()) {
  if (!clock || clock.startedAt == null) return null;
  const limit = periodLimitMs(clock, duration);
  if (elapsed(clock, now) < limit) return null;
  return { ...clock, elapsedMs: limit, startedAt: null, revision: clock.revision + 1 };
}
function restore(raw) {
  if (!raw || !Number.isFinite(raw.elapsedMs) || raw.elapsedMs < 0 || raw.elapsedMs > MAX_MS ||
      !["first", "half", "second", "finished"].includes(raw.period) ||
      !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.goals)) return null;
  const extra = v => (Number.isInteger(v) && v >= 0 && v <= 359 ? v : 0);
  // A saved snapshot contains the elapsed time at save time. Downtime is not play.
  return { elapsedMs: raw.elapsedMs, startedAt: null, period: raw.period,
    breakAt: null, revision: raw.revision + 1, goals: raw.goals,
    extraFirst: extra(raw.extraFirst), extraSecond: extra(raw.extraSecond) };
}
module.exports = { elapsed, initial, transition, restore, settle, periodLimitMs, MAX_MS, MAX_EXTRA_MIN };
