/**
 * tests/live-logging/ObservationExporter.source-field.test.js
 *
 * Regression test for the json-export-missing-source-field gap surfaced
 * during Phase 51 Plan 51-16 UAT.
 *
 * The Plan 51-14 (CR-03) writer stamps `metadata.source` correctly in the
 * SQLite observations DB (verified by the AC #3 UAT — 3 fresh rows had
 * `source='sub-agent'` in the DB), but the ObservationExporter's row
 * projection was missing the `source` field — consumers reading the JSON
 * export saw `source=None` for every row. That broke any tier-filtering
 * built on top of the JSON pipeline.
 *
 * This test exercises the round-trip: seed 3 observations with different
 * `metadata.source` values, run the exporter, parse the JSON, and assert
 * each row carries the source through to the export.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { ObservationExporter } from '../../src/live-logging/ObservationExporter.js';

function seedObservationsTable(db) {
  db.exec(`
    CREATE TABLE observations (
      id TEXT PRIMARY KEY,
      summary TEXT,
      agent TEXT,
      session_id TEXT,
      source_file TEXT,
      created_at TEXT,
      content_hash TEXT,
      quality TEXT DEFAULT 'normal',
      digested_at TEXT,
      metadata TEXT
    );
  `);

  const insert = db.prepare(`
    INSERT INTO observations
      (id, summary, agent, created_at, quality, metadata)
    VALUES (?, ?, 'claude', datetime('now'), 'normal', ?)
  `);

  // Three observations spanning the producer-tier matrix:
  //   1. sub-agent live tier (Plan 51-14 stamp)
  //   2. sub-agent backfill tier (Plan 51-02 stamp)
  //   3. regular transcript-monitor (no source field — pre-Phase-51 baseline)
  insert.run('obs_live', 'live-tier summary', JSON.stringify({ source: 'sub-agent', project: 'coding' }));
  insert.run('obs_backfill', 'backfill-tier summary', JSON.stringify({ source: 'sub-agent-backfill', project: 'coding' }));
  insert.run('obs_regular', 'regular summary', JSON.stringify({ project: 'coding' }));  // no source key
}

describe('ObservationExporter — metadata.source round-trip', () => {
  let tmpDir;
  let dbPath;
  let exportDir;
  let db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'observation-exporter-source-'));
    dbPath = path.join(tmpDir, 'observations.db');
    exportDir = path.join(tmpDir, 'export');
    db = new Database(dbPath);
    seedObservationsTable(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* best effort */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  test('exporter carries metadata.source through to observations.json', () => {
    const exporter = new ObservationExporter({ db, exportDir });
    exporter.exportObservations();

    const jsonPath = path.join(exportDir, 'observations.json');
    expect(fs.existsSync(jsonPath)).toBe(true);

    const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(Array.isArray(exported)).toBe(true);
    expect(exported.length).toBe(3);

    const byId = Object.fromEntries(exported.map((r) => [r.id, r]));

    expect(byId.obs_live).toBeDefined();
    expect(byId.obs_live.source).toBe('sub-agent');

    expect(byId.obs_backfill).toBeDefined();
    expect(byId.obs_backfill.source).toBe('sub-agent-backfill');

    expect(byId.obs_regular).toBeDefined();
    // Source key absent in DB → null in export (NOT undefined / missing).
    expect(byId.obs_regular.source).toBeNull();
  });

  test('exporter projection includes a source column (defends against silent removal)', () => {
    // Source-grep gate: the exporter source MUST mention metadata.source in
    // the SELECT projection. Stronger than just the round-trip — protects
    // against someone "cleaning up" the SQL and silently dropping it.
    const exporterSrc = fs.readFileSync(
      path.join(process.cwd(), 'src', 'live-logging', 'ObservationExporter.js'),
      'utf-8',
    );
    expect(exporterSrc).toMatch(/json_extract\(metadata,\s*'\$\.source'\)\s+as\s+source/i);
  });
});

describe('ObservationExporter — dangling digest-ref strip', () => {
  let tmpDir;
  let exportDir;
  let db;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'observation-exporter-strip-'));
    exportDir = path.join(tmpDir, 'export');
    db = new Database(path.join(tmpDir, 'observations.db'));
  });
  afterEach(() => {
    try { db.close(); } catch { /* best effort */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  test('drops observationIds not in the exported set; preserves summaries & partial refs', () => {
    const exporter = new ObservationExporter({ db, exportDir });
    const digests = [
      { id: 'd1', date: '2026-01-01', theme: 't', summary: 'S1', observationIds: ['a', 'b', 'gone'] },
      { id: 'd2', date: '2026-01-02', theme: 't', summary: 'S2', observationIds: ['x-gone', 'y-gone'] },
      { id: 'd3', date: '2026-01-03', theme: 't', summary: 'S3', observationIds: [] },
    ];
    const out = exporter._stripDanglingObservationIds(digests, new Set(['a', 'b']));
    expect(out[0].observationIds).toEqual(['a', 'b']);   // 'gone' removed
    expect(out[0].summary).toBe('S1');                    // content untouched
    expect(out[1].observationIds).toEqual([]);            // fully orphaned → []
    expect(out[2]).toBe(digests[2]);                      // no refs → same object
  });

  test('SAFETY: empty id set returns digests unchanged (never strips wholesale)', () => {
    const exporter = new ObservationExporter({ db, exportDir });
    const digests = [{ id: 'd1', date: '2026-01-01', theme: 't', summary: 'S', observationIds: ['a'] }];
    expect(exporter._stripDanglingObservationIds(digests, new Set())).toBe(digests);
  });
});
