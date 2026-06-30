/**
 * tests/live-logging/singleton-reclaim.test.js
 *
 * Unit tests for the ETM singleton-lock reclaim policy
 * (lib/live-logging/singleton-reclaim.mjs).
 *
 * Regression target: the 2026-06-30 observation outage. A holder that
 * heartbeat fresh but wrote ZERO observations for hours held the lock while
 * every restart deferred — because the old guard only checked heartbeat
 * staleness, which a polling-but-not-writing holder passes. The STALL-DETECT
 * signal (holder self-reports status:'stalled') must now also trigger reclaim.
 */

import {
  STALL_DETECT_INTERVAL_MS,
  computeObservationStalled,
  evaluateHolderLiveness,
  decideReclaim,
} from '../../lib/live-logging/singleton-reclaim.mjs';

const RECLAIM_STALE_MS = 3 * 60 * 1000;
const NOW = 1_000_000_000; // fixed clock — helpers take injected nowMs

describe('computeObservationStalled', () => {
  test('stalled: no obs for >5min while transcript appended within 5min', () => {
    expect(computeObservationStalled({
      msSinceLastObs: 6 * 60 * 1000,
      jsonlAgeMs: 30 * 1000,
      stallMs: STALL_DETECT_INTERVAL_MS,
    })).toBe(true);
  });

  test('NOT stalled when obs were written recently (within window)', () => {
    expect(computeObservationStalled({
      msSinceLastObs: 60 * 1000,
      jsonlAgeMs: 10 * 1000,
      stallMs: STALL_DETECT_INTERVAL_MS,
    })).toBe(false);
  });

  test('NOT stalled when transcript is cold (no recent activity to capture)', () => {
    // 6min since obs, but transcript last touched 10min ago → idle, not a stall.
    expect(computeObservationStalled({
      msSinceLastObs: 6 * 60 * 1000,
      jsonlAgeMs: 10 * 60 * 1000,
      stallMs: STALL_DETECT_INTERVAL_MS,
    })).toBe(false);
  });

  test('NOT stalled when transcript age is unknown (null/Infinity)', () => {
    // No real transcript statted ⇒ cannot prove activity ⇒ never flag.
    expect(computeObservationStalled({ msSinceLastObs: 6 * 60 * 1000, jsonlAgeMs: null })).toBe(false);
    expect(computeObservationStalled({ msSinceLastObs: 6 * 60 * 1000, jsonlAgeMs: Infinity })).toBe(false);
  });

  test('boundary: exactly at the threshold is NOT stalled (strictly greater)', () => {
    expect(computeObservationStalled({
      msSinceLastObs: STALL_DETECT_INTERVAL_MS,
      jsonlAgeMs: 1000,
      stallMs: STALL_DETECT_INTERVAL_MS,
    })).toBe(false);
  });

  test('guards a negative/garbage jsonl age (clock skew) → not stalled', () => {
    expect(computeObservationStalled({ msSinceLastObs: 6 * 60 * 1000, jsonlAgeMs: -500 })).toBe(false);
  });
});

describe('evaluateHolderLiveness', () => {
  test('fresh heartbeat + writing → no signals', () => {
    const r = evaluateHolderLiveness({ lastBeat: NOW - 5000, status: 'running' }, NOW, { reclaimStaleMs: RECLAIM_STALE_MS });
    expect(r.staleMs).toBe(5000);
    expect(r.stalled).toBe(false);
  });

  test('stale heartbeat → staleMs exceeds threshold (wedged poll loop)', () => {
    const r = evaluateHolderLiveness({ lastBeat: NOW - 4 * 60 * 1000, status: 'running' }, NOW, { reclaimStaleMs: RECLAIM_STALE_MS });
    expect(r.staleMs).toBe(4 * 60 * 1000);
    expect(r.stalled).toBe(false);
  });

  test('fresh heartbeat + status:stalled → stalled signal set', () => {
    const r = evaluateHolderLiveness({ lastBeat: NOW - 5000, status: 'stalled' }, NOW, { reclaimStaleMs: RECLAIM_STALE_MS });
    expect(r.stalled).toBe(true);
  });

  test('status:stalled but heartbeat ALSO stale → do NOT trust stalled (staleMs path owns it)', () => {
    const r = evaluateHolderLiveness({ lastBeat: NOW - 4 * 60 * 1000, status: 'stalled' }, NOW, { reclaimStaleMs: RECLAIM_STALE_MS });
    expect(r.stalled).toBe(false);        // ancient status must not trigger a kill on its own
    expect(r.staleMs).toBe(4 * 60 * 1000); // but the wedged-heartbeat path still fires
  });

  test('no entry → unprovable (staleMs null, defer)', () => {
    const r = evaluateHolderLiveness(undefined, NOW, { reclaimStaleMs: RECLAIM_STALE_MS });
    expect(r.staleMs).toBeNull();
    expect(r.stalled).toBe(false);
  });

  test('entry without a valid lastBeat → unprovable', () => {
    expect(evaluateHolderLiveness({ status: 'stalled' }, NOW, { reclaimStaleMs: RECLAIM_STALE_MS }).staleMs).toBeNull();
    expect(evaluateHolderLiveness({ lastBeat: 0, status: 'stalled' }, NOW, { reclaimStaleMs: RECLAIM_STALE_MS }).staleMs).toBeNull();
  });
});

describe('decideReclaim', () => {
  test('wedged heartbeat → reclaim (wedged-heartbeat)', () => {
    expect(decideReclaim({ staleMs: 4 * 60 * 1000, stalled: false }, RECLAIM_STALE_MS))
      .toEqual({ reclaim: true, reason: 'wedged-heartbeat' });
  });

  test('heartbeating but stalled → reclaim (stall-detect) — the 2026-06-30 regression', () => {
    expect(decideReclaim({ staleMs: 5000, stalled: true }, RECLAIM_STALE_MS))
      .toEqual({ reclaim: true, reason: 'stall-detect' });
  });

  test('fresh + writing → no reclaim', () => {
    expect(decideReclaim({ staleMs: 5000, stalled: false }, RECLAIM_STALE_MS))
      .toEqual({ reclaim: false, reason: null });
  });

  test('unprovable (staleMs null) → defer, never kill', () => {
    expect(decideReclaim({ staleMs: null, stalled: false }, RECLAIM_STALE_MS))
      .toEqual({ reclaim: false, reason: null });
  });

  test('wedged-heartbeat takes precedence over stall when both set', () => {
    expect(decideReclaim({ staleMs: 4 * 60 * 1000, stalled: true }, RECLAIM_STALE_MS).reason)
      .toBe('wedged-heartbeat');
  });
});
