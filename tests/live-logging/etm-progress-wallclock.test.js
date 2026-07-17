/**
 * tests/live-logging/etm-progress-wallclock.test.js
 *
 * Integration test for the ETM wiring of the wall-clock progress trigger
 * (scripts/enhanced-transcript-monitor.js :: _maybeFireProgressObservation).
 *
 * The pure decision logic lives in progress-fire.mjs (unit-tested separately).
 * This spec exercises the REAL instance method off the prototype with a
 * lightweight fake `this`, proving the integration concerns that the pure
 * function can't: seeding the wall-clock reference from the in-flight set's
 * START timestamp, resetting on a turn boundary, firing for a token-less
 * (opencode) turn, and minting a UNIQUE snapshot id per fire.
 *
 * Root cause it guards: opencode/copilot/mastra transcripts carry no
 * usage.output_tokens, so a long autonomous turn produced ZERO observations
 * until the next user prompt — leaving the global [📚] badge orange during
 * active parallel work.
 */

import ETM from '../../scripts/enhanced-transcript-monitor.js';

const proto = ETM.prototype;
const MIN = 60 * 1000;

function makeSelf(overrides = {}) {
  const self = {
    progressTokenDelta: 30_000,
    progressElapsedMs: 5 * MIN,
    currentUserPromptSet: [],
    sessionId: 'ses_test',
    agentType: 'opencode',
    transcriptPath: 'opencode://ses_test',
    _progressFiredTokens: new Map(),
    _progressFiredAt: new Map(),
    _progressTurnKey: new Map(),
    _progressSnapshotSeq: 0,
    _turnKeyForSet: proto._turnKeyForSet,
    _snapshots: [],
  };
  // Stub the actual fire so no HTTP/obs-api call happens; record the id inputs.
  self._fireProgressSnapshot = function (set, mark) {
    const lastEx = set[set.length - 1];
    const lastUuid = lastEx?.lastMessageUuid || lastEx?.uuid || lastEx?.id || '';
    this._progressSnapshotSeq = (this._progressSnapshotSeq || 0) + 1;
    this._snapshots.push({ uuid: `${lastUuid}-progress-${mark}-${this._progressSnapshotSeq}`, mark });
  };
  return Object.assign(self, overrides);
}

const fire = (self) => proto._maybeFireProgressObservation.call(self);

// An opencode-style exchange: NO outputTokens field (token-less agent).
const ocExchange = (uuid, agoMs) => ({
  uuid,
  id: uuid,
  lastMessageUuid: `${uuid}-last`,
  timestamp: new Date(Date.now() - agoMs).toISOString(),
});

describe('ETM _maybeFireProgressObservation — wall-clock wiring', () => {
  test('token-less turn held past the elapsed threshold fires a snapshot', () => {
    const self = makeSelf();
    // First exchange started 6 min ago → seeded reference is 6 min old → fire.
    self.currentUserPromptSet = [ocExchange('u1', 6 * MIN)];
    fire(self);
    expect(self._snapshots.length).toBe(1);
    expect(self._snapshots[0].mark).toBe(0); // opencode → 0 output tokens
  });

  test('does not double-fire immediately after a fire (reference advances)', () => {
    const self = makeSelf();
    self.currentUserPromptSet = [ocExchange('u1', 6 * MIN)];
    fire(self);            // fires
    fire(self);            // reference now ~now → elapsed ~0 → no fire
    expect(self._snapshots.length).toBe(1);
  });

  test('a fresh turn (new START id) resets the clock and does not instantly fire', () => {
    const self = makeSelf();
    self.currentUserPromptSet = [ocExchange('u1', 6 * MIN)];
    fire(self);                                   // turn u1 fires
    expect(self._snapshots.length).toBe(1);
    // New turn begins NOW (start id u2, timestamp ~now) → reset, no immediate fire.
    self.currentUserPromptSet = [ocExchange('u2', 0)];
    fire(self);
    expect(self._snapshots.length).toBe(1);
  });

  test('successive elapsed fires get UNIQUE snapshot ids despite mark staying 0', () => {
    const self = makeSelf();
    self.currentUserPromptSet = [ocExchange('u1', 6 * MIN)];
    fire(self);
    // Force the reference back 6 min so the next poll fires again for the SAME turn.
    self._progressFiredAt.set('ses_test|opencode://ses_test', Date.now() - 6 * MIN);
    fire(self);
    expect(self._snapshots.length).toBe(2);
    expect(self._snapshots[0].uuid).not.toBe(self._snapshots[1].uuid);
  });

  test('empty in-flight set never fires', () => {
    const self = makeSelf();
    self.currentUserPromptSet = [];
    fire(self);
    expect(self._snapshots.length).toBe(0);
  });

  test('both triggers disabled → never fires even when very stale', () => {
    const self = makeSelf({ progressTokenDelta: 0, progressElapsedMs: 0 });
    self.currentUserPromptSet = [ocExchange('u1', 60 * MIN)];
    fire(self);
    expect(self._snapshots.length).toBe(0);
  });
});
