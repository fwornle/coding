// tests/context-turns/correlate.test.mjs
//
// Behavior (RESEARCH Test Map + Hand-off #1): observation correlation picks the
// nearest-by-createdAt observation within the span window + matching agent, and
// yields null when none correlate. Observations carry NO task_id, so the join
// is a best-effort [from,to]-window + agent reference (D-07/D-08).
//
// Implemented in 84-05. Drives enrichObservationRefs from
// scripts/measurement-stop.mjs with the observations injected (offline /
// deterministic — no live obs-api).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './_helpers.mjs';
import { enrichObservationRefs } from '../../scripts/measurement-stop.mjs';

const observations = loadFixture('observations-slice.json');
const from = '2026-07-07T10:00:00.000Z';
const to = '2026-07-07T11:00:00.000Z';

// Fixture window observations (all 2026-07-07, matching-agent claude unless noted):
//   obs-1111 claude 10:05  | obs-2222 claude 10:20 | obs-3333 copilot 10:40 |
//   obs-4444 claude 2026-07-06 09:00 (out-of-window, proves nearest-by-createdAt filter)
const OBS_1111 = 'obs-11111111-1111-4111-8111-111111111111';

test('in-window + matching-agent turn → nearest-by-createdAt observation_ref', () => {
  const lines = [{ ts: '2026-07-07T10:06:00.000Z', agent: 'claude', observation_ref: null }];
  enrichObservationRefs(lines, { from, to, agent: 'claude', observations });
  assert.ok(lines[0].observation_ref, 'observation_ref is set');
  // 10:06 is nearest to obs-1111 (10:05, 1min) over obs-2222 (10:20, 14min); copilot excluded.
  assert.equal(lines[0].observation_ref.id, OBS_1111, 'nearest matching observation wins');
  assert.ok(typeof lines[0].observation_ref.intent === 'string', 'carries an intent snippet');
});

test('out-of-window turn → observation_ref stays null', () => {
  const lines = [{ ts: '2026-07-07T09:00:00.000Z', agent: 'claude', observation_ref: null }];
  enrichObservationRefs(lines, { from, to, agent: 'claude', observations });
  assert.equal(lines[0].observation_ref, null, 'a turn before the span window does not correlate');
});

test('wrong-agent turn (no matching observation) → observation_ref stays null', () => {
  const lines = [{ ts: '2026-07-07T10:30:00.000Z', agent: 'opencode', observation_ref: null }];
  enrichObservationRefs(lines, { from, to, agent: 'opencode', observations });
  assert.equal(lines[0].observation_ref, null, 'no opencode observation in-window → null');
});

test('empty / failed observation source leaves all refs null without throwing', () => {
  const lines = [
    { ts: '2026-07-07T10:06:00.000Z', agent: 'claude', observation_ref: null },
    { ts: '2026-07-07T10:50:00.000Z', agent: 'claude', observation_ref: null },
  ];
  assert.doesNotThrow(() => enrichObservationRefs(lines, { from, to, agent: 'claude', observations: [] }));
  assert.equal(lines[0].observation_ref, null);
  assert.equal(lines[1].observation_ref, null);
});

test('multiple turns → many map to ONE nearest observation (coarse reference)', () => {
  const lines = [
    { ts: '2026-07-07T10:04:00.000Z', agent: 'claude', observation_ref: null }, // → obs-1111 (10:05)
    { ts: '2026-07-07T10:22:00.000Z', agent: 'claude', observation_ref: null }, // → obs-2222 (10:20)
  ];
  enrichObservationRefs(lines, { from, to, agent: 'claude', observations });
  assert.equal(lines[0].observation_ref.id, OBS_1111);
  assert.equal(lines[1].observation_ref.id, 'obs-22222222-2222-4222-8222-222222222222');
});
