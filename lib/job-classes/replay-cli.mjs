/**
 * `coding job-classes replay …` — per-class replay trials (P4).
 *
 *   replay candidates [--class status,explain] [--agent <a>] [--days 14] [--all]
 *       labelled turns of the classes, every agent's, and why each can or cannot be replayed
 *   replay run --candidate <model> [--class …] [--agent <a>] [--turn <key>] [--limit 5]
 *              [--incumbent <model>] [--aa] [--allow-uncaptured] [--no-os-sandbox]
 *              [--no-submodules] [--keep] [--timeout-min 10] [--again] [--dry-run]
 *       replay usable turns in the agent that ran them, with the incumbent and the
 *       candidate model; judge, record (--dry-run: build and check the sandboxes only)
 *   replay report [--run <id>,…] [--min-pairs 20]
 *       the verdict per class and candidate over every recorded run
 *   replay evidence --team <id> --class <c> --candidate <model> [--agent <a>]
 *       write a passing verdict to the team package's evidence/<class>.json
 *       (the maintainer's own checkout; committed locally, `coding sync --push` shares it)
 */

import fs from 'node:fs';
import path from 'node:path';

import { keepClasses } from './turn-capture.mjs';
import { candidates } from './replay-locate.mjs';
import { DEFAULT_TIMEOUT_MS, newRunId, preflight, readResults, replayTurn, turnKey } from './replay-run.mjs';
import { MIN_PAIRS, verdicts } from './replay-judge.mjs';
import { teamPackage } from './evolve.mjs';

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export async function replayMain(args, { print, commit }) {
  const flag = (n) => args.includes(n);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const sub = args[args.indexOf('replay') + 1] || 'candidates';
  const classes = val('--class') ? val('--class').split(',') : keepClasses();
  const days = Number(val('--days')) || 14;
  const allowUncaptured = flag('--allow-uncaptured');
  const agent = val('--agent');

  if (sub === 'candidates') {
    const list = candidates({ classes, days, agent, allowUncaptured });
    const usable = list.filter((c) => !c.reasons.length);
    const shown = flag('--all') ? list : usable;
    const why = {};
    for (const c of list) for (const r of c.reasons) why[r.replace(/:.*/, '')] = (why[r.replace(/:.*/, '')] || 0) + 1;
    print({ classes, days, total: list.length, usable: usable.length, unusable: why, turns: shown.map((c) => ({ key: turnKey(c.label), class: c.label.jobClass, agent: c.label.agent, at: c.record?.at || c.label.labelledAt, model: c.label.model, recorded: !!c.record, captured: !!c.capture, reasons: c.reasons, preview: c.label.preview })) }, [
      `${list.length} labelled turns of ${classes.join(', ')} in ${days} days${agent ? ` (${agent})` : ''}; ${usable.length} replayable`,
      ...Object.entries(why).sort((a, b) => b[1] - a[1]).map(([r, n]) => `  ${String(n).padStart(4)}  ${r}`),
      ...shown.map((c) => `  ${turnKey(c.label).padEnd(20)} ${c.label.agent.padEnd(8)} ${c.label.jobClass.padEnd(8)} ${c.capture ? 'captured' : '        '} ${c.reasons.length ? `✗ ${c.reasons[0]}` : '✓'}  ${c.label.preview.slice(0, 60)}`),
    ]);
    return 0;
  }

  if (sub === 'run') {
    const candidate = val('--candidate');
    if (!candidate) throw new Error('--candidate <model> is required');
    const dryRun = flag('--dry-run');
    const pre = dryRun ? { ok: true } : await preflight();
    if (!pre.ok) { print({ error: pre.error }, [pre.error]); return 1; }
    const list = candidates({ classes, days, agent, allowUncaptured });
    let usable = list.filter((c) => !c.reasons.length);
    if (val('--turn')) usable = usable.filter((c) => turnKey(c.label) === val('--turn'));
    const done = new Set(readResults().filter((r) => r.candidate === candidate && !r.refused && (!agent || r.agent === agent)).map((r) => r.key));
    usable = usable.filter((c) => flag('--again') || !done.has(turnKey(c.label)));
    usable = usable.slice(0, Number(val('--limit')) || 5);
    if (!usable.length) { print({ replayed: 0 }, ['nothing to replay (see `replay candidates --all`)']); return 0; }
    const runId = newRunId();
    const records = [];
    for (const c of usable) {
      process.stderr.write(`[replay] ${turnKey(c.label)} (${c.label.agent}, ${c.label.jobClass}) …\n`);
      records.push(await replayTurn({
        c, candidate, incumbent: val('--incumbent'), runId, aa: flag('--aa'),
        submodules: !flag('--no-submodules'), osSandbox: flag('--no-os-sandbox') ? false : process.platform === 'darwin',
        keep: flag('--keep'), timeoutMs: (Number(val('--timeout-min')) || DEFAULT_TIMEOUT_MS / 60000) * 60000, dryRun,
      }));
    }
    const line = (r) => {
      if (r.refused) return `  ${r.key.padEnd(20)} REFUSED ${r.refused}`;
      if (r.dryRun) return `  ${r.key.padEnd(20)} ${r.agent.padEnd(8)} ${r.jobClass.padEnd(8)} sandbox ok: ${r.sha?.slice(0, 9)} digest ${r.digest?.slice(0, 9)} prompt ${r.promptChars} chars${r.sandbox ? `  kept at ${r.sandbox}` : ''}\n${r.gaps.map((g) => `      gap: ${g}`).join('\n')}`;
      const arms = r.arms.map((a) => `${a.arm}:${a.outcome}${a.totalTokens ? ` ${Math.round(a.totalTokens / 1000)}k` : ''}`).join('  ');
      const t = r.trial ? (r.trial.sameCore ? 'same core' : r.trial.split ? 'split' : 'different') : '—';
      const f = r.floor ? (r.floor.sameCore ? 'same' : 'different') : '—';
      return `  ${r.key.padEnd(20)} ${r.agent.padEnd(8)} ${r.jobClass.padEnd(8)} trial: ${t.padEnd(10)} floor: ${f.padEnd(9)} ${arms}`;
    };
    print({ runId, records }, [`run ${runId}: ${records.length} turns, candidate ${candidate}`, ...records.map(line), '', 'coding job-classes replay report   the verdict so far']);
    return records.some((r) => r.refused) ? 1 : 0;
  }

  if (sub === 'report') {
    const results = readResults({ runIds: val('--run') ? val('--run').split(',') : undefined }).filter((r) => !r.refused);
    const v = verdicts(results, { minPairs: Number(val('--min-pairs')) || MIN_PAIRS });
    print({ verdicts: v, results: results.length }, [
      `${results.length} judged replays`,
      ...v.map((x) => `  ${x.jobClass.padEnd(8)} ${x.agent.padEnd(8)} ${x.candidate.padEnd(22)} ${x.verdict.padEnd(13)} same core ${x.sameCore}/${x.pairs} (${pct(x.sameRate)})  floor ${pct(x.floorRate)} of ${x.floorPairs}  completeness Δ ${x.completenessDelta ?? '—'}  vs ${x.incumbents.join(', ')}`),
      ...(v.length ? [] : ['  none yet: coding job-classes replay run --candidate <model>']),
    ]);
    return 0;
  }

  if (sub === 'evidence') {
    const team = String(val('--team') || '').toLowerCase();
    const cls = val('--class');
    const candidate = val('--candidate');
    if (!team || !cls || !candidate) throw new Error('--team, --class and --candidate are required');
    const v = verdicts(readResults().filter((r) => !r.refused)).find((x) => x.jobClass === cls && x.candidate === candidate && (!agent || x.agent === agent));
    if (!v || v.verdict !== 'pass') { print({ verdict: v || null }, [`no passing verdict for ${cls} / ${candidate} (${v ? v.verdict : 'no replays'})`]); return 1; }
    const pkg = teamPackage(team);
    if (pkg.state !== 'linked') throw new Error(`team ${team}'s package is not your own checkout here: evidence is recorded by its maintainer`);
    const file = path.join(pkg.dir, 'evidence', `${cls}.json`);
    let doc = { schema: 1, class: cls, verdicts: [] };
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first */ }
    // No prompt text, no answers: counts, models, dates.
    doc.verdicts = [...(doc.verdicts || []).filter((x) => !(x.candidate === candidate && (x.agent || 'claude') === v.agent)), {
      candidate, incumbents: v.incumbents, agent: v.agent, pairs: v.pairs, sameCore: v.sameCore, sameRate: v.sameRate,
      floorRate: v.floorRate, floorPairs: v.floorPairs, completenessDelta: v.completenessDelta,
      judge: 'bg-model-trial-judge', method: 'whole-turn replay, same core answer, both orders', recordedAt: new Date().toISOString(),
    }];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const c = commit ? commit(pkg.checkout, `coding: job-class evidence — ${cls}: ${candidate} as good in ${v.sameCore}/${v.pairs} replays`) : null;
    print({ file, verdict: v, commit: c }, [`✓ ${file}${c?.committed ? ', committed locally; coding sync --push shares it' : ''}`]);
    return 0;
  }

  throw new Error(`unknown replay action '${sub}' (candidates, run, report, evidence)`);
}
