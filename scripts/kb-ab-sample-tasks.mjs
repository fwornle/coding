#!/usr/bin/env node
/**
 * Derive kb-ab A/B tasks by SAMPLING the knowledge base, so the injection experiment can report a
 * discrimination rate instead of an existence proof.
 *
 *   node scripts/kb-ab-sample-tasks.mjs --n 10 --seed pilot-1
 *   node scripts/kb-ab-sample-tasks.mjs --n 10 --seed pilot-1 --dry-run   # no writes, no LLM calls
 *   node scripts/kb-ab-sample-tasks.mjs --n 3 --seed t --json
 *   node scripts/kb-ab-sample-tasks.mjs --insights .data/kb-ab-sampler/insights-<digest>.json
 *                                       --n 10 --seed pilot-1     # replay an exact frame
 *
 * WHY. The published A/B measured two tasks written BECAUSE their answers live in the KB and not in
 * the code. That is an existence proof, not a rate; the report names the discrimination rate as the
 * number that would justify the system's cost and says it is unknown. This is the sampler that
 * produces it. The derivation rules — and the three measured failures that shaped them — are
 * documented in lib/experiments/kb-ab-sampler.mjs; this file is the I/O around them.
 *
 * OUTPUT lands in GITIGNORED .data/kb-ab-sampler/{specs,facts,ledger.json}. A fact set spells out
 * the graded answers, and snapshot restore materialises COMMITTED content — a tracked fact file
 * would be one re-snapshot away from shipping the answers into the very sandbox the control arm is
 * meant to search in vain.
 *
 * WHICH MODEL ANSWERS COINAGE, AND WHY THE GUARD IS ONE-SIDED. Report pitfall 3 is a coinage probe
 * that silently ran on a cheaper model and retired a good fact, so the model that answers matters —
 * but NOT in both directions, and it cannot simply be demanded:
 *
 *   - The request-body `model` is ignored by /api/complete, and `processOverrides` no longer route
 *     at all (rapid-llm-proxy proxy-bridge/server.mjs:279 — "still READ for backward compatibility
 *     … nothing routes on them any more; they are ignored by the request path"). Measured here: an
 *     override that landed by read-back was still answered by claude-haiku-4-5. Anything claiming
 *     to pin a model that way — scripts/llm-model-probe.mjs included — is reporting the config's
 *     choice, not its own.
 *   - The routing config decides. An unrouted `bg-` job takes defaults.background, today
 *     claude-code-max/claude-sonnet-5 with gh-copilot/claude-sonnet-4.6 behind it. Both are
 *     peer-or-stronger than the cells' claude-sonnet-4-6, so no route needs declaring.
 *
 * The bias is ASYMMETRIC, which is what makes accepting the config's choice safe. Coinage on a
 * peer-or-stronger model drops facts the cells might not have coined — conservative, it can only
 * UNDERSTATE the discrimination rate. Coinage on a WEAKER model misses facts the cells would coin,
 * which survive the filter and INFLATE the rate. So the guard rejects only the weaker case, and
 * records whichever model actually answered.
 *
 * Diagnostics via process.stdout/stderr .write only (no console.* — no-console-log, CLAUDE.md).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CELL_VARIANTS,
  REFERENCE_SAMPLES,
  buildGoalSentence,
  deriveTask,
  extractSymptoms,
  framePopulation,
  samplePopulation,
  slugFromTopic,
} from '../lib/experiments/kb-ab-sampler.mjs';
import {
  neutralizeSandboxKnowledge,
  neutralizeSandboxRules,
  restoreForCell,
} from '../lib/experiments/experiment-restore.mjs';
import {
  CELL_FAMILY,
  CELL_MODEL,
  CELL_TIER,
  COINAGE_SAMPLES,
  GEN_PROCESS,
  complete,
  coinageProbe,
  inSandboxProbe,
  probeProvenance,
  referenceProbe,
  retrieveProbe,
  symptomProbe,
} from '../lib/experiments/kb-ab-probes.mjs';
import { buildExperimentSpec } from './experiment-write-spec.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(REPO_ROOT, '.data', 'kb-ab-sampler');
const INSIGHTS = path.join(REPO_ROOT, '.data', 'observation-export', 'insights.json');

// The probes and the coinage tier-and-family guard live in lib/experiments/kb-ab-probes.mjs, so
// that scripts/kb-ab-mine-facts.mjs applies the IDENTICAL filter. A fact retired on one path and
// graded on the other would make the discrimination rate depend on which script last ran.

const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);

// ── snapshot dating ────────────────────────────────────────────────────────

/**
 * The snapshot's CONTENT date, for the `postSnapshot` covariate.
 *
 * Read the PARENT commit, not HEAD: a restored tree's own `baseline: post-restore` commit is
 * synthetic, created at restore time, so HEAD's date is when the restore ran and says nothing about
 * what the tree contains.
 */
function snapshotContentDate(worktree) {
  const git = (args) => spawnSync('git', ['-C', worktree, ...args], { encoding: 'utf8' });
  const subject = git(['log', '-1', '--pretty=%s']).stdout?.trim() ?? '';
  const ref = /post-restore|baseline/i.test(subject) ? 'HEAD^' : 'HEAD';
  const iso = git(['log', '-1', '--pretty=%cI', ref]).stdout?.trim();
  return iso || null;
}

// ── main ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  return {
    n: Number(val('n', '10')),
    seed: val('seed', 'pilot-1'),
    snapshotId: val('snapshot', 'smoke-spec'),
    minConfidence: Number(val('min-confidence', '0.8')),
    // 3, not 2. At two repeats a single passing cell decides a task's classification, so the
    // majority reading and the strict reading diverge maximally — measured on the first pilot:
    // both discriminating tasks were kb-on 1/2, giving 100% by majority and 0% by strict. Two
    // repeats cannot separate "injection reliably carries the answer" from "it carries it half
    // the time", which is the distinction the rate is supposed to express.
    repeats: Number(val('repeats', '3')),
    insights: val('insights', INSIGHTS),
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!fs.existsSync(args.insights)) {
    err(`[kb-ab-sample] no insight export at ${args.insights}\n`);
    return 2;
  }

  // 1. Population + sample. Deterministic GIVEN THE EXPORT — and the export is a moving target.
  //    Observed within a single session: the population grew 159 -> 162 as the consolidator wrote
  //    new insights, and the same seed consequently drew a DIFFERENT insight. A seed reproduces a
  //    draw only against a fixed frame, so the frame is hashed and copied beside the ledger; pass
  //    that copy back via --insights to replay a derivation exactly.
  const insightsRaw = fs.readFileSync(args.insights, 'utf8');
  const insights = JSON.parse(insightsRaw);
  const insightsDigest = crypto.createHash('sha256').update(insightsRaw).digest('hex').slice(0, 16);

  // 2. ONE restored sandbox, shared by every inSandbox grep. Per-task restores would take ~8s each
  //    to produce byte-identical trees; the tree is a property of the snapshot, not of the task.
  let sandbox = null;
  let snapshotDate = null;
  if (!args.dryRun) {
    const restored = await restoreForCell(args.snapshotId, { repoRoot: REPO_ROOT });
    sandbox = restored.worktree;
    // The SAME strips a real cell gets, so the grep measures the tree the agent sees.
    neutralizeSandboxRules(sandbox);
    neutralizeSandboxKnowledge(sandbox);
    snapshotDate = snapshotContentDate(sandbox);
    err(`[kb-ab-sample] sandbox ${sandbox}\n[kb-ab-sample] snapshot content date ${snapshotDate}\n`);
  }

  const population = framePopulation(insights, { minConfidence: args.minConfidence, snapshotDate });
  const { sampled, ledger, populationSize } = samplePopulation(population, { n: args.n, seed: args.seed });
  err(`[kb-ab-sample] population ${populationSize} (confidence >= ${args.minConfidence}), drawing ${sampled.length} with seed '${args.seed}'\n`);

  if (args.dryRun) {
    // Nothing is written and no LLM call is made. Shows WHICH insights the seed draws and whether a
    // symptom parses mechanically — enough to eyeball the frame before spending anything.
    for (const ins of sampled) {
      const sy = extractSymptoms(ins.summary);
      const slug = slugFromTopic(ins.topic);
      out(`\n${slug}  (conf ${ins.confidence}, ${String(ins.createdAt).slice(0, 10)})\n`);
      out(`  topic   : ${ins.topic}\n`);
      out(sy.length
        ? `  goal    : ${buildGoalSentence({ slug, symptom: sy[0].symptom })}\n`
        : '  goal    : (no bulleted symptom — would fall back to the LLM symptom probe)\n');
    }
    out(`\n${sampled.length} drawn from ${populationSize}. Dry run: nothing written, no LLM calls.\n`);
    return 0;
  }

  // 3. Derive. The coinage override is armed once around the whole loop and always removed.
  const rows = [];
  {
    for (const ins of sampled) {
      const topicGuess = `kbs-${slugFromTopic(ins.topic)}`;
      let row;
      try {
        row = await deriveTask(ins, {
          complete: async (messages) => {
            const env = await complete({ process: GEN_PROCESS, messages });
            // NOT pinned, and deliberately not asserted: candidate extraction is not a measurement,
            // so any capable model is acceptable. Recorded, so the derivation stays auditable.
            return String(env?.content ?? '');
          },
          retrieve: (goal) => retrieveProbe(goal, topicGuess),
          reference: (goal) => referenceProbe(ins, goal),
          coinage: coinageProbe,
          inSandbox: (candidate) => inSandboxProbe(sandbox, candidate),
          symptom: symptomProbe,
        });
      } catch (e) {
        row = {
          insightId: ins.id, topic: ins.topic, confidence: ins.confidence, createdAt: ins.createdAt,
          postSnapshot: ins.postSnapshot ?? null, status: 'error', reason: e.message,
        };
      }
      rows.push(row);
      const tag = row.status === 'derived' ? `DERIVED ${row.factSet.facts.length} facts` : `${row.status.toUpperCase()}: ${row.reason}`;
      err(`  ${String(row.slug || row.insightId).padEnd(46)} ${tag}\n`);
    }
  }

  // 4. Write specs, fact sets, ledger.
  // Freeze the frame this derivation actually saw, so the ledger's denominator can be replayed
  // rather than merely described.
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const frozen = path.join(OUT_ROOT, `insights-${insightsDigest}.json`);
  if (!fs.existsSync(frozen)) fs.writeFileSync(frozen, insightsRaw, 'utf8');

  const specsDir = path.join(OUT_ROOT, 'specs');
  const factsDir = path.join(OUT_ROOT, 'facts');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.mkdirSync(factsDir, { recursive: true });

  // PRUNE FIRST. A topic derived by an earlier run and EXCLUDED by this one leaves its fact file
  // behind, and loadGeneratedFactSets() merges whatever is on disk into FACT_SETS at import — so a
  // gate this run rejected stays live and gradeable. Observed exactly that: an excluded topic's
  // 5-fact set from a previous attempt was still being loaded. The output directory is derived
  // state and belongs to the newest run, so anything not derived NOW goes.
  const keep = new Set(rows.filter((r) => r.status === 'derived').map((r) => r.factSet.topic));
  for (const [dir, ext] of [[factsDir, '.json'], [specsDir, '.yaml']]) {
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(ext))) {
      if (!keep.has(name.slice(0, -ext.length))) {
        fs.rmSync(path.join(dir, name));
        err(`[kb-ab-sample] pruned stale ${path.basename(dir)}/${name}\n`);
      }
    }
  }

  const yaml = (await import('js-yaml')).default;
  const written = [];
  for (const row of rows.filter((r) => r.status === 'derived')) {
    // Validated through the SAME resolver the dashboard listbox and the launch gate use, so a
    // derived spec cannot be launchable-looking but unresolvable.
    const spec = buildExperimentSpec({
      experimentId: row.spec.experimentId,
      goal: row.spec.goal,
      variants: row.spec.variants,
      snapshotId: args.snapshotId,
      taskClass: row.spec.taskClass,
      testCommand: row.spec.testCommand,
      repeats: args.repeats,
    });
    const specPath = path.join(specsDir, `${row.spec.experimentId}.yaml`);
    fs.writeFileSync(specPath, yaml.dump(spec), 'utf8');
    fs.writeFileSync(path.join(factsDir, `${row.factSet.topic}.json`), `${JSON.stringify(row.factSet, null, 2)}\n`, 'utf8');
    written.push(specPath);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    seed: args.seed,
    n: args.n,
    repeats: args.repeats,
    snapshotId: args.snapshotId,
    snapshotContentDate: snapshotDate,
    minConfidence: args.minConfidence,
    populationSize,
    insightsDigest,
    insightsFrozenAt: path.relative(REPO_ROOT, frozen),
    insightsCount: Array.isArray(insights) ? insights.length : null,
    cellModel: CELL_MODEL,
    generatorModels: probeProvenance().generatorModels,
    // Recorded because the routing config chose it, not this script — and because the report has to
    // state which model the coinage filter was measured against.
    coinageModels: probeProvenance().coinageModels,
    coinageTierFloor: CELL_TIER,
    coinageFamily: CELL_FAMILY,
    coinageDowngradesRetried: probeProvenance().coinageDowngrades,
    coinageSamples: COINAGE_SAMPLES,
    referenceSamples: REFERENCE_SAMPLES,
    variants: CELL_VARIANTS.map((v) => ({ ...v })),
    derived: rows.filter((r) => r.status === 'derived').length,
    excluded: rows.filter((r) => r.status === 'excluded').length,
    errored: rows.filter((r) => r.status === 'error').length,
    // Every drawn insight, kept or not, with the reason. This is the denominator's audit trail.
    // factSet and spec are already on disk under specs/ and facts/; the ledger carries the
    // DECISION about each drawn insight, not a second copy of its output.
    tasks: rows.map((r) => ({
      ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'factSet' && k !== 'spec')),
      topic_id: r.factSet?.topic ?? null,
    })),
    population: ledger,
  };
  fs.writeFileSync(path.join(OUT_ROOT, 'ledger.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (args.json) {
    out(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    out(`\nderived ${manifest.derived} / drawn ${sampled.length} (population ${populationSize})\n`);
    out(`  excluded ${manifest.excluded}, errored ${manifest.errored}\n`);
    out(`  specs   ${specsDir}\n  facts   ${factsDir}\n  ledger  ${path.join(OUT_ROOT, 'ledger.json')}\n`);
    if (written.length) {
      out('\nrun them with:\n');
      for (const p of written) out(`  node scripts/experiment-run.mjs --spec ${path.relative(REPO_ROOT, p)}\n`);
    }
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    err(`[kb-ab-sample] ERROR: ${e.stack || e.message}\n`);
    process.exit(1);
  });
}
