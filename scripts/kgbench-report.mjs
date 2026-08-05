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
const rows = readFileSync(resultsFile, 'utf8').split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const { questions } = loadQuestions(meta.set, repoRoot);
const selected = questions.filter((q) => meta.questions.includes(q.id));
const armIds = meta.arms.map((a) => a.id);

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
    reps: meta.reps,
    commit: meta.commit,
    dirty: meta.dirty,
    model: meta.arms[0]?.model ?? 'unknown',
    baselines: meta.baselines,
    schemaTax: meta.schemaTax,
    // Containment state travels with the report: a reader must be able to tell a
    // sandboxed run from one where the arms could read the answer key.
    sandbox: meta.sandbox ?? null,
    contaminatedRows: rows.filter((r) => r.contaminated).length,
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
