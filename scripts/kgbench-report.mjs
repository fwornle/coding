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
import { aggregate, renderMarkdown, buildReportMeta, findDisagreements } from '../lib/kgbench/report.mjs';
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

// Checklist vs judge disagreement, and the meta block, both come from lib/kgbench/report.mjs.
// They used to be built inline here. The Benchmarks dashboard sub-tab aggregates a run's rows
// live and needs the same numbers, and several of these fields exist because an earlier
// version of them was quietly wrong (the reps key counted one rep by three agents as three;
// the judge identity echoed a request that was never served). A second copy would be a second
// place for that to happen again, so there is one.
const disagreements = findDisagreements(rows);

const report = {
  meta: buildReportMeta({ rows, meta, runId, selected, retiredIds, agentFilterMeta }),
  ...agg,
  disagreements,
};

/**
 * The first line of every generated report. Its only job is to be absent from a file a
 * human wrote, so `--out` can tell the two apart.
 */
const GENERATED_MARKER = '<!-- GENERATED by scripts/kgbench-report.mjs — do not hand-edit. '
  + 'Hand-written analysis belongs in README.md, which this tool refuses to overwrite. -->';

/**
 * Refuse to overwrite a file this tool did not write.
 *
 * THE INCIDENT. `docs/benchmarks/coding-v1/README.md` was 632 lines of hand-written
 * analysis wrapped around the generated tables — the charts, the question set, the
 * fourteen measurement defects, the reasoning. Publishing was documented as
 * `kgbench-report.mjs --out /tmp/x && cp /tmp/x docs/benchmarks/coding-v1/README.md`,
 * which replaces all of it with the machine version. That happened at f6bb7875c
 * (619 lines deleted, in a commit whose message is entirely about an answer key) and
 * again on 2026-08-09. Neither commit mentioned it, because the diff against an
 * already-collapsed file shows only growth.
 *
 * The file carried a warning about exactly this, in a section headed "Reproduce it". The
 * warning was inside the file it was warning about, so it was destroyed along with the
 * rest and could not warn anyone a second time. Prose in the blast radius is not a
 * control. This check is: a target that exists and lacks the generated marker is
 * something a person wrote, and the tool stops.
 */
function refuseToClobberHandWritten(abs) {
  if (!existsSync(abs)) return;
  let head = '';
  try { head = readFileSync(abs, 'utf8').slice(0, GENERATED_MARKER.length + 200); } catch { return; }
  if (head.includes('GENERATED by scripts/kgbench-report.mjs')) return;
  if (argv.includes('--force')) {
    out(`kgbench: --force given; overwriting hand-written ${path.relative(repoRoot, abs)}`);
    return;
  }
  console.error(`kgbench: refusing to overwrite ${path.relative(repoRoot, abs)} — it has no generated\n`
    + '  marker, so it is hand-written. Generated output goes to RESULTS.md; the analysis in\n'
    + '  README.md is written around those numbers and is not reproducible from a re-render.\n'
    + '  Use --out .../RESULTS.md, or --force if you really mean to replace the prose.');
  process.exit(2);
}

const md = renderMarkdown(report);
const outPath = opt('out', null);
if (outPath) {
  const abs = path.isAbsolute(outPath) ? outPath : path.join(repoRoot, outPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  refuseToClobberHandWritten(abs);
  writeFileSync(abs, GENERATED_MARKER + '\n\n' + md);
  writeFileSync(path.join(path.dirname(abs), 'report.json'), JSON.stringify(report, null, 2) + '\n');
  out(`wrote ${abs}`);
  out(`wrote ${path.join(path.dirname(abs), 'report.json')}`);
} else {
  out(md);
}
