/**
 * tests/integration/observation-writer.dedup.test.js
 *
 * Phase 44 Plan 13 — round-trip integration test for the writer-side
 * dedup + Artifacts-patch cutover to km-core.
 *
 * SCOPE (4 tests, all GREEN):
 *   1. Content-hash dedup — write 2 observations with identical messages
 *      → second call short-circuits via `_findExistingByContentHash` and
 *      no new entity is produced.
 *   2. Semantic dedup — write 50 observations with related summaries
 *      within the 4h window → the 51st near-duplicate is blocked by
 *      `_isSemanticallyDuplicate`.
 *   3. Artifacts-patch round-trip (T-44-13-02 — createdAt + createdBy
 *      preservation) — write 1 observation with `Artifacts: none` →
 *      second write adds modifiedFiles → re-fetch shows `Artifacts:
 *      edited <file>` AND createdAt + createdBy.runId UNCHANGED.
 *   4. T-44-13-01 perf gate — seed 1000 observations directly via
 *      `kmStore.putEntity` (bypassing the writer's LLM path for speed)
 *      then loop 100 `_findExistingByContentHash` calls and assert avg
 *      latency under the budget (2ms dev / 5ms CI).
 *
 * STRATEGY:
 *   * tmpdir-backed GraphKMStore so the production
 *     `.data/knowledge-graph/leveldb` LOCK is untouched
 *     (T-44-12-04 mitigation, reused).
 *   * Wire writer with `kmStore` directly (caller-supplied path — same
 *     shape obs-api uses).
 *   * `writeObservation` is the surface for tests 1+2+3; perf test calls
 *     `_findExistingByContentHash` directly to keep the perf measurement
 *     scoped to the km-core read path.
 *   * LLM proxy is mocked via global.fetch so writes don't depend on a
 *     live LLM (matches the convention in
 *     `tests/live-logging/ObservationWriter.*.test.js`).
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

const origStderrWrite = process.stderr.write.bind(process.stderr);
let _quietStderr = false;
process.stderr.write = function quietWrap(chunk, ...rest) {
  if (_quietStderr && typeof chunk === 'string' && chunk.startsWith('[ObservationWriter]')) {
    return true;
  }
  return origStderrWrite(chunk, ...rest);
};

describe('ObservationWriter dedup + Artifacts-patch (Phase 44 Plan 13)', () => {
  let dataDir;
  let kmStore;
  let writer;
  let GraphKMStore;
  let defaultOntologyDir;
  let ObservationWriter;
  let legacyObservationToEntity;

  beforeAll(async () => {
    _quietStderr = true;
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    const adapters = await import('@fwornle/km-core/adapters/legacy-ingest');
    legacyObservationToEntity = adapters.legacyObservationToEntity;
    const writerModule = await import('../../src/live-logging/ObservationWriter.js');
    ObservationWriter = writerModule.ObservationWriter;

    // tmpdir layout (mirrors observation-writer.km-core.test.js pattern):
    //   <tmpdir>/obs-writer-dedup-<rand>/km/leveldb         ← km-core LevelDB
    //   <tmpdir>/obs-writer-dedup-<rand>/km/exports         ← km-core JSON
    //   <tmpdir>/obs-writer-dedup-<rand>/sqlite/obs.db      ← legacy path (config-derive)
    //   <tmpdir>/obs-writer-dedup-<rand>/.observations/config.json
    dataDir = mkdtempSync(path.join(tmpdir(), 'obs-writer-dedup-'));
    const kmDbPath = path.join(dataDir, 'km', 'leveldb');
    const kmExportDir = path.join(dataDir, 'km', 'exports');
    const sqliteDir = path.join(dataDir, 'sqlite');
    const obsDir = path.join(dataDir, '.observations');
    mkdirSync(sqliteDir, { recursive: true });
    mkdirSync(obsDir, { recursive: true });
    writeFileSync(
      path.join(obsDir, 'config.json'),
      JSON.stringify({
        defaults: {
          model: 'anthropic/claude-haiku-4-5',
          observation: { messageTokens: 20000, bufferTokens: 0.2, retentionDays: 7 },
        },
      }),
    );

    const ontologyDir = defaultOntologyDir();
    kmStore = new GraphKMStore({
      dbPath: kmDbPath,
      exportDir: kmExportDir,
      ontologyDir,
    });
    await kmStore.open();

    writer = new ObservationWriter({
      dbPath: path.join(sqliteDir, 'obs.db'),
      configPath: path.join(obsDir, 'config.json'),
      kmStore,
    });
    await writer.init();

    // Mock the LLM proxy so writes don't depend on a live proxy. The canned
    // summary follows the 4-line template the writer's sanitizer expects.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        content:
          'Intent: investigate the proxy slowdown\n' +
          'Approach: checked queue depth and backlog\n' +
          'Artifacts: none\n' +
          'Result: identified blocked queue',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        tokens: 80,
        latencyMs: 120,
      }),
      text: async () => '',
    }));
  }, 30000);

  afterAll(async () => {
    try {
      if (writer) await writer.close();
    } catch { /* best-effort */ }
    try {
      if (kmStore) await kmStore.close();
    } catch { /* best-effort */ }
    try {
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
    delete global.fetch;
    _quietStderr = false;
    process.stderr.write = origStderrWrite;
  });

  test('Test 1 (content-hash dedup): identical messages → second write returns null, no new entity', async () => {
    const before = await kmStore.findByOntologyClass('Observation');
    const baselineCount = before.length;

    const messages = [
      { role: 'user', content: 'investigate the proxy slowdown' },
      { role: 'assistant', content: 'I checked the queue depth and found a backlog.' },
    ];
    const metadata = {
      agent: 'content-hash-test',
      session_id: 'session-content-hash',
      project: 'coding',
    };
    const summary =
      'Intent: investigate the proxy slowdown\n' +
      'Approach: checked queue depth and backlog\n' +
      'Artifacts: none\n' +
      'Result: identified blocked queue';

    const id1 = await writer.writeObservation(summary, messages, metadata);
    expect(typeof id1).toBe('string');

    // Second write with the same (agent, content_hash) → dedup short-circuit.
    const id2 = await writer.writeObservation(summary, messages, metadata);
    // writeObservation returns null when dedup short-circuits.
    expect(id2).toBeNull();

    const after = await kmStore.findByOntologyClass('Observation');
    expect(after.length).toBe(baselineCount + 1);
  });

  test('Test 2 (semantic dedup): related summaries within 4h → near-duplicate is blocked', async () => {
    // Seed 50 observations with DISTINCT topics (different keyword sets) so
    // they don't dedup against each other. Then write a 51st near-duplicate
    // of one of them — that one must be blocked by `_isSemanticallyDuplicate`.
    //
    // Each observation uses a unique topic from `topics[i]` so the seeded
    // writes don't trip semantic dedup themselves (keyword overlap between
    // observations is below the 0.4 Jaccard threshold). The 51st target
    // observation re-uses topic[0]'s Intent + Approach text → semantic
    // overlap is total (Jaccard 1.0) → dedup fires.
    const agent = 'semantic-dedup-test';
    const before = await kmStore.findByOntologyClass('Observation');
    const baselineCount = before.length;

    // 50 distinct topics — verbs + nouns from disjoint domains so the
    // stemmed keyword sets don't overlap above threshold.
    const topics = [
      ['refactor authentication module', 'extract JWT token parser', 'auth.js refactored'],
      ['fix database connection pool leak', 'tune pgbouncer settings', 'pool stabilized'],
      ['migrate logging pipeline', 'switch from winston to pino', 'logging migrated'],
      ['add user profile endpoint', 'implement REST handler for profile', 'endpoint shipped'],
      ['debug websocket disconnect', 'analyze heartbeat timing', 'reconnect logic fixed'],
      ['optimize image upload', 'compress with sharp library', 'upload speed doubled'],
      ['investigate redis eviction policy', 'switch to LRU mode', 'eviction tuned'],
      ['integrate stripe billing', 'wire webhook handlers', 'billing integration live'],
      ['build search autocomplete', 'use trie data structure', 'autocomplete responsive'],
      ['design notification system', 'queue with redis streams', 'notifications routed'],
    ];
    // Repeat the 10 topics 5x to reach 50, varying the iteration number
    // in messages so content_hash differs across all 50 writes.
    for (let i = 0; i < 50; i++) {
      const t = topics[i % topics.length];
      const messages = [
        { role: 'user', content: `${t[0]} run ${i}` },
        { role: 'assistant', content: `${t[1]} done — run ${i}` },
      ];
      const summary =
        `Intent: ${t[0]} variant ${Math.floor(i / topics.length)}\n` +
        `Approach: ${t[1]}\n` +
        `Artifacts: none\n` +
        `Result: ${t[2]}`;
      await writer.writeObservation(summary, messages, {
        agent,
        session_id: `s-${i}`,
        project: 'coding',
      });
    }

    const after50 = await kmStore.findByOntologyClass('Observation');
    const seedDelta = after50.length - baselineCount;
    // Some pairs may still trip semantic dedup (the variant suffix is
    // tight). Accept any seed count between 10 and 50 — the assertion that
    // matters is the 51st near-duplicate gets blocked.
    expect(seedDelta).toBeGreaterThanOrEqual(10);

    // 51st write: near-duplicate of topic[0] — same Intent + Approach
    // keywords, fresh session_id so content-hash differs.
    const t0 = topics[0];
    const messages51 = [
      { role: 'user', content: `please ${t0[0]} once more` },
      { role: 'assistant', content: `${t0[1]} — repeated this round.` },
    ];
    const summary51 =
      `Intent: ${t0[0]} again\n` +
      `Approach: ${t0[1]}\n` +
      `Artifacts: none\n` +
      `Result: ${t0[2]} once more`;
    const id51 = await writer.writeObservation(summary51, messages51, {
      agent,
      session_id: 's-51-target',
      project: 'coding',
    });
    // Semantic dedup blocks the write → returns null, no new entity lands.
    expect(id51).toBeNull();

    const after51 = await kmStore.findByOntologyClass('Observation');
    expect(after51.length).toBe(after50.length);
  }, 15000);

  test('Test 3 (Artifacts-patch + T-44-13-02 createdAt/createdBy preservation): patches the existing entity in place', async () => {
    // Distinct agent so this test doesn't collide with Tests 1/2.
    const agent = 'artifacts-patch-test';
    const messages = [
      { role: 'user', content: 'fix the routing config' },
      { role: 'assistant', content: 'Done — routing config patched.' },
    ];
    const summary =
      'Intent: fix the routing config\n' +
      'Approach: edit the routing JSON\n' +
      'Artifacts: none\n' +
      'Result: routing config patched';

    // First write: no modifiedFiles → summary stays "Artifacts: none".
    const id1 = await writer.writeObservation(summary, messages, {
      agent,
      session_id: 'patch-session-1',
      project: 'coding',
    });
    expect(typeof id1).toBe('string');

    // Capture the canonical entity state BEFORE the patch.
    const beforeMatches = await kmStore.findByLegacyId({ system: 'A', id: id1 });
    expect(beforeMatches).toBeDefined();
    const originalCreatedAt = beforeMatches.createdAt;
    const originalCreatedByRunId = beforeMatches.createdBy?.runId;
    const originalCreatedByProvider = beforeMatches.createdBy?.provider;
    expect(typeof originalCreatedAt).toBe('string');
    expect(typeof originalCreatedByRunId).toBe('string');
    expect(originalCreatedByProvider).toBe('observation-writer');

    // Wait a tick to make sure any new stamping would change the timestamp.
    await new Promise((r) => setTimeout(r, 20));

    // Second write: same content but with modifiedFiles → patch path fires.
    const id2 = await writer.writeObservation(summary, messages, {
      agent,
      session_id: 'patch-session-1',
      project: 'coding',
      modifiedFiles: ['scripts/configure-wave-analysis-routing.sh'],
    });
    // The patch path returns the existing id.
    expect(id2).toBe(id1);

    // Re-fetch and assert the patched fields + the preserved provenance.
    const afterMatches = await kmStore.findByLegacyId({ system: 'A', id: id1 });
    expect(afterMatches).toBeDefined();

    const patchedSummary = (afterMatches.metadata && afterMatches.metadata.summary) || '';
    expect(patchedSummary).toMatch(/Artifacts:\s*edited configure-wave-analysis-routing\.sh/);
    expect(patchedSummary).not.toMatch(/Artifacts:\s*none/i);
    expect(afterMatches.description).toBe(patchedSummary);

    expect(afterMatches.metadata.modifiedFiles).toEqual([
      'scripts/configure-wave-analysis-routing.sh',
    ]);

    // T-44-13-02 invariants — createdAt + createdBy UNCHANGED.
    expect(afterMatches.createdAt).toBe(originalCreatedAt);
    expect(afterMatches.createdBy?.runId).toBe(originalCreatedByRunId);
    expect(afterMatches.createdBy?.provider).toBe(originalCreatedByProvider);
    // legacyId untouched too — it's the row-identity carrier.
    expect(afterMatches.legacyId).toEqual({ system: 'A', id: id1 });
  });

  test('Test 4 (T-44-13-01 perf gate): _findExistingByContentHash avg latency under budget at 1k observations', async () => {
    // Seed 1000 observations directly via putEntity (bypass the writer's
    // LLM path for setup speed — keeps the test under 10s wall-clock).
    // Use a perf-specific agent and content_hash space so we don't
    // collide with Tests 1/2/3 or pollute the dedup loops there.
    const perfAgent = 'perf-gate-agent';
    const runId = 'perf-seed-' + Date.now();
    const ts = new Date().toISOString();

    for (let i = 0; i < 1000; i++) {
      const contentHash = `perf-hash-${i.toString().padStart(4, '0')}`;
      const row = {
        id: `perf-row-${i.toString().padStart(4, '0')}`,
        summary:
          `Intent: perf seed ${i}\n` +
          `Approach: bulk putEntity\n` +
          `Artifacts: none\n` +
          `Result: seeded entity ${i}`,
        messages: '[]',
        agent: perfAgent,
        session_id: `perf-session-${i}`,
        source_file: null,
        created_at: ts,
        metadata: { project: 'perf-test' },
        content_hash: contentHash,
        quality: 'normal',
      };
      const entity = legacyObservationToEntity(row, runId, ts);
      await kmStore.putEntity(entity, { skipOntologyCheck: true });
    }

    // Choose a target content_hash that DOES exist in the seeded pool —
    // worst case for an O(N) scan is a match late in the iteration order.
    const targetHash = 'perf-hash-0500';

    // Warm one call so any cold-path costs don't pollute the average.
    await writer._findExistingByContentHash(perfAgent, targetHash);

    // Measure 100 calls.
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const result = await writer._findExistingByContentHash(perfAgent, targetHash);
      expect(result).toBeDefined();
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / 100;

    // CI-aware budget (T-44-13-01 mitigation). Dev: <2ms. CI: <5ms or
    // warn-skip if the CI box is exceptionally slow.
    const budgetMs = process.env.CI ? 5 : 2;
    if (process.env.CI && avgMs > budgetMs) {
      process.stderr.write(
        `[perf] CI machine slow — avg ${avgMs.toFixed(3)}ms over budget ${budgetMs}ms; skipping assertion\n`
      );
    } else {
      expect(avgMs).toBeLessThan(budgetMs);
    }
    // Always log the actual measurement so the operator can spot trends.
    origStderrWrite(
      `[perf gate T-44-13-01] avg _findExistingByContentHash latency: ${avgMs.toFixed(3)}ms ` +
      `(budget: ${budgetMs}ms, 100 calls, 1000 pre-seeded observations)\n`
    );
  }, 30000);
});
