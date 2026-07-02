// tests/repro/clock.test.mjs
//
// Phase 67, Plan 67-02 (Wave 2) — determinism + monotonicity suite for the
// D-08 clock shim (lib/repro/fixtures/clock.mjs). The shim freezes at a
// snapshot `clockBase` and advances by a monotonic offset derived from
// performance.now(). To prove determinism WITHOUT real sleeps, every test
// installs the shim with an injectable/stubbed `now` function that replays a
// fixed sequence — so `Date.now()` output is exactly predictable.
//
// Contract under test:
//   - installClock(base, { now }) overrides Date.now / new Date() to return
//     `base + Math.round(now() - replayStart)`.
//   - Given a fixed base + stubbed now sequence, Date.now() is exactly
//     reproducible AND strictly non-decreasing (monotonic).
//   - The first Date.now() after install is >= base and within a small epsilon.
//   - uninstall() restores the native Date.now (post-uninstall differs from the
//     frozen base — it returns the real wall clock again).
//   - new Date() (no-arg) uses the shimmed now; new Date(x) stays native.
//   - The exported `clockBase` reflects the last-installed base.
//
// Convention: node:test + node:assert/strict (the established tests/experiments/
// pattern — NOT jest globals). Output via process.stderr.write only
// (no console.* — no-console-log).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { installClock, clockBase } from '../../lib/repro/fixtures/clock.mjs';

/**
 * A deterministic performance.now() stub that replays a fixed sequence of
 * values (clamping to the last value once exhausted). The FIRST call is
 * consumed by installClock as `replayStart`; subsequent calls back Date.now().
 * @param {number[]} values
 * @returns {() => number}
 */
function seqNow(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
}

describe('installClock — determinism', () => {
  test('Date.now() is exactly reproducible from a fixed base + stubbed now', () => {
    const base = 1_000_000;
    // replayStart = 100; then Date.now() consumes 150, 175, 200.
    const handle = installClock(base, { now: seqNow([100, 150, 175, 200]) });
    try {
      assert.equal(Date.now(), base + 50); // round(150-100)
      assert.equal(Date.now(), base + 75); // round(175-100)
      assert.equal(Date.now(), base + 100); // round(200-100)
    } finally {
      handle.uninstall();
    }
  });

  test('re-running the same base + sequence yields identical output', () => {
    const base = 42_000;
    const seq = [10, 10.4, 11.9, 20];
    const runOnce = () => {
      const h = installClock(base, { now: seqNow(seq) });
      const out = [Date.now(), Date.now(), Date.now()];
      h.uninstall();
      return out;
    };
    assert.deepEqual(runOnce(), runOnce());
  });
});

describe('installClock — monotonicity', () => {
  test('successive Date.now() calls are non-decreasing even with tiny/flat deltas', () => {
    const base = 500_000;
    // replayStart = 100; flat + fractional advances that round to repeats.
    const handle = installClock(base, { now: seqNow([100, 100, 100.4, 100.6, 101, 101]) });
    try {
      const samples = [Date.now(), Date.now(), Date.now(), Date.now(), Date.now()];
      for (let i = 1; i < samples.length; i += 1) {
        assert.ok(samples[i] >= samples[i - 1], `sample ${i} (${samples[i]}) < prev (${samples[i - 1]})`);
      }
      // Exact expectation: 500000, 500000, 500001, 500001, 500001
      assert.deepEqual(samples, [500_000, 500_000, 500_001, 500_001, 500_001]);
    } finally {
      handle.uninstall();
    }
  });

  test('first Date.now() after install is >= base and within a small epsilon', () => {
    const base = 777_000;
    const handle = installClock(base, { now: seqNow([2_000, 2_000.2]) });
    try {
      const first = Date.now();
      assert.ok(first >= base, `first (${first}) < base (${base})`);
      assert.ok(first - base < 5, `first drifted too far from base: ${first - base}`);
    } finally {
      handle.uninstall();
    }
  });
});

describe('installClock — new Date() behavior', () => {
  test('no-arg new Date() uses the shimmed now; parametrized new Date(x) stays native', () => {
    const base = 1_600_000_000_000; // a real-ish ms epoch
    const handle = installClock(base, { now: seqNow([50, 50]) });
    try {
      assert.equal(new Date().getTime(), base); // offset 0
      // parametrized construction is untouched:
      assert.equal(new Date(0).getTime(), 0);
      assert.equal(new Date('2020-01-01T00:00:00.000Z').getTime(), Date.parse('2020-01-01T00:00:00.000Z'));
    } finally {
      handle.uninstall();
    }
  });
});

describe('installClock — uninstall restores natives', () => {
  test('after uninstall, Date.now() returns the real wall clock (not the frozen base)', () => {
    const base = 1_000_000; // a small (1970-era) base, far from real now
    const handle = installClock(base, { now: seqNow([0, 0]) });
    assert.equal(Date.now(), base);
    handle.uninstall();
    const real = Date.now();
    assert.notEqual(real, base);
    assert.ok(real > 1_600_000_000_000, `post-uninstall Date.now() looks non-native: ${real}`);
  });

  test('clockBase export reflects the last-installed base', async () => {
    const h1 = installClock(12_345, { now: seqNow([0, 0]) });
    // live ESM binding — re-import to read the updated value
    const mod = await import('../../lib/repro/fixtures/clock.mjs');
    assert.equal(mod.clockBase, 12_345);
    h1.uninstall();
    const h2 = installClock(67_890, { now: seqNow([0, 0]) });
    assert.equal(mod.clockBase, 67_890);
    h2.uninstall();
  });
});

// Reference the imported binding so lint does not flag it (also documents that
// clockBase is exported for inspection).
assert.equal(typeof installClock, 'function');
void clockBase;
