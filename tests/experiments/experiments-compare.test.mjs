// tests/experiments/experiments-compare.test.mjs
//
// Phase 79-03 (CMP-03) — integration coverage for the operator CLI
// scripts/experiments-compare.mjs: the task_hash sanitizer, the JSON/CSV report
// writers, the ranked table renderer, and the end-to-end store-backed pipeline
// (openExperimentStore → readRuns → buildComparison → renderTable + writeReportJson).
//
// Two layers:
//   Task 1 — pure-helper tests: sanitizeTaskHash allowlist + traversal rejection,
//            writeReportJson path + schema round-trip, writeReportCsv one-row-per-variant.
//   Task 2 — a store-backed integration test: seed synthetic Run+Score+Outcome
//            entities (some complete+gate_passed, some gate_passed=false, one timeout)
//            sharing a task_hash, run the read→build→render→write pipeline, and assert
//            the JSON export lands at the sanitized reports path, the failed/timeout
//            variants land in the non-ranked section (JSON + table), --rank-by tokens
//            reorders, --csv writes the CSV, and a traversal task_hash is rejected.
//
// Fixtures are synthetic (D-04b) and write to a THROWAWAY tmp reports dir — the
// real .data/experiments/reports/ is never touched (repoRoot override).
//
// node:test + node:assert/strict. Output via process.stderr.write only (no console.*).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sanitizeTaskHash,
  writeReportJson,
  writeReportCsv,
  renderTable,
} from '../../scripts/experiments-compare.mjs';
import { buildComparison } from '../../lib/experiments/compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');

/** A throwaway repo-root so writers never touch the real .data/experiments/reports/. */
function makeTmpRepoRoot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'experiments-compare-'));
  return { tmp, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/** A minimal report object matching the buildComparison shape for writer tests. */
function fakeReport(taskHash) {
  const metrics = {
    totalTokens: { mean: 300, stddev: 0, median: 300, min: 300, max: 300, n: 1 },
    wallclock: { mean: 1000, stddev: 0, median: 1000, min: 1000, max: 1000, n: 1 },
    rubric_score: { mean: 0.8, stddev: 0, median: 0.8, min: 0.8, max: 0.8, n: 1 },
  };
  return {
    taskHash,
    rankBy: 'composite',
    ranked: [{ variant: 'A', n: 1, rank: 1, composite: 375, metrics }],
    failed: [{ variant: 'B', n: 1, reason: 'no successful runs', metrics }],
    ungated: [],
    unscored: [],
  };
}

// ── Task 1: sanitizeTaskHash ────────────────────────────────────────────────

test('sanitizeTaskHash passes a plain alnum hash through', () => {
  assert.equal(sanitizeTaskHash('abc123'), 'abc123');
});

test('sanitizeTaskHash allows the . _ - allowlist characters', () => {
  assert.equal(sanitizeTaskHash('a.b_c-1'), 'a.b_c-1');
});

test('sanitizeTaskHash rejects a directory-traversal attempt', () => {
  assert.throws(() => sanitizeTaskHash('../../etc/passwd'), /task[_-]?hash|invalid|traversal/i);
});

test('sanitizeTaskHash rejects a bare path separator', () => {
  assert.throws(() => sanitizeTaskHash('a/b'), /invalid|separator|traversal/i);
});

test('sanitizeTaskHash rejects a backslash and a null byte', () => {
  assert.throws(() => sanitizeTaskHash('a\\b'), /invalid|separator|traversal/i);
  assert.throws(() => sanitizeTaskHash('a\0b'), /invalid|null|traversal/i);
});

test('sanitizeTaskHash rejects null/empty', () => {
  assert.throws(() => sanitizeTaskHash(''), /empty|required|invalid/i);
  assert.throws(() => sanitizeTaskHash(null), /empty|required|invalid/i);
  assert.throws(() => sanitizeTaskHash(undefined), /empty|required|invalid/i);
});

// ── Task 1: writeReportJson ─────────────────────────────────────────────────

test('writeReportJson writes <hash>.json under the reports dir and round-trips the schema', () => {
  const { tmp, cleanup } = makeTmpRepoRoot();
  try {
    const report = fakeReport('unittest01');
    const outPath = writeReportJson(report, 'unittest01', { repoRoot: tmp });
    const expected = path.join(tmp, '.data', 'experiments', 'reports', 'unittest01.json');
    assert.equal(outPath, expected);
    assert.ok(fs.existsSync(outPath), 'the JSON file exists');

    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.equal(parsed.task_hash, 'unittest01');
    assert.ok(Array.isArray(parsed.ranked));
    assert.ok(Array.isArray(parsed.failed));
    assert.ok(Array.isArray(parsed.ungated));
    assert.ok(Array.isArray(parsed.unscored));
    // per-variant gate outcome + rank + variance block present
    const top = parsed.ranked[0];
    assert.equal(top.rank, 1);
    assert.equal(top.gate_outcome, 'passed');
    assert.deepEqual(Object.keys(top.metrics.totalTokens).sort(),
      ['max', 'mean', 'median', 'min', 'n', 'stddev']);
    // failed variant carries a distinct gate outcome
    assert.equal(parsed.failed[0].gate_outcome, 'failed');
  } finally {
    cleanup();
  }
});

test('writeReportJson refuses a traversal task_hash (no write outside reports dir)', () => {
  const { tmp, cleanup } = makeTmpRepoRoot();
  try {
    assert.throws(() => writeReportJson(fakeReport('x'), '../../etc/passwd', { repoRoot: tmp }),
      /invalid|traversal|separator/i);
    // nothing was written outside the reports dir
    assert.ok(!fs.existsSync(path.join(tmp, '..', '..', 'etc', 'passwd')));
  } finally {
    cleanup();
  }
});

// ── Task 1: writeReportCsv ──────────────────────────────────────────────────

test('writeReportCsv writes a <hash>.csv with one row per variant', () => {
  const { tmp, cleanup } = makeTmpRepoRoot();
  try {
    const outPath = writeReportCsv(fakeReport('csvtest01'), 'csvtest01', { repoRoot: tmp });
    assert.ok(outPath.endsWith('csvtest01.csv'));
    const csv = fs.readFileSync(outPath, 'utf8').trim().split('\n');
    // header + one ranked + one failed = 3 lines
    assert.equal(csv.length, 3);
    assert.match(csv[0], /variant/i);
    assert.ok(csv.some((l) => l.startsWith('A,')));
    assert.ok(csv.some((l) => l.startsWith('B,')));
  } finally {
    cleanup();
  }
});

// ── Task 2: renderTable ─────────────────────────────────────────────────────

test('renderTable renders ranked variants and a distinct no-successful-runs section', () => {
  const table = renderTable(fakeReport('rendertest'));
  assert.match(table, /A/);
  assert.match(table, /B/);
  // the failed group must be visibly NOT a winner
  assert.match(table, /no successful runs|failed/i);
});

// ── Task 2: store-backed integration ────────────────────────────────────────

/**
 * Seed an isolated store with N runs sharing `task_hash`:
 *   variant 'cheap'  — 1 complete + gate_passed run, low tokens, high rubric
 *   variant 'pricey' — 1 complete + gate_passed run, high tokens, lower rubric
 *   variant 'broken' — 1 complete + gate_passed=false run (FAILED)
 *   variant 'stuck'  — 1 timeout run (FAILED)
 * Returns { repoRoot, cleanup }.
 */
async function seedComparisonStore(taskHash) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-store-'));
  const tmpOntologyDir = path.join(tmp, '.data', 'ontologies-experiment');
  fs.mkdirSync(tmpOntologyDir, { recursive: true });
  for (const f of fs.readdirSync(SRC_ONTOLOGY_DIR)) {
    fs.copyFileSync(path.join(SRC_ONTOLOGY_DIR, f), path.join(tmpOntologyDir, f));
  }

  const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
  const { writeRun } = await import('../../lib/experiments/run-write.mjs');
  const { writeScore } = await import('../../lib/experiments/score-write.mjs');

  const store = await openExperimentStore({ repoRoot: tmp });
  try {
    const seedRun = async (taskId, tags, totals, judgment) => {
      await writeRun(store, {
        span: {
          task_id: taskId,
          started_at: '2026-07-13T10:00:00.000Z',
          ended_at: '2026-07-13T10:00:10.000Z',
          goal_sentence: 'synthetic comparison run',
        },
        taskClass: 'new-feature',
        pending: false,
        tags: { task_hash: taskHash, agent: 'claude-code', model: 'sonnet', framework: 'gsd', ...tags },
        totals,
      });
      if (judgment) await writeScore(store, { span: { task_id: taskId }, judgment });
    };

    await seedRun('cheap-1', { variant: 'cheap', terminal_state: 'complete' },
      { total_tokens: 200 },
      { goal_aligned_ratio: 0.9, gate_passed: true, rubric: {}, not_scored: null, pending: false });
    await seedRun('pricey-1', { variant: 'pricey', terminal_state: 'complete' },
      { total_tokens: 800 },
      { goal_aligned_ratio: 0.5, gate_passed: true, rubric: {}, not_scored: null, pending: false });
    await seedRun('broken-1', { variant: 'broken', terminal_state: 'complete' },
      { total_tokens: 100 },
      { goal_aligned_ratio: 0.9, gate_passed: false, rubric: {}, not_scored: null, pending: false });
    await seedRun('stuck-1', { variant: 'stuck', terminal_state: 'timeout' },
      { total_tokens: 50 },
      { goal_aligned_ratio: 0.9, gate_passed: true, rubric: {}, not_scored: null, pending: false });
  } finally {
    await store.close();
  }

  return { repoRoot: tmp, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

test('integration: read→build→render→write pipeline over synthetic store fixtures', async () => {
  const taskHash = 'integ01';
  const { repoRoot, cleanup } = await seedComparisonStore(taskHash);
  const reportsPath = path.join(repoRoot, '.data', 'experiments', 'reports', `${taskHash}.json`);
  try {
    const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
    const { readRuns } = await import('../../lib/experiments/query.mjs');

    const store = await openExperimentStore({ repoRoot });
    let report;
    try {
      const rows = await readRuns(store);
      report = buildComparison(rows, { taskHash, rankBy: 'composite' });
    } finally {
      await store.close();
    }

    // (a) JSON export lands at the sanitized reports path
    const outPath = writeReportJson(report, taskHash, { repoRoot });
    assert.equal(outPath, reportsPath);
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));

    // ranked contains the two successful-gated variants; broken+stuck are NOT ranked
    const rankedVariants = parsed.ranked.map((v) => v.variant);
    assert.ok(rankedVariants.includes('cheap'));
    assert.ok(rankedVariants.includes('pricey'));
    assert.ok(!rankedVariants.includes('broken'));
    assert.ok(!rankedVariants.includes('stuck'));

    // (b) failed/timeout variants appear in the non-ranked section — JSON + table
    const failedVariants = parsed.failed.map((v) => v.variant);
    assert.ok(failedVariants.includes('broken'));
    assert.ok(failedVariants.includes('stuck'));
    const table = renderTable(report);
    assert.match(table, /broken/);
    assert.match(table, /stuck/);
    assert.match(table, /no successful runs|failed/i);

    // cheap (200 tokens / 0.9) beats pricey (800 / 0.5) on the composite → rank 1
    const rank1 = parsed.ranked.find((v) => v.rank === 1);
    assert.equal(rank1.variant, 'cheap');

    // (c) --rank-by tokens changes the ordering (same winner here, but assert it re-sorts;
    //     use score to force a distinct ordering vs composite is unnecessary — both give cheap;
    //     assert tokens ranking is well-formed and ascending by mean tokens)
    const byTokens = buildComparison(await (async () => {
      const s = await openExperimentStore({ repoRoot });
      try { const { readRuns } = await import('../../lib/experiments/query.mjs'); return await readRuns(s); }
      finally { await s.close(); }
    })(), { taskHash, rankBy: 'tokens' });
    assert.equal(byTokens.ranked[0].variant, 'cheap'); // 200 < 800
    assert.ok(byTokens.ranked[0].metrics.totalTokens.mean <= byTokens.ranked[1].metrics.totalTokens.mean);

    // (d) --csv writes the CSV file alongside the JSON
    const csvPath = writeReportCsv(report, taskHash, { repoRoot });
    assert.ok(fs.existsSync(csvPath));
    assert.ok(csvPath.endsWith(`${taskHash}.csv`));

    // (e) a traversal task_hash is rejected by sanitizeTaskHash
    assert.throws(() => sanitizeTaskHash('../../etc/passwd'), /invalid|traversal|separator/i);
  } finally {
    cleanup();
  }
});
