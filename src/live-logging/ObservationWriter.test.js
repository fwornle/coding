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
import { readFileSync } from 'node:fs';

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
// Test 3b — capturedBy anchor idempotency. The sibling of Test 3, and the one
// that was missing: _emitMentionsEdges probed before writing, _anchorEntity
// did not. Measured on the live store before the fix: 13,675 capturedBy edges
// over 1,219 distinct sources (91% duplicates), worst single Insight 194.
// ---------------------------------------------------------------------------

describe('ObservationWriter.writeInsight — anchor idempotency (Test 3b)', () => {
  it('does not multiply capturedBy edges on repeat writes', async () => {
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);
    const row = buildRow();

    await writer.writeInsight(row, { mentionsTargetIds: [] });
    assert.equal(
      kmStore._relations.filter((r) => r.type === 'capturedBy').length,
      1,
      'first run anchors once',
    );

    await writer.writeInsight(row, { mentionsTargetIds: [] });
    await writer.writeInsight(row, { mentionsTargetIds: [] });

    const anchors = kmStore._relations.filter((r) => r.type === 'capturedBy');
    assert.equal(anchors.length, 1, 'three writes still leave exactly one capturedBy edge');
  });

  it('still anchors an entity that has no capturedBy edge yet', async () => {
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);

    await writer.writeInsight(buildRow(), { mentionsTargetIds: [] });
    const anchors = kmStore._relations.filter((r) => r.type === 'capturedBy');
    assert.equal(anchors.length, 1, 'dedup must not suppress the FIRST anchor');
    assert.equal(anchors[0].metadata.source, 'observation-writer');
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
    // options.mentionsTargetIds plumbing. Updated post Phase 59 Plan 03 (D-03)
    // — the writer now returns {legacyId, mintedId} directly (per Plan 59-01),
    // and the consumer (_pushInsightToKG) reads result.mintedId straight from
    // the return instead of paying the findByLegacyId race lookup.
    const writeInsightCalls = [];
    const mockWriter = {
      writeInsight: async (row, options) => {
        writeInsightCalls.push({ row, options });
        // Populate kmStore for any downstream lookups (back-compat — the
        // has_insight follower at OC.js:679-705 no longer needs the legacyId
        // round-trip, but pre-existing tests in this file may rely on the
        // store-state side effect).
        const mintedId = 'minted-insight-1';
        kmStore._entities.set(mintedId, {
          id: mintedId,
          name: row.topic,
          ontologyClass: 'Insight',
          legacyId: { system: 'A', id: row.id },
        });
        return { legacyId: row.id, mintedId };
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
// Phase 59 Plan 01 — writeInsight returns {legacyId, mintedId} (D-03)
// ---------------------------------------------------------------------------
//
// D-03 contract: writeInsight returns {legacyId, mintedId}; mintedId closes
// the OC.js:660-661 findByLegacyId race observed 2026-06-15. legacyId is the
// stable system='A' surrogate (= row.id); mintedId is the freshly-minted
// km-core entity id (= return of internal kmStore.putEntity).

describe('ObservationWriter.writeInsight — D-03 return shape (Test 9)', () => {
  it('resolves to {legacyId, mintedId} with both fields as non-empty strings', async () => {
    // D-03 contract: writeInsight returns {legacyId, mintedId}; mintedId
    // closes the OC.js:660-661 findByLegacyId race observed 2026-06-15.
    const kmStore = createMockKmStore();
    // Override putEntity to return a deterministic minted id so the
    // assertion can compare against a known value.
    kmStore.putEntity = async (entity, opts) => {
      const id = 'minted-km-001';
      kmStore.callLog.push({ op: 'putEntity', id, entity, opts });
      kmStore._entities.set(id, { ...entity, id });
      return id;
    };
    const writer = createWriter(kmStore);

    const result = await writer.writeInsight({
      id: 'insight-1',
      topic: 'Topic',
      summary: 'A summary describing the test insight.',
      confidence: 0.85,
      created_at: '2026-06-16T00:00:00.000Z',
    });

    // Exact two own string-typed properties: legacyId, mintedId.
    assert.equal(typeof result, 'object', 'result is an object');
    assert.notEqual(result, null, 'result is non-null');
    const ownKeys = Object.keys(result).sort();
    assert.deepEqual(ownKeys, ['legacyId', 'mintedId'], 'exactly two own keys: legacyId, mintedId');
    assert.equal(typeof result.legacyId, 'string', 'legacyId is a string');
    assert.equal(typeof result.mintedId, 'string', 'mintedId is a string');
    assert.ok(result.legacyId.length > 0, 'legacyId is non-empty');
    assert.ok(result.mintedId.length > 0, 'mintedId is non-empty');

    // Field-level equality.
    assert.equal(result.legacyId, 'insight-1', 'legacyId === row.id');
    assert.equal(result.mintedId, 'minted-km-001', 'mintedId === mock putEntity return');
  });
});

describe('ObservationWriter.writeInsight — D-03 mintedId propagation (Test 10)', () => {
  it('propagates putEntity return verbatim across multiple calls (no re-derive)', async () => {
    // D-03 contract: writeInsight returns {legacyId, mintedId}; mintedId
    // closes the OC.js:660-661 findByLegacyId race observed 2026-06-15.
    // This test proves the writer propagates putEntity's return verbatim
    // rather than re-deriving the mintedId via a downstream lookup.
    const kmStore = createMockKmStore();
    let nextSeq = 0;
    const returnedIds = [];
    // Override putEntity to return a computed-at-call-time id; capture each
    // value in returnedIds so the assertion can compare against the values
    // the mock actually returned (not against a hardcoded constant).
    kmStore.putEntity = async (entity, opts) => {
      nextSeq += 1;
      const id = `mock-${nextSeq}`;
      returnedIds.push(id);
      kmStore.callLog.push({ op: 'putEntity', id, entity, opts });
      kmStore._entities.set(id, { ...entity, id });
      return id;
    };
    const writer = createWriter(kmStore);

    const r1 = await writer.writeInsight({ id: 'insight-A', topic: 'A', summary: 's', created_at: '2026-06-16T00:00:00.000Z' });
    const r2 = await writer.writeInsight({ id: 'insight-B', topic: 'B', summary: 's', created_at: '2026-06-16T00:00:01.000Z' });
    const r3 = await writer.writeInsight({ id: 'insight-C', topic: 'C', summary: 's', created_at: '2026-06-16T00:00:02.000Z' });

    // The mock returned three distinct ids (mock-1, mock-2, mock-3) — those
    // are the canonical mintedIds. The writer's resolved mintedId for each
    // call MUST equal the captured value.
    assert.equal(returnedIds.length, 3, 'putEntity was called exactly 3 times');
    assert.equal(r1.mintedId, returnedIds[0], 'call 1 mintedId === putEntity return 1');
    assert.equal(r2.mintedId, returnedIds[1], 'call 2 mintedId === putEntity return 2');
    assert.equal(r3.mintedId, returnedIds[2], 'call 3 mintedId === putEntity return 3');

    // legacyId is independent — it tracks row.id, not putEntity.
    assert.equal(r1.legacyId, 'insight-A');
    assert.equal(r2.legacyId, 'insight-B');
    assert.equal(r3.legacyId, 'insight-C');
  });
});

describe('ObservationWriter.writeInsight — D-03 legacyId mirrors row.id verbatim (Test 11)', () => {
  it('legacyId === row.id by construction, even when row.id is uuid-shaped', async () => {
    // D-03 contract: writeInsight returns {legacyId, mintedId}; mintedId
    // closes the OC.js:660-661 findByLegacyId race observed 2026-06-15.
    // This test pins the legacyId field to row.id verbatim — no derivation,
    // no normalization — so callers can rely on round-trip identity with
    // whatever surrogate id they passed in.
    const kmStore = createMockKmStore();
    const writer = createWriter(kmStore);

    const uuidLikeId = 'd2c1f6c8-1234-4abc-9def-abcdef012345';
    const result = await writer.writeInsight({
      id: uuidLikeId,
      topic: 'UuidShaped',
      summary: 's',
      created_at: '2026-06-16T00:00:00.000Z',
    });

    assert.equal(result.legacyId, uuidLikeId, 'legacyId is the input row.id verbatim');
    // mintedId is the mock's default minted value — assert it is a non-empty
    // string distinct from the legacyId (legacyId vs mintedId are
    // independently sourced).
    assert.equal(typeof result.mintedId, 'string');
    assert.ok(result.mintedId.length > 0);
    assert.notEqual(result.mintedId, result.legacyId, 'mintedId is the km-core id, not the legacyId');
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

// ---------------------------------------------------------------------------
// Fuzzy Insight resolution (KM_INSIGHT_RESOLVER) — 2026-09-21
//
// Stage 3 of the KM revamp routes Insight identity through km-core's
// LayeredDeduplicator instead of the exact `topic + project` key. A merge is
// destructive, so the switch has three rungs and the default is the one that
// changes nothing.
//
// These tests drive `_resolveInsightFuzzy` through a stub deduplicator so no
// model is loaded: the contract under test is the MODE GATE, not the matcher.
// ---------------------------------------------------------------------------
describe('ObservationWriter — KM_INSIGHT_RESOLVER mode gate', () => {
  const KEY = 'KM_INSIGHT_RESOLVER';
  let saved;

  beforeEach(() => { saved = process.env[KEY]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  /** Writer with the dedup chain pre-stubbed, so no fastembed import happens. */
  function writerWithStubDedup(verdict) {
    const w = Object.create(ObservationWriter.prototype);
    w._insightDedup = { dedup: async () => verdict };
    return w;
  }

  const kmStoreWith = (pool) => ({ findByOntologyClass: async () => pool });
  const candidate = { id: 'other-1', name: 'UnifiedViewer visibleCount Duplication', metadata: {} };
  const probe = { id: 'probe-1', name: 'UnifiedViewer visibleCount Logic', metadata: {} };
  const matched = { matched: true, survivor: candidate, confidence: 0.978, matchedLayer: 'embedding' };

  it('returns null when the mode is unset — the default must change nothing', async () => {
    delete process.env[KEY];
    const w = writerWithStubDedup(matched);
    assert.equal(await w._resolveInsightFuzzy(kmStoreWith([candidate]), probe), null);
  });

  it('returns null when the mode is explicitly off', async () => {
    process.env[KEY] = 'off';
    const w = writerWithStubDedup(matched);
    assert.equal(await w._resolveInsightFuzzy(kmStoreWith([candidate]), probe), null);
  });

  it('reports a match in dry-run', async () => {
    process.env[KEY] = 'dry-run';
    const w = writerWithStubDedup(matched);
    const r = await w._resolveInsightFuzzy(kmStoreWith([candidate]), probe);
    assert.equal(r.survivor.id, 'other-1');
    assert.equal(r.layer, 'embedding');
    assert.ok(Math.abs(r.confidence - 0.978) < 1e-9);
  });

  it('reports the same match when on — the gate is at the CALL SITE, not here', async () => {
    // _resolveInsightFuzzy answers "is there a match"; only writeInsight
    // decides whether to act on it. Keeping the split means dry-run and on
    // exercise one code path, so dry-run genuinely rehearses the live one.
    process.env[KEY] = 'on';
    const w = writerWithStubDedup(matched);
    const r = await w._resolveInsightFuzzy(kmStoreWith([candidate]), probe);
    assert.equal(r.survivor.id, 'other-1');
  });

  it('excludes self and archived rows from the candidate pool', async () => {
    process.env[KEY] = 'dry-run';
    let seen = null;
    const w = Object.create(ObservationWriter.prototype);
    w._insightDedup = { dedup: async (_e, pool) => { seen = pool; return { matched: false }; } };
    const pool = [
      probe,                                                        // self
      { id: 'arch-1', name: 'archived one', metadata: { archivedAt: '2026-09-01' } },
      candidate,
    ];
    await w._resolveInsightFuzzy(kmStoreWith(pool), probe);
    assert.deepEqual(seen.map((e) => e.id), ['other-1']);
  });

  it('returns null rather than throwing when the pool is empty', async () => {
    process.env[KEY] = 'dry-run';
    const w = writerWithStubDedup(matched);
    assert.equal(await w._resolveInsightFuzzy(kmStoreWith([]), probe), null);
  });

  it('swallows resolver failure — a durable write must not depend on it', async () => {
    process.env[KEY] = 'on';
    const w = Object.create(ObservationWriter.prototype);
    w._insightDedup = { dedup: async () => { throw new Error('model exploded'); } };
    assert.equal(await w._resolveInsightFuzzy(kmStoreWith([candidate]), probe), null);
  });
});

// ---------------------------------------------------------------------------
// Fastembed cache dir — the env var is a TRAP (2026-09-21)
//
// km-core folds KM_FASTEMBED_CACHE_DIR into a module-level const evaluated at
// IMPORT time (FastembedEmbeddingClient.ts:69). Every `process.env.X ||= ...`
// written after an import of km-core is therefore a no-op — and in obs-api
// km-core is imported at boot for GraphKMStore, so the const is frozen long
// before the resolver ever runs. The symptom is not an error: the client
// silently resolves the package-root dir, fastembed DOWNLOADS 88MB there, and
// on a machine where that download fails (corporate proxy → bare
// AggregateError) the resolver's own catch swallows it and returns null
// forever. A dry-run log then says nothing, which is indistinguishable from
// "this corpus has no duplicates".
//
// This is a source-shape assertion on purpose. The runtime tests above inject
// `_insightDedup` so no model loads, which means construction — where the bug
// lives — is never exercised by them; and a test that did exercise it would
// have to download the weights to fail. The bug has recurred twice (the fix on
// 2026-09-21 was itself the env-var form, and the stray 88MB copy reappeared
// the same night), so the shape is what gets pinned.
// ---------------------------------------------------------------------------

describe('ObservationWriter — fastembed weights are located by cacheDir, not env', () => {
  const SRC = readFileSync(new URL('./ObservationWriter.js', import.meta.url), 'utf8');

  it('constructs FastembedEmbeddingClient with an explicit cacheDir', () => {
    const ctor = SRC.match(/new\s+km\.FastembedEmbeddingClient\(([\s\S]{0,200}?)\)/);
    assert.ok(ctor, 'expected the resolver to construct a FastembedEmbeddingClient');
    assert.match(
      ctor[1],
      /cacheDir\s*:/,
      'FastembedEmbeddingClient must be given an explicit cacheDir — km-core reads ' +
        'KM_FASTEMBED_CACHE_DIR once, at import time, so setting it here is too late',
    );
  });

  it('does not try to set KM_FASTEMBED_CACHE_DIR after importing km-core', () => {
    assert.doesNotMatch(
      SRC,
      /process\.env\.KM_FASTEMBED_CACHE_DIR\s*(\|\||\?\?)?=/,
      'assigning KM_FASTEMBED_CACHE_DIR in this file is a no-op — pass cacheDir instead',
    );
  });

  it('points at the repo copy under .data, not the km-core package root', () => {
    assert.match(SRC, /'fastembed-cache'/);
    assert.match(SRC, /'\.data'/);
  });
});

// ---------------------------------------------------------------------------
// Stage 4 — hierarchy placement from the mentions edges (2026-09-21)
//
// The revamp plan said to resolve `_classifyInsightByOntology`'s output to a
// SubComponent. Measured against the live graph that is not buildable: the
// classifier scores against development-knowledge-ontology.json, whose 14
// classes are artifact kinds (Insight, Decision, Constraint), not subsystems
// — 2 of 27 observed values matched a SubComponent name and only 73 of 959
// insights carried the field. The mentions classifier already answers the
// real question against the live catalogue, so placement is derived from it.
//
// The edge type matters as much as the source. Stage 2 arbitrated 42 rows on
// "contains = hierarchy member, has_insight = learning artifact"
// (repair-writer-ontology-class.mjs:180) and that partition is currently
// exact. These tests pin that placement stays a FIELD.
// ---------------------------------------------------------------------------

describe('ObservationConsolidator._resolveInsightParent — stage 4 placement', () => {
  // Four SubComponents with different corpus-wide mention counts, plus a
  // Component that must never be chosen as a parent. sub-hub is the popular
  // one (3 mentions); the rest have 1 each.
  const makeStore = ({ throwOnTally = false } = {}) => ({
    findByOntologyClass: async (cls) => {
      if (throwOnTally) throw new Error('store unavailable');
      if (cls !== 'SubComponent') return [];
      return [
        { id: 'sub-hub', name: 'LoggingModule', metadata: { hierarchyLevel: 2 } },
        { id: 'sub-mid', name: 'CodeGraph', metadata: { hierarchyLevel: 2 } },
        { id: 'sub-deep', name: 'SpecstoryAdapter', metadata: { hierarchyLevel: 3 } },
        { id: 'sub-nolevel', name: 'Orphaned', metadata: {} },
      ];
    },
    // sub-hub ×3, sub-mid ×1, sub-deep ×1, sub-nolevel ×1
    findRelations: async ({ type }) => {
      if (type !== 'mentions') return [];
      return [
        { from: 'i1', to: 'sub-hub', type: 'mentions' },
        { from: 'i2', to: 'sub-hub', type: 'mentions' },
        { from: 'i3', to: 'sub-hub', type: 'mentions' },
        { from: 'i4', to: 'sub-mid', type: 'mentions' },
        { from: 'i5', to: 'sub-deep', type: 'mentions' },
        { from: 'i6', to: 'sub-nolevel', type: 'mentions' },
        { from: 'i7', to: 'comp-1', type: 'mentions' },
      ];
    },
  });

  const consolidatorWith = (kmStore) =>
    new ObservationConsolidator({ kmStore, observationWriter: {}, runId: 'stage4-test' });

  it('picks the LEAST-mentioned SubComponent — rarity means specificity', async () => {
    const c = consolidatorWith(makeStore());
    // sub-hub has 3 corpus-wide mentions, sub-mid 1. The rare one wins.
    const p = await c._resolveInsightParent(['sub-hub', 'sub-mid']);
    assert.equal(p.parentId, 'sub-mid');
    assert.equal(p.parentMentions, 1);
  });

  it('never lets a popular hub adopt an insight that named anything rarer', async () => {
    // The regression this rule exists to prevent: ranking by popularity put
    // 231 of 767 live insights under one hub and 44.7% under three.
    const c = consolidatorWith(makeStore());
    const p = await c._resolveInsightParent(['sub-hub', 'sub-deep', 'sub-mid']);
    assert.notEqual(p.parentId, 'sub-hub', 'the 3-mention hub must never win over a 1-mention name');
  });

  it('ranks corpus-wide, not by position in the mentions list', async () => {
    const c = consolidatorWith(makeStore());
    const first = await c._resolveInsightParent(['sub-hub', 'sub-mid']);
    const second = await c._resolveInsightParent(['sub-mid', 'sub-hub']);
    assert.equal(first.parentId, second.parentId, 'order of the ids must not decide the parent');
    assert.equal(first.parentId, 'sub-mid');
  });

  it('breaks ties on the lower id so a re-run is reproducible', async () => {
    const c = consolidatorWith(makeStore());
    // sub-mid, sub-deep and sub-nolevel all have exactly 1 mention.
    const a = await c._resolveInsightParent(['sub-mid', 'sub-deep', 'sub-nolevel']);
    const b = await c._resolveInsightParent(['sub-nolevel', 'sub-deep', 'sub-mid']);
    assert.equal(a.parentId, b.parentId);
    assert.equal(a.parentId, 'sub-deep', 'lowest id wins a tie');
  });

  it('derives hierarchyLevel from the parent rather than hardcoding 3', async () => {
    const c = consolidatorWith(makeStore());
    const deep = await c._resolveInsightParent(['sub-deep']);
    assert.equal(deep.hierarchyLevel, 4, 'a level-3 parent yields a level-4 child');
    const mid = await c._resolveInsightParent(['sub-mid']);
    assert.equal(mid.hierarchyLevel, 3);
  });

  it('falls back to level 3 when the parent carries no level', async () => {
    const c = consolidatorWith(makeStore());
    const p = await c._resolveInsightParent(['sub-nolevel']);
    assert.equal(p.hierarchyLevel, 3);
  });

  // ---- the classifier's own answer, added 2026-09-21 --------------------
  //
  // Rarity fixed the distribution but never read the insight. The classifier
  // does, and now returns a primary subject; these pin that it WINS, that the
  // rarity prior survives untouched as the fallback, and that which rule fired
  // is recorded rather than inferred.

  it('prefers the classifier primary over the rarity prior', async () => {
    const c = consolidatorWith(makeStore());
    // Rarity alone would pick sub-mid (1 mention) over sub-hub (3).
    const p = await c._resolveInsightParent(['sub-hub', 'sub-mid'], 'sub-hub');
    assert.equal(p.parentId, 'sub-hub', 'the classifier read the text; the prior did not');
    assert.equal(p.parentSource, 'classifier');
  });

  it('falls back to rarity when the classifier declines to pick', async () => {
    const c = consolidatorWith(makeStore());
    const p = await c._resolveInsightParent(['sub-hub', 'sub-mid'], null);
    assert.equal(p.parentId, 'sub-mid');
    assert.equal(p.parentSource, 'rarity');
  });

  it('falls back to rarity when the primary cannot be a parent', async () => {
    const c = consolidatorWith(makeStore());
    // comp-1 is a Component: a real entity, mentioned, but not a parent here.
    const p = await c._resolveInsightParent(['sub-hub', 'sub-mid'], 'comp-1');
    assert.equal(p.parentId, 'sub-mid');
    assert.equal(p.parentSource, 'rarity');
  });

  it('a classifier primary still derives its level from the parent', async () => {
    const c = consolidatorWith(makeStore());
    const p = await c._resolveInsightParent(['sub-deep', 'sub-mid'], 'sub-deep');
    assert.equal(p.parentId, 'sub-deep');
    assert.equal(p.hierarchyLevel, 4, 'level-3 parent yields a level-4 child');
  });

  it('never adopts a Component or any non-SubComponent mention', async () => {
    const c = consolidatorWith(makeStore());
    assert.equal(await c._resolveInsightParent(['comp-1']), null);
    assert.equal(await c._resolveInsightParent(['detail-9', 'unknown-id']), null);
  });

  it('returns null for an insight that mentions nothing', async () => {
    const c = consolidatorWith(makeStore());
    assert.equal(await c._resolveInsightParent([]), null);
    assert.equal(await c._resolveInsightParent(undefined), null);
  });

  it('tallies once per instance — placement must not rescan per write', async () => {
    let scans = 0;
    const store = makeStore();
    const counted = {
      ...store,
      findRelations: async (f) => { scans += 1; return store.findRelations(f); },
    };
    const c = consolidatorWith(counted);
    await c._resolveInsightParent(['sub-hub']);
    await c._resolveInsightParent(['sub-mid']);
    await c._resolveInsightParent(['sub-deep']);
    assert.equal(scans, 1, 'the ~30k-edge scan must be memoized for the run');
  });

  it('is non-fatal when the store cannot answer — an insight is never lost to placement', async () => {
    const c = consolidatorWith(makeStore({ throwOnTally: true }));
    assert.equal(await c._resolveInsightParent(['sub-hub']), null);
  });
});

// ---------------------------------------------------------------------------
// Stage 5 — a parent is described BY ITS CHILDREN (2026-09-21)
//
// The bug being fixed: wave-controller.ts:1233 sets a parent's description to
// `entity.observations[0]` — one arbitrary child, verbatim. So moving UP the
// tree returned a detail instead of a summary. The verbatim-copy refusal below
// is therefore a release gate, not a nicety.
// ---------------------------------------------------------------------------

describe('ObservationConsolidator.synthesizeParentDescriptions — stage 5', () => {
  const ENTS = {
    Project: [{ id: 'proj', name: 'Coding', ontologyClass: 'Project', metadata: {} }],
    Component: [{ id: 'comp', name: 'KnowledgeManagement', ontologyClass: 'Component', metadata: {} }],
    SubComponent: [{ id: 'sub', name: 'GraphStore', ontologyClass: 'SubComponent', metadata: {} }],
    Detail: [
      { id: 'd1', name: 'Graph reader', ontologyClass: 'Detail',
        description: 'The GraphifyGraph reader loads graph.json and exposes node lookup.', metadata: {} },
      { id: 'd2', name: 'Graph writer', ontologyClass: 'Detail',
        description: 'The writer persists entities through km-core putEntity.', metadata: {} },
    ],
    Insight: [
      { id: 'i1', name: 'placed insight', ontologyClass: 'Insight',
        description: 'An online insight attached by parentId rather than an edge.',
        metadata: { parentId: 'sub' } },
    ],
  };
  const makeStore = (over = {}) => ({
    findByOntologyClass: async (c) => ENTS[c] ?? [],
    findRelations: async ({ type } = {}) =>
      (!type || type === 'contains')
        ? [{ from: 'comp', to: 'd1', type: 'contains' }, { from: 'comp', to: 'd2', type: 'contains' }]
        : [],
    mergeAttributes: async () => {},
    ...over,
  });
  const make = (store, llm) => {
    const c = new ObservationConsolidator({ kmStore: store, observationWriter: {}, runId: 'stage5' });
    c._callLLM = llm;
    return c;
  };

  it('reads children from BOTH contains edges and metadata.parentId', async () => {
    const c = make(makeStore(), async () => 'x');
    const kids = await c._collectHierarchyChildren(makeStore());
    assert.deepEqual((kids.get('comp') ?? []).map((e) => e.id).sort(), ['d1', 'd2'], 'contains edges');
    assert.deepEqual((kids.get('sub') ?? []).map((e) => e.id), ['i1'], 'stage 4 parentId field');
  });

  it('refuses a synthesis that is a verbatim copy of a child', async () => {
    const copy = ENTS.Detail[0].description;
    const c = make(makeStore(), async () => copy);
    const r = await c.synthesizeParentDescriptions({ dryRun: true, classes: ['Component'] });
    assert.equal(r.verbatimBlocked, 1, 'the exact bug this stage exists to fix must be refused');
    assert.equal(r.synthesised, 0);
  });

  it('accepts a genuine generalisation', async () => {
    const c = make(makeStore(), async () =>
      'Knowledge management owns how graph data is read and written. It covers reading ' +
      'graph.json and persisting entities through km-core, keeping both sides on one store.');
    const r = await c.synthesizeParentDescriptions({ dryRun: true, classes: ['Component'] });
    assert.equal(r.synthesised, 1);
    assert.equal(r.verbatimBlocked, 0);
  });

  it('writes nothing in dry run', async () => {
    let wrote = 0;
    const c = make(makeStore({ mergeAttributes: async () => { wrote += 1; } }),
      async () => 'A genuine generalisation about the component and its responsibilities here.');
    await c.synthesizeParentDescriptions({ dryRun: true, classes: ['Component'] });
    assert.equal(wrote, 0, 'dry run must not touch the store');
  });

  it('writes, and stamps rollUpOf + rolledUpAt, when applied', async () => {
    const seen = [];
    const c = make(makeStore({ mergeAttributes: async (id, attrs) => seen.push({ id, attrs }) }),
      async () => 'A genuine generalisation about the component and its responsibilities here.');
    const r = await c.synthesizeParentDescriptions({ dryRun: false, classes: ['Component'] });
    assert.equal(r.synthesised, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].id, 'comp');
    assert.equal(seen[0].attrs.metadata.rollUpOf, 2);
    assert.ok(seen[0].attrs.metadata.rolledUpAt);
  });

  it('onlyDirty skips a parent whose children predate its last synthesis', async () => {
    const fresh = { ...ENTS.Component[0], metadata: { rolledUpAt: '2030-01-01T00:00:00.000Z' } };
    const store = makeStore({
      findByOntologyClass: async (c2) => (c2 === 'Component' ? [fresh] : (ENTS[c2] ?? [])),
    });
    const c = make(store, async () => 'should never be called');
    const r = await c.synthesizeParentDescriptions({ dryRun: true, onlyDirty: true, classes: ['Component'] });
    assert.equal(r.selected, 0, 'a parent newer than every child is not dirty');
    assert.equal(r.calls, 0, 'and costs no LLM call — this is what makes the scheduled pass affordable');
  });

  it('strips the model preamble that would otherwise open the description', async () => {
    const c = make(makeStore(), async () => "Here's a summary: The component coordinates graph reads and writes across km-core and the viewer.");
    const r = await c.synthesizeParentDescriptions({ dryRun: true, classes: ['Component'] });
    assert.equal(r.synthesised, 1);
    // The preamble goes, the sentence stays. A GREEDY `[^\n.]*[.:]` used to run
    // to the last period on the line and return '' — a silently blanked field.
    const one = "Here's a summary: The component coordinates graph reads and writes across km-core.";
    assert.equal(c._stripSynthesisPreamble(one), 'The component coordinates graph reads and writes across km-core.');
    assert.equal(c._stripSynthesisPreamble('```markdown\nbody text that is long enough to survive the guard below ok\n```'),
      'body text that is long enough to survive the guard below ok');
    // The regression itself: a long synthesis must never come back empty.
    const trap = "Here's a summary: " +
      'The component coordinates graph reads and writes across km-core and the viewer. '.repeat(3);
    assert.ok(c._stripSynthesisPreamble(trap).length > 40, 'a long synthesis must never be blanked');
  });

  it('asks the model to generalise upward, naming the parent and its child count', () => {
    const c = make(makeStore(), async () => '');
    const p = c._buildParentSynthesisPrompt({ parent: { name: 'KnowledgeManagement' }, cls: 'Component', childBlock: 'x', count: 125 });
    assert.match(p.system, /Generalise upward/);
    assert.match(p.system, /never restate one child/i);
    assert.match(p.user, /KnowledgeManagement/);
    assert.match(p.user, /125/);
  });
});
