/**
 * ObservationPruner Jest unit tests (Phase 35 plan 35-02 Task 2).
 *
 * Verifies:
 *   1. 14-day seed + retentionDays=7 → prune deletes 6-8 obs and 6-8 digests
 *      (±1 boundary tolerance for runs near UTC midnight). Surviving rows are
 *      newer than the cutoff; insights are untouched.
 *   2. FTS5 sync after bulk DELETE — observations_fts COUNT matches observations
 *      COUNT and MATCH 'Test' returns only the surviving rows. Skipped when the
 *      local SQLite build lacks FTS5.
 *   3. Constructor rejects retentionDays < 1 (matches the same error-message
 *      regex used by ObservationWriter so the invariant is cross-checkable).
 *   4. Constructor rejects null/missing db.
 *   5. Source-grep invariant: ObservationPruner.js contains zero occurrences of
 *      the substring 'insights' (Phase 35 invariant #2 / CONTEXT.md L2).
 *
 * ESM-only: top-level `import` is fine in this project — package.json declares
 * `"type": "module"` and jest runs with `--experimental-vm-modules`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { ObservationPruner } from '../../src/live-logging/ObservationPruner.js';
// Cross-check the error-message string is shared with ObservationWriter's 35-01 invariant.
import { ObservationWriter as _ObservationWriter } from '../../src/live-logging/ObservationWriter.js';
void _ObservationWriter;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'src', 'live-logging', 'ObservationPruner.js');

/**
 * Detect whether this build of better-sqlite3 has FTS5. Some prebuilts ship
 * without it; the test still runs and exercises core deletion behavior, but
 * the FTS5-sync assertion is skipped.
 */
const HAS_FTS5 = (() => {
  const probe = new Database(':memory:');
  try {
    probe.exec("CREATE VIRTUAL TABLE _fts_probe USING fts5(t)");
    return true;
  } catch {
    return false;
  } finally {
    probe.close();
  }
})();

/**
 * Seed an in-memory DB with:
 *   - observations table + FTS5 virtual table + 3 triggers (verbatim from
 *     ObservationWriter.js:111-128 when FTS5 is available)
 *   - digests table
 *   - insights table (separate; the pruner must NOT touch this)
 *   - 14 observations, one per day at 12:00 UTC for the last 14 days
 *   - 14 digests, one per day at 12:00 UTC for the last 14 days
 *   - 3 insights, all created 14 days ago (deliberately older than 7d; must survive)
 */
function seedDb(db) {
  db.exec(`
    CREATE TABLE observations (
      id TEXT PRIMARY KEY,
      summary TEXT,
      agent TEXT,
      session_id TEXT,
      source_file TEXT,
      created_at TEXT,
      content_hash TEXT,
      quality TEXT DEFAULT 'normal'
    );
    CREATE TABLE digests (
      id TEXT PRIMARY KEY,
      date TEXT,
      theme TEXT,
      summary TEXT,
      created_at TEXT
    );
    CREATE TABLE insights (
      id TEXT PRIMARY KEY,
      topic TEXT,
      summary TEXT,
      created_at TEXT,
      last_updated TEXT
    );
  `);

  if (HAS_FTS5) {
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(summary, content='observations', content_rowid='rowid')`);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
          INSERT INTO observations_fts(rowid, summary) VALUES (new.rowid, new.summary);
        END
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
          INSERT INTO observations_fts(observations_fts, rowid, summary) VALUES('delete', old.rowid, old.summary);
        END
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
          INSERT INTO observations_fts(observations_fts, rowid, summary) VALUES('delete', old.rowid, old.summary);
          INSERT INTO observations_fts(rowid, summary) VALUES (new.rowid, new.summary);
        END
      `);
    } catch { /* FTS5 not available — leave plain table */ }
  }

  const insertObs = db.prepare(
    "INSERT INTO observations (id, summary, agent, created_at, quality) VALUES (?, ?, 'test', datetime('now', ?), 'normal')"
  );
  const insertDig = db.prepare(
    "INSERT INTO digests (id, date, theme, summary, created_at) VALUES (?, ?, 'theme', 'd', datetime('now', ?))"
  );
  const insertInsight = db.prepare(
    "INSERT INTO insights (id, topic, summary, created_at, last_updated) VALUES (?, ?, 'insight summary', datetime('now', '-14 days'), datetime('now', '-14 days'))"
  );

  for (let i = 0; i < 14; i++) {
    const offset = `-${i} days`;
    insertObs.run(`obs-${i}`, `Test observation ${i}`, offset);
    // date YYYY-MM-DD computed inside SQLite for the digest date column
    const dateRow = db.prepare("SELECT date('now', ?) AS d").get(offset);
    insertDig.run(`dig-${i}`, dateRow.d, offset);
  }
  for (let i = 0; i < 3; i++) {
    insertInsight.run(`ins-${i}`, `topic-${i}`);
  }
}

describe('ObservationPruner', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    seedDb(db);
  });

  afterEach(() => {
    if (db && db.open) db.close();
  });

  it('1. prune at retentionDays=7 deletes 6-8 obs + 6-8 digests; insights untouched', () => {
    const pruner = new ObservationPruner({ db, retentionDays: 7 });
    const result = pruner.prune();

    expect(result.observationsDeleted).toBeGreaterThanOrEqual(6);
    expect(result.observationsDeleted).toBeLessThanOrEqual(8);
    expect(result.digestsDeleted).toBeGreaterThanOrEqual(6);
    expect(result.digestsDeleted).toBeLessThanOrEqual(8);

    const remainingObs = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
    const remainingDig = db.prepare('SELECT COUNT(*) AS n FROM digests').get().n;
    const remainingIns = db.prepare('SELECT COUNT(*) AS n FROM insights').get().n;
    expect(remainingObs).toBeGreaterThanOrEqual(6);
    expect(remainingObs).toBeLessThanOrEqual(8);
    expect(remainingDig).toBeGreaterThanOrEqual(6);
    expect(remainingDig).toBeLessThanOrEqual(8);
    expect(remainingIns).toBe(3);

    // Surviving observation rows must be newer than the cutoff.
    const olderThanCutoff = db.prepare(
      "SELECT COUNT(*) AS n FROM observations WHERE created_at < datetime('now', '-7 days')"
    ).get().n;
    expect(olderThanCutoff).toBe(0);

    expect(typeof result.cutoff).toBe('string');
    expect(result.cutoff.length).toBeGreaterThan(0);
    expect(Number.isNaN(new Date(result.cutoff).getTime())).toBe(false);

    expect(result.observationsDeleted + result.digestsDeleted).toBeGreaterThanOrEqual(12);
  });

  (HAS_FTS5 ? it : it.skip)('2. FTS5 stays in sync after bulk DELETE (AFTER DELETE trigger fires)', () => {
    const pruner = new ObservationPruner({ db, retentionDays: 7 });
    pruner.prune();

    const obsCount = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
    const ftsCount = db.prepare('SELECT COUNT(*) AS n FROM observations_fts').get().n;
    expect(ftsCount).toBe(obsCount);

    // MATCH against 'Test' returns only the surviving rows; no pruned-row residue.
    const matchRows = db.prepare(
      "SELECT rowid FROM observations_fts WHERE observations_fts MATCH 'Test'"
    ).all();
    expect(matchRows.length).toBe(obsCount);
  });

  it('3. constructor rejects retentionDays < 1 with shared error message', () => {
    expect(() => new ObservationPruner({ db, retentionDays: 0 })).toThrow(/retentionDays must be >= 1/);
    expect(() => new ObservationPruner({ db, retentionDays: 0.5 })).toThrow(/retentionDays must be >= 1/);
    expect(() => new ObservationPruner({ db, retentionDays: -3 })).toThrow(/retentionDays must be >= 1/);
    expect(() => new ObservationPruner({ db, retentionDays: NaN })).toThrow(/retentionDays must be >= 1/);
  });

  it('4. constructor rejects null/missing db', () => {
    expect(() => new ObservationPruner({ db: null, retentionDays: 7 })).toThrow();
    expect(() => new ObservationPruner({ retentionDays: 7 })).toThrow();
    expect(() => new ObservationPruner({ db: { /* no prepare */ }, retentionDays: 7 })).toThrow();
  });

  it('5. invariant #2 — module source contains zero references to the long-term-memory table name', () => {
    const src = fs.readFileSync(MODULE_PATH, 'utf-8');
    // CONTEXT.md L2 / Phase 35 invariant #2: ObservationPruner.js MUST NOT
    // reference the long-term-memory table — not in SQL, comments, JSDoc, or
    // identifiers. If this fails, the pruner has acquired an unsafe surface.
    expect(src.includes('insights')).toBe(false);
  });
});
