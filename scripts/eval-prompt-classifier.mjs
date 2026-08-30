#!/usr/bin/env node
/**
 * scripts/eval-prompt-classifier.mjs — does the prompt classifier work?
 *
 * The classifier ships OFF (config/llm-routing.yaml `classifier.enabled: false`
 * in rapid-llm-proxy). This is what decides whether to turn it on. Nothing here
 * changes any config; it only measures.
 *
 * ── The one metric that matters ─────────────────────────────────────────────
 * PRECISION ON `small`. The classifier is downgrade-only, so a wrong `medium`
 * or `high` verdict changes nothing — the declared band already stood. Only a
 * wrong `small` does damage, by spending a real turn on a weaker model. Overall
 * accuracy would average that asymmetry away and report a number nobody should
 * act on.
 *
 * ── Two modes, because they answer different questions ──────────────────────
 *   (default)   labelled  — precision/recall against tests/fixtures/
 *                           prompt-classifier-labels.json. Needs a live
 *                           endpoint. Answers "is it right?"
 *   --corpus    structural — replays the free stages (gate + veto) over the
 *                           real captured turns in the context-turns.jsonl
 *                           files under .data/measurements/. Needs nothing
 *                           running. Answers "how much would it even look at,
 *                           and what does it refuse to touch?"
 *
 * Usage:
 *   node scripts/eval-prompt-classifier.mjs                 # labelled, live endpoint
 *   node scripts/eval-prompt-classifier.mjs --corpus        # structural, offline
 *   node scripts/eval-prompt-classifier.mjs --gate=0.9      # exit 1 below this precision
 *   node scripts/eval-prompt-classifier.mjs --base-url=...  # default $CLASSIFIER_BASE_URL
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifierEligibility, lastUserText, vetoesDowngrade, applyDowngrade, SKIP,
} from '../../_work/rapid-llm-proxy/proxy-bridge/prompt-classifier.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const has = (n) => argv.includes(`--${n}`);

const BASE_URL = flag('base-url', process.env.CLASSIFIER_BASE_URL || 'http://127.0.0.1:8081/v1');
const MODEL = flag('model', process.env.CLASSIFIER_MODEL || 'qwen3.8-27b-local');
const TIMEOUT_MS = Number(flag('timeout', '20000'));
const GATE = Number(flag('gate', '0.9'));

// Must stay byte-identical to CLASSIFIER_RUBRIC in rapid-llm-proxy's server.mjs.
// A number measured against a different prompt than production sends is not a
// measurement of production.
const RUBRIC = [
  'You route requests to a model tier. Answer with EXACTLY one word: small, medium, or high.',
  'small  = trivial factual/lookup/formatting, one-step, no code reasoning, no tools needed.',
  'medium = ordinary single-file coding, explanation, or multi-step reasoning.',
  'high   = multi-file refactor, architecture, debugging across systems, or subtle correctness.',
].join('\n');

/** Agents whose routes are `complexity: from-caller`, i.e. the only ones classifiable. */
const IN_SCOPE_AGENTS = new Set(['opencode', 'pi', 'copilot']);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a');

async function verdictFor(text) {
  const t0 = Date.now();
  const r = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CLASSIFIER_API_KEY ? { Authorization: `Bearer ${process.env.CLASSIFIER_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: RUBRIC }, { role: 'user', content: text }],
      max_tokens: 3,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return { band: (j?.choices?.[0]?.message?.content || '').trim().toLowerCase(), ms: Date.now() - t0 };
}

// ── Mode: structural replay over the captured corpus ─────────────────────────

function corpusFiles() {
  const root = path.join(REPO, '.data', 'measurements');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((d) => path.join(root, d, 'context-turns.jsonl'))
    .filter((f) => fs.existsSync(f));
}

function runCorpus() {
  const files = corpusFiles();
  if (!files.length) {
    process.stdout.write('No context-turns.jsonl found under .data/measurements — nothing to replay.\n');
    return 0;
  }
  const stats = { turns: 0, outOfScope: 0, byAgent: {}, eligible: 0, vetoed: 0, reasons: {}, wouldAsk: 0 };
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      const msgs = (d.messages || []).map((m) => ({
        role: m.role,
        content: m.preview ?? '',
        // Re-present the recorded tool metadata in a shape toolMeta() detects,
        // so the gate under test is the production one rather than a copy.
        ...(m.tool ? { tool_calls: [{ function: { name: m.tool.name || 'tool' } }] } : {}),
      }));
      const agent = d.agent || '(unattributed)';
      stats.byAgent[agent] = (stats.byAgent[agent] || 0) + 1;

      // Only the agents whose routes are `from-caller` can ever be classified.
      // fg-chat/claude is pinned `high` AND arrives on the Anthropic wire as a
      // verbatim /v1/messages passthrough, so it never reaches this code at all
      // — and it is 89% of the corpus. Counting it would report a hot-path tax
      // over traffic the classifier cannot touch, which is the kind of number
      // that looks alarming and means nothing.
      if (!IN_SCOPE_AGENTS.has(agent)) { stats.outOfScope += 1; continue; }
      stats.turns += 1;

      // Every captured turn is treated as a from-caller route declaring `high`,
      // which is the most permissive case — so these counts are an UPPER BOUND
      // on how much the classifier would ever look at.
      const g = classifierEligibility({
        bandSource: 'caller', declaredBand: 'high', messages: msgs, maxBytes: 20000,
      });
      if (!g.eligible) {
        stats.reasons[g.reason] = (stats.reasons[g.reason] || 0) + 1;
        continue;
      }
      stats.eligible += 1;
      const text = lastUserText(msgs);
      if (!text) { stats.reasons[SKIP.NO_USER_TEXT] = (stats.reasons[SKIP.NO_USER_TEXT] || 0) + 1; continue; }
      if (vetoesDowngrade(text)) { stats.vetoed += 1; continue; }
      stats.wouldAsk += 1;
    }
  }

  process.stdout.write('\nStructural replay over captured turns (no endpoint needed)\n');
  process.stdout.write(`${'='.repeat(66)}\n`);
  process.stdout.write(`  files                 ${files.length}\n`);
  process.stdout.write(`  by agent              ${Object.entries(stats.byAgent).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')}\n`);
  process.stdout.write(`  out of scope          ${stats.outOfScope} (claude is pinned high on a passthrough; never classified)\n`);
  process.stdout.write(`  IN SCOPE              ${stats.turns} turns from ${[...IN_SCOPE_AGENTS].join('/')}\n`);
  process.stdout.write(`\n  passed the gate       ${stats.eligible} (${pct(stats.eligible, stats.turns)})\n`);
  for (const [reason, n] of Object.entries(stats.reasons).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`    gated: ${reason.padEnd(46)} ${String(n).padStart(6)} (${pct(n, stats.turns)})\n`);
  }
  process.stdout.write(`\n  vetoed by stage 1     ${stats.vetoed} (${pct(stats.vetoed, stats.turns)} of all turns)\n`);
  process.stdout.write(`  WOULD COST A CALL     ${stats.wouldAsk} (${pct(stats.wouldAsk, stats.turns)} of all turns)\n`);
  process.stdout.write('\n  The last line is the hot-path tax: everything else was decided for free.\n\n');
  return 0;
}

// ── Mode: labelled precision ─────────────────────────────────────────────────

async function runLabelled() {
  const fixture = path.join(REPO, 'tests', 'fixtures', 'prompt-classifier-labels.json');
  const { cases } = JSON.parse(fs.readFileSync(fixture, 'utf8'));

  const rows = [];
  for (const c of cases) {
    // Stage 1 runs first in production, so it must run first here too: a vetoed
    // case never reaches the model and its outcome is "no change", not a verdict.
    if (vetoesDowngrade(c.text)) {
      rows.push({ ...c, got: '(vetoed)', ms: 0 });
      continue;
    }
    try {
      const { band, ms } = await verdictFor(c.text);
      rows.push({ ...c, got: band, ms });
    } catch (e) {
      rows.push({ ...c, got: `(error: ${e.message})`, ms: 0 });
    }
  }

  // Production applies the verdict downgrade-only against a declared band. A
  // case is a DEFECT only if the classifier would actually have lowered a band
  // it should not have, which is what applyDowngrade decides.
  let smallPredicted = 0;
  let smallCorrect = 0;
  const defects = [];
  let smallLabelled = 0;
  let smallRecalled = 0;

  for (const r of rows) {
    const isSmallLabel = r.label === 'small';
    if (isSmallLabel) smallLabelled += 1;
    const declared = isSmallLabel ? 'medium' : r.label;   // something to lower FROM
    const lowered = applyDowngrade(declared, r.got).lowered;
    if (r.got === 'small' && lowered) {
      smallPredicted += 1;
      if (isSmallLabel) { smallCorrect += 1; smallRecalled += 1; } else defects.push(r);
    }
  }

  const lat = rows.filter((r) => r.ms > 0).map((r) => r.ms).sort((a, b) => a - b);
  const precision = smallPredicted ? smallCorrect / smallPredicted : 1;

  process.stdout.write(`\nLabelled evaluation — ${BASE_URL} (${MODEL})\n${'='.repeat(66)}\n`);
  for (const r of rows) {
    const mark = r.got === r.label ? 'ok  ' : (defects.includes(r) ? 'BAD ' : '~   ');
    process.stdout.write(`  ${mark} label=${String(r.label).padEnd(7)} got=${String(r.got).padEnd(11)} ${String(r.ms).padStart(5)}ms  ${r.text.slice(0, 58)}\n`);
  }

  process.stdout.write(`\n  cases                    ${rows.length}\n`);
  process.stdout.write(`  latency  median/p90/max  ${lat.length ? `${lat[Math.floor(lat.length / 2)]}/${lat[Math.floor(lat.length * 0.9)]}/${lat[lat.length - 1]}ms` : 'n/a'}\n`);
  process.stdout.write(`  downgrades proposed      ${smallPredicted}\n`);
  process.stdout.write(`  PRECISION ON small       ${smallCorrect}/${smallPredicted} = ${(precision * 100).toFixed(0)}%   <- the gate\n`);
  process.stdout.write(`  recall on small          ${smallRecalled}/${smallLabelled} = ${pct(smallRecalled, smallLabelled)}   (missed savings, not damage)\n`);

  if (defects.length) {
    process.stdout.write('\n  FALSE DOWNGRADES — each one spends a real turn on a weaker model:\n');
    for (const d of defects) process.stdout.write(`    labelled ${d.label}: ${d.text.slice(0, 70)}\n`);
  } else {
    process.stdout.write('\n  No false downgrades.\n');
  }

  const pass = precision >= GATE && smallPredicted > 0;
  process.stdout.write(`\n  ${pass ? 'PASS' : 'FAIL'} — gate is precision >= ${GATE}`
    + `${smallPredicted === 0 ? ' AND at least one downgrade proposed (a classifier that never fires is not "precise")' : ''}\n\n`);
  return pass ? 0 : 1;
}

process.exit(has('corpus') ? runCorpus() : await runLabelled());
