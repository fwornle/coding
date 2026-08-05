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
import { runCell, measureBaseline, assertProxyReachable, PROXY_BASE } from '../lib/kgbench/runner.mjs';
import { gradeQuestion } from '../lib/kgbench/graders.mjs';
import { createRunTree } from '../lib/kgbench/sandbox.mjs';
import { judgeAnswer, reconcile, JUDGE_MODEL, JUDGE_PROVIDER } from '../lib/kgbench/judge.mjs';

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
// Fail-closed on the LLM proxy, matching the launcher. Every cognitive call in this
// run — the arms AND the judge — goes through :12435 so the subscription provider for
// the current network is used and the work is measured. Running direct would benchmark
// a path nobody uses.
const proxy = await assertProxyReachable();
if (!proxy.ok) die(proxy.detail);
out(`kgbench: LLM proxy ok at ${PROXY_BASE} (network=${proxy.detail?.networkMode ?? '?'}, providers=${Object.entries(proxy.detail?.providers ?? {}).filter(([, p]) => p.available).map(([n]) => n).join(',') || 'none'})`);

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

// ---- sandboxed run tree ----------------------------------------------------
// The arms must not be able to read the answer key that grades them. See
// lib/kgbench/sandbox.mjs — in the coding-v1 pilot the grep arm scored 1.00 on an
// abstain probe by quoting that probe's own provenance note out of the question file.
// Containment is verified, not assumed; createRunTree throws rather than hand back a
// tree it could not clear.
let tree = null;
let armCwd = repoRoot;
if (flag('no-sandbox')) {
  out('kgbench: WARNING — --no-sandbox: arms can read config/kgbench/questions.');
  out('kgbench:           Scores from this run are NOT comparable and must not be published.');
} else {
  out('kgbench: building sandboxed run tree (this takes ~1 min on a large repo)...');
  try {
    tree = createRunTree({ repoRoot, questions });
    armCwd = tree.dir;
    out(`  tree     ${tree.dir}`);
    out(`  commit   ${tree.commit.slice(0, 9)}`);
    out(`  excluded ${tree.removed.join(', ')}`);
    out('  verified no question prompt or provenance note survives in the tree');
  } catch (err) { die(err.message); }
}
// A worktree is built from the COMMIT, so uncommitted work is not what gets searched.
if (dirty && tree) {
  out(`kgbench: NOTE — working tree is dirty; arms search ${tree.commit.slice(0, 9)}, not your edits.`);
}

// Always give the worktree back, including on Ctrl-C — a leaked worktree wedges the
// next run's `git worktree add` and leaves a stale copy of the repo in /tmp.
const releaseTree = () => { if (tree) { tree.cleanup(); tree = null; } };
process.on('exit', releaseTree);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { releaseTree(); process.exit(130); });
}

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
    const b = await measureBaseline({ arm, cwd: armCwd, env: process.env, reps: 3 });
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
  sandbox: tree
    ? { mode: 'worktree', tree_commit: tree.commit, excluded: tree.removed, verified: true }
    : { mode: 'none', verified: false, warning: 'arms could read the answer key; scores not comparable' },
  baselines, schemaTax,
  judge: { provider: JUDGE_PROVIDER, model: JUDGE_MODEL, enabled: !flag("no-judge") },
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
// Rows whose answer cited the benchmark's own ground truth. With the sandbox in place
// this should stay empty; if it does not, containment has regressed and the run is void.
const contaminatedRows = [];
for (const arm of arms) {
  for (const q of questions) {
    for (let rep = 1; rep <= reps; rep++) {
      n++;
      const key = `${arm.id}|${q.id}|${rep}`;
      if (done.has(key)) continue;

      const res = await runCell({ arm, question: q, rep, cwd: armCwd, env: process.env });

      // Deterministic grading inline. `llm`-type questions are left ungraded here
      // and picked up by kgbench-judge, so a judge outage cannot lose a run.
      let scored = { score: null, grade_detail: null, hallucinated: false };
      let judged = {};
      if (res.outcome === 'ok') {
        // gradeQuestion, not grade(answer, q.grader): questions author `checklist` and
        // `forbidden` at the top level, and passing only q.grader left 13 of 17
        // questions scoring null and the abstain class's fabrication check switched off.
        const g = gradeQuestion(q, res.answer);
        scored = {
          score: g.score, grade_detail: g.detail, hallucinated: !!g.hallucinated,
          grade_missing: g.missing ?? null,
          ...(g.contaminated ? {
            contaminated: true,
            contamination_signals: g.contamination_signals,
            score_if_clean: g.score_if_clean,
          } : {}),
        };

        // The judge runs when the question is judge-only (llm grader) or when a
        // checklist exists to cross-check. It never overrides the deterministic
        // score; disagreements are recorded and surfaced in the report.
        const wantsJudge = !flag('no-judge') && (g.judgeOnly || q.checklist?.length);
        if (wantsJudge) {
          const j = await judgeAnswer({
            question: q.prompt, answer: res.answer,
            checklist: q.checklist, rubric: q.grader?.rubric,
          });
          judged = {
            judge_score: j.score, judge_why: j.why ?? null, judge_pending: !!j.pending,
            judge_reason: j.reason ?? null, judge_provider: j.provider ?? null,
            ...(g.judgeOnly ? {} : { judge_agreement: reconcile(g.score, j.score) }),
          };
          // For an llm-only question the judge IS the score.
          if (g.judgeOnly && j.score != null) scored.score = j.score;
        }
      }

      const base = baselines[arm.id];
      const row = {
        ...res, ...scored, ...judged,
        content_tokens: res.total_tokens != null && base != null ? Math.max(0, res.in_tokens - base) + (res.out_tokens ?? 0) : null,
        baseline_in_tokens: base ?? null,
        set: setName, commit, at: new Date().toISOString(),
      };
      appendFileSync(resultsFile, JSON.stringify(row) + '\n');

      if (scored.contaminated) contaminatedRows.push(`${arm.id}/${q.id}`);
      const mark = res.outcome !== 'ok' ? res.outcome.toUpperCase()
        : scored.contaminated ? 'CONTAM'
        : scored.score == null ? 'judge'
        : scored.score.toFixed(2);
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
if (contaminatedRows.length) {
  out(`kgbench: ${contaminatedRows.length} CONTAMINATED row(s): ${contaminatedRows.join(', ')}`);
  out('kgbench: those answers cited the benchmark ground truth and are excluded from ranking.');
  out('kgbench: containment has regressed — treat this run as void and fix lib/kgbench/sandbox.mjs.');
}
out(`kgbench: done. results -> ${resultsFile}`);
out(`kgbench: render with  node scripts/kgbench-report.mjs --run ${runId}`);
