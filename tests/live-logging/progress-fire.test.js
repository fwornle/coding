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
      .toEqual({ fire: false, mark: 0 });
  });

  test('fires once the delta reaches the threshold; mark advances to current total', () => {
    expect(progressFireDecision({ setOutputTokens: 31_000, firedOutputTokens: 0, thresholdTokens: D }))
      .toEqual({ fire: true, mark: 31_000 });
  });

  test('only the delta SINCE the last fire counts', () => {
    // 50k already fired; now at 70k → delta 20k < 30k → no fire
    expect(progressFireDecision({ setOutputTokens: 70_000, firedOutputTokens: 50_000, thresholdTokens: D }))
      .toEqual({ fire: false, mark: 50_000 });
    // now at 85k → delta 35k ≥ 30k → fire
    expect(progressFireDecision({ setOutputTokens: 85_000, firedOutputTokens: 50_000, thresholdTokens: D }))
      .toEqual({ fire: true, mark: 85_000 });
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
      .toEqual({ fire: false, mark: 0 });
    // and it fires fresh once the NEW turn crosses the threshold, not the old 120k mark
    expect(progressFireDecision({ setOutputTokens: 31_000, firedOutputTokens: 120_000, thresholdTokens: D }))
      .toEqual({ fire: true, mark: 31_000 });
  });

  test('threshold <= 0 disables the feature', () => {
    expect(progressFireDecision({ setOutputTokens: 999_999, firedOutputTokens: 0, thresholdTokens: 0 }))
      .toEqual({ fire: false, mark: 0 });
    expect(progressFireDecision({ setOutputTokens: 999_999, firedOutputTokens: 0, thresholdTokens: -1 }).fire)
      .toBe(false);
  });

  test('guards non-numeric inputs', () => {
    expect(progressFireDecision({ setOutputTokens: undefined, firedOutputTokens: undefined, thresholdTokens: D }))
      .toEqual({ fire: false, mark: 0 });
  });
});
