// tests/context-turns/sweeper.test.mjs
//
// Behavior (RESEARCH Test Map): the age sweeper deletes files older than the
// retention window, keeps files at-or-below it, and never throws on a bad dir.
// Drives `context-turns-sweeper-job.sh` via env `CONTEXT_TURNS_RETENTION_DAYS`
// + `CODING_REPO` (temp repo root override).
//
// Implemented in 84-03 (un-skips the Wave-0 stub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmpMeasurementsDir } from './_helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWEEPER = path.join(__dirname, '..', '..', 'scripts', 'context-turns-sweeper-job.sh');

const DAY_SECS = 86400;

/** Run the sweeper against a temp repo root; returns the spawnSync result. */
function runSweeper(repoRoot, retentionDays) {
  return spawnSync('bash', [SWEEPER], {
    env: {
      ...process.env,
      CODING_REPO: repoRoot,
      // Pin the data root too. The sweeper resolves the measurements tree from
      // LLM_PROXY_DATA_DIR (it moved out of the repo with the data home), and this
      // env spreads process.env — an inherited value would point a DELETING sweep at
      // the developer's real measurement archive.
      LLM_PROXY_DATA_DIR: path.join(repoRoot, '.data'),
      CONTEXT_TURNS_RETENTION_DAYS: String(retentionDays),
    },
    encoding: 'utf8',
  });
}

/** Write a measurements file under <repo>/.data/measurements/<task>/<name> and back-date it. */
function seedFile(repoRoot, taskId, name, ageDays) {
  const dir = path.join(repoRoot, '.data', 'measurements', String(taskId));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '{"turn":1}\n');
  const when = new Date((Date.now() / 1000 - ageDays * DAY_SECS) * 1000);
  fs.utimesSync(file, when, when);
  return file;
}

test('age sweeper deletes >retention, keeps <=retention, never throws on bad dir', () => {
  const tmp = mkTmpMeasurementsDir();
  try {
    // OLD file (~30 days) under taskA — must be reclaimed at 14-day retention.
    const oldFile = seedFile(tmp.dir, 'taskA', 'context-turns.jsonl', 30);
    // FRESH file (~1 day) under taskB (.gz variant) — must survive.
    const freshFile = seedFile(tmp.dir, 'taskB', 'context-turns.jsonl.gz', 1);
    // Aged raw-bodies under taskA — per-file mtime independence: also reclaimed.
    const oldRaw = seedFile(tmp.dir, 'taskA', 'raw-bodies.jsonl.gz', 30);

    const res = runSweeper(tmp.dir, 14);
    assert.equal(res.status, 0, `sweeper exited non-zero: ${res.stderr}`);
    assert.equal(fs.existsSync(oldFile), false, 'old context-turns.jsonl should be deleted');
    assert.equal(fs.existsSync(oldRaw), false, 'old raw-bodies.jsonl.gz should be deleted');
    assert.equal(fs.existsSync(freshFile), true, 'fresh context-turns.jsonl.gz should survive');

    // Never-throw: point at a repo root with NO measurements dir — exit 0.
    const missing = mkTmpMeasurementsDir();
    try {
      // Remove the whole temp dir so <root>/.data/measurements is absent.
      missing.cleanup();
      const res2 = runSweeper(missing.dir, 14);
      assert.equal(res2.status, 0, `missing-dir run must exit 0, got ${res2.status}: ${res2.stderr}`);
    } finally {
      missing.cleanup();
    }
  } finally {
    tmp.cleanup();
  }
});

/** Write <repo>/.data/retrieval-captures/<name> and back-date it. */
function seedCapture(repoRoot, name, ageDays) {
  const dir = path.join(repoRoot, '.data', 'retrieval-captures');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '{"turn":0,"items":[]}\n');
  const when = new Date((Date.now() / 1000 - ageDays * DAY_SECS) * 1000);
  fs.utimesSync(file, when, when);
  return file;
}

test('age sweeper reclaims aged per-turn KB retrieval captures (flat dir)', () => {
  const tmp = mkTmpMeasurementsDir();
  try {
    const oldJsonl = seedCapture(tmp.dir, 'sess-old.jsonl', 30);
    const freshJsonl = seedCapture(tmp.dir, 'sess-fresh.jsonl', 1);
    // Legacy single-turn captures are superseded by .jsonl and swept on the same policy.
    const oldLegacy = seedCapture(tmp.dir, 'sess-legacy.json', 30);

    const res = runSweeper(tmp.dir, 14);
    assert.equal(res.status, 0, `sweeper exited non-zero: ${res.stderr}`);
    assert.equal(fs.existsSync(oldJsonl), false, 'aged .jsonl capture should be deleted');
    assert.equal(fs.existsSync(oldLegacy), false, 'aged legacy .json capture should be deleted');
    assert.equal(fs.existsSync(freshJsonl), true, 'fresh .jsonl capture should survive');
  } finally {
    tmp.cleanup();
  }
});

test('retrieval-captures sweep runs even when the measurements dir is absent', () => {
  // REGRESSION: the sweeper used to `exit 0` the moment .data/measurements was
  // missing, which would have skipped the (independent) retrieval-captures pass
  // entirely on any host that has KB captures but no measurement spans.
  const tmp = mkTmpMeasurementsDir();
  try {
    const oldJsonl = seedCapture(tmp.dir, 'sess-old.jsonl', 30);
    assert.equal(fs.existsSync(path.join(tmp.dir, '.data', 'measurements')), false,
      'precondition: no measurements dir');

    const res = runSweeper(tmp.dir, 14);
    assert.equal(res.status, 0, `sweeper exited non-zero: ${res.stderr}`);
    assert.equal(fs.existsSync(oldJsonl), false,
      'aged capture must be reclaimed despite the absent measurements dir');
  } finally {
    tmp.cleanup();
  }
});

test('without LLM_PROXY_DATA_DIR the sweep follows the data home the proxy writes to', () => {
  // REGRESSION (glass G1): the default used to be <CODING_REPO>/.data, which the
  // proxy no longer writes to — the launchd job (no LLM_PROXY_DATA_DIR) swept an
  // empty dir while <dataHome>/var/measurements grew without bound.
  const tmp = mkTmpMeasurementsDir();
  try {
    const dataHome = path.join(tmp.dir, 'data-home');
    const dir = path.join(dataHome, 'var', 'measurements', 'taskZ');
    fs.mkdirSync(dir, { recursive: true });
    const aged = path.join(dir, 'context-turns.jsonl.gz');
    fs.writeFileSync(aged, 'x');
    const when = new Date((Date.now() / 1000 - 30 * DAY_SECS) * 1000);
    fs.utimesSync(aged, when, when);

    const env = { ...process.env, CODING_REPO: tmp.dir, CODING_DATA_HOME: dataHome, CONTEXT_TURNS_RETENTION_DAYS: '14' };
    delete env.LLM_PROXY_DATA_DIR;
    const res = spawnSync('bash', [SWEEPER], { env, encoding: 'utf8' });
    assert.equal(res.status, 0, `sweeper exited non-zero: ${res.stderr}`);
    assert.equal(fs.existsSync(aged), false, `aged capture under <dataHome>/var must be reclaimed: ${res.stderr}`);
  } finally {
    tmp.cleanup();
  }
});
