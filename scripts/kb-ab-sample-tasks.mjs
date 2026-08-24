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
  referencePrompt,
  samplePopulation,
  slugFromTopic,
} from '../lib/experiments/kb-ab-sampler.mjs';
import {
  neutralizeSandboxKnowledge,
  neutralizeSandboxRules,
  restoreForCell,
} from '../lib/experiments/experiment-restore.mjs';
import { buildExperimentSpec } from './experiment-write-spec.mjs';
import { canonicalModel } from './llm-model-probe.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(REPO_ROOT, '.data', 'kb-ab-sampler');
const INSIGHTS = path.join(REPO_ROOT, '.data', 'observation-export', 'insights.json');

const PROXY_PORT = process.env.LLM_PROXY_PORT || process.env.LLM_CLI_PROXY_PORT || '12435';
const PROXY = `http://127.0.0.1:${PROXY_PORT}`;
const OBS_PORT = process.env.OBS_API_PORT || '12436';

/** The model the CELLS use, in the CELL SPEC's spelling. Coinage on anything else answers a
 *  different question. */
const CELL_MODEL = 'claude-sonnet-4-6';
/**
 * Capability rank, coarse enough to be stable across renames. Only the ORDER matters: coinage must
 * not be measured BELOW the cells' tier (see the header's asymmetry note). Deliberately not a
 * version comparison — sonnet-5 and sonnet-4.6 are peers for this purpose, and the guard has no
 * business adjudicating which is better.
 */
const MODEL_TIER = [
  [/haiku|mini|8b|instant/i, 1],
  [/sonnet|gpt-4o(?!-mini)|70b/i, 2],
  [/opus/i, 3],
];
export function modelTier(model) {
  const s = String(model ?? '');
  for (const [re, rank] of MODEL_TIER) if (re.test(s)) return rank;
  return 0; // unrecognised — treated as below the floor, so an unknown id fails loudly
}

/**
 * Model FAMILY. Tier alone is not enough: the coinage question is whether THESE weights already
 * carry the fact, and a different vendor's model of similar capability answers a different
 * question entirely. The fallback chain behind the coinage route ends in
 * groq/llama-3.3-70b-versatile and openai/gpt-4o, both of which clear the tier floor while saying
 * nothing about what claude-sonnet-4-6 would write unprompted.
 */
export function modelFamily(model) {
  const s = String(model ?? '').toLowerCase();
  if (/claude|haiku|sonnet|opus/.test(s)) return 'claude';
  if (/gpt|o[0-9]-|davinci/.test(s)) return 'openai';
  if (/llama|mixtral|mistral|gemma|qwen/.test(s)) return 'open-weights';
  return 'unknown';
}

/** The cells' tier. Coinage at or above this is conservative; below it inflates the rate. */
const CELL_TIER = modelTier(CELL_MODEL);
/** The cells' family. Coinage outside it is not a weaker measurement — it is a different one. */
const CELL_FAMILY = modelFamily(CELL_MODEL);
/** Dedicated process keys, so an override cannot collide with another probe's. */
const GEN_PROCESS = 'bg-kb-ab-sampler';
const COINAGE_PROCESS = 'kb-ab-coinage';
/** Bare answers per task. Matches the report's own coinage table (3 runs). */
const COINAGE_SAMPLES = 3;
/** Attempts before a model downgrade is treated as persistent rather than transient. */
const TIER_RETRIES = 3;
const TIER_RETRY_DELAY_MS = 4000;
const REQUEST_TIMEOUT_MS = 120_000;
const GREP_TIMEOUT_MS = 120_000;

const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);

/** Models that answered the candidate generator. Recorded, not pinned — see the complete() note. */
const generatorModels = new Set();
/** Models that answered the coinage probe. Recorded — the routing config chose them, not this
 *  script — and required to stay at or above the cells' tier. */
const coinageModels = new Set();
/** Every downgrade seen and retried past. Recorded so a run served during a degraded window is
 *  visible in the ledger rather than looking like a clean one. */
const coinageDowngrades = [];

// ── proxy plumbing ─────────────────────────────────────────────────────────

/** POST /api/complete. Returns the whole envelope so callers can check which model answered. */
async function complete(body) {
  const r = await fetch(`${PROXY}/api/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`/api/complete -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  const env = await r.json();
  if (env?.error) throw new Error(`/api/complete error: ${String(env.error).slice(0, 200)}`);
  return env;
}

// ── the four probes ────────────────────────────────────────────────────────

/**
 * The block the TREATMENT ARM will actually receive.
 *
 * Every parameter mirrors lib/experiments/cell-injection.mjs — same 500-char query slice, same
 * budget, same threshold, and a task_id shaped like a real cell's (`--` separators) so the
 * experiment gate applies and only insights + kg_entities survive. Probing with anything else
 * measures a block no cell will ever see.
 */
async function retrieveProbe(goal, topic) {
  const r = await fetch(`http://localhost:${OBS_PORT}/api/retrieve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: String(goal).slice(0, 500),
      budget: 3000,
      threshold: 0.70,
      context: { project: 'coding', agent: 'claude' },
      task_id: `${topic}--claude-${CELL_MODEL}-straight-kb-on--r0`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`/api/retrieve -> ${r.status}`);
  const data = await r.json();
  return (data?.meta?.results_count > 0 && data.markdown) ? String(data.markdown) : '';
}

/**
 * N reference runbooks: what a CORRECT answer to this goal looks like, written open-book from the
 * insight. Each sample uses a different style directive, so a fact present in all of them is
 * phrasing-robust rather than an echo of one turn of phrase.
 *
 * Unlike coinage, the model here does NOT need to match the cells' — it is standing in for "a
 * correct deliverable", not for "what the cell can produce unaided". So no tier guard applies.
 */
async function referenceProbe(insight, goal) {
  const texts = [];
  for (let i = 0; i < REFERENCE_SAMPLES; i += 1) {
    const env = await complete({ process: GEN_PROCESS, messages: referencePrompt(insight, goal, i) });
    texts.push(String(env?.content ?? ''));
    generatorModels.add(env?.model ?? 'unknown');
  }
  return texts;
}

/**
 * N bare answers to the goal: the cell's model, no repository, no knowledge base, no tools.
 *
 * A fact appearing here is one the model already knew, so injection cannot be credited for it —
 * and grading it would report a KB win the KB did not earn.
 */
async function coinageProbe(goal) {
  const texts = [];
  for (let i = 0; i < COINAGE_SAMPLES; i += 1) {
    let env = null;
    // RETRY A DOWNGRADE, DO NOT DIE ON ONE. Observed 2026-08-24: while claude-code-max was
    // returning 529s, background calls were served by claude-haiku-4-5 (that account's `small`
    // band) and recovered to claude-sonnet-5 unaided minutes later. Failing fast on the first
    // downgrade would abandon a 30-minute derivation over a transient blip; accepting it would
    // inflate the rate. So: retry, and fail only if the degradation persists.
    for (let attempt = 1; attempt <= TIER_RETRIES; attempt += 1) {
      // The sample ordinal is in the prompt for a REASON, not as decoration. A long request
      // repeated verbatim came back as a replay — content opening "This is an exact repeat of the
      // previous request … here is the same runbook again in full", with a model id and token
      // count that both disagreed with the body returned. Three identical requests would then be
      // one answer counted three times, and a corpus of one sample is not a coinage measurement.
      // Varying the bytes per sample keeps the three draws independent. Deterministic (the index,
      // never a random nonce) so a re-derivation with the same seed issues the same requests.
      env = await complete({
        process: COINAGE_PROCESS,
        messages: [
          {
            role: 'system',
            content: 'Answer from your own knowledge. You have no access to any repository, file or tool.'
              + ` This is independent attempt ${i + 1} of ${COINAGE_SAMPLES}; answer afresh.`,
          },
          { role: 'user', content: goal },
        ],
      });
      // Pitfall 3, one-sided: reject only a WEAKER model, because only that direction inflates the
      // rate. Judged on the model that ANSWERED, never the one requested — the request cannot
      // select one.
      if (modelFamily(env?.model) === CELL_FAMILY && modelTier(env?.model) >= CELL_TIER) break;
      coinageDowngrades.push({ attempt, model: env?.model ?? null, provider: env?.provider ?? null });
      if (attempt === TIER_RETRIES) {
        const wrongFamily = modelFamily(env?.model) !== CELL_FAMILY;
        throw new Error(
          `coinage was answered by '${env?.model}' (family ${modelFamily(env?.model)}, `
          + `tier ${modelTier(env?.model)}) on all ${TIER_RETRIES} attempts; the cells run `
          + `'${CELL_MODEL}' (family ${CELL_FAMILY}, tier ${CELL_TIER}). `
          + (wrongFamily
            ? 'A different model family does not answer the coinage question at all — whether THESE '
              + 'weights already carry the fact. Likely a fallback past gh-copilot; check its quota.'
            : 'A weaker prober misses facts the cells WOULD coin, so those facts survive the filter '
              + 'and inflate the discrimination rate (pitfall 3).')
          + ' Check the proxy before re-running.',
        );
      }
      await new Promise((r) => { setTimeout(r, TIER_RETRY_DELAY_MS * attempt); });
    }
    // Peers may be pooled, tiers may not. The fallback chain legitimately moves a call between
    // claude-code-max/claude-sonnet-5 and gh-copilot/claude-sonnet-4.6, and mixing those two in one
    // corpus is fine — they are the same class of prober. The floor above is what keeps a haiku
    // answer out; demanding one exact model id here would abort on an ordinary provider failover.
    coinageModels.add(canonicalModel(env?.model));
    texts.push(String(env?.content ?? ''));
  }
  return texts;
}

/** Files under the restored sandbox matching a fact regex. Approximate by design — see the audit. */
function inSandboxProbe(sandbox, candidate) {
  const res = spawnSync(
    '/usr/bin/grep',
    ['-rlE', '--binary-files=without-match', '--exclude-dir=.git', candidate.source, sandbox],
    { encoding: 'utf8', timeout: GREP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  return typeof res.stdout === 'string' && res.stdout.split('\n').filter(Boolean).length > 0;
}

/** Symptom fallback for the ~55% of insights whose Troubleshooting bullets are not `**x**: y`. */
async function symptomProbe(ins) {
  const env = await complete({
    process: GEN_PROCESS,
    messages: [
      {
        role: 'system',
        content: [
          'You restate the SYMPTOM an operator would observe, from a knowledge-base insight.',
          'One sentence, 12 to 30 words, describing only what is OBSERVED — never the cause, the',
          'diagnosis, the fix, or any identifier from the resolution. Answer with the sentence only.',
        ].join('\n'),
      },
      { role: 'user', content: `TOPIC: ${ins.topic}\n\nINSIGHT:\n${ins.summary}` },
    ],
  });
  const symptom = String(env?.content ?? '').trim().replace(/^["']|["']$/g, '');
  return symptom ? { symptom, resolution: '' } : null;
}

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
            generatorModels.add(env?.model ?? 'unknown');
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
    generatorModels: [...generatorModels],
    // Recorded because the routing config chose it, not this script — and because the report has to
    // state which model the coinage filter was measured against.
    coinageModels: [...coinageModels],
    coinageTierFloor: CELL_TIER,
    coinageFamily: CELL_FAMILY,
    coinageDowngradesRetried: coinageDowngrades,
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
