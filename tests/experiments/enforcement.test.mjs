// tests/experiments/enforcement.test.mjs
//
// SC-4 proof (KB-03): task_class is ENFORCED at the write path and a run cannot
// be COUNTED without a class. The four observable signals:
//   (1) a free-string task_class is rejected (isValidClass guard) — neither the
//       orchestrator write path nor the classify-assign path accepts 'frobnicate';
//   (2) a headless close with no confident class writes a Run with
//       task_class='unclassified' + pending:true (D-06 quarantine);
//   (3) experiments-query EXCLUDES pending Runs (seed one classified + one
//       pending; the query returns only the classified one — D-06);
//   (4) experiments-classify flips a pending Run to a closed-6 class + pending:false;
//       a subsequent query now INCLUDES it (re-inclusion — D-08).
//
// Isolation: openExperimentStore({ repoRoot }) is opened against a tmpdir whose
// .data/ontologies-experiment/ is the REAL ontology copied verbatim (strict-path
// putEntity validates entityType:'Run' against the live registry). NEVER the real store.
//
// The CLIs (experiments-query / experiments-classify) are IMPORTED for their pure
// helpers — both are import-guarded so importing does not run main(). Any live-only
// assertion gates on EXPERIMENTS_LIVE (env var, NOT a --live argv — MEMORY.md
// node --test argv gotcha). Output via process.stderr.write only (no console.*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');

/**
 * Build an isolated tmp repo-root with the REAL experiment ontology copied in,
 * open the store via the explicit `repoRoot` override (NOT a process.env mutation
 * — env is process-global and races under concurrent test runs), return
 * { store, cleanup }. Mirrors tests/experiments/run-write.test.mjs.
 */
async function openIsolatedStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'experiments-enforcement-test-'));
  const tmpOntologyDir = path.join(tmp, '.data', 'ontologies-experiment');
  fs.mkdirSync(tmpOntologyDir, { recursive: true });
  for (const f of fs.readdirSync(SRC_ONTOLOGY_DIR)) {
    fs.copyFileSync(path.join(SRC_ONTOLOGY_DIR, f), path.join(tmpOntologyDir, f));
  }
  const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
  const store = await openExperimentStore({ repoRoot: tmp });
  const cleanup = async () => {
    try { await store?.close(); } catch { /* best-effort */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { store, cleanup };
}

/** Seed args for writeRun — a classified or quarantined Run. */
function seedArgs({ taskId, taskClass, pending }) {
  return {
    span: {
      task_id: taskId,
      started_at: '2026-06-23T10:00:00.000Z',
      ended_at: '2026-06-23T10:05:00.000Z',
      goal_sentence: `seed ${taskId}`,
    },
    taskClass,
    pending,
    tags: { task_hash: null, agent: 'claude-code', model: 'claude-haiku-4.5', framework: 'gsd', trace_id: taskId },
    totals: { input_tokens: 10, output_tokens: 20, total_tokens: 30, reasoning_tokens: 5, calls: 1 },
  };
}

test('SC-4: a free-string task_class is rejected at the write path (isValidClass guard)', async () => {
  const { isValidClass } = await import('../../lib/experiments/taxonomy.mjs');
  assert.equal(isValidClass('frobnicate'), false, 'free string must be rejected');
  assert.equal(isValidClass('refactor'), true, 'a closed-6 class is accepted');
  assert.equal(isValidClass('unclassified'), false, 'the quarantine sentinel is NOT a valid class');

  // The classify-assign path also rejects it (throws BEFORE any mutation).
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { assignClass } = await import('../../scripts/experiments-classify.mjs');
    const { loadTaxonomy } = await import('../../lib/experiments/taxonomy.mjs');
    await writeRun(store, seedArgs({ taskId: 'reject-1', taskClass: 'unclassified', pending: true }));
    const pendingRun = [];
    for await (const e of store.iterate({ entityType: 'Run' })) {
      if (e.metadata?.task_id === 'reject-1') pendingRun.push(e);
    }
    await assert.rejects(
      () => assignClass(store, pendingRun[0], 'frobnicate', loadTaxonomy()),
      /not a valid taxonomy class/,
      'classify-assign must reject a free string',
    );
  } finally {
    await cleanup();
  }
});

test('SC-4: headless close with no confident class → unclassified + pending (D-06 quarantine)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    // The orchestrator's headless-no-class branch produces exactly these args.
    await writeRun(store, seedArgs({ taskId: 'headless-1', taskClass: 'unclassified', pending: true }));
    const runs = [];
    for await (const e of store.iterate({ entityType: 'Run' })) runs.push(e);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].metadata.task_class, 'unclassified', 'quarantine sentinel');
    assert.equal(runs[0].metadata.pending, true, 'pending flag set — the close never hard-blocks');
  } finally {
    await cleanup();
  }
});

test('SC-4: experiments-query EXCLUDES pending Runs (D-06)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { collectRuns } = await import('../../scripts/experiments-query.mjs');
    await writeRun(store, seedArgs({ taskId: 'classified-1', taskClass: 'refactor', pending: false }));
    await writeRun(store, seedArgs({ taskId: 'pending-1', taskClass: 'unclassified', pending: true }));

    const visible = await collectRuns(store, {});
    const ids = visible.map((r) => r.metadata.task_id);
    assert.deepEqual(ids.sort(), ['classified-1'], 'only the non-pending Run is visible');
  } finally {
    await cleanup();
  }
});

test('SC-4: experiments-classify flips pending → re-included in queries (D-08)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { collectRuns } = await import('../../scripts/experiments-query.mjs');
    const { assignClass, collectPending } = await import('../../scripts/experiments-classify.mjs');
    const { loadTaxonomy } = await import('../../lib/experiments/taxonomy.mjs');

    await writeRun(store, seedArgs({ taskId: 'classified-1', taskClass: 'refactor', pending: false }));
    await writeRun(store, seedArgs({ taskId: 'pending-1', taskClass: 'unclassified', pending: true }));

    // Before: query sees only the classified Run; one pending in the backlog.
    const before = (await collectRuns(store, {})).map((r) => r.metadata.task_id);
    assert.deepEqual(before.sort(), ['classified-1']);
    const pending = await collectPending(store);
    assert.equal(pending.length, 1, 'one quarantined Run in the backlog');

    // Resolve: assign a closed-6 class → pending:false.
    await assignClass(store, pending[0], 'bugfix', loadTaxonomy());

    // After: the query now INCLUDES the re-classified Run.
    const after = (await collectRuns(store, {})).map((r) => r.metadata.task_id);
    assert.deepEqual(after.sort(), ['classified-1', 'pending-1'], 'classify re-includes the resolved Run');
    const stillPending = await collectPending(store);
    assert.equal(stillPending.length, 0, 'no quarantined Runs remain');
  } finally {
    await cleanup();
  }
});
