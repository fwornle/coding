/**
 * T6 acceptance: insight injection never crosses teams.
 *
 * Fixtures in two teams — `raas` (repos raas-api, raas-ui) and `coding` — on
 * every source retrieve() reads: the four Qdrant collections, the keyword
 * search, and the knowledge graph Working Memory is built from. The Qdrant
 * stub IGNORES the filter it is given (the worst case: an old server, a
 * missing index), so the hard post-filter is what is under test as well as
 * the filter request itself.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function quiet(chunk, ...rest) {
  if (typeof chunk === 'string' && /^\[(RetrievalService|WorkingMemory|working-memory)\]/.test(chunk)) return true;
  return origStderrWrite(chunk, ...rest);
};

describe('retrieve() with a team selection', () => {
  let RetrievalService;
  let projectsOfTeams;
  let codingRoot;

  const teamsDoc = {
    active: [],
    teams: {
      raas: { id: 'raas', repos: [], include: ['raas-*'] },
      coding: { id: 'coding', repos: [], include: [] },
    },
  };
  const repos = [{ path: '/w/raas-api' }, { path: '/w/raas-ui' }, { path: '/w/coding' }];

  // Same wording on both sides, so only the filter can tell them apart.
  const text = (team) => `retry with exponential backoff for flaky upstream calls (${team})`;
  const points = {
    insights: [
      { id: 'i-raas', score: 0.9, payload: { topic: 'retry backoff upstream', summary_preview: text('raas-api'), project: 'raas-api', confidence: 0.9 } },
      { id: 'i-coding', score: 0.95, payload: { topic: 'retry backoff upstream', summary_preview: text('coding'), project: 'coding', confidence: 0.9 } },
    ],
    digests: [
      { id: 'd-raas', score: 0.85, payload: { theme: 'retry backoff upstream', summary_preview: text('RAAS-UI'), project: 'RAAS-UI' } },
      { id: 'd-coding', score: 0.88, payload: { theme: 'retry backoff upstream', summary_preview: text('coding'), project: 'coding' } },
    ],
    kg_entities: [
      { id: 'k-coding', score: 0.9, payload: { entityType: 'Detail', summary_preview: text('coding'), project: 'coding' } },
      { id: 'k-none', score: 0.9, payload: { entityType: 'Detail', summary_preview: text('untagged') } },
    ],
    observations: [
      { id: 'o-raas', score: 0.8, payload: { agent: 'claude', summary_preview: text('raas-api'), project: 'raas-api' } },
      { id: 'o-coding', score: 0.8, payload: { agent: 'claude', summary_preview: text('coding'), project: 'coding' } },
    ],
  };

  const graphStore = {
    findByOntologyClass: async (cls) => [
      { name: 'raas', ontologyClass: 'Project', metadata: { project: 'raas-api' } },
      { name: 'coding', ontologyClass: 'Project', metadata: { project: 'coding' } },
      { name: 'JobScheduler', ontologyClass: 'Component', description: 'raas job scheduling', metadata: { project: 'raas-api' } },
      { name: 'LiveLoggingSystem', ontologyClass: 'Component', description: 'coding live logging', metadata: { project: 'coding' } },
    ].filter((e) => e.ontologyClass === cls),
  };

  let filters;
  function makeService() {
    filters = [];
    const svc = new RetrievalService({ codingRoot, judge: async (_q, c) => c, kmStoreGetter: () => graphStore });
    svc._initialized = true;
    svc.embeddingService = { embedOne: async () => new Array(384).fill(0.01) };
    svc.qdrantClient = {
      search: async (collection, opts) => {
        filters.push({ collection, filter: opts.filter });
        return (points[collection] || []).map((p) => ({ ...p, payload: { ...p.payload } }));
      },
    };
    svc._keywordSearch = () => [
      { id: 'kw-insights-x', tier: 'insights', tierWeight: 1, project: 'coding', topic: 'retry backoff upstream', summary_preview: text('coding') },
    ];
    svc._applyFreshnessRerank = async () => {};
    return svc;
  }

  const projectOfItem = (it) => String(it.payload?.project ?? it.project ?? '').toLowerCase();

  beforeAll(async () => {
    ({ RetrievalService } = await import('../../src/retrieval/retrieval-service.js'));
    ({ projectsOfTeams } = await import('../../lib/teams/scope.mjs'));
    codingRoot = mkdtempSync(path.join(tmpdir(), 'team-filter-'));
    mkdirSync(path.join(codingRoot, '.planning'), { recursive: true });
  });
  afterAll(() => rmSync(codingRoot, { recursive: true, force: true }));

  test('team raas: only raas-api / raas-ui knowledge, on every source', async () => {
    const projects = [...projectsOfTeams(['raas'], { teamsDoc, repos }).projects];
    expect(projects.sort()).toEqual(['raas-api', 'raas-ui']);
    const svc = makeService();
    const res = await svc.retrieve('retry with exponential backoff for flaky upstream calls', {
      budget: 3000, threshold: 0.1, context: { agent: 'claude' }, teams: ['raas'], projects,
    });

    expect(res.items.length).toBeGreaterThan(0);
    for (const it of res.items) expect(['raas-api', 'raas-ui']).toContain(projectOfItem(it));
    expect(res.markdown).not.toMatch(/\(coding\)|\(untagged\)/);
    // Working Memory: the team's components only.
    expect(res.markdown).not.toMatch(/LiveLoggingSystem/);
    // Every collection was asked to filter, both spellings offered.
    expect(filters).toHaveLength(4);
    for (const { filter } of filters) {
      expect(filter.must[0].key).toBe('project');
      expect(filter.must[0].match.any).toEqual(expect.arrayContaining(['raas-api', 'raas-ui']));
    }
    expect(res.meta.teams).toEqual(['raas']);
  });

  test('team coding: zero raas results, and the untagged point is out too', async () => {
    const projects = [...projectsOfTeams(['coding'], { teamsDoc, repos }).projects];
    const svc = makeService();
    const res = await svc.retrieve('retry with exponential backoff for flaky upstream calls', {
      budget: 3000, threshold: 0.1, context: { agent: 'claude' }, teams: ['coding'], projects,
    });
    expect(res.items.length).toBeGreaterThan(0);
    for (const it of res.items) expect(projectOfItem(it)).toBe('coding');
    expect(res.markdown).not.toMatch(/raas|untagged/i);
  });

  test('Working Memory reads STATE.md from the session\'s repo, not the tools repo', async () => {
    writeFileSync(path.join(codingRoot, '.planning', 'STATE.md'), '---\nmilestone: tools-milestone\nstatus: executing\n---\n');
    const other = mkdtempSync(path.join(tmpdir(), 'team-filter-repo-'));
    try {
      mkdirSync(path.join(other, '.git'));
      mkdirSync(path.join(other, '.planning'));
      writeFileSync(path.join(other, '.planning', 'STATE.md'), '---\nmilestone: own-milestone\nstatus: executing\n---\n');
      const ask = (cwd) => makeService().retrieve('retry with exponential backoff for flaky upstream calls', {
        budget: 3000, threshold: 0.1, context: { agent: 'claude', ...(cwd ? { cwd } : {}) },
      });
      const own = await ask(path.join(other, '.planning'));
      expect(own.markdown).toMatch(/own-milestone/);
      expect(own.markdown).not.toMatch(/tools-milestone/);
      expect((await ask(tmpdir())).markdown).not.toMatch(/-milestone/);
      expect((await ask(null)).markdown).toMatch(/tools-milestone/);
    } finally {
      rmSync(other, { recursive: true, force: true });
      rmSync(path.join(codingRoot, '.planning', 'STATE.md'), { force: true });
    }
  });

  test('Qdrant down: keyword search over the store still injects, and stays in the team', async () => {
    const { default: Graph } = await import('graphology');
    const graph = new Graph();
    const add = (id, topic, project) => graph.addNode(id, {
      id, name: topic, entityType: 'Insight', updatedAt: '2026-10-01T00:00:00Z',
      metadata: { topic, summary: `${topic}: retry with exponential backoff for flaky upstream calls`, confidence: 0.9, project },
    });
    add('ins-raas', 'Upstream retry backoff (raas)', 'raas-api');
    add('ins-coding', 'Upstream retry backoff (coding)', 'coding');
    const svc = new RetrievalService({ codingRoot, judge: async (_q, c) => c, kmStoreGetter: () => ({ ...graphStore, graph }) });
    svc._initialized = true;
    svc.embeddingService = { embedOne: async () => new Array(384).fill(0.01) };
    svc.qdrantClient = { search: async () => { throw new Error('fetch failed'); } };
    svc._applyFreshnessRerank = async () => {};
    const projects = [...projectsOfTeams(['raas'], { teamsDoc, repos }).projects];
    const res = await svc.retrieve('retry with exponential backoff for flaky upstream calls', {
      budget: 3000, threshold: 0.1, context: { agent: 'claude' }, teams: ['raas'], projects,
    });
    expect(res.items.map((it) => it.id)).toEqual(['ins-raas']);
    expect(res.markdown).toMatch(/Upstream retry backoff \(raas\)/);
    expect(res.markdown).not.toMatch(/\(coding\)/);
  });

  test('no teams: no filter requested (previous behaviour)', async () => {
    const svc = makeService();
    const res = await svc.retrieve('retry with exponential backoff for flaky upstream calls', {
      budget: 3000, threshold: 0.1, context: { agent: 'claude' },
    });
    for (const { filter } of filters) expect(filter).toBeUndefined();
    const seen = new Set(res.items.map(projectOfItem));
    expect(seen.has('raas-api')).toBe(true);
    expect(seen.has('coding')).toBe(true);
  });
});
