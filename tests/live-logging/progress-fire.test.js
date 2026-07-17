/**
 * tests/live-logging/progress-fire.test.js
 *
 * Unit tests for the long-turn in-progress observation trigger
 * (lib/live-logging/progress-fire.mjs).
 *
 * The trigger fires an extra observation each time a live prompt-set accumulates
 * another `thresholdTokens` of model output, so a 40-min / 100k-token turn isn't
 * collapsed into a single prompt-time row. Calibrated default: 30k (the session's
 * long turns ran 80k–135k output tokens).
 */

import {
  DEFAULT_PROGRESS_TOKEN_DELTA,
  sumOutputTokens,
  progressFireDecision,
} from '../../lib/live-logging/progress-fire.mjs';

const D = 30_000;

describe('sumOutputTokens', () => {
  test('sums outputTokens across exchanges', () => {
    expect(sumOutputTokens([{ outputTokens: 1000 }, { outputTokens: 2500 }])).toBe(3500);
  });
  test('treats missing/non-numeric/negative as 0 (non-Claude exchanges)', () => {
    expect(sumOutputTokens([{ outputTokens: 1000 }, {}, { outputTokens: -5 }, { outputTokens: 'x' }, null])).toBe(1000);
  });
  test('empty / nullish set → 0', () => {
    expect(sumOutputTokens([])).toBe(0);
    expect(sumOutputTokens(undefined)).toBe(0);
  });
});

describe('progressFireDecision', () => {
  test('default threshold is the tuned 30k', () => {
    expect(DEFAULT_PROGRESS_TOKEN_DELTA).toBe(30_000);
  });

  test('does not fire below the threshold', () => {
    expect(progressFireDecision({ setOutputTokens: 29_999, firedOutputTokens: 0, thresholdTokens: D }))
      .toEqual({ fire: false, mark: 0, markAt: 0 });
  });

  test('fires once the delta reaches the threshold; mark advances to current total', () => {
    expect(progressFireDecision({ setOutputTokens: 31_000, firedOutputTokens: 0, thresholdTokens: D }))
      .toEqual({ fire: true, mark: 31_000, markAt: 0 });
  });

  test('only the delta SINCE the last fire counts', () => {
    // 50k already fired; now at 70k → delta 20k < 30k → no fire
    expect(progressFireDecision({ setOutputTokens: 70_000, firedOutputTokens: 50_000, thresholdTokens: D }))
      .toEqual({ fire: false, mark: 50_000, markAt: 0 });
    // now at 85k → delta 35k ≥ 30k → fire
    expect(progressFireDecision({ setOutputTokens: 85_000, firedOutputTokens: 50_000, thresholdTokens: D }))
      .toEqual({ fire: true, mark: 85_000, markAt: 0 });
  });

  test('a 135k turn yields 3 in-progress fires (at 36/72/108k) over 12k increments', () => {
    let fired = 0;
    const fires = [];
    for (let t = 12_000; t <= 135_000; t += 12_000) {
      const { fire, mark } = progressFireDecision({ setOutputTokens: t, firedOutputTokens: fired, thresholdTokens: D });
      fired = mark;
      if (fire) fires.push(t);
    }
    expect(fires).toEqual([36_000, 72_000, 108_000]);
  });

  test('a short turn (≤ threshold) never fires in-progress', () => {
    let fired = 0, count = 0;
    for (let t = 4_000; t <= 16_000; t += 4_000) {
      const { fire, mark } = progressFireDecision({ setOutputTokens: t, firedOutputTokens: fired, thresholdTokens: D });
      fired = mark;
      if (fire) count++;
    }
    expect(count).toBe(0);
  });

  test('new turn rebases when the per-cursor accumulator shrinks (set cleared)', () => {
    // prior turn left mark at 120k; new turn starts and grows to 5k → rebase to 0, no fire
    expect(progressFireDecision({ setOutputTokens: 5_000, firedOutputTokens: 120_000, thresholdTokens: D }))
      .toEqual({ fire: false, mark: 0, markAt: 0 });
    // and it fires fresh once the NEW turn crosses the threshold, not the old 120k mark
    expect(progressFireDecision({ setOutputTokens: 31_000, firedOutputTokens: 120_000, thresholdTokens: D }))
      .toEqual({ fire: true, mark: 31_000, markAt: 0 });
  });

  test('threshold <= 0 disables the token feature', () => {
    expect(progressFireDecision({ setOutputTokens: 999_999, firedOutputTokens: 0, thresholdTokens: 0 }))
      .toEqual({ fire: false, mark: 0, markAt: 0 });
    expect(progressFireDecision({ setOutputTokens: 999_999, firedOutputTokens: 0, thresholdTokens: -1 }).fire)
      .toBe(false);
  });

  test('guards non-numeric inputs', () => {
    expect(progressFireDecision({ setOutputTokens: undefined, firedOutputTokens: undefined, thresholdTokens: D }))
      .toEqual({ fire: false, mark: 0, markAt: 0 });
  });
});

describe('progressFireDecision — wall-clock trigger (token-less agents)', () => {
  const ELAPSED = 5 * 60 * 1000; // 5 min

  test('fires on elapsed time even with 0 output tokens (opencode/copilot/mastra case)', () => {
    const t0 = 1_000_000;
    // 0 tokens, but 5 min since turn start → fire; markAt advances to now
    const r = progressFireDecision({
      setOutputTokens: 0, firedOutputTokens: 0, thresholdTokens: D,
      nowMs: t0 + ELAPSED, lastFiredAtMs: t0, elapsedThresholdMs: ELAPSED,
    });
    expect(r.fire).toBe(true);
    expect(r.mark).toBe(0);        // no tokens for opencode
    expect(r.markAt).toBe(t0 + ELAPSED);
  });

  test('does not fire before the elapsed threshold', () => {
    const t0 = 1_000_000;
    const r = progressFireDecision({
      setOutputTokens: 0, firedOutputTokens: 0, thresholdTokens: D,
      nowMs: t0 + ELAPSED - 1, lastFiredAtMs: t0, elapsedThresholdMs: ELAPSED,
    });
    expect(r.fire).toBe(false);
    expect(r.markAt).toBe(t0);     // reference unchanged until a fire
  });

  test('token trigger still wins when it crosses first (elapsed not yet reached)', () => {
    const t0 = 1_000_000;
    const r = progressFireDecision({
      setOutputTokens: 31_000, firedOutputTokens: 0, thresholdTokens: D,
      nowMs: t0 + 60_000, lastFiredAtMs: t0, elapsedThresholdMs: ELAPSED,
    });
    expect(r.fire).toBe(true);
    expect(r.mark).toBe(31_000);
    expect(r.markAt).toBe(t0 + 60_000);
  });

  test('elapsedThresholdMs <= 0 disables the time trigger (token path intact)', () => {
    const t0 = 1_000_000;
    const r = progressFireDecision({
      setOutputTokens: 0, firedOutputTokens: 0, thresholdTokens: D,
      nowMs: t0 + 10 * ELAPSED, lastFiredAtMs: t0, elapsedThresholdMs: 0,
    });
    expect(r.fire).toBe(false);
  });

  test('a 47-min token-less turn yields ~9 elapsed fires at 5-min cadence', () => {
    // Simulate a poll loop: opencode turn, 0 tokens throughout, polled every 30s.
    const start = 2_000_000;
    let lastAt = start;               // seeded to turn start by the caller
    const fires = [];
    for (let now = start; now <= start + 47 * 60_000; now += 30_000) {
      const { fire, markAt } = progressFireDecision({
        setOutputTokens: 0, firedOutputTokens: 0, thresholdTokens: D,
        nowMs: now, lastFiredAtMs: lastAt, elapsedThresholdMs: ELAPSED,
      });
      if (fire) { fires.push(now); lastAt = markAt; }
    }
    // 47 min / 5 min ≈ 9 snapshots (vs 0 under the token-only trigger)
    expect(fires.length).toBe(9);
  });
});
