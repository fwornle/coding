/**
 * tests/integration/opencode-adapter-limit.test.js
 *
 * Phase 51 Plan 51-13 Task 1 (CR-01) — verifies the OpenCode sweep adapter's
 * discover() actually honors the `limit` parameter passed by the dispatcher.
 *
 * Background:
 *   The prior code read `searchPaths.limit` where `searchPaths` is an Array
 *   (see lib/lsl/adapters/index.mjs:130-134). Arrays have no `.limit`
 *   property → value was always undefined → the SQL LIMIT bind silently
 *   defaulted to 100 regardless of the dispatcher's `--limit 500` flag.
 *   The dispatcher's post-process `discovered.slice(0, limit)` couldn't
 *   recover rows the DB had already truncated.
 *
 * Fix:
 *   `discover({ searchPaths, project, since, limit })` — `limit` is now a
 *   top-level destructured parameter, with `effectiveLimit` falling back
 *   to 100 only when `limit` is missing/invalid.
 *
 * Per CLAUDE.md no-console-log: tests use stderr inspection via jest.spyOn.
 * Zero new package installs — better-sqlite3 already present (Phase 50-01).
 *
 * Mocks ObservationWriter via jest.unstable_mockModule so the per-test
 * tmpdir can run without the production observations DB.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

// ---- Mock ObservationWriter (not exercised in these tests, but importing
// the adapter pulls the lazy import path; mock pre-empts any future drift). --
jest.unstable_mockModule('../../src/live-logging/ObservationWriter.js', () => ({
  ObservationWriter: class {
    constructor(opts) { this.opts = opts; }
    async init() { /* no-op */ }
    async close() { /* no-op */ }
    async processMessages() { return { observations: 0, errors: 0 }; }
  },
}));

let adapter;
let seedOpencodeFixture;

beforeAll(async () => {
  ({ adapter } = await import('../../lib/lsl/adapters/opencode-sqlite.mjs'));
  ({ seedOpencodeFixture } = await import('../fixtures/opencode/seed-opencode-fixture.mjs'));
});

let tmpDir;
let savedEnv;
let stderrSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-limit-'));
  savedEnv = {
    LSL_OPENCODE_DB: process.env.LSL_OPENCODE_DB,
    LSL_PROJECT_ROOT_CODING: process.env.LSL_PROJECT_ROOT_CODING,
  };
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  if (stderrSpy) stderrSpy.mockRestore();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv) {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

/**
 * Seed an OpenCode fixture DB with `numSubSessions` sub-sessions in the
 * coding project directory. Returns the dbPath.
 */
function seedWithNRows(numSubSessions) {
  const dbPath = path.join(tmpDir, 'opencode.db');
  seedOpencodeFixture(dbPath, { numSubSessions });
  return dbPath;
}

describe('opencode-sqlite adapter — --limit plumb-through (CR-01)', () => {
  test('Test 1: passing limit=500 retrieves up to 500 rows (300 seeded → all 300 returned, NOT capped at 100)', async () => {
    const dbPath = seedWithNRows(300);
    process.env.LSL_PROJECT_ROOT_CODING = '/Users/Q284340/Agentic/coding';

    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
      since: null,
      limit: 500,
    });

    // CR-01 regression guard: if the SQL bind reverts to a hardcoded 100,
    // this assertion drops to exactly 100. With the fix, all 300 seeded
    // sub-sessions come through because limit=500 > 300.
    expect(rows.length).toBe(300);
  });

  test('Test 2: omitting limit defaults to 100 rows (regression guard for the existing default)', async () => {
    const dbPath = seedWithNRows(300);
    process.env.LSL_PROJECT_ROOT_CODING = '/Users/Q284340/Agentic/coding';

    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
      since: null,
      // limit intentionally omitted
    });

    // Default is 100 — DO NOT remove this assertion. If the default ever
    // changes, this test must be updated AND the new value documented.
    expect(rows.length).toBe(100);
  });

  test('Test 3: limit=0 (falsy/invalid) falls back to default 100 (defensive)', async () => {
    const dbPath = seedWithNRows(150);
    process.env.LSL_PROJECT_ROOT_CODING = '/Users/Q284340/Agentic/coding';

    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
      since: null,
      limit: 0,
    });

    // `limit > 0` guard catches zero/negative and applies the default 100.
    expect(rows.length).toBe(100);
  });

  test('Test 4: SQL LIMIT bind variable receives the effective limit (probe via better-sqlite3)', async () => {
    // Defense-in-depth: prove the SQL LIMIT bind is the value we asked for,
    // not a magic constant. We probe by seeding exactly limit+5 rows then
    // asserting we got exactly limit back.
    const dbPath = seedWithNRows(155);
    process.env.LSL_PROJECT_ROOT_CODING = '/Users/Q284340/Agentic/coding';

    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
      since: null,
      limit: 150,
    });

    expect(rows.length).toBe(150);

    // And cross-check the DB really did have 155 sub-sessions waiting (so
    // the cap was the SQL LIMIT, not the seed count).
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    const { c } = probe.prepare(
      'SELECT COUNT(*) AS c FROM session WHERE parent_id IS NOT NULL'
    ).get();
    probe.close();
    expect(c).toBe(155);
  });
});
