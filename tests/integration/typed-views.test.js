/**
 * tests/integration/typed-views.test.js
 *
 * Phase 44 Plan 16 — POST-LOCK wire-shape contract.
 *
 * Asserts the A-side legacy typed-view contract for /api/coding/{observations,
 * digests,insights}. Pitfall 2 lock — the dashboard at :3032 reads these URLs,
 * so the response shape is brittle and MUST be preserved verbatim.
 *
 * WIRE-SHAPE LOCK (Plan 44-16, 2026-06-07):
 *   * Digests + Insights serialize multi-word fields as camelCase:
 *     observationIds, filesTouched, digestIds, lastUpdated, createdAt.
 *   * Observations stay snake_case where the SQL column was already snake_case
 *     (session_id) — the pre-cutover SQL handler did NOT alias session_id, so
 *     it rode through unchanged. All other observation fields are single-word.
 *   * Rationale (do not relitigate without an amendment):
 *       1. Pre-cutover SQLite handler aliased columns to camelCase
 *          (`observation_ids AS observationIds`, etc. — documented inline at
 *          lib/km-core/src/adapters/observation-view.ts:74-75,95-96).
 *       2. 17 dashboard reader sites consume camelCase verbatim
 *          (integrations/system-health-dashboard/src/pages/{digests,insights,
 *          coverage}.tsx + store/slices/ukbSlice.ts + markdown-text.tsx).
 *       3. lib/km-core/src/adapters/observation-view.ts emits camelCase by
 *          design (Plan 44-05).
 *       4. The Wave 0 RED stub asserted snake_case based on SQL column
 *          names alone — a spec error; corrected here.
 *   * See: .planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md
 *
 * Runner: Jest 29 (matches the repo's existing tests/integration/*.test.js
 *   convention — package.json `"test": "... jest"`).
 */

const A_BASE = 'http://localhost:12436';

const REQUIRED_OBS_KEYS = [
  'id',
  'agent',
  'project',
  'content',
  'artifacts',
  'timestamp',
];

const REQUIRED_DIGEST_KEYS = [
  'id',
  'date',
  'theme',
  'summary',
  'observationIds',
  'agents',
  'filesTouched',
  'project',
];

const REQUIRED_INSIGHT_KEYS = [
  'id',
  'topic',
  'summary',
  'confidence',
  'digestIds',
  'lastUpdated',
  'project',
];

async function fetchJson(path) {
  const url = `${A_BASE}${path}`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error(`A obs-api at ${url} unreachable: ${err.message}`);
  }
  if (res.status !== 200) {
    throw new Error(
      `Typed view ${path} returned HTTP ${res.status} — /api/coding/* not yet mounted (expected RED until Plan 44-07)`
    );
  }
  return res.json();
}

function assertEnvelopeShape(body, path) {
  if (!body || typeof body !== 'object') {
    throw new Error(`Typed view ${path} did not return a JSON object — got ${typeof body}`);
  }
  if (!Array.isArray(body.data)) {
    throw new Error(`Typed view ${path} response missing 'data' array (Pitfall 2 envelope)`);
  }
  for (const key of ['total', 'limit', 'offset']) {
    if (typeof body[key] !== 'number') {
      throw new Error(`Typed view ${path} response missing numeric '${key}' (Pitfall 2 envelope)`);
    }
  }
}

function assertRowKeys(row, requiredKeys, path) {
  for (const key of requiredKeys) {
    if (!(key in row)) {
      throw new Error(`Typed view ${path} row missing required key '${key}' (Pitfall 2 shape lock)`);
    }
  }
}

describe('A typed views — /api/coding/{observations,digests,insights} (Phase 44 Wave 0 RED)', () => {
  test('GET /api/coding/observations returns Pitfall 2 envelope + row shape', async () => {
    const body = await fetchJson('/api/coding/observations?limit=1');
    assertEnvelopeShape(body, '/api/coding/observations');
    expect(body.data.length).toBeGreaterThan(0);
    const row = body.data[0];
    assertRowKeys(row, REQUIRED_OBS_KEYS, '/api/coding/observations');
    expect(typeof row.id).toBe('string');
    expect(typeof row.agent).toBe('string');
    expect(typeof row.project).toBe('string');
    expect(typeof row.content).toBe('string');
    expect(Array.isArray(row.artifacts)).toBe(true);
    expect(typeof row.timestamp).toBe('string');
  });

  test('GET /api/coding/digests returns legacy digest shape', async () => {
    const body = await fetchJson('/api/coding/digests?limit=1');
    assertEnvelopeShape(body, '/api/coding/digests');
    expect(body.data.length).toBeGreaterThan(0);
    const row = body.data[0];
    assertRowKeys(row, REQUIRED_DIGEST_KEYS, '/api/coding/digests');
    expect(typeof row.id).toBe('string');
    expect(typeof row.theme).toBe('string');
    expect(typeof row.summary).toBe('string');
    expect(Array.isArray(row.observationIds)).toBe(true);
    expect(Array.isArray(row.agents)).toBe(true);
    expect(Array.isArray(row.filesTouched)).toBe(true);
  });

  test('GET /api/coding/insights returns legacy insight shape', async () => {
    const body = await fetchJson('/api/coding/insights?limit=1');
    assertEnvelopeShape(body, '/api/coding/insights');
    expect(body.data.length).toBeGreaterThan(0);
    const row = body.data[0];
    assertRowKeys(row, REQUIRED_INSIGHT_KEYS, '/api/coding/insights');
    expect(typeof row.id).toBe('string');
    expect(typeof row.topic).toBe('string');
    expect(typeof row.summary).toBe('string');
    expect(typeof row.confidence).toBe('number');
    expect(Array.isArray(row.digestIds)).toBe(true);
    expect(typeof row.lastUpdated).toBe('string');
  });

  test('GET /api/coding/observations?agent=claude&project=coding filters server-side', async () => {
    const all = await fetchJson('/api/coding/observations?limit=200');
    const filtered = await fetchJson('/api/coding/observations?agent=claude&project=coding&limit=200');
    assertEnvelopeShape(all, '/api/coding/observations');
    assertEnvelopeShape(filtered, '/api/coding/observations?agent=claude&project=coding');
    if (filtered.data.length > all.data.length) {
      throw new Error(
        `Server-side filter violation: filtered.length=${filtered.data.length} > all.length=${all.data.length}`
      );
    }
    // Every filtered row must satisfy the filter contract.
    for (const row of filtered.data) {
      expect(row.agent).toBe('claude');
      expect(row.project).toBe('coding');
    }
  });
});
