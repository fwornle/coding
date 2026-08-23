/**
 * tests/integration/retrieval-service.selection-trace.test.js
 *
 * The selection FUNNEL — the answer to "why was this injected, and why was nothing
 * else?". retrieve() runs several filter/rerank stages and used to persist only the
 * survivors, so a highly-ranked item could vanish with no record of whether it lost to
 * the IDF floor, the LLM judge, a tier cap, a duplicate, or the token budget.
 *
 * `trace` is purely ADDITIVE: every existing field of the retrieve() response is
 * unchanged, so retrieval-client.js and all four agent adapters are unaffected. The
 * tests below therefore assert both the new trace AND that the old contract holds.
 *
 * Stubbing mirrors retrieval-service.relevance-floor.test.js (fastembed, Qdrant and the
 * km-core freshness lookup are all replaced on the instance).
 *
 * Jest 29 ESM.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assembleBudgetedMarkdown } from '../../src/retrieval/token-budget.js';
import { judgeRelevance, _clearJudgeCache } from '../../src/retrieval/relevance-judge.js';

// Suppress retrieval-service / working-memory stderr chatter during the run.
const origStderrWrite = process.stderr.write.bind(process.stderr);
let _quietStderr = false;
process.stderr.write = function quietWrap(chunk, ...rest) {
  if (
    _quietStderr &&
    typeof chunk === 'string' &&
    (chunk.startsWith('[RetrievalService]') || chunk.startsWith('[WorkingMemory]') ||
      chunk.startsWith('[working-memory]') || chunk.startsWith('[relevance-judge]'))
  ) {
    return true;
  }
  return origStderrWrite(chunk, ...rest);
};

describe('retrieve() selection trace (the drop-off funnel)', () => {
  let RetrievalService;
  let codingRoot;

  const insight = (id, topic, summary) => ({
    id,
    tier: 'insights',
    payload: { topic, summary_preview: summary, confidence: 0.9, date: '2026-07-01T00:00:00.000Z' },
  });
  const observation = (id, summary) => ({
    id,
    tier: 'observations',
    payload: { agent: 'claude', summary_preview: summary, project: 'coding', date: '2026-07-01T00:00:00.000Z' },
  });

  function makeService(candidates, judge = async (_q, cands) => cands) {
    const svc = new RetrievalService({ codingRoot, judge });
    svc._initialized = true;
    svc.embeddingService = { embedOne: async () => new Array(384).fill(0.01) };
    svc._semanticSearch = async () => candidates.map((c) => ({ ...c, payload: { ...c.payload } }));
    svc._keywordSearch = () => [];
    svc._applyFreshnessRerank = async () => {};
    return svc;
  }

  const stageNamed = (trace, name) => trace.stages.find((s) => s.name === name);

  beforeAll(async () => {
    _quietStderr = true;
    ({ RetrievalService } = await import('../../src/retrieval/retrieval-service.js'));
    codingRoot = mkdtempSync(path.join(tmpdir(), 'trace-test-'));
    mkdirSync(path.join(codingRoot, '.planning'), { recursive: true });
    writeFileSync(
      path.join(codingRoot, '.planning', 'STATE.md'),
      '---\nmilestone: test-m\nmilestone_name: Test Milestone\nstatus: executing\n---\n### Blockers/Concerns\n- none\n',
    );
  }, 30000);

  afterAll(() => {
    try { if (codingRoot) rmSync(codingRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    _quietStderr = false;
    process.stderr.write = origStderrWrite;
  });

  // ── 1. Every stage reconciles: nothing vanishes unexplained ────────────────────
  test('each stage accounts for every candidate it received (in === out + dropped)', async () => {
    const svc = makeService([
      insight('on-1', 'Knowledge Injection Quality Gate', 'retrieval budget and the relevance floor'),
      insight('on-2', 'Knowledge Injection Architecture', 'per-turn hook injection budget'),
      insight('off-1', 'Statusline Emoji Width', 'tmux codepoint widths and padding'),
      observation('off-2', 'unrelated daemon watchdog restart'),
    ]);

    const { trace } = await svc.retrieve('knowledge injection budget relevance', { taskId: 'sess-a' });

    expect(trace).toBeTruthy();
    expect(trace.stages.length).toBeGreaterThan(0);
    for (const s of trace.stages) {
      // `dropped_total` is exact; `dropped` is a capped sample of it (see
      // TRACE_MAX_DROPPED). Reconciliation is asserted against the total so a
      // truncated sample can never be mistaken for a complete one.
      expect(s.out + s.dropped_total).toBe(s.in);
      expect(s.dropped.length).toBeLessThanOrEqual(s.dropped_total);
    }
    // Stages chain: each stage's input is the previous stage's output.
    for (let i = 1; i < trace.stages.length; i += 1) {
      expect(trace.stages[i].in).toBe(trace.stages[i - 1].out);
    }
    // And the funnel ends where the injected set begins.
    expect(trace.stages[trace.stages.length - 1].out).toBe(trace.injected);
  });

  // ── 2. The IDF floor names its casualties ─────────────────────────────────────
  test('off-topic candidates appear in the idf-floor stage with a recognisable title', async () => {
    const svc = makeService([
      insight('on-1', 'Knowledge Injection Quality Gate', 'retrieval budget and the relevance floor'),
      insight('off-1', 'Statusline Emoji Width', 'tmux codepoint widths and padding'),
    ]);

    const { trace } = await svc.retrieve('knowledge injection budget relevance', { taskId: 'sess-b' });

    const floor = stageNamed(trace, 'idf-floor');
    expect(floor).toBeTruthy();
    const droppedIds = floor.dropped.map((d) => d.id);
    expect(droppedIds).toContain('off-1');
    expect(droppedIds).not.toContain('on-1');
    // A dropped entry must be identifiable in the UI without a second lookup.
    const off = floor.dropped.find((d) => d.id === 'off-1');
    expect(off.title).toBe('Statusline Emoji Width');
    expect(off.tier).toBe('insights');
  });

  // ── 3. Judge rejections are attributed to the judge, not to "it just wasn't there"
  test('judge rejections land in the judge stage and carry its outcome', async () => {
    const rejectAll = async () => [];
    const svc = makeService([
      insight('on-1', 'Knowledge Injection Quality Gate', 'retrieval budget and the relevance floor'),
      insight('on-2', 'Knowledge Injection Architecture', 'per-turn hook injection budget'),
    ], rejectAll);

    const { items, trace } = await svc.retrieve('knowledge injection budget relevance', { taskId: 'sess-c' });

    expect(items).toHaveLength(0);
    const judge = stageNamed(trace, 'judge');
    expect(judge.in).toBeGreaterThan(0);
    expect(judge.out).toBe(0);
    expect(judge.dropped.map((d) => d.id).sort()).toEqual(['on-1', 'on-2']);
    expect(trace.injected).toBe(0);
  });

  // ── 4. THE case the old capture threw away: nothing injected, fully explained ──
  test('a zero-injection turn still produces a trace that says which stage emptied it', async () => {
    const svc = makeService([
      insight('off-1', 'Statusline Emoji Width', 'tmux codepoint widths and padding'),
      insight('off-2', 'SSH GitHub via 443', 'IdentitiesOnly and the BMW key'),
    ]);

    const { items, markdown, trace } = await svc.retrieve('knowledge injection budget relevance', { taskId: 'sess-d' });

    expect(items).toHaveLength(0);
    expect(markdown).toBe('');           // existing contract: hooks gate on this
    expect(trace.injected).toBe(0);
    // The trace must attribute the emptiness, not merely report it.
    const emptiedAt = trace.stages.find((s) => s.in > 0 && s.out === 0);
    expect(emptiedAt).toBeTruthy();
    expect(emptiedAt.name).toBe('idf-floor');
    expect(emptiedAt.dropped).toHaveLength(2);
  });

  // ── 5. Experiment cells: the tier gate is a distinct, named stage ─────────────
  // Stage renamed 'experiment-tier-gate' -> 'tier-gate' on 2026-08-23, when the gate stopped
  // being experiment-only. The dashboard funnel keys its labels on the stage name and still
  // carries the legacy key so archived captures render, but new traces emit the new one.
  test('the curated-tier gate is recorded separately from the floor', async () => {
    const svc = makeService([
      insight('keep', 'Knowledge Injection Quality Gate', 'retrieval budget and the relevance floor'),
      observation('drop', 'knowledge injection budget relevance floor session log'),
    ]);

    const { trace } = await svc.retrieve('knowledge injection budget relevance', {
      taskId: 'exp-x--claude-straight-kb-on--r0',
    });

    const gate = stageNamed(trace, 'tier-gate');
    expect(gate).toBeTruthy();
    expect(gate.dropped.map((d) => d.id)).toContain('drop');
    expect(trace.working_memory_included).toBe(false); // WM stays suppressed for cells
  });

  // ── 6. Trace is additive — the pre-existing response contract is untouched ────
  test('adding the trace does not change any existing response field', async () => {
    const svc = makeService([
      insight('on-1', 'Knowledge Injection Quality Gate', 'retrieval budget and the relevance floor'),
    ]);

    const res = await svc.retrieve('knowledge injection budget relevance', { taskId: 'sess-e' });

    expect(typeof res.markdown).toBe('string');
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.meta).toEqual(expect.objectContaining({
      query: 'knowledge injection budget relevance',
      budget: expect.any(Number),
      results_count: expect.any(Number),
      tokens_used: expect.any(Number),
      working_memory_tokens: expect.any(Number),
      latency_ms: expect.any(Number),
    }));
    expect(res.meta.results_count).toBe(res.items.length);
  });
});

describe('assembleBudgetedMarkdown reports what it dropped, and why', () => {
  const insight = (id, topic, summary) => ({
    id, tier: 'insights', rrfScore: 1,
    payload: { topic, summary_preview: summary, confidence: 0.9, date: '2026-07-01T00:00:00.000Z' },
  });

  test('every input is either injected or skipped with a reason', () => {
    const results = Array.from({ length: 8 }, (_, i) =>
      insight(`i${i}`, `Distinct Topic ${i}`, `body text number ${i} `.repeat(4)));

    const { items, skipped } = assembleBudgetedMarkdown(results, 700);

    expect(items.length + skipped.length).toBe(results.length);
    for (const s of skipped) expect(['tier-cap', 'dedup', 'budget']).toContain(s.reason);
  });

  test('tier caps are distinguishable from budget exhaustion', () => {
    // 6 insights against a cap of 4 and a budget far too large to bind: the two
    // beyond the cap must read 'tier-cap', never the catch-all 'budget'.
    const results = Array.from({ length: 6 }, (_, i) =>
      insight(`i${i}`, `Distinct Topic ${i}`, `short body ${i}`));

    const { skipped } = assembleBudgetedMarkdown(results, 100000);

    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((s) => s.reason === 'tier-cap')).toBe(true);
  });

  test('near-identical summaries are attributed to dedup', () => {
    const body = 'the retrieval budget is enforced with gpt-tokenizer and truncates progressively';
    const { skipped } = assembleBudgetedMarkdown([
      insight('a', 'OKB Architecture', body),
      insight('b', 'Operational Knowledge Base (OKB) Architecture', body),
    ], 100000);

    expect(skipped.map((s) => s.reason)).toContain('dedup');
  });

  test('the tail lost to the token budget is recorded, not silently truncated', () => {
    // Bodies large enough that the budget binds well before the tier cap. The
    // discriminator must lead: contentSignature fingerprints the FIRST 120 chars, so a
    // trailing index would make these four read as duplicates and they would be
    // dropped as 'dedup' long before the budget was ever consulted.
    const results = Array.from({ length: 4 }, (_, i) =>
      insight(`i${i}`, `Distinct Topic ${i}`, `body ${i} ${`unique-${i} filler content `.repeat(60)}`));

    const { items, skipped } = assembleBudgetedMarkdown(results, 200);

    expect(items.length).toBeLessThan(results.length);
    expect(skipped.some((s) => s.reason === 'budget')).toBe(true);
    expect(items.length + skipped.length).toBe(results.length);
  });
});

describe('judgeRelevance onTrace (observability without changing the verdict)', () => {
  const cand = (id) => ({ id, payload: { topic: `Topic ${id}` } });
  const okResponse = (useful) => async () => ({
    ok: true,
    json: async () => ({ content: JSON.stringify({ useful }) }),
  });

  beforeEach(() => _clearJudgeCache());

  test('reports outcome "judged" with the kept/dropped split', async () => {
    const seen = [];
    const kept = await judgeRelevance('q', [cand('a'), cand('b'), cand('c')], {
      fetchImpl: okResponse(['a']),
      onTrace: (i) => seen.push(i),
    });

    expect(kept.map((c) => c.id)).toEqual(['a']);
    expect(seen).toHaveLength(1);
    expect(seen[0].outcome).toBe('judged');
    expect(seen[0].keptIds).toEqual(['a']);
    expect(seen[0].droppedIds.sort()).toEqual(['b', 'c']);
  });

  test('distinguishes fail-open from fail-closed', async () => {
    const boom = async () => { throw new Error('proxy down'); };

    const openSeen = [];
    const openKept = await judgeRelevance('q', [cand('a')], { fetchImpl: boom, onTrace: (i) => openSeen.push(i) });
    expect(openSeen[0].outcome).toBe('fail-open');
    expect(openKept).toHaveLength(1); // degraded to the heuristic set

    const closedSeen = [];
    const closedKept = await judgeRelevance('q2', [cand('a')], {
      fetchImpl: boom, failClosed: true, onTrace: (i) => closedSeen.push(i),
    });
    expect(closedSeen[0].outcome).toBe('fail-closed');
    expect(closedKept).toHaveLength(0);
  });

  test('reports a cache hit rather than pretending the model was consulted', async () => {
    let calls = 0;
    const counting = async (...args) => { calls += 1; return okResponse(['a'])(...args); };

    await judgeRelevance('q', [cand('a'), cand('b')], { fetchImpl: counting });
    const seen = [];
    await judgeRelevance('q', [cand('a'), cand('b')], { fetchImpl: counting, onTrace: (i) => seen.push(i) });

    expect(calls).toBe(1);
    expect(seen[0].outcome).toBe('cache');
    expect(seen[0].keptIds).toEqual(['a']);
  });

  test('a throwing onTrace never breaks the judge', async () => {
    const kept = await judgeRelevance('q', [cand('a'), cand('b')], {
      fetchImpl: okResponse(['a']),
      onTrace: () => { throw new Error('sink exploded'); },
    });
    expect(kept.map((c) => c.id)).toEqual(['a']);
  });
});

describe('trace size is bounded without ever misreporting the count', () => {
  let RetrievalService;
  let codingRoot;

  const insight = (id, topic, summary) => ({
    id, tier: 'insights',
    payload: { topic, summary_preview: summary, confidence: 0.9, date: '2026-07-01T00:00:00.000Z' },
  });

  beforeAll(async () => {
    _quietStderr = true;
    ({ RetrievalService } = await import('../../src/retrieval/retrieval-service.js'));
    codingRoot = mkdtempSync(path.join(tmpdir(), 'trace-cap-'));
    mkdirSync(path.join(codingRoot, '.planning'), { recursive: true });
    writeFileSync(path.join(codingRoot, '.planning', 'STATE.md'), '---\nmilestone: m\nstatus: executing\n---\n');
  }, 30000);

  afterAll(() => {
    try { if (codingRoot) rmSync(codingRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    _quietStderr = false;
  });

  test('a stage dropping 50 names at most 12 of them but reports all 50', async () => {
    // 50 candidates that share no discriminating word with the query → all hit the floor.
    const candidates = Array.from({ length: 50 }, (_, i) =>
      insight(`off-${i}`, `Statusline Emoji Width ${i}`, 'tmux codepoint widths and padding'));
    const svc = new RetrievalService({ codingRoot, judge: async (_q, c) => c });
    svc._initialized = true;
    svc.embeddingService = { embedOne: async () => new Array(384).fill(0.01) };
    svc._semanticSearch = async () => candidates.map((c) => ({ ...c, payload: { ...c.payload } }));
    svc._keywordSearch = () => [];
    svc._applyFreshnessRerank = async () => {};

    const { trace } = await svc.retrieve('knowledge injection budget relevance', { taskId: 'sess-cap' });

    const floor = trace.stages.find((s) => s.name === 'idf-floor');
    expect(floor.dropped_total).toBe(50);
    expect(floor.dropped.length).toBe(12);
    expect(floor.in).toBe(50);
    expect(floor.out).toBe(0);
  });

  test('the named drops are the highest-ranked ones (the near-misses)', async () => {
    const ranked = Array.from({ length: 30 }, (_, i) => ({
      ...insight(`off-${i}`, `Statusline Emoji Width ${i}`, 'tmux codepoint widths'),
    }));
    const svc = new RetrievalService({ codingRoot, judge: async (_q, c) => c });
    svc._initialized = true;
    svc.embeddingService = { embedOne: async () => new Array(384).fill(0.01) };
    // Descending cosine → descending rrfScore after fusion.
    svc._semanticSearch = async () => ranked.map((c, i) => ({ ...c, score: 1 - i * 0.01, payload: { ...c.payload } }));
    svc._keywordSearch = () => [];
    svc._applyFreshnessRerank = async () => {};

    const { trace } = await svc.retrieve('knowledge injection budget relevance', { taskId: 'sess-rank' });

    const floor = trace.stages.find((s) => s.name === 'idf-floor');
    const scores = floor.dropped.map((d) => d.rrfScore ?? -Infinity);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores); // already descending
  });
});
