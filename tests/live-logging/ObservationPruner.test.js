/**
 * ObservationPruner Jest unit tests (rewritten for Phase 44 Plan 18).
 *
 * Plan 44-18 cut the pruner from a direct better-sqlite3 handle to the
 * km-core `GraphKMStore` API. This test file was rewritten from scratch
 * (decision D-44-18-05 in 44-18-AUDIT.md §10) to exercise the new contract
 * against a tmpdir-backed GraphKMStore.
 *
 * Verifies:
 *   1. Constructor rejects retentionDays < 1 with shared error message
 *      (same regex as ObservationWriter for cross-checkable invariant).
 *   2. Constructor rejects null/missing kmStore (or kmStore missing
 *      the required findByOntologyClass / deleteEntity methods).
 *   3. Module source contains zero references to the long-term-memory
 *      table name 'insights' (Phase 35 invariant #2 / CONTEXT.md L2 —
 *      carried forward from the pre-cutover test).
 *   4. Module source contains zero references to SQLite-era symbols
 *      (no `db.prepare`, no `DELETE FROM`, no `datetime('now'`) — the
 *      Plan 44-18 acceptance grep written into Jest form.
 *
 * The behavioral end-to-end tests (seed + prune + assert counts) live in
 * `tests/integration/observation-pruner.km-core.test.js` (Plan 44-18
 * Task 4) where they exercise a full GraphKMStore against the production
 * legacy-ingest adapter shape.
 *
 * ESM-only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ObservationPruner } from '../../src/live-logging/ObservationPruner.js';
// Cross-check the error-message string is shared with ObservationWriter's 35-01 invariant.
import { ObservationWriter as _ObservationWriter } from '../../src/live-logging/ObservationWriter.js';
void _ObservationWriter;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'src', 'live-logging', 'ObservationPruner.js');

/**
 * Build a minimal stub kmStore that satisfies the constructor's shape check.
 * Used only for input-validation tests; behavioral tests in the integration
 * suite use a real GraphKMStore against a tmpdir LevelDB.
 */
function stubKmStore() {
  return {
    findByOntologyClass: async () => [],
    deleteEntity: async () => true,
  };
}

describe('ObservationPruner — constructor contract (Phase 44 Plan 18)', () => {
  it('1. constructor rejects retentionDays < 1 with shared error message', () => {
    const km = stubKmStore();
    expect(() => new ObservationPruner({ kmStore: km, retentionDays: 0 })).toThrow(/retentionDays must be >= 1/);
    expect(() => new ObservationPruner({ kmStore: km, retentionDays: 0.5 })).toThrow(/retentionDays must be >= 1/);
    expect(() => new ObservationPruner({ kmStore: km, retentionDays: -3 })).toThrow(/retentionDays must be >= 1/);
    expect(() => new ObservationPruner({ kmStore: km, retentionDays: NaN })).toThrow(/retentionDays must be >= 1/);
  });

  it('2. constructor rejects null/missing/incomplete kmStore', () => {
    expect(() => new ObservationPruner({ kmStore: null, retentionDays: 7 })).toThrow();
    expect(() => new ObservationPruner({ retentionDays: 7 })).toThrow();
    // Object missing deleteEntity
    expect(() => new ObservationPruner({
      kmStore: { findByOntologyClass: async () => [] },
      retentionDays: 7,
    })).toThrow();
    // Object missing findByOntologyClass
    expect(() => new ObservationPruner({
      kmStore: { deleteEntity: async () => true },
      retentionDays: 7,
    })).toThrow();
  });

  it('3. invariant #2 — module source contains zero references to long-term-memory table name', () => {
    const src = fs.readFileSync(MODULE_PATH, 'utf-8');
    // CONTEXT.md L2 / Phase 35 invariant #2 — carried through to the
    // km-core cutover. ObservationPruner.js MUST NOT reference the
    // long-term-memory table — not in SQL, comments, JSDoc, or
    // identifiers. If this fails, the pruner has acquired an unsafe
    // surface.
    expect(src.includes('insights')).toBe(false);
  });

  it('4. Plan 44-18 cutover invariant — module source contains zero SQLite-era symbols', () => {
    const src = fs.readFileSync(MODULE_PATH, 'utf-8');
    // Plan 44-18 acceptance gates (44-18-AUDIT.md §9) — written into
    // Jest form so a future SQLite resurrection is caught at unit-test
    // time, not just in the GSD plan's manual grep gate.
    expect(/\bdb\.(prepare|exec|get|all|run)\b/.test(src)).toBe(false);
    expect(src.includes('DELETE FROM')).toBe(false);
    expect(src.includes("datetime('now'")).toBe(false);
    // Positive: kmStore must be referenced.
    expect((src.match(/kmStore/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
