/**
 * Token-budgeted markdown assembly for retrieval results.
 *
 * Uses gpt-tokenizer for accurate token counting (D-07).
 * Fills budget by walking RRF-sorted results, bucketing by tier,
 * and assembling markdown with tier headers (D-05, D-08).
 *
 * @module token-budget
 */

import { countTokens } from 'gpt-tokenizer';

/** Tier fill order per D-08: insights first, observations last. */
export const TIER_ORDER = ['insights', 'digests', 'kg_entities', 'observations'];

/**
 * Max results per tier to prevent low-precision flooding.
 * MiniLM-L6-v2 cosine similarities cluster high (0.75-0.82) across all
 * project documents, so the Qdrant threshold alone cannot filter irrelevant
 * results. Per-tier caps ensure budget is shared across tiers.
 */
const TIER_MAX_RESULTS = {
  insights: 4,
  digests: 3,
  kg_entities: 3,
  observations: 3,
};

/** Tier section headers for markdown output (D-05). */
const TIER_HEADERS = {
  insights: '## Insights',
  digests: '## Digests',
  kg_entities: '## Entities',
  observations: '## Observations',
};

/**
 * Format a single result as a markdown block with source attribution.
 *
 * Payload fields are tier-specific (from backfill.ts payload schemas):
 *   insights: { topic, confidence, summary_preview }
 *   digests: { date, theme, agents, quality, summary_preview }
 *   kg_entities: { entityType, hierarchyLevel, summary_preview }
 *   observations: { agent, project, date, quality, summary_preview }
 *
 * @param {object} item - Result item with tier and payload
 * @returns {string} Formatted markdown block
 */
export function formatResult(item) {
  const p = item.payload || {};
  switch (item.tier) {
    case 'insights':
      return `**${p.topic || 'Insight'}** (confidence: ${p.confidence ?? '?'})\n${p.summary_preview || ''}\n`;
    case 'digests':
      return `**${p.theme || 'Digest'}** (${p.date || ''}, agents: ${p.agents || '?'})\n${p.summary_preview || ''}\n`;
    case 'kg_entities':
      return `**${p.entityType || 'Entity'}** (level: ${p.hierarchyLevel || '?'})\n${p.summary_preview || ''}\n`;
    case 'observations':
    default:
      return `*${p.agent || 'agent'}* (${p.date || ''}, ${p.project || ''})\n${p.summary_preview || ''}\n`;
  }
}

/**
 * Truncate summary_preview in a result so the formatted output fits within tokenBudget.
 *
 * Creates the header (formatResult with empty summary_preview), counts its tokens,
 * computes available tokens for preview, slices summary_preview to fit (D-09).
 * Returns null if no space available for content.
 *
 * @param {object} item - Result item with tier and payload
 * @param {number} tokenBudget - Maximum tokens for this result
 * @returns {object|null} New item with truncated payload, or null if no space
 */
export function truncateResult(item, tokenBudget) {
  const headerItem = { ...item, payload: { ...item.payload, summary_preview: '' } };
  const header = formatResult(headerItem);
  const headerTokens = countTokens(header);
  const available = tokenBudget - headerTokens - 5; // 5-token safety margin
  if (available <= 0) return null;

  const preview = item.payload?.summary_preview || '';
  // Approximate: ~4 chars per token, then verify and trim if needed
  let truncated = preview.slice(0, available * 4);
  const truncatedItem = { ...item, payload: { ...item.payload, summary_preview: truncated } };
  const formatted = formatResult(truncatedItem);
  let tokens = countTokens(formatted);

  // If still over budget, binary-reduce
  while (tokens > tokenBudget && truncated.length > 10) {
    truncated = truncated.slice(0, Math.floor(truncated.length * 0.8));
    truncatedItem.payload = { ...item.payload, summary_preview: truncated };
    tokens = countTokens(formatResult(truncatedItem));
  }

  if (tokens > tokenBudget) return null;
  return { ...item, payload: { ...item.payload, summary_preview: truncated } };
}

/**
 * Assemble token-budgeted markdown from a fused, sorted result list.
 *
 * Walk sorted results (already sorted by RRF score). For each result:
 * format it, count tokens. If adding would exceed budget: truncate to
 * fit remaining (if remaining > 50 tokens), then break. Bucket results
 * by tier. Build final markdown with tier headers. Only include headers
 * for tiers that have results (D-05, D-08).
 *
 * @param {Array<object>} sortedResults - RRF-fused results sorted by score descending
 * @param {number} budget - Token budget (default 1000 per D-08)
 * @returns {{ markdown: string, tokensUsed: number }}
 */
/**
 * Compute a content fingerprint for dedup.
 *
 * Insights/digests with near-identical summaries (e.g. "OKB Architecture"
 * vs "Operational Knowledge Base (OKB) Architecture") were appearing as
 * separate results because their topic strings differed slightly. We
 * dedup on the first ~120 chars of the summary preview, lowercased and
 * stripped of non-alphanumerics, which collapses these duplicates.
 *
 * @param {object} item - Result item with tier and payload
 * @returns {string|null} Fingerprint string, or null if unfingerprintable
 */
function contentSignature(item) {
  const p = item.payload || {};
  const preview = (p.summary_preview || p.text || p.content || '').toLowerCase();
  if (!preview) return null;
  const normalized = preview.replace(/[^a-z0-9]/g, '').slice(0, 120);
  if (normalized.length < 20) return null;
  return `${item.tier}:${normalized}`;
}

export function assembleBudgetedMarkdown(sortedResults, budget = 1000) {
  const buckets = Object.fromEntries(TIER_ORDER.map((t) => [t, []]));
  let tokensUsed = 0;

  const tierCounts = Object.fromEntries(TIER_ORDER.map((t) => [t, 0]));
  const seenSignatures = new Set();

  for (const result of sortedResults) {
    // Skip if this tier has reached its cap
    const cap = TIER_MAX_RESULTS[result.tier] ?? 5;
    if ((tierCounts[result.tier] ?? 0) >= cap) continue;

    // Skip if we've already included a near-identical result (content dedup)
    const sig = contentSignature(result);
    if (sig && seenSignatures.has(sig)) continue;

    const formatted = formatResult(result);
    const tokens = countTokens(formatted);

    if (tokensUsed + tokens > budget) {
      const remaining = budget - tokensUsed;
      if (remaining > 50) {
        const truncated = truncateResult(result, remaining);
        if (truncated) {
          const tf = formatResult(truncated);
          if (buckets[result.tier]) {
            buckets[result.tier].push(tf);
            tierCounts[result.tier] = (tierCounts[result.tier] ?? 0) + 1;
          }
          tokensUsed += countTokens(tf);
        }
      }
      break;
    }

    if (buckets[result.tier]) {
      buckets[result.tier].push(formatted);
      tierCounts[result.tier] = (tierCounts[result.tier] ?? 0) + 1;
      if (sig) seenSignatures.add(sig);
    }
    tokensUsed += tokens;
  }

  // Build final markdown with tier headers (D-05)
  const sections = [];
  for (const tier of TIER_ORDER) {
    if (buckets[tier].length > 0) {
      sections.push(`${TIER_HEADERS[tier]}\n\n${buckets[tier].join('\n')}`);
    }
  }

  return { markdown: sections.join('\n\n'), tokensUsed };
}
