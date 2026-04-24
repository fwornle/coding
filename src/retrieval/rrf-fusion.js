/**
 * Reciprocal Rank Fusion (RRF) with tier-weighted scoring.
 *
 * Combines multiple ranked lists into a single fused ranking using the
 * standard RRF formula (Cormack et al., 2009). Tier weights are applied
 * after fusion per D-03.
 *
 * @module rrf-fusion
 */

/** Tier weight multipliers applied after RRF fusion (D-03). */
export const TIER_WEIGHTS = {
  insights: 1.5,
  digests: 1.2,
  kg_entities: 1.0,
  observations: 0.8,
};

/**
 * Reciprocal Rank Fusion.
 *
 * For each ranked list, score items as 1 / (k + rank + 1).
 * Accumulate scores per item ID across all lists.
 * After fusion, multiply each item's score by its tierWeight (D-03).
 * Sort descending by final score.
 *
 * @param {Array<Array<{id: string, tier: string, tierWeight: number, payload: object}>>} rankedLists
 * @param {number} k - RRF damping constant (default 60, per original paper)
 * @returns {Array<object>} Fused results sorted by rrfScore descending
 */
export function rrfFuse(rankedLists, k = 60) {
  const scores = new Map(); // id -> { score, item }

  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const existing = scores.get(item.id) || { score: 0, item };
      existing.score += 1 / (k + rank + 1);
      scores.set(item.id, existing);
    });
  }

  // Apply tier weights after fusion (D-03)
  for (const [, entry] of scores) {
    entry.score *= TIER_WEIGHTS[entry.item.tier] ?? 1.0;
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((e) => ({ ...e.item, rrfScore: e.score }));
}

/**
 * Exponential decay recency score.
 *
 * Returns a score in [0, 1] based on the age of the item.
 * Half-life of 14 days means a 14-day-old item scores 0.5.
 *
 * @param {string|null|undefined} dateStr - ISO date string
 * @param {number} halfLifeDays - Decay half-life in days (default 14)
 * @returns {number} Recency score in [0, 1]
 */
export function recencyScore(dateStr, halfLifeDays = 14) {
  if (!dateStr) return 0.5;
  const ageMs = Date.now() - new Date(dateStr).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Build a recency-ranked list from a combined item set (deduped by id).
 *
 * Used as the third input list to rrfFuse() to add recency as a ranking signal.
 * Falls back to payload.created_at if payload.date is not available.
 *
 * @param {Array<{id: string, payload: object}>} items - Combined items from semantic + keyword
 * @returns {Array<object>} Deduped items sorted by recency score descending
 */
export function buildRecencyList(items) {
  const seen = new Set();
  const deduped = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return deduped
    .map((item) => ({
      ...item,
      _recency: recencyScore(item.payload?.date || item.payload?.created_at),
    }))
    .sort((a, b) => b._recency - a._recency);
}
