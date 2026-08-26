// tests/experiments/kb-ab-discrimination-report.test.mjs
//
// The report turns cell outcomes into the one number the whole sampling exercise exists to
// produce. Two things about it are easy to get quietly wrong: the interval (a normal
// approximation runs outside [0,1] at exactly the proportions a pilot lands on) and the
// classification rule (which decides what "discriminates" counts as, and therefore the rate).

import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, parseTaskId, wilson } from '../../scripts/kb-ab-discrimination-report.mjs';

// `ungated` counts rows that exist but were never graded — a preflight skip writes a row with a
// null terminal_state, no steps and no score. `scored` is therefore the honest denominator, and
// the helper derives it the same way armStats does.
const arm = (accepted, n, ungated = 0) => ({
  n, scored: n - ungated, accepted, ungated, steps: null, seconds: null, tokens: null,
});

// ── interval ───────────────────────────────────────────────────────────────

test('the Wilson interval stays inside [0,1] where a normal approximation would not', () => {
  // 0/10 and 10/10 are exactly where a pilot lands, and where p ± 1.96·sqrt(p(1-p)/n) collapses
  // to a zero-width interval that claims certainty from ten observations.
  const none = wilson(0, 10);
  const all = wilson(10, 10);

  assert.equal(none.low, 0);
  assert.ok(none.high > 0.2 && none.high < 0.35, `0/10 upper bound implausible: ${none.high}`);
  assert.equal(all.high, 1);
  assert.ok(all.low > 0.65 && all.low < 0.8, `10/10 lower bound implausible: ${all.low}`);
});

test('the interval narrows as n grows at a fixed proportion', () => {
  const small = wilson(5, 10);
  const large = wilson(50, 100);
  assert.equal(small.point, large.point);
  assert.ok((large.high - large.low) < (small.high - small.low));
});

test('wilson reports no point estimate for an empty denominator rather than dividing by zero', () => {
  const empty = wilson(0, 0);
  assert.equal(empty.point, null);
  assert.deepEqual([empty.low, empty.high], [0, 1]);
});

// ── task_id parsing ────────────────────────────────────────────────────────

test('parseTaskId recovers the experiment, arm and repeat from a cell task_id', () => {
  const p = parseTaskId('kbs-etm-crashloop--claude-claude-sonnet-4-6-straight-kb-on--r2');
  assert.equal(p.experimentId, 'kbs-etm-crashloop');
  assert.equal(p.env, 'kb-on');
  assert.equal(p.rep, 2);
});

test('parseTaskId tells kb-off from kb-on despite the shared prefix', () => {
  // `kb-on` is a suffix of nothing, but `-kb-off` and `-kb-on` differ by two characters at the end
  // of a hyphenated cell name — a naive `includes('kb-on')` would mis-read neither, but a naive
  // split on '-' would. Both arms must land in the right column or the rate inverts.
  assert.equal(parseTaskId('x--claude-m-straight-kb-off--r0').env, 'kb-off');
  assert.equal(parseTaskId('x--claude-m-straight-kb-on--r0').env, 'kb-on');
});

test('parseTaskId returns null for an id that is not a cell', () => {
  assert.equal(parseTaskId('some-ambient-session-uuid'), null);
});

// ── the 2x2 ────────────────────────────────────────────────────────────────

test('the four outcomes are the report\'s own 2x2', () => {
  assert.equal(classify(arm(2, 2), arm(0, 2)), 'discriminates');
  assert.equal(classify(arm(2, 2), arm(2, 2)), 'kb-redundant');
  assert.equal(classify(arm(0, 2), arm(0, 2)), 'neither-solves');
  // The retired kb-ab-llm-routing cell: the repository held a confident contradicting answer and
  // the treatment arm believed it. This must be visible, not folded into "did not discriminate".
  assert.equal(classify(arm(0, 2), arm(2, 2)), 'injection-hurt');
});

test('"produces it" is a majority, so one flaky repeat cannot flip a task', () => {
  // 1/2 is a majority (ceil(2/2) = 1), 1/3 is not (ceil(3/2) = 2).
  assert.equal(classify(arm(1, 2), arm(0, 2)), 'discriminates');
  assert.equal(classify(arm(1, 3), arm(0, 3)), 'neither-solves');
});

test('an arm with no cells is not a result, and is not "neither arm solved it"', () => {
  // A task whose kb-on cells never ran must not be scored as if the arm had answered — and equally
  // must not be scored as if it had TRIED and failed. This assertion used to expect
  // 'neither-solves', whose published meaning is "a broken gate, or beyond both arms": a positive
  // claim about an agent that was never invoked.
  assert.equal(classify(arm(0, 0), arm(0, 2)), 'not-run');
});

test('rows that exist but were never graded do not count as failures', () => {
  // The real shape of the bug: six preflight skips (HTTP 500 on the route) wrote six rows with
  // gate_passed null. Counting rows rather than scores read them as 0/3 in both arms and published
  // the task as `neither-solves`. Both arms present, neither graded ⇒ not a result.
  assert.equal(classify(arm(0, 3, 3), arm(0, 3, 3)), 'not-run');
  // One arm graded, the other entirely skipped, is still not a comparison.
  assert.equal(classify(arm(3, 3), arm(0, 3, 3)), 'not-run');
});

test('the majority rule counts graded repeats, not rows', () => {
  // 1 of 2 graded is a majority; the same single pass among 3 rows where one never ran is 1 of 2,
  // still a majority — whereas counting rows would make it 1 of 3 and silently flip the task.
  assert.equal(classify(arm(1, 3, 1), arm(0, 2)), 'discriminates');
});
