// lib/cost/copilot-pricing.mjs — what a GitHub Copilot call costs, in USD.
//
// One module for every reader of Copilot cost: the dashboard's cost model
// (integrations/system-health-dashboard/src/components/cost/cost-model.ts), the
// calibration script (scripts/cost/calibrate-copilot-prices.mjs) and glass's
// status line (lib/glass/statusline.mjs in the glass tree), all through
// lib/cost/billing-rules.mjs. A second copy of the card would drift the first
// time GitHub changed a rate.
//
// Public data only: GitHub's rate card. What an organisation actually pays —
// its contract discount, the rates fitted from its own bill, dated changes —
// lives in its cost file (billing-rules.mjs header).
//
// Plain ESM with no imports: the dashboard bundles it, glass ships it as is.
//
// GitHub bills Copilot in AI credits ($0.01 each) per model, per token kind.
// Prices here are USD per 1M tokens: { in, out, cacheRead, cacheWrite }.

/** @typedef {{ in: number, out: number, cacheRead: number, cacheWrite: number }} ModelPrice */

/** Provider ids the proxy has written for Copilot-served calls (all aliases of one account). */
export const COPILOT_PROVIDERS = Object.freeze(['gh-copilot', 'copilot', 'github-copilot', 'github']);

/**
 * GitHub's per-model rate card, read from a day of Copilot usage telemetry
 * (2026-10-05/06): AIU / 1M tokens ÷ 100 = USD / MTok. The fallback for every
 * model the calibration has no (or too little) evidence for — which is most
 * models for most people.
 *
 * `in` is not the card's input rate but what a RECORDED input token costs: the
 * telemetry's input "incl. cache write" is exactly what the proxy records on
 * the OpenAI wire, so each model's observed cache-write share w is folded in —
 * in = rate_in·(1−w) + rate_write·w. w ≈ 0.9–0.99 for the Claude models, 0
 * where GitHub charges no writes (gpt-5.4, gemini, grok).
 *
 * Exact model ids: Copilot's rates do not follow the model family, so a model
 * missing here is unknown rather than priced like a sibling. An organisation's
 * own measured rates and dated rate changes are cost-file data, not rows here
 * (lib/cost/billing-rules.mjs).
 *
 * @type {Readonly<Record<string, ModelPrice>>}
 */
export const COPILOT_RATE_CARD = Object.freeze({
  'claude-sonnet-5':         { in: 2.495, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5.5':         { in: 4.996, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5.5':       { in: 2.248, out: 9, cacheRead: 0.18, cacheWrite: 2.25 },
  'claude-opus-5':           { in: 6.236, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'gpt-5.6-terra':           { in: 2.499, out: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-4.8':         { in: 6.244, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'gpt-5.4':                 { in: 5, out: 22.5, cacheRead: 0.5, cacheWrite: 5 },
  'gpt-6-luna':              { in: 0.1249, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'gpt-6-sol':               { in: 2.499, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'gpt-6.1-sol':             { in: 2.249, out: 9, cacheRead: 0.09, cacheWrite: 2.25 },
  'claude-haiku-4.5':        { in: 1.238, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'gpt-5.6-sol':             { in: 4.123, out: 20, cacheRead: 0.4, cacheWrite: 5 },
  'gemini-3.8-flash':        { in: 0.75, out: 3.75, cacheRead: 0.075, cacheWrite: 0.75 },
  'grok-4.7':                { in: 2, out: 6, cacheRead: 0.5, cacheWrite: 2 },
  'gpt-5.3-codex':           { in: 1.75, out: 14, cacheRead: 0.175, cacheWrite: 1.75 },
  'grok-4.6':                { in: 2, out: 6, cacheRead: 0.5, cacheWrite: 2 },
  'gpt-5.6-luna':            { in: 0.2497, out: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  'gpt-5.4-mini':            { in: 0.75, out: 4.5, cacheRead: 0.075, cacheWrite: 0.75 },
  'gpt-5.5':                 { in: 5, out: 30, cacheRead: 0.5, cacheWrite: 5 },
  'mai-code-1.1-flash':      { in: 0.18, out: 1.08, cacheRead: 0.018, cacheWrite: 0.225 },
  'gemini-3.7-flash':        { in: 0.75, out: 3.75, cacheRead: 0.075, cacheWrite: 0.75 },
  'gpt-5-mini':              { in: 0.25, out: 2, cacheRead: 0.025, cacheWrite: 0.25 },
  'gpt-5.2':                 { in: 1.75, out: 14, cacheRead: 0.175, cacheWrite: 1.75 },
  'gpt-5.4-mini-2026-03-17': { in: 0.75, out: 4.5, cacheRead: 0.075, cacheWrite: 0.75 },
  'gpt-5.4-2026-03-05':      { in: 2.5, out: 15, cacheRead: 0.25, cacheWrite: 2.5 },
  // Included models: the card states 0 for every kind. A known zero, not an
  // unknown rate — a call on them costs nothing.
  'gpt-4o-mini':             { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
  'gpt-4o-mini-2024-07-18':  { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
  'gpt-4.1':                 { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
  'gpt-5.4-nano':            { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
  'gpt-5.4-nano-2026-03-17': { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
});

/** Is this provider id the Copilot account? */
export function isCopilotProvider(provider) {
  return COPILOT_PROVIDERS.includes(String(provider || '').trim().toLowerCase());
}

/**
 * The proxy's model id as GitHub bills it: `claude-haiku-4-5` and
 * `claude-haiku-4.5` are one model.
 */
export function billedModel(model) {
  return String(model || '').toLowerCase().replace(/^(claude-[a-z]+-\d+)-(\d+)(-fast)?$/, '$1.$2$3');
}

/**
 * Token dollars of one row at a rate (before any contract discount).
 * `input_tokens` is fresh input on every wire — the proxy subtracts cache reads
 * at the parse boundary.
 */
export function tokenUsd(row, price) {
  return (
    (Number(row.input_tokens) || 0) * price.in +
    (Number(row.output_tokens) || 0) * price.out +
    (Number(row.cache_read_tokens) || 0) * price.cacheRead +
    (Number(row.cache_write_tokens) || 0) * price.cacheWrite
  ) / 1e6;
}
