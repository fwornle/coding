/**
 * scripts/observations-api-merge.mjs
 *
 * Pure (side-effect-free) range-merge helpers for the /api/observations and
 * /api/digests endpoints in observations-api-server.mjs.
 *
 * Lives in its own file so the Jest integration test
 * (tests/scripts/observations-api-server.merge.test.js) can import the helpers
 * directly without dragging in the obs-api server's transitive deps
 * (RetrievalService -> embedding-service.js, which is a TS dist file that the
 * Jest moduleNameMapper cannot resolve at test time).
 *
 * Phase 35 plan 35-04.
 */

/**
 * Compute the retention boundary as an ISO-8601 string (UTC, with T and Z).
 * SQLite returns datetime() with a space separator and no timezone; converting
 * through Date.toISOString() normalizes the format so string comparisons
 * against cold-row createdAt (which is full ISO with ms + Z) line up byte-for-byte.
 */
export function _computeRetentionBoundary(db, retentionDays) {
  const row = db.prepare("SELECT datetime('now', ?) AS t").get(`-${retentionDays} days`);
  return new Date(row.t + 'Z').toISOString();
}

/**
 * Merge SQLite rows + cold-store rows for /api/observations.
 *
 * The Set-based duplicate-id filter (sqliteIds) is LOAD-BEARING - it is the
 * in-process safety net against any straggler from the cold tier whose createdAt
 * happens to land on the boundary. DO NOT remove or refactor this Set away.
 * See .planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/PLAN.md invariant #5.
 *
 * @param {Object[]} sqliteRows  already-shaped rows from the existing SQL query
 * @param {Object[]} coldRows    raw rows from ColdStoreReader.readObservations()
 * @param {string}   retentionBoundary ISO-8601 cutoff
 * @returns {{ data: Object[], _metadata: Object }}
 */
export function _mergeObservations(sqliteRows, coldRows, retentionBoundary) {
  // 1. Filter cold rows to those strictly older than the retention boundary.
  const safeCold = coldRows.filter(r => r.createdAt < retentionBoundary);
  // 2. Build a Set of SQLite ids - LOAD-BEARING safety net (see JSDoc above).
  const sqliteIds = new Set(sqliteRows.map(r => r.id));
  const safeColdNoOverlap = safeCold.filter(r => !sqliteIds.has(r.id));
  // 3. Reshape cold rows to match the SQLite handler output shape.
  //    Tag each row with _origin so the frontend renders a cold-store icon.
  const reshaped = safeColdNoOverlap.map(r => ({
    id: r.id,
    content: r.summary,
    agent: r.agent,
    sessionId: null,
    project: r.project,
    timestamp: r.createdAt,
    source: null,
    quality: r.quality,
    llmModel: r.llm?.model || null,
    llmProvider: r.llm?.provider || null,
    llmTokens: null,
    llmLatencyMs: null,
    _origin: 'cold',
  }));
  const taggedSqlite = sqliteRows.map(r => ({ ...r, _origin: 'sqlite' }));
  const merged = [...taggedSqlite, ...reshaped].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return {
    data: merged,
    _metadata: {
      fromColdStore: reshaped.length > 0,
      coldOnFirstPageOnly: true,
      sqliteRows: sqliteRows.length,
      coldRows: reshaped.length,
      retentionBoundary,
    },
  };
}

/**
 * Merge SQLite rows + cold-store rows for /api/digests.
 *
 * Same LOAD-BEARING Set-based id dedup as _mergeObservations (invariant #5).
 * The cold-row filter is keyed on date (YYYY-MM-DD) instead of createdAt.
 *
 * @param {Object[]} sqliteRows  already-shaped digest rows
 * @param {Object[]} coldRows    raw rows from ColdStoreReader.readDigests()
 * @param {string}   retentionBoundaryDate YYYY-MM-DD cutoff
 */
export function _mergeDigests(sqliteRows, coldRows, retentionBoundaryDate) {
  const safeCold = coldRows.filter(r => r.date < retentionBoundaryDate);
  // LOAD-BEARING Set-based id dedup (invariant #5).
  const sqliteIds = new Set(sqliteRows.map(r => r.id));
  const safeColdNoOverlap = safeCold.filter(r => !sqliteIds.has(r.id));
  const reshaped = safeColdNoOverlap.map(r => ({
    id: r.id,
    date: r.date,
    theme: r.theme,
    summary: r.summary,
    observationIds: Array.isArray(r.observationIds) ? r.observationIds : [],
    agents: Array.isArray(r.agents) ? r.agents : [],
    filesTouched: Array.isArray(r.filesTouched) ? r.filesTouched : [],
    quality: r.quality,
    createdAt: r.createdAt,
    project: r.project,
    _origin: 'cold',
  }));
  const taggedSqlite = sqliteRows.map(r => ({ ...r, _origin: 'sqlite' }));
  const merged = [...taggedSqlite, ...reshaped].sort((a, b) => {
    const ad = (a.date || '') + 'T' + (a.createdAt || '');
    const bd = (b.date || '') + 'T' + (b.createdAt || '');
    return bd.localeCompare(ad);
  });
  return {
    data: merged,
    _metadata: {
      fromColdStore: reshaped.length > 0,
      coldOnFirstPageOnly: true,
      sqliteRows: sqliteRows.length,
      coldRows: reshaped.length,
      retentionBoundary: retentionBoundaryDate,
    },
  };
}
