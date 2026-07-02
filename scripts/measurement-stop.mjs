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
import { aggregateByTaskId, isForegroundGroup } from '../lib/experiments/token-aggregate.mjs';
import { captureForegroundTokens } from '../lib/lsl/token/stop-adapter-registry.mjs';
import { writeRun } from '../lib/experiments/run-write.mjs';
import { deriveGoalSentence } from '../lib/experiments/goal-sentence.mjs';
import { buildNormalizedTrace } from '../lib/lsl/route/build-trace.mjs';
import { computeHeuristics, ALL_NULL_HEURISTICS } from '../lib/experiments/route-heuristics.mjs';
import { normalizeAgent, buildTraceSeam } from '../lib/experiments/route-trace-resolve.mjs';
// 73-06 (Wave 3) — wire the success-scoring half into the close pipeline (ROUTE-03 +
// SCORE-01). gatherEvidence reads on-disk artifacts (73-03); runJudge does the ONE
// Haiku /api/complete call and internally quarantines to pending (73-04, never throws);
// writeScore materializes the Score + scored edge (73-02); filterConsequential/
// isTrivialRun (73-01) drive the D-04 trivial-run short-circuit (no proxy paid).
import { gatherEvidence } from '../lib/experiments/evidence-harness.mjs';
import { runJudge } from '../lib/experiments/judge.mjs';
import { writeScore } from '../lib/experiments/score-write.mjs';
import { filterConsequential, isTrivialRun } from '../lib/experiments/consequential-events.mjs';
// Phase 67-07 (REPRO-01/02): archive the span's fixtures into the RunSnapshot at
// close + link snapshot_id onto the Run. recordHarnessFixtures scrapes the
// WebSearch/WebFetch/MCP tool_use pairs for the span window (LLM fixtures are
// already written into the snapshot's fixtures/llm/ by the Plan 06 record tap).
// sanitizeTaskId keeps the snapshot dir under .data/run-snapshots/ (T-67-07-01).
import { recordHarnessFixtures } from '../lib/repro/fixtures/harness-record.mjs';
import { sanitizeTaskId } from '../lib/repro/capture-snapshot.mjs';

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

/**
 * Find a not-yet-closed dashboard close-request marker (two-phase stop). The
 * vkb-server measurement/stop endpoint archives the span + writes
 * <task_id>.close-requested.json {closed:false}; this lets the host close resume
 * from it when no active span remains. Returns { marker, path } or null.
 */
function findPendingCloseRequest(archiveDir) {
  let names;
  try { names = fs.readdirSync(archiveDir); } catch { return null; }
  const markers = [];
  for (const n of names) {
    if (!n.endsWith('.close-requested.json')) continue;
    try {
      const p = path.join(archiveDir, n);
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (m && m.task_id && m.closed !== true) {
        markers.push({ marker: m, path: p, requested_at: m.requested_at || '' });
      }
    } catch { /* skip malformed marker */ }
  }
  if (markers.length === 0) return null;
  // IN-01: order newest-first by parsed time, not lexical localeCompare (which
  // only works for ISO-8601 strings). Unparseable timestamps sort last (-Infinity).
  markers.sort((a, b) => {
    const ta = Date.parse(a.requested_at);
    const tb = Date.parse(b.requested_at);
    return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
  });
  return markers[0];
}

async function main() {
  const args = process.argv.slice(2);

  // ── (1) Archive the active span (original behavior — idempotent no-span path) ──
  const modUrl = pathToFileURL(path.join(PROXY_DIST, 'measurement-span.js')).href;
  const { stopMeasurement, resolveMeasurementPaths } = await import(modUrl);

  const { archiveDir } = resolveMeasurementPaths();
  let archived = stopMeasurement();
  let closeMarker = null;
  let closeMarkerPath = null;
  if (!archived) {
    // No active span. A dashboard-initiated stop (vkb-server measurement/stop) may have
    // already archived the span + left a *.close-requested.json marker — finish the
    // close from that (two-phase stop). Otherwise the original idempotent no-op.
    const pending = findPendingCloseRequest(archiveDir);
    if (!pending) {
      process.stdout.write('no active measurement span\n');
      process.exit(0);
    }
    closeMarker = pending.marker;
    closeMarkerPath = pending.path;
    archived = { task_id: closeMarker.task_id };
    process.stdout.write(`resuming dashboard-requested close task_id=${closeMarker.task_id}\n`);
  } else {
    // Adopt a close-request marker for THIS task if the dashboard wrote one (task_class).
    const mp = path.join(archiveDir, `${archived.task_id}.close-requested.json`);
    try { closeMarker = JSON.parse(fs.readFileSync(mp, 'utf8')); closeMarkerPath = mp; } catch { /* none */ }
    process.stdout.write(`stopped measurement span task_id=${archived.task_id} ended_at=${archived.ended_at}\n`);
  }

  const archivePath = path.join(archiveDir, `${archived.task_id}.json`);
  process.stdout.write(`archived: ${archivePath}\n`);

  // ── (2) Derive / prompt / enforce the task_class ──
  const span = readArchivedSpan(archivePath, archived);
  const taxonomy = loadTaxonomy();

  // A dashboard close-request marker can carry the operator-chosen task_class; treat it
  // like an explicit --task-class when the flag is absent (still closed-6 validated below).
  const explicit = parseStrArg(args, '--task-class') ?? (closeMarker && closeMarker.task_class) ?? null;
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

  // ── (3.0) D-03 capture foreground tokens BEFORE aggregation ──
  //   The foreground Claude session talks to Anthropic DIRECTLY (bypassing the
  //   proxy), so its own tokens are absent from token_usage until the stop-adapter
  //   captures them as cladpt rows stamped with this task_id. Run this FIRST so
  //   those rows exist when the fg/bg sum below runs. The agent for an interactive
  //   Claude session is 'claude' (derive from the span / known foreground, default
  //   'claude'). Best-effort exactly like the (4.5) score path — captureForegroundTokens
  //   already swallows internally, but wrap it here too so the close NEVER crashes.
  const foregroundAgent = span.agent ?? span.meta?.agent ?? 'claude';
  try {
    await captureForegroundTokens(span, { agent: foregroundAgent });
  } catch (err) {
    process.stderr.write(
      `[measurement-stop] foreground capture failed (non-fatal): ${err.message}\n`,
    );
  }

  // ── (3.1) Token aggregation (read-only) + fg/bg split → canonical (D-05/D-06) ──
  const { totals, byAgentModel } = aggregateByTaskId(span.task_id);
  // Split the breakdown into the measured foreground groups vs the concurrent
  // background-daemon groups (isForegroundGroup = adapter user_hash AND a
  // non-denylisted process). Canonical = the FIRST foreground group (or null) —
  // NEVER the dominant-by-count row, which was the finding-B bug (a 1.24M-token
  // haiku daemon out-massed the Opus foreground). null persists as "unmeasured"
  // downstream — it is never coerced to a dominant fallback (D-05).
  const fgGroups = byAgentModel.filter(isForegroundGroup);
  const bgGroups = byAgentModel.filter((g) => !isForegroundGroup(g));
  // Canonical = the largest foreground group that is NOT a captured sub-agent
  // (ATTR-04). Sub-agent rows are foreground (they belong to this task) and count
  // toward totals, but the canonical CHAT model is the interactive main session —
  // never a Task/Agent sub-agent, which may run a cheaper model (e.g. Explore on
  // haiku) with more tokens and would otherwise win fgGroups[0] (ordered by tokens).
  // Fall back to fgGroups[0] only if the main session left no non-subagent group.
  const isSubagentGroup = (g) => g?.process === 'token-adapter-claude-subagent';
  const canonical = fgGroups.find((g) => !isSubagentGroup(g)) ?? fgGroups[0] ?? null;
  // canonical_model stays null when no foreground group was measured — we NEVER
  // guess a model (D-05: null persists as "unmeasured", never coerced to a
  // dominant fallback).
  const canonicalModel = canonical?.model ?? null;
  // Normalize to a canonical agent family. Proxy token rows leave `agent` blank
  // and only set `model` (e.g. 'claude-sonnet-4.6'), so the raw group `agent` is
  // '' for Claude/Copilot runs — which made the route reader short-circuit to
  // null. Derive the family from (agent, model) so heuristics actually populate.
  // When NO foreground group was captured (the Anthropic-direct bypass: an
  // interactive Claude session talks to Anthropic directly, leaving no proxy/
  // adapter rows), fall back to the span's DECLARED foreground agent so the Run is
  // still attributed to the actor that ran it. Agent-only — the model stays null.
  const canonicalAgent = canonical
    ? normalizeAgent(canonical)
    : normalizeAgent({ agent: foregroundAgent });
  // Segregate the background daemons (model, process, total_tokens) — nothing is
  // dropped, so the operator can still see what ran concurrently (D-02).
  const backgroundModels = bgGroups.map((g) => ({
    model: g.model,
    process: g.process,
    total_tokens: g.total_tokens,
  }));

  // ── (3.2) A1 Anthropic-direct bypass-guard (non-fatal warning) ──
  //   A normally-proxy-routed in-scope agent (claude/copilot/opencode/mastra) that
  //   ran with NEITHER proxy rows (no group in byAgentModel for it) NOR adapter
  //   rows (no fgGroups for it) may have bypassed the proxy entirely — the
  //   network-dependent Anthropic-direct / Claude-Max path outside VPN. Emit ONE
  //   warning so the uncaptured tokens are VISIBLE rather than silently lost
  //   (A1 / T-75-43). This reuses byAgentModel/fgGroups already computed — no new
  //   query — and is a WARNING only: it NEVER blocks the close.
  const IN_SCOPE_AGENTS = new Set(['claude', 'copilot', 'opencode', 'mastra']);
  if (IN_SCOPE_AGENTS.has(foregroundAgent)
      && byAgentModel.length === 0
      && fgGroups.length === 0) {
    process.stderr.write(
      `[measurement-stop] WARN: agent ${foregroundAgent} ran with no proxy rows ` +
      'and no adapter rows — possible Anthropic-direct bypass; tokens may be ' +
      'uncaptured (A1)\n',
    );
  }

  // ── (3.3) Phase 67-07: archive fixtures into the RunSnapshot + resolve snapshot_id ──
  //   The LLM record tap (Plan 06) already wrote the recorded /api/complete responses
  //   directly into .data/run-snapshots/<id>/fixtures/llm/ during the record run. Here,
  //   best-effort, we (a) scrape the harness channels (WebSearch/WebFetch/MCP) for the
  //   span window into fixtures/harness/, and (b) resolve snapshot_id from the snapshot
  //   dir so writeRun links the Run to its snapshot. ALL best-effort (try/catch + stderr):
  //   a fixture-archive failure NEVER breaks span close (T-67-07-05).
  let snapshotId = null;
  try {
    const snapshotDirId = sanitizeTaskId(span.task_id);
    const snapDir = path.join(REPO_ROOT, '.data', 'run-snapshots', snapshotDirId);
    if (fs.existsSync(snapDir)) {
      snapshotId = snapshotDirId; // link the Run to this snapshot
      const fixturesDir = path.join(snapDir, 'fixtures');
      if (span.started_at && span.ended_at) {
        const n = recordHarnessFixtures({
          startedAt: span.started_at,
          endedAt: span.ended_at,
          outDir: fixturesDir,
        });
        process.stderr.write(
          `[measurement-stop] archived ${n} harness fixture(s) into ${fixturesDir} ` +
          '(LLM fixtures already written by the record tap)\n',
        );
      }
    }
  } catch (err) {
    process.stderr.write(`[measurement-stop] fixture archive failed (non-fatal): ${err.message}\n`);
  }

  const taskHash = span.goal_sentence
    ? crypto.createHash('sha256').update(span.goal_sentence).digest('hex')
    : null; // A3 — null allowed (D-13)
  const tags = {
    task_hash: taskHash,
    agent: canonicalAgent, // canonical foreground family (D-05); null when unmeasured
    model: canonicalModel,
    framework: span.meta?.framework ?? canonicalAgent, // A2 — null allowed (D-13)
    trace_id: span.task_id,
    snapshot_id: snapshotId, // Phase 67-07: link the Run to its RunSnapshot (null when none)
    // ── D-06: canonical attribution + segregated background daemons ──
    canonical_model: canonicalModel,
    canonical_agent: canonicalAgent,
    background_models: backgroundModels,
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
    dominantAgent: canonicalAgent,
    __seam: buildTraceSeam(canonicalAgent, span),
  });
  const heuristics = trace ? computeHeuristics(trace) : ALL_NULL_HEURISTICS;

  // ── (4) Persist the Run (idempotent) — flat heuristics + one Route node (D-09) ──
  const store = await openExperimentStore();
  let pendingCount;
  let judgment; // surfaced in the (5) close summary (ratio + scored/pending/trivial marker)
  try {
    await writeRun(store, { span, taskClass, pending, tags, totals, heuristics });

    // ── (4.5) gather evidence (D-01) → judge (D-03/D-04) → writeScore + scored edge ──
    //   The whole scoring path lives INSIDE this try so the SAME open store is reused
    //   and the existing finally still close()s it. runJudge internally try/catch-
    //   quarantines to { ...nulls, pending:true } and NEVER throws (73-04), and
    //   writeScore is a local store write — so the close can NOT hard-block on a
    //   slow/unreachable proxy (T-73-06-BLOCK / the "never hard-block" contract).
    const evidence = gatherEvidence({ span, phaseArg, repoRoot: REPO_ROOT });
    const consequential = trace ? filterConsequential(trace) : [];
    judgment = isTrivialRun(trace)
      ? { not_scored: 'trivial' } // D-04 trivial-run guard — proxy NEVER called
      : await runJudge({ span, trace: consequential, evidence });
    await writeScore(store, { span, judgment });

    pendingCount = await countPending(store);
  } finally {
    await store.close();
  }

  // ── (5) Close summary ──
  //   Resolve a single scored/pending/trivial marker + the goal_aligned_ratio so the
  //   operator sees how the run was judged without querying the store.
  const scoreMarker = judgment?.not_scored === 'trivial'
    ? 'trivial'
    : (judgment?.pending === true ? 'pending' : 'scored');
  const ratioStr = judgment?.goal_aligned_ratio == null
    ? 'null'
    : judgment.goal_aligned_ratio.toFixed(3);
  process.stdout.write(
    `close summary: task_class=${taskClass}${pending ? ' (quarantined/pending)' : ''} ` +
    `total_tokens=${totals.total_tokens ?? 0} calls=${totals.calls ?? 0} ` +
    `score=${scoreMarker} goal_aligned_ratio=${ratioStr}\n`,
  );
  if (pendingCount > 0) {
    process.stdout.write(
      `quarantine: ${pendingCount} pending Run(s) excluded from queries — ` +
      `resolve with: node scripts/experiments-classify.mjs\n`,
    );
  }

  // Mark the dashboard close-request marker resolved (two-phase stop bookkeeping) so a
  // re-run of measurement-stop.mjs does not re-close the same already-scored span.
  if (closeMarkerPath) {
    try {
      fs.writeFileSync(
        closeMarkerPath,
        JSON.stringify({ ...closeMarker, closed: true, closed_at: new Date().toISOString() }, null, 2),
      );
    } catch { /* best-effort bookkeeping */ }
  }
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
