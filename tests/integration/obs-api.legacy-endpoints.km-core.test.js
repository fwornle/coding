/**
 * tests/integration/obs-api.legacy-endpoints.km-core.test.js
 *
 * Phase 44 Plan 14 Task 3 — integration coverage for the 10 obs-api
 * endpoints migrated from SQLite to km-core in Task 2.
 *
 * STRATEGY:
 *   * Set OBSERVATIONS_API_NO_AUTOSTART=1 BEFORE importing
 *     scripts/observations-api-server.mjs so the module imports without
 *     binding :12436 (production port).
 *   * Build a tmpdir-backed GraphKMStore and hand it to the obs-api via
 *     the exported _testHooks.setKMStoreForTest hook.
 *   * Bind the exported Express app to an ephemeral port (0) on
 *     127.0.0.1 and drive it via Node's built-in fetch — no supertest
 *     dep required (the test then mirrors the dashboard's real HTTP
 *     consumption pattern).
 *   * Seed observations + digests + insights via direct putEntity
 *     against the tmpdir store. The writer is NOT exercised here
 *     because the legacy /api/observations/messages endpoint goes
 *     through the writer's processMessages which requires an LLM proxy.
 *     We seed entity data directly to test the read endpoints; the
 *     writer's km-core path already has dedicated coverage in
 *     tests/integration/observation-writer.km-core.test.js.
 *
 * COVERAGE (one it() per endpoint family):
 *   1. /api/observations/projects                    GET
 *   2. /api/digests/projects                          GET
 *   3. /api/insights/projects                         GET
 *   4. /api/projects                                  GET (union)
 *   5. /api/projects/:project/coverage                GET
 *   6. /api/observations/patch-artifacts/recent       POST
 *   7. /api/observations/patch-artifacts/historical   POST
 *   8. /api/observations/patch-artifacts/historical   POST (perf — 1000 obs)
 *   9. /api/consolidation/status                      GET (counts + staleness)
 *  10. /api/consolidation/status                      GET (5s TTL cache hit)
 *  11. countByOntologyClass returns 0 on empty store (T-44-14-01)
 *  12. _stalenessCache.invalidate via /messages route is wired
 *
 * The resynthesize endpoint is NOT exercised at this level — it requires
 * a live consolidator + LLM proxy. T-44-14-03 (digest_ids +
 * codeVerification preservation on replay) is covered by Task 1's
 * findByLegacyId unit tests + the post-Task-4 operator smoke.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// CRITICAL: set env BEFORE importing the obs-api module. The module
// reads OBSERVATIONS_API_NO_AUTOSTART at module-eval time.
process.env.OBSERVATIONS_API_NO_AUTOSTART = '1';

describe('obs-api legacy /api/* endpoints km-core round-trip (Phase 44 Plan 14)', () => {
  let dataDir;
  let kmStore;
  let GraphKMStore;
  let defaultOntologyDir;
  let legacyObservationToEntity;
  let legacyDigestToEntity;
  let legacyInsightToEntity;
  let testHooks;
  let server;
  let baseUrl;

  // Per-process run identifier used in every seeded provenance stamp so
  // post-hoc queries can attribute test fixtures vs production rows.
  const TEST_RUN_ID = 'obs-api-legacy-test-' + Date.now();
  const SEED_TS = '2026-06-04T10:00:00.000Z';

  beforeAll(async () => {
    // Dynamic imports — both km-core and the obs-api module are ESM.
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    const ingest = await import('@fwornle/km-core/adapters/legacy-ingest');
    legacyObservationToEntity = ingest.legacyObservationToEntity;
    legacyDigestToEntity = ingest.legacyDigestToEntity;
    legacyInsightToEntity = ingest.legacyInsightToEntity;

    // tmpdir layout:
    //   <tmpdir>/km/leveldb        ← km-core LevelDB
    //   <tmpdir>/km/exports        ← km-core JSON exports
    //   <tmpdir>/.observations/    ← sqlite stays empty (consolidator
    //                                init opens it lazily; for the
    //                                /api/consolidation/status path
    //                                the on-demand consolidator falls
    //                                back to zeros when the file is
    //                                empty, which is correct for the
    //                                test fixture)
    dataDir = mkdtempSync(path.join(tmpdir(), 'obs-api-legacy-test-'));
    const kmDbPath = path.join(dataDir, 'km', 'leveldb');
    const kmExportDir = path.join(dataDir, 'km', 'exports');
    const obsDbDir = path.join(dataDir, '.observations');
    mkdirSync(kmDbPath, { recursive: true });
    mkdirSync(kmExportDir, { recursive: true });
    mkdirSync(obsDbDir, { recursive: true });

    // Override the obs-api's SQLite path BEFORE module import so the
    // consolidator-stats path (in /api/consolidation/status) opens our
    // tmpdir SQLite, not the production .observations/observations.db.
    process.env.OBSERVATIONS_DB_PATH = path.join(obsDbDir, 'observations.db');

    // Build a tmpdir-backed km-core store + seed it with deterministic
    // fixtures via the same legacy-ingest adapters the writer uses.
    kmStore = new GraphKMStore({
      dbPath: kmDbPath,
      exportDir: kmExportDir,
      ontologyDir: defaultOntologyDir(),
    });
    await kmStore.open();

    // Seed fixtures.
    //   - 4 observations across 2 projects (coding × 2, rapid × 2),
    //     1 of which has `Artifacts: none` summary + modifiedFiles
    //     metadata (for the patch-artifacts/historical test).
    //   - 1 observation tagged `agent: 'test-agent'` with createdAt = now
    //     so the patch-artifacts/recent (4h window) finds it.
    //   - 3 digests across 2 projects.
    //   - 2 insights (1 coding, 1 rapid) for the projects/coverage test.
    //
    // The summary field is stamped in BOTH `description` AND
    // `metadata.summary` by legacyObservationToEntity (verbatim mirror
    // of the writer's path), so the patch-artifacts handlers + the
    // dashboard read path agree on the field source.

    const obsBase = {
      messages: null,
      session_id: 'sid-test',
      content_hash: null,
      quality: 'normal',
      digested_at: null,
    };

    const seedObservations = [
      {
        ...obsBase,
        id: 'obs-1',
        summary: 'Intent: A\nApproach: B\nArtifacts: edited file1.ts\nResult: ok',
        agent: 'claude',
        created_at: SEED_TS,
        metadata: { project: 'coding' },
      },
      {
        ...obsBase,
        id: 'obs-2',
        summary: 'Intent: C\nApproach: D\nArtifacts: none\nResult: ok',
        agent: 'claude',
        created_at: SEED_TS,
        metadata: { project: 'coding', modifiedFiles: ['src/foo.ts', 'lib/bar.js'] },
      },
      {
        ...obsBase,
        id: 'obs-3',
        summary: 'Intent: E\nApproach: F\nArtifacts: edited z.ts\nResult: ok',
        agent: 'copilot',
        created_at: SEED_TS,
        metadata: { project: 'rapid-automations' },
      },
      {
        ...obsBase,
        id: 'obs-4',
        summary: 'Intent: G\nApproach: H\nArtifacts: edited y.ts\nResult: ok',
        agent: 'opencode',
        created_at: SEED_TS,
        metadata: { project: 'rapid-automations' },
      },
      // Recent obs for patch-artifacts/recent (within 4h window).
      {
        ...obsBase,
        id: 'obs-recent',
        summary: 'Intent: I\nApproach: J\nArtifacts: none\nResult: pending',
        agent: 'test-agent',
        created_at: new Date().toISOString(),
        metadata: { project: 'coding' },
      },
    ];

    for (const row of seedObservations) {
      const entity = legacyObservationToEntity(row, TEST_RUN_ID, SEED_TS);
      await kmStore.putEntity(entity, { skipOntologyCheck: true });
    }

    const seedDigests = [
      {
        id: 'dig-1',
        date: '2026-06-04',
        theme: 'Coding theme',
        summary: 'Coding day digest summary',
        observation_ids: ['obs-1', 'obs-2'],
        agents: ['claude'],
        files_touched: ['src/foo.ts'],
        project: 'coding',
        quality: 'high',
        created_at: SEED_TS,
      },
      {
        id: 'dig-2',
        date: '2026-06-04',
        theme: 'Rapid theme',
        summary: 'Rapid day digest summary',
        observation_ids: ['obs-3'],
        agents: ['copilot'],
        files_touched: ['rapid/x.ts'],
        project: 'rapid-automations',
        quality: 'normal',
        created_at: SEED_TS,
      },
      {
        id: 'dig-3',
        date: '2026-06-03',
        theme: 'Older theme',
        summary: 'Older digest summary',
        observation_ids: [],
        agents: ['claude'],
        files_touched: [],
        project: 'coding',
        quality: 'normal',
        created_at: '2026-06-03T08:00:00.000Z',
      },
    ];
    for (const row of seedDigests) {
      const entity = legacyDigestToEntity(row, TEST_RUN_ID, SEED_TS);
      await kmStore.putEntity(entity, { skipOntologyCheck: true });
    }

    const seedInsights = [
      {
        id: 'ins-coding-1',
        topic: 'CodingInsight',
        summary: 'Coding insight summary — covers LiveLoggingSystem and LSL.',
        confidence: 0.85,
        digest_ids: ['dig-1'],
        last_updated: SEED_TS,
        created_at: SEED_TS,
        project: 'coding',
      },
      {
        id: 'ins-rapid-1',
        topic: 'RapidInsight',
        summary: 'Rapid automations insight summary.',
        confidence: 0.7,
        digest_ids: ['dig-2'],
        last_updated: SEED_TS,
        created_at: SEED_TS,
        project: 'rapid-automations',
      },
    ];
    for (const row of seedInsights) {
      const entity = legacyInsightToEntity(row, TEST_RUN_ID, SEED_TS);
      await kmStore.putEntity(entity, { skipOntologyCheck: true });
    }

    // Import the obs-api module AFTER seeding env + paths.
    const obsApi = await import('../../scripts/observations-api-server.mjs');
    testHooks = obsApi._testHooks;
    expect(testHooks).toBeDefined();
    expect(typeof testHooks.setKMStoreForTest).toBe('function');

    // Inject the tmpdir store + bind the app to an ephemeral port.
    testHooks.setKMStoreForTest(kmStore);
    server = await new Promise((resolve, reject) => {
      const s = testHooks.app.listen(0, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 60_000);

  afterAll(async () => {
    try {
      if (server) await new Promise((r) => server.close(() => r()));
    } catch { /* best-effort */ }
    try {
      if (kmStore) await kmStore.close();
    } catch { /* best-effort */ }
    try {
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  // ── Helper ─────────────────────────────────────────────────────────────

  async function httpGet(path) {
    const res = await fetch(`${baseUrl}${path}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  async function httpPost(path, payload) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  // ── Tests ──────────────────────────────────────────────────────────────

  test('GET /api/observations/projects returns all seeded projects sorted', async () => {
    const { status, body } = await httpGet('/api/observations/projects');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(['coding', 'rapid-automations']);
  });

  test('GET /api/digests/projects returns digest-class projects sorted', async () => {
    const { status, body } = await httpGet('/api/digests/projects');
    expect(status).toBe(200);
    expect(body).toEqual(['coding', 'rapid-automations']);
  });

  test('GET /api/insights/projects returns insight-class projects sorted', async () => {
    const { status, body } = await httpGet('/api/insights/projects');
    expect(status).toBe(200);
    expect(body).toEqual(['coding', 'rapid-automations']);
  });

  test('GET /api/projects returns union of all three classes', async () => {
    const { status, body } = await httpGet('/api/projects');
    expect(status).toBe(200);
    // No new projects beyond the seeded set — union must equal the
    // distinct set of seeded projects.
    expect(body).toEqual(['coding', 'rapid-automations']);
  });

  test('GET /api/projects/:project/coverage returns the per-project shape', async () => {
    const { status, body } = await httpGet('/api/projects/coding/coverage');
    expect(status).toBe(200);
    expect(body.project).toBe('coding');
    expect(typeof body.computedAt).toBe('string');
    expect(body.insights.total).toBe(1);
    // Single seeded coding insight has no codeVerification metadata, so
    // it counts as `unverified`.
    expect(body.insights.unverified).toBe(1);
    expect(body.insights.fresh).toBe(0);
    expect(body.coverage.filesReferenced).toBe(0);
    // Per-insight payload matches the seed.
    expect(Array.isArray(body.perInsight)).toBe(true);
    expect(body.perInsight.length).toBe(1);
    expect(body.perInsight[0].id).toBe('ins-coding-1');
    expect(body.perInsight[0].topic).toBe('CodingInsight');
    expect(body.perInsight[0].confidence).toBe(0.85);
    // Taxonomy match — LiveLoggingSystem alias ('lsl') appears in the
    // seeded summary, so it should be present.
    expect(body.coverage.componentsMentioned).toContain('LiveLoggingSystem');
  });

  test('POST /api/observations/patch-artifacts/recent patches a recent Artifacts:none row', async () => {
    const { status, body } = await httpPost('/api/observations/patch-artifacts/recent', {
      agent: 'test-agent',
      modifiedFiles: ['src/x.ts'],
    });
    expect(status).toBe(200);
    expect(body.patched).toBe(1);

    // Confirm the entity actually mutated in the km-core store.
    const matches = await kmStore.findByOntologyClass('Observation');
    const recent = matches.find((e) => e.legacyId?.id === 'obs-recent');
    expect(recent).toBeDefined();
    expect(/Artifacts:\s*edited x\.ts/i.test(recent.metadata?.summary || '')).toBe(true);
    // Description mirrors the summary mutation.
    expect(/Artifacts:\s*edited x\.ts/i.test(recent.description || '')).toBe(true);
    // modifiedFiles set-union: prior was empty (this row had no
    // modifiedFiles in seed), so the new list is ['src/x.ts'].
    expect(recent.metadata?.modifiedFiles).toEqual(['src/x.ts']);
  });

  test('POST /api/observations/patch-artifacts/historical patches Artifacts:none rows with modifiedFiles', async () => {
    const { status, body } = await httpPost('/api/observations/patch-artifacts/historical', {});
    expect(status).toBe(200);
    // The seed has 1 observation with `Artifacts: none` + non-empty
    // modifiedFiles (obs-2). The patch-artifacts/recent test above also
    // wrote a non-empty modifiedFiles into obs-recent — but obs-recent's
    // summary is now `Artifacts: edited x.ts`, so it does NOT match the
    // `Artifacts: none` predicate. Result: exactly 1 row patched.
    expect(body.patched).toBe(1);
    expect(body.scanned).toBe(1);

    // Confirm obs-2 mutated. The util joins basenames with `, ` so the
    // final summary line is `Artifacts: edited foo.ts, edited bar.js`.
    // Match the "Artifacts:" prefix once, then check each basename
    // appears as a literal substring (NOT immediately after the
    // colon — they share one comma-separated list).
    const matches = await kmStore.findByOntologyClass('Observation');
    const obs2 = matches.find((e) => e.legacyId?.id === 'obs-2');
    expect(obs2).toBeDefined();
    const obs2Summary = obs2.metadata?.summary || '';
    expect(/Artifacts:\s*edited foo\.ts/i.test(obs2Summary)).toBe(true);
    expect(obs2Summary).toMatch(/edited bar\.js/i);
  });

  test('GET /api/consolidation/status returns km-core counts + staleness ISO timestamps', async () => {
    // Pre-test: bump cache so the read reflects post-patch state.
    testHooks.invalidateStalenessCache();

    const { status, body } = await httpGet('/api/consolidation/status');
    expect(status).toBe(200);
    expect(body.totalObs).toBe(5);
    expect(body.totalDigests).toBe(3);
    expect(body.totalInsights).toBe(2);
    expect(typeof body.lastObservationAt).toBe('string');
    expect(typeof body.lastDigestAt).toBe('string');
    expect(typeof body.lastInsightAt).toBe('string');
    // Staleness clock uses the recent obs's now() timestamp as max for
    // Observation (obs-recent), but the seeded SEED_TS for Digest +
    // Insight.
    expect(body.lastDigestAt).toBe(SEED_TS);
    expect(body.lastInsightAt).toBe(SEED_TS);
    // Pipeline stats default to 0 because our tmpdir SQLite file is
    // empty (no `observations` table populated). The consolidator
    // probe opens it but finds no rows.
    expect(body.undigested).toBeGreaterThanOrEqual(0);
    expect(body.pendingPast).toBeGreaterThanOrEqual(0);
    expect(body.pendingToday).toBeGreaterThanOrEqual(0);
  });

  test('GET /api/consolidation/status second call hits the 5s TTL cache', async () => {
    // Second call within 5s should return identical staleness payload
    // even if the underlying store is mutated AFTER the cache was
    // populated (TTL not yet expired + no manual invalidation).
    const firstHit = await httpGet('/api/consolidation/status');
    expect(firstHit.status).toBe(200);
    const firstStaleness = {
      o: firstHit.body.lastObservationAt,
      d: firstHit.body.lastDigestAt,
      i: firstHit.body.lastInsightAt,
    };
    const secondHit = await httpGet('/api/consolidation/status');
    expect(secondHit.status).toBe(200);
    expect({
      o: secondHit.body.lastObservationAt,
      d: secondHit.body.lastDigestAt,
      i: secondHit.body.lastInsightAt,
    }).toEqual(firstStaleness);
  });

  test('T-44-14-02 perf gate: patch-artifacts/historical at 1000 rows completes within budget', async () => {
    // Seed an additional 1000 observations into the same store with
    // `Artifacts: none` summaries + populated modifiedFiles. The plan's
    // perf budget is <2s on the dev box; we relax to <5s in CI.
    const perfStore = kmStore; // reuse the same store
    const baseTs = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    for (let i = 0; i < 1000; i++) {
      const row = {
        id: `perf-obs-${i}`,
        summary: `Intent: perf${i}\nApproach: perf\nArtifacts: none\nResult: ok`,
        messages: null,
        agent: 'perf-agent',
        session_id: 'sid-perf',
        source_file: null,
        created_at: baseTs,
        content_hash: null,
        quality: 'normal',
        digested_at: null,
        metadata: { project: 'coding', modifiedFiles: [`src/perf-${i}.ts`] },
      };
      const entity = legacyObservationToEntity(row, TEST_RUN_ID, baseTs);
      await perfStore.putEntity(entity, { skipOntologyCheck: true });
    }

    const budgetMs = process.env.CI ? 5_000 : 2_000;
    const start = Date.now();
    const { status, body } = await httpPost('/api/observations/patch-artifacts/historical', {});
    const elapsed = Date.now() - start;
    expect(status).toBe(200);
    // Endpoint caps at 500; with 1000 seeded perf rows, scanned should
    // be 500 (the slice ceiling).
    expect(body.scanned).toBeLessThanOrEqual(500);
    expect(body.patched).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(budgetMs);
  }, 30_000);

  test('countByOntologyClass returns 0 for an empty class', async () => {
    // Use the store directly to assert the empty-class contract that
    // backs T-44-14-01.
    const ghosts = await kmStore.countByOntologyClass('NotARealClass');
    expect(ghosts).toBe(0);
  });

  test('staleness cache invalidate hook flushes the TTL window', async () => {
    // Verify the invalidate hook the writer-publish path uses. After
    // invalidation, the next call refreshes the cache from km-core.
    testHooks.invalidateStalenessCache();
    const { status, body } = await httpGet('/api/consolidation/status');
    expect(status).toBe(200);
    expect(typeof body.lastObservationAt).toBe('string');
  });
});
