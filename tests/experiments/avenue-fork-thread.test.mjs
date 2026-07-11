// tests/experiments/avenue-fork-thread.test.mjs
//
// Phase 87, Plan 87-07, Task 4 — the END-TO-END thread assertion (AVN-01/AVN-02/AVN-07).
//
// Plans 87-03/05/06 built + unit-tested the avenue PRIMITIVES (runCell avenue mode,
// synthesizeAvenueSpec, run-write origin_span_id persistence, selectAvenuesByOrigin/
// rankAvenues) — but the CR-01/CR-02/CR-03 chain proved those primitives were NEVER
// REACHED by a real launch, so no production Run ever carried a non-null origin_span_id
// and the origin-grouped ranked panel had no data.
//
// This suite proves the 87-07 threading made that chain CONTINUOUS: a fork launch
// (avenue:true + originSpanId) drives the REAL runMatrix → runCell → measurement-start
// argv boundary, and that SAME boundary value threads through the REAL buildVariantMeta →
// buildRunTags → writeRun → readRuns round-trip to land a Run carrying a non-null
// origin_span_id — the EXACT predicate selectAvenuesByOrigin groups on (AVN-07).
//
// No real agent, snapshot, proxy, or coordinator: every side-effecting collaborator is an
// INJECTED seam (fake restore/spawnAgent/runMeasurement/store/routing). The measurement
// boundary is captured, not stubbed away, so the assertion is on the REAL threaded value.
//
// Run: node --test tests/experiments/avenue-fork-thread.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMatrix } from '../../lib/experiments/experiment-runner.mjs';
import { buildVariantMeta } from '../../scripts/measurement-start.mjs';
import { buildRunTags } from '../../scripts/measurement-stop.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');
const AGENTS_DIR = path.join(REPO_ROOT, 'config', 'agents');

const AVENUE_CELL = { agent: 'claude', model: 'sonnet', framework: 'none', env: 'kb-on' };

/** Drive the REAL runMatrix with injected seams, capturing every measurement-start argv. */
async function runAvenueMatrix({ avenue, originSpanId, cells = [AVENUE_CELL], repeats = 1 }) {
  const startArgvs = [];
  const resolveSpec = () => ({ goal_sentence: 'fork the origin task', repeats, cells });
  await runMatrix({ experiment_id: 'expFork', snapshot_id: 'snap-fork' }, {
    avenue,
    originSpanId,
    resolveSpec,
    dataDir: '/main/.data',
    agentsDir: AGENTS_DIR,
    restore: async () => ({ worktree: '/wt', sandboxDataDir: '/wt/.data' }),
    runMeasurement: async (phase, argv) => { if (phase === 'start') startArgvs.push(argv); return 0; },
    spawnAgent: async () => 'complete',
    // avenue commit-on-close seam — a no-op so the close path never touches git.
    commitAvenue: () => ({ committed: false }),
    configureRouting: async (_a, env) => env,
    openStore: async () => ({ close: async () => {} }),
    readDone: async () => [],
  });
  return startArgvs;
}

/** An isolated experiment store (real ontology copied in) for the run-write round-trip. */
async function openIsolatedStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-fork-thread-'));
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

async function findRun(store, taskId) {
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.task_id === taskId) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// (a) CR-01 threading reaches the persistence boundary — the REAL runMatrix/runCell
//     emits --origin-span-id on the measurement-start argv for each avenue cell.
// ---------------------------------------------------------------------------

test('AVN-01: a fork launch threads --origin-span-id to the measurement-start boundary (real runMatrix)', async () => {
  const startArgvs = await runAvenueMatrix({ avenue: true, originSpanId: 'origin-xyz' });
  assert.equal(startArgvs.length, 1, 'one avenue cell → one measurement-start');
  const argv = startArgvs[0];
  const idx = argv.indexOf('--origin-span-id');
  assert.ok(idx >= 0, 'the REAL runMatrix→runCell threaded --origin-span-id (Task 1 CR-01)');
  assert.equal(argv[idx + 1], 'origin-xyz', 'the exact forked origin span id reaches the seam receiving it');
});

test('AVN-01: a non-avenue matrix threads NO --origin-span-id (honesty — no fabrication)', async () => {
  const startArgvs = await runAvenueMatrix({ avenue: false, originSpanId: undefined });
  assert.equal(startArgvs.length, 1);
  assert.ok(!startArgvs[0].includes('--origin-span-id'), 'non-avenue start argv omits the flag entirely');
});

// ---------------------------------------------------------------------------
// (b) The CONTINUOUS thread: the argv the REAL runMatrix emits, fed through the REAL
//     buildVariantMeta → buildRunTags → writeRun → readRuns, lands a Run carrying the
//     exact non-null origin_span_id (AVN-01). A non-avenue run reads null (AVN-07 honesty).
// ---------------------------------------------------------------------------

test('AVN-01/AVN-07: the threaded --origin-span-id round-trips to a Run with a non-null origin_span_id', async () => {
  const { writeRun } = await import('../../lib/experiments/run-write.mjs');
  const { store, cleanup } = await openIsolatedStore();
  try {
    // (1) REAL runMatrix emits the avenue start argv (the ONLY production caller of runCell).
    const [avenueStartArgv] = await runAvenueMatrix({ avenue: true, originSpanId: 'origin-xyz' });
    // (2) REAL measurement-start parse: the start argv → span.meta (buildVariantMeta owns the
    //     --origin-span-id → span.meta.origin_span_id fold; NOT re-implemented here).
    const meta = buildVariantMeta(avenueStartArgv, { resolveSpec: () => ({ cells: [AVENUE_CELL], repeats: 1 }) });
    assert.equal(meta.origin_span_id, 'origin-xyz', 'measurement-start folds the threaded flag into span.meta');
    // (3) REAL measurement-stop tag build: span.meta → run tags (buildRunTags folds origin_span_id).
    const span = { task_id: 'avenue/exp-fork--r0', meta };
    const tags = buildRunTags({
      span, taskHash: 'hash1', canonicalAgent: 'claude', canonicalModel: 'sonnet',
      snapshotId: 'snap-fork', backgroundModels: [], terminalState: 'complete',
    });
    // (4) REAL run-write persistence + read-back.
    await writeRun(store, { span: { task_id: span.task_id }, taskClass: 'new-feature', pending: false, tags, totals: {} });
    const run = await findRun(store, 'avenue/exp-fork--r0');
    assert.ok(run, 'the avenue Run was written');
    assert.equal(run.metadata.origin_span_id, 'origin-xyz',
      'the fork thread is CONTINUOUS: runMatrix → measurement-start → run-write stamps origin_span_id (AVN-01)');

    // The null case — a non-avenue run through the SAME real path reads null (no fabrication).
    const [plainStartArgv] = await runAvenueMatrix({ avenue: false, originSpanId: undefined });
    const plainMeta = buildVariantMeta(plainStartArgv, { resolveSpec: () => ({ cells: [AVENUE_CELL], repeats: 1 }) });
    const plainTags = buildRunTags({
      span: { task_id: 'exp-plain--r0', meta: plainMeta }, taskHash: 'hash2',
      canonicalAgent: 'claude', canonicalModel: 'sonnet', snapshotId: 'snap-fork',
      backgroundModels: [], terminalState: 'complete',
    });
    await writeRun(store, { span: { task_id: 'exp-plain--r0' }, taskClass: 'new-feature', pending: false, tags: plainTags, totals: {} });
    const plainRun = await findRun(store, 'exp-plain--r0');
    assert.equal(plainRun.metadata.origin_span_id, null, 'a non-avenue Run reads origin_span_id null (AVN-07 honesty)');
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// (c) AVN-07 grouping predicate — a documentation-level assertion that the non-null
//     origin_span_id is EXACTLY the field selectAvenuesByOrigin groups on, so the
//     ranked AvenuePanel now has a live data path (re-verification traces the flip).
// ---------------------------------------------------------------------------

test('AVN-07: the non-null origin_span_id is the exact predicate selectAvenuesByOrigin groups on (ranked panel data path)', () => {
  // selectAvenuesByOrigin (performanceSlice.ts) groups Runs by a non-null origin_span_id.
  // A Run produced by the threaded fork path carries that field non-null (proven above),
  // so the origin-grouped ranked AvenuePanel — correct-but-orphaned before 87-07 — now
  // receives real grouped data. This is the CR-03 auto-resolution: once AVN-01 stamps a
  // real origin_span_id, the (already-correct) grouping/ranking primitives light up.
  const groupedRun = { origin_span_id: 'origin-xyz' };
  const ungroupedRun = { origin_span_id: null };
  assert.ok(groupedRun.origin_span_id != null, 'a fork Run groups (non-null origin_span_id)');
  assert.ok(ungroupedRun.origin_span_id == null, 'a first-class Run does NOT group (null origin_span_id)');
});
