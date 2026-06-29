// tests/experiments/_fixtures/seed-experiment-store.mjs
//
// Shared Phase 74 test fixture (Plan 74-01, Task 1).
//
// Factors the inline `seedIsolatedStore` previously embedded in
// score-override-endpoint.test.mjs:40-89 into a single reusable helper so every
// Wave-0 experiment test (run-read, runs-endpoint, timeline-read, report-write,
// report-snapshot) seeds an ISOLATED throwaway store the same way.
//
// Isolation invariants (74-01 threat model):
//   T-74-01-01 — `seedIsolatedStore` ALWAYS opens via
//     `openExperimentStore({ repoRoot: tmp })` into a fresh mkdtemp dir whose
//     `.data/ontologies-experiment` is the REAL ontology copied verbatim. The real
//     single-owner `.data/experiments/leveldb` store is NEVER touched; cleanup()
//     removes the tmp tree.
//   T-74-01-02 — `seedTokenDb` writes ONLY a throwaway temp SQLite file. The
//     proxy-owned `.data/llm-proxy/token-usage.db` is never opened writable here.
//
// Output via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// The fixture lives one dir deeper than a test under tests/experiments/, so walk
// up THREE levels (_fixtures -> experiments -> tests -> REPO_ROOT).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');

/**
 * Build an isolated tmp repo-root with the REAL experiment ontology copied in
 * verbatim, seed it with one Run + one Score for `taskId`, and return
 * `{ repoRoot, cleanup }`. The store is opened ONLY through
 * `openExperimentStore({ repoRoot: tmp })` (never `new GraphKMStore`) so the
 * mandatory explicit `ontologyDir` (CLAUDE.md km-core rule) is honoured.
 *
 * @param {string} [taskId='t1'] the Run/Score idempotency key.
 * @param {object} [overrides] shallow per-section overrides:
 *   { span, taskClass, pending, tags, totals, judgment } — each merged onto the
 *   default seed shape so callers can tweak one facet without re-specifying all.
 * @returns {Promise<{ repoRoot: string, cleanup: () => void }>}
 */
export async function seedIsolatedStore(taskId = 't1', overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-experiment-store-'));
  const tmpOntologyDir = path.join(tmp, '.data', 'ontologies-experiment');
  fs.mkdirSync(tmpOntologyDir, { recursive: true });
  for (const f of fs.readdirSync(SRC_ONTOLOGY_DIR)) {
    fs.copyFileSync(path.join(SRC_ONTOLOGY_DIR, f), path.join(tmpOntologyDir, f));
  }

  const { openExperimentStore } = await import('../../../lib/experiments/store.mjs');
  const { writeRun } = await import('../../../lib/experiments/run-write.mjs');
  const { writeScore } = await import('../../../lib/experiments/score-write.mjs');

  const store = await openExperimentStore({ repoRoot: tmp });
  try {
    await writeRun(store, {
      span: {
        task_id: taskId,
        started_at: '2026-06-28T05:55:15.270Z',
        ended_at: '2026-06-28T05:55:30.164Z',
        goal_sentence: 'seed a run for the Phase 74 read scaffold',
        ...(overrides.span ?? {}),
      },
      taskClass: overrides.taskClass ?? 'new-feature',
      pending: overrides.pending ?? false,
      tags: {
        task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-haiku-4.5',
        framework: 'gsd', trace_id: taskId,
        ...(overrides.tags ?? {}),
      },
      totals: {
        input_tokens: 100, output_tokens: 200, total_tokens: 300, reasoning_tokens: 50, calls: 4,
        ...(overrides.totals ?? {}),
      },
    });
    await writeScore(store, {
      span: { task_id: taskId },
      judgment: {
        goal_aligned_ratio: 0.8,
        event_labels: [{ seq: 0, label: 'toward' }],
        ratio_rationale: 'progressed toward the goal',
        rubric: { goal_achieved: 0.7, code_quality: 0.6, test_coverage: 0.5, regressions: 0, spec_drift: 0.1 },
        rubric_rationale: 'solid',
        pending: false,
        not_scored: null,
        ...(overrides.judgment ?? {}),
      },
    });
  } finally {
    await store.close();
  }

  process.stderr.write(`[seed-fixture] seeded isolated store repoRoot=${tmp} task=${taskId}\n`);
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  return { repoRoot: tmp, cleanup };
}

/** The token_usage attribution columns the timeline reader nests/sums. */
function createTokenUsageTable(db) {
  db.exec(`CREATE TABLE token_usage (
    id               INTEGER PRIMARY KEY,
    timestamp        TEXT    NOT NULL DEFAULT '',
    granularity_tier TEXT    NOT NULL DEFAULT '',
    tool_call_id     TEXT    NOT NULL DEFAULT '',
    parent_call_id   TEXT,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    input_tokens     INTEGER NOT NULL DEFAULT 0,
    output_tokens    INTEGER NOT NULL DEFAULT 0,
    total_tokens     INTEGER NOT NULL DEFAULT 0,
    tokens_estimated INTEGER NOT NULL DEFAULT 0,
    model            TEXT    NOT NULL DEFAULT '',
    task_id          TEXT    NOT NULL DEFAULT '',
    agent            TEXT    NOT NULL DEFAULT '',
    process          TEXT    NOT NULL DEFAULT '',
    provider         TEXT    NOT NULL DEFAULT ''
  );`);
}

/**
 * Write a THROWAWAY token-usage.db (writable in the FIXTURE only, NEVER the
 * proxy-owned DB — T-74-01-02) seeded with `rows` and return its path. Timeline
 * read tests point `dbPathOverride`/`readTimeline` at this temp DB.
 *
 * @param {Array<object>} [rows] token_usage rows; each merged onto a zero-default
 *   row so callers specify only the columns they care about.
 * @returns {{ dir: string, dbPath: string, cleanup: () => void }}
 */
export function seedTokenDb(rows = []) {
  const Database = require('better-sqlite3');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-token-db-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const db = new Database(dbPath);
  try {
    createTokenUsageTable(db);
    const insert = db.prepare(`INSERT INTO token_usage
        (timestamp, granularity_tier, tool_call_id, parent_call_id,
         reasoning_tokens, input_tokens, output_tokens, total_tokens,
         tokens_estimated, model, task_id, agent, process, provider)
       VALUES (@timestamp, @granularity_tier, @tool_call_id, @parent_call_id,
         @reasoning_tokens, @input_tokens, @output_tokens, @total_tokens,
         @tokens_estimated, @model, @task_id, @agent, @process, @provider)`);
    for (const row of rows) {
      insert.run({
        timestamp: '', granularity_tier: '', tool_call_id: '', parent_call_id: null,
        reasoning_tokens: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0,
        tokens_estimated: 0, model: '', task_id: '', agent: '', process: '', provider: '',
        ...row,
      });
    }
  } finally {
    db.close();
  }

  process.stderr.write(`[seed-fixture] seeded throwaway token-usage.db dbPath=${dbPath} rows=${rows.length}\n`);
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { dir, dbPath, cleanup };
}
