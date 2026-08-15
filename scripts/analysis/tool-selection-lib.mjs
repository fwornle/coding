/**
 * Shared loading and statistics for the tool-selection investigation.
 *
 * See docs/benchmarks/coding-v1/tool-selection.md — every figure on that page comes from
 * one of the tool-selection-*.mjs scripts that import this file.
 *
 * The one rule these scripts exist to enforce: a kgbench run is 3 reps x 16 questions, NOT
 * 48 independent cells. Reps of one question are near-perfectly correlated (see
 * `determinism()`), so a cell-level proportion test on 48 rows overstates its own precision.
 * Anything comparing runs clusters on the question.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** MCP tools are the graph backends; everything else is a built-in. */
export const isGraphTool = (t) => typeof t === 'string' && t.startsWith('mcp__');

/**
 * Rows for one run, optionally filtered.
 *
 * `agent` is absent on r6/r7 (predates the field) — those runs are claude-only, so a missing
 * agent is treated as claude rather than dropped, which would silently empty those runs.
 */
export function loadRun(runId, { arm = null, agent = null } = {}) {
  const p = path.join(REPO_ROOT, '.data/kgbench/runs', runId, 'results.jsonl');
  if (!fs.existsSync(p)) throw new Error(`no results.jsonl for run "${runId}" (looked in ${p})`);
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => (arm ? r.arm === arm : true))
    .filter((r) => (agent ? (r.agent ?? 'claude') === agent : true));
}

/** Did this cell execute at least one graph tool? */
export const cellUsedGraph = (row) => (row.tools_executed ?? []).some(isGraphTool);

/**
 * Per-question rep tallies: Map<questionId, {reps, hits}>.
 * `hits` counts reps that touched a graph tool at least once.
 */
export function byQuestion(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.id)) m.set(r.id, { reps: 0, hits: 0 });
    const e = m.get(r.id);
    e.reps += 1;
    if (cellUsedGraph(r)) e.hits += 1;
  }
  return m;
}

/** How many questions have all reps agreeing? The measure behind "it is not a rate". */
export function determinism(rows) {
  let unanimous = 0; let mixed = 0;
  for (const [, v] of byQuestion(rows)) {
    if (v.hits === 0 || v.hits === v.reps) unanimous += 1; else mixed += 1;
  }
  return { unanimous, mixed, total: unanimous + mixed };
}

/** Executed-tool histogram across rows. */
export function toolHistogram(rows) {
  const c = new Map();
  for (const r of rows) for (const t of r.tools_executed ?? []) c.set(t, (c.get(t) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
}

// ── statistics ───────────────────────────────────────────────────────────────
// Implemented here rather than pulled in, because the whole point of these scripts is that
// the test is EXACT (n=16 questions) rather than the normal approximation the README used.

const logFactorial = (n) => { let s = 0; for (let i = 2; i <= n; i += 1) s += Math.log(i); return s; };
const logChoose = (n, k) => logFactorial(n) - logFactorial(k) - logFactorial(n - k);

/**
 * Fisher's exact test on a 2x2, two-sided by the "sum of tables no more likely than observed"
 * convention. Used for run-vs-run comparisons where the questions are different draws.
 */
export function fisherExact(a, b, c, d) {
  const n = a + b + c + d;
  const p = (x) => Math.exp(logChoose(a + b, x) + logChoose(c + d, a + c - x) - logChoose(n, a + c));
  const observed = p(a);
  const lo = Math.max(0, a + c - (c + d));
  const hi = Math.min(a + b, a + c);
  let total = 0;
  for (let x = lo; x <= hi; x += 1) {
    const q = p(x);
    // 1 + 1e-7 absorbs float error so the observed table itself is never excluded.
    if (q <= observed * (1 + 1e-7)) total += q;
  }
  return Math.min(1, total);
}

/**
 * McNemar's exact test on discordant pairs. This is the RIGHT test for r8-vs-r9: the same 16
 * questions were asked twice, so the runs are paired and Fisher throws that pairing away.
 */
export function mcnemarExact(onlyA, onlyB) {
  const n = onlyA + onlyB;
  if (n === 0) return 1;
  let tail = 0;
  for (let k = Math.max(onlyA, onlyB); k <= n; k += 1) tail += Math.exp(logChoose(n, k)) * 0.5 ** n;
  return Math.min(1, 2 * tail);
}

export const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The four runs whose hybrid tool surface the README treats as poolable, newest last. */
export const POOLED_RUNS = ['coding-v1-r6', 'coding-v1-r7', 'coding-v1-x2', 'coding-v1-r8'];

/**
 * Every run with a hybrid/claude arm, for the WITHIN-QUESTION paired cost comparison only.
 * Poolability there is weaker than for POOLED_RUNS — the tool surface differs across these —
 * but the comparison is between reps of ONE question inside ONE run, so a surface that varies
 * between runs does not contaminate a pair. More pairs is the whole difficulty: there are 11.
 */
export const ALL_HYBRID_RUNS = [
  'coding-v1-r6', 'coding-v1-r7', 'coding-v1-x2', 'coding-v1-r8', 'coding-v1-r9',
  'coding-v1-abdesc-actionable',
];
export const CURRENT_RUN = 'coding-v1-r9';
