#!/usr/bin/env node
/**
 * Fit per-model GitHub Copilot prices from an itemized consumption sheet.
 *
 * WHY. GitHub Copilot bills in AI credits ($0.01 each) per model per day. The
 * proxy records tokens, not credits, and for several models GitHub's rate is NOT
 * the vendor's list price: measured against a 2026-08..10 itemized sheet, Sonnet 4.6
 * and Opus 5 sit at list, Sonnet 5 at a flat 2/3 of list, Haiku 5.5 at ~1/8. A
 * single list-price table therefore misstates the real Copilot spend by up to
 * 8x per model. This script derives the table from the sheet instead.
 *
 * CACHING. The token row splits a call into fresh input, output, cache reads and
 * cache writes, each priced differently (Anthropic family: 1x / 5x / 0.1x /
 * 1.25x of input). On the OpenAI wire Copilot speaks, a cache WRITE has no
 * counter — `prompt_tokens_details` carries only `cached_tokens` — so tokens that
 * Copilot wrote to the cache (and billed at 1.25x) arrive as plain fresh input.
 * That is visible in the data: Haiku 4.5 tracks list price at 1.00x through
 * mid-September, then 1.23x from 2026-09-19, when consolidator-mentions began
 * sending large, never-reused prefixes. The fit therefore has two parameters per
 * model:
 *
 *   cost_day ≈ k · ( μ·in·P_in + out·P_out + cacheRead·P_cr + cacheWrite·P_cw )
 *
 *   k  — GitHub's price level for that model, relative to the base table
 *   μ  — the hidden cache-write premium on fresh input, constrained to [1, 1.25]
 *
 * and the calibrated row is k·(μ·P_in, P_out, P_cr, P_cw). The ratios inside a
 * model's price vector are kept from the base table on purpose: output and cache
 * reads are too small a share of most days to be fitted independently, and a
 * free four-parameter fit on ~30 points returns prices nobody could defend.
 *
 * Models without a base row (GPT, Gemini) use a generic OpenAI-shaped vector
 * (1 / 8 / 0.1 / 0) and k comes out as the $/MTok input rate.
 *
 * Usage:
 *   node scripts/cost/calibrate-copilot-prices.mjs --sheet=<…_consumption_source.json>
 *        [--db=PATH] [--since=YYYY-MM-DD] [--json]
 *
 *   --since  fit window start (default: the sheet's own start). Narrow it when
 *            GitHub changes a rate mid-sheet, so the current regime wins.
 *   --min-days  days of personal evidence a model needs to be fitted (default
 *            5). Below it the model is left to GitHub's company-wide rate card
 *            (COPILOT_RATE_CARD in cost-model.ts): a 1–4 day fit once priced
 *            Sonnet 5.5 at n× a card it was later billed n× above.
 *   --json   print only the `copilotPrices` block, for pasting into
 *            CALIBRATED_COPILOT_PRICES or PUT /api/llm/settings
 *
 * Read-only: the DB is opened readOnly and nothing is written anywhere.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

import { COPILOT_PROVIDERS } from '../../lib/cost/copilot-pricing.mjs';

const require = createRequire(import.meta.url);
const { tokenUsageDb } = require('../../lib/paths/data-home.cjs');

/** One AI credit, in USD. The sheet's gross_amount is quantity × this. */
const CREDIT_USD = 0.01;

/** Vendor list price per family, USD/MTok: in, out, cacheRead, cacheWrite. */
const BASE = {
  haiku: [1, 5, 0.1, 1.25],
  sonnet: [3, 15, 0.3, 3.75],
  opus: [5, 25, 0.5, 6.25],
  fable: [10, 50, 1, 12.5],
  generic: [1, 8, 0.1, 0],
};

const MU_MAX = 1.25; // a hidden cache write costs at most the write rate

const say = (msg = '') => process.stdout.write(`${msg}\n`);

function parseArgs(argv) {
  const args = { json: false, minDays: 5 };
  for (const a of argv) {
    if (a.startsWith('--sheet=')) args.sheet = path.resolve(a.slice(8));
    else if (a.startsWith('--db=')) args.db = path.resolve(a.slice(5));
    else if (a.startsWith('--since=')) args.since = a.slice(8);
    else if (a.startsWith('--min-days=')) args.minDays = Number(a.slice(11));
    else if (a === '--json') args.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.sheet) throw new Error('--sheet=<consumption_source.json> is required');
  return args;
}

/** "Claude Haiku 4.5" / "Auto: GPT-6 Luna" → the proxy's model id. */
export function sheetModelId(label) {
  return label.toLowerCase().replace(/^auto:\s*/, '').trim().replace(/\s+/g, '-');
}

/**
 * The proxy's model id, folded to what GitHub bills. `claude-haiku-4-5` and
 * `claude-haiku-4.5` are one model; a `-fast` turn is billed under its base
 * model (the sheet has no fast-mode line).
 */
export function billedModelId(model) {
  return model.toLowerCase().replace(/-fast$/, '').replace(/^(claude-[a-z]+-\d+)-(\d+)$/, '$1.$2');
}

function baseVector(model) {
  for (const fam of ['haiku', 'sonnet', 'opus', 'fable']) if (model.includes(fam)) return { fam, p: BASE[fam] };
  return { fam: 'generic', p: BASE.generic };
}

/**
 * Least-squares fit of k for each μ on a 0.01 grid; returns the best pair.
 * Exported for the test.
 */
export function fitModel(days, p) {
  let best = null;
  for (let step = 0; step <= Math.round((MU_MAX - 1) * 100); step++) {
    const mu = 1 + step / 100;
    const xs = days.map((d) => (mu * d.in * p[0] + d.out * p[1] + d.cr * p[2] + d.cw * p[3]) / 1e6);
    let sxy = 0; let sxx = 0;
    days.forEach((d, i) => { sxy += xs[i] * d.usd; sxx += xs[i] * xs[i]; });
    if (sxx === 0) continue;
    const k = sxy / sxx;
    const sse = days.reduce((s, d, i) => s + (d.usd - k * xs[i]) ** 2, 0);
    if (!best || sse < best.sse - 1e-12) best = { k, mu, sse };
  }
  if (!best) return null;
  const mean = days.reduce((s, d) => s + d.usd, 0) / days.length;
  const sst = days.reduce((s, d) => s + (d.usd - mean) ** 2, 0);
  return { ...best, r2: sst > 0 ? 1 - best.sse / sst : 1 };
}

const round = (n) => Math.round(n * 10000) / 10000;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sheet = JSON.parse(fs.readFileSync(args.sheet, 'utf8'));
  const lastDay = sheet.end;
  const since = args.since || sheet.start;

  // Sheet: USD per (day, model). Credits × $0.01 — recomputed rather than read
  // from gross_amount so a sheet that rounds the amount column cannot skew it.
  const billed = new Map();
  for (const r of sheet.billing) {
    if (r.report_date < since || r.report_date > lastDay) continue;
    const key = `${r.report_date}|${sheetModelId(r.model)}`;
    billed.set(key, (billed.get(key) || 0) + Number(r.quantity) * CREDIT_USD);
  }

  const db = new DatabaseSync(args.db || tokenUsageDb(), { readOnly: true });
  const rows = db.prepare(`
    SELECT substr(timestamp, 1, 10) AS day, model,
           SUM(input_tokens) AS inp, SUM(output_tokens) AS outp,
           SUM(cache_read_tokens) AS cr, SUM(cache_write_tokens) AS cw
    FROM token_usage
    WHERE provider IN (${COPILOT_PROVIDERS.map(() => '?').join(',')})
      AND timestamp >= ? AND timestamp < date(?, '+1 day')
    GROUP BY day, model
  `).all(...COPILOT_PROVIDERS, since, lastDay);
  db.close();

  const recorded = new Map();
  const fastSeen = new Set();
  for (const r of rows) {
    const m = billedModelId(r.model);
    if (r.model.toLowerCase().endsWith('-fast')) fastSeen.add(m);
    const key = `${r.day}|${m}`;
    const cur = recorded.get(key) || { in: 0, out: 0, cr: 0, cw: 0 };
    cur.in += r.inp; cur.out += r.outp; cur.cr += r.cr; cur.cw += r.cw;
    recorded.set(key, cur);
  }

  const models = new Set([...billed.keys(), ...recorded.keys()].map((k) => k.split('|')[1]));
  const prices = {};
  const report = [];
  for (const model of [...models].sort()) {
    const days = [];
    let sheetUsd = 0;
    for (const [key, usd] of billed) if (key.endsWith(`|${model}`)) sheetUsd += usd;
    for (const [key, tok] of recorded) {
      if (!key.endsWith(`|${model}`)) continue;
      days.push({ ...tok, usd: billed.get(key) || 0 });
    }
    const { fam, p } = baseVector(model);
    const tokens = days.reduce((s, d) => s + d.in + d.out + d.cr + d.cw, 0);
    // Below a quarter of evidence the fit is noise; leave the model on its base
    // row (the family fallback in cost-model.ts) rather than invent a rate. Kept
    // low on purpose: gpt-5-mini billed $x for nM tokens, and its family
    // fallback (gpt-5 list) would price the same tokens ~8x higher.
    const billedDays = days.filter((d) => d.usd > 0).length;
    if (sheetUsd < 0.25 || tokens === 0 || billedDays < args.minDays) {
      if (sheetUsd > 0 || tokens > 0) {
        report.push({
          model, sheetUsd, tokens,
          note: tokens === 0 ? 'billed, never seen by the proxy'
            : billedDays < args.minDays ? `${billedDays} billed day(s) — left to the rate card`
            : 'too little spend to fit',
        });
      }
      continue;
    }
    const fit = fitModel(days, p);
    if (!fit) continue;
    const price = {
      in: round(fit.k * fit.mu * p[0]),
      out: round(fit.k * p[1]),
      cacheRead: round(fit.k * p[2]),
      cacheWrite: round(fit.k * p[3]),
    };
    prices[model] = price;
    // GitHub bills a fast-mode turn at its base model's rate; an explicit row
    // keeps cost-model.ts's 2x fast-mode rule (an Anthropic-API fact) off it.
    if (fastSeen.has(model)) prices[`${model}-fast`] = price;
    const fittedUsd = days.reduce((s, d) => s + (d.in * price.in + d.out * price.out + d.cr * price.cacheRead + d.cw * price.cacheWrite) / 1e6, 0);
    report.push({ model, fam, sheetUsd, fittedUsd, k: fit.k, mu: fit.mu, r2: fit.r2, days: days.length, tokens });
  }

  // Month reconciliation: what the calibrated table predicts against what the
  // sheet billed, so a stale table shows up as a drifting month, not a guess.
  const months = new Map();
  const monthOf = (key) => key.slice(0, 7);
  for (const [key, usd] of billed) {
    const m = months.get(monthOf(key)) || { sheet: 0, predicted: 0 };
    m.sheet += usd; months.set(monthOf(key), m);
  }
  for (const [key, d] of recorded) {
    const price = prices[key.split('|')[1]];
    if (!price) continue;
    const m = months.get(monthOf(key)) || { sheet: 0, predicted: 0 };
    m.predicted += (d.in * price.in + d.out * price.out + d.cr * price.cacheRead + d.cw * price.cacheWrite) / 1e6;
    months.set(monthOf(key), m);
  }

  if (args.json) {
    say(JSON.stringify({ copilotPrices: prices }, null, 2));
    return;
  }
  say(`fit window ${since} .. ${lastDay}  (sheet ${path.basename(args.sheet)})\n`);
  say('model                 base     k      μ     R²     days   sheet $   fitted $   tokens');
  for (const r of report) {
    if (r.note) {
      say(`${r.model.padEnd(21)} ${''.padEnd(39)} ${r.sheetUsd.toFixed(2).padStart(8)}   ${''.padStart(8)}   ${(r.tokens / 1e6).toFixed(1)}M  — ${r.note}`);
      continue;
    }
    say(`${r.model.padEnd(21)} ${r.fam.padEnd(8)} ${r.k.toFixed(3).padStart(5)}  ${r.mu.toFixed(2)}  ${r.r2.toFixed(3)}  ${String(r.days).padStart(4)}  ${r.sheetUsd.toFixed(2).padStart(8)}   ${r.fittedUsd.toFixed(2).padStart(8)}   ${(r.tokens / 1e6).toFixed(1)}M`);
  }
  say('\nmonth      sheet $   predicted $');
  for (const [m, v] of [...months].sort()) say(`${m}  ${v.sheet.toFixed(2).padStart(9)}   ${v.predicted.toFixed(2).padStart(9)}`);
  say(`\n${JSON.stringify({ copilotPrices: prices }, null, 2)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (err) { process.stderr.write(`calibrate-copilot-prices: ${err.message}\n`); process.exit(1); }
}
