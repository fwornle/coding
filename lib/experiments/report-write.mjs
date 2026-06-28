// lib/experiments/report-write.mjs
//
// KB-04 / DASH-03 storage half (Phase 74, Plan 03): a saved Report is a query
// (its facet-state) PLUS a frozen results snapshot, materialized as an idempotent
// km-core `Report` entity in the dedicated experiment store. This realizes the
// RESEARCH Open-Question-1 resolution (D-05 discretion): Reports live as `Report`
// entities in the experiment LevelDB — a single source of truth, idempotent the
// same way writeScore is.
//
// IDEMPOTENCY (mirrors score-write.mjs:85-104, RESEARCH Pitfall 1): the Report is
// keyed on `metadata.report_id`, NOT the km-core entity id. A report_id slug (e.g.
// 'rep-1') is NOT a valid UUIDv7 — putEntity({ id: report_id }) would throw in
// parseEntityId. So we mint a UUIDv7 ONCE via mintEntityId() on the first write and,
// on a re-save / refresh, find the existing Report via an iterate({ entityType:
// 'Report' }) metadata.report_id scan and UPDATE the SAME node (same id).
//
// SNAPSHOT STABILITY (DASH-03, D-04): writeReport freezes a snapshot from the
// current query. readReport returns that STORED snapshot verbatim — it NEVER
// re-queries. Only refreshReport re-runs the saved query (via readRuns) and
// overwrites the snapshot + snapshot_frozen_at on the same node. This is the
// load-bearing "stable until Refresh" correctness guarantee.
//
// STRICT-PATH WRITE: putEntity on the STRICT path with a synthetic ProvenanceStamp
// (the store never invents one, D-30), so entityType:'Report' is validated against
// the experiment ontology registry (KB-01). The Report goes ONLY through the
// already-open experiment store passed in — this module never imports the shared KG
// writer and never constructs a store inline (T-74-03-01).
//
// Serialized payloads (facet_state, snapshot) ride in metadata as JSON strings,
// mirroring how Score keeps event_labels serialized (score-write.mjs:134); the read
// path parses them back.
//
// Output via process.stderr.write only — the no-console-log rule (CLAUDE.md).
//
// Analog: lib/experiments/score-write.mjs:72-157 (idempotent mint-once + iterate-find
//   + strict putEntity + synthetic provenance). Consumes: openExperimentStore()
//   (the store is passed in already open) and readRuns() from query.mjs.
import { mintEntityId } from '@fwornle/km-core';
import { readRuns } from './query.mjs';

/** Find an existing Report entity by its report_id slug. Returns the raw entity or null. */
async function findReport(store, reportId) {
  for await (const e of store.iterate({ entityType: 'Report' })) {
    if (e.metadata?.report_id === reportId) {
      return e;
    }
  }
  return null;
}

/** Re-run the saved query and return the rows that make up the frozen snapshot. */
async function materializeSnapshot(store, query) {
  // The saved facet-state is the query options for readRuns (at minimum
  // includePending; additional saved filters may be applied in-memory by callers
  // upstream). Re-running readRuns reflects the CURRENT underlying Run/Score state.
  return readRuns(store, query ?? {});
}

/**
 * Save (or re-save) a Report idempotently: a UUIDv7 entity keyed on report_id whose
 * metadata carries the saved query (facet_state) + a frozen results snapshot.
 *
 * @param {import('@fwornle/km-core').GraphKMStore} store an OPEN experiment store
 *   (from openExperimentStore()). The caller owns open/close.
 * @param {object} args
 * @param {string} args.report_id the stable report slug (idempotency key).
 * @param {string} [args.name] human-readable title.
 * @param {object} [args.query] the saved facet-state (readRuns options).
 * @param {string} [args.createdBy] operator id.
 * @returns {Promise<string>} the Report entity id (minted on first write, reused on re-save).
 */
export async function writeReport(store, { report_id, name, query, createdBy } = {}) {
  if (!report_id) {
    throw new Error('writeReport: report_id is required (the idempotency key)');
  }

  // (1) Idempotent lookup — find an existing Report carrying this report_id. NEVER
  //     use report_id as the entity id (parseEntityId requires a UUIDv7 — Pitfall 1).
  const existing = await findReport(store, report_id);
  const prev = existing?.metadata ?? {};

  // (2) Freeze a snapshot from the current query.
  const facetState = query ?? {};
  const snapshotRows = await materializeSnapshot(store, facetState);
  const nowIso = new Date().toISOString();

  // (3) Synthetic provenance — the store NEVER invents one (D-30). This is a write
  //     by the dashboard, not an LLM extraction.
  const provenance = {
    provider: 'coding-dashboard',
    model: 'n/a',
    runId: report_id,
    timestamp: nowIso,
  };

  // (4) Strict-path putEntity. Mint a UUIDv7 ONCE on first write; reuse the existing
  //     id on re-save so the SAME node updates. Serialize facet_state + snapshot into
  //     metadata as JSON strings (parsed on read). Preserve created_at/created_by
  //     across re-saves (carry forward from the existing entity's metadata).
  const reportEntityId = await store.putEntity({
    id: existing?.id ?? mintEntityId(), // re-save updates same node; first write mints (never report_id)
    name: `${report_id}-report`,
    entityType: 'Report', // validated against experiment-ontology.json (strict path)
    layer: 'evidence',
    description: 'Saved query (facet-state) + frozen results snapshot (KB-04 / DASH-03)',
    metadata: {
      // km-core exporter buckets by metadata.domain — tag 'experiment' so the Report
      // files under experiments/exports/experiment.json, not general.json.
      domain: 'experiment',
      report_id, // ── the idempotency key ──
      title: name ?? prev.title ?? report_id,
      created_by: createdBy ?? prev.created_by ?? null,
      created_at: prev.created_at ?? nowIso, // preserved across re-saves
      facet_state: JSON.stringify(facetState), // serialized query (parsed on read)
      snapshot: JSON.stringify(snapshotRows), // frozen results (parsed on read)
      snapshot_frozen_at: nowIso,
    },
  }, { provenance });

  process.stderr.write(
    `[experiments] writeReport report_id=${report_id} ` +
    `id=${String(reportEntityId).slice(0, 8)} rows=${snapshotRows.length}\n`,
  );

  return reportEntityId;
}

/**
 * Re-run a saved Report's query and overwrite ONLY its snapshot + snapshot_frozen_at
 * on the SAME node (preserving title/created_by/created_at/facet_state). This is the
 * explicit "Refresh" action — the only path that re-queries (DASH-03 / D-04).
 *
 * @param {import('@fwornle/km-core').GraphKMStore} store an OPEN experiment store.
 * @param {object} args
 * @param {string} args.report_id the report slug to refresh.
 * @returns {Promise<string>} the Report entity id (reused — same node).
 */
export async function refreshReport(store, { report_id } = {}) {
  if (!report_id) {
    throw new Error('refreshReport: report_id is required');
  }
  const existing = await findReport(store, report_id);
  if (!existing) {
    throw new Error(`refreshReport: no Report found for report_id '${report_id}'`);
  }
  const prev = existing.metadata ?? {};

  // Re-run the saved facet-state query against the CURRENT store state.
  let facetState = {};
  try {
    facetState = JSON.parse(prev.facet_state ?? '{}');
  } catch {
    facetState = {};
  }
  const snapshotRows = await materializeSnapshot(store, facetState);
  const nowIso = new Date().toISOString();

  const provenance = {
    provider: 'coding-dashboard',
    model: 'n/a',
    runId: report_id,
    timestamp: nowIso,
  };

  // Strict-path putEntity on the SAME id — overwrite snapshot + snapshot_frozen_at
  // only; preserve every other metadata field (title/created_*/facet_state).
  const reportEntityId = await store.putEntity({
    id: existing.id,
    name: `${report_id}-report`,
    entityType: 'Report',
    layer: 'evidence',
    description: 'Saved query (facet-state) + frozen results snapshot (KB-04 / DASH-03)',
    metadata: {
      ...prev,
      snapshot: JSON.stringify(snapshotRows),
      snapshot_frozen_at: nowIso,
    },
  }, { provenance });

  process.stderr.write(
    `[experiments] refreshReport report_id=${report_id} ` +
    `id=${String(reportEntityId).slice(0, 8)} rows=${snapshotRows.length}\n`,
  );

  return reportEntityId;
}

/**
 * Read a single Report's frozen view by report_id. Returns the STORED snapshot
 * verbatim — it NEVER re-queries (DASH-03 stability: only refreshReport re-runs).
 *
 * Re-exported convenience so callers that already import the writer can render a
 * report; the canonical read service is lib/experiments/report-read.mjs.
 *
 * @param {import('@fwornle/km-core').GraphKMStore} store an OPEN experiment store.
 * @param {object} args
 * @param {string} args.report_id the report slug.
 * @returns {Promise<object|null>} `{ reportId, title, createdBy, createdAt,
 *   snapshotFrozenAt, facetState, snapshot }` or null if absent.
 */
export async function readReport(store, { report_id } = {}) {
  const { readReport: read } = await import('./report-read.mjs');
  return read(store, report_id);
}
