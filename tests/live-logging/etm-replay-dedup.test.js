/**
 * tests/live-logging/etm-replay-dedup.test.js
 *
 * Duplicate observations from a REPLAY (2026-11-11): the glass ETM tracked two
 * transcripts, the older one dropped out at 23:50Z, and the single-transcript
 * loop resumed the remaining one from a read cursor that belonged to the
 * dropped one. Not found → "using last 10 exchanges" → ten already-observed
 * prompt sets went through the pipeline again, hours later; three got past the
 * obs-api dedup as second rows with the same timestamp.
 *
 * Two layers are pinned here, on the REAL prototype methods with a fake `this`:
 *   1. the read cursor follows its transcript (_cursorFor / _switchPrimaryTranscript /
 *      tracker removal), so the replay does not start;
 *   2. the fire cursor remembers WHEN it last fired, so a replay that starts anyway
 *      cannot re-fire an older prompt set.
 */

import ETM from '../../scripts/enhanced-transcript-monitor.js';

const proto = ETM.prototype;

const ex = (id, iso) => ({ uuid: id, id, lastMessageUuid: `${id}-end`, timestamp: iso });

function fireSelf(overrides = {}) {
  const fired = [];
  const self = {
    observationWriter: {},
    sessionId: 'ses',
    agentType: 'claude',
    transcriptPath: '/t/b.jsonl',
    _lastFiredExchangeUuid: new Map(),
    _lastFiredExchangeTs: new Map(),
    _extractFileChanges: () => ({ modifiedFiles: [], readFiles: [] }),
    _turnKeyForSet: () => 'k',
    _splitIntoRecaptureBatches: (p) => [p],
    _fireBatchObservation: (batch, _taskId, _uuid, opts) => { fired.push(batch.map((e) => e.id)); self.ctxs.push(opts.ctx); },
    _fireContext: proto._fireContext,
    ctxs: [],
    saveLastProcessedUuid: () => {},
    fired,
  };
  return Object.assign(self, overrides);
}

const fire = async (self, set) => {
  proto._firePromptSetObservation.call(self, set);
  await new Promise((r) => setTimeout(r, 0)); // batches fire after the task-id promise
};

describe('fire cursor — a replay of fired prompt sets fires nothing', () => {
  test('older prompt sets passed one by one after later ones were fired are skipped', async () => {
    const self = fireSelf();
    const s1 = [ex('p1', '2026-11-11T19:39:14.792Z')];
    const s2 = [ex('p2', '2026-11-11T20:10:41.988Z')];
    const s3 = [ex('p3', '2026-11-11T20:30:23.647Z')];
    for (const s of [s1, s2, s3]) await fire(self, s);
    expect(self.fired).toEqual([['p1'], ['p2'], ['p3']]);

    // The replay: the same sets again, in order. The uuid cursor (p3) is in none
    // but the last, which is exactly how they used to re-fire.
    for (const s of [s1, s2, s3]) await fire(self, s);
    expect(self.fired).toEqual([['p1'], ['p2'], ['p3']]);
  });

  test('a genuinely new turn after the replay still fires', async () => {
    const self = fireSelf();
    await fire(self, [ex('p1', '2026-11-11T19:39:14.792Z')]);
    await fire(self, [ex('p1', '2026-11-11T19:39:14.792Z')]);
    await fire(self, [ex('p2', '2026-11-12T04:02:53.943Z')]);
    expect(self.fired).toEqual([['p1'], ['p2']]);
  });

  test('cursors are per transcript: another transcript is not suppressed', async () => {
    const self = fireSelf();
    await fire(self, [ex('b1', '2026-11-11T20:00:00.000Z')]);
    self.transcriptPath = '/t/a.jsonl';
    await fire(self, [ex('a1', '2026-11-11T19:00:00.000Z')]);
    expect(self.fired).toEqual([['b1'], ['a1']]);
  });

  test('an exchange without a timestamp is kept (it cannot be placed)', async () => {
    const self = fireSelf();
    await fire(self, [ex('p1', '2026-11-11T20:00:00.000Z')]);
    await fire(self, [ex('p0', '2026-11-11T19:00:00.000Z'), { uuid: 'nt', id: 'nt' }]);
    expect(self.fired).toEqual([['p1'], ['nt']]);
  });
});

describe('fire context — fixed when the fire is decided', () => {
  test('a swap of agentType/transcriptPath before the batch runs does not relabel it', async () => {
    const self = fireSelf();
    proto._firePromptSetObservation.call(self, [ex('c1', '2026-11-11T10:39:26.236Z')]);
    // The multi-transcript loop moves on to an opencode transcript before the
    // task-id promise resolves — this is how a claude turn became 'opencode'.
    self.agentType = 'opencode';
    self.transcriptPath = 'opencode://ses_x';
    await new Promise((r) => setTimeout(r, 0));
    expect(self.ctxs).toEqual([{ agent: 'claude', transcriptPath: '/t/b.jsonl', openCodeDb: undefined }]);
  });
});

function cursorSelf() {
  const self = {
    transcriptPath: '/t/a.jsonl',
    lastProcessedUuid: 'a-cur',
    trackedTranscripts: new Map(),
    _knownCursors: new Map(),
  };
  for (const m of ['_cursorFor', '_rememberCursor', '_switchPrimaryTranscript']) self[m] = proto[m];
  return self;
}

describe('read cursor follows its transcript', () => {
  test('switching the primary transcript swaps in that transcript\'s cursor, not the old one', () => {
    const self = cursorSelf();
    self.trackedTranscripts.set('/t/b.jsonl', { lastProcessedUuid: 'b-cur' });
    self._switchPrimaryTranscript('/t/b.jsonl');
    expect(self.transcriptPath).toBe('/t/b.jsonl');
    expect(self.lastProcessedUuid).toBe('b-cur');
    // ...and switching back resumes a where it was.
    self.trackedTranscripts.clear();
    self._switchPrimaryTranscript('/t/a.jsonl');
    expect(self.lastProcessedUuid).toBe('a-cur');
  });

  test('a transcript never read here starts with no cursor, not another transcript\'s', () => {
    const self = cursorSelf();
    self._switchPrimaryTranscript('/t/new.jsonl');
    expect(self.lastProcessedUuid).toBe(null);
  });

  test('a dropped tracker\'s cursor is kept for when the transcript comes back', () => {
    const self = cursorSelf();
    self.trackedTranscripts.set('/t/b.jsonl', { lastProcessedUuid: 'b-cur' });
    self.findAllActiveTranscripts = () => [{ path: '/t/a.jsonl', source: 'claude' }];
    proto._refreshTrackedTranscripts.call(self); // b drops out
    expect(self.trackedTranscripts.has('/t/b.jsonl')).toBe(false);
    self.findAllActiveTranscripts = () => [{ path: '/t/b.jsonl', source: 'claude' }];
    proto._refreshTrackedTranscripts.call(self); // b is back
    expect(self.trackedTranscripts.get('/t/b.jsonl').lastProcessedUuid).toBe('b-cur');
  });

  test('the multi-transcript pass keeps the primary cursor in step with its tracker', () => {
    const src = proto._processAllTrackedTranscripts.toString();
    expect(src).toMatch(/if \(tPath === savedPath\) savedUuid = this\.lastProcessedUuid;/);
  });
});
