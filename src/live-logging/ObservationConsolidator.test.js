/**
 * Phase 59 Plan 02 — ObservationConsolidator.consolidateDay derivedFrom emission tests.
 *
 * Locks the D-02 / D-02.1 / D-02.2 contracts at the unit level for the
 * Digest plain-insert branch (OC.js:~1271-1296). Phase 59 closes the
 * ORPHAN-DIG-01 writer-path gap by emitting one `derivedFrom` edge per
 * observation_id in the same try-block as putEntity — the km-core JSON
 * exporter's 5s debounce is the atomicity envelope (Phase 58 D-04 verbatim,
 * applied to Digests).
 *
 *   Test 1 (D-02 happy path)     — N derivedFrom edges emitted for N
 *                                  resolvable observation ids; each edge
 *                                  carries metadata.source='observation-
 *                                  consolidator' + confidence=1.0 +
 *                                  ISO-8601 addedAt.
 *   Test 2 (D-02.2 skip-and-log) — observation_ids that resolve to null via
 *                                  findByLegacyId are skipped non-fatally
 *                                  with a stderr "not yet persisted" log;
 *                                  the Digest still lands with remaining
 *                                  edges.
 *   Test 3 (D-02 atomicity)      — within a single Digest iteration,
 *                                  putEntity precedes every derivedFrom
 *                                  addRelation; ordering verified via
 *                                  callLog indices.
 *   Test 4 (D-02 non-fatal       — when one addRelation throws, the loop
 *           addRelation failure)   continues; remaining edges still fire;
 *                                  createdCount still increments; stderr
 *                                  captures the non-fatal error log.
 *
 * Framework: node:test + node:assert/strict — matches ObservationWriter.test.js.
 *
 * Run via: node --test src/live-logging/ObservationConsolidator.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ObservationConsolidator } from './ObservationConsolidator.js';

// ---------------------------------------------------------------------------
// Mock kmStore — records every op into callLog so tests can assert ordering.
// Pre-seeded with Observation entities whose legacyId matches the
// observation ids referenced by the canned LLM digest output. Tests can
// suppress specific observation resolutions to exercise the D-02.2 skip.
// ---------------------------------------------------------------------------

function createMockKmStore({ unresolvedLegacyIds = new Set(), failingDerivedFromTarget = null } = {}) {
  const callLog = [];
  const entities = new Map();
  const relations = [];

  // Pre-seed three Observation entities. Each has a legacyId in system 'A'
  // so findByLegacyId can resolve them to minted km-core ids.
  const obsLegacyIds = ['obs-1', 'obs-2', 'obs-3'];
  for (let i = 0; i < obsLegacyIds.length; i++) {
    const id = `mock-obs-mint-${i + 1}`;
    entities.set(id, {
      id,
      ontologyClass: 'Observation',
      entityType: 'Observation',
      legacyId: { system: 'A', id: obsLegacyIds[i] },
      metadata: {
        createdAt: '2026-06-15T10:00:00.000Z',
        summary: `Observation ${i + 1}`,
        agent: 'claude',
        quality: 'normal',
        project: 'coding',
      },
      description: `Observation ${i + 1}`,
      validFrom: '2026-06-15T10:00:00.000Z',
    });
  }

  const store = {
    callLog,
    _entities: entities,
    _relations: relations,
    async putEntity(entity, opts) {
      let id = entity.id;
      if (!id && entity.legacyId) {
        for (const e of entities.values()) {
          if (
            e.legacyId &&
            e.legacyId.system === entity.legacyId.system &&
            e.legacyId.id === entity.legacyId.id
          ) {
            id = e.id;
            break;
          }
        }
      }
      if (!id) id = `mock-mint-${entities.size + 1}`;
      callLog.push({ op: 'putEntity', id, entityType: entity.entityType, legacyId: entity.legacyId, opts });
      entities.set(id, { ...entity, id });
      return id;
    },
    async addRelation(rel) {
      // Allow per-target failure injection (Test 4).
      if (failingDerivedFromTarget && rel.type === 'derivedFrom' && rel.to === failingDerivedFromTarget) {
        callLog.push({ op: 'addRelation', from: rel.from, to: rel.to, type: rel.type, metadata: rel.metadata, failed: true });
        throw new Error(`Target node not found: ${rel.to}`);
      }
      callLog.push({ op: 'addRelation', from: rel.from, to: rel.to, type: rel.type, metadata: rel.metadata });
      relations.push(rel);
    },
    async findRelations(filter) {
      callLog.push({ op: 'findRelations', filter });
      return relations.filter((r) =>
        (filter.from === undefined || r.from === filter.from) &&
        (filter.to === undefined || r.to === filter.to) &&
        (filter.type === undefined || r.type === filter.type),
      );
    },
    async findByOntologyClass(klass) {
      callLog.push({ op: 'findByOntologyClass', klass });
      return Array.from(entities.values()).filter(
        (e) => e.ontologyClass === klass || e.entityType === klass,
      );
    },
    async findByLegacyId(legacyId) {
      callLog.push({ op: 'findByLegacyId', legacyId });
      // D-02.2 — caller-configurable suppression to exercise the skip path.
      if (unresolvedLegacyIds.has(legacyId.id)) return null;
      for (const e of entities.values()) {
        if (e.legacyId && e.legacyId.system === legacyId.system && e.legacyId.id === legacyId.id) {
          return e;
        }
      }
      return null;
    },
    async mergeAttributes(id, patch) {
      callLog.push({ op: 'mergeAttributes', id, patch });
      if (entities.has(id)) entities.set(id, { ...entities.get(id), ...patch });
    },
  };
  return store;
}

/**
 * Build a consolidator wired to a mock kmStore, with `_callLLM` and
 * `_getEmbedder` short-circuited so the test does NOT need a live proxy or
 * embedder. The canned LLM response references the three observation ids
 * pre-seeded by createMockKmStore (1-indexed mapping → obs-1, obs-2, obs-3).
 */
function createConsolidator(kmStore) {
  const consolidator = new ObservationConsolidator({
    kmStore,
    runId: 'test-run-59-02',
  });

  // Short-circuit the LLM. The canned XML produces ONE digest covering all
  // three pre-seeded observations (mapped via 1-indexed observation numbers).
  // The _parseDigests path turns this into `{observationIds: ['obs-1','obs-2','obs-3']}`.
  consolidator._callLLM = async (_prompt, _processName) => {
    return `<digest>
<theme>Test consolidation</theme>
<observations>1,2,3</observations>
<summary>Three test observations consolidated into one digest for unit testing.</summary>
</digest>`;
  };

  // No embedder — _buildDigestMergePlan returns the all-insert fallback when
  // _getEmbedder returns null, so every test digest takes the plain-insert
  // branch (the path under test for D-02).
  consolidator._getEmbedder = async () => null;

  // No project backfill — keeps the test isolated from the classifier path.
  consolidator._backfillProjectsInBatch = async () => {};

  // No sanitization — pass digests through untouched.
  consolidator._sanitizeDigestEntry = (d) => d;

  // No redaction — preserve fixture text verbatim.
  consolidator._redact = (s) => s;
  consolidator._redactPaths = (s) => s;

  // No Redis publish — _publishEmbeddingEvent lazy-inits an ioredis client
  // whose lazyConnect socket keeps the event loop alive past the test body
  // and causes `node --test` to exit 124 (timeout). Stub it out — Redis
  // publication is fire-and-forget and orthogonal to the D-02 contract.
  consolidator._publishEmbeddingEvent = () => {};

  return consolidator;
}

// ---------------------------------------------------------------------------
// Test 1 — D-02 happy path: N derivedFrom edges for N resolvable obs ids.
// ---------------------------------------------------------------------------

describe('ObservationConsolidator.consolidateDay — D-02 derivedFrom happy path (Test 1)', () => {
  it('emits one derivedFrom edge per resolvable observation_id with the locked metadata shape', async () => {
    // D-02 contract: writer path (plain-insert branch of consolidateDay)
    // emits one `derivedFrom` edge per id in `row.observation_ids`. All three
    // observations are pre-seeded so findByLegacyId resolves them to minted
    // km-core ids. The Digest's putEntity is followed by exactly 3 addRelation
    // calls with type='derivedFrom' in the same try-block.
    const kmStore = createMockKmStore();
    const consolidator = createConsolidator(kmStore);

    await consolidator.consolidateDay('2026-06-15');

    const derivedFromEdges = kmStore._relations.filter((r) => r.type === 'derivedFrom');
    assert.equal(derivedFromEdges.length, 3, '3 derivedFrom edges land on the store');

    // All edges share the same `from` (the freshly-minted Digest id).
    const fromIds = new Set(derivedFromEdges.map((r) => r.from));
    assert.equal(fromIds.size, 1, 'all derivedFrom edges share one source (the new Digest)');

    // Each target is one of the pre-seeded Observation ids.
    const toIds = derivedFromEdges.map((r) => r.to).sort();
    assert.deepEqual(
      toIds,
      ['mock-obs-mint-1', 'mock-obs-mint-2', 'mock-obs-mint-3'],
      'each edge points to a distinct pre-seeded Observation',
    );

    // Metadata payload — locked by D-02 must_haves.
    for (const edge of derivedFromEdges) {
      assert.equal(edge.metadata.source, 'observation-consolidator', 'writer-path source stamp');
      assert.equal(edge.metadata.confidence, 1.0, 'confidence stamp');
      assert.ok(typeof edge.metadata.addedAt === 'string', 'addedAt is a string');
      // ISO-8601 audit trail — matches the OC.js:694-698 has_insight payload convention.
      assert.match(edge.metadata.addedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2 — D-02.2 skip-and-log: unresolved observation_ids are non-fatal.
// ---------------------------------------------------------------------------

describe('ObservationConsolidator.consolidateDay — D-02.2 unresolved-obs skip (Test 2)', () => {
  it('skips the edge with a stderr "not yet persisted" log when findByLegacyId returns null', async () => {
    // D-02.2 contract: if an Observation is not yet persisted at
    // consolidation time, that single edge is skipped (logged), but the
    // Digest still lands with its remaining edges. The next repair-script
    // run (Plan 59-04) catches the missed edge. No data loss.
    const kmStore = createMockKmStore({ unresolvedLegacyIds: new Set(['obs-2']) });
    const consolidator = createConsolidator(kmStore);

    // Capture stderr to verify the non-fatal log.
    const stderrChunks = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    };
    try {
      await consolidator.consolidateDay('2026-06-15');
    } finally {
      process.stderr.write = originalWrite;
    }

    // Only TWO edges land — obs-2 is skipped.
    const derivedFromEdges = kmStore._relations.filter((r) => r.type === 'derivedFrom');
    assert.equal(derivedFromEdges.length, 2, '2 edges land (obs-1 + obs-3); obs-2 skipped');
    const toIds = derivedFromEdges.map((r) => r.to).sort();
    assert.deepEqual(
      toIds,
      ['mock-obs-mint-1', 'mock-obs-mint-3'],
      'obs-2 minted-id NEVER appears as an edge target',
    );

    // The Digest still landed (putEntity called once).
    const putEntityCalls = kmStore.callLog.filter((c) => c.op === 'putEntity' && c.entityType === 'Digest');
    assert.equal(putEntityCalls.length, 1, 'the Digest still lands despite a skipped edge');

    // stderr captures the locked phrase from the must_haves.
    const stderrAll = stderrChunks.join('');
    assert.match(
      stderrAll,
      /derivedFrom: observation .* not yet persisted, skipping edge/,
      'stderr carries the D-02.2 skip log',
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3 — D-02 atomicity ordering (callLog indices).
// ---------------------------------------------------------------------------

describe('ObservationConsolidator.consolidateDay — D-02 atomicity ordering (Test 3)', () => {
  it('orders putEntity (Digest) before every derivedFrom addRelation within the same iteration', async () => {
    // Atomicity narrative: Phase 58 D-04 envelope (km-core JSON exporter's
    // 5s debounce) applied verbatim to Digests per D-02. This test asserts
    // the in-loop ordering that feeds that envelope — putEntity FIRST, then
    // findByLegacyId (D-02.2 resolution), then addRelation (the edge write).
    const kmStore = createMockKmStore();
    const consolidator = createConsolidator(kmStore);

    await consolidator.consolidateDay('2026-06-15');

    // Find the Digest putEntity in the callLog.
    const digestPutIdx = kmStore.callLog.findIndex(
      (c) => c.op === 'putEntity' && c.entityType === 'Digest',
    );
    assert.notEqual(digestPutIdx, -1, 'Digest putEntity is in the callLog');

    // Find every derivedFrom addRelation in the callLog.
    const derivedFromAddIndices = kmStore.callLog
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.op === 'addRelation' && c.type === 'derivedFrom')
      .map((c) => c.i);
    assert.equal(derivedFromAddIndices.length, 3, '3 derivedFrom addRelation entries');

    // Each derivedFrom edge MUST appear AFTER the Digest putEntity (same try-block).
    for (const edgeIdx of derivedFromAddIndices) {
      assert.ok(
        digestPutIdx < edgeIdx,
        `Digest putEntity (${digestPutIdx}) must precede derivedFrom edge (${edgeIdx})`,
      );
    }

    // findByLegacyId for the obs ids must ALSO appear after the Digest
    // putEntity but before the corresponding addRelation (same iteration).
    const obsFindIndices = kmStore.callLog
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.op === 'findByLegacyId' && c.legacyId && c.legacyId.system === 'A' && /^obs-/.test(c.legacyId.id))
      .map((c) => c.i);
    assert.ok(obsFindIndices.length >= 3, 'at least 3 obs findByLegacyId resolutions after putEntity');
    for (const findIdx of obsFindIndices) {
      assert.ok(
        digestPutIdx < findIdx,
        `Digest putEntity (${digestPutIdx}) must precede obs findByLegacyId (${findIdx})`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4 — D-02 per-edge addRelation failure is non-fatal.
// ---------------------------------------------------------------------------

describe('ObservationConsolidator.consolidateDay — D-02 non-fatal addRelation failure (Test 4)', () => {
  it('continues the loop when one derivedFrom addRelation throws', async () => {
    // Per-edge try/catch (mirrors the _emitMentionsEdges precedent at
    // OW.js:478-522). A single edge throwing does NOT corrupt createdCount,
    // does NOT halt subsequent iterations, and surfaces only as a stderr
    // non-fatal log. The Digest itself still lands.
    const kmStore = createMockKmStore({ failingDerivedFromTarget: 'mock-obs-mint-2' });
    const consolidator = createConsolidator(kmStore);

    // Capture stderr to verify the non-fatal log.
    const stderrChunks = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    };
    try {
      await consolidator.consolidateDay('2026-06-15');
    } finally {
      process.stderr.write = originalWrite;
    }

    // Two SUCCESSFUL edges land (obs-1 + obs-3); the second throws.
    const successfulEdges = kmStore._relations.filter((r) => r.type === 'derivedFrom');
    assert.equal(successfulEdges.length, 2, '2 edges land successfully; obs-2 throws');
    const goodTargets = successfulEdges.map((r) => r.to).sort();
    assert.deepEqual(
      goodTargets,
      ['mock-obs-mint-1', 'mock-obs-mint-3'],
      'obs-1 + obs-3 land; obs-2 threw',
    );

    // The Digest itself still landed.
    const digestPuts = kmStore.callLog.filter(
      (c) => c.op === 'putEntity' && c.entityType === 'Digest',
    );
    assert.equal(digestPuts.length, 1, 'Digest putEntity still fires despite the edge failure');

    // stderr captures the locked phrase from the must_haves.
    const stderrAll = stderrChunks.join('');
    assert.match(
      stderrAll,
      /derivedFrom edge .* failed \(non-fatal\)/,
      'stderr carries the D-02 non-fatal log',
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 59 Plan 03 — _pushInsightToKG consumes writeInsight {legacyId, mintedId} (D-03)
// ---------------------------------------------------------------------------
//
// D-03 contract: _pushInsightToKG reads mintedId from writer.writeInsight()'s
// {legacyId, mintedId} return directly — the post-write findByLegacyId race
// lookup at OC.js:660-661 is REMOVED. The has_insight follower block at
// OC.js:679-705 stays as-is (D-03.2 — role shifts from race-safe lookup to
// idempotent re-write protection).
//
// The three tests below mirror Plan 59-01's writer-side tests on the consumer
// side: Test 5 locks the direct-read happy path, Test 6 locks the null-mintedId
// short-circuit, Test 7 locks the writer-throws catch path.

/**
 * Build a mock ObservationWriter whose writeInsight is configurable per test.
 * - `writeInsightReturn` overrides the return value (default: `{legacyId: row.id, mintedId: 'auto-mock-' + row.id}`)
 * - `writeInsightThrows` makes writeInsight throw the supplied Error
 */
function createMockWriter({ writeInsightReturn, writeInsightThrows } = {}) {
  return {
    async writeInsight(row, _options) {
      if (writeInsightThrows) throw writeInsightThrows;
      return writeInsightReturn || { legacyId: row.id, mintedId: 'auto-mock-' + row.id };
    },
  };
}

/**
 * Test-only helper: install a `globalThis.fetch` stub that satisfies:
 *   (a) `_ensureProjectAnchor`'s PUT to `${vkbUrl}/api/entities/<name>` + POST to /api/relations.
 *   (b) `classifyMentions`'s POST to the LLM proxy `/api/complete`.
 * Returns the original fetch so tests can restore it in finally{}.
 */
function installFetchStub({ mentionsResponse = '[]' } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, _init) => {
    const u = String(url);
    if (u.includes('/api/complete')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ content: mentionsResponse, provider: 'mock', model: 'mock-haiku' }),
        text: async () => '',
      };
    }
    // _ensureProjectAnchor PUT / POST path — return 200 OK.
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
      text: async () => '',
    };
  };
  return originalFetch;
}

/**
 * Pre-seed a project anchor entity in the mock kmStore so the has_insight
 * follower (OC.js:680-682) can resolve `projectId` via
 * `findByOntologyClass('Project') → find by name`.
 */
function seedProjectAnchor(kmStore, projectId = 'project-coding-1', name = 'Coding') {
  kmStore._entities.set(projectId, {
    id: projectId,
    name,
    ontologyClass: 'Project',
    entityType: 'Project',
  });
  return { projectId, name };
}

// ---------------------------------------------------------------------------
// Test 5 — D-03 happy path: mintedId from writer return drives has_insight emission.
// ---------------------------------------------------------------------------

describe('ObservationConsolidator._pushInsightToKG — D-03 direct mintedId read (Test 5)', () => {
  it('reads mintedId from writeInsight return and emits has_insight with it (NOT via findByLegacyId)', async () => {
    // D-03 contract: the consolidator's _pushInsightToKG no longer calls
    // findByLegacyId({system:'A', id: entry.topic}) after writeInsight to
    // re-derive the mintedId. Instead, it reads result.mintedId from the
    // writer's return shape ({legacyId, mintedId}) — closing the 1-in-100
    // race window observed 2026-06-15. The has_insight edge then targets
    // exactly that mintedId.
    const kmStore = createMockKmStore();
    seedProjectAnchor(kmStore);
    const mockWriter = createMockWriter({
      writeInsightReturn: { legacyId: 'insight-topic-1', mintedId: 'mock-km-id-42' },
    });
    const originalFetch = installFetchStub();

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: mockWriter,
      runId: 'test-run-59-03-t5',
    });

    // Clear the callLog right before the unit under test so the assertion
    // below scopes narrowly to this _pushInsightToKG invocation.
    kmStore.callLog.length = 0;

    try {
      await consolidator._pushInsightToKG({
        topic: 'insight-topic-1',
        summary: 'A test insight that should land with mintedId from writer return',
        project: 'coding',
        confidence: 0.9,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    // D-03 core invariant: no findByLegacyId({system:'A', id:'insight-topic-1'})
    // call during _pushInsightToKG. The race lookup is REMOVED.
    const raceLookupCalls = kmStore.callLog.filter(
      (c) =>
        c.op === 'findByLegacyId' &&
        c.legacyId &&
        c.legacyId.system === 'A' &&
        c.legacyId.id === 'insight-topic-1',
    );
    assert.equal(raceLookupCalls.length, 0, 'no findByLegacyId race lookup during _pushInsightToKG');

    // mintedId from the writer return flows into the has_insight emission.
    const hasInsightEdges = kmStore._relations.filter((r) => r.type === 'has_insight');
    assert.equal(hasInsightEdges.length, 1, 'one has_insight edge emitted');
    assert.equal(hasInsightEdges[0].from, 'project-coding-1', 'from = project id');
    assert.equal(hasInsightEdges[0].to, 'mock-km-id-42', 'to = mintedId from writer return');
    assert.equal(hasInsightEdges[0].metadata.source, 'observation-consolidator');
  });
});

// ---------------------------------------------------------------------------
// Test 6 — D-03 null mintedId short-circuits has_insight cleanly.
// ---------------------------------------------------------------------------

describe('ObservationConsolidator._pushInsightToKG — D-03 null mintedId short-circuit (Test 6)', () => {
  it('skips has_insight emission cleanly when writer returns {legacyId, mintedId: null}', async () => {
    // D-03.2: if the writer returns a null mintedId (e.g., putEntity inside
    // the writer never reached the return statement for whatever reason),
    // the existing `if (projectName && mintedId)` guard at OC.js:679 must
    // still short-circuit cleanly — no exception, no half-Insight has_insight
    // edge. The kgPushDebug log at :667-671 still fires but is non-fatal.
    const kmStore = createMockKmStore();
    seedProjectAnchor(kmStore);
    const mockWriter = createMockWriter({
      writeInsightReturn: { legacyId: 'insight-topic-2', mintedId: null },
    });
    const originalFetch = installFetchStub();

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: mockWriter,
      runId: 'test-run-59-03-t6',
    });

    kmStore.callLog.length = 0;

    let threwError = null;
    try {
      try {
        await consolidator._pushInsightToKG({
          topic: 'insight-topic-2',
          summary: 'A test insight whose writer returns null mintedId',
          project: 'coding',
          confidence: 0.9,
        });
      } catch (err) {
        threwError = err;
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    // No exception leaks out — the guard is robust.
    assert.equal(threwError, null, '_pushInsightToKG does not throw on null mintedId');

    // has_insight addRelation was never called — the guard short-circuits.
    const hasInsightEdges = kmStore._relations.filter((r) => r.type === 'has_insight');
    assert.equal(hasInsightEdges.length, 0, 'no has_insight edge when mintedId is null');

    // Confirm via callLog: no addRelation with type='has_insight' was attempted.
    const hasInsightAddCalls = kmStore.callLog.filter(
      (c) => c.op === 'addRelation' && c.type === 'has_insight',
    );
    assert.equal(hasInsightAddCalls.length, 0, 'addRelation never called with type=has_insight');
  });
});

// ---------------------------------------------------------------------------
// Test 7 — D-03 writer-throws path: catch block fires, no has_insight attempt.
// ---------------------------------------------------------------------------

describe('ObservationConsolidator._pushInsightToKG — D-03 writer-throws catch (Test 7)', () => {
  it('catches writer.writeInsight throw, logs to stderr, returns without attempting has_insight', async () => {
    // D-03 catch-block contract: the catch at OC.js:662-664 is byte-identical
    // post-edit. When the writer throws (km-core down, fail-fast on classifier,
    // etc.), the stderr log fires verbatim and the method returns early — the
    // has_insight follower at OC.js:679-705 is NEVER reached.
    const kmStore = createMockKmStore();
    seedProjectAnchor(kmStore);
    const mockWriter = createMockWriter({
      writeInsightThrows: new Error('km-core down'),
    });
    const originalFetch = installFetchStub();

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: mockWriter,
      runId: 'test-run-59-03-t7',
    });

    // Capture stderr to verify the locked log line.
    const stderrChunks = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    let threwError = null;
    try {
      try {
        await consolidator._pushInsightToKG({
          topic: 'insight-topic-3',
          summary: 'A test insight whose writer call throws',
          project: 'coding',
          confidence: 0.9,
        });
      } catch (err) {
        threwError = err;
      }
    } finally {
      process.stderr.write = originalWrite;
      globalThis.fetch = originalFetch;
    }

    // The catch block swallows the throw and returns — caller sees no error.
    assert.equal(threwError, null, '_pushInsightToKG catches writer throw and returns');

    // stderr carries the locked phrase from the catch block at OC.js:663.
    const stderrAll = stderrChunks.join('');
    assert.match(
      stderrAll,
      /\[Consolidator→KG\] writeInsight failed for insight-topic-3: km-core down/,
      'stderr captures the writer-throws log line',
    );

    // has_insight emission must NOT have been attempted (early-return).
    const hasInsightEdges = kmStore._relations.filter((r) => r.type === 'has_insight');
    assert.equal(hasInsightEdges.length, 0, 'no has_insight edge when writer throws');
    const hasInsightAddCalls = kmStore.callLog.filter(
      (c) => c.op === 'addRelation' && c.type === 'has_insight',
    );
    assert.equal(hasInsightAddCalls.length, 0, 'addRelation never called with type=has_insight after throw');
  });
});
