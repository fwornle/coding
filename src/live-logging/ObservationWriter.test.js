/**
 * Phase 58 Plan 02 — ObservationWriter.writeInsight + consolidator route-through tests.
 *
 * Locks the EDGE-01 / EDGE-02 / D-04 / D-04.1 / D-06 contracts at the unit level:
 *
 *   Test 1 (EDGE-02 atomicity)   — putEntity → N mentions edges → capturedBy
 *                                  ordering within the same try-block. The
 *                                  km-core JSON exporter's 5s debounce is the
 *                                  atomicity envelope; callLog index assertion
 *                                  proves the in-loop ordering.
 *   Test 2 (EDGE-01 emission)    — 3 mentions edges land on the kmStore with
 *                                  metadata.source='observation-writer' and a
 *                                  parseable ISO classifiedAt timestamp.
 *   Test 3 (idempotency)         — re-running writeInsight with the same
 *                                  mentionsTargetIds does NOT duplicate edges
 *                                  (findRelations dedup probe).
 *   Test 4 (empty mentions)      — writeInsight(row, {mentionsTargetIds: []})
 *                                  and writeInsight(row) both succeed without
 *                                  any mentions addRelation calls; only
 *                                  capturedBy fires.
 *   Test 5 (self-loop guard)     — writeInsight(row, {mentionsTargetIds:
 *                                  [mintedId]}) emits 0 mentions edges.
 *   Test 6 (non-fatal addRelation
 *           failure)             — one target throws Target-not-found mid-loop;
 *                                  other targets still write; writer doesn't
 *                                  rethrow; stderr captures the non-fatal log.
 *   Test 7 (consolidator route-
 *           through path)        — _pushInsightToKG calls
 *                                  this._observationWriter.writeInsight (D-06)
 *                                  with the classifier's targets AND emits the
 *                                  post-writeInsight has_insight addRelation.
 *   Test 8 (consolidator fail-
 *           fast on classifier
 *           error per D-04.1)    — classifier throws → ObservationWriter
 *                                  .writeInsight NEVER called (Insight not
 *                                  written).
 *
 * Framework: node:test + node:assert/strict (matches MentionsClassifier.test.js
 * + scripts/backfill-project-tag.test.mjs). Zero new deps.
 *
 * Run via: node --test src/live-logging/ObservationWriter.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ObservationWriter } from './ObservationWriter.js';
import { ObservationConsolidator } from './ObservationConsolidator.js';
import { __resetCacheForTests } from './MentionsClassifier.js';

// ---------------------------------------------------------------------------
// Mock kmStore — records every op into callLog so tests can assert ordering.
// ---------------------------------------------------------------------------

/**
 * Build an in-memory mock km-core store. The callLog captures every
 * putEntity / addRelation / findRelations / findByOntologyClass /
 * findByLegacyId / mergeAttributes call in order so ordering tests
 * (Test 1 atomicity) can assert positional invariants.
 *
 * Optional `overrides` lets a test inject failing behaviour (Test 6
 * passes an addRelationFn that throws for a specific target).
 */
function createMockKmStore(overrides = {}) {
  const callLog = [];
  const entities = new Map();
  const relations = [];
  // Anchor entity — pre-seeded so _resolveAnchorId resolves on first call.
  // The writer's _resolveAnchorId does findByOntologyClass('Component')
  // and looks for name='LiveLoggingSystem'.
  const anchorId = 'anchor-lsl-1';
  entities.set(anchorId, {
    id: anchorId,
    name: 'LiveLoggingSystem',
    ontologyClass: 'Component',
  });

  const store = {
    callLog,
    _entities: entities,
    _relations: relations,
    async putEntity(entity, opts) {
      // Mirror km-core's legacyId-merge semantics — an entity with the same
      // legacyId.{system,id} as a prior entity returns the SAME id (the
      // merge case). This is what enables the writer's repeat-write
      // idempotency contract: putEntity is identity-stable across calls.
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
      if (!id) id = `mock-ent-${entities.size + 1}`;
      callLog.push({ op: 'putEntity', id, entity, opts });
      entities.set(id, { ...entity, id });
      return id;
    },
    async addRelation(rel) {
      // Allow per-target failure injection (Test 6).
      if (overrides.addRelationFn) {
        const result = await overrides.addRelationFn(rel);
        callLog.push({ op: 'addRelation', from: rel.from, to: rel.to, type: rel.type, metadata: rel.metadata, failed: result === 'fail' });
        if (result === 'fail') {
          throw new Error(`Target node not found: ${rel.to}`);
        }
        relations.push(rel);
        return;
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
      return Array.from(entities.values()).filter((e) => e.ontologyClass === klass);
    },
    async findByLegacyId(legacyId) {
      callLog.push({ op: 'findByLegacyId', legacyId });
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
 * Build a writer wired to a mock kmStore. We skip the writer's init()
 * (which initializes a redactor we don't need) by passing kmStore directly
 * — _ensureKmStore short-circuits to the supplied store on first call.
 */
function createWriter(kmStore) {
  return new ObservationWriter({ kmStore });
}

/**
 * Canonical row fixture. The mapper reads row.id + row.topic + row.summary
 * + row.created_at + row.metadata + row.confidence; it sets legacyId from
 * row.id.
 */
function buildRow() {
  return {
    id: 'insight-fixture-1',
    topic: 'Test Insight Topic',
    summary: 'A summary describing the test insight.',
    confidence: 0.85,
    created_at: '2026-06-15T20:00:00.000Z',
    metadata: { source: 'online', project: 'coding' },
  };
}

// ---------------------------------------------------------------------------
// Test 1 — EDGE-02 atomicity ordering (callLog indices)
// ---------------------------------------------------------------------------

describe('ObservationWriter.writeInsight — EDGE-02 atomicity (Test 1)', () => {
  it('orders putEntity → N mentions edges → capturedBy inside the same try-block', async () => {
    // Atomicity narrative: the km-core JSON exporter's 5s debounce envelope
    // is the EDGE-02 contract; this test asserts the in-loop ordering that
    // feeds that envelope. Same-tick / same-try-block ordering ensures every
    // edge lands in the export-debounce window opened by putEntity.
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);

    await writer.writeInsight(buildRow(), { mentionsTargetIds: ['e1', 'e2', 'e3'] });

    // Extract operation indices.
    const opIndices = (op, predicate = () => true) =>
      kmStore.callLog
        .map((c, i) => ({ ...c, i }))
        .filter((c) => c.op === op && predicate(c))
        .map((c) => c.i);

    const putIdx = opIndices('putEntity');
    const mentionsAddIdx = opIndices('addRelation', (c) => c.type === 'mentions');
    const capturedByAddIdx = opIndices('addRelation', (c) => c.type === 'capturedBy');

    assert.equal(putIdx.length, 1, 'exactly one putEntity');
    assert.equal(mentionsAddIdx.length, 3, 'exactly three mentions edges');
    assert.equal(capturedByAddIdx.length, 1, 'exactly one capturedBy edge');

    // putEntity FIRST, then mentions edges, then capturedBy LAST.
    const putAt = putIdx[0];
    const capturedAt = capturedByAddIdx[0];
    for (const mIdx of mentionsAddIdx) {
      assert.ok(putAt < mIdx, `putEntity (${putAt}) must precede mentions edge (${mIdx})`);
      assert.ok(mIdx < capturedAt, `mentions edge (${mIdx}) must precede capturedBy (${capturedAt})`);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2 — EDGE-01 mentions edges land with the writer-path metadata
// ---------------------------------------------------------------------------

describe('ObservationWriter.writeInsight — EDGE-01 emission (Test 2)', () => {
  it('emits 3 mentions edges with metadata.source=observation-writer + ISO classifiedAt', async () => {
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);

    await writer.writeInsight(buildRow(), { mentionsTargetIds: ['e1', 'e2', 'e3'] });

    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges.length, 3, '3 mentions edges land on the store');
    const targets = mentionsEdges.map((r) => r.to).sort();
    assert.deepEqual(targets, ['e1', 'e2', 'e3'], 'all targets land');

    for (const edge of mentionsEdges) {
      assert.equal(edge.metadata.source, 'observation-writer', 'writer-path stamp');
      assert.equal(edge.metadata.classifier, 'llm-haiku', 'classifier stamp');
      assert.ok(typeof edge.metadata.classifiedAt === 'string', 'classifiedAt present');
      // ISO-8601: 2026-06-15T20:00:00.000Z shape.
      assert.match(edge.metadata.classifiedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Idempotency: re-running does NOT duplicate edges
// ---------------------------------------------------------------------------

describe('ObservationWriter.writeInsight — idempotency (Test 3)', () => {
  it('does not multiply mentions edges on repeat writes (findRelations dedup)', async () => {
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);
    const row = buildRow();

    await writer.writeInsight(row, { mentionsTargetIds: ['e1'] });
    const firstCallAddCount = kmStore.callLog.filter(
      (c) => c.op === 'addRelation' && c.type === 'mentions',
    ).length;
    assert.equal(firstCallAddCount, 1, 'first run writes 1 mentions edge');

    // Second run — dedup probe finds the existing edge; no new addRelation.
    await writer.writeInsight(row, { mentionsTargetIds: ['e1'] });
    const secondCallAddCount = kmStore.callLog.filter(
      (c) => c.op === 'addRelation' && c.type === 'mentions',
    ).length;
    assert.equal(secondCallAddCount, 1, 'second run does NOT add another mentions edge');

    // Final state: exactly ONE mentions edge.
    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges.length, 1, 'kmStore holds exactly one mentions edge');
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Empty / missing mentionsTargetIds: no mentions addRelation
// ---------------------------------------------------------------------------

describe('ObservationWriter.writeInsight — empty mentions (Test 4)', () => {
  it('writeInsight(row, {mentionsTargetIds: []}) emits 0 mentions edges', async () => {
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);
    await writer.writeInsight(buildRow(), { mentionsTargetIds: [] });
    const mentionsAdds = kmStore.callLog.filter(
      (c) => c.op === 'addRelation' && c.type === 'mentions',
    );
    assert.equal(mentionsAdds.length, 0, 'no mentions edges');
    // capturedBy still fires.
    const capturedAdds = kmStore.callLog.filter(
      (c) => c.op === 'addRelation' && c.type === 'capturedBy',
    );
    assert.equal(capturedAdds.length, 1, 'capturedBy still emitted');
  });

  it('writeInsight(row) with no options also emits 0 mentions edges', async () => {
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);
    await writer.writeInsight(buildRow());
    const mentionsAdds = kmStore.callLog.filter(
      (c) => c.op === 'addRelation' && c.type === 'mentions',
    );
    assert.equal(mentionsAdds.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Self-loop guard
// ---------------------------------------------------------------------------

describe('ObservationWriter.writeInsight — self-loop guard (Test 5)', () => {
  it('skips mentions edges whose target equals the minted id', async () => {
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);

    // Drive a write so we know the minted id (the mock derives it
    // from `mock-ent-${size+1}`); preseed an entity to make the math
    // predictable: anchor is 1, so the next minted id is mock-ent-2.
    // We pass it as a mentionsTargetId — it should be skipped.
    await writer.writeInsight(buildRow(), { mentionsTargetIds: ['mock-ent-2', 'e1'] });

    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges.length, 1, 'only the non-self edge survives');
    assert.equal(mentionsEdges[0].to, 'e1', 'the non-self target landed');
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Non-fatal addRelation failure mid-loop
// ---------------------------------------------------------------------------

describe('ObservationWriter.writeInsight — non-fatal addRelation failure (Test 6)', () => {
  it('continues the mentions loop when one target throws Target-not-found', async () => {
    // Override addRelation to fail for type==='mentions' && to==='e2'.
    const kmStore = createMockKmStore({
      addRelationFn: (rel) => (rel.type === 'mentions' && rel.to === 'e2' ? 'fail' : 'ok'),
    });
    const writer = createWriter(kmStore);

    // Capture stderr to verify the non-fatal log line.
    const stderrChunks = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    };
    try {
      await writer.writeInsight(buildRow(), { mentionsTargetIds: ['e1', 'e2', 'e3'] });
    } finally {
      process.stderr.write = originalWrite;
    }

    // The successful targets landed; the failing one did not.
    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    const goodTargets = mentionsEdges.map((r) => r.to).sort();
    assert.deepEqual(goodTargets, ['e1', 'e3'], 'e1 + e3 land; e2 throws');

    // The non-fatal stderr log line was emitted.
    const joined = stderrChunks.join('');
    assert.match(
      joined,
      /\[ObservationWriter\] mentions edge .*->e2 failed \(non-fatal\)/,
      'non-fatal stderr line captured',
    );

    // capturedBy still fired AFTER the partial mentions loop.
    const capturedAdds = kmStore._relations.filter((r) => r.type === 'capturedBy');
    assert.equal(capturedAdds.length, 1, 'capturedBy still emitted post-partial-failure');
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Consolidator route-through (D-06)
// ---------------------------------------------------------------------------

describe('ObservationConsolidator._pushInsightToKG — route-through (Test 7)', () => {
  let originalFetch;

  beforeEach(() => {
    __resetCacheForTests();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
  });

  it('calls this._observationWriter.writeInsight with classifier-supplied mentionsTargetIds + emits has_insight', async () => {
    // EDGE-02 narrative: this is the D-06 atomicity contract realized end-
    // to-end. The consolidator runs classifyMentions BEFORE writeInsight
    // (per D-04 step 2), routes the write through ObservationWriter
    // (per D-06), then emits the has_insight project-anchor edge via
    // kmStore.addRelation — every edge lands inside the same exporter
    // debounce window as the putEntity inside writeInsight.

    // Build a kmStore with a pre-seeded Project entity so the post-
    // writeInsight has_insight resolution works.
    const kmStore = createMockKmStore();
    kmStore._entities.set('project-coding-1', {
      id: 'project-coding-1',
      name: 'Coding',
      ontologyClass: 'Project',
    });

    // Pre-seed two candidate entities so loadMentionCandidates' Promise.all
    // returns a sensible catalog; also stub fetch so classifyMentions'
    // proxy call gets a deterministic ['e1','e2'] payload.
    // entityType set explicitly — Phase 58 entityType-drift fix requires
    // strict {Component, SubComponent, Detail} entityType on candidates.
    kmStore._entities.set('e1', { id: 'e1', name: 'EtmDaemon',        entityType: 'Component', ontologyClass: 'Component' });
    kmStore._entities.set('e2', { id: 'e2', name: 'LiveLoggingSystem', entityType: 'Component', ontologyClass: 'Component' });

    // Mock writer — record every writeInsight call so we can assert the
    // options.mentionsTargetIds plumbing.
    const writeInsightCalls = [];
    const mockWriter = {
      writeInsight: async (row, options) => {
        writeInsightCalls.push({ row, options });
        // Mock writer must populate kmStore so findByLegacyId resolves the
        // minted id for the has_insight follow-up.
        const mintedId = 'minted-insight-1';
        kmStore._entities.set(mintedId, {
          id: mintedId,
          name: row.topic,
          ontologyClass: 'Insight',
          legacyId: { system: 'A', id: row.id },
        });
        return row.id;
      },
    };

    // Stub fetch — both consolidator's _ensureProjectAnchor (HTTP path
    // we are NOT refactoring, per D-06.1) AND classifyMentions (the
    // host-side proxy call).
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/api/complete')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            content: '["EtmDaemon","LiveLoggingSystem"]',
            provider: 'copilot',
            model: 'claude-haiku',
          }),
          text: async () => '',
        };
      }
      // _ensureProjectAnchor path — return 200 OK for the PUT and POST.
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
        text: async () => '',
      };
    };

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: mockWriter,
      runId: 'test-run-1',
    });

    await consolidator._pushInsightToKG({
      topic: 'TestInsightTopic',
      summary: 'A test insight about EtmDaemon and LiveLoggingSystem',
      project: 'coding',
      confidence: 0.9,
      _digestIds: ['d1'],
    });

    // The route-through happened.
    assert.equal(writeInsightCalls.length, 1, 'writeInsight called exactly once');
    const call = writeInsightCalls[0];
    assert.ok(call.options, 'options passed');
    assert.ok(Array.isArray(call.options.mentionsTargetIds), 'mentionsTargetIds is an array');
    assert.deepEqual(
      call.options.mentionsTargetIds.sort(),
      ['e1', 'e2'],
      'mentionsTargetIds matches classifier output',
    );

    // The has_insight addRelation landed.
    const hasInsightEdges = kmStore._relations.filter((r) => r.type === 'has_insight');
    assert.equal(hasInsightEdges.length, 1, 'has_insight edge emitted');
    assert.equal(hasInsightEdges[0].from, 'project-coding-1', 'from = project id');
    assert.equal(hasInsightEdges[0].to, 'minted-insight-1', 'to = minted insight id');
    assert.equal(hasInsightEdges[0].metadata.source, 'observation-consolidator');
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Consolidator fail-fast on classifier error (D-04.1)
// ---------------------------------------------------------------------------

describe('ObservationConsolidator._pushInsightToKG — fail-fast on classifier error (Test 8)', () => {
  let originalFetch;

  beforeEach(() => {
    __resetCacheForTests();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
  });

  it('does NOT call writeInsight when the classifier throws (D-04.1 — half-Insight prevention)', async () => {
    // D-04.1 narrative: when the LLM proxy is down, the Insight is NOT
    // written until the proxy recovers. Acceptable because Insights are
    // derived state — the underlying digests + observations remain. The
    // alternative (write-then-edge-then-flip-pending) re-introduces the
    // orphan-bleed window Phase 58 is closing.

    const kmStore = createMockKmStore();
    // Pre-seed candidates so loadMentionCandidates succeeds (the failure
    // we want to test is classifyMentions, not load).
    kmStore._entities.set('e1', { id: 'e1', name: 'EtmDaemon', entityType: 'Component', ontologyClass: 'Component' });

    const writeInsightCalls = [];
    const mockWriter = {
      writeInsight: async (row, options) => {
        writeInsightCalls.push({ row, options });
        return row.id;
      },
    };

    // Stub fetch — the /api/complete call returns a 500 so classifyMentions
    // throws (D-04.1 fail-fast); the consolidator must short-circuit.
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/complete')) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({}),
          text: async () => 'upstream LLM unavailable',
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
        text: async () => '',
      };
    };

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: mockWriter,
      runId: 'test-run-2',
    });

    // The call-site swallow at line ~1745 swallows; here we call
    // _pushInsightToKG directly, which returns (does NOT throw) per the
    // D-04.1 early-return.
    await consolidator._pushInsightToKG({
      topic: 'AnotherTopic',
      summary: 'Another insight',
      project: 'coding',
      confidence: 0.8,
    });

    assert.equal(writeInsightCalls.length, 0, 'writeInsight NEVER called when classifier throws');

    // No mentions edges, no Insight node.
    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges.length, 0, 'no mentions edges land');
    const insightPuts = kmStore.callLog.filter(
      (c) => c.op === 'putEntity' && c.entity?.entityType === 'Insight',
    );
    assert.equal(insightPuts.length, 0, 'no Insight putEntity calls');
  });
});
