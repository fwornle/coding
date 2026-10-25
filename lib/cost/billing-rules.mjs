// lib/cost/billing-rules.mjs — the discount, exchange rate and Copilot rate in
// force for one row, on the day it ran.
//
// A bill is not one number per account: a contract discount starts and ends, a
// promotion covers one model or a model family for a few months, GitHub changes
// a model's rate, the FX an organisation books at moves. All of that is data —
// an organisation's cost file (glass: config/cost-defaults.json shipped with a
// build, then ~/.glass/cost.json; coding: the proxy's `cost` settings) — and
// this module is the one reading of it, for the status line, the Cost tab and
// the dashboard alike. Plain ESM; its one import is the public rate card.
//
// Shape (every key optional):
//   discount:      { <account>: factor }          standing, per account
//   currency:      { usdPerEur }                  standing FX
//   copilotPrices: { <model>: ModelPrice }        standing GitHub Copilot rates
//   periods: [{
//     from, to,        YYYY-MM-DD or YYYY-MM, both inclusive, UTC; open when absent
//     account,         whose discount it sets (default "copilot")
//     discount,        factor for every model of that account
//     families,        { "<model id prefix>": factor }   e.g. "claude-opus"
//     models,          { "<model id>": factor }
//     prices,          { "<model id>": ModelPrice }      Copilot rates in force then
//     usdPerEur,       FX in force then (every account)
//     note,            free text, for the reader of the file
//   }]
//
// Resolution for a row of account A, model M, day D — over the periods that
// cover D (and, for discounts and prices, belong to A):
//   discount  the most specific rule wins: models[M], then the longest families
//             prefix of M, then a period's discount, then the standing
//             discount[A], then 1. A factor REPLACES the broader one rather than
//             multiplying it: write the product (0.8 × 0.9 = 0.72) when a
//             promotion comes on top of a contract. At equal specificity the
//             period listed later wins.
//   prices    the latest period with prices[M], then copilotPrices[M], then
//             GitHub's rate card, then null (unknown — the caller decides).
//             A `-fast` id without a row of its own takes its base model's.
//   usdPerEur the latest period with usdPerEur, then currency.usdPerEur, then 1.18.
//
// A factor is token dollars × factor: 0.8 is 20% off, 1.1 a 10% surcharge.

import { COPILOT_RATE_CARD, billedModel } from './copilot-pricing.mjs';

/** @typedef {import('./copilot-pricing.mjs').ModelPrice} ModelPrice */

export const DEFAULT_USD_PER_EUR = 1.18;

const DAY = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

/** A row's time — an ISO timestamp, a YYYY-MM-DD day or a YYYY-MM month — as its UTC day. */
export function dayOf(at) {
  const s = String(at || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return new Date().toISOString().slice(0, 10);
}

const fromDay = (v) => (String(v).length === 7 ? `${v}-01` : String(v).slice(0, 10));
// "-31" sorts after every day of any month, so a month-only `to` covers its last day.
const toDay = (v) => (String(v).length === 7 ? `${v}-31` : String(v).slice(0, 10));

const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

function covers(p, day) {
  return (!p.from || day >= fromDay(p.from)) && (!p.to || day <= toDay(p.to));
}

const periodsOf = (cfg) => (Array.isArray(cfg?.periods) ? cfg.periods.filter((p) => p && typeof p === 'object') : []);
const accountOf = (p) => String(p.account || 'copilot');
const baseOf = (m) => (m.endsWith('-fast') ? m.slice(0, -'-fast'.length) : m);

/** Does a family prefix name this model ("claude-opus" → claude-opus-5, claude-opus-4.8)? */
function inFamily(model, prefix) {
  const f = String(prefix).toLowerCase();
  return model === f || model.startsWith(`${f}-`) || model.startsWith(`${f}.`);
}

/**
 * The discount factor for a row of `account` on `model` at `at`.
 *
 * @param {object} cfg cost settings (see the header)
 * @param {string} account budget key: copilot, claude-max, …
 * @param {string} model
 * @param {string} [at] timestamp, day or month; today when absent
 */
export function discountAt(cfg, account, model, at) {
  const day = dayOf(at);
  const m = billedModel(model);
  const live = periodsOf(cfg).filter((p) => accountOf(p) === account && covers(p, day));
  for (let i = live.length - 1; i >= 0; i--) {
    const models = live[i].models || {};
    for (const key of [m, baseOf(m)]) if (positive(models[key])) return Number(models[key]);
  }
  let best = null;
  live.forEach((p) => {
    for (const [prefix, f] of Object.entries(p.families || {})) {
      if (!positive(f) || !inFamily(baseOf(m), prefix)) continue;
      if (!best || prefix.length >= best.len) best = { len: prefix.length, f: Number(f) };
    }
  });
  if (best) return best.f;
  for (let i = live.length - 1; i >= 0; i--) if (positive(live[i].discount)) return Number(live[i].discount);
  const standing = cfg?.discount?.[account];
  return positive(standing) ? Number(standing) : 1;
}

/**
 * GitHub Copilot's rate for `model` at `at`: a dated period's, then the cost
 * file's standing table, then GitHub's rate card. null when none knows it.
 *
 * @returns {ModelPrice | null}
 */
export function copilotPriceAt(cfg, model, at) {
  const day = dayOf(at);
  const m = billedModel(model);
  const keys = [m, baseOf(m)];
  const live = periodsOf(cfg).filter((p) => accountOf(p) === 'copilot' && covers(p, day));
  for (let i = live.length - 1; i >= 0; i--) {
    for (const key of keys) if (live[i].prices?.[key]) return live[i].prices[key];
  }
  for (const table of [cfg?.copilotPrices || {}, COPILOT_RATE_CARD]) {
    for (const key of keys) if (table[key]) return table[key];
  }
  return null;
}

/** USD per EUR at `at`: a dated period's, then the standing one, then 1.18. */
export function usdPerEurAt(cfg, at) {
  const day = dayOf(at);
  const live = periodsOf(cfg).filter((p) => covers(p, day));
  for (let i = live.length - 1; i >= 0; i--) if (positive(live[i].usdPerEur)) return Number(live[i].usdPerEur);
  return positive(cfg?.currency?.usdPerEur) ? Number(cfg.currency.usdPerEur) : DEFAULT_USD_PER_EUR;
}

/**
 * What is wrong with a cost file's periods, one line each; [] when nothing is.
 * Pricing never throws on a bad entry — it is skipped — so this is how a typo
 * gets noticed instead of silently pricing at the standing rate.
 */
export function billingProblems(cfg) {
  const out = [];
  if (cfg?.periods !== undefined && !Array.isArray(cfg.periods)) return ['periods: not a list'];
  periodsOf(cfg).forEach((p, i) => {
    const at = `periods[${i}]${p.note ? ` (${p.note})` : ''}`;
    for (const k of ['from', 'to']) if (p[k] !== undefined && !DAY.test(String(p[k]))) out.push(`${at}: ${k} "${p[k]}" is not YYYY-MM-DD or YYYY-MM`);
    if (p.from && p.to && DAY.test(String(p.from)) && DAY.test(String(p.to)) && fromDay(p.from) > toDay(p.to)) out.push(`${at}: from is after to`);
    for (const k of ['discount', 'usdPerEur']) if (p[k] !== undefined && !positive(p[k])) out.push(`${at}: ${k} must be a number above 0`);
    for (const k of ['families', 'models']) {
      for (const [key, f] of Object.entries(p[k] || {})) if (!positive(f)) out.push(`${at}: ${k}.${key} must be a number above 0`);
    }
    for (const [model, price] of Object.entries(p.prices || {})) {
      if (!['in', 'out', 'cacheRead', 'cacheWrite'].every((f) => Number.isFinite(Number(price?.[f])))) out.push(`${at}: prices.${model} needs in, out, cacheRead and cacheWrite`);
    }
    const known = new Set(['from', 'to', 'account', 'discount', 'families', 'models', 'prices', 'usdPerEur', 'note']);
    for (const k of Object.keys(p)) if (!known.has(k)) out.push(`${at}: unknown key "${k}"`);
  });
  return out;
}
