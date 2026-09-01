// lib/network/kickstart-gate.mjs
//
// May the proxy be restarted right now, and is this caller even looking at
// something new?
//
// ── The incident this exists for ────────────────────────────────────────────
// 2026-08-31, from the coordinator's own log:
//
//   07:02:52.046  proxy auto-heal: dispatching restart (consecutive_failures=1, kickstart_count=1)
//   07:02:52.063  proxy auto-heal: dispatching restart (consecutive_failures=2, kickstart_count=2)
//   07:02:52.114  proxy strong-probe escalation: dispatching restart  (kickstart_count=3)
//   07:04:34      proxy auto-heal cooldown engaged — 3 kickstarts in last 300s
//
// One underlying failure, three restarts in 68ms, and the entire
// 3-per-5-minutes budget spent before the first restart had finished. A
// genuine proxy fault arriving in the next five minutes would have found no
// remediation left at all. At 07:04:33 a kickstart errored outright, because
// the service was still mid-restart from 100ms earlier.
//
// TWO distinct faults produced that, and a debounce alone fixes only one:
//
//   1. The cheap-probe FSM counted INVOCATIONS, not probe outcomes. It is
//      called from three places, one of them every tick from /health/refresh,
//      whose comment claimed "safe to call here: the failure path only
//      increments when semantic_ok stayed false". There was no edge detection
//      behind that claim — every call while semantic_ok was false incremented
//      the counter and, past the 60s sustained gate, dispatched. Two of the
//      three restarts above are the same FSM firing twice, 17ms apart, off one
//      probe result. isFreshProbeOutcome is the missing edge.
//
//   2. Five independent paths (cheap FSM, strong-probe escalation, passthrough
//      frozen-502, networkMode flip, location mismatch) could each dispatch
//      without knowing another just had. They shared a COUNT cap and no
//      TIME gate, so "3 in 5 minutes" was satisfiable in 68 milliseconds.
//      decideKickstart is the shared gate.
//
// A restart takes 3-8s to come back and a probe cycle to prove anything, so a
// second dispatch inside that window cannot be acting on evidence about the
// new process — it is responding to the old one, or to the gap the restart
// itself created.
//
// PURE — every input is an argument. No env, no I/O, no clock. Same reason as
// its neighbours: health-coordinator.js binds ports on import and cannot be
// imported by a test.

/** 3 kickstarts per 5 minutes, no two closer than 60s. */
export const KICKSTART_WINDOW_MS = 5 * 60_000;
export const KICKSTART_MAX_IN_WINDOW = 3;
/**
 * Minimum gap between two dispatches, whoever asks.
 *
 * 60s = the cheap probe's interval, so consecutive dispatches are necessarily
 * separated by at least one fresh observation of the restarted process. Longer
 * would eat into the 5-minute window's ability to retry a genuine fault three
 * times; shorter would allow a dispatch on evidence gathered before the
 * previous restart completed, which is the bug.
 */
export const KICKSTART_DEBOUNCE_MS = 60_000;

/**
 * Is this a probe result the caller has not already acted on?
 *
 * Both paths stamp `last_probe_end` when they produce a verdict, so its value
 * identifies the outcome. A caller arriving with the same stamp as last time
 * is re-reading one conclusion, not observing a second failure.
 *
 * Returns false when there is no probe end at all: before the first probe
 * there is no outcome to act on, and counting one would let a restart fire on
 * no evidence at boot.
 *
 * @param {string|null|undefined} lastEvaluated the stamp already acted on
 * @param {string|null|undefined} probeEnd      the stamp on the current outcome
 * @returns {boolean}
 */
export function isFreshProbeOutcome(lastEvaluated, probeEnd) {
  if (!probeEnd) return false;
  return lastEvaluated !== probeEnd;
}

/**
 * Drop timestamps that have slid out of the window.
 *
 * @param {number[]} timestamps epoch ms
 * @param {number} now epoch ms
 * @param {number} [windowMs]
 * @returns {number[]} a new array; the input is not mutated
 */
export function pruneWindow(timestamps, now, windowMs = KICKSTART_WINDOW_MS) {
  return (timestamps || []).filter((ts) => (now - ts) < windowMs);
}

/**
 * May a kickstart be dispatched now?
 *
 * Two gates, checked in this order because they answer different questions and
 * the reasons are reported separately:
 *
 *   debounced  something restarted the proxy moments ago. Whatever this caller
 *              saw, it saw it through that. Never dispatch.
 *   cooldown   the last three restarts did not fix it. A fourth will not
 *              either; this is where a human is needed.
 *
 * `countsTowardCap: false` is for a dispatch that is NOT a response to a proxy
 * failure — the networkMode flip, which is a user action (the network changed)
 * and has always been exempt from the failure cooldown. It is still DEBOUNCED:
 * "the network changed" is no reason to restart a process that is already
 * restarting, and if one just did, the re-detection the flip wants has already
 * happened.
 *
 * @param {object} o
 * @param {number} o.now epoch ms
 * @param {number[]} [o.timestamps] previous dispatches that count toward the cap
 * @param {number|null} [o.lastDispatchAt] epoch ms of the last dispatch by ANY path
 * @param {boolean} [o.countsTowardCap]
 * @param {number} [o.windowMs]
 * @param {number} [o.maxInWindow]
 * @param {number} [o.debounceMs]
 * @returns {{allowed: boolean, reason: 'ok'|'debounced'|'cooldown', recent: number[], waitMs: number}}
 */
export function decideKickstart({
  now,
  timestamps = [],
  lastDispatchAt = null,
  countsTowardCap = true,
  windowMs = KICKSTART_WINDOW_MS,
  maxInWindow = KICKSTART_MAX_IN_WINDOW,
  debounceMs = KICKSTART_DEBOUNCE_MS,
} = {}) {
  const recent = pruneWindow(timestamps, now, windowMs);

  if (lastDispatchAt != null && (now - lastDispatchAt) < debounceMs) {
    return { allowed: false, reason: 'debounced', recent, waitMs: debounceMs - (now - lastDispatchAt) };
  }
  if (countsTowardCap && recent.length >= maxInWindow) {
    // When the window clears, measured from the oldest entry in it.
    const waitMs = windowMs - (now - Math.min(...recent));
    return { allowed: false, reason: 'cooldown', recent, waitMs };
  }
  return { allowed: true, reason: 'ok', recent, waitMs: 0 };
}
