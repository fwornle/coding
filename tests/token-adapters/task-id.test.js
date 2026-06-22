/**
 * tests/token-adapters/task-id.test.js
 *
 * Phase 69, Plan 69-02, Task 2 — unit tests for the single-reader live
 * task_id resolver (`lib/lsl/token/task-id.mjs`).
 *
 * Covers:
 *   1.  With LLM_PROXY_DIST_DIR pointed at a temp stub module exporting
 *       `resolveLiveTaskId: () => 'task-abc'`, resolveLiveTaskIdSafe returns
 *       'task-abc' (the single span reader, D-03).
 *   2.  With the stub's resolveLiveTaskId THROWING, it returns '' and does not
 *       throw (best-effort, never throws — T-69-span).
 *   3.  With LLM_PROXY_DIST_DIR pointed at a nonexistent path it returns ''
 *       (import failure is non-fatal).
 *
 * Each test reimports the module fresh (jest.resetModules) so the per-module
 * memoization of the imported dist module never leaks a stub across cases.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

const MODULE_PATH = '../../lib/lsl/token/task-id.mjs';

/** Write a temp dist dir whose measurement-span.js exports the given body. */
function makeStubDist(spanJs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-id-test-'));
  fs.writeFileSync(path.join(dir, 'measurement-span.js'), spanJs, 'utf8');
  return dir;
}

const origDistDir = process.env.LLM_PROXY_DIST_DIR;

afterEach(() => {
  if (origDistDir === undefined) delete process.env.LLM_PROXY_DIST_DIR;
  else process.env.LLM_PROXY_DIST_DIR = origDistDir;
});

test('resolveLiveTaskIdSafe returns the value from the single span reader', async () => {
  jest.resetModules();
  const dir = makeStubDist(
    "export function resolveLiveTaskId() { return 'task-abc'; }\n",
  );
  process.env.LLM_PROXY_DIST_DIR = dir;
  try {
    const { resolveLiveTaskIdSafe } = await import(MODULE_PATH);
    const id = await resolveLiveTaskIdSafe();
    expect(id).toBe('task-abc');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLiveTaskIdSafe returns "" and does not throw when the reader throws', async () => {
  jest.resetModules();
  const dir = makeStubDist(
    "export function resolveLiveTaskId() { throw new Error('boom'); }\n",
  );
  process.env.LLM_PROXY_DIST_DIR = dir;
  try {
    const { resolveLiveTaskIdSafe } = await import(MODULE_PATH);
    let result;
    await expect(
      (async () => {
        result = await resolveLiveTaskIdSafe();
      })(),
    ).resolves.toBeUndefined();
    expect(result).toBe('');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLiveTaskIdSafe returns "" when the dist path does not exist', async () => {
  jest.resetModules();
  process.env.LLM_PROXY_DIST_DIR = path.join(
    os.tmpdir(),
    'task-id-nonexistent-' + Date.now(),
  );
  const { resolveLiveTaskIdSafe } = await import(MODULE_PATH);
  const id = await resolveLiveTaskIdSafe();
  expect(id).toBe('');
});
