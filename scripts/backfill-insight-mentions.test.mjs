/**
 * Phase 58 Plan 03 — Unit suite for `scripts/backfill-insight-mentions.mjs`.
 *
 * Locks the contract in PLAN.md §<behavior> Tests 1-8:
 *   1. parseArgs honors all four flags (--dry-run, --limit, --source, --log-dir).
 *   2. parseArgs defaults rooted at process.cwd().
 *   3. Filter — already-mentioned Insights skip.
 *   4. Filter — entityType gate (only Insight nodes pass).
 *   5. Summary artifact shape under --dry-run.
 *   6. --limit honored (excess Insights reported as `skipped`).
 *   7. Dedup before write (existing edge + classifier overlap → only the new id is added).
 *   8. Classifier failure budget (per-Insight throw does not abort the script).
 *
 * Test strategy:
 *   - parseArgs is imported directly from the script (pure function, no I/O).
 *   - processInsight is imported directly and exercised with a mock kmStore +
 *     stub classifier injected via options.classifier.
 *   - The end-to-end script invocation tests spawn `node` against the script
 *     with `--dry-run` and a synthetic fixture JSON in a tmpdir; the classifier
 *     output is stubbed via the env var BACKFILL_TEST_CLASSIFIER_STUB which
 *     the script reads at top-level when set (deterministic, no live LLM).
 *
 * Per CLAUDE.md "no console.*" — uses `process.stderr.write` and assertion
 * failures only. No raw stdout calls anywhere.
 *
 * @module scripts/backfill-insight-mentions.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'backfill-insight-mentions.mjs');

// Dynamic import after writing path so the test file can also be authored
// before the script exists (RED phase). Imported lazily inside each `it` so
// a missing script surfaces as a clean test failure rather than a top-level
// module-resolution crash.
async function importScript() {
  return await import(SCRIPT_PATH);
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal km-core JSON export with the requested node + edge fixtures.
 *
 * Live export shape (verified 2026-06-15 against
 * `.data/knowledge-graph/exports/general.json`):
 *   {
 *     attributes: {},
 *     options: {...},
 *     nodes: [{ key, attributes: {id, name, entityType, ...} }],
 *     edges: [{ key, source, target, attributes: {from, to, type, ...} }],
 *   }
 */
function buildFixtureExport({ nodes = [], edges = [] }) {
  return {
    attributes: {},
    options: { type: 'mixed', multi: false, allowSelfLoops: true },
    nodes: nodes.map((n) => ({
      key: n.id,
      attributes: {
        id: n.id,
        name: n.name ?? `entity-${n.id.slice(0, 8)}`,
        entityType: n.entityType ?? 'Detail',
        ontologyClass: n.ontologyClass ?? n.entityType ?? 'Detail',
        layer: n.layer ?? 'evidence',
        description: n.description ?? '',
        createdAt: '2026-06-15T00:00:00.000Z',
        updatedAt: '2026-06-15T00:00:00.000Z',
        validFrom: '2026-06-15T00:00:00.000Z',
        validUntil: null,
        metadata: n.metadata ?? {},
      },
    })),
    edges: edges.map((e, i) => ({
      key: e.key ?? `edge-${i}`,
      source: e.from,
      target: e.to,
      attributes: {
        from: e.from,
        to: e.to,
        type: e.type,
        metadata: e.metadata ?? {},
        createdAt: e.createdAt ?? '2026-06-15T00:00:00.000Z',
      },
    })),
  };
}

/**
 * Create a tmpdir fixture set:
 *   <tmp>/source.json   (km-core export to backfill)
 *   <tmp>/logs/         (summary destination)
 */
async function setupFixtureDir(fixture) {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'backfill-58-03-'));
  const sourcePath = path.join(tmpRoot, 'source.json');
  const logDir = path.join(tmpRoot, 'logs');
  await fsp.mkdir(logDir, { recursive: true });
  await fsp.writeFile(sourcePath, JSON.stringify(buildFixtureExport(fixture), null, 2));
  return { tmpRoot, sourcePath, logDir };
}

/**
 * Spawn the script with stubbed classifier output.
 *
 * The stub format is JSON-encoded `{ [insightId]: string[] }` mapping each
 * Insight id to the classifier-result id list. The script reads it from
 * BACKFILL_TEST_CLASSIFIER_STUB and short-circuits the live proxy call.
 *
 * BACKFILL_TEST_CLASSIFIER_THROW (optional) → JSON map `{ [insightId]: true }`
 * triggers the stub to throw for that Insight (Test 8 — failure budget).
 */
function runBackfill(sourcePath, logDir, extraArgs = [], classifierStub = null, classifierThrow = null) {
  const args = [
    SCRIPT_PATH,
    `--source=${sourcePath}`,
    `--log-dir=${logDir}`,
    '--dry-run', // The integration tests run dry-run only — no LevelDB needed.
    ...extraArgs,
  ];
  const env = { ...process.env };
  if (classifierStub) env.BACKFILL_TEST_CLASSIFIER_STUB = JSON.stringify(classifierStub);
  if (classifierThrow) env.BACKFILL_TEST_CLASSIFIER_THROW = JSON.stringify(classifierThrow);
  const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 30_000, env });
  let summary = null;
  try {
    const entries = fs.readdirSync(logDir)
      .filter((f) => f.startsWith('backfill-insight-mentions-') && f.endsWith('.json'))
      .sort();
    if (entries.length > 0) {
      const lastPath = path.join(logDir, entries[entries.length - 1]);
      summary = JSON.parse(fs.readFileSync(lastPath, 'utf-8'));
    }
  } catch { /* leave summary null */ }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, summary };
}

// ────────────────────────────────────────────────────────────────────────────
// Test 1: parseArgs honors all four flags
// ────────────────────────────────────────────────────────────────────────────

describe('backfill-insight-mentions — parseArgs', () => {
  it('Test 1: honors --dry-run, --limit=5, --source, --log-dir', async () => {
    const { parseArgs } = await importScript();
    const parsed = parseArgs(['--dry-run', '--limit=5', '--source=/tmp/foo.json', '--log-dir=/tmp/logs']);
    assert.equal(parsed.dryRun, true, '--dry-run should set dryRun=true');
    assert.equal(parsed.limit, 5, '--limit=5 should set limit=5');
    assert.equal(parsed.source, '/tmp/foo.json', '--source should be honored');
    assert.equal(parsed.logDir, '/tmp/logs', '--log-dir should be honored');
    assert.equal(parsed.help, false, 'help should default false');
  });

  it('Test 2: parseArgs defaults rooted at process.cwd()', async () => {
    const { parseArgs } = await importScript();
    const parsed = parseArgs([]);
    assert.equal(parsed.dryRun, false, 'default dryRun=false');
    assert.equal(parsed.limit, null, 'default limit=null (no cap)');
    assert.equal(parsed.help, false, 'default help=false');
    assert.ok(
      parsed.source.endsWith('.data/knowledge-graph/exports/general.json'),
      `default source should end with .data/knowledge-graph/exports/general.json, got ${parsed.source}`,
    );
    assert.ok(parsed.source.startsWith('/'), `default source should be absolute, got ${parsed.source}`);
    assert.ok(parsed.logDir.endsWith('/.data') || parsed.logDir.endsWith('.data'),
      `default logDir should end with .data, got ${parsed.logDir}`);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test 3-4: filter logic (already-mentioned + entityType gate)
// ────────────────────────────────────────────────────────────────────────────

describe('backfill-insight-mentions — filter logic', () => {
  it('Test 3: skips Insights that already have ≥1 mentions edge', async () => {
    const nodes = [
      { id: 'i-1', name: 'Insight One', entityType: 'Insight', description: 'one' },
      { id: 'i-2', name: 'Insight Two', entityType: 'Insight', description: 'two' },
      { id: 'i-3', name: 'Insight Three', entityType: 'Insight', description: 'three' },
      { id: 'c-1', name: 'CompA', entityType: 'Component', description: 'compA' },
    ];
    const edges = [
      // Insight 1 already has a mentions edge — must be skipped.
      { from: 'i-1', to: 'c-1', type: 'mentions' },
    ];
    const { sourcePath, logDir } = await setupFixtureDir({ nodes, edges });

    const result = runBackfill(sourcePath, logDir, [], {
      'i-1': ['c-1'],
      'i-2': ['c-1'],
      'i-3': ['c-1'],
    });
    assert.equal(result.status, 0, `script should exit 0; stderr=${result.stderr.slice(0, 400)}`);
    assert.ok(result.summary, 'summary should be written');
    assert.equal(result.summary.totalInsights, 3, 'should report 3 total Insights');
    // i-1 is filtered out as already-mentioned. So perInsight only carries i-2 and i-3.
    const processed = result.summary.perInsight.map((r) => r.insightId);
    assert.ok(!processed.includes('i-1'), 'i-1 should NOT appear in perInsight (already had mentions)');
    assert.ok(processed.includes('i-2'), 'i-2 should appear in perInsight');
    assert.ok(processed.includes('i-3'), 'i-3 should appear in perInsight');
  });

  it('Test 4: entityType gate — only Insight nodes are processed', async () => {
    const nodes = [
      { id: 'i-1', name: 'Insight One', entityType: 'Insight', description: 'one' },
      { id: 'i-2', name: 'Insight Two', entityType: 'Insight', description: 'two' },
      { id: 'i-3', name: 'Insight Three', entityType: 'Insight', description: 'three' },
      { id: 'c-1', name: 'CompA', entityType: 'Component', description: 'compA' },
      { id: 'd-1', name: 'DetailA', entityType: 'Detail', description: 'detailA' },
    ];
    const { sourcePath, logDir } = await setupFixtureDir({ nodes, edges: [] });

    const result = runBackfill(sourcePath, logDir, [], {
      'i-1': ['c-1'],
      'i-2': ['c-1'],
      'i-3': ['c-1'],
    });
    assert.equal(result.status, 0, `script should exit 0; stderr=${result.stderr.slice(0, 400)}`);
    assert.equal(result.summary.totalInsights, 3, 'only 3 Insight-type nodes counted (Component + Detail excluded)');
    const processed = result.summary.perInsight.map((r) => r.insightId);
    assert.ok(!processed.includes('c-1'), 'Component should NOT appear in perInsight');
    assert.ok(!processed.includes('d-1'), 'Detail should NOT appear in perInsight');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test 5: summary artifact shape
// ────────────────────────────────────────────────────────────────────────────

describe('backfill-insight-mentions — summary shape (D-05.1)', () => {
  it('Test 5: dry-run summary carries dryRun, totals, perInsight with required fields', async () => {
    const nodes = [
      { id: 'i-1', name: 'Insight One', entityType: 'Insight', description: 'one' },
      { id: 'i-2', name: 'Insight Two', entityType: 'Insight', description: 'two' },
      { id: 'c-1', name: 'CompA', entityType: 'Component', description: 'compA' },
    ];
    const { sourcePath, logDir } = await setupFixtureDir({ nodes, edges: [] });
    const result = runBackfill(sourcePath, logDir, [], {
      'i-1': ['c-1'],
      'i-2': ['c-1'],
    });
    assert.equal(result.status, 0, `script should exit 0; stderr=${result.stderr.slice(0, 400)}`);
    const s = result.summary;
    assert.ok(s, 'summary must exist');
    assert.equal(s.dryRun, true, 'dryRun must be true');
    assert.equal(s.totalInsights, 2, 'totalInsights=2');
    assert.equal(s.classified, 2, 'classified=2 (both Insights ran through classifier)');
    assert.equal(s.edgesWritten, 0, 'edgesWritten=0 in dry-run');
    assert.equal(s.errors, 0, 'errors=0 on clean fixture');
    assert.ok(Array.isArray(s.perInsight), 'perInsight must be an array');
    assert.equal(s.perInsight.length, 2, 'perInsight.length=2');
    for (const rec of s.perInsight) {
      assert.equal(typeof rec.insightId, 'string', 'perInsight[].insightId is string');
      assert.equal(typeof rec.name, 'string', 'perInsight[].name is string');
      assert.equal(typeof rec.mentionsAdded, 'number', 'perInsight[].mentionsAdded is number');
      assert.ok(Array.isArray(rec.errors), 'perInsight[].errors is array');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test 6: --limit honored
// ────────────────────────────────────────────────────────────────────────────

describe('backfill-insight-mentions — --limit', () => {
  it('Test 6: --limit=1 processes only first un-mentioned Insight, reports rest as skipped', async () => {
    const nodes = [
      { id: 'i-1', name: 'Insight One', entityType: 'Insight', description: 'one' },
      { id: 'i-2', name: 'Insight Two', entityType: 'Insight', description: 'two' },
      { id: 'c-1', name: 'CompA', entityType: 'Component', description: 'compA' },
    ];
    const { sourcePath, logDir } = await setupFixtureDir({ nodes, edges: [] });
    const result = runBackfill(sourcePath, logDir, ['--limit=1'], {
      'i-1': ['c-1'],
      'i-2': ['c-1'],
    });
    assert.equal(result.status, 0, `script should exit 0; stderr=${result.stderr.slice(0, 400)}`);
    const s = result.summary;
    assert.equal(s.totalInsights, 2, 'totalInsights still 2 (the universe)');
    assert.equal(s.classified, 1, 'classified=1 (limit cuts off at 1)');
    // One of i-1, i-2 was processed; the other was skipped due to limit.
    assert.ok(s.skipped >= 1, `skipped should be >= 1; got ${s.skipped}`);
    assert.equal(s.perInsight.length, 1, 'perInsight.length=1 (only the processed one)');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test 7: dedup before write — exercises the exported processInsight helper
// ────────────────────────────────────────────────────────────────────────────

describe('backfill-insight-mentions — dedup before write (processInsight)', () => {
  it('Test 7: classifier returns ["e1","e2"] but existing edge to e1 → only e2 is added', async () => {
    const { processInsight } = await importScript();
    // Mock kmStore — record addRelation calls + provide findRelations to seed
    // the dedup-probe result for (insight→e1, mentions).
    const addRelationCalls = [];
    const kmStore = {
      async findRelations({ from, to, type }) {
        if (type === 'mentions' && from === 'ins-x') {
          // existing edge to e1, none for e2
          if (to === 'e1') return [{ from: 'ins-x', to: 'e1', type: 'mentions' }];
          if (to === 'e2') return [];
        }
        return [];
      },
      async addRelation(rel) {
        addRelationCalls.push(rel);
      },
    };
    const insightNode = {
      id: 'ins-x',
      name: 'X',
      description: 'sample',
      entityType: 'Insight',
    };
    const record = await processInsight(insightNode, kmStore, {
      classifier: async () => ['e1', 'e2'],
      candidates: [],
      source: 'backfill-insight-mentions',
      dryRun: false,
    });
    assert.equal(record.mentionsAdded, 1, 'mentionsAdded=1 (e2 added; e1 dedup-skipped)');
    assert.equal(addRelationCalls.length, 1, 'exactly one addRelation call');
    assert.equal(addRelationCalls[0].to, 'e2', 'only e2 written');
    assert.equal(addRelationCalls[0].type, 'mentions');
    assert.equal(addRelationCalls[0].metadata.source, 'backfill-insight-mentions',
      'metadata.source must be backfill-insight-mentions');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test 8: classifier failure budget — per-Insight throw does not abort
// ────────────────────────────────────────────────────────────────────────────

describe('backfill-insight-mentions — failure budget', () => {
  it('Test 8: classifier throws for one of 3 Insights; other 2 succeed; exit 0', async () => {
    const nodes = [
      { id: 'i-1', name: 'Insight One', entityType: 'Insight', description: 'one' },
      { id: 'i-2', name: 'Insight Two', entityType: 'Insight', description: 'two' },
      { id: 'i-3', name: 'Insight Three', entityType: 'Insight', description: 'three' },
      { id: 'c-1', name: 'CompA', entityType: 'Component', description: 'compA' },
    ];
    const { sourcePath, logDir } = await setupFixtureDir({ nodes, edges: [] });
    const result = runBackfill(
      sourcePath, logDir, [],
      { 'i-1': ['c-1'], 'i-3': ['c-1'] }, // i-2 has no entry — throws
      { 'i-2': true },                     // explicit throw for i-2
    );
    assert.equal(result.status, 0,
      `script should exit 0 despite one Insight throwing; stderr=${result.stderr.slice(0, 600)}`);
    const s = result.summary;
    assert.equal(s.totalInsights, 3, 'totalInsights=3');
    const errored = s.perInsight.find((r) => r.insightId === 'i-2');
    assert.ok(errored, 'i-2 record should be in perInsight');
    assert.ok(errored.errors.length > 0, 'i-2 record should have at least one error');
    const ok1 = s.perInsight.find((r) => r.insightId === 'i-1');
    const ok3 = s.perInsight.find((r) => r.insightId === 'i-3');
    assert.ok(ok1 && ok1.errors.length === 0, 'i-1 should succeed with no errors');
    assert.ok(ok3 && ok3.errors.length === 0, 'i-3 should succeed with no errors');
  });
});
