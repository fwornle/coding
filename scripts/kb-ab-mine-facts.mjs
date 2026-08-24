#!/usr/bin/env node
/**
 * Re-derive each kb-ab fact set from what the TREATMENT ARM ACTUALLY WROTE.
 *
 *   node scripts/kb-ab-mine-facts.mjs                       # mine, apply blind filters, rewrite
 *   node scripts/kb-ab-mine-facts.mjs --dry-run             # report only, no writes, no LLM calls
 *   node scripts/kb-ab-mine-facts.mjs --since <unix-epoch>  # override the deliverable window
 *
 * WHY THIS EXISTS. The first full pilot (8 tasks, 48 cells) did not measure the knowledge base; it
 * measured its own gates. The TREATMENT arm scored 0/3, 1/3, 0/3, 2/3, 0/3, 0/3, 0/3, 1/3 on the
 * conjunctions derived for it — with the answer injected into its prompt. Seven of eight tasks
 * landed in `neither-solves`, which is the report's label for a broken gate, so the run reported
 * the difficulty of the conjunctions rather than the redundancy of the knowledge base.
 *
 * THE CAUSE WAS A CONDITION MISMATCH, not a bad filter. The reference filter asked a model to write
 * the ideal runbook from the insight and kept facts appearing in ALL of them. But a reference is
 * written with no sandbox, no tools, no execution directive and no length pressure; a cell writes
 * under all four. A conjunction where every fact appears in two references can still be jointly
 * unsatisfiable by a real cell. The CURATED sets never had this problem, and the reason is now
 * obvious: their facts were chosen against THREE REAL kb-on DELIVERABLES on disk. This mines from
 * exactly that, which makes it a return to the method that worked rather than a new idea.
 *
 * WHAT THIS CONDITIONS, STATED PLAINLY. Mining from kb-on output means the treatment arm passes its
 * own gate close to BY CONSTRUCTION. The quantity that survives is therefore "the fraction of
 * knowledge-derived tasks whose answer the CONTROL arm cannot reproduce" — which is the report's
 * own definition of the discrimination rate, but it is CONDITIONAL and must never be presented as
 * an unconditional probability that injection helps. The control arm is never consulted here; that
 * is the line which keeps the rate a measurement rather than a restatement of the selection rule.
 *
 * THE BLIND FILTERS STILL APPLY, and in the same order and meaning as the sampler's, because they
 * are imported from the same module rather than restated:
 *
 *   shape guard   — a pattern that cannot match a real deliverable (redaction placeholders, gap
 *                   chains, over-long sources) is a broken gate wearing the costume of a hard task.
 *   injected      — the fact must appear in the block the treatment arm actually RECEIVES. Mining
 *                   proves the arm WROTE it; this proves the KB is why. A token the arm produced
 *                   from the sandbox instead is not evidence about injection.
 *   not coined    — a fact the cells' own model writes unprompted, with no repository and no
 *                   knowledge base, cannot distinguish the arms. Same probe, same one-sided
 *                   tier-and-family guard as the sampler (lib/experiments/kb-ab-probes.mjs).
 *   inSandbox     — RECORDED, never dropped on. Whether kb-off can reach a fact is the outcome
 *                   being measured, not an assumption baked into selection (report pitfall 2:
 *                   kb-ab-etm-crashloop fails the audit on all four facts and discriminated
 *                   4.00/4 vs 1.33/4 anyway).
 *   leak guard    — the goal must not contain its own answer.
 *
 * The REFERENCE filter is deliberately absent: mining from real deliverables is the same test under
 * the cells' true conditions, and running both would drop facts for failing the weaker proxy.
 *
 * Diagnostics via process.stdout/stderr .write only (no console.* — no-console-log, CLAUDE.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  KEEP_MIN_FACTS,
  goalLeaksFact,
  mineFactsFromDeliverables,
  patternShapeProblem,
} from '../lib/experiments/kb-ab-sampler.mjs';
import {
  CELL_FAMILY,
  CELL_MODEL,
  CELL_TIER,
  COINAGE_SAMPLES,
  coinageProbe,
  inSandboxProbe,
  probeProvenance,
  retrieveProbe,
} from '../lib/experiments/kb-ab-probes.mjs';
import { restoreForCell, neutralizeSandboxKnowledge, neutralizeSandboxRules } from '../lib/experiments/experiment-restore.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(REPO_ROOT, '.data', 'kb-ab-sampler');
const FACTS_DIR = path.join(OUT_ROOT, 'facts');
const SPECS_DIR = path.join(OUT_ROOT, 'specs');
const WINDOW_FILE = path.join(OUT_ROOT, 'mine-window-start');
const SANDBOX_ROOT = '/tmp/coding-experiment-sandboxes';

/**
 * Facts per task. The curated sets that discriminated carry four; the pilot's derived sets carried
 * four to five and were jointly unsatisfiable. A conjunction's difficulty compounds, so the cap is
 * the floor plus one — enough that a single unlucky phrasing does not decide the task, few enough
 * that the treatment arm can actually satisfy all of them.
 */
const MAX_FACTS = 4;

const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);

/**
 * The deliverables written during the mining window, grouped by topic.
 *
 * SCOPING IS BY TIME, AND THAT IS WHAT MAKES THE ARM UNAMBIGUOUS. The mining pass ran kb-on-only
 * specs, so every sandbox created after the window opened belongs to the treatment arm. The runner
 * records no sandbox path in run metadata, and the alternative — matching cells to sandboxes after
 * the fact — has no key to match on. A stale sandbox from an earlier kb-OFF run silently entering
 * the corpus would poison the mine, so the window is a correctness boundary, not a convenience.
 */
function deliverablesByTopic(since, factSets) {
  const wanted = new Map(factSets.map((f) => [f.deliverable, f.topic]));
  const byTopic = new Map();
  let dirs = [];
  try {
    dirs = fs.readdirSync(SANDBOX_ROOT);
  } catch {
    return byTopic; // no sandbox root at all — caller reports zero deliverables per topic
  }
  for (const d of dirs) {
    const full = path.join(SANDBOX_ROOT, d);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory() || Math.floor(st.mtimeMs / 1000) < since) continue;
    for (const name of fs.readdirSync(full)) {
      const topic = wanted.get(name);
      if (!topic) continue;
      let text = '';
      try {
        text = fs.readFileSync(path.join(full, name), 'utf8');
      } catch {
        continue;
      }
      if (!text.trim()) continue;
      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic).push({ sandbox: d, text });
    }
  }
  return byTopic;
}

/** The full goal sentence, which lives in the spec rather than the fact set. */
function goalForTopic(topic) {
  const specPath = path.join(SPECS_DIR, `${topic}.yaml`);
  const raw = fs.readFileSync(specPath, 'utf8');
  // goal_sentence is a folded block scalar (`>-`); take the indented continuation lines.
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => l.startsWith('goal_sentence:'));
  if (start < 0) throw new Error(`${topic}: spec has no goal_sentence`);
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!/^\s+\S/.test(lines[i])) break;
    body.push(lines[i].trim());
  }
  return body.join(' ').trim();
}

async function mineTopic(factSet, deliverables, { dryRun, sandbox }) {
  const { topic } = factSet;
  const texts = deliverables.map((d) => d.text);
  const report = {
    topic,
    deliverables: texts.length,
    mined: 0,
    kept: [],
    dropped: [],
    status: 'derived',
    reason: null,
  };

  if (texts.length < 2) {
    report.status = 'excluded';
    report.reason = `only ${texts.length} deliverable(s) in the window — one cannot show stability`;
    return report;
  }

  const candidates = mineFactsFromDeliverables(texts);
  report.mined = candidates.length;
  if (!candidates.length) {
    report.status = 'excluded';
    report.reason = 'no token appeared in every treatment-arm deliverable';
    return report;
  }

  const goal = goalForTopic(topic);

  // 1. Shape guard — free, and it runs before anything that costs a call.
  const shaped = [];
  for (const c of candidates) {
    const problem = patternShapeProblem(c.source);
    if (problem) report.dropped.push({ ...c, reason: `shape: ${problem}` });
    else shaped.push(c);
  }
  if (!shaped.length) {
    report.status = 'excluded';
    report.reason = 'every mined token failed the shape guard';
    return report;
  }

  if (dryRun) {
    report.kept = shaped.slice(0, MAX_FACTS).map((c) => ({ ...c, required: true, inSandbox: null }));
    report.reason = 'dry run: injection, coinage and sandbox probes not run';
    return report;
  }

  // 2. Injected — mining shows the arm WROTE it; this shows the KB is why.
  const injectedBlock = await retrieveProbe(goal, topic);
  report.injectedChars = injectedBlock.length;
  const reFor = (c) => new RegExp(c.source, c.flags || '');
  const injected = [];
  for (const c of shaped) {
    if (reFor(c).test(injectedBlock)) injected.push(c);
    else report.dropped.push({ ...c, reason: 'not-injected' });
  }
  if (!injected.length) {
    report.status = 'excluded';
    report.reason = 'no mined token appears in the block the treatment arm receives';
    return report;
  }

  // 3. Coinage — one sampling per task, every candidate tested against the same bare answers.
  const coinage = await coinageProbe(goal);
  report.coinageSamples = coinage.length;
  const uncoined = [];
  for (const c of injected) {
    const re = reFor(c);
    if (coinage.some((text) => re.test(text))) report.dropped.push({ ...c, reason: 'model-coins-it' });
    else uncoined.push(c);
  }

  // 4. Leak guard, then inSandbox RECORDED on the survivors.
  const leaked = new Set(goalLeaksFact(goal, uncoined));
  const surviving = [];
  for (const c of uncoined) {
    if (leaked.has(c.id)) {
      report.dropped.push({ ...c, reason: 'leaked-by-goal' });
      continue;
    }
    surviving.push({
      ...c,
      required: true,
      inSandbox: sandbox ? inSandboxProbe(sandbox, c) : null,
    });
  }

  if (surviving.length < KEEP_MIN_FACTS) {
    report.status = 'excluded';
    report.reason = `only ${surviving.length} fact(s) survived the blind filters (need ${KEEP_MIN_FACTS})`;
    return report;
  }

  report.kept = surviving.slice(0, MAX_FACTS);
  return report;
}

function parseArgs(argv) {
  const has = (n) => argv.includes(`--${n}`);
  const val = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
  };
  return { dryRun: has('dry-run'), since: val('since', null), json: has('json') };
}

async function main(argv) {
  const args = parseArgs(argv);

  // `Number(null)` is 0, and 0 is finite — so a missing --since silently became "the epoch", which
  // widened the window to every sandbox ever written and pulled kb-OFF deliverables from the
  // earlier matrix into the corpus. Caught on the first dry run: 35 deliverables across 8 topics
  // when only 24 kb-on cells exist. Parse explicitly, and refuse a window that is not a real one.
  const since = args.since == null
    ? Number(fs.readFileSync(WINDOW_FILE, 'utf8').trim())
    : Number(args.since);
  if (!Number.isFinite(since) || since <= 0) {
    throw new Error(`no usable mining window (--since, or ${WINDOW_FILE}); refusing to mine every sandbox on disk`);
  }

  const factSets = fs.readdirSync(FACTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(FACTS_DIR, n), 'utf8')));
  if (!factSets.length) throw new Error(`no fact sets in ${FACTS_DIR}`);

  const byTopic = deliverablesByTopic(since, factSets);
  out(`[kb-ab-mine] window opens ${new Date(since * 1000).toISOString()}; `
    + `${factSets.length} topic(s), ${[...byTopic.values()].reduce((a, v) => a + v.length, 0)} deliverable(s) found\n\n`);

  // ONE restored + neutralized sandbox, shared by every inSandbox grep — the same arrangement the
  // sampler uses. Per-topic restores would cost ~8s each and answer the identical question.
  let sandbox = null;
  if (!args.dryRun) {
    try {
      const restored = await restoreForCell('smoke-spec', { repoRoot: REPO_ROOT });
      sandbox = restored.worktree;
      // The SAME strips a real cell gets, so the grep measures the tree the agent sees.
      neutralizeSandboxRules(sandbox);
      neutralizeSandboxKnowledge(sandbox);
      err(`[kb-ab-mine] sandbox ${sandbox}\n`);
    } catch (e) {
      err(`[kb-ab-mine] sandbox restore failed (${e.message}); inSandbox will be recorded as null\n`);
    }
  }

  const reports = [];
  for (const fs0 of factSets.sort((a, b) => a.topic.localeCompare(b.topic))) {
    const found = byTopic.get(fs0.topic) ?? [];
    const r = await mineTopic(fs0, found, { dryRun: args.dryRun, sandbox });
    reports.push(r);

    out(`${r.status === 'derived' ? '✓' : '✗'} ${fs0.topic}\n`);
    out(`    ${r.deliverables} deliverable(s), ${r.mined} stable token(s)`);
    if (r.injectedChars != null) out(`, ${r.injectedChars} injected chars`);
    out('\n');
    for (const f of r.kept) {
      const box = f.inSandbox === null ? '?' : (f.inSandbox ? 'in-sandbox' : 'KB-ONLY');
      out(`      keep  ${f.id.padEnd(34)} /${f.source}/  [${box}]\n`);
    }
    for (const d of r.dropped) out(`      drop  ${d.id.padEnd(34)} ${d.reason}\n`);
    if (r.reason) out(`    → ${r.reason}\n`);
    out('\n');
  }

  const derived = reports.filter((r) => r.status === 'derived');
  const excluded = reports.filter((r) => r.status !== 'derived');

  if (!args.dryRun) {
    for (const r of derived) {
      const p = path.join(FACTS_DIR, `${r.topic}.json`);
      const set = JSON.parse(fs.readFileSync(p, 'utf8'));
      set.facts = r.kept.map((f) => ({
        id: f.id, source: f.source, flags: f.flags, required: true, why: f.why, inSandbox: f.inSandbox,
      }));
      set.minedFrom = { deliverables: r.deliverables, window: since, at: new Date().toISOString() };
      fs.writeFileSync(p, `${JSON.stringify(set, null, 2)}\n`, 'utf8');
    }
    // A topic that cannot be gated must not stay runnable: loadGeneratedFactSets() merges whatever
    // is on disk, so leaving its spec behind would re-run a gate this pass just rejected.
    for (const r of excluded) {
      for (const [dir, ext] of [[FACTS_DIR, '.json'], [SPECS_DIR, '.yaml']]) {
        const p = path.join(dir, `${r.topic}${ext}`);
        if (fs.existsSync(p)) fs.rmSync(p);
      }
      err(`[kb-ab-mine] pruned ${r.topic} (${r.reason})\n`);
    }
  }

  const prov = probeProvenance();
  out(`${derived.length} topic(s) re-gated from mined facts, ${excluded.length} excluded.\n`);
  out(`coinage: ${COINAGE_SAMPLES} sample(s)/task from ${prov.coinageModels.join(', ') || '(not run)'} `
    + `(cells run ${CELL_MODEL}, family ${CELL_FAMILY}, tier floor ${CELL_TIER})\n`);
  if (prov.coinageDowngrades.length) {
    out(`coinage downgrades retried past: ${prov.coinageDowngrades.length}\n`);
  }
  if (args.dryRun) out('\nDry run: nothing written.\n');
  if (args.json) out(`\n${JSON.stringify({ since, reports }, null, 2)}\n`);
  return derived.length >= KEEP_MIN_FACTS ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    err(`[kb-ab-mine] ${e.stack ?? e.message}\n`);
    process.exit(1);
  });
}

export { deliverablesByTopic, goalForTopic, mineTopic, MAX_FACTS };
