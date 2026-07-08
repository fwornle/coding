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

/** Collect every Route currently in the store. */
async function collectRoutes(store) {
  const out = [];
  for await (const e of store.iterate({ entityType: 'Route' })) out.push(e);
  return out;
}

/** The six route-quality heuristic keys (D-09/ROUTE-02), in canonical order. */
const SIX_HEURISTICS = [
  'loop_count', 'edit_revert_count', 'redundant_read_count',
  'abandoned_tool_count', 'total_step_count', 'wallclock_per_step',
];

/** A representative non-null heuristics block (the close orchestrator's shape). */
function sampleHeuristics(overrides = {}) {
  return {
    loop_count: 1,
    edit_revert_count: 0,
    redundant_read_count: 2,
    abandoned_tool_count: 0,
    total_step_count: 7,
    wallclock_per_step: 1234.5,
    ...overrides,
  };
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
    ...('heuristics' in overrides ? { heuristics: overrides.heuristics } : {}),
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
    // WR-01 regression: a re-close must NOT accumulate a duplicate produces edge.
    // The stable key (`${runId}:produces:${outcomeId}`) makes the second addRelation
    // a silent key-collision no-op — exactly ONE produces edge survives N re-closes.
    const rels = await store.findRelations({ type: 'produces', from: secondId });
    assert.equal(rels.length, 1, 're-close must NOT add a duplicate produces edge (WR-01)');
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

// ── ROUTE-02 / D-09: six flat Run metrics + one idempotent Route node ──────────

test('ROUTE-02: writeRun writes the six heuristics FLAT on the Run.metadata (D-09)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs({ heuristics: sampleHeuristics() }));

    const runs = await collectRuns(store);
    assert.equal(runs.length, 1, 'exactly one Run');
    const m = runs[0].metadata;
    for (const k of SIX_HEURISTICS) {
      assert.ok(k in m, `heuristic '${k}' must be flat on Run.metadata`);
    }
    assert.equal(m.loop_count, 1);
    assert.equal(m.edit_revert_count, 0, '0 is a genuine measured value (NOT null)');
    assert.equal(m.redundant_read_count, 2);
    assert.equal(m.total_step_count, 7);
    assert.equal(m.wallclock_per_step, 1234.5);
  } finally {
    await cleanup();
  }
});

test('D-09: exactly ONE Route node per Run carrying the six heuristics + goal_sentence', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const runId = await writeRun(store, sampleArgs({ heuristics: sampleHeuristics() }));

    const routes = await collectRoutes(store);
    assert.equal(routes.length, 1, 'exactly one Route node after the first write');
    const route = routes[0];
    assert.equal(route.entityType, 'Route', 'entityType is Route');
    assert.equal(route.name, 't1-route', 'Route name is `${task_id}-route`');
    assert.equal(route.metadata.run_task_id, 't1', 'Route back-links the Run via run_task_id');
    assert.equal(route.metadata.goal_sentence, 'migrate the legacy store', 'goal_sentence on the Route');
    assert.equal(route.description, 'migrate the legacy store', 'description = goal_sentence');
    for (const k of SIX_HEURISTICS) {
      assert.ok(k in route.metadata, `heuristic '${k}' must be on the Route metadata`);
    }
    assert.equal(route.metadata.total_step_count, 7);

    // The Route id is a minted UUIDv7, NEVER span.task_id (Pitfall 1).
    assert.notEqual(route.id, 't1', 'Route id must be minted, never task_id');
    assert.match(
      String(route.id),
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'Route id must be a UUIDv7 (mintEntityId)',
    );

    // A tookRoute edge Run --> Route must exist.
    const rels = await store.findRelations({ type: 'tookRoute', from: runId });
    assert.equal(rels.length, 1, 'exactly one tookRoute relation from the Run');
    assert.equal(rels[0].to, route.id, 'tookRoute targets the Route node');
  } finally {
    await cleanup();
  }
});

test('D-09: re-close UPDATES the same Route — no duplicate, ONE tookRoute edge (Pitfall 2)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const firstRunId = await writeRun(store, sampleArgs({ heuristics: sampleHeuristics() }));
    const firstRoutes = await collectRoutes(store);
    assert.equal(firstRoutes.length, 1);
    const firstRouteId = firstRoutes[0].id;

    // Re-close with refreshed heuristics (self-heal recompute).
    const secondRunId = await writeRun(store, sampleArgs({
      heuristics: sampleHeuristics({ loop_count: 3, total_step_count: 9 }),
    }));
    assert.equal(secondRunId, firstRunId, 're-close reuses the same Run id');

    const routes = await collectRoutes(store);
    assert.equal(routes.length, 1, 'exactly ONE Route after two writes (no duplicate)');
    assert.equal(routes[0].id, firstRouteId, 're-close reuses the SAME Route id');
    assert.equal(routes[0].metadata.loop_count, 3, 'Route heuristics updated on re-close');
    assert.equal(routes[0].metadata.total_step_count, 9);

    // Stable-keyed tookRoute edge dedupes — exactly ONE survives N re-closes (Pitfall 2).
    const rels = await store.findRelations({ type: 'tookRoute', from: secondRunId });
    assert.equal(rels.length, 1, 're-close must NOT add a parallel tookRoute edge (Pitfall 2)');
  } finally {
    await cleanup();
  }
});

test('D-02: null heuristics stay null on BOTH the Run and the Route (never 0)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { ALL_NULL_HEURISTICS } = await import('../../lib/experiments/route-heuristics.mjs');
    await writeRun(store, sampleArgs({ heuristics: ALL_NULL_HEURISTICS }));

    const runs = await collectRuns(store);
    const routes = await collectRoutes(store);
    assert.equal(routes.length, 1);
    for (const k of SIX_HEURISTICS) {
      assert.equal(runs[0].metadata[k], null, `Run heuristic '${k}' must be null (D-02 — not 0)`);
      assert.equal(routes[0].metadata[k], null, `Route heuristic '${k}' must be null (D-02 — not 0)`);
    }
  } finally {
    await cleanup();
  }
});

test('D-02: writeRun WITHOUT a heuristics arg defaults all six to null (not 0)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs()); // no heuristics key at all

    const runs = await collectRuns(store);
    const routes = await collectRoutes(store);
    assert.equal(routes.length, 1, 'a Route is still written even with no heuristics arg');
    for (const k of SIX_HEURISTICS) {
      assert.equal(runs[0].metadata[k], null, `missing heuristics ⇒ Run '${k}' null (D-02)`);
      assert.equal(routes[0].metadata[k], null, `missing heuristics ⇒ Route '${k}' null (D-02)`);
    }
  } finally {
    await cleanup();
  }
});

// ── ATTR-02 / D-05 / D-06: canonical_model + canonical_agent + background_models[] ──
// Plan 02 Task 2 persists the ONCE-computed canonical attribution on Run.metadata
// so all three dashboard surfaces read it without recomputing. Empty canonical is
// persisted as null (NEVER a dominant-by-count fallback — the finding-B fix).

test('ATTR-02: writeRun persists explicit canonical_model/agent + background_models[]', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const backgroundModels = [
      { model: 'haiku', process: 'consolidator-mentions', total_tokens: 9999 },
    ];
    await writeRun(store, sampleArgs({
      tags: {
        task_hash: 'deadbeef',
        agent: 'claude-code',
        model: 'claude-haiku-4.5',
        framework: 'gsd',
        trace_id: 't1',
        canonical_model: 'claude-opus-4-8',
        canonical_agent: 'claude',
        background_models: backgroundModels,
      },
    }));

    const runs = await collectRuns(store);
    assert.equal(runs.length, 1);
    const m = runs[0].metadata;
    assert.equal(m.canonical_model, 'claude-opus-4-8', 'canonical_model persisted verbatim');
    assert.equal(m.canonical_agent, 'claude', 'canonical_agent persisted verbatim');
    assert.deepEqual(m.background_models, backgroundModels, 'background_models[] persisted verbatim');
  } finally {
    await cleanup();
  }
});

test('D-05: absent canonical tags persist as null + [] (NEVER a dominant fallback)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs()); // sampleArgs tags carry NO canonical_* keys

    const runs = await collectRuns(store);
    const m = runs[0].metadata;
    assert.ok('canonical_model' in m, 'canonical_model key always present');
    assert.ok('canonical_agent' in m, 'canonical_agent key always present');
    assert.ok('background_models' in m, 'background_models key always present');
    assert.equal(m.canonical_model, null, 'empty canonical persists as null (D-05) — never byAgentModel[0]');
    assert.equal(m.canonical_agent, null, 'empty canonical_agent persists as null (D-05)');
    assert.deepEqual(m.background_models, [], 'no background ⇒ empty array (D-02 — nothing dropped)');
    // Defensive: the dominant-by-count model tag must NOT leak in as the canonical.
    assert.notEqual(m.canonical_model, m.model, 'canonical is NOT coerced to the model tag');
  } finally {
    await cleanup();
  }
});

test('D-06: re-close preserves the canonical fields (idempotent update)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const tags = {
      task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-haiku-4.5',
      framework: 'gsd', trace_id: 't1',
      canonical_model: 'claude-opus-4-8', canonical_agent: 'claude',
      background_models: [{ model: 'haiku', process: 'consolidator-mentions', total_tokens: 9999 }],
    };
    const firstId = await writeRun(store, sampleArgs({ tags }));
    const secondId = await writeRun(store, sampleArgs({ tags }));
    assert.equal(secondId, firstId, 're-close reuses the same Run id');

    const runs = await collectRuns(store);
    assert.equal(runs.length, 1, 'still exactly one Run after re-close');
    assert.equal(runs[0].metadata.canonical_model, 'claude-opus-4-8', 're-close preserves canonical_model');
    assert.equal(runs[0].metadata.canonical_agent, 'claude', 're-close preserves canonical_agent');
  } finally {
    await cleanup();
  }
});

// ── R2/R3/R4 (Phase 78-01): variant + repeat + terminal_state + skip_reason ──
// D-03/D-04/D-08/D-10 make a single experiment's cells distinguishable (variant/
// repeat) and record every terminal outcome (complete|timeout|abort) + probe-skip
// reason. All four are null-preserved Run.metadata tags surfaced by readRuns' spread.

const R2R3R4_TAGS = ['variant', 'repeat', 'terminal_state', 'skip_reason'];

test('R2/R3/R4: writeRun persists variant/repeat/terminal_state/skip_reason on Run.metadata', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs({
      tags: {
        task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-haiku-4.5',
        framework: 'gsd', trace_id: 't1',
        variant: 'claude-sonnet', repeat: 2, terminal_state: 'timeout', skip_reason: null,
      },
    }));

    const runs = await collectRuns(store);
    assert.equal(runs.length, 1);
    const m = runs[0].metadata;
    for (const k of R2R3R4_TAGS) {
      assert.ok(k in m, `tag '${k}' must be present in metadata`);
    }
    assert.equal(m.variant, 'claude-sonnet', 'D-10 variant persisted verbatim');
    assert.equal(m.repeat, 2, 'D-10 repeat persisted verbatim (a genuine index, incl. 0)');
    assert.equal(m.terminal_state, 'timeout', 'D-04 terminal_state persisted verbatim');
    assert.equal(m.skip_reason, null, 'D-08 explicit null skip_reason preserved (never coerced/absent)');
  } finally {
    await cleanup();
  }
});

test('R2/R3/R4: absent variant/repeat/terminal_state/skip_reason persist as null (never absent)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs()); // sampleArgs tags carry NONE of the four

    const m = (await collectRuns(store))[0].metadata;
    for (const k of R2R3R4_TAGS) {
      assert.ok(k in m, `tag '${k}' key always present`);
      assert.equal(m[k], null, `tag '${k}' null-preserved when no source (never coerced)`);
    }
  } finally {
    await cleanup();
  }
});

test('R2/R3/R4: repeat index 0 is preserved as 0, not coerced to null', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs({
      tags: {
        task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-haiku-4.5',
        framework: 'gsd', trace_id: 't1', repeat: 0,
      },
    }));
    const m = (await collectRuns(store))[0].metadata;
    assert.equal(m.repeat, 0, 'repeat 0 is a genuine index (NOT null — ?? null keeps 0)');
  } finally {
    await cleanup();
  }
});

test('R2/R3/R4: readRuns surfaces the four fields via the ...meta spread (no query.mjs change)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { readRuns } = await import('../../lib/experiments/query.mjs');
    await writeRun(store, sampleArgs({
      tags: {
        task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-haiku-4.5',
        framework: 'gsd', trace_id: 't1',
        variant: 'claude-opus', repeat: 3, terminal_state: 'abort',
        skip_reason: 'copilot-headless-unsupported',
      },
    }));

    const rows = await readRuns(store);
    assert.equal(rows.length, 1, 'one Run surfaced');
    assert.equal(rows[0].variant, 'claude-opus', 'variant flows through ...meta spread');
    assert.equal(rows[0].repeat, 3, 'repeat flows through ...meta spread');
    assert.equal(rows[0].terminal_state, 'abort', 'terminal_state flows through ...meta spread');
    assert.equal(rows[0].skip_reason, 'copilot-headless-unsupported', 'skip_reason flows through ...meta spread');
  } finally {
    await cleanup();
  }
});

// ── D-05/D-07 (Phase 85-01): rerun_of + base_variant null-preserved Run metadata ──
// A re-run's Run carries rerun_of=<original run_id>; a model/agent-overridden cell carries
// base_variant=<original variant name>. Both follow the null-not-zero house rule EXACTLY:
// a first (non-rerun, non-override) Run surfaces null — never '', never undefined, never absent.

test('D-05/D-07: writeRun stamps rerun_of + base_variant from tags (null-preserved)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs({
      tags: {
        task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-opus-4-8',
        framework: 'gsd', trace_id: 't1',
        rerun_of: 'exp-orig--claude-sonnet--r0', base_variant: 'A',
      },
    }));

    const m = (await collectRuns(store))[0].metadata;
    assert.ok('rerun_of' in m, 'rerun_of key always present');
    assert.ok('base_variant' in m, 'base_variant key always present');
    assert.equal(m.rerun_of, 'exp-orig--claude-sonnet--r0', 'rerun_of persisted verbatim');
    assert.equal(m.base_variant, 'A', 'base_variant persisted verbatim (D-07 original variant name)');
  } finally {
    await cleanup();
  }
});

test('D-05/D-07: absent rerun_of + base_variant persist as null (never absent, never "")', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    await writeRun(store, sampleArgs()); // sampleArgs tags carry NEITHER key

    const m = (await collectRuns(store))[0].metadata;
    assert.ok('rerun_of' in m, 'rerun_of key always present');
    assert.ok('base_variant' in m, 'base_variant key always present');
    assert.equal(m.rerun_of, null, 'first run → rerun_of null (never "" — the null-not-zero rule)');
    assert.notEqual(m.rerun_of, '', 'rerun_of never coerced to empty string');
    assert.equal(m.base_variant, null, 'no override → base_variant null');
    assert.notEqual(m.base_variant, '', 'base_variant never coerced to empty string');
  } finally {
    await cleanup();
  }
});

test('D-05/D-07: readRuns surfaces rerun_of + base_variant via the ...meta spread', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { readRuns } = await import('../../lib/experiments/query.mjs');
    await writeRun(store, sampleArgs({
      tags: {
        task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-opus-4-8',
        framework: 'gsd', trace_id: 't1',
        rerun_of: 'exp-orig--r0', base_variant: 'A',
      },
    }));

    const rows = await readRuns(store);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rerun_of, 'exp-orig--r0', 'rerun_of flows through ...meta spread');
    assert.equal(rows[0].base_variant, 'A', 'base_variant flows through ...meta spread');
  } finally {
    await cleanup();
  }
});

test('ATTR-02: readRuns surfaces the canonical fields via the ...meta spread (no query.mjs change)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { readRuns } = await import('../../lib/experiments/query.mjs');
    await writeRun(store, sampleArgs({
      tags: {
        task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-haiku-4.5',
        framework: 'gsd', trace_id: 't1',
        canonical_model: 'claude-opus-4-8', canonical_agent: 'claude',
        background_models: [{ model: 'haiku', process: 'consolidator-mentions', total_tokens: 9999 }],
      },
    }));

    const rows = await readRuns(store);
    assert.equal(rows.length, 1, 'one Run surfaced');
    assert.equal(rows[0].canonical_model, 'claude-opus-4-8', 'canonical_model flows through ...meta spread');
    assert.equal(rows[0].canonical_agent, 'claude', 'canonical_agent flows through ...meta spread');
    assert.deepEqual(
      rows[0].background_models,
      [{ model: 'haiku', process: 'consolidator-mentions', total_tokens: 9999 }],
      'background_models flows through ...meta spread',
    );
  } finally {
    await cleanup();
  }
});
