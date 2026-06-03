/**
 * tests/integration/typed-views.test.js
 *
 * Phase 44 Wave 0 — RED test stub.
 *
 * Asserts the A-side legacy typed-view contract for the URLs Plan 44-07 will
 * land at /api/coding/{observations,digests,insights}. Pitfall 2 lock — the
 * dashboard at :3032 reads these URLs, so the response shape is brittle and
 * MUST be preserved verbatim across the SQLite→km-core cutover.
 *
 * EXPECTED FAILURE MODE (RED today):
 *   * A's obs-api currently serves `/api/observations`, `/api/digests`,
 *     `/api/insights` (legacy paths WITHOUT the /coding/ prefix).
 *   * The /api/coding/* paths do NOT exist today — Plan 44-07 mounts them
 *     as typed views reading km-core entities and reshaping via
 *     lib/km-core/src/adapters/observation-view.ts.
 *   * `fetch http://localhost:12436/api/coding/observations?limit=1` returns
 *     HTTP 404 today; the response-shape assertions then fail because we
 *     branched on `res.status === 200` (the assertion message names the URL
 *     and current status).
 *
 * GOES GREEN after: Plan 44-07 mounts /api/coding/{observations,digests,
 *   insights} as typed views over km-core, AND Plan 44-10 has migrated the
 *   SQLite rows into km-core entities so the views return non-empty arrays.
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
  'observation_ids',
  'agents',
  'files_touched',
  'project',
];

const REQUIRED_INSIGHT_KEYS = [
  'id',
  'topic',
  'summary',
  'confidence',
  'digest_ids',
  'last_updated',
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
    expect(Array.isArray(row.observation_ids)).toBe(true);
    expect(Array.isArray(row.agents)).toBe(true);
    expect(Array.isArray(row.files_touched)).toBe(true);
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
    expect(Array.isArray(row.digest_ids)).toBe(true);
    expect(typeof row.last_updated).toBe('string');
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
