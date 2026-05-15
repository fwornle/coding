/**
 * Jest integration tests for the Phase 35 range-merge helpers.
 *
 * History:
 *   - 35-04 introduced the offset==0-only-cold contract and the seven base cases.
 *   - 35-06 added paginable-total accounting for that contract.
 *   - 35-07 REPLACED the contract with full-union pagination. Existing tests
 *     that asserted the Option-B-specific shape (`coldOnFirstPageOnly: true`,
 *     "offset > 0 = sqlite only", "total = sqlite + min(coldCapacity)") have
 *     been updated to assert the new shape. Three new tests cover the
 *     full-union guarantees:
 *       (A) Page past the SQLite tail still contains cold rows.
 *       (B) Total reports the dedup'd union size (collisions counted once).
 *       (C) Concatenating every page yields the dedup'd union with no drops.
 *
 * Helpers live in scripts/observations-api-merge.mjs (Phase 35 plan 35-04 also
 * extracted them into a sibling module so this test does not have to import
 * the full obs-api server module - which would pull in RetrievalService and
 * a TS dist embedding-service.js that Jest cannot resolve at test time).
 * The obs-api server re-exports the same symbols for any direct caller.
 *
 * ESM project, top-level imports. Jest is invoked with
 *   NODE_OPTIONS='--experimental-vm-modules --no-warnings' jest --no-coverage
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import {
  _mergeObservations,
  _mergeDigests,
  _computeRetentionBoundary,
} from '../../scripts/observations-api-merge.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_PATH = path.join(REPO_ROOT, 'scripts', 'observations-api-server.mjs');
const MERGE_PATH = path.join(REPO_ROOT, 'scripts', 'observations-api-merge.mjs');

describe('Phase 35-04: _mergeObservations', () => {
  const BOUNDARY = '2026-05-08T00:00:00.000Z';

  it('case 1: pure SQLite path returns sqliteRows unchanged with fromColdStore:false', () => {
    const sqliteRows = [
      { id: 'a', content: 'hello', agent: 'claude', timestamp: '2026-05-12T00:00:00.000Z' },
      { id: 'b', content: 'world', agent: 'claude', timestamp: '2026-05-11T00:00:00.000Z' },
    ];
    const result = _mergeObservations(sqliteRows, [], BOUNDARY);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('a');
    expect(result._metadata.fromColdStore).toBe(false);
    expect(result._metadata.coldRows).toBe(0);
    expect(result._metadata.sqliteRows).toBe(2);
    expect(result._metadata.retentionBoundary).toBe(BOUNDARY);
  });

  it('case 2 (35-07 contract): pure cold path returns reshaped cold rows with fromColdStore:true and coldOnFirstPageOnly:false', () => {
    const coldRows = [
      { id: 'x', summary: 'archived', agent: 'gemini', project: 'coding', createdAt: '2026-04-01T00:00:00.000Z', quality: 'normal', llm: { model: 'gemini-1.5-pro', provider: 'google' } },
    ];
    const result = _mergeObservations([], coldRows, BOUNDARY);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('x');
    expect(result.data[0].content).toBe('archived');
    expect(result.data[0].llmModel).toBe('gemini-1.5-pro');
    expect(result.data[0].llmProvider).toBe('google');
    expect(result.data[0]._origin).toBe('cold');
    expect(result._metadata.fromColdStore).toBe(true);
    // Phase 35-07: contract changed — cold rows can appear on any page now.
    expect(result._metadata.coldOnFirstPageOnly).toBe(false);
    expect(result._metadata.coldRows).toBe(1);
  });

  it('case 3 (CRITICAL invariant #4/#5): shared id appears exactly once - Set-based dedup is LOAD-BEARING', () => {
    const sqliteRows = [{ id: 'a', content: 'sqlite version', agent: 'claude', timestamp: '2026-05-12T00:00:00.000Z' }];
    const coldRows = [
      { id: 'a', summary: 'duplicate', agent: 'claude', project: null, createdAt: '2026-05-07T00:00:00.000Z', quality: 'normal', llm: null },
      { id: 'b', summary: 'historical', agent: 'claude', project: null, createdAt: '2026-04-01T00:00:00.000Z', quality: 'normal', llm: null },
    ];
    const result = _mergeObservations(sqliteRows, coldRows, BOUNDARY);
    const ids = result.data.map(r => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    // The SQLite row wins (its _origin is sqlite, not cold).
    const aRow = result.data.find(r => r.id === 'a');
    expect(aRow._origin).toBe('sqlite');
  });

  it('case 4: cold rows newer than retention boundary are filtered out', () => {
    const coldRows = [
      { id: 'c', summary: 'too new', agent: 'claude', project: null, createdAt: '2026-05-14T00:00:00.000Z', quality: 'normal', llm: null },
    ];
    const result = _mergeObservations([], coldRows, BOUNDARY);
    expect(result.data).toHaveLength(0);
    expect(result._metadata.coldRows).toBe(0);
    expect(result._metadata.fromColdStore).toBe(false);
  });
});

describe('Phase 35-07: full-union pagination for _mergeObservations', () => {
  const BOUNDARY = '2026-05-08T00:00:00.000Z';

  // Helper: generate N cold rows older than the boundary, in DESC timestamp order.
  function makeColdRows(n, prefix = 'c') {
    const rows = [];
    for (let i = 0; i < n; i++) {
      // Stagger backwards from 2026-04-30 so all are strictly older than BOUNDARY.
      const day = String(20 - (i % 20)).padStart(2, '0');  // 20..01 cycles
      const month = String(4 - Math.floor(i / 20)).padStart(2, '0');  // 04, 03, ...
      rows.push({
        id: `${prefix}${i}`,
        summary: `cold ${i}`,
        agent: 'claude',
        project: null,
        createdAt: `2026-${month}-${day}T00:00:00.${String(i % 1000).padStart(3, '0')}Z`,
        quality: 'normal',
        llm: null,
      });
    }
    return rows;
  }

  // Helper: generate N SQLite rows newer than the boundary.
  function makeSqliteRows(n, prefix = 's') {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        id: `${prefix}${i}`,
        content: `sqlite ${i}`,
        agent: 'claude',
        timestamp: `2026-05-12T00:00:0${i}.000Z`,
      });
    }
    return rows;
  }

  test('Phase 35-07: page 0 contains sqlite-then-cold; total = full union size; data sliced to limit', () => {
    // 5 SQLite (newer) + 100 cold (older, all past boundary). Limit=10, offset=0.
    // Sorted DESC: 5 sqlite on top, then 5 cold fill page 0 to limit=10.
    // Total = 5 + 100 = 105 (the FULL dedup'd union, what pagination walks).
    const sqliteRows = makeSqliteRows(5);
    const coldRows = makeColdRows(100);
    const result = _mergeObservations(sqliteRows, coldRows, BOUNDARY, {
      limit: 10, offset: 0,
    });
    expect(result.total).toBe(105);
    expect(result.data).toHaveLength(10);
    // First 5 of page 0 are SQLite (newer timestamps), next 5 are cold.
    const origins = result.data.map(r => r._origin);
    expect(origins.slice(0, 5)).toEqual(['sqlite', 'sqlite', 'sqlite', 'sqlite', 'sqlite']);
    expect(origins.slice(5).every(o => o === 'cold')).toBe(true);
    // Raw cold count surfaced for observability.
    expect(result._metadata.coldRows).toBe(100);
    // Phase 35-07 contract change.
    expect(result._metadata.fromColdStore).toBe(true);
    expect(result._metadata.coldOnFirstPageOnly).toBe(false);
  });

  test('Phase 35-07: page at offset>0 returns a window into the union; total stays at union size', () => {
    // 50 SQLite + 100 cold = 150 union. Limit=10, offset=10.
    // Page 0 would be 10 sqlite. Page 1 (offset=10) is sqlite rows 10..19.
    // Total is the FULL union (150), not just sqlite (50).
    const sqliteRows = makeSqliteRows(50);
    const coldRows = makeColdRows(100);
    const result = _mergeObservations(sqliteRows, coldRows, BOUNDARY, {
      limit: 10, offset: 10,
    });
    expect(result.total).toBe(150);
    expect(result.data).toHaveLength(10);
    // Raw cold count still reported.
    expect(result._metadata.coldRows).toBe(100);
  });

  test('Phase 35-07 edge: range entirely older than retention — total = cold count, page 0 holds the 10 newest cold rows', () => {
    // 0 SQLite + 100 cold. Limit=10, offset=0. Total = 100 (full union),
    // page 0 contains the 10 newest cold rows (sorted DESC).
    const coldRows = makeColdRows(100);
    const result = _mergeObservations([], coldRows, BOUNDARY, {
      limit: 10, offset: 0,
    });
    expect(result.total).toBe(100);
    expect(result.data).toHaveLength(10);
    expect(result.data.every(r => r._origin === 'cold')).toBe(true);
    expect(result._metadata.coldRows).toBe(100);
    expect(result._metadata.fromColdStore).toBe(true);
    // Sanity: legacy 3-arg call still works (no `total` field).
    const legacy = _mergeObservations([], coldRows, BOUNDARY);
    expect(legacy.total).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Three NEW Phase 35-07 cases.
  // ------------------------------------------------------------------

  test('Phase 35-07 (NEW A): page past the SQLite tail still contains cold rows', () => {
    // 5 SQLite + 20 cold = 25 union. Limit=10, offset=10. Page 1 is entirely
    // past the SQLite tail (5 sqlite all on page 0), so the page is 10 cold rows.
    const sqliteRows = makeSqliteRows(5);
    const coldRows = makeColdRows(20);
    const result = _mergeObservations(sqliteRows, coldRows, BOUNDARY, {
      limit: 10, offset: 10,
    });
    expect(result.total).toBe(25);
    expect(result.data).toHaveLength(10);
    // EVERY row on page 1 is cold under this fixture — SQLite rows live on page 0.
    expect(result.data.every(r => r._origin === 'cold')).toBe(true);
    // At least one cold row present (the actual user-facing assertion).
    expect(result.data.some(r => r._origin === 'cold')).toBe(true);
  });

  test('Phase 35-07 (NEW B): total reports dedup\'d union size — colliding ids counted once', () => {
    // 5 SQLite + 5 cold with 2 colliding ids. Union after dedup = 5 + 3 = 8.
    const sqliteRows = [
      { id: 's0', content: 'sql0', agent: 'claude', timestamp: '2026-05-12T00:00:04.000Z' },
      { id: 's1', content: 'sql1', agent: 'claude', timestamp: '2026-05-12T00:00:03.000Z' },
      { id: 'dup1', content: 'sql-dup1', agent: 'claude', timestamp: '2026-05-12T00:00:02.000Z' },
      { id: 'dup2', content: 'sql-dup2', agent: 'claude', timestamp: '2026-05-12T00:00:01.000Z' },
      { id: 's2', content: 'sql2', agent: 'claude', timestamp: '2026-05-12T00:00:00.000Z' },
    ];
    const coldRows = [
      // Two cold rows share ids with sqlite — dedup must drop them.
      { id: 'dup1', summary: 'cold-dup1', agent: 'claude', project: null, createdAt: '2026-04-20T00:00:00.000Z', quality: 'normal', llm: null },
      { id: 'dup2', summary: 'cold-dup2', agent: 'claude', project: null, createdAt: '2026-04-19T00:00:00.000Z', quality: 'normal', llm: null },
      { id: 'c0',   summary: 'cold0',     agent: 'claude', project: null, createdAt: '2026-04-18T00:00:00.000Z', quality: 'normal', llm: null },
      { id: 'c1',   summary: 'cold1',     agent: 'claude', project: null, createdAt: '2026-04-17T00:00:00.000Z', quality: 'normal', llm: null },
      { id: 'c2',   summary: 'cold2',     agent: 'claude', project: null, createdAt: '2026-04-16T00:00:00.000Z', quality: 'normal', llm: null },
    ];
    const result = _mergeObservations(sqliteRows, coldRows, BOUNDARY, {
      limit: 50, offset: 0,
    });
    // Union after dedup = 5 sqlite + 3 cold (2 collisions dropped) = 8.
    expect(result.total).toBe(8);
    expect(result.data).toHaveLength(8);
    // Colliding ids appear exactly once and resolve to sqlite (sqlite wins).
    const ids = result.data.map(r => r.id);
    expect(new Set(ids).size).toBe(8);
    const dup1Row = result.data.find(r => r.id === 'dup1');
    expect(dup1Row._origin).toBe('sqlite');
    expect(dup1Row.content).toBe('sql-dup1');
    // _metadata.coldRows reports POST-dedup safe-cold count (3, not 5).
    expect(result._metadata.coldRows).toBe(3);
  });

  test('Phase 35-07 (NEW C): concatenating every page yields the full dedup\'d union, no rows dropped', () => {
    // 15 SQLite + 20 cold = 35 union. Walk pages 0..3 at limit=10.
    const sqliteRows = makeSqliteRows(15);
    const coldRows = makeColdRows(20);
    const allRows = [];
    const expectedTotal = 35;
    for (const offset of [0, 10, 20, 30]) {
      const page = _mergeObservations(sqliteRows, coldRows, BOUNDARY, { limit: 10, offset });
      expect(page.total).toBe(expectedTotal);
      allRows.push(...page.data);
    }
    expect(allRows).toHaveLength(35);
    const ids = allRows.map(r => r.id);
    expect(new Set(ids).size).toBe(35);
    // Every sqlite id present once.
    for (let i = 0; i < 15; i++) {
      expect(ids).toContain(`s${i}`);
    }
    // Every cold id present once.
    for (let i = 0; i < 20; i++) {
      expect(ids).toContain(`c${i}`);
    }
  });
});

describe('Phase 35-04: _mergeDigests', () => {
  const BOUNDARY_DATE = '2026-05-08';

  it('case 5 (35-07 contract): digests analog - keyed on date, Set-based dedup, _origin tagging, coldOnFirstPageOnly:false', () => {
    const sqliteRows = [
      { id: 'd1', date: '2026-05-12', theme: 'recent', summary: 's1', project: 'coding' },
    ];
    const coldRows = [
      { id: 'd1', date: '2026-05-12', theme: 'dup', summary: 'dup', project: 'coding', observationIds: [], agents: [], filesTouched: [], quality: 'normal', createdAt: '2026-05-12T00:00:00.000Z' },
      { id: 'd2', date: '2026-04-01', theme: 'old', summary: 'archived', project: 'coding', observationIds: ['o1','o2'], agents: ['claude'], filesTouched: ['file.js'], quality: 'normal', createdAt: '2026-04-01T00:00:00.000Z' },
      { id: 'd3', date: '2026-05-09', theme: 'too new', summary: 'after boundary', project: 'coding', observationIds: [], agents: [], filesTouched: [], quality: 'normal', createdAt: '2026-05-09T00:00:00.000Z' },
    ];
    const result = _mergeDigests(sqliteRows, coldRows, BOUNDARY_DATE);
    const ids = result.data.map(r => r.id);
    // d1 sqlite kept (dedup), d2 cold kept (older than boundary), d3 cold dropped (newer).
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('d1');
    expect(ids).toContain('d2');
    expect(ids).not.toContain('d3');
    const d1Row = result.data.find(r => r.id === 'd1');
    expect(d1Row._origin).toBe('sqlite');
    expect(d1Row.summary).toBe('s1');  // sqlite wins
    const d2Row = result.data.find(r => r.id === 'd2');
    expect(d2Row._origin).toBe('cold');
    expect(d2Row.observationIds).toEqual(['o1','o2']);
    expect(d2Row.agents).toEqual(['claude']);
    expect(d2Row.filesTouched).toEqual(['file.js']);
    expect(result._metadata.fromColdStore).toBe(true);
    // Phase 35-07: contract changed.
    expect(result._metadata.coldOnFirstPageOnly).toBe(false);
    expect(result._metadata.coldRows).toBe(1);
    expect(result._metadata.sqliteRows).toBe(1);
  });
});

describe('Phase 35-04: _computeRetentionBoundary', () => {
  let db;
  beforeAll(() => { db = new Database(':memory:'); });
  afterAll(() => { db.close(); });

  it('case 6: returns ISO-8601 string parseable by new Date()', () => {
    const boundary = _computeRetentionBoundary(db, 7);
    expect(typeof boundary).toBe('string');
    const parsed = new Date(boundary);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(boundary).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Boundary is 7 days ago - sanity check it is in the past.
    expect(parsed.getTime()).toBeLessThan(Date.now());
    // And not absurdly far in the past (allow 30s skew for slow test runners).
    const expectedMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(parsed.getTime() - expectedMs)).toBeLessThan(30_000);
  });

  it('different retentionDays values produce different boundaries', () => {
    const b7 = _computeRetentionBoundary(db, 7);
    const b14 = _computeRetentionBoundary(db, 14);
    expect(new Date(b14).getTime()).toBeLessThan(new Date(b7).getTime());
  });
});

describe('Phase 35-07: source-level invariants', () => {
  let serverSrc;
  let mergeSrc;
  beforeAll(() => {
    serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
    mergeSrc = fs.readFileSync(MERGE_PATH, 'utf8');
  });

  it('Phase 35-07 contract: offset===0 gate has been removed from cold-store branch in both handlers', () => {
    // The Phase 35-04 gate was `if (from && offset === 0 && _writer?.retentionDays)`.
    // Under 35-07 the gate is `if (from && _writer?.retentionDays)` — no offset clause.
    // Zero occurrences of the offset==0 conjunction in cold-store gate context.
    const matches = serverSrc.match(/offset === 0 && _writer\?\.retentionDays/g) || [];
    expect(matches).toHaveLength(0);
    // And the new gate shape is present at least twice (observations + digests).
    const newGate = serverSrc.match(/from && _writer\?\.retentionDays/g) || [];
    expect(newGate.length).toBeGreaterThanOrEqual(2);
  });

  it('Phase 35-07: merge module sets coldOnFirstPageOnly to false (contract change)', () => {
    const matches = mergeSrc.match(/coldOnFirstPageOnly:\s*false/g) || [];
    // Once in each helper.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('LOAD-BEARING Set comment is present in the merge module (invariant #5 protection)', () => {
    expect(/LOAD-BEARING/.test(mergeSrc)).toBe(true);
  });

  it('Set-based dedup pattern is present in both merge helpers', () => {
    const setPattern = /new Set\(sqliteRows\.map\(r => r\.id\)\)/g;
    const matches = mergeSrc.match(setPattern) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('merge helpers are exported from the merge module', () => {
    expect(/export\s+function\s+_mergeObservations/.test(mergeSrc)).toBe(true);
    expect(/export\s+function\s+_mergeDigests/.test(mergeSrc)).toBe(true);
    expect(/export\s+function\s+_computeRetentionBoundary/.test(mergeSrc)).toBe(true);
  });

  it('obs-api server re-exports the merge helpers for back-compat', () => {
    expect(/export\s*\{[^}]*_mergeObservations[^}]*\}/.test(serverSrc)).toBe(true);
    expect(/export\s*\{[^}]*_mergeDigests[^}]*\}/.test(serverSrc)).toBe(true);
    expect(/export\s*\{[^}]*_computeRetentionBoundary[^}]*\}/.test(serverSrc)).toBe(true);
  });
});
