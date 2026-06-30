/**
 * lib/live-logging/progress-fire.mjs
 *
 * Pure decision helper for emitting periodic IN-PROGRESS observations during a
 * long-running agentic turn, triggered by output-token deltas.
 *
 * Motivation: ETM fires one observation per user prompt-set, stamped at the
 * prompt time. A heavy turn (the calibration session ran 80k–135k output tokens
 * for the long ones) therefore collapses ~40 minutes of work into a single row.
 * This trigger fires an extra observation each time the turn accumulates another
 * `thresholdTokens` of model output, so the timeline reflects progress without
 * waiting for the next user prompt. The Mastra codebase used a 20k delta; with
 * the real per-turn volumes 30k is the tuned default (~3-4 snapshots on the
 * longest turns, 0 on short turns). Override via env ETM_PROGRESS_TOKEN_DELTA.
 *
 * Side-effect-free and deterministic so it can be unit-tested without the daemon.
 * The caller owns the actual fire (reusing _firePromptSetObservation, whose
 * cursor ensures only exchanges past the last fire are emitted — no double-count)
 * and persisting the returned mark.
 */

/** Tuned default output-token delta between in-progress fires (see header). */
export const DEFAULT_PROGRESS_TOKEN_DELTA = 30_000;

/**
 * Sum the model output tokens across a prompt-set's exchanges. Exchanges carry
 * `outputTokens` (accumulated from each assistant message's usage.output_tokens
 * at extraction). Non-Claude exchanges without the field contribute 0, so the
 * trigger is naturally inert for agents whose transcripts lack token usage.
 * @param {Array<{outputTokens?: number}>} exchanges
 * @returns {number}
 */
export function sumOutputTokens(exchanges) {
  let total = 0;
  for (const ex of exchanges || []) {
    const n = ex && typeof ex.outputTokens === 'number' && ex.outputTokens > 0 ? ex.outputTokens : 0;
    total += n;
  }
  return total;
}

/**
 * Decide whether to fire an in-progress observation given the prompt-set's
 * current cumulative output tokens and the mark recorded at the last fire.
 *
 * @param {object} args
 * @param {number} args.setOutputTokens    cumulative output tokens of the live set
 * @param {number} args.firedOutputTokens  the mark stored at the last progress/completion fire (0 if none)
 * @param {number} args.thresholdTokens    delta that triggers a fire; <=0 disables the feature
 * @returns {{ fire: boolean, mark: number }}
 *   fire — emit an in-progress observation now
 *   mark — the value the caller must store as the new firedOutputTokens
 */
export function progressFireDecision({ setOutputTokens, firedOutputTokens, thresholdTokens }) {
  const tokens = typeof setOutputTokens === 'number' && setOutputTokens > 0 ? setOutputTokens : 0;
  const fired = typeof firedOutputTokens === 'number' && firedOutputTokens > 0 ? firedOutputTokens : 0;
  if (!(thresholdTokens > 0)) return { fire: false, mark: fired };
  // The set shrank vs. the recorded mark → a new turn started and the per-cursor
  // accumulator reset. Rebase the baseline to 0 so the new turn is measured fresh
  // (avoids waiting until it exceeds the PREVIOUS turn's larger mark).
  const base = tokens < fired ? 0 : fired;
  if (tokens - base >= thresholdTokens) {
    return { fire: true, mark: tokens };
  }
  return { fire: false, mark: base };
}
