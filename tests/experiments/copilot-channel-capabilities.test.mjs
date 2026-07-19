// tests/experiments/copilot-channel-capabilities.test.mjs
//
// Unit tests for the Copilot per-turn injection channel resolver. This is the piece that
// makes multi-channel injection upgrade-safe: it maps the installed Copilot version to the
// set of channels to emit on, and that set IS the dedup. Run via: node --test <file>.
//
// We drive resolvePlan(versionStr) directly (never getCopilotVersion) so the tests don't
// spawn `copilot --version`. Override env vars are set/cleared per test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePlan,
  parseVersion,
  compareVersion,
  PER_TURN_CHANNELS,
  FAILSAFE_CHANNELS,
} from '../../src/hooks/copilot-channel-capabilities.js';

function clearOverrides() {
  delete process.env.COPILOT_KB_CHANNELS;
  delete process.env.COPILOT_VERSION;
}

test('parseVersion extracts x.y.z from noisy strings, ignoring build suffix', () => {
  assert.deepEqual(parseVersion('1.0.72'), [1, 0, 72]);
  assert.deepEqual(parseVersion('1.0.72-1'), [1, 0, 72]);
  assert.deepEqual(parseVersion('GitHub Copilot CLI 1.0.72-1.'), [1, 0, 72]);
  assert.equal(parseVersion('no version here'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
});

test('compareVersion orders by major, minor, patch', () => {
  assert.ok(compareVersion([1, 0, 71], [1, 0, 72]) < 0);
  assert.ok(compareVersion([1, 0, 72], [1, 0, 71]) > 0);
  assert.equal(compareVersion([1, 0, 72], [1, 0, 72]), 0);
  assert.ok(compareVersion([1, 1, 0], [1, 0, 99]) > 0);
});

test('v1.0.71 → postToolUse ONLY (uPS output is dropped on that build)', () => {
  clearOverrides();
  const plan = resolvePlan('1.0.71');
  assert.deepEqual(plan.channels, ['postToolUse']);
  assert.equal(plan.known, true);
  assert.equal(plan.source, 'map');
  // Critical regression guard: uPS must NOT be in the set, or it would suppress the only
  // channel that actually delivers on 1.0.71.
  assert.ok(!plan.channels.includes('userPromptSubmitted'));
});

test('older 1.0.x (e.g. 1.0.50) also resolves to postToolUse only', () => {
  clearOverrides();
  assert.deepEqual(resolvePlan('1.0.50').channels, ['postToolUse']);
});

test('v1.0.72-1 → userPromptSubmitted ONLY (single clean injection, no dup)', () => {
  clearOverrides();
  const plan = resolvePlan('1.0.72-1');
  assert.deepEqual(plan.channels, ['userPromptSubmitted']);
  assert.equal(plan.known, true);
  assert.equal(plan.source, 'map');
  assert.equal(plan.channels.length, 1, 'exactly one channel = injected once');
});

test('v1.0.99 (still in the 1.0.x band) stays on userPromptSubmitted', () => {
  clearOverrides();
  assert.deepEqual(resolvePlan('1.0.99').channels, ['userPromptSubmitted']);
});

test('unknown newer version (1.1.0) → dup-tolerant fail-safe on BOTH channels', () => {
  clearOverrides();
  const plan = resolvePlan('1.1.0');
  assert.deepEqual(plan.channels, [...FAILSAFE_CHANNELS]);
  assert.equal(plan.known, false);
  assert.equal(plan.source, 'failsafe');
  // Fail-safe must include both per-turn channels so delivery is guaranteed regardless of
  // which one the new build happens to honor.
  for (const ch of PER_TURN_CHANNELS) assert.ok(plan.channels.includes(ch));
});

test('undeterminable version → fail-safe on both channels', () => {
  clearOverrides();
  const plan = resolvePlan(null);
  // With no COPILOT_VERSION override and copilot possibly absent, either we read a real
  // version (map) or fall through to fail-safe. When null is forced with no cache, expect
  // fail-safe-no-version unless a real copilot is on PATH.
  assert.ok(Array.isArray(plan.channels));
  if (!plan.version) {
    assert.equal(plan.source, 'failsafe-no-version');
    assert.deepEqual(plan.channels, [...FAILSAFE_CHANNELS]);
  }
});

test('COPILOT_KB_CHANNELS override forces an exact set, bypassing the map', () => {
  clearOverrides();
  process.env.COPILOT_KB_CHANNELS = 'postToolUse';
  let plan = resolvePlan('1.0.72-1'); // map would say uPS, but override wins
  assert.deepEqual(plan.channels, ['postToolUse']);
  assert.equal(plan.source, 'override');

  process.env.COPILOT_KB_CHANNELS = 'postToolUse,userPromptSubmitted';
  plan = resolvePlan('1.0.71');
  assert.deepEqual(plan.channels.sort(), ['postToolUse', 'userPromptSubmitted'].sort());
  assert.equal(plan.source, 'override');

  clearOverrides();
});

test('COPILOT_KB_CHANNELS override filters out unknown channel names', () => {
  clearOverrides();
  process.env.COPILOT_KB_CHANNELS = 'postToolUse,sessionStart,bogus';
  const plan = resolvePlan('1.0.72-1');
  // sessionStart is not a per-turn channel; bogus is invalid → both dropped.
  assert.deepEqual(plan.channels, ['postToolUse']);
  clearOverrides();
});

test('COPILOT_KB_CHANNELS=none disables per-turn injection', () => {
  clearOverrides();
  for (const off of ['none', 'off', '0', 'false']) {
    process.env.COPILOT_KB_CHANNELS = off;
    const plan = resolvePlan('1.0.72-1');
    assert.deepEqual(plan.channels, [], `"${off}" should disable`);
    assert.equal(plan.source, 'override');
  }
  clearOverrides();
});
