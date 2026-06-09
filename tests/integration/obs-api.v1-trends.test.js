/**
 * tests/integration/obs-api.v1-trends.test.js
 *
 * Phase 55 Plan 06 Task 2 — integration coverage for GET /api/v1/trends.
 *
 * Wire shape per okbClient.ts:62-78 (TrendingPattern):
 *   { nodeId, entity:{id,name,entityType[,description]}, trendScore, trends:{last7Days,last30Days,last90Days} }
 * Envelope per Phase 44 contract: `{ success: true, data: { patterns: TrendingPattern[] } }`.
 *
 * Seeds 3 Patterns with varying createdAt + metadata.occurrences[] so the
 * trend-score ordering is deterministic without locking us to any particular
 * decay formula (we assert relative ordering, not absolute values).
 */

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.OBSERVATIONS_API_NO_AUTOSTART = '1';

describe('GET /api/v1/trends — TrendingPattern envelope (Phase 55 Plan 06 Task 2)', () => {
  let dataDir;
  let kmStore;
  let GraphKMStore;
  let defaultOntologyDir;
  let mintEntityId;
  let testHooks;
  let server;
  let baseUrl;

  const NOW = Date.now();
  const ISO_RECENT = new Date(NOW - 1 * 86_400_000).toISOString();      // 1 day old
  const ISO_MID    = new Date(NOW - 14 * 86_400_000).toISOString();     // 14 days old
  const ISO_OLD    = new Date(NOW - 100 * 86_400_000).toISOString();    // 100 days old

  beforeAll(async () => {
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    mintEntityId = kmCore.mintEntityId;

    dataDir = mkdtempSync(path.join(tmpdir(), 'obs-api-v1-trends-test-'));
    const kmDbPath = path.join(dataDir, 'km', 'leveldb');
    const kmExportDir = path.join(dataDir, 'km', 'exports');
    mkdirSync(kmDbPath, { recursive: true });
    mkdirSync(kmExportDir, { recursive: true });

    kmStore = new GraphKMStore({
      dbPath: kmDbPath,
      exportDir: kmExportDir,
      ontologyDir: defaultOntologyDir(),
    });
    await kmStore.open();

    // Seed 3 Patterns:
    //   - alpha: recent + many occurrences  → should top the list
    //   - bravo: mid-age + few occurrences  → middle
    //   - charlie: old + many occurrences   → should rank below alpha despite count
    const seed = [
      {
        id: mintEntityId(),
        name: 'TrendAlpha',
        createdAt: ISO_RECENT,
        occurrences: Array.from({ length: 20 }, (_, i) => ({ at: ISO_RECENT, idx: i })),
        description: 'recent high-volume pattern',
      },
      {
        id: mintEntityId(),
        name: 'TrendBravo',
        createdAt: ISO_MID,
        occurrences: Array.from({ length: 5 }, (_, i) => ({ at: ISO_MID, idx: i })),
        description: 'mid-age low-volume pattern',
      },
      {
        id: mintEntityId(),
        name: 'TrendCharlie',
        createdAt: ISO_OLD,
        occurrences: Array.from({ length: 20 }, (_, i) => ({ at: ISO_OLD, idx: i })),
        description: 'old high-volume pattern',
      },
    ];
    for (const row of seed) {
      await kmStore.putEntity(
        {
          id: row.id,
          name: row.name,
          entityType: 'Pattern',
          ontologyClass: 'Pattern',
          layer: 'pattern',
          description: row.description,
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
          metadata: { occurrences: row.occurrences },
        },
        { skipOntologyCheck: true },
      );
    }

    const obsApi = await import('../../scripts/observations-api-server.mjs');
    testHooks = obsApi._testHooks;
    testHooks.setKMStoreForTest(kmStore);
    testHooks.mountV1RoutesForTest();

    server = await new Promise((resolve, reject) => {
      const s = testHooks.app.listen(0, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 60_000);

  afterAll(async () => {
    try { if (server) await new Promise((r) => server.close(() => r())); } catch { /* best-effort */ }
    try { if (kmStore) await kmStore.close(); } catch { /* best-effort */ }
    try { if (dataDir) rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  async function httpGet(p) {
    const res = await fetch(`${baseUrl}${p}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  test('returns {success, data:{patterns}} envelope with shape conforming to TrendingPattern', async () => {
    const { status, body } = await httpGet('/api/v1/trends?top=20');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeTruthy();
    expect(Array.isArray(body.data.patterns)).toBe(true);
    expect(body.data.patterns.length).toBe(3);
    for (const p of body.data.patterns) {
      expect(typeof p.nodeId).toBe('string');
      expect(typeof p.entity).toBe('object');
      expect(typeof p.entity.id).toBe('string');
      expect(typeof p.entity.name).toBe('string');
      expect(typeof p.entity.entityType).toBe('string');
      expect(typeof p.trendScore).toBe('number');
      expect(typeof p.trends).toBe('object');
      expect(typeof p.trends.last7Days).toBe('number');
      expect(typeof p.trends.last30Days).toBe('number');
      expect(typeof p.trends.last90Days).toBe('number');
    }
  });

  test('?top=20 returns at most 20 patterns', async () => {
    const { body } = await httpGet('/api/v1/trends?top=20');
    expect(body.data.patterns.length).toBeLessThanOrEqual(20);
  });

  test('?top=200 caps at 100 (hard upper bound per plan)', async () => {
    const { body } = await httpGet('/api/v1/trends?top=200');
    expect(body.data.patterns.length).toBeLessThanOrEqual(100);
  });

  test('?top=2 slices to the first 2 patterns', async () => {
    const { body } = await httpGet('/api/v1/trends?top=2');
    expect(body.data.patterns.length).toBe(2);
  });

  test('patterns are sorted DESC by trendScore (TrendAlpha first; TrendCharlie strictly below TrendAlpha because of recency decay)', async () => {
    const { body } = await httpGet('/api/v1/trends?top=10');
    const scores = body.data.patterns.map((p) => p.trendScore);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
    const names = body.data.patterns.map((p) => p.entity.name);
    expect(names[0]).toBe('TrendAlpha');
    // TrendCharlie has same occurrence count as TrendAlpha but is much older,
    // so its score MUST be strictly less than TrendAlpha's.
    const alphaScore = body.data.patterns.find((p) => p.entity.name === 'TrendAlpha').trendScore;
    const charlieScore = body.data.patterns.find((p) => p.entity.name === 'TrendCharlie').trendScore;
    expect(charlieScore).toBeLessThan(alphaScore);
  });

  test('every pattern.entity.id is a string that matches pattern.nodeId', async () => {
    const { body } = await httpGet('/api/v1/trends?top=10');
    for (const p of body.data.patterns) {
      expect(p.entity.id).toBe(p.nodeId);
    }
  });
});
