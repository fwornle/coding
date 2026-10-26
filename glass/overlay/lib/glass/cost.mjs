// lib/glass/cost.mjs — what this month's GitHub Copilot use cost, for the status
// line's cost field, and the cost settings the UI prices with.
//
// Prices come from the one shared table (lib/cost/copilot-pricing.mjs — the
// same one coding's dashboard uses), so the status line and the Cost tab cannot
// disagree about a rate.
//
// Cost settings: an organisation that buys Copilot through a cloud contract
// states its cost as token $ × its discount ÷ its FX. None of it is code: it
// comes from two optional files, merged in this order —
//   <package>/config/cost-defaults.json   shipped with a build
//   ~/.glass/cost.json                    the user's own (wins)
// shape: { "discount": { "copilot": 0.8 }, "discountLabel": { "copilot": "…" },
//          "currency": { "usdPerEur": 1.18 }, "copilotPrices": { <model>: {…} },
//          "periods": [ { "from": "2026-03-01", "to": "2026-06-30", … } ],
//          "excludeAccounts": ["gh-copilot"], "includeCoding": false, "includeVscode": false }
// copilotPrices (measured Copilot rates) and periods (dated discounts by
// account, model family or model, dated rates and FX) are read by
// lib/cost/billing-rules.mjs, which has their shape and precedence. The user's
// periods come after the build's, so on an overlap theirs win.
//
// excludeAccounts is the account selection (all accounts count when absent): the
// daemon's usage reads leave those accounts' rows out, and an excluded GitHub
// Copilot hides the status line's cost field. includeCoding (on when absent)
// adds coding's figures where coding is installed (combined.mjs); includeVscode
// (on when absent) keeps VS Code's estimated Copilot Chat rows. Only the user's
// file sets any of them.
import fs from 'node:fs';
import path from 'node:path';

import { COPILOT_PROVIDERS, tokenUsd } from '../cost/copilot-pricing.mjs';
import { copilotPriceAt, discountAt, seatCreditUsdAt, usdPerEurAt } from '../cost/billing-rules.mjs';
import { PKG_ROOT } from './home.mjs';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The merged cost settings (see the header). Never throws; {} when neither file exists. */
export function loadCostDefaults(home, pkgRoot = PKG_ROOT) {
  const layers = [readJson(path.join(pkgRoot, 'config', 'cost-defaults.json')), readJson(path.join(home, 'cost.json'))]
    .filter((x) => x && typeof x === 'object');
  const out = {};
  for (const l of layers) {
    for (const key of ['discount', 'discountLabel', 'currency', 'copilotPrices']) {
      if (l[key] && typeof l[key] === 'object') out[key] = { ...(out[key] || {}), ...l[key] };
    }
    if (Array.isArray(l.periods)) out.periods = [...(out.periods || []), ...l.periods];
    if (Array.isArray(l.excludeAccounts)) out.excludeAccounts = l.excludeAccounts.filter((a) => typeof a === 'string');
    for (const key of ['includeCoding', 'includeVscode']) {
      if (typeof l[key] === 'boolean') out[key] = l[key];
    }
  }
  return out;
}

/**
 * Rewrites ~/.glass/cost.json through `change(current) → next`, keeping the
 * other keys. Written to a temp file and renamed, so a reader never sees half a file.
 */
function updateUserCost(home, change) {
  const file = path.join(home, 'cost.json');
  const next = change(readJson(file) || {});
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** Saves the account selection; an empty list removes the key (every account counts). */
export function saveExcludedAccounts(home, list) {
  updateUserCost(home, (current) => {
    const next = { ...current, excludeAccounts: [...new Set(list)] };
    if (!next.excludeAccounts.length) delete next.excludeAccounts;
    return next;
  });
}

/** Saves which other figures the usage views add; true (the default) removes the key. */
export function saveSources(home, { coding, vscode }) {
  updateUserCost(home, (current) => {
    const next = { ...current };
    for (const [key, on] of [['includeCoding', coding], ['includeVscode', vscode]]) {
      if (typeof on !== 'boolean') continue;
      if (on) delete next[key];
      else next[key] = false;
    }
    return next;
  });
}

const cache = { key: '', at: 0, value: null };
const TTL_MS = 30_000;

/**
 * This calendar month's (UTC — the month the bill and the Cost tab use) GitHub
 * Copilot cost: each day's tokens at the Copilot rate × the discount in force
 * that day, and in EUR ÷ that day's FX (billing-rules.mjs). A model with no
 * known GitHub rate is counted in `unpricedCalls` rather than guessed, so "≥"
 * can say the figure is a floor.
 *
 * Cached for 30 s: the status line re-renders every 5 s per session, and the
 * month's rows only grow.
 */
export function copilotMonthCost(db, costCfg = {}, now = new Date()) {
  if (!db) return null;
  // Switched off in the account selection: the field says nothing rather than €0.
  if ((costCfg.excludeAccounts || []).includes('gh-copilot')) return null;
  const month = now.toISOString().slice(0, 7);
  const key = `${month}|${JSON.stringify(costCfg)}`;
  if (cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT substr(timestamp, 1, 10) AS day, model, COUNT(*) AS calls,
             SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
             SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens
      FROM token_usage
      WHERE timestamp >= ? AND LOWER(provider) IN (${COPILOT_PROVIDERS.map(() => '?').join(', ')})
      GROUP BY day, model
    `).all(`${month}-01T00:00:00.000Z`, ...COPILOT_PROVIDERS);
  } catch { return null; }
  let usd = 0; let eur = 0; let calls = 0; let unpricedCalls = 0;
  for (const r of rows) {
    calls += Number(r.calls) || 0;
    const rate = copilotPriceAt(costCfg, r.model, r.day);
    if (!rate) { unpricedCalls += Number(r.calls) || 0; continue; }
    const rowUsd = tokenUsd(r, rate) * discountAt(costCfg, 'copilot', r.model, r.day);
    usd += rowUsd;
    eur += rowUsd / usdPerEurAt(costCfg, r.day);
  }
  // A promotion's extra included credits make the month cheaper by that much
  // list-price use, discounted and converted like the usage it offsets.
  const creditUsd = seatCreditUsdAt(costCfg, 'copilot', month) * discountAt(costCfg, 'copilot', '', month);
  const creditEur = Math.min(eur, creditUsd / usdPerEurAt(costCfg, month));
  usd = Math.max(0, usd - creditUsd);
  eur -= creditEur;
  const value = { month, usd, eur, calls, unpricedCalls, creditEur };
  Object.assign(cache, { key, at: Date.now(), value });
  return value;
}

/** `€12.34` / `€1.2k` — compact, for a status-line field. */
export function fmtEur(eur) {
  const v = Number(eur) || 0;
  if (v >= 1000) return `€${(v / 1000).toFixed(1)}k`;
  return `€${v.toFixed(2)}`;
}
