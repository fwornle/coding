// tests/context-turns/_helpers.mjs
//
// Phase 84, Plan 84-01 (Wave 0) — shared test harness for the context-turns
// suite. Downstream plans (84-02..84-07) un-skip the stub tests in this
// directory and drive their production assertions through these helpers.
//
// Convention: node:test + node:assert/strict (the established tests/experiments/
// house style — NOT jest globals). Pure Node stdlib (fs/os/path/url); no
// external deps, matching RESEARCH §Package Legitimacy Audit (phase installs
// nothing).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Directory holding the recorded request-body + observation fixtures. */
export const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'context-turns');

/**
 * Create an own-uid temp measurements dir that mirrors the production
 * `.data/measurements/<task_id>/` layout. Returns the dir plus a
 * `withTaskId(id)` path builder and a `cleanup()` for afterEach teardown.
 */
export function mkTmpMeasurementsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-turns-'));
  return {
    dir,
    /** Path to the per-task measurement subdir (created on demand by callers). */
    withTaskId(id) {
      return path.join(dir, String(id));
    },
    /** Best-effort recursive removal for afterEach teardown. */
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* never-throw: teardown is best-effort */
      }
    },
  };
}

/** Load a JSON fixture from tests/fixtures/context-turns/<name>. */
export function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

/** Read a .jsonl file → array of parsed objects (blank lines skipped). */
export function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}
