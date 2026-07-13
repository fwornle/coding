// tests/experiments/avenue-spec.test.mjs
//
// Phase 87, Plan 87-03, Task 1 (AVN-01) — synthesizeAvenueSpec proof.
//
// A completed span (the "origin Run") is forked into an avenue experiment-spec so
// avenues start byte-identical to the origin (D-08): the origin prompt becomes the
// spec goal_sentence, the origin snapshot id becomes the spec snapshot_id, and each
// chosen variant becomes exactly one makeCell-shaped cell (agent×model×framework×env).
//
// Covers the four Task-1 behaviors:
//   1. synthesizeAvenueSpec returns a spec whose goal_sentence === origin prompt,
//      snapshot_id === origin snapshot_id, one cell per chosen variant.
//   2. The synthesized spec passes resolveExperimentSpec/validateCells (mastra cell
//      legal; env kb-on/kb-off preserved).
//   3. The synthesized spec is SCRIPTABLE — serializes to YAML a power user could
//      hand to `experiment-run.mjs --spec` (D-01 CLI-backed, not UI-only), and the
//      round-tripped YAML re-resolves to the same cells.
//   4. origin_span_id round-trips: buildVariantMeta threads --origin-span-id into
//      span.meta; a Run written WITH origin_span_id reads it back; a Run WITHOUT it
//      reads null (honesty, no fabrication).
//
// Run: node --test tests/experiments/avenue-spec.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { synthesizeAvenueSpec } from '../../lib/experiments/avenue-spec.mjs';
import { resolveExperimentSpec } from '../../lib/experiments/experiment-spec.mjs';
import { buildVariantMeta } from '../../scripts/measurement-start.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');

/** A representative completed origin Run (the shape readRuns surfaces via ...meta). */
function originRun(overrides = {}) {
  return {
    run_id: 'exp-abc123--claude-sonnet-straight-default--r0',
    task_id: 'exp-abc123--claude-sonnet-straight-default--r0',
    goal_sentence: 'Add a health endpoint to the API',
    snapshot_id: 'snap-2026-07-11-abc123',
    agent: 'claude',
    model: 'sonnet',
    framework: 'straight',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Behavior 1: origin prompt + snapshot preserved, one cell per chosen variant
// ---------------------------------------------------------------------------

test('AVN-01: synthesizeAvenueSpec preserves origin goal + snapshot and one cell per variant', () => {
  const variants = [
    { agent: 'claude', model: 'opus', framework: 'straight', env: 'kb-on' },
    { agent: 'opencode', model: 'default', framework: 'tdd', env: 'kb-off' },
  ];
  const spec = synthesizeAvenueSpec({ originRun: originRun(), variants });

  assert.equal(spec.goal_sentence, 'Add a health endpoint to the API', 'D-08: goal === origin prompt');
  assert.equal(spec.snapshot_id, 'snap-2026-07-11-abc123', 'D-08: snapshot_id === origin snapshot');
  assert.equal(spec.variants.length, 2, 'exactly one cell per chosen variant');
  assert.equal(spec.variants[0].agent, 'claude');
  assert.equal(spec.variants[0].env, 'kb-on', 'env axis (kb-on) preserved on the cell');
  assert.equal(spec.variants[1].agent, 'opencode');
  assert.equal(spec.variants[1].env, 'kb-off', 'env axis (kb-off) preserved on the cell');
});

test('AVN-01: origin_span_id links the avenue back to the forked origin span', () => {
  const spec = synthesizeAvenueSpec({
    originRun: originRun(),
    variants: [{ agent: 'claude', model: 'opus', framework: 'straight', env: 'kb-on' }],
  });
  assert.equal(
    spec.origin_span_id,
    'exp-abc123--claude-sonnet-straight-default--r0',
    'origin_span_id carries the origin Run task_id',
  );
});

// ---------------------------------------------------------------------------
// Behavior 2: the synthesized spec passes resolveExperimentSpec/validateCells
// ---------------------------------------------------------------------------

test('AVN-01: synthesized spec resolves (mastracode cell legal; kb-on/kb-off env accepted)', () => {
  const spec = synthesizeAvenueSpec({
    originRun: originRun(),
    variants: [
      { agent: 'mastracode', model: 'default', framework: 'straight', env: 'kb-on' },
      { agent: 'claude', model: 'sonnet', framework: 'tdd', env: 'kb-off' },
    ],
  });
  // resolveExperimentSpec whole-run validates every cell (agent enum, unsupported-combo,
  // shell-safety). A throw here means the synthesized spec is not runnable.
  const resolved = resolveExperimentSpec(spec);
  assert.equal(resolved.goal_sentence, 'Add a health endpoint to the API');
  assert.equal(resolved.cells.length, 2, 'both cells survive validation');
  assert.ok(resolved.cells.some((c) => c.agent === 'mastracode'), 'mastracode cell legal (AVN-03)');
  assert.ok(resolved.cells.every((c) => c.env === 'kb-on' || c.env === 'kb-off'), 'env kb-on/kb-off preserved');
});

// ---------------------------------------------------------------------------
// Behavior 3: SCRIPTABLE — serializes to YAML a power user could pass to --spec
// ---------------------------------------------------------------------------

test('AVN-01: synthesized spec is scriptable — serializes to YAML and re-resolves identically (D-01)', () => {
  const spec = synthesizeAvenueSpec({
    originRun: originRun(),
    variants: [
      { agent: 'claude', model: 'opus', framework: 'straight', env: 'kb-on' },
      { agent: 'opencode', model: 'default', framework: 'tdd', env: 'kb-off' },
    ],
  });

  // A power user pipes this through js-yaml → a file → `experiment-run.mjs --spec`.
  const text = yaml.dump(spec);
  assert.match(text, /goal_sentence:/, 'YAML carries the goal');
  assert.match(text, /snapshot_id:/, 'YAML carries the snapshot');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-spec-yaml-'));
  const p = path.join(dir, 'avenue.yaml');
  fs.writeFileSync(p, text, 'utf8');
  try {
    const fromFile = resolveExperimentSpec(p);
    assert.equal(fromFile.goal_sentence, spec.goal_sentence, 'file spec goal round-trips');
    assert.equal(fromFile.cells.length, 2, 'file spec cell count round-trips');
    assert.equal(fromFile.cells[0].env, 'kb-on');
    assert.equal(fromFile.cells[1].env, 'kb-off');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AVN-01: synthesizeToYamlFile writes config/experiments/avenue-<origin>.yaml (A4 persistence)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-spec-persist-'));
  try {
    const spec = synthesizeAvenueSpec({
      originRun: originRun(),
      variants: [{ agent: 'claude', model: 'opus', framework: 'straight', env: 'kb-on' }],
    });
    const outPath = synthesizeToYamlFile(spec, { dir });
    assert.ok(fs.existsSync(outPath), 'the avenue spec file exists on disk');
    assert.match(path.basename(outPath), /^avenue-.*\.yaml$/, 'file named avenue-<origin>.yaml');
    const reparsed = resolveExperimentSpec(outPath);
    assert.equal(reparsed.goal_sentence, spec.goal_sentence, 'persisted file re-resolves');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// synthesizeToYamlFile is a named export exercised above; import lazily so the
// primary behaviors run even if the persistence helper is added later.
const { synthesizeToYamlFile } = await import('../../lib/experiments/avenue-spec.mjs');

// ---------------------------------------------------------------------------
// Behavior 4: origin_span_id round-trips through measurement-start → run-write
// ---------------------------------------------------------------------------

test('AVN-01: buildVariantMeta threads --origin-span-id into span.meta', () => {
  const meta = buildVariantMeta(['--variant', 'A', '--origin-span-id', 'exp-origin--r0']);
  assert.equal(meta.origin_span_id, 'exp-origin--r0', 'origin_span_id folds into span.meta');
});

test('AVN-01: absent --origin-span-id leaves origin_span_id absent (no null pollution)', () => {
  const meta = buildVariantMeta(['--variant', 'A']);
  assert.equal('origin_span_id' in meta, false, 'no origin_span_id key when the flag is omitted');
});

/**
 * Isolated experiment store (REAL ontology copied in) so the strict-path putEntity
 * validates entityType:'Run'. Mirrors run-write.test.mjs::openIsolatedStore.
 */
async function openIsolatedStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-spec-run-write-'));
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

test('AVN-01: writeRun stamps origin_span_id from tags; absent reads null (honesty)', async () => {
  const { writeRun } = await import('../../lib/experiments/run-write.mjs');
  const { store, cleanup } = await openIsolatedStore();
  try {
    // (a) WITH origin_span_id
    await writeRun(store, {
      span: { task_id: 'avenue-1' },
      taskClass: 'unclassified',
      pending: false,
      tags: { agent: 'claude', model: 'opus', origin_span_id: 'exp-origin--r0' },
      totals: {},
    });
    const withOrigin = await findRun(store, 'avenue-1');
    assert.ok(withOrigin, 'avenue-1 Run exists');
    assert.ok('origin_span_id' in withOrigin.metadata, 'origin_span_id key always present');
    assert.equal(withOrigin.metadata.origin_span_id, 'exp-origin--r0', 'origin_span_id persisted verbatim');

    // (b) WITHOUT origin_span_id → null, never '' (the null-not-zero house rule)
    await writeRun(store, {
      span: { task_id: 'origin-run' },
      taskClass: 'unclassified',
      pending: false,
      tags: { agent: 'claude', model: 'sonnet' },
      totals: {},
    });
    const noOrigin = await findRun(store, 'origin-run');
    assert.ok('origin_span_id' in noOrigin.metadata, 'origin_span_id key always present (never absent)');
    assert.equal(noOrigin.metadata.origin_span_id, null, 'no origin → origin_span_id null (never fabricated)');
    assert.notEqual(noOrigin.metadata.origin_span_id, '', 'origin_span_id never coerced to empty string');
  } finally {
    await cleanup();
  }
});
