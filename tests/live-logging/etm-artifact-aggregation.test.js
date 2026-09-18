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
import EnhancedTranscriptMonitor, { bashWriteTargets } from '../../scripts/enhanced-transcript-monitor.js';

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

// ---------------------------------------------------------------------------
// (c) the three ways a real file change used to go unrecorded
// ---------------------------------------------------------------------------

test('_extractFileChanges: notebook edits carry notebook_path, not file_path', () => {
  // `notebookedit` was already in MODIFY_TOOL_NAMES, so the tool matched and the
  // path lookup then missed — a tool that could never produce an artifact.
  const { modifiedFiles } = proto._extractFileChanges.call({}, [
    exchange({ tools: [{ name: 'NotebookEdit', input: { notebook_path: 'notebooks/eda.ipynb' } }] }),
  ]);
  assert.deepEqual(modifiedFiles, ['notebooks/eda.ipynb']);
});

test('_extractFileChanges: pi tool calls carry arguments as a JSON string in `content`', () => {
  // PiSessionReader pushes { name, type, content } and never sets `input`, so
  // reading only `input` made pi structurally unable to report an artifact.
  const { modifiedFiles, readFiles } = proto._extractFileChanges.call({}, [
    exchange({ tools: [
      { name: 'edit', type: 'toolCall', content: JSON.stringify({ file_path: 'src/a.ts' }) },
      { name: 'read', type: 'toolCall', content: JSON.stringify({ path: 'src/b.ts' }) },
      // A tool RESULT carries prose in the same field; it must not be parsed.
      { name: 'edit', type: 'toolResult', content: 'wrote 3 lines to somewhere' },
    ] }),
  ]);
  assert.deepEqual(modifiedFiles, ['src/a.ts']);
  assert.deepEqual(readFiles, ['src/b.ts']);
});

test('_extractFileChanges: a shell write counts as an artifact', () => {
  const { modifiedFiles } = proto._extractFileChanges.call({}, [
    exchange({ tools: [
      { name: 'Bash', input: { command: "cat > docs/guide.md <<'EOF'\nhello > world\nEOF" } },
      { name: 'Bash', input: { command: "sed -i '' 's|a|b|g' docs/related.md" } },
    ] }),
  ]);
  assert.deepEqual(modifiedFiles, ['docs/guide.md', 'docs/related.md']);
});

test('bashWriteTargets: records real writes', () => {
  assert.deepEqual(bashWriteTargets('cat > lib/a.js <<EOF\nx\nEOF'), ['lib/a.js']);
  assert.deepEqual(bashWriteTargets('echo hi >> notes/log.md'), ['notes/log.md']);
  assert.deepEqual(bashWriteTargets('generate | tee config/features.yaml'), ['config/features.yaml']);
  assert.deepEqual(bashWriteTargets("sed -i '' 's/a/b/' src/x.ts"), ['src/x.ts']);
});

test('bashWriteTargets: invents nothing from the shapes that used to fool it', () => {
  // Arrow functions and quoted comparison operators inside inline scripts.
  assert.deepEqual(bashWriteTargets("gsd-browser eval 'els.map(x => x.id)'"), []);
  assert.deepEqual(bashWriteTargets("awk 'length>80 { print }' f.md"), []);
  assert.deepEqual(bashWriteTargets('grep -n "fetcherRef.current(" src/h.ts'), []);
  // A heredoc BODY is prose — a commit message may contain anything.
  assert.deepEqual(bashWriteTargets("git commit -F - <<'EOF'\nfix: make a > b\nEOF"), []);
  // Throwaway locations are writes, but never artifacts.
  assert.deepEqual(bashWriteTargets('node x.mjs > /tmp/out.txt'), []);
  assert.deepEqual(bashWriteTargets('node x.mjs > /private/tmp/claude-1/sess/scratchpad/p.py'), []);
  assert.deepEqual(bashWriteTargets('cmd > /dev/null 2>&1'), []);
  // Redirections that are not file targets.
  assert.deepEqual(bashWriteTargets('cmd 2>&1 | head'), []);
  // Run-time-computed targets cannot be named.
  assert.deepEqual(bashWriteTargets('echo x > "$SP/out.json"'), []);
});

test('bashWriteTargets: rejects things that are arguments, not destinations', () => {
  // An interpreter path next to an unrelated redirect.
  assert.deepEqual(bashWriteTargets('echo "v: $(/bin/bash --version)" > /dev/null; /bin/bash -n bin/x'), []);
  // A sed script that survived as a bare word.
  assert.ok(!bashWriteTargets('sed -i s/a/b/g f.md').includes('s/a/b/g'));
  // Directories, git internals and command logs are writes, not artifacts.
  assert.deepEqual(bashWriteTargets('cp -r a b/'), []);
  assert.deepEqual(bashWriteTargets('gh pr view > .git/PR_BODY.md'), []);
  assert.deepEqual(bashWriteTargets('npm test > jest.log'), []);
  assert.deepEqual(bashWriteTargets('npm test > .logs/run.log'), []);
});

test('bashWriteTargets: nested command substitution does not unbalance the quote scan', () => {
  // `"$(wc -l < "$F")"` puts a quote inside a quote; before command
  // substitutions were blanked first, everything after it was scanned as bare
  // shell and leaked operands from later in the line.
  const cmd = 'printf "%s\\n" "$(wc -l < "$SB/hooklog")" >/dev/null 2>&1; /bin/bash bin/tool';
  assert.deepEqual(bashWriteTargets(cmd), []);
});
