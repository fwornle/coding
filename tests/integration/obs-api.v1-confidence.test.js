/**
 * tests/integration/obs-api.v1-confidence.test.js
 *
 * Phase 55 Plan 06 Task 2 — integration coverage for GET /api/v1/entities/:id/confidence.
 *
 * Wire shape per plan <interfaces> (a simpler shape than the OKB
 * `okbClient.ts:88-109` ConfidenceBreakdown — the unified-viewer hits the
 * coding obs-api, not the OKM API):
 *   { overall: number,
 *     bands: { high: number, moderate: number, low: number },
 *     segments: Array<{ segmentId: string, confidence: number, source?: string }> }
 *
 * Envelope per Phase 44 contract: `{ success: true, data: ConfidenceBreakdown }`.
 * 404 envelope per plan: `{ success: false, error: 'not_found' }`.
 */

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.OBSERVATIONS_API_NO_AUTOSTART = '1';

describe('GET /api/v1/entities/:id/confidence — ConfidenceBreakdown envelope (Phase 55 Plan 06 Task 2)', () => {
  let dataDir;
  let kmStore;
  let GraphKMStore;
  let defaultOntologyDir;
  let mintEntityId;
  let testHooks;
  let server;
  let baseUrl;
  let withSegmentsId;
  let noSegmentsId;
  let confirmedId;

  const SEED_TS = '2026-06-08T10:00:00.000Z';

  beforeAll(async () => {
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    mintEntityId = kmCore.mintEntityId;

    dataDir = mkdtempSync(path.join(tmpdir(), 'obs-api-v1-confidence-test-'));
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

    // Entity 1: has per-segment confidence values; bands should reflect them.
    withSegmentsId = mintEntityId();
    await kmStore.putEntity(
      {
        id: withSegmentsId,
        name: 'WithSegments',
        entityType: 'Component',
        ontologyClass: 'Component',
        layer: 'pattern',
        description: 'entity with per-segment confidence',
        createdAt: SEED_TS,
        updatedAt: SEED_TS,
        metadata: {
          descriptionSegments: [
            { segmentId: 'seg-a', confidence: 0.9, source: 'copilot' },
            { segmentId: 'seg-b', confidence: 0.7, source: 'claude' },
            { segmentId: 'seg-c', confidence: 0.4, source: 'groq' },
          ],
        },
      },
      { skipOntologyCheck: true },
    );

    // Entity 2: no segments, no confirmations — falls back to 0.5.
    noSegmentsId = mintEntityId();
    await kmStore.putEntity(
      {
        id: noSegmentsId,
        name: 'NoSegments',
        entityType: 'Component',
        ontologyClass: 'Component',
        layer: 'pattern',
        description: 'entity without confidence metadata',
        createdAt: SEED_TS,
        updatedAt: SEED_TS,
        metadata: {},
      },
      { skipOntologyCheck: true },
    );

    // Entity 3: no segments BUT has confirmations → falls back to 0.7.
    confirmedId = mintEntityId();
    await kmStore.putEntity(
      {
        id: confirmedId,
        name: 'ConfirmedNoSegments',
        entityType: 'Component',
        ontologyClass: 'Component',
        layer: 'pattern',
        description: 'entity with provenance but no per-segment confidence',
        createdAt: SEED_TS,
        updatedAt: SEED_TS,
        metadata: {
          provenance: {
            confirmationCount: 3,
          },
        },
      },
      { skipOntologyCheck: true },
    );

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

  test('returns 200 + envelope for an entity with descriptionSegments[]', async () => {
    const { status, body } = await httpGet(`/api/v1/entities/${withSegmentsId}/confidence`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data).toBe('object');
    expect(typeof body.data.overall).toBe('number');
    expect(body.data.overall).toBeGreaterThanOrEqual(0);
    expect(body.data.overall).toBeLessThanOrEqual(1);
    expect(typeof body.data.bands).toBe('object');
    expect(typeof body.data.bands.high).toBe('number');
    expect(typeof body.data.bands.moderate).toBe('number');
    expect(typeof body.data.bands.low).toBe('number');
    expect(Array.isArray(body.data.segments)).toBe(true);
  });

  test('overall confidence is the segment-confidence average (3 segments: 0.9, 0.7, 0.4 → ~0.667)', async () => {
    const { body } = await httpGet(`/api/v1/entities/${withSegmentsId}/confidence`);
    const expected = (0.9 + 0.7 + 0.4) / 3;
    expect(Math.abs(body.data.overall - expected)).toBeLessThan(1e-9);
  });

  test('bands count segments per confidence bucket (high≥0.8 → 1, moderate≥0.6 → 1, low<0.6 → 1)', async () => {
    const { body } = await httpGet(`/api/v1/entities/${withSegmentsId}/confidence`);
    expect(body.data.bands.high).toBe(1);
    expect(body.data.bands.moderate).toBe(1);
    expect(body.data.bands.low).toBe(1);
  });

  test('segments echo the seeded segmentId + confidence + source', async () => {
    const { body } = await httpGet(`/api/v1/entities/${withSegmentsId}/confidence`);
    expect(body.data.segments.length).toBe(3);
    const segIds = body.data.segments.map((s) => s.segmentId);
    expect(segIds).toEqual(['seg-a', 'seg-b', 'seg-c']);
    const segA = body.data.segments.find((s) => s.segmentId === 'seg-a');
    expect(segA.confidence).toBe(0.9);
    expect(segA.source).toBe('copilot');
  });

  test('entity without segments + no confirmations falls back to overall=0.5', async () => {
    const { status, body } = await httpGet(`/api/v1/entities/${noSegmentsId}/confidence`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.overall).toBe(0.5);
    expect(body.data.segments).toEqual([]);
  });

  test('entity without segments but WITH confirmations falls back to overall=0.7', async () => {
    const { status, body } = await httpGet(`/api/v1/entities/${confirmedId}/confidence`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.overall).toBe(0.7);
  });

  test('unknown id returns 404 + {success:false, error:"not_found"} (frontend client-heuristic fallback per UI-SPEC §16)', async () => {
    const { status, body } = await httpGet('/api/v1/entities/no-such-id-12345/confidence');
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('not_found');
  });
});
