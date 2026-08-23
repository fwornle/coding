/**
 * preview.ts — the single source of truth for how much of an item's text is stored
 * alongside its vector, and therefore how much of it can ever be injected.
 *
 * WHY THIS EXISTS AS A NAMED CONSTANT. The value was `substring(0, 200)`, duplicated
 * across five call sites (listener.ts and four loaders in backfill.ts). Nothing named
 * it, so nothing connected it to its consequence: `formatResult`
 * (src/retrieval/token-budget.js) renders ONLY `summary_preview`, so 200 characters was
 * a hard ceiling on the injected payload per item — no matter how much of the
 * 1000-token budget was left.
 *
 * Measured before the change, over 1419 real captures / 4624 injected items:
 *   - every stored preview was <= 200 chars (0% exceeded it)
 *   - median 2 items injected per turn
 *   - median `tokens_used` 285 of a 1000-token budget — 28% utilisation
 * The injected block named a relevant insight and then stopped mid-sentence, before
 * anything actionable. The budget was never the binding constraint; this was.
 *
 * WHY 1200. Chosen from where the useful content actually sits, not by feel. Insight
 * bodies have a median length of 2246 chars (digests and observations ~745), and the
 * decisive fact in the top-ranked insights for three sample tasks sat at character
 * offsets 520, 592 and 769 — all cut off by 200, all captured by 1200. At roughly
 * 3.5-4 chars/token, 1200 chars is ~300-340 tokens, so two items fill most of the
 * 700-token semantic budget and a third truncates gracefully. That keeps the
 * multi-tier breadth the pipeline is designed around (observations → digests →
 * insights bridge the consolidation lag) instead of letting one long insight consume
 * the whole budget.
 *
 * RAISING THIS REQUIRES A RE-INDEX. The preview is written into the Qdrant payload at
 * index time, so changing this constant only affects items indexed afterwards. Existing
 * points keep their old preview until backfill.ts re-runs over them — which is why
 * `previewVersion` below is stamped into every payload: it lets the backfill tell "this
 * point predates the current policy" from "this point is already current", something a
 * content hash alone cannot express (the content did not change — the policy did).
 *
 * @module preview
 */

/**
 * Maximum characters of source text stored in a point's `summary_preview` payload,
 * and therefore the most any single item can contribute to an injected context block.
 *
 * Set to the p90 of indexed insight summaries (measured 2026-08-23 over 713 insights:
 * median 2,239, p90 3,220, max 10,530), so 90% of insights are delivered COMPLETE rather
 * than mid-sentence. At the previous 1,200 the cap truncated 96% of them.
 *
 * This is a DELIVERY limit, not a retrieval one. all-MiniLM-L6-v2 truncates its input at
 * 512 tokens — measured empirically at ~2,050 chars: two texts sharing a 2,132-char head
 * and differing entirely after it embed to BYTE-IDENTICAL vectors. So content past ~2,050
 * chars is invisible to ranking however large this cap is; raising it improves what the
 * model receives, not what the retriever can find. Fixing that needs per-section chunking
 * (deliberately deferred — re-measure first).
 */
export const SUMMARY_PREVIEW_CHARS = 3300;

/**
 * Build the stored preview for a piece of source text.
 *
 * @param text full source text (an insight/digest/observation summary, or an entity's
 *   name + description)
 * @returns the leading `SUMMARY_PREVIEW_CHARS` characters
 */
export function makePreview(text: string): string {
  return String(text ?? "").substring(0, SUMMARY_PREVIEW_CHARS);
}

/**
 * Policy stamp written into every payload as `preview_version`.
 *
 * Points carrying a different value (or none — everything indexed before this shipped)
 * were built under an older preview policy and must be re-indexed even though their
 * content hash is unchanged.
 */
export const previewVersion = (): number => SUMMARY_PREVIEW_CHARS;
