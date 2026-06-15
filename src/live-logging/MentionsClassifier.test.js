/**
 * Unit tests for Phase 58 Plan 01 — MentionsClassifier.
 *
 * Locks D-02 / D-02.1 / D-02.2 / D-03 / D-04.1 behaviour:
 *   Test 1  — buildMentionsPrompt emits taskType + both candidate names + summary
 *   Test 2  — JSON-parse path returns ids for matching names
 *   Test 3  — Code-fence stripping (```json```) still parses
 *   Test 4  — Token-boundary fallback path rejects hallucinated near-misses
 *   Test 5  — Fully-hallucinated JSON input returns []
 *   Test 6  — SANITY_CAP clamps 50-element response to 20 ids
 *   Test 7  — Dedup: repeated names → single id
 *   Test 8  — loadMentionCandidates fetches 3 ontology classes + caches per kmStore
 *   Test 9  — classifyMentions wires fetch + body taskType correctly
 *   Test 10 — classifyMentions throws Error containing '500' on non-2xx (D-04.1)
 *
 * Test framework: node:test + node:assert/strict (matches scripts/
 * backfill-project-tag.test.mjs convention — "no new deps" per CLAUDE.md).
 *
 * Run via: node --test src/live-logging/MentionsClassifier.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadMentionCandidates,
  buildMentionsPrompt,
  extractMentionsFromLLMResponse,
  classifyMentions,
  __resetCacheForTests,
} from './MentionsClassifier.js';

// ---------------------------------------------------------------------------
// Shared fixture: two-candidate catalog used by extract* + classify* tests.
// ---------------------------------------------------------------------------

const CANDIDATES = [
  { id: 'i1', name: 'EtmDaemon', description: 'desc-etm' },
  { id: 'i2', name: 'LiveLoggingSystem', description: 'desc-lsl' },
];

// ---------------------------------------------------------------------------
// Helper: build a stub kmStore whose findByOntologyClass returns fixtures
// per L1 class and counts invocations on a shared spy counter.
// ---------------------------------------------------------------------------

function buildStubKmStore(spy) {
  const fixturesByClass = {
    Component: [{ id: 'c1', name: 'LiveLoggingSystem', description: 'desc-lsl' }],
    SubComponent: [{ id: 's1', name: 'EtmDaemon', description: 'desc-etm' }],
    Detail: [{ id: 'd1', name: 'AnchorEdgeWriter', description: 'desc-anchor' }],
  };
  return {
    findByOntologyClass: async (cls) => {
      spy.count += 1;
      return fixturesByClass[cls] ?? [];
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: install/uninstall a fetch stub that records the last URL + body.
// ---------------------------------------------------------------------------

let originalFetch;

function installFetchStub(makeResponse) {
  originalFetch = globalThis.fetch;
  const record = { lastUrl: null, lastBody: null, calls: 0 };
  globalThis.fetch = async (url, init) => {
    record.calls += 1;
    record.lastUrl = url;
    record.lastBody = init && init.body ? JSON.parse(init.body) : null;
    return makeResponse(record);
  };
  return record;
}

function restoreFetch() {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = undefined;
}

// ---------------------------------------------------------------------------

describe('MentionsClassifier — buildMentionsPrompt', () => {
  it('Test 1: emits taskType + both candidate names + Insight summary', () => {
    const body = buildMentionsPrompt('summary text', CANDIDATES);
    assert.equal(body.taskType, 'mentions-classification');
    assert.equal(body.process, 'consolidator-mentions');
    assert.ok(Array.isArray(body.messages));
    assert.equal(body.messages.length, 2);

    const systemMessage = body.messages.find((m) => m.role === 'system');
    const userMessage = body.messages.find((m) => m.role === 'user');
    assert.ok(systemMessage, 'system message present');
    assert.ok(userMessage, 'user message present');

    assert.match(systemMessage.content, /EtmDaemon/);
    assert.match(systemMessage.content, /LiveLoggingSystem/);
    assert.match(userMessage.content, /summary text/);
  });
});

describe('MentionsClassifier — extractMentionsFromLLMResponse', () => {
  it('Test 2: JSON-parse path returns ids for matching names', () => {
    const ids = extractMentionsFromLLMResponse('["EtmDaemon","LiveLoggingSystem"]', CANDIDATES);
    assert.deepEqual(ids, ['i1', 'i2']);
  });

  it('Test 3: strips ```json``` code fences before JSON.parse', () => {
    const ids = extractMentionsFromLLMResponse('```json\n["EtmDaemon"]\n```', CANDIDATES);
    assert.deepEqual(ids, ['i1']);
  });

  it('Test 4: token-boundary fallback path rejects hallucinated near-miss FabricatedNameXYZ', () => {
    const raw = 'not json — EtmDaemon was mentioned, also FabricatedNameXYZ';
    const ids = extractMentionsFromLLMResponse(raw, CANDIDATES);
    assert.deepEqual(ids, ['i1']);
  });

  it('Test 5: all-hallucinated JSON input → empty array (D-02.1)', () => {
    const ids = extractMentionsFromLLMResponse('["FabricatedNameXYZ","AnotherFakeName"]', CANDIDATES);
    assert.deepEqual(ids, []);
  });

  it('Test 6: SANITY_CAP clamps 50-element response to 20 ids (D-02.2)', () => {
    // Build a 50-candidate catalog of valid (closed-set) names + a 50-name response.
    const fifty = Array.from({ length: 50 }, (_, k) => ({
      id: `id-${k}`,
      name: `Candidate${k}`,
      description: `desc-${k}`,
    }));
    const responseArray = fifty.map((c) => c.name);
    const ids = extractMentionsFromLLMResponse(JSON.stringify(responseArray), fifty);
    assert.equal(ids.length, 20, 'sanity cap clamps to 20 ids');
    // Order preserved + ids drawn from the front of the catalog.
    assert.deepEqual(ids, fifty.slice(0, 20).map((c) => c.id));
  });

  it('Test 7: dedup — repeated name yields single id', () => {
    const ids = extractMentionsFromLLMResponse('["EtmDaemon","EtmDaemon","EtmDaemon"]', CANDIDATES);
    assert.deepEqual(ids, ['i1']);
  });
});

describe('MentionsClassifier — loadMentionCandidates', () => {
  beforeEach(() => {
    __resetCacheForTests();
  });

  it('Test 8: fetches Component/SubComponent/Detail and caches per kmStore', async () => {
    const spy = { count: 0 };
    const kmStore = buildStubKmStore(spy);

    const first = await loadMentionCandidates(kmStore);
    assert.equal(spy.count, 3, 'first call invokes findByOntologyClass exactly 3 times');
    assert.equal(first.length, 3, 'flat array of 3 candidates (1 per class)');
    const names = first.map((c) => c.name).sort();
    assert.deepEqual(names, ['AnchorEdgeWriter', 'EtmDaemon', 'LiveLoggingSystem']);
    // Each item carries {id, name, description}.
    for (const c of first) {
      assert.equal(typeof c.id, 'string');
      assert.equal(typeof c.name, 'string');
      assert.equal(typeof c.description, 'string');
    }

    // Second call on the same store hits the cache — counter unchanged.
    const second = await loadMentionCandidates(kmStore);
    assert.equal(spy.count, 3, 'cached call does NOT re-invoke findByOntologyClass');
    assert.equal(second, first, 'cached call returns the same array reference');

    // After cache reset, a second call MUST re-invoke findByOntologyClass.
    __resetCacheForTests();
    await loadMentionCandidates(kmStore);
    assert.equal(spy.count, 6, 'after __resetCacheForTests, third call re-invokes 3 more times');
  });
});

describe('MentionsClassifier — classifyMentions (orchestrator)', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('Test 9: wires fetch against /api/complete with taskType in the body', async () => {
    const record = installFetchStub(() => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: '["EtmDaemon"]', provider: 'copilot', model: 'claude-haiku', tokens: 0, latencyMs: 0 }),
      text: async () => '',
    }));

    const ids = await classifyMentions('I changed the EtmDaemon writer', CANDIDATES);
    assert.deepEqual(ids, ['i1']);
    assert.equal(record.calls, 1);
    assert.match(String(record.lastUrl), /\/api\/complete$/, 'URL must end in /api/complete');
    assert.equal(record.lastBody.taskType, 'mentions-classification', 'body taskType routes to claude-haiku');
    assert.ok(Array.isArray(record.lastBody.messages), 'body has messages array');
  });

  it('Test 10: throws Error containing "500" on non-2xx (D-04.1 fail-fast)', async () => {
    installFetchStub(() => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
      text: async () => 'upstream LLM unavailable',
    }));

    await assert.rejects(
      () => classifyMentions('any summary', CANDIDATES),
      (err) => {
        assert.ok(err instanceof Error, 'rejects with an Error');
        assert.match(err.message, /500/, 'error message includes the HTTP status code');
        return true;
      },
    );
  });
});
