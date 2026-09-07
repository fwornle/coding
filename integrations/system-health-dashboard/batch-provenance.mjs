/**
 * Which completed batches belong to a given workflow report.
 *
 * `.data/batch-checkpoints.json` is ONE current, project-wide file — not a
 * per-run artifact. It accumulates every batch the project has ever completed,
 * across every run. The UKB history detail endpoint needs the subset that
 * belongs to the report being viewed.
 *
 * The gate used to be `workflowName.includes('batch')`. That is true today —
 * only batch-analysis.yaml declares the batch steps — but it is a substring
 * match on a display string, so renaming the workflow would silently blank the
 * Pipeline Totals card, and the failure would read as missing data rather than
 * a broken gate. It also credited whichever report matched with every batch in
 * the file, including batches from other runs.
 *
 * Provenance is the durable answer: a batch belongs to a report when it
 * completed inside that report's own [start, end] window. A run that processed
 * no batches selects none and renders no card — the same outcome the name test
 * produced for wave-analysis, reached for a reason that survives a rename.
 */

/**
 * @param {Array<{completedAt?: string}>|null|undefined} completedBatches
 *   `completedBatches` from batch-checkpoints.json.
 * @param {object} report
 * @param {string} [report.startTime]      Report "Start Time", ISO.
 * @param {string} [report.endTime]        Report "End Time", ISO. Open-ended when absent
 *                                         (a run still in flight has written no end yet).
 * @param {string} [report.team]           Team parsed from the report parameters.
 * @param {string} [report.checkpointTeam] `team` recorded in the checkpoint file.
 * @returns {Array} The batches attributable to this report, in file order.
 */
export function selectBatchesForReport(completedBatches, report = {}) {
  if (!Array.isArray(completedBatches) || completedBatches.length === 0) return [];

  // A checkpoint file for a different team describes different work. Only
  // reject on a definite mismatch — either side missing means "unknown", and
  // rejecting on unknown would blank cards that are fine today.
  if (report.team && report.checkpointTeam && report.team !== report.checkpointTeam) {
    return [];
  }

  const start = toEpoch(report.startTime);
  // Without a start time there is no window, so nothing can be attributed.
  // Returning everything here is what the old code effectively did, and it is
  // the failure mode this function exists to remove.
  if (start === null) return [];

  // A report with no end time is still running: leave the window open rather
  // than defaulting to `now`, which would drift between two calls.
  const end = toEpoch(report.endTime);

  return completedBatches.filter((batch) => {
    // A batch with no completedAt cannot be attributed to any run. Older
    // checkpoint files predate the field; excluding them under-reports, which
    // is the safe direction — crediting a run with work it did not do is not.
    const completedAt = toEpoch(batch?.completedAt);
    if (completedAt === null) return false;
    if (completedAt < start) return false;
    if (end !== null && completedAt > end) return false;
    return true;
  });
}

/**
 * Parse an ISO timestamp to epoch ms, or null if it is absent or unparseable.
 * @param {unknown} value
 * @returns {number|null}
 */
function toEpoch(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
