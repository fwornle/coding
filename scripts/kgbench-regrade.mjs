#!/usr/bin/env node
/**
 * Re-apply the CURRENT graders to a finished run's stored answers.
 *
 *   kgbench-regrade.mjs --run coding-v1-r6            # rewrite in place, keeping a backup
 *   kgbench-regrade.mjs --run coding-v1-r6 --dry-run  # report what would change
 *
 * WHY THIS EXISTS
 *
 * Cells are graded inline as they finish, against the grader that was loaded when the
 * runner started. Node caches that module for the life of the process, so a grader fixed
 * mid-run does not apply to the cells already recorded — and re-running the matrix to
 * pick up a scoring fix would cost hours and change the measurement, not just the score.
 *
 * The runner stores FULL answers precisely so grading can be redone offline. That is the
 * whole point of keeping them: a scoring defect should cost one pass over a file, not a
 * re-run. This has been needed twice now (four false hallucination flags in r5, and a
 * fifth in r6), which is why it is a script rather than an ad-hoc snippet each time.
 *
 * WHAT IT WILL NOT DO
 *
 * It never touches the judge fields and never re-invokes the judge — those are separate
 * evidence, and silently regenerating them would destroy the checklist-vs-judge
 * disagreement signal the report depends on. It only recomputes what gradeQuestion
 * derives from the stored answer.
 *
 * The pre-regrade file is kept beside the results, because "the scores changed after the
 * fact" is exactly the claim a reader is entitled to audit.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { gradeQuestion } from '../lib/kgbench/graders.mjs';
import { loadQuestions, REPO_ROOT } from '../lib/kgbench/arms.mjs';

const argv = process.argv.slice(2);
const out = (s) => console.log(s);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const die = (m) => { console.error(`kgbench-regrade: ${m}`); process.exit(2); };

const runId = opt('run', null);
if (!runId) die('--run <runId> is required');
const repoRoot = opt('repo', REPO_ROOT);
const runDir = path.join(repoRoot, '.data/kgbench/runs', runId);
const resultsFile = path.join(runDir, 'results.jsonl');
if (!existsSync(resultsFile)) die(`no results at ${resultsFile}`);

const meta = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8'));
const { questions } = loadQuestions(meta.set, repoRoot);
const byId = Object.fromEntries(questions.map((q) => [q.id, q]));

const rows = readFileSync(resultsFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const changes = [];
const regraded = rows.map((r) => {
  // Only `ok` rows carry an answer worth grading. A timeout has no answer, and inventing
  // a score for it would convert a failure into a measurement.
  if (r.outcome !== 'ok' || !byId[r.id]) return r;

  const g = gradeQuestion(byId[r.id], r.answer);
  const next = {
    ...r,
    score: g.contaminated ? null : g.score,
    grade_detail: g.detail,
    hallucinated: !!g.hallucinated,
    grade_missing: g.missing ?? null,
    contamination_weak: g.contamination_weak ?? undefined,
    ...(g.contaminated
      ? { contaminated: true, contamination_signals: g.contamination_signals, score_if_clean: g.score_if_clean }
      : { contaminated: undefined, contamination_signals: undefined, score_if_clean: undefined }),
  };
  // An llm-graded question has no deterministic score; the judge supplied it at run time
  // and must not be overwritten with null here.
  if (g.judgeOnly) next.score = r.score;

  if (next.score !== r.score || !!next.hallucinated !== !!r.hallucinated || !!next.contaminated !== !!r.contaminated) {
    changes.push({
      arm: r.arm, id: r.id, rep: r.rep,
      score: [r.score ?? null, next.score ?? null],
      hallucinated: [!!r.hallucinated, !!next.hallucinated],
      contaminated: [!!r.contaminated, !!next.contaminated],
      detail: next.grade_detail,
    });
  }
  return next;
});

for (const c of changes) {
  out(`  ${c.arm.padEnd(11)} ${c.id.padEnd(4)} rep${c.rep}  score ${String(c.score[0]).padEnd(5)} -> ${String(c.score[1]).padEnd(5)}`
    + `  halluc ${c.hallucinated[0]}->${c.hallucinated[1]}  contam ${c.contaminated[0]}->${c.contaminated[1]}`);
}
out(`kgbench-regrade: ${changes.length} of ${rows.length} row(s) change`);

if (flag('dry-run')) { out('kgbench-regrade: --dry-run, nothing written'); process.exit(0); }
if (!changes.length) { out('kgbench-regrade: nothing to write'); process.exit(0); }

const backup = path.join(runDir, 'results.pre-regrade.jsonl');
if (!existsSync(backup)) copyFileSync(resultsFile, backup);
writeFileSync(resultsFile, regraded.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(path.join(runDir, 'regrade.json'), JSON.stringify({
  runId, at: new Date().toISOString(), rows: rows.length, changed: changes.length, changes,
}, null, 2) + '\n');
out(`kgbench-regrade: wrote ${resultsFile}`);
out(`kgbench-regrade: original preserved at ${backup}, change log at ${path.join(runDir, 'regrade.json')}`);
