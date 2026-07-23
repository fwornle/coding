/**
 * tests/integration/retrieval-service.relevance-floor.test.js
 *
 * "High-quality data, or nothing" — verifies the retrieval quality gate added to
 * RetrievalService.retrieve():
 *
 *   1. Relevance floor: _applyTopicRelevance annotates every scored result with
 *      `_topicalOverlap` (substring + exact-token keyword overlap). retrieve()
 *      DROPS items whose overlap is 0 (the 0.30× "almost never relevant" band)
 *      rather than merely demoting them, so off-topic insights can't fill the
 *      budget. Unannotated items (no rrfScore / keyword-less query) are kept.
 *
 *   2. results_count is the SURVIVOR count (post-floor), not the raw candidate
 *      count — so the hooks' `results_count === 0` gate fires and injects nothing.
 *
 *   3. Working Memory scaffold is suppressed for EXPERIMENT cells (taskId contains
 *      '--') and included for interactive sessions (bare UUID) — but only when at
 *      least one relevant item survives.
 *
 * The heavy deps (fastembed + Qdrant + km-core freshness lookup) are stubbed on the
 * instance; the floor and WM-gating are pure post-fusion / assembly logic. Mirrors
 * the direct-method style of retrieval-service.freshness-rerank.km-core.test.js.
 *
 * Jest 29 ESM.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Suppress retrieval-service / working-memory stderr chatter during the run.
const origStderrWrite = process.stderr.write.bind(process.stderr);
let _quietStderr = false;
process.stderr.write = function quietWrap(chunk, ...rest) {
  if (
    _quietStderr &&
    typeof chunk === 'string' &&
    (chunk.startsWith('[RetrievalService]') || chunk.startsWith('[WorkingMemory]') || chunk.startsWith('[working-memory]'))
  ) {
    return true;
  }
  return origStderrWrite(chunk, ...rest);
};

describe('RetrievalService relevance floor + WM suppression (high-quality-or-nothing)', () => {
  let RetrievalService;
  let _applyTopicRelevanceDirect;
  let codingRoot;

  // Synthetic candidates as returned by _semanticSearch (pre-fusion), one per tier.
  const insight = (id, topic, summary) => ({
    id,
    tier: 'insights',
    payload: { topic, summary_preview: summary, confidence: 0.9, date: '2026-07-01T00:00:00.000Z' },
  });
  const digest = (id, theme, summary) => ({
    id,
    tier: 'digests',
    payload: { theme, summary_preview: summary, agents: '["claude"]', date: '2026-07-01T00:00:00.000Z' },
  });
  const observation = (id, summary) => ({
    id,
    tier: 'observations',
    payload: { agent: 'claude', summary_preview: summary, project: 'coding', date: '2026-07-01T00:00:00.000Z' },
  });

  // Build a fresh service with the heavy paths stubbed. `candidates` is what the
  // semantic search returns; keyword search returns []. Freshness rerank is a no-op
  // (no km-core). codingRoot points at a temp dir holding a STATE.md so working
  // memory has deterministic content for the non-experiment path.
  function makeService(candidates) {
    const svc = new RetrievalService({ codingRoot });
    svc._initialized = true; // skip fastembed/Qdrant warm-up
    svc.embeddingService = { embedOne: async () => new Array(384).fill(0.01) };
    svc._semanticSearch = async () => candidates.map((c) => ({ ...c, payload: { ...c.payload } }));
    svc._keywordSearch = () => [];
    svc._applyFreshnessRerank = async () => {}; // avoid km-core lookup
    return svc;
  }

  beforeAll(async () => {
    _quietStderr = true;
    const mod = await import('../../src/retrieval/retrieval-service.js');
    RetrievalService = mod.RetrievalService;

    // Temp coding root with STATE.md → parseStateFrontmatter yields a non-empty
    // Working Memory even when VKB (localhost:8080) is unreachable (fail-open).
    codingRoot = mkdtempSync(path.join(tmpdir(), 'floor-test-'));
    mkdirSync(path.join(codingRoot, '.planning'), { recursive: true });
    writeFileSync(
      path.join(codingRoot, '.planning', 'STATE.md'),
      '---\nmilestone: test-m\nmilestone_name: Test Milestone\nstatus: executing\n---\n### Blockers/Concerns\n- none\n',
    );

    // Grab _applyTopicRelevance off a throwaway instance for the pure annotation test.
    _applyTopicRelevanceDirect = (results, query) =>
      new RetrievalService({ codingRoot })._applyTopicRelevance(results, query);
  }, 30000);

  afterAll(() => {
    try { if (codingRoot) rmSync(codingRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    _quietStderr = false;
    process.stderr.write = origStderrWrite;
  });

  // ── 1. Pure annotation: _topicalOverlap reflects keyword overlap ──────────────
  test('_applyTopicRelevance annotates _topicalOverlap (0 for off-topic, >0 on-topic)', () => {
    const results = [
      { id: 'on', tier: 'insights', rrfScore: 1, payload: { topic: 'Knowledge Injection Quality', summary_preview: '' } },
      { id: 'off', tier: 'insights', rrfScore: 1, payload: { topic: 'ETM Singleton Stall Reclaim', summary_preview: 'unrelated daemon watchdog' } },
      { id: 'noscore', tier: 'insights', payload: { topic: 'Knowledge Injection Quality', summary_preview: '' } }, // no rrfScore
    ];
    _applyTopicRelevanceDirect(results, 'knowledge injection quality relevance floor');

    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId.on._topicalOverlap).toBeGreaterThan(0);
    expect(byId.off._topicalOverlap).toBe(0);
    expect(byId.noscore._topicalOverlap).toBeUndefined(); // skipped (no rrfScore) → kept by floor
  });

  // ── 2. Off-topic query → nothing injected (results_count 0, empty markdown) ───
  test('off-topic query drops all candidates → results_count 0, markdown "" (even interactive)', async () => {
    const svc = makeService([
      insight('a', 'ETM Singleton Stall Reclaim', 'daemon watchdog restart'),
      insight('b', 'Dashboard Drift Column Semantics', 'score column rationale'),
    ]);
    const res = await svc.retrieve('create fizzbuzz.mjs returning FizzBuzz for multiples of three and five', {
      taskId: '550e8400-e29b-41d4-a716-446655440000', // interactive UUID
    });
    expect(res.meta.results_count).toBe(0);
    expect(res.markdown).toBe('');
    expect(res.meta.working_memory_tokens).toBe(0);
  }, 30000);

  // ── 3. On-topic + interactive → survivor kept AND Working Memory present ───────
  test('on-topic interactive query keeps the survivor and injects Working Memory', async () => {
    const svc = makeService([
      insight('a', 'Knowledge Injection Quality', 'topic relevance floor and dedup for injected knowledge'),
      insight('b', 'ETM Singleton Stall Reclaim', 'daemon watchdog restart'), // off-topic → dropped
    ]);
    const res = await svc.retrieve('improve knowledge injection quality and relevance', {
      taskId: '550e8400-e29b-41d4-a716-446655440000', // interactive UUID
    });
    expect(res.meta.results_count).toBe(1);           // only the on-topic survivor
    expect(res.markdown).toContain('## Working Memory'); // scaffold present for interactive
    expect(res.markdown).toContain('Knowledge Injection Quality');
    expect(res.markdown).not.toContain('ETM Singleton'); // off-topic filtered out
    expect(res.meta.working_memory_tokens).toBeGreaterThan(0);
  }, 30000);

  // ── 4. On-topic + experiment cell → survivor kept but Working Memory suppressed ─
  test('on-topic experiment cell (taskId has "--") keeps survivor but suppresses Working Memory', async () => {
    const svc = makeService([
      insight('a', 'Knowledge Injection Quality', 'topic relevance floor and dedup for injected knowledge'),
    ]);
    const res = await svc.retrieve('improve knowledge injection quality and relevance', {
      taskId: 'compare-inject-v1--claude-sonnet--r0', // experiment cell id
    });
    expect(res.meta.results_count).toBe(1);
    expect(res.markdown).toContain('Knowledge Injection Quality'); // relevant insight still injected
    expect(res.markdown).not.toContain('## Working Memory');       // scaffold suppressed for experiments
    expect(res.meta.working_memory_tokens).toBe(0);
  }, 30000);

  // ── 4b. Experiment cell keeps curated tiers only (drops digests/observations) ──
  test('experiment cell injects insights/entities only — on-topic digests & observations are dropped', async () => {
    const svc = makeService([
      insight('a', 'Knowledge Injection Quality', 'topic relevance floor for injected knowledge'),
      digest('d', 'Knowledge Injection Session', 'worked on knowledge injection quality yesterday'), // on-topic but episodic
      observation('o', 'Intent: improve knowledge injection quality and relevance'),                  // on-topic but episodic
    ]);
    const res = await svc.retrieve('improve knowledge injection quality and relevance', {
      taskId: 'exp-inject--claude--r0',
    });
    expect(res.meta.results_count).toBe(1);            // only the insight survives the tier gate
    expect(res.markdown).toContain('Knowledge Injection Quality');
    expect(res.markdown).not.toContain('## Digests');
    expect(res.markdown).not.toContain('## Observations');
  }, 30000);

  // ── 4c. Interactive session keeps ALL tiers (tier gate is experiment-only) ─────
  test('interactive session retains digests & observations (tier gate does not apply)', async () => {
    const svc = makeService([
      insight('a', 'Knowledge Injection Quality', 'topic relevance floor for injected knowledge'),
      digest('d', 'Knowledge Injection Session', 'worked on knowledge injection quality yesterday'),
      observation('o', 'Intent: improve knowledge injection quality and relevance'),
    ]);
    const res = await svc.retrieve('improve knowledge injection quality and relevance', {
      taskId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(res.meta.results_count).toBe(3);            // all three tiers retained for interactive
    expect(res.markdown).toContain('## Working Memory');
  }, 30000);

  // ── 4d. Experiment-meta insight is excluded (measurement hygiene) ──────────────
  test('experiment cell excludes benchmark/harness self-reference → nothing for a benchmark task', async () => {
    const svc = makeService([
      insight('meta', 'compare-fizzbuzz Experiment — FizzBuzz Benchmark Artifact', 'controlled benchmark for cross-agent comparison'),
    ]);
    const res = await svc.retrieve('write a fizzbuzz function that returns Fizz Buzz FizzBuzz for multiples', {
      taskId: 'compare-fizzbuzz-v9--claude--r0',
    });
    expect(res.meta.results_count).toBe(0); // the only topical insight is experiment-meta → excluded
    expect(res.markdown).toBe('');
  }, 30000);

  // ── 5. Fizzbuzz experiment cell → truly nothing (the reported bug, end to end) ─
  test('fizzbuzz experiment cell → results_count 0 and empty markdown (no scaffold, no insights)', async () => {
    const svc = makeService([
      insight('a', 'ETM Singleton Stall Reclaim', 'daemon watchdog restart'),
      insight('b', 'LLM Proxy Bridge Flap', 'copilot http proxy watchdog'),
    ]);
    const res = await svc.retrieve('write a fizzbuzz function that returns Fizz Buzz FizzBuzz for multiples', {
      taskId: 'compare-fizzbuzz-v9--copilot-auto--r0',
    });
    expect(res.meta.results_count).toBe(0);
    expect(res.markdown).toBe('');
  }, 30000);
});
