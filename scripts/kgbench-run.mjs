#!/usr/bin/env node
/**
 * kgbench matrix runner.
 *
 *   kgbench-run.mjs --set replication --arms grep,graphify --reps 3
 *   kgbench-run.mjs --set replication --only L1,S1,A1 --reps 1     # pilot
 *   kgbench-run.mjs --set replication --preflight-only
 *   kgbench-run.mjs --set coding-v1 --arms grep,hybrid --agents claude,copilot,opencode
 *   kgbench-run.mjs --set coding-v1 --agents claude --models claude-sonnet-4.6,claude-opus-5
 *
 * Writes .data/kgbench/runs/<runId>/results.jsonl incrementally, so a run can be
 * resumed or inspected mid-flight. Full answers are stored (not truncated) so a
 * fixed grader can be re-applied offline instead of re-running the matrix.
 *
 * THE MATRIX IS arm x agent x model x question x rep, and the agent axis is the one that
 * does not behave like the others. Only claude can be confined to an arm's tool surface, so
 * some (arm, agent) pairs are REFUSED rather than run: an arm whose identity is "has Read but
 * not Glob/Grep" cannot be reproduced on an agent that cannot have Glob/Grep withheld, and
 * running it anyway would produce a cell with more capability than its label claims. Refusals
 * are decided and printed BEFORE anything executes, and recorded in run.json — a matrix that
 * quietly shrinks is worse than one that says what it will not do.
 *
 * stdout is progress for a human; the artefacts are the results file and run.json.
 */

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadArms, loadQuestions, resolveArms, enabledArmIds, preflightArm, REPO_ROOT } from '../lib/kgbench/arms.mjs';
import {
  runCell, measureBaseline, assertProxyReachable, PROXY_BASE,
  discoverBuiltinTools, denyListFor,
} from '../lib/kgbench/runner.mjs';
import { gradeQuestion } from '../lib/kgbench/graders.mjs';
import { createRunTree } from '../lib/kgbench/sandbox.mjs';
import { judgeAnswer, reconcile, JUDGE_MODEL, JUDGE_PROVIDER } from '../lib/kgbench/judge.mjs';
import { resolveAgent, armIsFaithful, cellKey, KNOWN_AGENTS } from '../lib/kgbench/agents.mjs';
import { prepareAgentMcp } from '../lib/kgbench/agent-sandbox.mjs';

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

// ---- agent and model axes --------------------------------------------------
// Both default to exactly what the single-agent runner did: agent `claude`, and each arm's
// own model. A run that passes neither flag is byte-identical to one from before the axes
// existed, which is what keeps r6/r7 comparable with anything measured now.
const agentIds = opt('agents', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? ['claude'];
for (const a of agentIds) {
  if (!KNOWN_AGENTS.includes(a)) die(`unknown agent "${a}" (known: ${KNOWN_AGENTS.join(', ')})`);
}
// `null` in the model list means "this arm's configured model" — the pre-axis behaviour.
const modelRefs = opt('models', null)?.split(',').map((s) => s.trim()).filter(Boolean) ?? [null];

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

// ---- which (arm, agent) pairs can honestly be run ---------------------------
// Decided here, before a single cell executes, and printed. An arm defined by WITHHOLDING
// built-in search cannot be reproduced on an agent whose built-ins are ungated — the cell
// would run with more capability than its label states, which is the defect this benchmark
// exists to avoid rather than to commit.
const combos = [];
const refusals = [];
for (const arm of arms) {
  for (const agentId of agentIds) {
    const verdict = armIsFaithful(arm, agentId);
    if (!verdict.faithful) { refusals.push({ arm: arm.id, agent: agentId, reason: verdict.reason }); continue; }
    for (const modelRef of modelRefs) {
      let agent;
      try {
        agent = resolveAgent(agentId, { modelRef: modelRef ?? arm.model, repoRoot });
      } catch (err) {
        refusals.push({ arm: arm.id, agent: agentId, model: modelRef, reason: err.message });
        continue;
      }
      combos.push({ arm, agentId, agent, modelRef: modelRef ?? arm.model });
    }
  }
}
if (agentIds.length > 1 || agentIds[0] !== 'claude' || modelRefs[0] !== null) {
  out(`kgbench: ${combos.length} (arm, agent, model) combination(s):`);
  for (const c of combos) {
    out(`  run    ${c.arm.id.padEnd(12)} ${c.agentId.padEnd(10)} ${c.agent.model}`
      + `  [builtins ${c.agent.enforcement.builtins}, answer via ${c.agent.elicitation}]`);
  }
}
for (const r of refusals) {
  out(`  REFUSE ${r.arm.padEnd(12)} ${r.agent.padEnd(10)} ${r.reason}`);
}
if (!combos.length) {
  die('every (arm, agent) combination was refused — nothing left to measure.\n'
    + '  Use --arms hybrid for cross-agent runs, or --agents claude for the restricted arms.');
}
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
// abstain question by quoting that question's own provenance note out of the answer key.
// Containment is verified, not assumed; createRunTree throws rather than hand back a
// tree it could not clear.
let tree = null;
let armCwd = repoRoot;

// Always give the worktree back, including on Ctrl-C — a leaked worktree wedges the
// next run's `git worktree add` and leaves a stale copy of the repo in /tmp.
//
// REGISTERED BEFORE THE TREE IS BUILT, and holding a cleanup handed over the moment the
// worktree exists rather than the one attached to the finished `tree` object. Building a tree
// takes about a minute (worktree add, then the exclusion sweep, then containment
// verification), and this used to be registered AFTER it — so a signal arriving during
// construction left a worktree nothing had a handle on. `git worktree prune` cannot reclaim
// it either, because prune only drops entries whose directory is gone and this one's is not.
//
// That was a theoretical window while the only way to stop a run was Ctrl-C minutes in. The
// dashboard's Cancel button makes stopping a run in its first seconds an ordinary act, and it
// leaked on the first try.
let releaseWorktree = null;
const releaseTree = () => {
  if (releaseWorktree) { const fn = releaseWorktree; releaseWorktree = null; tree = null; fn(); }
};
process.on('exit', releaseTree);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { releaseTree(); process.exit(130); });
}

if (flag('no-sandbox')) {
  out('kgbench: WARNING — --no-sandbox: arms can read config/kgbench/questions.');
  out('kgbench:           Scores from this run are NOT comparable and must not be published.');
} else {
  out('kgbench: building sandboxed run tree (this takes ~1 min on a large repo)...');
  try {
    tree = createRunTree({
      repoRoot,
      questions,
      // Fires as soon as `git worktree add` succeeds — long before this call returns.
      onWorktreeCreated: ({ cleanup }) => { releaseWorktree = cleanup; },
    });
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

// Resume: skip cells already recorded.
//
// The key gained agent and model, which would have orphaned every row written before those
// axes existed — a resume would have re-run the whole of r6/r7 rather than skipping it. Rows
// without an `agent` were all claude, and rows without a `model` ran on their arm's own
// model, so both are filled in from what was true at the time.
const armModel = Object.fromEntries(arms.map((a) => [a.id, a.model]));
const done = new Set();
if (existsSync(resultsFile)) {
  for (const line of readFileSync(resultsFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      done.add(cellKey({
        arm: r.arm, agent: r.agent, model: r.model, question: r.id, rep: r.rep,
        armModel: armModel[r.arm],
      }));
    } catch { /* partial line */ }
  }
  if (done.size) out(`kgbench: resuming, ${done.size} cell(s) already recorded`);
}

// ---- tool surface discovery ------------------------------------------------
// Ask the CLI what tools exist rather than maintaining a list by hand. The hand-written
// list missed `Skill`, and the graphify arm used it to invoke this project's /graphify
// skill — the second escape found this way. A tool added upstream is now denied
// automatically instead of quietly becoming a hole in the comparison.
out('kgbench: discovering CLI tool surface...');
const builtins = await discoverBuiltinTools({ model: arms[0].model, cwd: armCwd, env: process.env });
if (!builtins?.length) {
  die('could not read the CLI tool surface from the session init event.\n'
    + '  Refusing to run: without it the deny list is a guess, and an un-isolated arm\n'
    + '  produces a comparison between things that are not what their labels say.');
}
out(`  ${builtins.length} built-in tools; each arm denies all but its own grant`);

// ---- token baseline, per (arm, agent, model) --------------------------------
// content_tokens = total - baseline. Without this the fixed ~140k floor of system
// prompt + tool schemas dominates and every arm looks the same.
//
// Keyed by the whole combination, not just the arm, because the floor is a property of the
// SESSION: a copilot session and a claude session start from different system prompts and
// different tool schemas, and subtracting one from the other measures the difference between
// two CLIs rather than between two retrieval strategies. The baseline also records the token
// SOURCE it was measured through, so a DB-derived cell total is never reduced by a
// stream-json floor — those two account for prompt caching differently, and the difference
// would not be a difference of anything.
// A RESUME MUST REUSE THE FLOORS IT ALREADY MEASURED.
//
// Resume rightly skips completed cells; re-measuring the baselines undoes that discipline for
// the derived metric. `content_tokens` is `total - floor`, so a fresh floor means cells 184+
// are normalised against a different number than cells 1-183 — inside one run, in one column,
// silently. That is not hypothetical drift: two launches an hour apart on this machine
// measured the opencode floor at 33,200 and 64,935, a factor of two, because a
// proxy-db-window floor depends on what the stop-adapter had written by the time it was asked.
//
// So the prior manifest's baselines are authoritative for a resume, exactly as results.jsonl is
// authoritative for completed cells. --remeasure-baselines forces a fresh set when that is
// what you actually want, and it applies to ALL of them so the run stays internally consistent.
const priorManifest = (() => {
  try { return JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8')); } catch { return null; }
})();
const reuseBaselines = !flag('remeasure-baselines') && priorManifest?.baselines
  ? priorManifest.baselines
  : {};
const reuseBaselineSource = priorManifest?.baselineSource ?? {};

const baselines = {};      // "arm|agent|model" -> in_tokens
const baselineSource = {}; // "arm|agent|model" -> 'stream-json' | 'proxy-db-*' | null
const comboKey = (c) => `${c.arm.id}|${c.agentId}|${c.agent.model}`;
// Non-claude probes cost a session each and their tokens can arrive late, so one sample is
// the default there; claude's are cheap and immediate, so it keeps three.
const baselineReps = (agentId) => parseInt(opt('baseline-reps', agentId === 'claude' ? '3' : '1'), 10);
// How long a non-claude baseline waits for its stop-adapter to write the row.
//
// 40s was not enough and the failure is expensive in a way a cell's is not: a cell whose
// tokens arrive late is repaired by kgbench-backfill-tokens.mjs, but a BASELINE has no window
// stored anywhere to re-resolve from, so a floor that misses its wait is gone for the whole
// run — and every cell in that combination loses `content_tokens`, the headline metric. Two
// copilot floors timed out at 40s on one attempt, costing 96 of 384 cells their column; the
// rows themselves landed about two minutes later.
//
// Patience is nearly free because the poll returns the moment it finds rows: a prompt adapter
// pays nothing, and only a genuinely missing floor pays the full budget, once per combination.
const baselineWaitS = parseInt(opt('baseline-token-wait-s', '150'), 10);
if (!flag('no-baseline')) {
  out('kgbench: measuring token baselines...');
  const leaks = [];
  for (const c of combos) {
    // Reused floors skip the probe entirely, which also means a resume does not re-run the
    // isolation assertion for that combination. That is acceptable: the assertion already
    // passed for this run tree at the same commit, and the alternative — re-measuring — is
    // the inconsistency this reuse exists to prevent.
    const priorFloor = reuseBaselines[comboKey(c)];
    if (priorFloor != null) {
      baselines[comboKey(c)] = priorFloor;
      baselineSource[comboKey(c)] = reuseBaselineSource[comboKey(c)] ?? null;
      out(`  ${c.arm.id.padEnd(12)} ${c.agentId.padEnd(10)} baseline_in_tokens=${priorFloor}`
        + ` (reused from this run's manifest${baselineSource[comboKey(c)] ? `, ${baselineSource[comboKey(c)]}` : ''})`);
      continue;
    }
    const b = await measureBaseline({
      arm: c.arm, cwd: armCwd, env: process.env, builtins,
      reps: baselineReps(c.agentId),
      agent: c.agentId === 'claude' ? null : c.agent,
      runId,
      // Baselines happen once per combination rather than once per cell, so they can afford
      // to wait out a slow stop-adapter that a cell cannot.
      tokenOpts: c.agentId === 'claude'
        ? {}
        : { attempts: Math.max(1, Math.ceil(baselineWaitS / 5)), settleMs: 5000 },
    });
    baselines[comboKey(c)] = b.baseline_in_tokens;
    baselineSource[comboKey(c)] = b.source ?? null;
    // The baseline probe is a real session with this arm's real flags, so what it
    // reports as available is evidence that isolation applied — checked BEFORE the
    // matrix runs, rather than discovering 48 voided cells afterwards. Only claude
    // reports a tool surface; on the others there is nothing to check, which is
    // recorded in the enforcement descriptor rather than glossed over here.
    if (c.agentId === 'claude') {
      const denied = new Set(denyListFor(c.arm, builtins));
      const leaked = (b.available_tools ?? []).filter((t) => denied.has(t));
      if (leaked.length) leaks.push(`  ${c.arm.id}: ${leaked.join(', ')}`);
    }
    out(`  ${c.arm.id.padEnd(12)} ${c.agentId.padEnd(10)} baseline_in_tokens=${b.baseline_in_tokens ?? 'n/a'}`
      + ` (${b.samples} samples${b.source ? `, ${b.source}` : ''})`
      + (c.agentId === 'claude' ? `, tools=${(b.available_tools ?? []).length}` : ''));
  }
  if (leaks.length) {
    die('arms are not isolated — these tools were denied but are still available:\n'
      + leaks.join('\n')
      + '\n  Every number from such a run compares arms that are not what their labels say.');
  }
  // A missing floor is NOT recoverable after the fact — unlike a cell, a baseline stores no
  // window to re-resolve from — so every cell in that combination will carry a null
  // content_tokens for the life of the run. Said loudly here rather than discovered in the
  // report, because the fix (a longer wait, or an idle machine) is only cheap before the
  // matrix starts.
  const missing = combos.filter((c) => baselines[comboKey(c)] == null);
  if (missing.length) {
    out('');
    out(`kgbench: WARNING — ${missing.length} of ${combos.length} combination(s) have NO token floor:`);
    for (const c of missing) out(`  ${c.arm.id} / ${c.agentId}`);
    out(`kgbench: those cells will have content_tokens = null (${missing.length * questions.length * reps} of `
      + `${combos.length * questions.length * reps} cells). A baseline cannot be backfilled.`);
    out(`kgbench: raise --baseline-token-wait-s (currently ${baselineWaitS}s) and restart if you need that column.`);
    out('');
  }
}
// The always-on cost of merely having a backend registered, relative to bare grep — compared
// WITHIN an (agent, model), since a cross-CLI difference is not a schema tax.
const schemaTax = {};
for (const c of combos) {
  const key = comboKey(c);
  const grepKey = `grep|${c.agentId}|${c.agent.model}`;
  const b = baselines[key];
  const g = baselines[grepKey];
  schemaTax[key] = b != null && g != null ? b - g : null;
}

// Resuming must not erase what the earlier cells actually ran against. run.json was
// rewritten wholesale, so adding reps at a later commit would have relabelled every
// existing row with the new commit — the report would then claim a provenance that was
// true for none of them. Prior manifests are kept.
const runJsonPath = path.join(runDir, 'run.json');
let priorRuns = [];
if (existsSync(runJsonPath)) {
  try {
    const prev = JSON.parse(readFileSync(runJsonPath, 'utf8'));
    priorRuns = [...(prev.history ?? []), {
      commit: prev.commit, reps: prev.reps, startedAt: prev.startedAt,
      sandbox_commit: prev.sandbox?.tree_commit ?? null,
      questions: prev.questions,
      // WHICH AGENTS A PASS COVERED. Without this the report cannot tell a pass that
      // DEEPENED some questions from one that REPLACED an agent's whole half of the
      // matrix, and it printed the first explanation unconditionally. coding-v1-x2's
      // third pass re-ran every copilot and opencode cell after they were voided for
      // reading stale answer files; the report described that as "later passes added
      // reps to a subset of questions", which is not what happened.
      agents: prev.agents ?? null,
    }];
  } catch { /* unreadable manifest: start a fresh history */ }
}

writeFileSync(runJsonPath, JSON.stringify({
  runId, set: setName, reps, commit, dirty,
  ...(priorRuns.length ? { history: priorRuns } : {}),
  arms: arms.map((a) => ({ id: a.id, label: a.label, model: a.model, allowedTools: a.allowedTools, backend: a.backend })),
  agents: agentIds,
  models: modelRefs,
  combinations: combos.map((c) => ({
    arm: c.arm.id, agent: c.agentId, model: c.agent.model,
    elicitation: c.agent.elicitation, enforcement: c.agent.enforcement,
  })),
  // Refusals are part of the manifest, not a log line that scrolls away. A reader comparing
  // two runs needs to see that a combination was DECLINED rather than merely absent.
  ...(refusals.length ? { refused: refusals } : {}),
  questions: questions.map((q) => q.id),
  sandbox: tree
    ? { mode: 'worktree', tree_commit: tree.commit, excluded: tree.removed, verified: true }
    : { mode: 'none', verified: false, warning: 'arms could read the answer key; scores not comparable' },
  baselines, baselineSource, schemaTax,
  // `requested` is what this process asks the proxy for. `served` is filled in at the end
  // of the run from the judge's own responses, because it is the only evidence of what
  // actually graded the cells — and the two are not the same thing. r6 and r7 both
  // published `claude-opus-4.8` here while haiku answered every call.
  judge: { requested: { provider: JUDGE_PROVIDER, model: JUDGE_MODEL }, served: null, enabled: !flag("no-judge") },
  startedAt: new Date().toISOString(),
}, null, 2) + '\n');

if (dirty) out('kgbench: WARNING — working tree is dirty; the indexes and the tree may disagree');

// ---- matrix ----------------------------------------------------------------
const total = combos.length * questions.length * reps;
let n = 0;
// Only worth widening the progress line when there is more than one thing on the axis.
const showAgent = agentIds.length > 1 || agentIds[0] !== 'claude';
const showModel = modelRefs.length > 1;
// The judge identity the proxy actually served, learned from the first response, plus the
// substitution notice if it differs from what was requested. Both land in run.json so a
// reader never has to trust the requested name.
let judgeObserved = null;
let judgeSubstitution = null;
// A run that cannot reach the model produces a full table of zeros that looks like
// a result. Bail early and loudly instead.
let consecutiveApiErrors = 0;
const API_ERROR_ABORT = 3;
// A starved host produces cells that cost a full timeout each and measure nothing. Three
// in a row means the machine cannot currently run this benchmark, and continuing would
// burn hours to produce voids — the first clean run spent ~47 minutes that way before
// anyone looked.
let consecutiveHostStalls = 0;
const HOST_STALL_ABORT = 3;
// Rows whose answer cited the benchmark's own ground truth. With the sandbox in place
// this should stay empty; if it does not, containment has regressed and the run is void.
const contaminatedRows = [];
// Token bookkeeping for the closing summary — see the backfill note at the end of the run.
let unmeasuredTokenRows = 0;
let ambiguousTokenRows = 0;
for (const combo of combos) {
  const { arm, agentId, agent } = combo;
  for (const q of questions) {
    for (let rep = 1; rep <= reps; rep++) {
      n++;
      const key = cellKey({ arm: arm.id, agent: agentId, model: agent.model, question: q.id, rep });
      if (done.has(key)) continue;

      // MCP restriction for the non-claude agents, written where each CLI actually reads it
      // (copilot: .vscode/mcp.json in the sandbox; opencode: a pinned XDG_CONFIG_HOME). Per
      // cell, and cleaned up per cell — copilot's file lives INSIDE the measured tree, so
      // leaving it behind would make the next cell's containment check see a file the run
      // created itself. claude takes its server list on the command line and needs none of
      // this, so prepareAgentMcp is a no-op there.
      const mcp = prepareAgentMcp({ agent: agentId, arm, cwd: armCwd, runDir: armCwd, env: process.env });
      let res;
      try {
        res = await runCell({
          arm, question: q, rep, cwd: armCwd, env: mcp.env,
          // Two descriptors, each authoritative about a different half. agent-sandbox knows
          // WHICH FILE restricted MCP for this cell; agents.mjs knows what tool gating is
          // possible on this CLI, and draws a distinction the generic one flattens — copilot
          // is `not_enforced` (gateable, but this harness has no verified name mapping)
          // whereas opencode is `ungated` (no allowlist exists). Spreading mcp.enforcement
          // last overwrote that with a blanket `ungated`, turning unfinished work into a
          // permanent capability limit. The tool-gating fields win from the adapter.
          agent: agentId === 'claude' ? null : {
            ...agent,
            enforcement: { ...mcp.enforcement, ...agent.enforcement, mechanism: mcp.enforcement.mechanism },
          },
          runId,
        });
      } finally {
        mcp.cleanup();
      }

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
            judge_reason: j.reason ?? null, judge_provider: j.served_provider ?? null,
            judge_model_served: j.served_model ?? null,
            judge_model_requested: j.requested_model ?? JUDGE_MODEL,
            judge_served_as_requested: j.served_as_requested ?? null,
            ...(g.judgeOnly ? {} : { judge_agreement: reconcile(g.score, j.score) }),
          };
          // Announce a substitution ONCE, the first time it is seen. Per-cell would bury
          // it; never would publish a false provenance, which is what happened in r6/r7.
          if (j.served_model && j.served_as_requested === false && !judgeSubstitution) {
            judgeSubstitution = { requested: j.requested_model, served: j.served_model, provider: j.served_provider };
            out(`kgbench: WARNING — judge requested ${j.requested_model} but the proxy served `
              + `${j.served_model} (${j.served_provider}). Scores are graded by what was SERVED; `
              + 'run.json records that. Pin it with a processOverride for `kgbench-judge` '
              + '(scripts/configure-wave-analysis-routing.sh) — /api/complete ignores the request `model`.');
          }
          if (j.served_model && !judgeObserved) judgeObserved = { model: j.served_model, provider: j.served_provider };
          // For an llm-only question the judge IS the score.
          if (g.judgeOnly && j.score != null) scored.score = j.score;
        }
      }

      const ck = comboKey(combo);
      const base = baselines[ck];
      // content_tokens is a SUBTRACTION, so both sides must be measured the same way. A
      // DB-derived total minus a stream-json floor is not a difference of anything — the two
      // account for prompt caching differently — so a source mismatch yields null rather
      // than a number that looks fine and means nothing.
      const sourcesAgree = baselineSource[ck] != null
        && baselineSource[ck] === (res.token_source ?? 'stream-json');
      const row = {
        ...res, ...scored, ...judged,
        content_tokens: res.total_tokens != null && base != null && sourcesAgree
          ? Math.max(0, res.in_tokens - base) + (res.out_tokens ?? 0)
          : null,
        baseline_in_tokens: base ?? null,
        baseline_source: baselineSource[ck] ?? null,
        ...(res.total_tokens != null && base != null && !sourcesAgree
          ? { content_tokens_skipped: `baseline measured via ${baselineSource[ck] ?? 'nothing'}, cell via ${res.token_source}` }
          : {}),
        set: setName, commit, at: new Date().toISOString(),
      };
      appendFileSync(resultsFile, JSON.stringify(row) + '\n');

      // A cell whose tokens are not in the DB yet is normal, not an error: copilot's and
      // opencode's stop-adapters write on their own schedule, and one measured cell's row
      // landed a full minute after the runner had moved on. Counted so the run can point at
      // the offline backfill instead of leaving a column quietly empty.
      if (res.token_source === 'unmeasured') unmeasuredTokenRows++;
      if (res.token_ambiguous) ambiguousTokenRows++;
      if (scored.contaminated) contaminatedRows.push(`${arm.id}/${agentId}/${q.id}`);
      const mark = res.outcome !== 'ok' ? res.outcome.toUpperCase()
        : scored.contaminated ? 'CONTAM'
        : scored.score == null ? 'judge'
        : scored.score.toFixed(2);
      out(`  [${String(n).padStart(3)}/${total}] ${arm.id.padEnd(12)}`
        + (showAgent ? ` ${agentId.padEnd(10)}` : '')
        + (showModel ? ` ${String(agent.model).padEnd(24)}` : '')
        + ` ${q.id.padEnd(4)} rep${rep}  ${String(mark).padEnd(8)} ${res.wall_s}s`
        + (res.outcome === 'api_error' ? `  ${res.error}` : ''));

      if (res.outcome === 'host_stalled') {
        if (++consecutiveHostStalls >= HOST_STALL_ABORT) {
          out('');
          die(`aborting: ${HOST_STALL_ABORT} consecutive host stalls.\n`
            + `  Last: ${res.error}\n`
            + '  The machine is too loaded to measure anything. Check for background load\n'
            + '  (AV scanning this harness\'s /tmp worktrees is a known cause on managed macOS),\n'
            + `  then resume with --run-id ${runId} — completed cells are kept.`);
        }
      } else {
        consecutiveHostStalls = 0;
      }

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

// Record the judge identity that actually graded this run. Patched rather than rewritten
// so a resumed run keeps the history/sandbox facts the earlier pass established.
if (judgeObserved) {
  try {
    const meta = JSON.parse(readFileSync(runJsonPath, 'utf8'));
    meta.judge = { ...(meta.judge ?? {}), served: judgeObserved, ...(judgeSubstitution ? { substitution: judgeSubstitution } : {}) };
    writeFileSync(runJsonPath, JSON.stringify(meta, null, 2) + '\n');
  } catch { /* a run.json we cannot parse is not worth failing a completed matrix over */ }
}

out('');
if (judgeSubstitution) {
  out(`kgbench: judge was ${judgeSubstitution.served} (${judgeSubstitution.provider}), NOT the requested `
    + `${judgeSubstitution.requested}. run.json records the served identity.`);
}
if (contaminatedRows.length) {
  out(`kgbench: ${contaminatedRows.length} CONTAMINATED row(s): ${contaminatedRows.join(', ')}`);
  out('kgbench: those answers cited the benchmark ground truth and are excluded from ranking.');
  out('kgbench: containment has regressed — treat this run as void and fix lib/kgbench/sandbox.mjs.');
}
if (refusals.length) {
  out(`kgbench: ${refusals.length} (arm, agent) combination(s) were REFUSED and never ran; run.json lists them.`);
}
if (unmeasuredTokenRows) {
  out(`kgbench: ${unmeasuredTokenRows} cell(s) have no token figure yet — the stop-adapters that write`);
  out('kgbench: copilot/opencode rows run on their own schedule and can land a minute behind the cell.');
  out(`kgbench: fill them in with  node scripts/kgbench-backfill-tokens.mjs --run ${runId}`);
}
if (ambiguousTokenRows) {
  out(`kgbench: ${ambiguousTokenRows} cell(s) had more than one session of their agent inside the`);
  out('kgbench: measurement window — their token sums may include traffic that is not the cell.');
}
out(`kgbench: done. results -> ${resultsFile}`);
out(`kgbench: render with  node scripts/kgbench-report.mjs --run ${runId}`);
