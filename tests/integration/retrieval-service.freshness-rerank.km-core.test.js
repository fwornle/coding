/**
 * tests/integration/retrieval-service.freshness-rerank.km-core.test.js
 *
 * Phase 44 Plan 18 (Task 3) — verify the freshness-rerank lookup now goes
 * through km-core `findByLegacyId` instead of a SQLite `SELECT
 * json_extract(metadata, '$.codeVerification.verificationRatio') FROM
 * insights WHERE id IN (...)`.
 *
 * SCOPE:
 *   * Spin up a tmpdir-backed GraphKMStore.
 *   * Seed 5 Insight entities with varying verificationRatio:
 *       - ins-a: ratio 1.0   → no penalty (multiplier 1.0)
 *       - ins-b: ratio 0.5   → mild penalty (multiplier 0.65)
 *       - ins-c: ratio 0.0   → heavy penalty (multiplier 0.30)
 *       - ins-d: ratio undefined (metadata.codeVerification missing)
 *                            → no penalty
 *       - ins-e: metadata.codeVerification.verificationRatio absent entirely
 *                            → no penalty
 *   * Construct a RetrievalService with kmStoreGetter pointing at the store.
 *   * Call `_applyFreshnessRerank` directly with a synthetic fused-result
 *     array (no Qdrant / no fastembed — the rerank is a pure post-fusion
 *     scoring step).
 *   * Assert the multiplier matches the 0.3 + 0.7·ratio formula for ratio ∈
 *     [0,1] and that missing-metadata cases leave the score untouched.
 *   * T-44-18-02 perf gate: rerank lookup for 20 insight ids ≤ 50ms.
 *
 * The integration test covers the end-to-end shape (kmStore + RetrievalService
 * + scoring). It does NOT exercise the full /api/retrieve HTTP path — that
 * stays covered by the broader obs-api integration suite.
 *
 * Jest 29 ESM. Dynamic import for the km-core package to defer module
 * resolution to runtime (matches the writer integration test convention).
 */

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Suppress retrieval-service stderr chatter during the test run.
const origStderrWrite = process.stderr.write.bind(process.stderr);
let _quietStderr = false;
process.stderr.write = function quietWrap(chunk, ...rest) {
  if (
    _quietStderr &&
    typeof chunk === 'string' &&
    chunk.startsWith('[RetrievalService]')
  ) {
    return true;
  }
  return origStderrWrite(chunk, ...rest);
};

describe('RetrievalService freshness rerank → km-core (Phase 44 Plan 18)', () => {
  let dataDir;
  let kmStore;
  let svc;
  let GraphKMStore;
  let defaultOntologyDir;
  let RetrievalService;

  beforeAll(async () => {
    _quietStderr = true;
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    const svcModule = await import('../../src/retrieval/retrieval-service.js');
    RetrievalService = svcModule.RetrievalService;

    dataDir = mkdtempSync(path.join(tmpdir(), 'rerank-test-'));
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

    // Seed 5 insight entities directly (skipOntologyCheck path — trusted
    // bulk-import; matches the legacy-ingest write semantics for testing).
    // legacyId.system='A' matches the legacy-ingest adapter contract.
    const baseTs = '2026-06-05T00:00:00.000Z';
    const seedInsight = async (legacyId, ratio) => {
      const metadata = {};
      if (ratio !== null) {
        metadata.codeVerification = { verificationRatio: ratio };
      }
      await kmStore.putEntity(
        {
          name: `insight-${legacyId}`,
          entityType: 'Insight',
          ontologyClass: 'Insight',
          layer: 'pattern',
          description: `Insight ${legacyId}`,
          metadata: {
            ...metadata,
            topic: `topic-${legacyId}`,
            summary: `summary-${legacyId}`,
            createdAt: baseTs,
          },
          legacyId: { system: 'A', id: legacyId },
          createdAt: baseTs,
          updatedAt: baseTs,
          validFrom: baseTs,
        },
        { skipOntologyCheck: true }
      );
    };

    await seedInsight('ins-a', 1.0); // no penalty
    await seedInsight('ins-b', 0.5); // mild penalty: 0.3 + 0.7*0.5 = 0.65
    await seedInsight('ins-c', 0.0); // heavy penalty: 0.3
    await seedInsight('ins-d', null); // codeVerification absent — no penalty
    // ins-e: metadata present but no codeVerification key
    await kmStore.putEntity(
      {
        name: 'insight-ins-e',
        entityType: 'Insight',
        ontologyClass: 'Insight',
        layer: 'pattern',
        description: 'Insight e',
        metadata: { topic: 'topic-ins-e', summary: 'summary-ins-e', createdAt: baseTs },
        legacyId: { system: 'A', id: 'ins-e' },
        createdAt: baseTs,
        updatedAt: baseTs,
        validFrom: baseTs,
      },
      { skipOntologyCheck: true }
    );

    svc = new RetrievalService({
      kmStoreGetter: () => kmStore,
    });
  }, 30000);

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

  function makeResult(id, score = 100) {
    return { id, tier: 'insights', rrfScore: score };
  }

  test('1. multiplier matches 0.3 + 0.7·ratio for ratio in [0,1]', async () => {
    const results = [
      makeResult('ins-a'), // ratio 1.0 → 1.0×  → 100
      makeResult('ins-b'), // ratio 0.5 → 0.65× → 65
      makeResult('ins-c'), // ratio 0.0 → 0.30× → 30
    ];
    await svc._applyFreshnessRerank(results);

    const byId = Object.fromEntries(results.map((r) => [r.id, r.rrfScore]));
    expect(byId['ins-a']).toBeCloseTo(100, 5);    // no penalty (ratio >= 1)
    expect(byId['ins-b']).toBeCloseTo(100 * 0.65, 5);
    expect(byId['ins-c']).toBeCloseTo(100 * 0.30, 5);
  });

  test('2. missing verificationRatio leaves score untouched', async () => {
    const results = [
      makeResult('ins-d'), // codeVerification absent
      makeResult('ins-e'), // metadata present but no codeVerification key
    ];
    await svc._applyFreshnessRerank(results);
    expect(results[0].rrfScore).toBe(100);
    expect(results[1].rrfScore).toBe(100);
  });

  test('3. non-insight tiers and unknown ids pass through unchanged', async () => {
    const results = [
      { id: 'obs-x', tier: 'observations', rrfScore: 100 }, // wrong tier
      { id: 'dig-y', tier: 'digests', rrfScore: 100 },      // wrong tier
      { id: 'ins-zzz-unknown', tier: 'insights', rrfScore: 100 }, // unknown id
    ];
    await svc._applyFreshnessRerank(results);
    expect(results[0].rrfScore).toBe(100);
    expect(results[1].rrfScore).toBe(100);
    expect(results[2].rrfScore).toBe(100); // unknown legacyId → no entity → no penalty
  });

  test('4. T-44-18-02 perf gate — 20-id rerank lookup ≤ 50ms', async () => {
    // Seed 15 more insights with ratio 0.5 each so we have 20 distinct insight
    // ids spanning the full ratio range. The store now has ins-a..ins-e + 15
    // new = 20 insights. The rerank lookup must complete in ≤ 50ms.
    const baseTs = '2026-06-05T00:00:00.000Z';
    for (let i = 0; i < 15; i++) {
      await kmStore.putEntity(
        {
          name: `insight-ins-p${i}`,
          entityType: 'Insight',
          ontologyClass: 'Insight',
          layer: 'pattern',
          description: `Insight p${i}`,
          metadata: {
            topic: `topic-ins-p${i}`,
            summary: `summary-ins-p${i}`,
            codeVerification: { verificationRatio: 0.5 },
            createdAt: baseTs,
          },
          legacyId: { system: 'A', id: `ins-p${i}` },
          createdAt: baseTs,
          updatedAt: baseTs,
          validFrom: baseTs,
        },
        { skipOntologyCheck: true }
      );
    }

    const results = [];
    for (const id of ['ins-a', 'ins-b', 'ins-c', 'ins-d', 'ins-e']) {
      results.push(makeResult(id, 100));
    }
    for (let i = 0; i < 15; i++) {
      results.push(makeResult(`ins-p${i}`, 100));
    }
    expect(results.length).toBe(20);

    const t0 = performance.now();
    await svc._applyFreshnessRerank(results);
    const dt = performance.now() - t0;

    // Sanity check — the 0.5-ratio entries should be at 65.
    const pZero = results.find((r) => r.id === 'ins-p0');
    expect(pZero.rrfScore).toBeCloseTo(65, 5);

    // Perf gate.
    expect(dt).toBeLessThanOrEqual(50);
  }, 30000);
});
