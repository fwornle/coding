// tests/experiments/run-write.test.mjs
//
// SC-2 proof (KB-02): a span close materializes a queryable Run entity carrying
// ALL 8 tags (D-13), plus a basic Outcome stub (token totals + closedState) and
// a Run--produces-->Outcome relation (D-12). The write is IDEMPOTENT keyed on
// metadata.task_id (NOT the km-core entity id — task_id is not a valid UUIDv7,
// RESEARCH Pitfall 1 / D-14): re-running writeRun for the same task_id UPDATES
// the same Run node, never duplicates.
//
// Isolation: openExperimentStore({ repoRoot }) is opened against a tmpdir whose
// .data/experiments/leveldb is a throwaway store and whose
// .data/ontologies-experiment/ is the REAL ontology copied verbatim (so the
// strict-path putEntity validates entityType:'Run' against the live registry —
// KB-01 enforcement preserved). NEVER the real store.
//
// Output via process.stderr.write only (no console.* — no-console-log). Any
// live-only assertion gates on EXPERIMENTS_LIVE (env var, NOT a `--live` argv —
// MEMORY.md node --test argv gotcha).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');

const EIGHT_TAGS = [
  'task_hash', 'task_class', 'agent', 'model',
  'framework', 'spec_level', 'snapshot_id', 'trace_id',
];

/**
 * Build an isolated tmp repo-root with the REAL experiment ontology copied in,
 * open the store via the explicit `repoRoot` override (NOT a process.env mutation
 * — env is process-global and races under concurrent test runs), and return
 * { store, cleanup }. Mirrors tests/experiments/ontology.test.mjs.
 */
async function openIsolatedStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'experiments-run-write-test-'));
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

/** Collect every Outcome currently in the store. */
async function collectOutcomes(store) {
  const out = [];
  for await (const e of store.iterate({ entityType: 'Outcome' })) out.push(e);
  return out;
}

/** A representative span + write args (the close orchestrator's call shape). */
function sampleArgs(overrides = {}) {
  const span = {
    task_id: 't1',
    started_at: '2026-06-22T05:55:15.270Z',
    ended_at: '2026-06-22T05:55:30.164Z',
    goal_sentence: 'migrate the legacy store',
    ...(overrides.span ?? {}),
  };
  return {
    span,
    taskClass: overrides.taskClass ?? 'migration',
    pending: overrides.pending ?? false,
    tags: overrides.tags ?? {
      task_hash: 'deadbeef',
      agent: 'claude-code',
      model: 'claude-haiku-4.5',
      framework: 'gsd',
      trace_id: 't1',
    },
    totals: overrides.totals ?? {
      input_tokens: 100,
      output_tokens: 200,
      total_tokens: 300,
      reasoning_tokens: 50,
      calls: 4,
    },
  };
}

test('SC-2: first writeRun materializes a Run with ALL 8 tags (D-13)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const runId = await writeRun(store, sampleArgs());
    assert.ok(runId, 'writeRun must return the Run id');

    const runs = await collectRuns(store);
    assert.equal(runs.length, 1, 'exactly one Run after the first write');
    const run = runs[0];
    assert.equal(run.metadata.task_id, 't1', 'task_id stored in metadata (idempotency key)');

    // All 8 tags ALWAYS present (D-13).
    for (const tag of EIGHT_TAGS) {
      assert.ok(tag in run.metadata, `tag '${tag}' must be present in metadata`);
    }
    assert.equal(run.metadata.task_class, 'migration', 'task_class sourced from taskClass arg');
    assert.equal(run.metadata.agent, 'claude-code');
    assert.equal(run.metadata.model, 'claude-haiku-4.5');
    // spec_level + snapshot_id explicitly null (deferred — D-13).
    assert.equal(run.metadata.spec_level, null, 'spec_level explicitly null (D-13)');
    assert.equal(run.metadata.snapshot_id, null, 'snapshot_id explicitly null (D-13)');
    assert.equal(run.metadata.pending, false, 'pending false on a classified close');
  } finally {
    await cleanup();
  }
});

test('SC-2: the Run id is a minted UUIDv7, NOT span.task_id (Pitfall 1)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const runId = await writeRun(store, sampleArgs());
    assert.notEqual(runId, 't1', 'entity id must be minted, never the raw task_id');
    // UUIDv7 shape: 8-4-4-4-12 hex with version nibble '7' at position 14.
    assert.match(
      String(runId),
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'id must be a UUIDv7 (mintEntityId), not the task_id string',
    );
  } finally {
    await cleanup();
  }
});

test('SC-2: re-writing the same task_id UPDATES one node — idempotent (D-14)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const firstId = await writeRun(store, sampleArgs());
    // Re-close: same task_id, fresher totals (self-heal recompute).
    const secondId = await writeRun(store, sampleArgs({
      totals: { input_tokens: 150, output_tokens: 250, total_tokens: 400, reasoning_tokens: 60, calls: 5 },
    }));

    assert.equal(secondId, firstId, 're-close must reuse the same Run id (no new mint)');
    const runs = await collectRuns(store);
    assert.equal(runs.length, 1, 'exactly ONE Run after two writes for the same task_id (no duplicate)');
    // The Outcome stub reflects the recomputed totals.
    const outcomes = await collectOutcomes(store);
    assert.equal(outcomes.length, 1, 'exactly one Outcome after re-close');
    assert.equal(outcomes[0].metadata.totalTokens, 400, 'Outcome totals updated on re-close (self-heal)');
  } finally {
    await cleanup();
  }
});

test('SC-2: writeRun writes an Outcome stub + a produces relation (D-12)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const runId = await writeRun(store, sampleArgs());

    const outcomes = await collectOutcomes(store);
    assert.equal(outcomes.length, 1, 'exactly one Outcome stub written');
    const outcome = outcomes[0];
    assert.equal(outcome.metadata.totalTokens, 300);
    assert.equal(outcome.metadata.inputTokens, 100);
    assert.equal(outcome.metadata.outputTokens, 200);
    assert.equal(outcome.metadata.reasoningTokens, 50);
    assert.equal(outcome.metadata.closedState, 'closed', 'classified close → closedState closed');

    // A produces relation Run --> Outcome must exist.
    const rels = await store.findRelations({ type: 'produces', from: runId });
    assert.equal(rels.length, 1, 'exactly one produces relation from the Run');
    assert.equal(rels[0].to, outcome.id, 'produces relation targets the Outcome');
  } finally {
    await cleanup();
  }
});

test('SC-2: pending close quarantines — pending true + closedState quarantined (D-06)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs({ pending: true, taskClass: 'unclassified' }));

    const runs = await collectRuns(store);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].metadata.pending, true, 'pending flag true on a quarantined close');
    assert.equal(runs[0].metadata.task_class, 'unclassified', 'unclassified quarantine sentinel');

    const outcomes = await collectOutcomes(store);
    assert.equal(outcomes[0].metadata.closedState, 'quarantined', 'pending → closedState quarantined');
  } finally {
    await cleanup();
  }
});
