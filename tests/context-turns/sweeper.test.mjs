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
