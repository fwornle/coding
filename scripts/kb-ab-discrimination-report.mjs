#!/usr/bin/env node
/**
 * Report the DISCRIMINATION RATE for a sampled kb-ab run.
 *
 *   node scripts/kb-ab-discrimination-report.mjs
 *   node scripts/kb-ab-discrimination-report.mjs --json
 *   node scripts/kb-ab-discrimination-report.mjs --no-audit     # skip the per-fact grep pass
 *
 * WHY TWO NUMBERS, NOT ONE. The published A/B reports an effect size: on the tasks it ran,
 * injection was decisively better and much cheaper. What it cannot report is how OFTEN that case
 * arises, because its tasks were selected for it. The rate here is the missing number — the
 * fraction of KB-derived tasks the control arm cannot solve, i.e. how much of the knowledge base is
 * non-redundant. The effect size is reported beside it, conditioned on the tasks that discriminate,
 * because a rate without an effect size says nothing about whether the wins are worth having.
 *
 * THE AUDIT VERDICT IS A COLUMN, NOT A FILTER. Every sampled task is in the denominator whatever
 * its recoverability verdict, and the rate is also split BY verdict. That split is itself a
 * measurement: kb-ab-etm-crashloop audits FAIL — all four facts grep-able — and discriminated
 * anyway, because the control arm searched 123 times across three cells and never found them. Any
 * FAIL-verdict task that discriminates here is another instance of "grep-able is not recoverable",
 * and quantifies how badly a filter-shaped audit would have mis-selected.
 *
 * READ-ONLY STORE. `close()` persists the WHOLE graph as one value under one key, so a store opened
 * merely to read rewrites everything on close — the failure that OOM-killed vkb-server on every
 * poll (CLAUDE.md). This opens with readOnly:true, which sets persistOnClose:false.
 *
 * Diagnostics via process.stdout/stderr .write only (no console.* — no-console-log, CLAUDE.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { openExperimentStore } from '../lib/experiments/store.mjs';
import { readRuns } from '../lib/experiments/query.mjs';
import { auditSpec } from './experiment-audit-recoverability.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(REPO_ROOT, '.data', 'kb-ab-sampler');

const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);

// ── statistics ─────────────────────────────────────────────────────────────

/**
 * Wilson score interval.
 *
 * NOT the normal approximation: at n=10 with a proportion near 0 or 1 — exactly where a pilot
 * lands — the normal interval runs past 0/1 and understates the uncertainty. Wilson stays inside
 * [0,1] and is honest about how little 10 tasks pin down.
 */
export function wilson(successes, n, z = 1.96) {
  if (!n) return { low: 0, high: 1, point: null };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { point: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmtPct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
const fmtNum = (x, d = 1) => (x == null ? '—' : x.toFixed(d));

// ── run join ───────────────────────────────────────────────────────────────

/**
 * Split a cell task_id into its parts.
 * Shape: `<experiment_id>--<agent>-<model>-<framework>-<env>--r<N>` (composeTaskId).
 */
export function parseTaskId(taskId) {
  const parts = String(taskId).split('--');
  if (parts.length < 3) return null;
  const experimentId = parts[0];
  const cell = parts[1];
  const rep = Number(String(parts[2]).replace(/^r/, ''));
  const env = /-(kb-on|kb-off|default)$/.exec(cell)?.[1] ?? null;
  return { experimentId, cell, rep, env };
}

/** Wall-clock seconds for one run, or null when either stamp is missing. */
function seconds(row) {
  const a = Date.parse(row.started_at ?? '');
  const b = Date.parse(row.ended_at ?? '');
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 1000 : null;
}

/**
 * Per-arm aggregate for one task.
 *
 * `scored` is the honest denominator, not `n`. A cell that never executed still writes a row —
 * a preflight skip (`skip_reason: 'preflight:...'`) lands with terminal_state null, no steps and
 * gate_passed null after ~5 seconds. Counting those rows as gate failures reports "neither arm
 * solved it" about an agent that was never invoked, which is the exact mislabel this whole report
 * exists to avoid. All six cells of kbm-smoke-spec-snapshot-restore-km-core-blockers were such
 * skips in the 2026-08-25 round and were published as 0/3 + 0/3 `neither-solves`.
 */
function armStats(rows) {
  const accepted = rows.filter((r) => r.score?.gate_passed === true).length;
  const ungated = rows.filter((r) => r.score?.gate_passed == null).length;
  return {
    n: rows.length,
    scored: rows.length - ungated,
    accepted,
    ungated,
    steps: mean(rows.map((r) => r.total_step_count).filter((x) => typeof x === 'number')),
    seconds: mean(rows.map(seconds).filter((x) => x != null)),
    tokens: mean(rows.map((r) => r.outcome?.totalTokens).filter((x) => typeof x === 'number')),
  };
}

/**
 * The report's 2x2, per task.
 *
 * "Produces it" is a MAJORITY of the arm's repeats, not a single lucky one: with 2 repeats a single
 * flaky cell would otherwise flip a task's classification, and the rate is a count of tasks. The
 * strict all-or-nothing reading is reported alongside rather than instead, because the choice moves
 * the number and burying it would repeat the sin this whole exercise is correcting.
 */
export function classify(on, off) {
  // An arm with no GRADED repeat has no result to compare. Returning 'neither-solves' here would
  // claim a measurement about cells that never ran; the task leaves the rate's denominator instead.
  if (!on.scored || !off.scored) return 'not-run';
  const majority = (a) => a.scored > 0 && a.accepted >= Math.ceil(a.scored / 2);
  const kbOn = majority(on);
  const kbOff = majority(off);
  if (kbOn && !kbOff) return 'discriminates';
  if (kbOn && kbOff) return 'kb-redundant';
  if (!kbOn && !kbOff) return 'neither-solves';
  return 'injection-hurt';
}

const OUTCOME_MEANING = {
  discriminates: 'injection carried the answer — the measurable case',
  'kb-redundant': 'the repository already answers it; the KB adds nothing here',
  'neither-solves': 'a broken gate, or beyond both arms',
  'injection-hurt': 'injection actively hurt — the retired task\'s failure mode',
  'not-run': 'at least one arm never executed — excluded from the rate, not a result',
};

// ── main ───────────────────────────────────────────────────────────────────

async function main(argv) {
  const json = argv.includes('--json');
  const doAudit = !argv.includes('--no-audit');
  const ledgerPath = (() => {
    const i = argv.indexOf('--ledger');
    return i >= 0 && argv[i + 1] ? argv[i + 1] : path.join(OUT_ROOT, 'ledger.json');
  })();

  if (!fs.existsSync(ledgerPath)) {
    err(`[kb-ab-report] no ledger at ${ledgerPath} — run scripts/kb-ab-sample-tasks.mjs first\n`);
    return 2;
  }
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const derived = (ledger.tasks ?? []).filter((t) => t.status === 'derived');
  if (!derived.length) {
    err('[kb-ab-report] the ledger contains no derived tasks\n');
    return 2;
  }

  // READ-ONLY: see the header. A polled read path that persists on close is what OOM-killed
  // vkb-server; this is a one-shot CLI, but the invariant is the store's, not the caller's.
  const store = await openExperimentStore({ readOnly: true });
  let rows;
  try {
    rows = await readRuns(store);
  } finally {
    await store.close();
  }

  const byExperiment = new Map();
  for (const row of rows) {
    const parsed = parseTaskId(row.task_id);
    if (!parsed) continue;
    if (!byExperiment.has(parsed.experimentId)) byExperiment.set(parsed.experimentId, []);
    byExperiment.get(parsed.experimentId).push({ ...row, _parsed: parsed });
  }

  const tasks = [];
  for (const t of derived) {
    const cells = byExperiment.get(t.topic_id) ?? [];
    const on = armStats(cells.filter((c) => c._parsed.env === 'kb-on'));
    const off = armStats(cells.filter((c) => c._parsed.env === 'kb-off'));
    if (!on.n && !off.n) {
      tasks.push({ ...t, status: 'not-run', outcome: null, on, off });
      continue;
    }
    let verdict = null;
    let outOfReach = null;
    if (doAudit) {
      const specPath = path.join(OUT_ROOT, 'specs', `${t.topic_id}.yaml`);
      if (fs.existsSync(specPath)) {
        try {
          const a = auditSpec({ specPath });
          verdict = a.verdict;
          outOfReach = Array.isArray(a.facts) ? a.facts.filter((f) => f.required && !f.recoverable).length : null;
        } catch (e) {
          verdict = `error: ${e.message.slice(0, 60)}`;
        }
      }
    }
    tasks.push({
      ...t,
      status: 'run',
      on,
      off,
      outcome: classify(on, off),
      strictDiscriminates: on.scored > 0 && off.scored > 0 && on.accepted === on.scored && off.accepted === 0,
      auditVerdict: verdict,
      requiredFactsOutOfReach: outOfReach,
    });
  }

  const run = tasks.filter((t) => t.status === 'run');
  // `graded` — every task where BOTH arms actually produced a scored repeat. The rate lives here.
  const graded = run.filter((t) => t.outcome !== 'not-run');
  const discriminating = graded.filter((t) => t.outcome === 'discriminates');
  const rate = wilson(discriminating.length, graded.length);
  const strict = wilson(graded.filter((t) => t.strictDiscriminates).length, graded.length);

  // Effect size, conditioned on the tasks that discriminate — the report's existing number, now
  // sitting on a denominator that was sampled rather than chosen.
  const effect = {
    tasks: discriminating.length,
    kbOn: {
      steps: mean(discriminating.map((t) => t.on.steps).filter((x) => x != null)),
      seconds: mean(discriminating.map((t) => t.on.seconds).filter((x) => x != null)),
      tokens: mean(discriminating.map((t) => t.on.tokens).filter((x) => x != null)),
    },
    kbOff: {
      steps: mean(discriminating.map((t) => t.off.steps).filter((x) => x != null)),
      seconds: mean(discriminating.map((t) => t.off.seconds).filter((x) => x != null)),
      tokens: mean(discriminating.map((t) => t.off.tokens).filter((x) => x != null)),
    },
  };

  const splitBy = (key, label) => {
    const groups = new Map();
    for (const t of graded) {
      const k = label(t);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    return [...groups.entries()].map(([k, ts]) => ({
      [key]: k,
      tasks: ts.length,
      discriminates: ts.filter((x) => x.outcome === 'discriminates').length,
    })).sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  };

  const result = {
    generatedAt: new Date().toISOString(),
    seed: ledger.seed,
    populationSize: ledger.populationSize,
    drawn: (ledger.tasks ?? []).length,
    derived: derived.length,
    run: run.length,
    notRun: tasks.filter((t) => t.status === 'not-run').map((t) => t.topic_id),
    graded: graded.length,
    neverRan: run.filter((t) => t.outcome === 'not-run').map((t) => t.topic_id),
    discriminationRate: { ...rate, successes: discriminating.length, n: graded.length },
    strictDiscriminationRate: { ...strict, successes: graded.filter((t) => t.strictDiscriminates).length, n: graded.length },
    outcomes: ['discriminates', 'kb-redundant', 'neither-solves', 'injection-hurt', 'not-run']
      .map((o) => ({ outcome: o, meaning: OUTCOME_MEANING[o], tasks: run.filter((t) => t.outcome === o).length })),
    effect,
    byAuditVerdict: splitBy('verdict', (t) => t.auditVerdict ?? 'not-audited'),
    byRecency: splitBy('postSnapshot', (t) => (t.postSnapshot === null ? 'unknown' : String(t.postSnapshot))),
    exclusions: Object.entries(
      (ledger.tasks ?? []).filter((t) => t.status !== 'derived')
        .reduce((acc, t) => { acc[t.reason ?? t.status] = (acc[t.reason ?? t.status] ?? 0) + 1; return acc; }, {}),
    ).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    tasks,
  };

  if (json) {
    out(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  out(`\n# Knowledge-injection discrimination rate\n\n`);
  out(`Population ${result.populationSize} insights (confidence >= ${ledger.minConfidence}), `);
  out(`seed \`${result.seed}\`, ${result.drawn} drawn, ${result.derived} derived, ${result.run} run.\n\n`);

  out(`## The rate\n\n`);
  if (!graded.length) {
    out('No sampled task has both arms graded yet.\n');
  } else {
    out(`**${discriminating.length} of ${graded.length}** sampled tasks discriminate `);
    out(`— **${fmtPct(rate.point)}** (95% Wilson ${fmtPct(rate.low)}–${fmtPct(rate.high)}).\n\n`);
    out(`Strict reading (every kb-on repeat accepted, no kb-off repeat accepted): `);
    out(`${result.strictDiscriminationRate.successes} of ${graded.length} — ${fmtPct(strict.point)} `);
    out(`(${fmtPct(strict.low)}–${fmtPct(strict.high)}).\n\n`);
    if (result.neverRan.length) {
      out(`> ${result.neverRan.length} derived task(s) are NOT in this denominator because at least\n`);
      out('> one arm never executed (preflight skip / abort — no graded repeat): ');
      out(`${result.neverRan.join(', ')}.\n> They are not evidence either way; re-run them.\n\n`);
    }
    if (graded.length < 20) {
      out(`> At n=${graded.length} the interval is wide enough that this sizes the next run rather than\n`);
      out('> settling the question. Report it as a pilot.\n\n');
    }
  }

  out(`## Outcomes\n\n| Outcome | Tasks | What it means |\n|---|---:|---|\n`);
  for (const o of result.outcomes) out(`| ${o.outcome} | ${o.tasks} | ${o.meaning} |\n`);

  out(`\n## Effect size, on the tasks that discriminate (n=${effect.tasks})\n\n`);
  out(`| Arm | Steps | Seconds | Tokens |\n|---|---:|---:|---:|\n`);
  out(`| kb-on | ${fmtNum(effect.kbOn.steps)} | ${fmtNum(effect.kbOn.seconds, 0)} | ${fmtNum(effect.kbOn.tokens, 0)} |\n`);
  out(`| kb-off | ${fmtNum(effect.kbOff.steps)} | ${fmtNum(effect.kbOff.seconds, 0)} | ${fmtNum(effect.kbOff.tokens, 0)} |\n`);

  out(`\n## Split by recoverability verdict (a column, never a filter)\n\n`);
  out(`| Verdict | Tasks | Discriminate |\n|---|---:|---:|\n`);
  for (const r of result.byAuditVerdict) out(`| ${r.verdict} | ${r.tasks} | ${r.discriminates} |\n`);
  const failDisc = result.byAuditVerdict.find((r) => r.verdict === 'FAIL')?.discriminates ?? 0;
  if (failDisc > 0) {
    out(`\n> ${failDisc} FAIL-verdict task(s) discriminated. A filter-shaped audit would have\n`);
    out('> discarded them — "grep-able is not recoverable", measured again.\n');
  }

  out(`\n## Split by recency relative to the snapshot\n\n`);
  out(`| Post-snapshot | Tasks | Discriminate |\n|---|---:|---:|\n`);
  for (const r of result.byRecency) out(`| ${r.postSnapshot} | ${r.tasks} | ${r.discriminates} |\n`);

  out(`\n## Per task\n\n`);
  out(`| Task | Audit | kb-on | kb-off | Outcome |\n|---|---|---:|---:|---|\n`);
  for (const t of tasks) {
    const a = t.status === 'not-run' ? '—' : (t.auditVerdict ?? '—');
    const on = t.on?.scored ? `${t.on.accepted}/${t.on.scored}` : '—';
    const off = t.off?.scored ? `${t.off.accepted}/${t.off.scored}` : '—';
    out(`| ${t.topic_id} | ${a} | ${on} | ${off} | ${t.outcome ?? t.status} |\n`);
  }

  out(`\n## Denominator\n\nOf ${result.drawn} drawn, ${result.derived} produced a runnable task. Excluded:\n\n`);
  for (const e of result.exclusions) out(`- ${e.count} x ${e.reason}\n`);
  if (result.notRun.length) out(`\nDerived but not yet run: ${result.notRun.join(', ')}\n`);
  out('\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => {
    err(`[kb-ab-report] ERROR: ${e.stack || e.message}\n`);
    process.exit(1);
  });
}
