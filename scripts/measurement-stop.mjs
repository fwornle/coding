#!/usr/bin/env node
/**
 * Operator CLI — the Phase-71 close ORCHESTRATOR (D-07). Extends the original
 * TELEM-02 span-close (Phase 68-02) into the full run-end pipeline.
 *
 * Pipeline (RESEARCH §"System Architecture Diagram"):
 *   (1) stopMeasurement()  — archive the active span (the original behavior). The
 *       proxy stamps ended_at = now and writes <dataDir>/measurements/<task_id>.json,
 *       then removes active-measurement.json. Idempotent: no active span ⇒ notice + exit 0.
 *   (2) derive / prompt the task_class — read the archived span JSON for
 *       goal_sentence/metadata, build a derive text (+ optional --goal/--phase
 *       args) and run the zero-LLM verb→class heuristic (deriveClassFromText, D-11).
 *       Branch on close mode:
 *         • --task-class <cls> explicit override → validated against the closed-6
 *           (isValidClass); FREE STRINGS REJECTED with a non-zero exit (D-09/SC-4).
 *         • interactive (TTY, not headless) → readline confirm/override the candidate (D-05).
 *         • headless (--headless / CI / no TTY) and not confident → task_class='unclassified'
 *           + pending=true (D-06 quarantine) and NEVER throw — the close must not hard-block.
 *   (3) aggregateByTaskId(task_id) — read-only token totals + dominant agent/model (71-03).
 *   (4) openExperimentStore() → writeRun(store, { span, taskClass, pending, tags, totals }) (71-04),
 *       in a try/finally that always close()s the store.
 *   (5) print a close summary (resolved task_class, total tokens, current pending count).
 *
 * D-05 auto-invoke at /gsd run-end is DEFERRED (71-05 decision = defer-hook): this
 * file is callable manually (`node scripts/measurement-stop.mjs [--task-class …]`)
 * and by any future hook; NO /gsd auto-invoke wiring lives here.
 *
 * Import-resolution decision: see scripts/measurement-start.mjs — imports the
 * measurement-span surface from the LOCAL proxy build (the same dist the daemon
 * loads), since coding's node_modules pins the older v1.0.0 tarball. The
 * lib/experiments/* modules come from the in-repo shared module (71-01..04).
 *
 * Output via process.stdout.write / process.stderr.write only — the no-console-log
 * rule (CLAUDE.md) forbids the stdout/err logging family here.
 *
 * Usage:
 *   node scripts/measurement-stop.mjs                          # derive+prompt (TTY) / quarantine (headless)
 *   node scripts/measurement-stop.mjs --task-class refactor    # explicit closed-6 override
 *   node scripts/measurement-stop.mjs --headless               # never prompt; quarantine if unsure
 *   node scripts/measurement-stop.mjs --goal "<sentence>"      # extra derive text
 *
 * Env:
 *   LLM_PROXY_DATA_DIR  data dir for the span files (default <cwd>/.data)
 *   LLM_PROXY_DIST_DIR  proxy dist dir (default _work/rapid-llm-proxy/dist)
 *   CI                  any truthy value forces headless (no prompt)
 */

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

// lib/experiments/* — the shared experiment module (71-01..04). openExperimentStore
// constructs GraphKMStore WITH the mandatory ontologyDir (CLAUDE.md km-core rule),
// so the strict-path writeRun validates entityType against the experiment registry.
import { openExperimentStore } from '../lib/experiments/store.mjs';
import { loadTaxonomy, isValidClass, deriveClassFromText } from '../lib/experiments/taxonomy.mjs';
import { aggregateByTaskId } from '../lib/experiments/token-aggregate.mjs';
import { writeRun } from '../lib/experiments/run-write.mjs';
import { deriveGoalSentence } from '../lib/experiments/goal-sentence.mjs';
import { buildNormalizedTrace } from '../lib/lsl/route/build-trace.mjs';
import { computeHeuristics, ALL_NULL_HEURISTICS } from '../lib/experiments/route-heuristics.mjs';
import { normalizeAgent, buildTraceSeam } from '../lib/experiments/route-trace-resolve.mjs';

const REPO_ROOT = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';

const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR
  || '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';

/** Pull a `--flag value` string from argv, or null when absent. */
function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

/** A close is headless when --headless is passed, CI is set, or there is no TTY. */
function isHeadless(argv) {
  if (argv.includes('--headless')) return true;
  if (process.env.CI) return true;
  return !process.stdin.isTTY;
}

/**
 * Read the archived span JSON the proxy wrote in step (1). Returns the parsed
 * object (which already carries task_id/started_at/ended_at and optionally
 * goal_sentence/meta), falling back to the in-memory `archived` record if the
 * file is unreadable for any reason (the close must not hard-block on a read).
 */
function readArchivedSpan(archivePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Best-effort locate the active phase's PLAN.md for a /gsd run (D-03). Given the
 * phases root and a phase token (number or '72-name' slug), find the matching
 * `<NN>-<slug>` phase dir and return the FIRST `*-PLAN.md` inside it. Fail-soft:
 * returns null on any read error or no match (deriveGoalSentence then falls back
 * to ROADMAP, and ultimately quarantines per D-05 — the close NEVER hard-blocks).
 */
function locatePlanMd(phasesRoot, phaseToken) {
  try {
    const num = String(phaseToken).trim().match(/^\d+/)?.[0];
    if (!num) return null;
    const dirs = fs.readdirSync(phasesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && new RegExp(`^0*${num}(?:[.-]|$)`).test(d.name))
      .map((d) => d.name);
    if (dirs.length === 0) return null;
    const phaseDir = path.join(phasesRoot, dirs[0]);
    const plans = fs.readdirSync(phaseDir).filter((f) => /-PLAN\.md$/.test(f)).sort();
    if (plans.length === 0) return null;
    return path.join(phaseDir, plans[0]);
  } catch {
    return null;
  }
}

/** Ask one question on the TTY and resolve the trimmed answer. */
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer).trim());
    });
  });
}

/** Count Runs currently quarantined (pending:true) — surfaced in the close summary (D-08). */
async function countPending(store) {
  let n = 0;
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.pending === true) n += 1;
  }
  return n;
}

async function main() {
  const args = process.argv.slice(2);

  // ── (1) Archive the active span (original behavior — idempotent no-span path) ──
  const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
  const { stopMeasurement, resolveMeasurementPaths } = await import(modUrl);

  const archived = stopMeasurement();
  if (!archived) {
    process.stdout.write('no active measurement span\n');
    process.exit(0);
  }

  const { archiveDir } = resolveMeasurementPaths();
  const archivePath = path.join(archiveDir, `${archived.task_id}.json`);
  process.stdout.write(`stopped measurement span task_id=${archived.task_id} ended_at=${archived.ended_at}\n`);
  process.stdout.write(`archived: ${archivePath}\n`);

  // ── (2) Derive / prompt / enforce the task_class ──
  const span = readArchivedSpan(archivePath, archived);
  const taxonomy = loadTaxonomy();

  const explicit = parseStrArg(args, '--task-class');
  const goalArg = parseStrArg(args, '--goal');
  const phaseArg = parseStrArg(args, '--phase');
  const deriveText = [span.goal_sentence, goalArg, phaseArg].filter(Boolean).join(' ');
  const derived = deriveClassFromText(deriveText, taxonomy); // { taskClass, confident }

  let taskClass;
  let pending = false;

  if (explicit !== null) {
    // Explicit override — closed-6 enum gate (T-71-05-01 / SC-4 write-path enforcement).
    if (!isValidClass(explicit, taxonomy)) {
      process.stderr.write(
        `error: --task-class '${explicit}' is not a valid taxonomy class. ` +
        `Allowed: ${Object.keys(taxonomy.classes).join(', ')}\n`,
      );
      process.exit(2);
    }
    taskClass = explicit;
  } else if (!isHeadless(args)) {
    // Interactive: surface the candidate as a SUGGESTION only (D-05). A blank answer
    // ALWAYS quarantines (D-06) — it never silently confirms the candidate (WR-02).
    // To accept the heuristic the operator must type the class explicitly.
    const candidate = derived.confident ? derived.taskClass : '';
    const hint = candidate ? ` (suggested: ${candidate})` : '';
    const answer = await prompt(
      `task_class${hint} (one of: ${Object.keys(taxonomy.classes).join(', ')}; blank to quarantine): `,
    );
    const chosen = answer; // NOT `answer || candidate` — blank must quarantine, not confirm (WR-02).
    if (!chosen) {
      // Operator declined to classify → quarantine (D-06), do not throw.
      taskClass = 'unclassified';
      pending = true;
    } else if (!isValidClass(chosen, taxonomy)) {
      process.stderr.write(
        `error: '${chosen}' is not a valid taxonomy class. ` +
        `Allowed: ${Object.keys(taxonomy.classes).join(', ')}\n`,
      );
      process.exit(2);
    } else {
      taskClass = chosen;
    }
  } else if (derived.confident) {
    // Headless but the heuristic is confident — accept the derived class.
    taskClass = derived.taskClass;
  } else {
    // Headless + no confident class → quarantine (D-06). NEVER throw / hard-block.
    taskClass = 'unclassified';
    pending = true;
  }

  // ── (2.5) Populate / refine goal_sentence BEFORE writeRun (ROUTE-01, D-03/D-04/D-05) ──
  //   • /gsd run (--phase present OR a locatable PLAN.md): derive from the active
  //     phase PLAN.md '**Goal**:' line (ROADMAP fallback) — zero-LLM (D-03). Only
  //     assigned when the span does not already carry a goal.
  //   • freeform interactive (TTY): confirm/EDIT the goal at close, pre-filled with
  //     the start-prompt value the START side captured (D-04 edit-at-close).
  //   • headless with no goal: leave empty → pending=true via the quarantine path
  //     below (D-05). NEVER block.
  if (!span.goal_sentence && phaseArg) {
    const planPath = path.join(REPO_ROOT, '.planning', 'phases');
    // Best-effort PLAN.md/ROADMAP derive; deriveGoalSentence is fail-soft (returns '').
    const roadmapPath = path.join(REPO_ROOT, '.planning', 'ROADMAP.md');
    const derivedGoal = deriveGoalSentence({
      phase: phaseArg,
      planPath: locatePlanMd(planPath, phaseArg),
      roadmapPath,
    });
    if (derivedGoal) span.goal_sentence = derivedGoal;
  }
  if (!isHeadless(args)) {
    // Freeform edit-at-close (D-04): pre-fill with the current goal (start-prompt or derived).
    const current = span.goal_sentence ?? '';
    const hint = current ? ` [${current}]` : '';
    const answer = await prompt(`run goal_sentence${hint} (blank to keep): `);
    if (answer) span.goal_sentence = answer; // explicit edit overrides; blank keeps current
  }

  // ── (3) Token aggregation (read-only) + tag sourcing ──
  const { totals, byAgentModel } = aggregateByTaskId(span.task_id);
  const dominant = byAgentModel[0] ?? {};
  // Normalize to a canonical agent family. Proxy token rows leave `agent` blank
  // and only set `model` (e.g. 'claude-sonnet-4.6'), so the raw `dominant.agent`
  // is '' for Claude/Copilot runs — which made the route reader short-circuit to
  // null. Derive the family from (agent, model) so heuristics actually populate.
  const normAgent = normalizeAgent(dominant);
  const taskHash = span.goal_sentence
    ? crypto.createHash('sha256').update(span.goal_sentence).digest('hex')
    : null; // A3 — null allowed (D-13)
  const tags = {
    task_hash: taskHash,
    agent: normAgent ?? dominant.agent ?? null, // canonical family when classifiable
    model: dominant.model ?? null,
    framework: span.meta?.framework ?? normAgent ?? dominant.agent ?? null, // A2 — null allowed (D-13)
    trace_id: span.task_id,
  };

  // ── (3.5/3.6) Route heuristics from the normalized cross-agent trace ──
  //   buildNormalizedTrace dispatches on the dominant agent, time-window-scopes the
  //   events, and returns null when no trace file is located (D-02/Pitfall 4). A null
  //   trace ⇒ ALL_NULL_HEURISTICS — six nulls, NOT zeros (D-02). A malformed/unreadable
  //   trace already degrades to null inside the readers, so the close still completes.
  //   Claude/Copilot need the close orchestrator to resolve the per-run session file
  //   and inject it via the seam (build-trace.mjs's default locator is a stub by
  //   design); buildTraceSeam supplies a time-window-based Claude locator.
  const trace = await buildNormalizedTrace(span, {
    dominantAgent: normAgent,
    __seam: buildTraceSeam(normAgent, span),
  });
  const heuristics = trace ? computeHeuristics(trace) : ALL_NULL_HEURISTICS;

  // ── (4) Persist the Run (idempotent) — flat heuristics + one Route node (D-09) ──
  const store = await openExperimentStore();
  let pendingCount;
  try {
    await writeRun(store, { span, taskClass, pending, tags, totals, heuristics });
    pendingCount = await countPending(store);
  } finally {
    await store.close();
  }

  // ── (5) Close summary ──
  process.stdout.write(
    `close summary: task_class=${taskClass}${pending ? ' (quarantined/pending)' : ''} ` +
    `total_tokens=${totals.total_tokens ?? 0} calls=${totals.calls ?? 0}\n`,
  );
  if (pendingCount > 0) {
    process.stdout.write(
      `quarantine: ${pendingCount} pending Run(s) excluded from queries — ` +
      `resolve with: node scripts/experiments-classify.mjs\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
