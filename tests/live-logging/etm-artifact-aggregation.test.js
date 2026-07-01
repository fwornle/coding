/**
 * tests/live-logging/etm-artifact-aggregation.test.js
 *
 * Unit tests for the two ETM artifact fixes:
 *   (a) turn-level artifact aggregation — every observation for a user turn
 *       lists the turn's edits even when the ETM over-segments the turn and the
 *       edit landed in a sibling batch. (_extractFileChanges + _fireBatchObservation)
 *   (b) periodic re-patch buffer — _recordArtifactPatch coalesces edit-sets and
 *       _sweepRecentArtifactPatches re-applies them within a retention window so
 *       an observation that lands AFTER its immediate patch (async/offline race)
 *       still gets backfilled.
 *
 * The monitor constructor does heavy I/O init, so we build instances via
 * Object.create(prototype) and stub only the fields the methods under test touch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import EnhancedTranscriptMonitor from '../../scripts/enhanced-transcript-monitor.js';

const proto = EnhancedTranscriptMonitor.prototype;

function exchange({ ts = '2026-07-01T14:18:13.000Z', tools = [] } = {}) {
  return {
    uuid: `u-${Math.random().toString(36).slice(2)}`,
    timestamp: ts,
    userMessage: 'patch the bridge',
    assistantMessage: 'working on it',
    toolCalls: tools,
  };
}

test('_extractFileChanges: Edit/Write → modifiedFiles, Read → readFiles, de-duped', () => {
  const exchanges = [
    exchange({ tools: [
      { name: 'Read', input: { file_path: 'proxy-bridge/server.mjs' } },
      { name: 'Edit', input: { file_path: 'proxy-bridge/server.mjs' } },
      { name: 'Write', input: { file_path: 'lib/new.js' } },
      { name: 'Read', input: { file_path: 'proxy-bridge/server.mjs' } }, // dup read
      { name: 'Bash', input: { command: 'ls' } },                        // no file
    ] }),
  ];
  const { modifiedFiles, readFiles } = proto._extractFileChanges.call({}, exchanges);
  assert.deepEqual(modifiedFiles, ['proxy-bridge/server.mjs', 'lib/new.js']);
  assert.deepEqual(readFiles, ['proxy-bridge/server.mjs']);
});

test('_extractFileChanges: tolerates null/empty exchanges', () => {
  assert.deepEqual(proto._extractFileChanges.call({}, null), { modifiedFiles: [], readFiles: [] });
  assert.deepEqual(proto._extractFileChanges.call({}, [{}]), { modifiedFiles: [], readFiles: [] });
});

test('fix (a): a read-only batch inherits the turn edit via turnModifiedFiles', async () => {
  // The "patch the bridge" batch that carries the narrative but only did a Read.
  const readOnlyBatch = [
    exchange({ tools: [{ name: 'Read', input: { file_path: 'proxy-bridge/server.mjs' } }] }),
  ];

  let captured = null;
  const recorded = [];
  const stub = {
    agentType: 'claude',
    sessionId: 's1',
    config: { projectPath: '/Users/Q284340/Agentic/_work/rapid-llm-proxy' },
    _firedPromptKeys: new Map(),
    debug: () => {},
    _extractFileChanges: proto._extractFileChanges,
    observationWriter: {
      processMessages: async (_messages, metadata) => { captured = metadata; return {}; },
    },
    // Stub the patch side-effects so we don't hit the instanceof/HTTP branch.
    _recordArtifactPatch: (agent, files) => recorded.push({ agent, files }),
    _patchRecentObservationsWithArtifacts: async () => {},
  };

  proto._fireBatchObservation.call(stub, readOnlyBatch, 'task-1', 'uuid-1', {
    turnModifiedFiles: ['proxy-bridge/server.mjs'],
    turnReadFiles: ['proxy-bridge/server.mjs'],
  });
  await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget promise settle

  assert.ok(captured, 'processMessages should have been called');
  assert.deepEqual(captured.modifiedFiles, ['proxy-bridge/server.mjs'],
    'read-only batch must inherit the turn edit so Artifacts aligns with the narrative');
  assert.equal(recorded.length, 1, 'edit-set should be buffered for periodic re-patch');
  assert.deepEqual(recorded[0].files, ['proxy-bridge/server.mjs']);
});

test('fix (a): batch-local edits union with turn aggregate (no double-count)', async () => {
  const batch = [
    exchange({ tools: [{ name: 'Edit', input: { file_path: 'a.js' } }] }),
  ];
  let captured = null;
  const stub = {
    agentType: 'claude', sessionId: 's1',
    config: { projectPath: '/tmp' },
    _firedPromptKeys: new Map(), debug: () => {},
    _extractFileChanges: proto._extractFileChanges,
    observationWriter: { processMessages: async (_m, meta) => { captured = meta; return {}; } },
    _recordArtifactPatch: () => {},
    _patchRecentObservationsWithArtifacts: async () => {},
  };
  proto._fireBatchObservation.call(stub, batch, 't', 'u', {
    turnModifiedFiles: ['a.js', 'b.js'], turnReadFiles: [],
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(captured.modifiedFiles, ['a.js', 'b.js'], 'union is de-duplicated');
});

test('fix (b): _recordArtifactPatch coalesces identical edit-sets by key', () => {
  const stub = { _recentArtifactPatches: new Map() };
  proto._recordArtifactPatch.call(stub, 'claude', ['x.js', 'y.js']);
  proto._recordArtifactPatch.call(stub, 'claude', ['y.js', 'x.js']); // same set, different order
  assert.equal(stub._recentArtifactPatches.size, 1, 'same file-set coalesces to one entry');
  proto._recordArtifactPatch.call(stub, 'copilot', ['x.js', 'y.js']);
  assert.equal(stub._recentArtifactPatches.size, 2, 'different agent is a distinct entry');
  // empty files is a no-op
  proto._recordArtifactPatch.call(stub, 'claude', []);
  assert.equal(stub._recentArtifactPatches.size, 2);
});

test('fix (b): _sweepRecentArtifactPatches re-applies fresh entries and prunes stale ones', async () => {
  const calls = [];
  const now = Date.now();
  const stub = {
    _recentArtifactPatches: new Map([
      ['claude::a.js', { agent: 'claude', files: ['a.js'], atMs: now - 60_000 }],      // fresh (1 min)
      ['claude::old.js', { agent: 'claude', files: ['old.js'], atMs: now - 20 * 60_000 }], // stale (20 min)
    ]),
    _patchRecentObservationsWithArtifacts: async (files, _read, agent) => {
      calls.push({ files, agent });
    },
  };
  await proto._sweepRecentArtifactPatches.call(stub);
  assert.equal(calls.length, 1, 'only the fresh entry is re-patched');
  assert.deepEqual(calls[0].files, ['a.js']);
  assert.equal(calls[0].agent, 'claude', 'sweep passes the buffered agent (loop-safe)');
  assert.ok(!stub._recentArtifactPatches.has('claude::old.js'), 'stale entry pruned');
  assert.ok(stub._recentArtifactPatches.has('claude::a.js'), 'fresh entry retained for further retries');
});
