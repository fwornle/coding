// lib/glass/cost.mjs — what this month's GitHub Copilot use cost, for the status
// line's cost field, and the cost settings the UI prices with.
//
// Prices come from the one shared table (lib/cost/copilot-pricing.mjs — the
// same one coding's dashboard uses), so the status line and the Cost tab cannot
// disagree about a rate.
//
// Cost settings: an organisation that buys Copilot through a cloud contract
// states its cost as token $ × its discount ÷ its FX. Neither is code: both come
// from two optional files, merged in this order —
//   <package>/config/cost-defaults.json   shipped with a build
//   ~/.glass/cost.json                    the user's own (wins)
// shape: { "discount": { "copilot": 0.8 }, "discountLabel": { "copilot": "…" },
//          "currency": { "usdPerEur": 1.18 } }
import fs from 'node:fs';
import path from 'node:path';

import { COPILOT_PROVIDERS, copilotRate, tokenUsd } from '../cost/copilot-pricing.mjs';
import { PKG_ROOT } from './home.mjs';

const DEFAULT_USD_PER_EUR = 1.18;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The merged cost settings (see the header). Never throws; {} when neither file exists. */
export function loadCostDefaults(home, pkgRoot = PKG_ROOT) {
  const layers = [readJson(path.join(pkgRoot, 'config', 'cost-defaults.json')), readJson(path.join(home, 'cost.json'))]
    .filter((x) => x && typeof x === 'object');
  const out = {};
  for (const l of layers) {
    for (const key of ['discount', 'discountLabel', 'currency']) {
      if (l[key] && typeof l[key] === 'object') out[key] = { ...(out[key] || {}), ...l[key] };
    }
  }
  return out;
}

const cache = { key: '', at: 0, value: null };
const TTL_MS = 30_000;

/**
 * This calendar month's (UTC — the month the bill and the Cost tab use) GitHub
 * Copilot cost: token $ at GitHub's per-model rates × the contract discount,
 * and in EUR ÷ FX. A model with no known GitHub rate is counted in
 * `unpricedCalls` rather than guessed, so "≥" can say the figure is a floor.
 *
 * Cached for 30 s: the status line re-renders every 5 s per session, and the
 * month's rows only grow.
 */
export function copilotMonthCost(db, costCfg = {}, now = new Date()) {
  if (!db) return null;
  const month = now.toISOString().slice(0, 7);
  const discount = Number(costCfg.discount?.copilot) > 0 ? Number(costCfg.discount.copilot) : 1;
  const usdPerEur = Number(costCfg.currency?.usdPerEur) > 0 ? Number(costCfg.currency.usdPerEur) : DEFAULT_USD_PER_EUR;
  const key = `${month}|${discount}|${usdPerEur}`;
  if (cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT model, COUNT(*) AS calls,
             SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
             SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens
      FROM token_usage
      WHERE timestamp >= ? AND LOWER(provider) IN (${COPILOT_PROVIDERS.map(() => '?').join(', ')})
      GROUP BY model
    `).all(`${month}-01T00:00:00.000Z`, ...COPILOT_PROVIDERS);
  } catch { return null; }
  let usd = 0; let calls = 0; let unpricedCalls = 0;
  for (const r of rows) {
    calls += Number(r.calls) || 0;
    const rate = copilotRate(r.model);
    if (!rate) { unpricedCalls += Number(r.calls) || 0; continue; }
    usd += tokenUsd(r, rate) * discount;
  }
  const value = { month, usd, eur: usd / usdPerEur, calls, unpricedCalls };
  Object.assign(cache, { key, at: Date.now(), value });
  return value;
}

/** `€12.34` / `€1.2k` — compact, for a status-line field. */
export function fmtEur(eur) {
  const v = Number(eur) || 0;
  if (v >= 1000) return `€${(v / 1000).toFixed(1)}k`;
  return `€${v.toFixed(2)}`;
}
