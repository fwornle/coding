/**
 * Jest integration tests for the Phase 35 plan 35-04 range-merge helpers.
 *
 * Covers the seven cases enumerated in 35-04-PLAN.md Task 2 Change 8:
 *   1. Pure SQLite path: _mergeObservations with empty coldRows.
 *   2. Pure cold path: _mergeObservations with empty sqliteRows.
 *   3. Set-based dedup invariant: shared id appears once across merged data
 *      (PLAN.md invariants #4 and #5 - the LOAD-BEARING sqliteIds Set).
 *   4. Newer-than-boundary cold rows are filtered out.
 *   5. _mergeDigests analog keyed on date.
 *   6. _computeRetentionBoundary returns a string parseable by new Date().
 *   7. Source-level offset gate: the handler conditional 'offset === 0' is
 *      present in both /api/observations and /api/digests handlers.
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

  it('case 2: pure cold path returns reshaped cold rows with fromColdStore:true and coldOnFirstPageOnly:true', () => {
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
    expect(result._metadata.coldOnFirstPageOnly).toBe(true);
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

describe('Phase 35-04: _mergeDigests', () => {
  const BOUNDARY_DATE = '2026-05-08';

  it('case 5: digests analog - keyed on date, Set-based dedup, _origin tagging', () => {
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
    expect(result._metadata.coldOnFirstPageOnly).toBe(true);
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

describe('Phase 35-04: source-level invariants', () => {
  let serverSrc;
  let mergeSrc;
  beforeAll(() => {
    serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
    mergeSrc = fs.readFileSync(MERGE_PATH, 'utf8');
  });

  it('case 7: offset === 0 gate is present in both server handlers (at least 2 occurrences)', () => {
    const matches = serverSrc.match(/offset === 0/g) || [];
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
