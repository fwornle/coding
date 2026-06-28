// lib/experiments/report-read.mjs
//
// KB-04 / DASH-03 read half (Phase 74, Plan 03): the canonical Report read service.
// `readReports(store)` lists every saved Report; `readReport(store, reportId)` reads
// one. Both DESERIALIZE the frozen `snapshot` + `facet_state` JSON strings written by
// report-write.mjs and return the STORED snapshot verbatim.
//
// DASH-03 STABILITY (structural, load-bearing): this module returns the frozen
// snapshot and NEVER re-queries — it deliberately does not import or invoke the
// runs join service. A saved Report's rendered view is therefore stable across
// underlying Run/Score mutations until an explicit refreshReport re-runs the query
// (report-write.mjs). Re-querying on view would silently violate the "stable until
// Refresh" guarantee, so it is deliberately absent here.
//
// CONTRACT (mirrors query.mjs / score-write.mjs): the caller passes an ALREADY-OPEN
// experiment store; this module NEVER opens/closes or constructs a store. Output via
// process.stderr.write only — the no-console-log rule (CLAUDE.md).
//
// Analog: lib/experiments/score-write.mjs:87-93 (iterate-by-entityType read idiom).

/** Map a raw Report entity's metadata to the rendered view shape (deserialize snapshot + facet_state). */
function toView(entity) {
  const m = entity.metadata ?? {};
  let facetState = {};
  let snapshot = [];
  try {
    facetState = JSON.parse(m.facet_state ?? '{}');
  } catch {
    facetState = {};
  }
  try {
    snapshot = JSON.parse(m.snapshot ?? '[]');
  } catch {
    snapshot = [];
  }
  return {
    reportId: m.report_id,
    title: m.title,
    createdBy: m.created_by,
    createdAt: m.created_at,
    snapshotFrozenAt: m.snapshot_frozen_at,
    facetState,
    snapshot,
  };
}

/**
 * List every saved Report, each as a rendered view with its frozen snapshot
 * deserialized. Never re-queries the underlying Runs.
 *
 * @param {import('@fwornle/km-core').GraphKMStore} store an OPEN experiment store.
 * @returns {Promise<Array<object>>} `{ reportId, title, createdBy, createdAt,
 *   snapshotFrozenAt, facetState, snapshot }[]`.
 */
export async function readReports(store) {
  const reports = [];
  for await (const e of store.iterate({ entityType: 'Report' })) {
    reports.push(toView(e));
  }
  process.stderr.write(`[experiments] readReports count=${reports.length}\n`);
  return reports;
}

/**
 * Read a single Report by its report_id slug. Returns the STORED snapshot verbatim
 * (never re-queries). Returns null if no Report carries that report_id.
 *
 * @param {import('@fwornle/km-core').GraphKMStore} store an OPEN experiment store.
 * @param {string} reportId the report slug.
 * @returns {Promise<object|null>} the rendered view, or null if absent.
 */
export async function readReport(store, reportId) {
  for await (const e of store.iterate({ entityType: 'Report' })) {
    if (e.metadata?.report_id === reportId) {
      return toView(e);
    }
  }
  return null;
}
