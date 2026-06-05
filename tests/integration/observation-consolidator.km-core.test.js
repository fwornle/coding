/**
 * tests/integration/observation-consolidator.km-core.test.js
 *
 * Phase 44 Plan 17 — round-trip integration test for the
 * km-core-native ObservationConsolidator (Plan 44-17 Task 3).
 *
 * SCOPE (6 tests, all GREEN):
 *   1. Basic digest:           seed 5 Observations across 1 day, run
 *                              `consolidateDay`, assert >= 1 Digest entity
 *                              lands in km-core with the legacy shape
 *                              (entityType + ontologyClass both 'Digest',
 *                              legacyId.system === 'A', metadata carries
 *                              date/theme/summary/observation_ids/agents).
 *
 *   2. Insight gating:         seed 4 Digests via the same path; run() the
 *                              consolidator and assert NO Insights synthesized
 *                              (below the >=5 unsynthesized threshold). Add a
 *                              5th unsynthesized Digest, re-run, assert
 *                              insight synthesis fires.
 *
 *   3. Idempotency (Option A): run consolidator twice on the same seed.
 *                              Assert no double-digesting — each Observation's
 *                              metadata.digested_at is stamped on pass 1, and
 *                              the second consolidateDay returns
 *                              { digests: 0, observations: 0 }.
 *
 *   4. Multi-agent + multi-project grouping: seed 12 obs across
 *                              (claude, copilot) × (coding, sketcher),
 *                              consolidate, assert per-(agent, project)
 *                              partitioning: 'coding' and 'sketcher' Digest
 *                              entities each appear, and each Digest's
 *                              metadata.project matches the source.
 *
 *   5. Confidence decay:       seed 1 Insight via the writer-shaped putEntity
 *                              path, run _decayConfidence directly, assert
 *                              the entity's metadata gets a `decayBreakdown`
 *                              object stamped and `confidence` stays at the
 *                              correct floor (>= 0.3, modulo drag).
 *
 *   6. T-44-17-01 perf gate:   seed 1000 Observations spanning 7 days, run
 *                              a single-day consolidateDay pass, assert
 *                              the day-scan completes in <500ms (dev) /
 *                              <2s (CI).
 *
 * STRATEGY:
 *   * tmpdir-backed GraphKMStore (T-44-17-01 + matches the writer-test
 *     convention so the production LevelDB LOCK is never touched).
 *   * Wire consolidator with `kmStore` directly (caller-supplied path —
 *     same shape obs-api uses).
 *   * Mock global.fetch so `_callLLM` returns canned <digest>/<insight>
 *     blocks. NO live LLM proxy dependency.
 *   * Observations are seeded via `legacyObservationToEntity` +
 *     `putEntity` (skipOntologyCheck:true) — same trusted-path the writer
 *     uses (Plan 44-13). This bypasses the writer's LLM summarization
 *     and dedup, letting the test pre-seed exactly the rows it needs.
 *
 *   The embedder + classifier helpers in the consolidator fail open when
 *   the optional dist/ modules are unavailable; the test runs with both
 *   absent and exercises the fallback `[].map(() => ({action:'insert'}))`
 *   path — sufficient for round-trip persistence assertions.
 *
 * RUNNER: NODE_OPTIONS='--experimental-vm-modules --no-warnings' jest
 *   (matches package.json "test" — Jest 29 with ESM).
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { jest } from '@jest/globals';

const origStderrWrite = process.stderr.write.bind(process.stderr);
let _quietStderr = false;
process.stderr.write = function quietWrap(chunk, ...rest) {
  if (
    _quietStderr &&
    typeof chunk === 'string' &&
    (chunk.startsWith('[Consolidator]') ||
      chunk.startsWith('[ObservationConsolidator]') ||
      chunk.startsWith('[verifier]') ||
      chunk.startsWith('[Compaction]'))
  ) {
    return true;
  }
  return origStderrWrite(chunk, ...rest);
};

/**
 * Canned LLM responses keyed by the process name passed to `_callLLM`.
 * The digest reply extracts the GLOBAL observation indices from the prompt
 * (the consolidator's chunk loop numbers them `[globalOffset+1]`,
 * `[globalOffset+2]`, ...) so the response's `<observations>` list maps
 * correctly through `_parseDigests`'s `n - globalOffset` normalization.
 */
const CANNED_DIGEST_RESPONSE = (indices) => `
<digest>
<theme>Test Consolidation Theme</theme>
<observations>${indices.join(',')}</observations>
<summary>Synthesized digest covering the seeded test observations.

This digest is the mocked LLM output used by the Plan 44-17 integration
test. It exists solely to drive the persistence path through km-core.</summary>
</digest>
`;

const CANNED_INSIGHT_RESPONSE = `
<insight>
<topic>Test Insight Topic</topic>
<scope>test/Plan-44-17</scope>
<confidence>0.85</confidence>
<summary>## Purpose

Synthesized insight for the Plan 44-17 integration test.

## Architecture

This insight is produced by a mocked LLM response so the round-trip
through km-core can be asserted without a live proxy dependency.

## Key Files

- tests/integration/observation-consolidator.km-core.test.js

## Usage

The consolidator's insight synthesis path round-trips this content into
a km-core Insight entity stamped with legacyId.system === 'A'.

## Troubleshooting

If this insight does not appear, the consolidator's km-core write path
is broken — refer back to commit f3701499f.</summary>
</insight>
`;

/** Build a fetch mock that returns the canned response for the given process. */
function buildFetchMock() {
  return jest.fn(async (_url, init) => {
    let parsedBody;
    try {
      parsedBody = JSON.parse(init?.body ?? '{}');
    } catch {
      parsedBody = {};
    }
    const proc = parsedBody.process || 'consolidator';
    let content;
    if (proc === 'consolidator-digest') {
      // Extract the GLOBAL [N] indices from the user prompt — the
      // consolidator's chunk loop numbers each observation with
      // `[globalOffset + i + 1]`, so a single chunk N obs into chunk 2 has
      // indices [36], [37], ..., [70] (CHUNK_SIZE=35 in consolidateDay).
      // The canned digest must echo those exact numbers so _parseDigests
      // can map them back to the chunk's observations array via the
      // `n - globalOffset` normalization.
      const userPrompt = parsedBody.messages?.[1]?.content || '';
      const indices = [];
      for (const match of userPrompt.matchAll(/^\[(\d+)\]/gm)) {
        indices.push(parseInt(match[1], 10));
      }
      content = CANNED_DIGEST_RESPONSE(indices.length > 0 ? indices : [1]);
    } else if (proc === 'consolidator-insight' || proc === 'consolidator-resynthesize') {
      content = CANNED_INSIGHT_RESPONSE;
    } else if (proc === 'consolidator-compaction') {
      content = '<verdict><action>SEPARATE</action><reason>test</reason></verdict>';
    } else {
      content = '';
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content, provider: 'anthropic', model: 'claude-haiku-4-5' }),
      text: async () => content,
    };
  });
}

describe('ObservationConsolidator → km-core round-trip (Phase 44 Plan 17)', () => {
  let dataDir;
  let kmStore;
  let GraphKMStore;
  let defaultOntologyDir;
  let ObservationConsolidator;
  let legacyObservationToEntity;
  let legacyInsightToEntity;

  beforeAll(async () => {
    _quietStderr = true;
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    const adapters = await import('@fwornle/km-core/adapters/legacy-ingest');
    legacyObservationToEntity = adapters.legacyObservationToEntity;
    legacyInsightToEntity = adapters.legacyInsightToEntity;
    const consolidatorModule = await import(
      '../../src/live-logging/ObservationConsolidator.js'
    );
    ObservationConsolidator = consolidatorModule.ObservationConsolidator;
  }, 30000);

  afterAll(async () => {
    _quietStderr = false;
    process.stderr.write = origStderrWrite;
  });

  /**
   * Build a fresh tmpdir-backed GraphKMStore + ObservationConsolidator wired
   * against it. Each test gets its own dataDir so the assertions don't see
   * cross-test pollution.
   */
  async function makeFixture(label) {
    const dir = mkdtempSync(path.join(tmpdir(), `obs-cons-${label}-`));
    const kmDbPath = path.join(dir, 'km', 'leveldb');
    const kmExportDir = path.join(dir, 'km', 'exports');
    const obsDir = path.join(dir, '.observations');
    mkdirSync(obsDir, { recursive: true });
    writeFileSync(
      path.join(obsDir, 'config.json'),
      JSON.stringify({
        defaults: {
          model: 'anthropic/claude-haiku-4-5',
          observation: {
            messageTokens: 20000,
            bufferTokens: 0.2,
            retentionDays: 7,
          },
        },
      }),
    );
    const ontologyDir = defaultOntologyDir();
    const store = new GraphKMStore({
      dbPath: kmDbPath,
      exportDir: kmExportDir,
      ontologyDir,
    });
    await store.open();
    const consolidator = new ObservationConsolidator({
      dbPath: path.join(dir, 'observations.db'),
      kmStore: store,
      runId: 'test-' + label + '-' + Date.now(),
    });
    await consolidator.init();
    return { dir, store, consolidator };
  }

  /** Helper: stamp one Observation entity into km-core via the trusted path. */
  async function seedObservation(store, {
    id,
    summary,
    agent,
    project,
    date,
    quality = 'normal',
    digested = null,
  }) {
    const ts = `${date}T${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:00:00Z`;
    const row = {
      id,
      summary,
      messages: [],
      agent,
      session_id: 'sess-' + id.slice(0, 8),
      source_file: null,
      created_at: ts,
      metadata: { project, agent },
      content_hash: 'hash-' + id.slice(0, 8),
      quality,
      digested_at: digested,
    };
    const entity = legacyObservationToEntity(row, 'test-seed-' + Date.now(), ts);
    await store.putEntity(entity, { skipOntologyCheck: true });
    return entity;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Test 1 — basic digest
  // ───────────────────────────────────────────────────────────────────────
  test('Test 1: consolidateDay produces a Digest entity from 5 seeded Observations', async () => {
    const fx = await makeFixture('test1');
    global.fetch = buildFetchMock();
    try {
      const date = '2026-06-04';
      for (let i = 0; i < 5; i++) {
        await seedObservation(fx.store, {
          id: 'obs-1-' + i,
          summary: `Intent: investigate item ${i}\nApproach: tested\nArtifacts: none\nResult: ok`,
          agent: 'claude',
          project: 'coding',
          date,
        });
      }

      const result = await fx.consolididateDay
        ? await fx.consolidator.consolidateDay(date)
        : await fx.consolidator.consolidateDay(date);

      expect(result.digests).toBeGreaterThanOrEqual(1);
      expect(result.observations).toBe(5);

      const digestEntities = await fx.store.findByOntologyClass('Digest');
      expect(digestEntities.length).toBeGreaterThanOrEqual(1);
      const d = digestEntities[0];
      expect(d.entityType).toBe('Digest');
      expect(d.ontologyClass).toBe('Digest');
      expect(d.layer).toBe('pattern');
      expect(d.legacyId).toBeDefined();
      expect(d.legacyId.system).toBe('A');
      expect(d.metadata).toBeDefined();
      expect(d.metadata.date).toBe(date);
      expect(typeof d.metadata.theme).toBe('string');
      expect(typeof d.metadata.summary).toBe('string');
      expect(Array.isArray(d.metadata.observation_ids)).toBe(true);
      expect(d.metadata.observation_ids.length).toBe(5);
      expect(Array.isArray(d.metadata.agents)).toBe(true);
      expect(d.metadata.agents).toContain('claude');
      expect(d.metadata.project).toBe('coding');
      expect(d.createdBy).toBeDefined();
      // The consolidator stamps its own runId on Digest entities.
      expect(d.createdBy.runId).toMatch(/^test-test1-/);
    } finally {
      try { await fx.store.close(); } catch { /* ok */ }
      try { rmSync(fx.dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }, 60000);

  // ───────────────────────────────────────────────────────────────────────
  // Test 2 — insight gating (>=5 unsynthesized digests)
  // ───────────────────────────────────────────────────────────────────────
  test('Test 2: insight synthesis is gated by the >=5 unsynthesized-digests threshold', async () => {
    const fx = await makeFixture('test2');
    global.fetch = buildFetchMock();
    try {
      // Seed 4 Digests directly via the consolidator's same shape — emit
      // them as already-stamped Digest entities (idempotency-safe; the
      // synthesizeInsights gate counts these as "unsynthesized" because
      // no Insight references them).
      const baseDate = '2026-06-01';
      for (let i = 0; i < 4; i++) {
        await seedObservation(fx.store, {
          id: 'obs-2-' + i,
          summary: 'Intent: seed digest source ' + i + '\nApproach: tested\nArtifacts: none\nResult: ok',
          agent: 'claude',
          project: 'coding',
          date: baseDate,
        });
      }
      // Each day yields its own Digest (canned response). 4 distinct dates → 4 Digests.
      await fx.consolidator.consolidateDay('2026-06-01');

      // Reset observations for the next 3 days.
      for (let day = 2; day <= 4; day++) {
        const dStr = `2026-06-0${day}`;
        await seedObservation(fx.store, {
          id: `obs-2-d${day}`,
          summary: 'Intent: seed digest source ' + day + '\nApproach: tested\nArtifacts: none\nResult: ok',
          agent: 'claude',
          project: 'coding',
          date: dStr,
        });
        await fx.consolidator.consolidateDay(dStr);
      }

      const digestsAfter4 = await fx.store.findByOntologyClass('Digest');
      expect(digestsAfter4.length).toBeGreaterThanOrEqual(4);

      // Run the full pipeline (consolidateAll → synthesizeInsights only when
      // unsynth count >= 5). At 4 digests, NO insights should land.
      await fx.consolidator.run({ includeToday: true });
      let insightsAfter4 = await fx.store.findByOntologyClass('Insight');
      expect(insightsAfter4.length).toBe(0);

      // Add a 5th digest source-day and re-run. Now unsynth count == 5;
      // synthesizeInsights fires and at least one Insight lands.
      await seedObservation(fx.store, {
        id: 'obs-2-d5',
        summary: 'Intent: seed digest source 5\nApproach: tested\nArtifacts: none\nResult: ok',
        agent: 'claude',
        project: 'coding',
        date: '2026-06-05',
      });
      await fx.consolidator.consolidateDay('2026-06-05');

      const digestsAfter5 = await fx.store.findByOntologyClass('Digest');
      expect(digestsAfter5.length).toBeGreaterThanOrEqual(5);

      await fx.consolidator.run({ includeToday: true });
      const insightsAfter5 = await fx.store.findByOntologyClass('Insight');
      expect(insightsAfter5.length).toBeGreaterThanOrEqual(1);
      const ins = insightsAfter5[0];
      expect(ins.entityType).toBe('Insight');
      expect(ins.ontologyClass).toBe('Insight');
      expect(ins.legacyId.system).toBe('A');
      expect(typeof ins.metadata.topic).toBe('string');
      expect(Array.isArray(ins.metadata.digest_ids)).toBe(true);
    } finally {
      try { await fx.store.close(); } catch { /* ok */ }
      try { rmSync(fx.dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }, 120000);

  // ───────────────────────────────────────────────────────────────────────
  // Test 3 — Option A idempotency (digested_at)
  // ───────────────────────────────────────────────────────────────────────
  test('Test 3: idempotency — second consolidateDay pass digests 0 observations (Option A: metadata.digested_at)', async () => {
    const fx = await makeFixture('test3');
    global.fetch = buildFetchMock();
    try {
      const date = '2026-06-04';
      for (let i = 0; i < 3; i++) {
        await seedObservation(fx.store, {
          id: 'obs-3-' + i,
          summary: 'Intent: idempotency seed ' + i + '\nApproach: tested\nArtifacts: none\nResult: ok',
          agent: 'claude',
          project: 'coding',
          date,
        });
      }

      const pass1 = await fx.consolidator.consolidateDay(date);
      expect(pass1.observations).toBe(3);
      expect(pass1.digests).toBeGreaterThanOrEqual(1);

      // Assert every Observation now carries metadata.digested_at.
      const obsAfter = await fx.store.findByOntologyClass('Observation');
      const allDigested = obsAfter.every(e => typeof e.metadata?.digested_at === 'string');
      expect(allDigested).toBe(true);

      // Pass 2: nothing left to digest.
      const pass2 = await fx.consolidator.consolidateDay(date);
      expect(pass2.digests).toBe(0);
      expect(pass2.observations).toBe(0);
    } finally {
      try { await fx.store.close(); } catch { /* ok */ }
      try { rmSync(fx.dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }, 60000);

  // ───────────────────────────────────────────────────────────────────────
  // Test 4 — multi-agent + multi-project partitioning
  // ───────────────────────────────────────────────────────────────────────
  test('Test 4: per-project partitioning produces separate Digests for coding vs sketcher', async () => {
    const fx = await makeFixture('test4');
    global.fetch = buildFetchMock();
    try {
      const date = '2026-06-04';
      const matrix = [];
      for (const agent of ['claude', 'copilot']) {
        for (const project of ['coding', 'sketcher']) {
          for (let i = 0; i < 3; i++) {
            matrix.push({ agent, project, i });
          }
        }
      }
      for (const cell of matrix) {
        await seedObservation(fx.store, {
          id: `obs-4-${cell.agent}-${cell.project}-${cell.i}`,
          summary: `Intent: ${cell.agent}/${cell.project} item ${cell.i}\nApproach: tested\nArtifacts: none\nResult: ok`,
          agent: cell.agent,
          project: cell.project,
          date,
        });
      }
      expect(matrix.length).toBe(12);

      const result = await fx.consolidator.consolidateDay(date);
      expect(result.observations).toBe(12);
      expect(result.digests).toBeGreaterThanOrEqual(2);  // at least one per project

      const digests = await fx.store.findByOntologyClass('Digest');
      const projects = new Set(digests.map(d => d.metadata?.project));
      expect(projects.has('coding')).toBe(true);
      expect(projects.has('sketcher')).toBe(true);

      // Spot-check that each project's Digest only carries its own
      // observation ids (no cross-project bleed).
      const codingDigests = digests.filter(d => d.metadata?.project === 'coding');
      for (const d of codingDigests) {
        for (const oid of d.metadata.observation_ids) {
          expect(oid.includes('coding')).toBe(true);
        }
      }
      const sketcherDigests = digests.filter(d => d.metadata?.project === 'sketcher');
      for (const d of sketcherDigests) {
        for (const oid of d.metadata.observation_ids) {
          expect(oid.includes('sketcher')).toBe(true);
        }
      }
    } finally {
      try { await fx.store.close(); } catch { /* ok */ }
      try { rmSync(fx.dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }, 90000);

  // ───────────────────────────────────────────────────────────────────────
  // Test 5 — confidence decay round-trip
  // ───────────────────────────────────────────────────────────────────────
  test('Test 5: _decayConfidence stamps decayBreakdown on the Insight entity', async () => {
    const fx = await makeFixture('test5');
    try {
      // Seed an Insight that is "old enough" for the emergent-drag floor
      // to NOT fire (weeksOld < 13). decay should leave confidence near
      // base unless churn is detected — which it won't be in a tmpdir.
      const insightId = crypto.randomUUID();
      const ts = '2026-05-15T12:00:00Z';
      const row = {
        id: insightId,
        topic: 'Test decay topic',
        summary: '## Purpose\n\nTest decay round-trip.',
        confidence: 0.9,
        digest_ids: [],
        last_updated: ts,
        created_at: ts,
        metadata: { project: 'coding', baseConfidence: 0.9 },
        project: 'coding',
      };
      const entity = legacyInsightToEntity(row, 'test-seed-5', ts);
      await fx.store.putEntity(entity, { skipOntologyCheck: true });

      await fx.consolidator._decayConfidence();

      const insightsAfter = await fx.store.findByOntologyClass('Insight');
      expect(insightsAfter.length).toBe(1);
      const ins = insightsAfter[0];
      expect(ins.metadata?.decayBreakdown).toBeDefined();
      expect(typeof ins.metadata.decayBreakdown.baseConfidence).toBe('number');
      expect(typeof ins.metadata.decayBreakdown.finalConfidence).toBe('number');
      // Confidence floor: never below 0.3.
      const finalConf =
        typeof ins.metadata.confidence === 'number'
          ? ins.metadata.confidence
          : 0.9;
      expect(finalConf).toBeGreaterThanOrEqual(0.3);
      expect(finalConf).toBeLessThanOrEqual(0.9);
    } finally {
      try { await fx.store.close(); } catch { /* ok */ }
      try { rmSync(fx.dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }, 30000);

  // ───────────────────────────────────────────────────────────────────────
  // Test 6 — T-44-17-01 perf gate
  // ───────────────────────────────────────────────────────────────────────
  test('Test 6: T-44-17-01 perf gate — consolidateDay over 1000 pre-seeded obs completes within budget', async () => {
    const fx = await makeFixture('test6');
    global.fetch = buildFetchMock();
    try {
      // Spread 1000 observations across 7 days; consolidate only day 4
      // to measure the per-day scan cost (not the multi-day loop).
      const days = [
        '2026-05-29',
        '2026-05-30',
        '2026-05-31',
        '2026-06-01',
        '2026-06-02',
        '2026-06-03',
        '2026-06-04',
      ];
      const TARGET_DAY = '2026-06-01';
      const TOTAL = 1000;
      for (let i = 0; i < TOTAL; i++) {
        await seedObservation(fx.store, {
          id: 'obs-6-' + i,
          summary: 'Intent: perf seed ' + i + '\nApproach: tested\nArtifacts: none\nResult: ok',
          agent: 'claude',
          project: 'coding',
          date: days[i % days.length],
        });
      }
      // Sanity: the target day has ~143 obs.
      const targetCount = TOTAL / days.length;

      const t0 = Date.now();
      const result = await fx.consolidator.consolidateDay(TARGET_DAY);
      const elapsedMs = Date.now() - t0;
      // 1000 obs total / 7 days ~= 143 obs in the target day. The scan
      // is O(N_total) (in-memory filter), so ~1k entity iteration plus
      // the canned-LLM round-trip.
      expect(result.observations).toBeGreaterThanOrEqual(Math.floor(targetCount * 0.9));
      const budget = process.env.CI ? 2000 : 500;
      // Log the timing so the test output makes the perf reality visible.
      origStderrWrite(
        `[perf gate T-44-17-01] consolidateDay over 1k obs: ${elapsedMs}ms (budget: ${budget}ms; ${result.observations} obs digested)\n`
      );
      expect(elapsedMs).toBeLessThanOrEqual(budget);
    } finally {
      try { await fx.store.close(); } catch { /* ok */ }
      try { rmSync(fx.dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }, 120000);
});
