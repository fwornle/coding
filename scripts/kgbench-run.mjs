#!/usr/bin/env node
/**
 * kgbench matrix runner.
 *
 *   kgbench-run.mjs --set replication --arms grep,graphify --reps 3
 *   kgbench-run.mjs --set replication --only L1,S1,A1 --reps 1     # pilot
 *   kgbench-run.mjs --set replication --preflight-only
 *
 * Writes .data/kgbench/runs/<runId>/results.jsonl incrementally, so a run can be
 * resumed or inspected mid-flight. Full answers are stored (not truncated) so a
 * fixed grader can be re-applied offline instead of re-running the matrix.
 *
 * stdout is progress for a human; the artefacts are the results file and run.json.
 */

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadArms, loadQuestions, resolveArms, enabledArmIds, preflightArm, REPO_ROOT } from '../lib/kgbench/arms.mjs';
import { runCell, measureBaseline } from '../lib/kgbench/runner.mjs';
import { grade } from '../lib/kgbench/graders.mjs';

const argv = process.argv.slice(2);
const out = (s) => console.log(s);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const die = (m) => { console.error(`kgbench: ${m}`); process.exit(2); };

const setName = opt('set', 'replication');
const reps = parseInt(opt('reps', '3'), 10);
const only = opt('only', null)?.split(',').map((s) => s.trim());
const repoRoot = opt('repo', REPO_ROOT);

let armsDoc, questionSet;
try {
  armsDoc = loadArms(repoRoot);
  questionSet = loadQuestions(setName, repoRoot);
} catch (err) { die(err.message); }

const armIds = opt('arms', null)?.split(',').map((s) => s.trim()) ?? enabledArmIds(armsDoc);
let arms;
try { arms = resolveArms(armsDoc, armIds, { repoRoot }); } catch (err) { die(err.message); }

const questions = only
  ? questionSet.questions.filter((q) => only.includes(q.id))
  : questionSet.questions;
if (!questions.length) die(`no questions selected from set "${setName}"`);

// ---- preflight -------------------------------------------------------------
// Runs before anything executes. A down MCP server is indistinguishable from a
// backend that answers badly, and a whole matrix run under that condition is worthless.
out(`kgbench: preflighting ${arms.length} arm(s)...`);
const pre = await Promise.all(arms.map((a) => preflightArm(a, { repoRoot })));
let blocked = false;
for (const p of pre) {
  if (p.ok) out(`  ok    ${p.arm}`);
  else { blocked = true; out(`  FAIL  ${p.arm}: ${p.problems.join('; ')}`); }
}
if (blocked) die('preflight failed — fix the arms above or drop them with --arms');
if (flag('preflight-only')) process.exit(0);

// ---- run bookkeeping -------------------------------------------------------
let commit = 'unknown';
let dirty = false;
try {
  commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  dirty = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
} catch { /* not a git checkout */ }

const runId = opt('run-id', `kg${Date.now().toString(36)}`);
const runDir = path.join(repoRoot, '.data/kgbench/runs', runId);
mkdirSync(runDir, { recursive: true });
const resultsFile = path.join(runDir, 'results.jsonl');

// Resume: skip cells already recorded.
const done = new Set();
if (existsSync(resultsFile)) {
  for (const line of readFileSync(resultsFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); done.add(`${r.arm}|${r.id}|${r.rep}`); } catch { /* partial line */ }
  }
  if (done.size) out(`kgbench: resuming, ${done.size} cell(s) already recorded`);
}

// ---- per-arm token baseline ------------------------------------------------
// content_tokens = total - baseline. Without this the fixed ~140k floor of system
// prompt + tool schemas dominates and every arm looks the same.
const baselines = {};
if (!flag('no-baseline')) {
  out('kgbench: measuring per-arm token baselines...');
  for (const arm of arms) {
    const b = await measureBaseline({ arm, cwd: repoRoot, env: process.env, reps: 3 });
    baselines[arm.id] = b.baseline_in_tokens;
    out(`  ${arm.id.padEnd(12)} baseline_in_tokens=${b.baseline_in_tokens ?? 'n/a'} (${b.samples} samples)`);
  }
}
// The always-on cost of merely having a backend registered, relative to bare grep.
const schemaTax = {};
const grepBase = baselines.grep;
for (const [id, b] of Object.entries(baselines)) {
  schemaTax[id] = b != null && grepBase != null ? b - grepBase : null;
}

writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
  runId, set: setName, reps, commit, dirty,
  arms: arms.map((a) => ({ id: a.id, label: a.label, model: a.model, allowedTools: a.allowedTools, backend: a.backend })),
  questions: questions.map((q) => q.id),
  baselines, schemaTax,
  startedAt: new Date().toISOString(),
}, null, 2) + '\n');

if (dirty) out('kgbench: WARNING — working tree is dirty; the indexes and the tree may disagree');

// ---- matrix ----------------------------------------------------------------
const total = arms.length * questions.length * reps;
let n = 0;
// A run that cannot reach the model produces a full table of zeros that looks like
// a result. Bail early and loudly instead.
let consecutiveApiErrors = 0;
const API_ERROR_ABORT = 3;
for (const arm of arms) {
  for (const q of questions) {
    for (let rep = 1; rep <= reps; rep++) {
      n++;
      const key = `${arm.id}|${q.id}|${rep}`;
      if (done.has(key)) continue;

      const res = await runCell({ arm, question: q, rep, cwd: repoRoot, env: process.env });

      // Deterministic grading inline. `llm`-type questions are left ungraded here
      // and picked up by kgbench-judge, so a judge outage cannot lose a run.
      let scored = { score: null, grade_detail: null, hallucinated: false };
      if (res.outcome === 'ok') {
        const g = grade(res.answer, q.grader);
        scored = { score: g.score, grade_detail: g.detail, hallucinated: !!g.hallucinated, grade_missing: g.missing ?? null };
      }

      const base = baselines[arm.id];
      const row = {
        ...res, ...scored,
        content_tokens: res.total_tokens != null && base != null ? Math.max(0, res.in_tokens - base) + (res.out_tokens ?? 0) : null,
        baseline_in_tokens: base ?? null,
        set: setName, commit, at: new Date().toISOString(),
      };
      appendFileSync(resultsFile, JSON.stringify(row) + '\n');

      const mark = res.outcome === 'ok' ? (scored.score == null ? 'judge' : scored.score.toFixed(2)) : res.outcome.toUpperCase();
      out(`  [${String(n).padStart(3)}/${total}] ${arm.id.padEnd(12)} ${q.id.padEnd(4)} rep${rep}  ${String(mark).padEnd(8)} ${res.wall_s}s`
        + (res.outcome === 'api_error' ? `  ${res.error}` : ''));

      if (res.outcome === 'api_error') {
        if (++consecutiveApiErrors >= API_ERROR_ABORT) {
          out('');
          die(`aborting: ${API_ERROR_ABORT} consecutive API errors — last was "${res.error}".\n`
            + '  Nothing measured here would be meaningful. Fix model access, then re-run;\n'
            + `  completed cells are kept, so the run resumes with --run-id ${runId}.`);
        }
      } else {
        consecutiveApiErrors = 0;
      }
    }
  }
}

out('');
out(`kgbench: done. results -> ${resultsFile}`);
out(`kgbench: render with  node scripts/kgbench-report.mjs --run ${runId}`);
