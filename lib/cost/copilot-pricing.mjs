// lib/cost/copilot-pricing.mjs — what a GitHub Copilot call costs, in USD.
//
// One module for every reader of Copilot cost: the dashboard's cost model
// (integrations/system-health-dashboard/src/components/cost/cost-model.ts), the
// calibration script (scripts/cost/calibrate-copilot-prices.mjs) and glass's
// status line (lib/glass/statusline.mjs in the glass tree). A second copy of
// these tables would drift the first time GitHub changed a rate.
//
// Plain ESM with no imports: the dashboard bundles it, glass ships it as is.
//
// GitHub bills Copilot in AI credits ($0.01 each) per model, per token kind.
// Prices here are USD per 1M tokens: { in, out, cacheRead, cacheWrite }.

/** @typedef {{ in: number, out: number, cacheRead: number, cacheWrite: number }} ModelPrice */

/** Provider ids the proxy has written for Copilot-served calls (all aliases of one account). */
export const COPILOT_PROVIDERS = Object.freeze(['gh-copilot', 'copilot', 'github-copilot', 'github']);

/**
 * Per-model rates fitted from an itemized Copilot consumption sheet
 * (2026-08-01 → 10-22, n billing rows) against this installation's recorded
 * tokens by scripts/cost/calibrate-copilot-prices.mjs — models with ≥5 billed
 * days only; the rest price from COPILOT_RATE_CARD below. Together they
 * reproduce the sheet's three months at -0.3% / +2.1% / +3.8%, $x against
 * $x billed. Most of the excess is GPT-5.6 Sol from opencode's own Copilot
 * login (+11% over the sheet, ±50% on single days), not yet explained. Re-run the script on a new sheet and paste its
 * `--json` output here when GitHub changes a rate.
 *
 * Refitted 2026-10-25, after the Copilot CLI adapter stopped counting cached
 * tokens as fresh input too: Sonnet 5 — the model most Copilot CLI sessions
 * used — had been fitted at n× list to absorb that double count; on corrected
 * rows it is n× (R² 0.993 → 0.997).
 *
 * Input rates above the card (Haiku 4.5 1.23, Opus 5 6.25) are not GitHub
 * overcharging: on the OpenAI wire a prompt-cache WRITE has no counter, so
 * Anthropic cache writes (billed 1.25x input) arrive as fresh input, and the fit
 * folds that premium into the input rate. Cache reads keep their own (0.1x) rate.
 *
 * GPT-5.6 Sol is NOT here: GitHub cut its rate in October. Fitted over the whole
 * sheet it came out at $x input (September dominates), and every October
 * day then read n× its bill, whatever its cache share — a price, not a
 * counting error. October alone fits k n (R² 0.999, 9 days), which is the
 * rate card's $4.12, so the card prices it; September's rate is in
 * COPILOT_PRICE_HISTORY.
 *
 * Haiku 5.5 billed ~0.1x the Haiku 4.5 rate on all 7 days seen — launch
 * pricing, probably; it is newer than the rate card, so the fit is all there is.
 *
 * @type {Readonly<Record<string, ModelPrice>>}
 */
export const CALIBRATED_COPILOT_PRICES = Object.freeze({
});

/**
 * Rates GitHub charged before it changed them, per model, oldest change first:
 * `before` is the first month (YYYY-MM) of the next rate. Fitted on that period
 * alone, like the calibrated table.
 *
 * @type {Readonly<Record<string, ReadonlyArray<{ before: string, price: ModelPrice }>>>}
 */
export const COPILOT_PRICE_HISTORY = Object.freeze({
  // 2026-09 alone: k n on n billed days; n× the bill on every October day.
});

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
 * Checked against an itemized sheet: within ±5% for Haiku 4.5, Opus 5, Opus 4.8,
 * Gemini 3.8 Flash, GPT-5-mini, GPT-5.6 Luna; Sonnet 5 +11% (a workload that
 * writes less cache than average — a calibrated row wins there). Sonnet 5.5 and
 * GPT-6.1 Sol were billed 4.5–6x below this card on 4 and 1 days of data — too
 * thin to trust over the card, so they price here.
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
 * GitHub's rate for one model: the calibrated table first (`calibrated` — the
 * caller's merged table, defaults plus operator edits), then the rate card;
 * exact ids only. A `-fast` id with no row of its own takes its base model's
 * rate: GitHub bills fast mode under the base model (one Opus 4.8 fast day in
 * the sheet billed $x, against $x at n× and $x at the API's n× rule).
 *
 * Exact ids, never a family fallback: Copilot's rates do not follow the model
 * family (Sonnet 5 bills at ~0.6x Sonnet 4.6; Haiku 5.5 at ~0.1x Haiku 4.5).
 * null when GitHub's rate is unknown — the caller decides the fallback.
 *
 * `at` (a month or a timestamp) prices a past month at what GitHub charged then
 * (COPILOT_PRICE_HISTORY); without it, the current rate.
 *
 * @param {string} model
 * @param {Record<string, ModelPrice>} [calibrated]
 * @param {string} [at] YYYY-MM or an ISO timestamp
 * @returns {ModelPrice | null}
 */
export function copilotRate(model, calibrated = CALIBRATED_COPILOT_PRICES, at = '') {
  const m = billedModel(model);
  const base = m.endsWith('-fast') ? m.slice(0, -'-fast'.length) : m;
  const month = String(at || '').slice(0, 7);
  if (month) {
    for (const key of [m, base]) {
      const old = (COPILOT_PRICE_HISTORY[key] || []).find((h) => month < h.before);
      if (old) return old.price;
    }
  }
  for (const table of [calibrated || {}, COPILOT_RATE_CARD]) {
    if (table[m]) return table[m];
    if (table[base]) return table[base];
  }
  return null;
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
