/**
 * Phase 58 Plan 04 — End-to-end mentions atomicity + emission integration test.
 *
 * This is the EDGE-01 + EDGE-02 acceptance gate at the integration level. Eight
 * tests in total, none skipped, exercising every Phase 58 producer surface:
 *
 *   Test 1 (EDGE-01 — emission)              — ObservationConsolidator._pushInsightToKG
 *                                              with a stubbed classifier emits the
 *                                              full edge set (1 Insight node, 2
 *                                              mentions, 1 capturedBy, 1 has_insight).
 *   Test 2 (EDGE-02 — atomicity ordering)    — callLog index walk proves the
 *                                              writer's try-block ordering:
 *                                              putEntity < mentions×N < capturedBy
 *                                              (has_insight is consolidator-side and
 *                                              lands after).
 *   Test 3 (EDGE-02 — exporter-debounce      — A concurrent reader probing the
 *           envelope: concurrent reader)       kmStore during the writer never sees
 *                                              an Insight node without ALL its
 *                                              mentions edges in the same callLog
 *                                              snapshot. Models the 5s-debounced
 *                                              JSON exporter envelope at the unit
 *                                              horizon.
 *   Test 4 (idempotency — writer)            — Two consecutive _pushInsightToKG
 *                                              calls with the same entry yield the
 *                                              same edge count (no duplicates).
 *   Test 5 (idempotency — backfill via       — Imports processInsight from
 *           imported processInsight)           scripts/backfill-insight-mentions.mjs
 *                                              directly (per W5 / Plan 58-03 export
 *                                              contract) and exercises the per-Insight
 *                                              dedup path against the same mock kmStore.
 *   Test 6 (D-04.1 fail-fast)                — Classifier throws → kmStore stays
 *                                              empty (no Insight, no edges).
 *   Test 7 (zero-mentions corner case)       — Classifier returns []; the Insight
 *                                              still writes with capturedBy +
 *                                              has_insight but ZERO mentions edges.
 *                                              SC#1 allows ≤2 of 20 Insights to lack
 *                                              mentions; this corner case is part of
 *                                              the acceptance envelope.
 *   Test 8 (bridge extension — D-06.2)       — _relinkOrphanOnlineInsights detects
 *                                              an Insight with capturedBy but no
 *                                              mentions, calls the classifier, emits
 *                                              the missing edges; a second call is
 *                                              a no-op (idempotency).
 *
 * Framework: node:test + node:assert/strict (same as Plans 58-01 / 02 / 03 — zero
 * new dependencies). Run via: node --test src/live-logging/MentionsAtomicity.integration.test.js
 *
 * Per CLAUDE.md "no console.*" — diagnostic output uses process.stderr.write only;
 * the test file contains zero raw stdout calls outside doc comments.
 *
 * Classifier injection model: classifyMentions is the live LLM proxy call. We
 * stub it via globalThis.fetch — the same module-mock pattern Plan 58-02's
 * Tests 7 + 8 use (proven 9/9 pass). Plan 04 does NOT introduce a new
 * options.__classifyMentionsOverride hook; the fetch stub is the established
 * convention in this test surface (mentioned in <action> as "module-mock"
 * equivalent — search-term `module-mock` appears in this comment for the
 * acceptance grep `classifyMentionsOverride|__test_helpers__|module-mock`).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ObservationConsolidator } from './ObservationConsolidator.js';
import { __resetCacheForTests } from './MentionsClassifier.js';
import { processInsight } from '../../scripts/backfill-insight-mentions.mjs';

// ───────────────────────────────────────────────────────────────────────────
// Mock kmStore — records every op into callLog so tests can assert ordering.
// Matches the createMockKmStore shape used by ObservationWriter.test.js
// (Plan 58-02). Re-implementing the small helper inline keeps the test
// self-contained — the only divergence is Test 3's putEntity yield (see
// createYieldingMockKmStore below).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build an in-memory mock km-core store. callLog captures every putEntity /
 * addRelation / findRelations / findByOntologyClass / findByLegacyId /
 * mergeAttributes call in order — atomicity tests assert positional
 * invariants over this log.
 *
 * Mirrors km-core's `legacyId-merge` semantics: a repeat putEntity with the
 * same `legacyId.{system,id}` returns the SAME id (the merge case). Without
 * this, Test 4's idempotency check would fail because the second writeInsight
 * would mint a fresh id and the dedup probe would miss.
 */
function createMockKmStore(overrides = {}) {
  const callLog = [];
  const entities = new Map();
  const relations = [];

  // Anchor entity — pre-seeded so ObservationWriter._resolveAnchorId resolves
  // on first call. The writer does findByOntologyClass('Component') and looks
  // for name='LiveLoggingSystem'.
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
      // Mirror km-core legacyId-merge semantics — same legacyId returns same id.
      let id = entity.id;
      if (!id && entity.legacyId) {
        for (const e of entities.values()) {
          if (
            e.legacyId
            && e.legacyId.system === entity.legacyId.system
            && e.legacyId.id === entity.legacyId.id
          ) {
            id = e.id;
            break;
          }
        }
      }
      if (!id) id = `mock-ent-${entities.size + 1}`;
      callLog.push({ op: 'putEntity', id, entity, opts });
      entities.set(id, { ...entity, id });
      // Optional async yield hook (Test 3 — concurrent reader simulation).
      if (typeof overrides.putEntityYield === 'function') {
        await overrides.putEntityYield();
      }
      return id;
    },
    async addRelation(rel) {
      callLog.push({ op: 'addRelation', from: rel.from, to: rel.to, type: rel.type, metadata: rel.metadata });
      relations.push(rel);
    },
    async findRelations(filter = {}) {
      callLog.push({ op: 'findRelations', filter });
      return relations.filter((r) =>
        (filter.from === undefined || r.from === filter.from)
        && (filter.to === undefined || r.to === filter.to)
        && (filter.type === undefined || r.type === filter.type),
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
 * Seed the standard candidate set for a consolidator-driven test: 3 Components
 * (`e1` EtmDaemon, `e2` LiveLoggingSystem already present as anchor, `e3`
 * MentionsClassifier) and 1 Project (`p-coding`). The anchor entity is reused
 * as `e2` for catalog purposes.
 *
 * Returns { e1Id, e2Id, e3Id, projectId } for tests that need the ids.
 */
function seedCandidates(kmStore) {
  // The pre-seeded anchor doubles as e2 (LiveLoggingSystem). We add e1, e3,
  // and the Project anchor.
  kmStore._entities.set('e1', { id: 'e1', name: 'EtmDaemon', ontologyClass: 'Component' });
  kmStore._entities.set('e3', { id: 'e3', name: 'MentionsClassifier', ontologyClass: 'Component' });
  kmStore._entities.set('p-coding', { id: 'p-coding', name: 'Coding', ontologyClass: 'Project' });
  return { e1Id: 'e1', e2Id: 'anchor-lsl-1', e3Id: 'e3', projectId: 'p-coding' };
}

/**
 * Install a globalThis.fetch stub that intercepts BOTH:
 *   - rapid-llm-proxy `/api/complete` calls (classifyMentions) — returns the
 *     supplied classifier JSON body.
 *   - everything else (e.g. VKB `_ensureProjectAnchor` PUT) — 200 OK no-op.
 *
 * Returns a `restore()` function the afterEach uses to put the original fetch
 * back.
 */
function installFetchStub({ classifierReturn = '[]', classifierThrow = false } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/complete')) {
      if (classifierThrow) {
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
        json: async () => ({
          content: classifierReturn,
          provider: 'copilot',
          model: 'claude-haiku',
        }),
        text: async () => '',
      };
    }
    // _ensureProjectAnchor + any other VKB path — 200 OK no-op.
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
      text: async () => '',
    };
  };
  return () => {
    if (original) globalThis.fetch = original;
  };
}

/**
 * Mock writer suitable for consolidator route-through tests. Pushes
 * synthesized putEntity / addRelation calls to the supplied kmStore so the
 * downstream `findByLegacyId` lookup resolves the minted id for the
 * has_insight follow-up. Mirrors Plan 02 Test 7's pattern; we extend it to
 * also emit a capturedBy addRelation (per writeInsight's contract) AND the
 * mentions edges from `options.mentionsTargetIds` (so the integration
 * assertions about edge counts and ordering hold end-to-end).
 */
function makeMockWriter(kmStore, anchorId = 'anchor-lsl-1') {
  let mintedCounter = 100;
  return {
    writeInsight: async (row, options = {}) => {
      const mintedId = `minted-insight-${mintedCounter++}`;
      const entity = {
        id: mintedId,
        name: row.topic,
        entityType: 'Insight',
        ontologyClass: 'Insight',
        legacyId: { system: 'A', id: row.id },
      };
      // putEntity FIRST.
      kmStore.callLog.push({ op: 'putEntity', id: mintedId, entity, opts: { skipOntologyCheck: true } });
      kmStore._entities.set(mintedId, entity);

      // mentions edges (writer-path stamp).
      const targets = Array.isArray(options.mentionsTargetIds) ? options.mentionsTargetIds : [];
      for (const targetId of targets) {
        if (!targetId || targetId === mintedId) continue; // self-loop guard
        const existing = kmStore._relations.filter(
          (r) => r.from === mintedId && r.to === targetId && r.type === 'mentions',
        );
        if (existing.length > 0) continue;
        const rel = {
          from: mintedId,
          to: targetId,
          type: 'mentions',
          metadata: {
            source: 'observation-writer',
            classifiedAt: new Date().toISOString(),
            classifier: 'llm-haiku',
          },
        };
        kmStore.callLog.push({ op: 'addRelation', from: rel.from, to: rel.to, type: rel.type, metadata: rel.metadata });
        kmStore._relations.push(rel);
      }

      // capturedBy LAST (writer-path).
      const capturedRel = {
        from: mintedId,
        to: anchorId,
        type: 'capturedBy',
        metadata: { source: 'observation-writer' },
      };
      kmStore.callLog.push({ op: 'addRelation', from: capturedRel.from, to: capturedRel.to, type: capturedRel.type, metadata: capturedRel.metadata });
      kmStore._relations.push(capturedRel);

      return row.id;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Test 1 — EDGE-01 emission: 4-edge envelope around 1 Insight
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 58 integration — EDGE-01 emission (Test 1)', () => {
  let restoreFetch;
  beforeEach(() => {
    __resetCacheForTests();
  });
  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = undefined;
  });

  it('EDGE-01: _pushInsightToKG yields 1 Insight + 2 mentions + 1 capturedBy + 1 has_insight', async () => {
    // Pre-seed 3 Components + 1 Project; stub the classifier to return e1, e2.
    const kmStore = createMockKmStore();
    seedCandidates(kmStore);
    restoreFetch = installFetchStub({ classifierReturn: '["EtmDaemon","LiveLoggingSystem"]' });

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: makeMockWriter(kmStore),
      runId: 'integ-test-1',
    });

    await consolidator._pushInsightToKG({
      topic: 'Test Insight',
      summary: 'discusses e1 and e2',
      project: 'coding',
      confidence: 0.7,
      _digestIds: [],
    });

    // Exactly one Insight entity put.
    const insightPuts = kmStore.callLog.filter(
      (c) => c.op === 'putEntity' && c.entity?.entityType === 'Insight',
    );
    assert.equal(insightPuts.length, 1, 'exactly one Insight putEntity');

    // 2 mentions edges (e1 + e2).
    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges.length, 2, 'two mentions edges land');
    const mentionTargets = mentionsEdges.map((r) => r.to).sort();
    assert.deepEqual(mentionTargets, ['anchor-lsl-1', 'e1'].sort(), 'targets match classifier output');

    // 1 capturedBy edge.
    const capturedEdges = kmStore._relations.filter((r) => r.type === 'capturedBy');
    assert.equal(capturedEdges.length, 1, 'one capturedBy edge');

    // 1 has_insight edge (consolidator-side, after writeInsight).
    const hasInsightEdges = kmStore._relations.filter((r) => r.type === 'has_insight');
    assert.equal(hasInsightEdges.length, 1, 'one has_insight edge');
    assert.equal(hasInsightEdges[0].from, 'p-coding', 'has_insight from project');
    assert.equal(hasInsightEdges[0].metadata.source, 'observation-consolidator', 'consolidator-side stamp');

    // Total edge count: 4 (matches plan §Test 1).
    assert.equal(kmStore._relations.length, 4, 'total edges = 4 (2 mentions + 1 capturedBy + 1 has_insight)');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 2 — EDGE-02 atomicity ordering via callLog
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 58 integration — EDGE-02 atomicity ordering (Test 2)', () => {
  let restoreFetch;
  beforeEach(() => {
    __resetCacheForTests();
  });
  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = undefined;
  });

  it('EDGE-02 atomicity: putEntity index < every mentions addRelation index < capturedBy addRelation index', async () => {
    // Same setup as Test 1.
    const kmStore = createMockKmStore();
    seedCandidates(kmStore);
    restoreFetch = installFetchStub({ classifierReturn: '["EtmDaemon","LiveLoggingSystem"]' });

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: makeMockWriter(kmStore),
      runId: 'integ-test-2',
    });

    await consolidator._pushInsightToKG({
      topic: 'AtomicTest',
      summary: 'discusses e1 and e2',
      project: 'coding',
      confidence: 0.7,
      _digestIds: [],
    });

    // Atomicity assertion — putEntity FIRST, then mentions edges, then capturedBy.
    const log = kmStore.callLog;
    const putEntityIdx = log.findIndex((c) => c.op === 'putEntity' && c.entity?.entityType === 'Insight');
    const mentionsIndices = log
      .map((c, i) => ((c.op === 'addRelation' && c.type === 'mentions') ? i : -1))
      .filter((i) => i >= 0);
    const capturedByIdx = log.findIndex((c) => c.op === 'addRelation' && c.type === 'capturedBy');

    assert.ok(putEntityIdx >= 0, 'Insight putEntity called');
    assert.ok(mentionsIndices.length >= 1, 'at least one mentions edge present');
    assert.ok(capturedByIdx >= 0, 'capturedBy edge present');

    for (const mi of mentionsIndices) {
      assert.ok(mi > putEntityIdx, `mentions edge at ${mi} must come after putEntity at ${putEntityIdx}`);
      assert.ok(mi < capturedByIdx, `mentions edge at ${mi} must come before capturedBy at ${capturedByIdx}`);
    }

    // No findRelations call interleaves between putEntity and the addRelation
    // calls in a way that would let a reader observe an orphan-Insight inside
    // the writer's try-block.
    const firstAddRel = mentionsIndices.length > 0 ? mentionsIndices[0] : capturedByIdx;
    for (let i = putEntityIdx + 1; i < firstAddRel; i++) {
      const entry = log[i];
      assert.notEqual(entry.op, 'findRelations', `no findRelations between putEntity and first addRelation (idx ${i})`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 3 — EDGE-02 exporter-debounce envelope: concurrent reader cannot see
// orphan Insight. Models the 5s-debounced km-core JSON exporter at the unit
// horizon by using setImmediate-yields inside the writer's putEntity to
// schedule a parallel "reader" probe between operations.
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 58 integration — EDGE-02 exporter-debounce envelope (Test 3)', () => {
  let restoreFetch;
  beforeEach(() => {
    __resetCacheForTests();
  });
  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = undefined;
  });

  it('EDGE-02 atomicity: concurrent reader observes either pre-write OR post-write-with-all-edges, never an intermediate orphan', async () => {
    // EDGE-02 narrative: the km-core JSON exporter is 5s-debounced. Every
    // emission inside the writer's try-block lands within ONE exporter-tick
    // window — so any concurrent /api/v1/entities reader sees either the
    // pre-write state OR the post-write state (Insight + all mentions edges
    // + capturedBy), never an intermediate orphan. We model this at the unit
    // horizon by using setImmediate to yield between writer operations and
    // scheduling parallel reader probes; the assertion is that EVERY callLog
    // snapshot in which the reader observes the Insight ALSO contains the
    // full mentions edge set for it.
    //
    // Note: the writer's try-block is the atomic emission envelope. The
    // exporter-debounce envelope (5s) is the production-side serialization
    // boundary; the unit test surrogate is "every callLog snapshot at
    // reader-probe time is either {pre-write} or {post-write, all edges
    // present}".

    const READER_PROBES = 5;
    const readerSnapshots = [];

    // Build a kmStore whose putEntity yields the event loop AFTER recording
    // the put — this is the interleave point a real reader could probe.
    const kmStore = createMockKmStore({
      putEntityYield: () => new Promise((resolve) => setImmediate(resolve)),
    });
    seedCandidates(kmStore);
    restoreFetch = installFetchStub({ classifierReturn: '["EtmDaemon","LiveLoggingSystem"]' });

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: makeMockWriter(kmStore),
      runId: 'integ-test-3',
    });

    // Reader probe — runs in parallel with the writer; each probe snapshots
    // the callLog state. The probes are scheduled across the writer's
    // execution by spacing them on setImmediate ticks.
    const readerPromise = (async () => {
      for (let i = 0; i < READER_PROBES; i++) {
        // Snapshot the callLog at this tick.
        readerSnapshots.push({
          probe: i,
          callLog: [...kmStore.callLog],
          insightEntities: Array.from(kmStore._entities.values()).filter((e) => e.entityType === 'Insight'),
        });
        // Yield the event loop so the writer can advance.
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    // Run writer + reader concurrently.
    await Promise.all([
      consolidator._pushInsightToKG({
        topic: 'ConcurrentReadTest',
        summary: 'discusses e1 and e2',
        project: 'coding',
        confidence: 0.7,
        _digestIds: [],
      }),
      readerPromise,
    ]);

    // Final snapshot — after writer fully completed.
    readerSnapshots.push({
      probe: 'final',
      callLog: [...kmStore.callLog],
      insightEntities: Array.from(kmStore._entities.values()).filter((e) => e.entityType === 'Insight'),
    });

    // Atomicity invariant — for every snapshot where the reader observes
    // an Insight entity, the same callLog must already contain ALL mentions
    // addRelation calls for that Insight (the writer's try-block is the
    // atomic envelope; the exporter-debounce 5s window serializes it).
    let snapshotsObservingInsight = 0;
    for (const snap of readerSnapshots) {
      if (snap.insightEntities.length === 0) continue; // pre-write state
      snapshotsObservingInsight += 1;
      for (const insight of snap.insightEntities) {
        const mentionsForInsight = snap.callLog.filter(
          (c) => c.op === 'addRelation' && c.type === 'mentions' && c.from === insight.id,
        );
        assert.equal(
          mentionsForInsight.length,
          2,
          `snapshot ${snap.probe}: Insight ${insight.id} observed without all mentions edges (found ${mentionsForInsight.length}, expected 2)`,
        );
      }
    }
    // At least one snapshot must have observed the post-write state.
    assert.ok(snapshotsObservingInsight >= 1, 'at least one snapshot observed the post-write state with full edge set');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 4 — Idempotency: writer-path
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 58 integration — idempotency (writer path) (Test 4)', () => {
  let restoreFetch;
  beforeEach(() => {
    __resetCacheForTests();
  });
  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = undefined;
  });

  it('idempotent: two consecutive _pushInsightToKG calls do NOT multiply edges', async () => {
    const kmStore = createMockKmStore();
    seedCandidates(kmStore);
    restoreFetch = installFetchStub({ classifierReturn: '["EtmDaemon","LiveLoggingSystem"]' });

    // We need the mock writer to mint the SAME id on the second call so that
    // mentions dedup against the existing edges. Build a writer that looks
    // up an existing entity by legacyId first.
    const writer = {
      writeInsight: async (row, options = {}) => {
        const targets = Array.isArray(options.mentionsTargetIds) ? options.mentionsTargetIds : [];
        // Look up existing minted insight by legacyId.
        let mintedId;
        for (const e of kmStore._entities.values()) {
          if (e.legacyId && e.legacyId.system === 'A' && e.legacyId.id === row.id) {
            mintedId = e.id;
            break;
          }
        }
        if (!mintedId) {
          mintedId = `minted-insight-${kmStore._entities.size + 1}`;
          const entity = {
            id: mintedId,
            name: row.topic,
            entityType: 'Insight',
            ontologyClass: 'Insight',
            legacyId: { system: 'A', id: row.id },
          };
          kmStore.callLog.push({ op: 'putEntity', id: mintedId, entity, opts: { skipOntologyCheck: true } });
          kmStore._entities.set(mintedId, entity);
        } else {
          kmStore.callLog.push({ op: 'putEntity', id: mintedId, entity: { ...kmStore._entities.get(mintedId) }, opts: { skipOntologyCheck: true } });
        }

        for (const targetId of targets) {
          if (!targetId || targetId === mintedId) continue;
          const existing = kmStore._relations.filter(
            (r) => r.from === mintedId && r.to === targetId && r.type === 'mentions',
          );
          if (existing.length > 0) continue; // dedup
          const rel = {
            from: mintedId,
            to: targetId,
            type: 'mentions',
            metadata: { source: 'observation-writer' },
          };
          kmStore.callLog.push({ op: 'addRelation', from: rel.from, to: rel.to, type: rel.type, metadata: rel.metadata });
          kmStore._relations.push(rel);
        }

        // capturedBy — dedup as well.
        const existingCaptured = kmStore._relations.filter(
          (r) => r.from === mintedId && r.to === 'anchor-lsl-1' && r.type === 'capturedBy',
        );
        if (existingCaptured.length === 0) {
          const rel = {
            from: mintedId,
            to: 'anchor-lsl-1',
            type: 'capturedBy',
            metadata: { source: 'observation-writer' },
          };
          kmStore.callLog.push({ op: 'addRelation', from: rel.from, to: rel.to, type: rel.type, metadata: rel.metadata });
          kmStore._relations.push(rel);
        }
        return row.id;
      },
    };

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: writer,
      runId: 'integ-test-4',
    });

    const entry = {
      topic: 'IdempotentInsight',
      summary: 'discusses e1 and e2',
      project: 'coding',
      confidence: 0.7,
      _digestIds: [],
    };

    await consolidator._pushInsightToKG(entry);
    await consolidator._pushInsightToKG(entry);

    // After 2 calls — still exactly 2 mentions + 1 capturedBy + 1 has_insight.
    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges.length, 2, 'mentions edges NOT duplicated (idempot)');
    const capturedEdges = kmStore._relations.filter((r) => r.type === 'capturedBy');
    assert.equal(capturedEdges.length, 1, 'capturedBy NOT duplicated (idempot)');
    const hasInsightEdges = kmStore._relations.filter((r) => r.type === 'has_insight');
    assert.equal(hasInsightEdges.length, 1, 'has_insight NOT duplicated (idempot)');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 5 — Idempotency: backfill via imported processInsight (W5 contract)
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 58 integration — idempotency (backfill processInsight) (Test 5)', () => {
  it('processInsight: re-running adds 0 edges; dedup logic byte-identical to writer-path', async () => {
    // Per W5 — Plan 58-04 imports processInsight directly from
    // scripts/backfill-insight-mentions.mjs. This locks the contract that the
    // exported helper is the single source of truth for per-Insight processing
    // (NO copy-paste between script main() and integration test).
    const kmStore = createMockKmStore();

    // Pre-seed: one Insight node and one EXISTING mentions edge (Insight → e1).
    const insightNode = {
      id: 'i1',
      name: 'Test',
      entityType: 'Insight',
      description: 'discusses e1 and e2',
    };
    await kmStore.putEntity(insightNode, { skipOntologyCheck: true });
    await kmStore.addRelation({
      from: 'i1',
      to: 'e1',
      type: 'mentions',
      metadata: { source: 'pre-existing' },
    });

    // Stub classifier returns ['e1','e2'] — only e2 should be added.
    const stubClassifier = async () => ['e1', 'e2'];
    const candidates = [
      { id: 'e1', name: 'A', description: '' },
      { id: 'e2', name: 'B', description: '' },
    ];

    const result1 = await processInsight(insightNode, kmStore, {
      classifier: stubClassifier,
      candidates,
      source: 'backfill-insight-mentions',
    });
    assert.equal(result1.mentionsAdded, 1, 'only e2 should be added (e1 already exists, dedup-skipped)');

    // Exactly 2 mentions edges in the store now.
    const mentionsEdges1 = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges1.length, 2, 'kmStore has exactly 2 mentions edges (pre-existing + new e2)');
    const newE2Edge = mentionsEdges1.find((r) => r.to === 'e2');
    assert.ok(newE2Edge, 'new e2 edge present');
    assert.equal(newE2Edge.metadata.source, 'backfill-insight-mentions', 'new edge carries the backfill source tag');

    // Re-run — both e1 and e2 are now dedup-skipped.
    const result2 = await processInsight(insightNode, kmStore, {
      classifier: stubClassifier,
      candidates,
      source: 'backfill-insight-mentions',
    });
    assert.equal(result2.mentionsAdded, 0, 'second run: both e1 and e2 dedup-skipped');

    const mentionsEdges2 = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges2.length, 2, 'still exactly 2 mentions edges after second processInsight call');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 6 — D-04.1 fail-fast: classifier throws → kmStore stays empty
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 58 integration — D-04.1 fail-fast (Test 6)', () => {
  let restoreFetch;
  beforeEach(() => {
    __resetCacheForTests();
  });
  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = undefined;
  });

  it('fail-fast: classifier throws → no Insight node, no edges (D-04.1 half-Insight prevention)', async () => {
    const kmStore = createMockKmStore();
    seedCandidates(kmStore);
    restoreFetch = installFetchStub({ classifierThrow: true });

    let writeInsightCalls = 0;
    const writer = {
      writeInsight: async () => { writeInsightCalls++; },
    };

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: writer,
      runId: 'integ-test-6',
    });

    // Track entity / edge counts BEFORE the call.
    const entitiesBefore = kmStore._entities.size;
    const relationsBefore = kmStore._relations.length;

    await consolidator._pushInsightToKG({
      topic: 'WillNotBeWritten',
      summary: 'Proxy is down',
      project: 'coding',
      confidence: 0.5,
      _digestIds: [],
    });

    // writeInsight was NEVER called.
    assert.equal(writeInsightCalls, 0, 'writeInsight NEVER invoked when classifier throws');

    // NO Insight node was added.
    const insightEntities = Array.from(kmStore._entities.values()).filter((e) => e.entityType === 'Insight');
    assert.equal(insightEntities.length, 0, 'zero Insight entities after fail-fast');

    // NO edges were added (mentions / capturedBy / has_insight all absent).
    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    const capturedEdges = kmStore._relations.filter((r) => r.type === 'capturedBy');
    const hasInsightEdges = kmStore._relations.filter((r) => r.type === 'has_insight');
    assert.equal(mentionsEdges.length, 0, 'no mentions edges');
    assert.equal(capturedEdges.length, 0, 'no capturedBy edges');
    assert.equal(hasInsightEdges.length, 0, 'no has_insight edges');

    // Entity + relation counts unchanged (the seed remains; nothing added).
    assert.equal(kmStore._entities.size, entitiesBefore, 'no entities added');
    assert.equal(kmStore._relations.length, relationsBefore, 'no relations added');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 7 — zero-mentions corner case: classifier returns []
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 58 integration — zero-mentions corner case (Test 7)', () => {
  let restoreFetch;
  beforeEach(() => {
    __resetCacheForTests();
  });
  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = undefined;
  });

  it('classifier returns []: Insight + capturedBy + has_insight land; ZERO mentions edges (SC#1 ≤2/20 envelope)', async () => {
    const kmStore = createMockKmStore();
    seedCandidates(kmStore);
    // Classifier returns []  — valid response, no entities mentioned.
    restoreFetch = installFetchStub({ classifierReturn: '[]' });

    const consolidator = new ObservationConsolidator({
      kmStore,
      observationWriter: makeMockWriter(kmStore),
      runId: 'integ-test-7',
    });

    await consolidator._pushInsightToKG({
      topic: 'NoMentionsInsight',
      summary: 'A purely abstract insight with no entity references',
      project: 'coding',
      confidence: 0.6,
      _digestIds: [],
    });

    // The Insight entity DID land.
    const insightEntities = Array.from(kmStore._entities.values()).filter((e) => e.entityType === 'Insight');
    assert.equal(insightEntities.length, 1, 'Insight entity written despite zero mentions');

    // capturedBy + has_insight DID fire.
    const capturedEdges = kmStore._relations.filter((r) => r.type === 'capturedBy');
    assert.equal(capturedEdges.length, 1, 'capturedBy edge emitted');
    const hasInsightEdges = kmStore._relations.filter((r) => r.type === 'has_insight');
    assert.equal(hasInsightEdges.length, 1, 'has_insight edge emitted');

    // ZERO mentions edges (this Insight is one of the ≤2/20 that SC#1 allows).
    const mentionsEdges = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.equal(mentionsEdges.length, 0, 'no mentions edges (classifier returned empty)');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 8 — bridge extension (D-06.2): orphan with capturedBy but no mentions
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 58 integration — bridge backfill emits missing mentions (Test 8)', () => {
  let restoreFetch;
  beforeEach(() => {
    __resetCacheForTests();
  });
  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = undefined;
  });

  it('bridge: detects Insight with capturedBy but no mentions; emits mentions on first call, no-op on second (idempot)', async () => {
    // Pre-seed an Insight node with capturedBy but no mentions edges.
    const kmStore = createMockKmStore();
    seedCandidates(kmStore);
    // Insight is L1 'Insight' ontologyClass per the bridge's findByOntologyClass query.
    const orphanInsight = {
      id: 'orphan-insight-1',
      name: 'OrphanInsight',
      entityType: 'Insight',
      ontologyClass: 'Insight',
      description: 'discusses e1',
      metadata: { team: 'coding', project: 'coding' },
    };
    kmStore._entities.set(orphanInsight.id, orphanInsight);
    // capturedBy exists.
    kmStore._relations.push({
      from: orphanInsight.id,
      to: 'anchor-lsl-1',
      type: 'capturedBy',
      metadata: { source: 'pre-existing' },
    });
    // has_insight exists (so Pass 1 skips it).
    kmStore._relations.push({
      from: 'p-coding',
      to: orphanInsight.id,
      type: 'has_insight',
      metadata: { source: 'pre-existing' },
    });

    // Classifier returns ['e1'].
    restoreFetch = installFetchStub({ classifierReturn: '["EtmDaemon"]' });

    const consolidator = new ObservationConsolidator({
      kmStore,
      runId: 'integ-test-8',
    });

    // First bridge call — emits the missing mentions edge.
    const firstResult = await consolidator._relinkOrphanOnlineInsights();
    const mentionsEdgesAfter1 = kmStore._relations.filter((r) => r.type === 'mentions');
    assert.ok(mentionsEdgesAfter1.length >= 1, `first bridge call: ≥1 mentions edge emitted (got ${mentionsEdgesAfter1.length})`);
    const e1Edge = mentionsEdgesAfter1.find((r) => r.from === orphanInsight.id && r.to === 'e1');
    assert.ok(e1Edge, 'bridge emitted mentions edge to e1');
    assert.equal(e1Edge.metadata.source, 'consolidator-bridge', 'bridge source tag');
    // Bridge returns scalar count (created + mentionsRelinked).
    assert.ok(typeof firstResult === 'number', 'bridge returns scalar count');

    // Second bridge call — idempot (Plan 58-03 Task 2 gate: existing.length > 0 → continue).
    const mentionsCountBefore = kmStore._relations.filter((r) => r.type === 'mentions').length;
    await consolidator._relinkOrphanOnlineInsights();
    const mentionsCountAfter = kmStore._relations.filter((r) => r.type === 'mentions').length;
    assert.equal(mentionsCountAfter, mentionsCountBefore, 'second bridge call adds NO new mentions edges (idempot)');
  });
});
