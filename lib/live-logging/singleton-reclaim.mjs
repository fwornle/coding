/**
 * lib/live-logging/singleton-reclaim.mjs
 *
 * Pure decision helpers for the ETM (enhanced-transcript-monitor) singleton
 * lock reclaim. Extracted from enhanced-transcript-monitor.js so the reclaim
 * policy can be unit-tested without instantiating the daemon.
 *
 * Background — two distinct "wedged holder" failure modes the singleton guard
 * must reclaim from (both observed in production):
 *
 *   1. WEDGED POLL LOOP — the holder's PID is alive but its poll loop has
 *      stalled, so it stops posting `lsl_heartbeat`. Detected by heartbeat
 *      staleness (now − lastBeat > reclaimStaleMs). This was the 25→28 June
 *      outage fix.
 *
 *   2. HEARTBEATING-BUT-NOT-WRITING — the holder polls fine (fresh heartbeat)
 *      but writes ZERO observations for minutes despite an actively-appended
 *      transcript. The heartbeat-staleness probe canNOT see this (the holder
 *      looks healthy), so every restart deferred and the observation stream
 *      went silent while the lock looked held. This is the STALL-DETECT signal:
 *      the holder self-reports `status: 'stalled'` in its heartbeat, and a new
 *      instance reclaims on it.
 *
 * Both helpers are side-effect-free and take an injected `nowMs` so tests are
 * deterministic (no Date.now()).
 */

/**
 * Shared stall threshold: a holder is observation-stalled when it has written no
 * observation for longer than this while the transcript is still being appended.
 * Used by BOTH the watchdog's [STALL-DETECT] log AND the heartbeat self-report,
 * so the two can never disagree.
 */
export const STALL_DETECT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The holder's own observation-stall self-assessment, published in its heartbeat
 * `status`. Stalled = no observation written for > stallMs WHILE the transcript
 * jsonl was appended within stallMs (i.e. there genuinely IS activity to capture
 * — an idle session with a cold transcript is NOT a stall).
 *
 * @param {object} args
 * @param {number} args.msSinceLastObs  now − lastObservationWriteAt (ms)
 * @param {number} args.jsonlAgeMs      now − transcript mtime (ms); null/Infinity when no real transcript
 * @param {number} [args.stallMs]       threshold (defaults to STALL_DETECT_INTERVAL_MS)
 * @returns {boolean}
 */
export function computeObservationStalled({ msSinceLastObs, jsonlAgeMs, stallMs = STALL_DETECT_INTERVAL_MS }) {
  if (typeof msSinceLastObs !== 'number' || !(msSinceLastObs > stallMs)) return false;
  // jsonl must have a real, recent mtime — proof there was activity to capture.
  // Unknown age (null/Infinity) or a cold transcript (age >= stallMs) ⇒ not a stall.
  if (typeof jsonlAgeMs !== 'number' || !(jsonlAgeMs >= 0) || !(jsonlAgeMs < stallMs)) return false;
  return true;
}

/**
 * Evaluate a singleton-lock holder from its coordinator `lsl` entry and decide
 * the two reclaim signals.
 *
 * @param {object|undefined} entry  the holder's `state.lsl[<key>]` entry
 *                                   (must carry numeric `lastBeat`; may carry `status`)
 * @param {number} nowMs            injected clock
 * @param {object} opts
 * @param {number} opts.reclaimStaleMs  heartbeat-staleness reclaim threshold
 * @returns {{ staleMs: number|null, stalled: boolean }}
 *   staleMs — ms since the holder's last heartbeat, or null when unprovable
 *             (no entry / no lastBeat). null ⇒ caller MUST defer (never kill a
 *             holder we can't prove is wedged).
 *   stalled — holder is heartbeating fresh AND self-reports `status: 'stalled'`.
 */
export function evaluateHolderLiveness(entry, nowMs, { reclaimStaleMs }) {
  if (!entry || typeof entry.lastBeat !== 'number' || entry.lastBeat <= 0) {
    return { staleMs: null, stalled: false };
  }
  const staleMs = nowMs - entry.lastBeat;
  // Trust a self-reported 'stalled' status ONLY while the holder is still
  // actively heartbeating (staleMs within the reclaim window). A 'stalled'
  // status from a holder that is ALSO heartbeat-stale is already covered by the
  // staleMs > reclaimStaleMs path, and an ancient status from a pid-reused
  // process must not trigger a kill.
  const stalled = entry.status === 'stalled' && staleMs >= 0 && staleMs < reclaimStaleMs;
  return { staleMs, stalled };
}

/**
 * Final reclaim decision combining both signals. Reclaim when the holder's poll
 * loop is wedged (heartbeat stale) OR it is heartbeating but observation-stalled.
 *
 * @param {{ staleMs: number|null, stalled: boolean }} probe
 * @param {number} reclaimStaleMs
 * @returns {{ reclaim: boolean, reason: 'wedged-heartbeat'|'stall-detect'|null }}
 */
export function decideReclaim(probe, reclaimStaleMs) {
  const wedgedHeartbeat = probe.staleMs != null && probe.staleMs > reclaimStaleMs;
  if (wedgedHeartbeat) return { reclaim: true, reason: 'wedged-heartbeat' };
  if (probe.stalled) return { reclaim: true, reason: 'stall-detect' };
  return { reclaim: false, reason: null };
}
