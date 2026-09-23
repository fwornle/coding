/**
 * The `[Raw]` fallback marker — one definition, shared by the writer that
 * produces it and every gate that has to recognise it.
 *
 * When the LLM proxy is unreachable, `ObservationWriter._fallbackSummary()`
 * stores the turn under a placeholder summary instead of discarding it. The
 * row is a RECEIPT, not a record: the full message array is preserved in
 * `metadata.messages`, so `scripts/backfill-raw-observations.mjs` can
 * re-summarise it once the proxy is back.
 *
 * It lives in its own module because the two sides of that contract sit in
 * modules that must not import each other's weight: `ObservationExporter`
 * decides whether the row survives to the cold store, and importing
 * `ObservationWriter` for a string prefix would drag ioredis and km-core into
 * every test that only wants the exporter. The prefix was already duplicated
 * in three places (writer `_fallbackSummary`, writer `_classifyQuality`, the
 * backfill script) when the export filter silently stopped matching it.
 */

/** Prefix `_fallbackSummary()` stamps on a proxy-failure placeholder. */
export const RAW_FALLBACK_PREFIX = '[Raw]';

/**
 * True when a summary is a proxy-failure placeholder rather than a real one.
 *
 * Case-insensitive: the 2026-05-28 generation of these rows reads
 * "[Raw] needs backfill", and the writer's quality classifier has always
 * matched lowercased.
 *
 * @param {unknown} summary
 * @returns {boolean}
 */
export function isRawFallbackSummary(summary) {
  return typeof summary === 'string'
    && summary.trimStart().toLowerCase().startsWith(RAW_FALLBACK_PREFIX.toLowerCase());
}
