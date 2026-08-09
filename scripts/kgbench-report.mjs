#!/usr/bin/env node
/**
 * Render a kgbench run into markdown + report.json.
 *
 *   kgbench-report.mjs --run <runId> [--out docs/benchmarks/<name>/README.md]
 *
 * Arms are rows, so N arms costs nothing. Raw results are NOT copied into docs/:
 * 8 arms x 30 questions x 3 reps with full answers is megabytes, and the report plus
 * report.json is what is worth committing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { aggregate, renderMarkdown } from '../lib/kgbench/report.mjs';
import { loadQuestions, REPO_ROOT } from '../lib/kgbench/arms.mjs';

const argv = process.argv.slice(2);
const out = (s) => console.log(s);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const die = (m) => { console.error(`kgbench-report: ${m}`); process.exit(2); };

const runId = opt('run', null);
if (!runId) die('--run <runId> is required');

const repoRoot = opt('repo', REPO_ROOT);
const runDir = path.join(repoRoot, '.data/kgbench/runs', runId);
const resultsFile = path.join(runDir, 'results.jsonl');
if (!existsSync(resultsFile)) die(`no results at ${resultsFile}`);

const meta = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8'));
const allRows = readFileSync(resultsFile, 'utf8').split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const { questions } = loadQuestions(meta.set, repoRoot);
// A run's question set is the UNION over every pass, not just the last one. Adding reps
// with `--only A1,A2,A3,A4` rewrote run.json's list to those four, so the other twelve
// questions' rows were misfiled as "retired" and silently dropped from every table —
// the report showed a 4-question benchmark and named the rest as excluded.
const runQuestionIds = new Set([
  ...(meta.questions ?? []),
  ...(meta.history ?? []).flatMap((h) => h.questions ?? []),
]);
const selected = questions.filter((q) => runQuestionIds.has(q.id));
const armIds = meta.arms.map((a) => a.id);

// Rows are filtered to the questions the set STILL defines, not the ones the run
// happened to execute. A question retired mid-flight (T2: its premise was false, so no
// answer to it could be graded) leaves rows behind, and aggregating them would fold a
// known-broken question into the medians.
const selectedIds = new Set(selected.map((q) => q.id));
let rows = allRows.filter((r) => selectedIds.has(r.id));
const retiredIds = [...new Set(allRows.filter((r) => !selectedIds.has(r.id)).map((r) => r.id))];

// --agents publishes a SUBSET of a run's agents, for the case where part of a matrix is
// void and the rest is not. x2 is the case that forced this: its 192 claude cells are
// valid, and its 192 copilot/opencode cells read a previous cell's stale answer file, so
// one opencode answer text was graded against eleven different questions. Reporting the
// run whole would have put that artefact in the pooled Overall table as a 0.00 median —
// publishable-looking, and a capability claim about opencode that the data cannot support.
//
// The alternative — deleting the bad rows from results.jsonl — would destroy the evidence
// that the bug happened. Filter at report time; keep the raw run intact.
//
// --void-reason is required alongside it, because an unexplained subset is worse than a
// pooled one: the reader cannot tell a deliberate exclusion from a run that never had
// those cells.
const agentFilter = opt('agents', null);
const voidReason = opt('void-reason', null);
let agentFilterMeta = null;
if (agentFilter) {
  const keep = new Set(agentFilter.split(',').map((s) => s.trim()).filter(Boolean));
  const agentOf = (r) => r.agent ?? 'claude';
  const present = [...new Set(rows.map(agentOf))];
  const unknown = [...keep].filter((a) => !present.includes(a));
  if (unknown.length) die(`--agents names agent(s) not in this run: ${unknown.join(', ')} (run has: ${present.join(', ')})`);
  if (!voidReason) die('--agents requires --void-reason "<why the others are excluded>"');
  const before = rows.length;
  rows = rows.filter((r) => keep.has(agentOf(r)));
  agentFilterMeta = {
    kept: [...keep],
    excluded: present.filter((a) => !keep.has(a)),
    rowsExcluded: before - rows.length,
    reason: voidReason,
  };
  out(`  --agents: kept ${rows.length}/${before} rows (${agentFilterMeta.kept.join(', ')}), `
    + `excluded ${agentFilterMeta.rowsExcluded} (${agentFilterMeta.excluded.join(', ')})`);
}

const agg = aggregate(rows, { arms: armIds, questions: selected });

// Checklist vs judge disagreement, when both graded the same answer.
const disagreements = rows
  .filter((r) => r.score != null && r.judge_score != null && Math.abs(r.score - r.judge_score) > 0.25)
  .map((r) => ({
    id: r.id, arm: r.arm, checklist: r.score, judge: r.judge_score,
    kind: r.judge_score > r.score ? 'judge_higher' : 'checklist_higher',
  }));

const report = {
  meta: {
    set: meta.set,
    runId,
    questionCount: selected.length,
    // Reps vary per question once a later pass deepens a subset, so report the real
    // per-question range instead of the last pass's --reps value.
    //
    // Counted per (arm, AGENT, MODEL, question). Keying on (arm, question) alone counted one
    // rep run by three agents as "3 reps/arm" — the report claimed triple the replication it
    // had, which is precisely the kind of overstated confidence the winner gate exists to
    // prevent elsewhere.
    reps: (() => {
      const per = new Map();
      for (const r of rows) {
        const k = `${r.arm}|${r.agent ?? 'claude'}|${r.model ?? ''}|${r.id}`;
        per.set(k, (per.get(k) ?? 0) + 1);
      }
      const v = [...per.values()];
      if (!v.length) return '0';
      const lo = Math.min(...v), hi = Math.max(...v);
      return lo === hi ? String(lo) : `${lo}-${hi}`;
    })(),
    commit: meta.commit,
    dirty: meta.dirty,
    // The model is an axis now. Naming one in the header is only honest when the run used one.
    model: (() => {
      const used = [...new Set(rows.map((r) => r.model).filter(Boolean))];
      if (used.length === 1) return used[0];
      if (used.length > 1) return used.join('`, `');
      return meta.arms[0]?.model ?? 'unknown';
    })(),
    baselines: meta.baselines,
    schemaTax: meta.schemaTax,
    // Containment state travels with the report: a reader must be able to tell a
    // sandboxed run from one where the arms could read the answer key.
    sandbox: meta.sandbox ?? null,
    history: meta.history ?? null,
    // The judge identity that ACTUALLY graded these cells, taken from the rows rather
    // than from the run's stated intent. r6 and r7 both recorded a requested
    // `claude-opus-4.8` in run.json while every call was answered by claude-haiku-4-5,
    // so the requested name is not evidence of anything. Older runs have no served
    // field at all; report it as unrecorded rather than silently echoing the request.
    judge: (() => {
      const served = [...new Set(rows.map((r) => r.judge_model_served).filter(Boolean))];
      const requested = meta.judge?.requested?.model ?? meta.judge?.model ?? null;
      return {
        requested,
        served: served.length ? served : null,
        provider: meta.judge?.served?.provider ?? meta.judge?.requested?.provider ?? meta.judge?.provider ?? null,
        mismatch: served.length ? served.some((m) => m !== requested) : null,
      };
    })(),
    contaminatedRows: rows.filter((r) => r.contaminated).length,
    // Answers that GUESSED they were being probed without citing anything. Not
    // contamination — an arm that searches, finds nothing, and concludes the question is
    // a trap is doing the job the abstain class asks for. Counted because a set whose
    // traps are guessable from their phrasing is measuring something narrower than
    // retrieval, and that is a fact about the QUESTIONS, not about the arms.
    selfIdentifiedProbeRows: rows.filter((r) => r.contamination_weak?.length).length,
    toolEscapeRows: rows.filter((r) => r.outcome === 'tool_escape').length,
    retiredQuestions: retiredIds,
    agentFilter: agentFilterMeta,
    generatedAt: new Date().toISOString(),
  },
  ...agg,
  disagreements,
};

const md = renderMarkdown(report);
const outPath = opt('out', null);
if (outPath) {
  const abs = path.isAbsolute(outPath) ? outPath : path.join(repoRoot, outPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, md);
  writeFileSync(path.join(path.dirname(abs), 'report.json'), JSON.stringify(report, null, 2) + '\n');
  out(`wrote ${abs}`);
  out(`wrote ${path.join(path.dirname(abs), 'report.json')}`);
} else {
  out(md);
}
