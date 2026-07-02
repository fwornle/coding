// tests/repro/run-link.test.mjs
//
// Phase 67, Plan 67-07 (Wave 4) — REPRO-01/02 Run↔Snapshot linkage proof. The
// close orchestrator (measurement-stop.mjs) threads the RunSnapshot id through
// writeRun's tags so the materialized Run entity carries `snapshot_id` — the
// reserved field at run-write.mjs:108 that Phase 68 hardcoded null. This asserts
// the round-trip: tags.snapshot_id → Run.metadata.snapshot_id, and that its
// absence stays null (backward compatible with every pre-67 Run).
//
// Isolation: openExperimentStore({ repoRoot }) opened against a tmpdir whose
// .data/ontologies-experiment/ is the REAL ontology copied verbatim (strict-path
// putEntity validates entityType:'Run') and whose .data/experiments/leveldb is a
// throwaway store — NEVER the real store. Mirrors tests/experiments/run-write.test.mjs.
//
// Output via process.stderr.write only (no console.* — no-console-log). Any
// live-only assertion would gate on an ENV VAR, never a `--live` argv (MEMORY.md
// node --test argv gotcha) — this suite has no live path.
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
 * — env is process-global and races under concurrent test runs), and return
 * { store, cleanup }. Mirrors tests/experiments/run-write.test.mjs::openIsolatedStore.
 */
async function openIsolatedStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-run-link-test-'));
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

/** Collect every Run currently in the store (drains the async iterator). */
async function collectRuns(store) {
  const runs = [];
  for await (const e of store.iterate({ entityType: 'Run' })) runs.push(e);
  return runs;
}

/** A representative close-orchestrator writeRun call shape. */
function sampleArgs(overrides = {}) {
  const taskId = overrides.taskId ?? 'repro-link-1';
  const span = {
    task_id: taskId,
    started_at: '2026-07-02T05:55:15.270Z',
    ended_at: '2026-07-02T05:55:30.164Z',
    goal_sentence: 'record then replay',
  };
  return {
    span,
    taskClass: 'migration',
    pending: false,
    tags: overrides.tags ?? { trace_id: taskId },
    totals: { input_tokens: 1, output_tokens: 2, total_tokens: 3, reasoning_tokens: 0, calls: 1 },
  };
}

test('REPRO-01: writeRun persists tags.snapshot_id on the Run (run-write.mjs:108)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs({
      taskId: 'repro-link-1',
      tags: { trace_id: 'repro-link-1', snapshot_id: 'snap-abc' },
    }));

    const runs = await collectRuns(store);
    assert.equal(runs.length, 1, 'exactly one Run after the write');
    assert.equal(
      runs[0].metadata.snapshot_id,
      'snap-abc',
      'snapshot_id round-trips through writeRun tags (no longer hardcoded null)',
    );
  } finally {
    await cleanup();
  }
});

test('REPRO-01: writeRun WITHOUT snapshot_id yields null (backward compatible)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs({
      taskId: 'repro-link-2',
      tags: { trace_id: 'repro-link-2' }, // no snapshot_id key
    }));

    const runs = await collectRuns(store);
    assert.equal(runs.length, 1);
    assert.ok('snapshot_id' in runs[0].metadata, 'snapshot_id key always present (D-13)');
    assert.equal(
      runs[0].metadata.snapshot_id,
      null,
      'absent snapshot_id persists as null — every pre-67 Run stays valid',
    );
  } finally {
    await cleanup();
  }
});
