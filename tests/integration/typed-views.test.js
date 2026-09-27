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
 *
 * WHY THIS SUITE WAITS, AND WHY THAT IS NOT A MASKED TIMEOUT
 * ---------------------------------------------------------
 * It reads a LIVE obs-api, which is single-owner and single-threaded. obs-api
 * also runs consolidation on a schedule: chunked insight synthesis across every
 * project, each chunk an LLM call with a 60s ceiling. While that runs, a request
 * that answers in 0.25s idle does not answer inside jest's 30s default — so the
 * suite failed in a full `npm test` and passed in ~6s alone, for no reason
 * connected to the wire shape it exists to lock.
 *
 * Raising the timeout alone would have been the wrong fix: it would make a
 * genuinely DEAD obs-api take two minutes to report, which is the failure people
 * actually need told quickly. So the retry distinguishes the two causes, exactly
 * as the health coordinator already does for its own probe
 * (scripts/health-coordinator.js "obs_api busy window" — a TIMEOUT means busy,
 * and only a timeout; a refused connection is still reported immediately, or the
 * coordinator would restart obs-api mid-consolidation).
 *
 *   * connection refused  → obs-api is down. Fail on the first attempt.
 *   * timeout / 503       → obs-api is busy. Retry, then say which it was.
 *
 * The suite also waits once, up front, for a consolidation already in flight to
 * finish, using the same `/api/consolidation/status .inflight` field the
 * coordinator reads. Free, when nothing is running: one request.
 */

// Same env seam the obs-api scripts use (scripts/backfill-parent-metadata.mjs),
// so a non-default deployment and the fast-fail branch below are both reachable
// without editing the file.
const A_BASE = process.env.OBS_API_URL || 'http://localhost:12436';

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

/** One attempt's patience. Idle responses are ~0.25s; this is for a busy store. */
const ATTEMPT_TIMEOUT_MS = 20_000;
/** Attempts per request. Three 20s waits outlast a chunk of insight synthesis. */
const ATTEMPTS = 3;
/** How long to let a consolidation already in flight finish before asserting. */
const QUIET_WAIT_MS = 90_000;
/**
 * Covers the retries with slack. Passed per test rather than via
 * `jest.setTimeout`: under `--experimental-vm-modules` the `jest` global is not
 * injected (only describe/test/expect are), so that call is a ReferenceError
 * here — and it raises the budget for the whole FILE, where the third argument
 * states it on the test it belongs to.
 */
const SUITE_TIMEOUT_MS = 120_000;

/** Did this throw because nothing is listening, rather than because it is slow? */
function isConnectionRefused(err) {
  const code = err?.cause?.code ?? err?.code ?? '';
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH';
}

/** Whether obs-api currently reports a consolidation in flight. */
async function consolidationInflight() {
  try {
    const res = await fetch(`${A_BASE}/api/consolidation/status`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;          // cannot tell — do not claim busy
    return Boolean((await res.json())?.inflight);
  } catch {
    return false;                        // same: absence of an answer is not evidence
  }
}

/**
 * Wait for a consolidation already running to finish. Bounded, and it does NOT
 * fail on expiry: a long run is a reason to try anyway, not to declare the wire
 * shape broken. Returns whether obs-api went quiet, for the failure message.
 */
async function waitForQuietObsApi(budgetMs = QUIET_WAIT_MS) {
  const deadline = Date.now() + budgetMs;
  let sawBusy = false;
  while (Date.now() < deadline) {
    if (!(await consolidationInflight())) return { quiet: true, sawBusy };
    sawBusy = true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return { quiet: false, sawBusy };
}

async function fetchJson(path) {
  const url = `${A_BASE}${path}`;
  let lastErr;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (err) {
      // Nothing is listening. Retrying cannot change that, and the point of
      // separating the cases is that THIS one is reported at once.
      if (isConnectionRefused(err)) {
        throw new Error(`A obs-api at ${url} unreachable: ${err.message}`);
      }
      lastErr = err;
      continue;                          // timed out — the busy case
    }

    // 503 is kmRouter's hydration gate: the store is still opening, which is
    // early rather than broken (observations-api-server.mjs kmRouter.use).
    if (res.status === 503) {
      lastErr = new Error('HTTP 503 — knowledge store still hydrating');
      continue;
    }
    if (res.status !== 200) {
      throw new Error(
        `Typed view ${path} returned HTTP ${res.status} — /api/coding/* not yet mounted (expected RED until Plan 44-07)`
      );
    }
    return res.json();
  }

  // Every attempt timed out. Say which cause it was, so the next reader does not
  // have to rediscover the consolidation overlap from a bare timeout.
  const busy = await consolidationInflight();
  throw new Error(
    `Typed view ${path} did not answer in ${ATTEMPTS}×${ATTEMPT_TIMEOUT_MS / 1000}s. `
      + (busy
        ? 'obs-api reports a consolidation IN FLIGHT — it is busy, not broken; '
          + 'this run overlapped a scheduled consolidation.'
        : 'obs-api reports no consolidation in flight, so this is a real stall — '
          + 'check `sample <pid>` and .logs/, not the schedule.')
      + ` Last error: ${lastErr?.message ?? 'unknown'}`
  );
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
  // Let a consolidation that is already running finish before asserting. One
  // request when nothing is in flight, which is the usual case.
  beforeAll(async () => {
    const { quiet, sawBusy } = await waitForQuietObsApi();
    if (sawBusy) {
      process.stderr.write(
        `[typed-views] obs-api was consolidating; waited and it ${quiet ? 'went quiet' : 'is still busy'}\n`
      );
    }
  }, QUIET_WAIT_MS + 10_000);

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
  }, SUITE_TIMEOUT_MS);

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
  }, SUITE_TIMEOUT_MS);

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
  }, SUITE_TIMEOUT_MS);

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
  }, SUITE_TIMEOUT_MS);
});
