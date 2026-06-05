/**
 * tests/integration/observation-pruner.km-core.test.js
 *
 * Phase 44 Plan 18 (Task 4) — end-to-end behavioral test for the km-core
 * cutover of ObservationPruner. Pre-cutover the pruner ran two SQL DELETEs
 * inside a single better-sqlite3 transaction; post-cutover it iterates
 * `findByOntologyClass('Observation' | 'Digest')`, filters on top-level
 * `entity.createdAt < cutoffISO`, and issues `deleteEntity(id)` calls in
 * 100-id `Promise.all` chunks.
 *
 * SCOPE:
 *   * Spin up a tmpdir-backed GraphKMStore.
 *   * Seed 1000 Observation entities with `createdAt` spanning the retention
 *     boundary (500 with createdAt 30d-old; 500 with createdAt 1d-old).
 *   * Run prune with retentionDays=7.
 *   * Assert exactly the 500 old observations are deleted.
 *   * Assert the 500 fresh observations survive.
 *   * Repeat for Digest entities.
 *   * Perf gate (T-44-18-01): 1000-obs prune ≤ 1s on this machine.
 *
 * Jest 29 ESM. Dynamic km-core import to defer module resolution to runtime.
 */

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origStderrWrite = process.stderr.write.bind(process.stderr);
let _quietStderr = false;
process.stderr.write = function quietWrap(chunk, ...rest) {
  if (
    _quietStderr &&
    typeof chunk === 'string' &&
    chunk.startsWith('[ObservationPruner]')
  ) {
    return true;
  }
  return origStderrWrite(chunk, ...rest);
};

describe('ObservationPruner → km-core (Phase 44 Plan 18)', () => {
  let dataDir;
  let kmStore;
  let GraphKMStore;
  let defaultOntologyDir;
  let ObservationPruner;

  // Compute timestamps once. Old = 30 days ago; Fresh = 1 day ago; cutoff
  // = 7 days ago. The pruner uses Date.now() internally, so we don't fix
  // a wall-clock reference here — the relative offsets cover the
  // ±1-minute test runtime drift.
  const DAY = 86400000;
  const oldISO = new Date(Date.now() - 30 * DAY).toISOString();
  const freshISO = new Date(Date.now() - 1 * DAY).toISOString();

  beforeAll(async () => {
    _quietStderr = true;
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    const prunerModule = await import('../../src/live-logging/ObservationPruner.js');
    ObservationPruner = prunerModule.ObservationPruner;

    dataDir = mkdtempSync(path.join(tmpdir(), 'pruner-test-'));
    const kmDbPath = path.join(dataDir, 'km', 'leveldb');
    const kmExportDir = path.join(dataDir, 'km', 'exports');
    mkdirSync(kmDbPath, { recursive: true });
    mkdirSync(kmExportDir, { recursive: true });

    const ontologyDir = defaultOntologyDir();
    kmStore = new GraphKMStore({
      dbPath: kmDbPath,
      exportDir: kmExportDir,
      ontologyDir,
    });
    await kmStore.open();
  }, 60000);

  afterAll(async () => {
    try {
      if (kmStore) await kmStore.close();
    } catch { /* best-effort */ }
    try {
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
    _quietStderr = false;
    process.stderr.write = origStderrWrite;
  });

  /**
   * Seed `n` entities of `cls` ('Observation' | 'Digest') with the given
   * createdAt ISO timestamp. legacyId is unique per entity (legacy-ingest
   * convention: { system: 'A', id }).
   */
  async function seed(cls, n, createdAt, prefix) {
    for (let i = 0; i < n; i++) {
      const legacyId = `${prefix}-${i}`;
      await kmStore.putEntity(
        {
          name: `${cls}-${legacyId}`,
          entityType: cls,
          ontologyClass: cls,
          layer: cls === 'Observation' ? 'evidence' : 'pattern',
          description: `${cls} ${legacyId}`,
          metadata: {
            summary: `summary-${legacyId}`,
            createdAt,
          },
          legacyId: { system: 'A', id: legacyId },
          createdAt,
          updatedAt: createdAt,
          validFrom: createdAt,
        },
        { skipOntologyCheck: true }
      );
    }
  }

  test('1. constructor accepts a kmStore and retentionDays >= 1', () => {
    const p = new ObservationPruner({ kmStore, retentionDays: 7 });
    expect(p).toBeDefined();
    expect(p.retentionDays).toBe(7);
    expect(p.kmStore).toBe(kmStore);
  });

  test('2. prune deletes only Observation entities older than the cutoff', async () => {
    // Clear state — find and delete any Observation entity from prior tests.
    for (const e of await kmStore.findByOntologyClass('Observation')) {
      await kmStore.deleteEntity(e.id);
    }
    // 10 old + 10 fresh observations (small N — verifying selectivity, not perf)
    await seed('Observation', 10, oldISO, 'obs-old');
    await seed('Observation', 10, freshISO, 'obs-fresh');

    const pruner = new ObservationPruner({ kmStore, retentionDays: 7 });
    const result = await pruner.prune();

    expect(result.observationsDeleted).toBe(10);
    expect(result.digestsDeleted).toBe(0); // no digests seeded yet
    expect(typeof result.cutoff).toBe('string');
    expect(Number.isFinite(new Date(result.cutoff).getTime())).toBe(true);

    // Survivors: exactly the 10 fresh ones, all with createdAt > cutoff
    const surviving = await kmStore.findByOntologyClass('Observation');
    expect(surviving.length).toBe(10);
    for (const e of surviving) {
      expect(e.createdAt > result.cutoff).toBe(true);
    }
  }, 60000);

  test('3. prune deletes only Digest entities older than the cutoff', async () => {
    // Clear state — find and delete any Digest entity from prior tests.
    for (const e of await kmStore.findByOntologyClass('Digest')) {
      await kmStore.deleteEntity(e.id);
    }
    await seed('Digest', 10, oldISO, 'dig-old');
    await seed('Digest', 10, freshISO, 'dig-fresh');

    const pruner = new ObservationPruner({ kmStore, retentionDays: 7 });
    const result = await pruner.prune();

    expect(result.digestsDeleted).toBe(10);
    // Observations may carry over from prior test — only assert digest count

    const survivingDigests = await kmStore.findByOntologyClass('Digest');
    expect(survivingDigests.length).toBe(10);
    for (const e of survivingDigests) {
      expect(e.createdAt > result.cutoff).toBe(true);
    }
  }, 60000);

  test('4. T-44-18-01 perf gate — 1000-obs prune ≤ 1s', async () => {
    // Clear Observation state.
    for (const e of await kmStore.findByOntologyClass('Observation')) {
      await kmStore.deleteEntity(e.id);
    }
    // Seed 500 old + 500 fresh = 1000 total to scan; 500 to delete.
    await seed('Observation', 500, oldISO, 'obs-perf-old');
    await seed('Observation', 500, freshISO, 'obs-perf-fresh');

    const pruner = new ObservationPruner({ kmStore, retentionDays: 7 });
    const t0 = performance.now();
    const result = await pruner.prune();
    const dt = performance.now() - t0;

    expect(result.observationsDeleted).toBe(500);

    // Perf gate. T-44-18-01: 1000-obs prune ≤ 1s on the audit machine.
    expect(dt).toBeLessThanOrEqual(1000);

    // Sanity: 500 fresh observations remain.
    const surviving = await kmStore.findByOntologyClass('Observation');
    expect(surviving.length).toBe(500);

    process.stderr.write = origStderrWrite;
    process.stderr.write(`[Plan 44-18 perf] 1000-obs prune completed in ${dt.toFixed(1)}ms\n`);
    // Re-mute for any further tests that might be added later.
    process.stderr.write = function quietWrap(chunk, ...rest) {
      if (_quietStderr && typeof chunk === 'string' && chunk.startsWith('[ObservationPruner]')) {
        return true;
      }
      return origStderrWrite(chunk, ...rest);
    };
  }, 120000);

  test('5. prune skips entities with no createdAt (defensive)', async () => {
    // Clear Observation state.
    for (const e of await kmStore.findByOntologyClass('Observation')) {
      await kmStore.deleteEntity(e.id);
    }

    // Seed one observation with createdAt absent — pruner must NOT delete it.
    await kmStore.putEntity(
      {
        name: 'obs-no-timestamp',
        entityType: 'Observation',
        ontologyClass: 'Observation',
        layer: 'evidence',
        description: 'no timestamp',
        metadata: { summary: 'no-ts' },
        legacyId: { system: 'A', id: 'obs-no-ts' },
        // createdAt deliberately omitted
      },
      { skipOntologyCheck: true }
    );
    // Seed one old observation — must be deleted.
    await seed('Observation', 1, oldISO, 'obs-defensive-old');

    const pruner = new ObservationPruner({ kmStore, retentionDays: 7 });
    const result = await pruner.prune();

    // The 1 old observation is deleted; the no-timestamp one survives.
    expect(result.observationsDeleted).toBe(1);
    const survivors = await kmStore.findByOntologyClass('Observation');
    expect(survivors.length).toBe(1);
    expect(survivors[0].name).toBe('obs-no-timestamp');
  }, 60000);
});
