/**
 * tests/integration/obs-api.v1-stats.test.js
 *
 * Phase 55 Plan 06 Task 1 — integration coverage for the NEW composed
 * /api/v1/stats endpoint required by the unified-viewer StatsBar (UI-SPEC §18 row 1).
 *
 * STRATEGY mirrors tests/integration/obs-api.legacy-endpoints.km-core.test.js:
 *   - OBSERVATIONS_API_NO_AUTOSTART=1 before importing the obs-api module so
 *     the module does NOT bind :12436 at import time.
 *   - Build a tmpdir-backed GraphKMStore, seed with deterministic fixtures
 *     (4 Observations, 1 Component, 1 Pattern, 1 isolated Observation that
 *     stays orphan because no relation is added), inject via _testHooks.
 *   - Mount the canonical /api/v1 router so the route under test is reachable.
 *   - Drive via fetch on an ephemeral port.
 *
 * The seeded shape is deliberately small + predictable so every assertion
 * below references a literal count, not a "≥" inequality.
 */

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.OBSERVATIONS_API_NO_AUTOSTART = '1';

describe('GET /api/v1/stats — composed ViewerStats envelope (Phase 55 Plan 06 Task 1)', () => {
  let dataDir;
  let kmStore;
  let GraphKMStore;
  let defaultOntologyDir;
  let legacyObservationToEntity;
  let mintEntityId;
  let testHooks;
  let server;
  let baseUrl;

  const TEST_RUN_ID = 'v1-stats-test-' + Date.now();
  const SEED_TS = '2026-06-08T10:00:00.000Z';

  beforeAll(async () => {
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    mintEntityId = kmCore.mintEntityId;
    const ingest = await import('@fwornle/km-core/adapters/legacy-ingest');
    legacyObservationToEntity = ingest.legacyObservationToEntity;

    dataDir = mkdtempSync(path.join(tmpdir(), 'obs-api-v1-stats-test-'));
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

    // Seed 4 Observations via the trusted-path adapter so legacyId + provenance
    // come out canonical (matches the live writer path).
    const obsBase = {
      messages: null,
      session_id: 'sid-stats',
      content_hash: null,
      quality: 'normal',
      digested_at: null,
    };
    const observationRows = [
      { ...obsBase, id: 'stats-obs-1', summary: 'first',  agent: 'claude', created_at: SEED_TS, metadata: { project: 'coding' } },
      { ...obsBase, id: 'stats-obs-2', summary: 'second', agent: 'claude', created_at: SEED_TS, metadata: { project: 'coding' } },
      { ...obsBase, id: 'stats-obs-3', summary: 'third',  agent: 'copilot', created_at: SEED_TS, metadata: { project: 'coding' } },
      { ...obsBase, id: 'stats-obs-4', summary: 'fourth', agent: 'opencode', created_at: SEED_TS, metadata: { project: 'coding' } },
    ];
    const observationIds = [];
    for (const row of observationRows) {
      const entity = legacyObservationToEntity(row, TEST_RUN_ID, SEED_TS);
      const id = await kmStore.putEntity(entity, { skipOntologyCheck: true });
      observationIds.push(id);
    }

    // Seed 1 Component entity (counts toward componentCount).
    const componentId = mintEntityId();
    await kmStore.putEntity(
      {
        id: componentId,
        name: 'TestComponent',
        entityType: 'Component',
        ontologyClass: 'Component',
        layer: 'pattern',
        description: 'A test component for /api/v1/stats',
        createdAt: SEED_TS,
        updatedAt: SEED_TS,
        metadata: {},
      },
      { skipOntologyCheck: true },
    );

    // Seed 2 Insights for hierarchyCoverage: one carrying a hierarchyLevel,
    // one without. Together with the Component above (also unplaced) this
    // gives a denominator of 3 eligible, 1 placed.
    const placedInsightId = mintEntityId();
    await kmStore.putEntity(
      {
        id: placedInsightId,
        name: 'PlacedInsight',
        entityType: 'Insight',
        ontologyClass: 'Insight',
        layer: 'pattern',
        description: 'an insight that found its home',
        createdAt: SEED_TS,
        updatedAt: SEED_TS,
        metadata: { hierarchyLevel: 3, parentId: 'some-subcomponent' },
      },
      { skipOntologyCheck: true },
    );
    const unplacedInsightId = mintEntityId();
    await kmStore.putEntity(
      {
        id: unplacedInsightId,
        name: 'UnplacedInsight',
        entityType: 'Insight',
        ontologyClass: 'Insight',
        layer: 'pattern',
        description: 'an insight with no owner in the catalogue',
        createdAt: SEED_TS,
        updatedAt: SEED_TS,
        metadata: {},
      },
      { skipOntologyCheck: true },
    );

    // Seed 1 Pattern entity (counts toward patternCount).
    const patternId = mintEntityId();
    await kmStore.putEntity(
      {
        id: patternId,
        name: 'TestPattern',
        entityType: 'Pattern',
        ontologyClass: 'Pattern',
        layer: 'pattern',
        description: 'A test pattern for /api/v1/stats',
        createdAt: SEED_TS,
        updatedAt: SEED_TS,
        metadata: {},
      },
      { skipOntologyCheck: true },
    );

    // Wire 3 relations so 3 of the 4 observations are connected to the
    // Component. The 4th observation (stats-obs-4) stays an orphan,
    // along with the Pattern. Expected orphan count = 2.
    for (let i = 0; i < 3; i += 1) {
      await kmStore.addRelation({
        type: 'OBSERVES',
        from: observationIds[i],
        to: componentId,
        createdAt: SEED_TS,
      });
    }

    // Attach both Insights to the Component so the orphan fixture below stays
    // exactly what it says it is — Pattern + the 4th Observation. The
    // hierarchyCoverage cases care about hierarchyLevel, not connectivity.
    for (const insightId of [placedInsightId, unplacedInsightId]) {
      await kmStore.addRelation({
        type: 'has_insight',
        from: componentId,
        to: insightId,
        createdAt: SEED_TS,
      });
    }

    const obsApi = await import('../../scripts/observations-api-server.mjs');
    testHooks = obsApi._testHooks;
    expect(testHooks).toBeDefined();
    expect(typeof testHooks.setKMStoreForTest).toBe('function');
    expect(typeof testHooks.mountV1RoutesForTest).toBe('function');

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

  test('returns 200 with {success, data} envelope and the documented ViewerStats keys', async () => {
    const { status, body } = await httpGet('/api/v1/stats');
    expect(status).toBe(200);
    expect(body).toBeTruthy();
    expect(body.success).toBe(true);
    expect(body.data).toBeTruthy();
    for (const key of [
      'nodeCount', 'edgeCount', 'evidenceCount', 'patternCount',
      'orphanCount', 'componentCount', 'connectivity', 'lastUpdated',
      'activeSnapshot',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(body.data, key)).toBe(true);
    }
  });

  test('nodeCount equals total entities in the seeded store (4 obs + 1 component + 1 pattern + 2 insights = 8)', async () => {
    const { body } = await httpGet('/api/v1/stats');
    expect(body.data.nodeCount).toBe(8);
  });

  test('edgeCount equals total relations in the seeded store (3 OBSERVES + 2 has_insight = 5)', async () => {
    const { body } = await httpGet('/api/v1/stats');
    expect(body.data.edgeCount).toBe(5);
  });

  test('evidenceCount + patternCount + componentCount reflect the seeded fixture', async () => {
    const { body } = await httpGet('/api/v1/stats');
    // 4 seeded Observations (entityType=Observation → evidence layer).
    expect(body.data.evidenceCount).toBe(4);
    // 1 seeded Pattern.
    expect(body.data.patternCount).toBe(1);
    // 1 seeded Component.
    expect(body.data.componentCount).toBe(1);
  });

  test('orphanCount counts entities with degree 0 (Pattern + the 4th unconnected Observation = 2)', async () => {
    const { body } = await httpGet('/api/v1/stats');
    expect(body.data.orphanCount).toBe(2);
  });

  test('connectivity is a number in [0, 1] consistent with 1 - orphan/node', async () => {
    const { body } = await httpGet('/api/v1/stats');
    const { connectivity, orphanCount, nodeCount } = body.data;
    expect(typeof connectivity).toBe('number');
    expect(connectivity).toBeGreaterThanOrEqual(0);
    expect(connectivity).toBeLessThanOrEqual(1);
    const expected = 1 - orphanCount / Math.max(nodeCount, 1);
    expect(Math.abs(connectivity - expected)).toBeLessThan(1e-9);
  });

  test('hierarchyCoverage excludes raw material from the denominator', async () => {
    // Observations and Digests are what insights are distilled FROM. They roll
    // up into an Insight and were never meant to hang off a SubComponent, so
    // counting them as unplaced measures the wrong thing — and makes the
    // number unimprovable, which is how a metric gets ignored.
    const res = await fetch(`${baseUrl}/api/v1/stats`);
    const { data } = await res.json();
    const h = data.hierarchyCoverage;

    // 1 Component + 2 Insights are eligible. The 4 Observations are not.
    expect(h.eligible).toBe(3);
    expect(h.excludedRawMaterial).toBe(4);

    // Only PlacedInsight carries a hierarchyLevel.
    expect(h.placed).toBe(1);
    expect(h.unplaced).toBe(2);
    expect(h.ratio).toBeCloseTo(1 / 3, 5);
  });

  test('hierarchyCoverage names what is unplaced rather than hiding it', async () => {
    // "Excluded from the denominator" must never mean "invisible": the
    // per-class breakdown is what makes the exclusion auditable.
    const res = await fetch(`${baseUrl}/api/v1/stats`);
    const { data } = await res.json();
    const { unplacedByClass } = data.hierarchyCoverage;

    expect(unplacedByClass.Insight).toBe(1);
    expect(unplacedByClass.Component).toBe(1);
    // Raw material is excluded, so it must not appear as a miss.
    expect(unplacedByClass.Observation).toBeUndefined();
    expect(unplacedByClass.Digest).toBeUndefined();
  });

  test('placed + unplaced always equals eligible', async () => {
    const res = await fetch(`${baseUrl}/api/v1/stats`);
    const { data } = await res.json();
    const h = data.hierarchyCoverage;
    expect(h.placed + h.unplaced).toBe(h.eligible);
    expect(h.ratio).toBeGreaterThanOrEqual(0);
    expect(h.ratio).toBeLessThanOrEqual(1);
  });

  test('lastUpdated is a parseable ISO 8601 timestamp', async () => {
    const { body } = await httpGet('/api/v1/stats');
    const ts = body.data.lastUpdated;
    expect(typeof ts).toBe('string');
    // ISO-8601 with timezone designator.
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(ts)).toBe(true);
    expect(Number.isFinite(Date.parse(ts))).toBe(true);
  });

  test('activeSnapshot is null OR an object {hash, message, date}', async () => {
    const { body } = await httpGet('/api/v1/stats');
    const snap = body.data.activeSnapshot;
    if (snap !== null) {
      expect(typeof snap).toBe('object');
      expect(typeof snap.hash).toBe('string');
      expect(typeof snap.message).toBe('string');
      expect(typeof snap.date).toBe('string');
    }
  });

  test('BC: /api/v1/graph/connectivity still responds with its prior shape', async () => {
    const { status, body } = await httpGet('/api/v1/graph/connectivity');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Shape per km-core handlers/query.js — `componentCount` + `connectivity`
    // are stable across the Phase 55 cutover; we explicitly assert both so a
    // future km-core wire-shape drift triggers this test, not the StatsBar
    // frontend at runtime (Plan 55-02 acceptance gate is the same).
    expect(typeof body.data.componentCount).toBe('number');
    expect(typeof body.data.connectivity).toBe('number');
  });

  test('BC: /api/v1/graph/orphans still responds with its prior shape', async () => {
    const { status, body } = await httpGet('/api/v1/graph/orphans');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
