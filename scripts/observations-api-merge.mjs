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
 * Phase 35 plan 35-06 gap closure: optional `opts` arg enables paginable-total
 * accounting. When provided, the return includes a `total` field that the
 * dashboard's last-page math can trust: total = sqliteTotalInRange + min(
 *   coldRowsAfterFilter, max(0, limit - sqliteRowsContributedToPage0)
 * ). Without `opts`, the legacy 3-arg return shape is preserved (no `total`).
 *
 * @param {Object[]} sqliteRows  already-shaped rows from the existing SQL query
 * @param {Object[]} coldRows    raw rows from ColdStoreReader.readObservations()
 * @param {string}   retentionBoundary ISO-8601 cutoff
 * @param {Object}   [opts]
 * @param {number}   [opts.limit]              page size; required for paginable total
 * @param {number}   [opts.offset]             current page offset (cold contributes only at 0)
 * @param {number}   [opts.sqliteTotalInRange] COUNT(*) over the SQLite WHERE clause
 * @returns {{ data: Object[], _metadata: Object, total?: number }}
 */
export function _mergeObservations(sqliteRows, coldRows, retentionBoundary, opts) {
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
  const result = {
    data: merged,
    _metadata: {
      fromColdStore: reshaped.length > 0,
      coldOnFirstPageOnly: true,
      sqliteRows: sqliteRows.length,
      coldRows: reshaped.length,
      retentionBoundary,
    },
  };
  // Phase 35 plan 35-06 - paginable-total accounting. Only compute when caller
  // supplies the bookkeeping inputs; otherwise preserve the legacy 3-arg shape.
  if (opts && typeof opts.limit === 'number' && typeof opts.sqliteTotalInRange === 'number') {
    const { limit, offset = 0, sqliteTotalInRange } = opts;
    // Cold rows only contribute to offset=0, so total must reflect what
    // pagination actually walks: SQLite's full range count + however many cold
    // rows fit on page 0 after SQLite consumed its slots.
    if (offset === 0) {
      const pageRows = merged.slice(0, limit);
      const sqliteOnThisPage = pageRows.filter(r => r._origin === 'sqlite').length;
      const coldCapacityOnPage0 = Math.max(0, limit - sqliteOnThisPage);
      const paginableCold = Math.min(reshaped.length, coldCapacityOnPage0);
      result.total = sqliteTotalInRange + paginableCold;
    } else {
      // offset > 0 - cold absent on subsequent pages, total is SQLite-only.
      result.total = sqliteTotalInRange;
    }
  }
  return result;
}

/**
 * Merge SQLite rows + cold-store rows for /api/digests.
 *
 * Same LOAD-BEARING Set-based id dedup as _mergeObservations (invariant #5).
 * The cold-row filter is keyed on date (YYYY-MM-DD) instead of createdAt.
 *
 * Phase 35 plan 35-06: paginable-total accounting via optional `opts` arg
 * (same shape and semantics as _mergeObservations).
 *
 * @param {Object[]} sqliteRows  already-shaped digest rows
 * @param {Object[]} coldRows    raw rows from ColdStoreReader.readDigests()
 * @param {string}   retentionBoundaryDate YYYY-MM-DD cutoff
 * @param {Object}   [opts]
 * @param {number}   [opts.limit]
 * @param {number}   [opts.offset]
 * @param {number}   [opts.sqliteTotalInRange]
 */
export function _mergeDigests(sqliteRows, coldRows, retentionBoundaryDate, opts) {
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
  const result = {
    data: merged,
    _metadata: {
      fromColdStore: reshaped.length > 0,
      coldOnFirstPageOnly: true,
      sqliteRows: sqliteRows.length,
      coldRows: reshaped.length,
      retentionBoundary: retentionBoundaryDate,
    },
  };
  // Phase 35 plan 35-06 - paginable-total accounting (see _mergeObservations).
  if (opts && typeof opts.limit === 'number' && typeof opts.sqliteTotalInRange === 'number') {
    const { limit, offset = 0, sqliteTotalInRange } = opts;
    if (offset === 0) {
      const pageRows = merged.slice(0, limit);
      const sqliteOnThisPage = pageRows.filter(r => r._origin === 'sqlite').length;
      const coldCapacityOnPage0 = Math.max(0, limit - sqliteOnThisPage);
      const paginableCold = Math.min(reshaped.length, coldCapacityOnPage0);
      result.total = sqliteTotalInRange + paginableCold;
    } else {
      result.total = sqliteTotalInRange;
    }
  }
  return result;
}
