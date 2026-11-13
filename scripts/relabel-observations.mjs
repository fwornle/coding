#!/usr/bin/env node
/**
 * Move observations and digests to another project, through obs-api's
 * POST /api/observations/relabel (km-core entity + cold store + per-repo slices).
 *
 * For rows filed under a project that is no project: the learning checkout
 * ('.coding'), the agent memory directory ('memory'), a folder the session
 * happened to start in ('history', 'scripts'), or pre-attribution rows
 * ('unknown'). The router no longer produces the first two
 * (lib/attribution/repo-router.mjs: inLearningCheckout, inAgentState); this
 * repairs what they already wrote. Knowledge-graph entities (insights, details)
 * are repaired by scripts/repair-team-attribution.mjs.
 *
 *   node scripts/relabel-observations.mjs --move=memory:coding --set=<id>=glass
 *   node scripts/relabel-observations.mjs … --apply
 *
 *   --move=<from>:<to>   every observation and digest filed under <from> (repeatable)
 *   --set=<id>=<to>      one row; wins over --move (repeatable)
 *   --url <obs-api>      default http://localhost:12436
 *   --apply              write; without it the run only prints the plan
 */
import { fetchRetry, getAll, waitForConsolidation } from './dedup-observations.mjs';

function parseArgs(argv) {
  const a = { apply: false, url: 'http://localhost:12436', moves: new Map(), sets: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--apply') a.apply = true;
    else if (x === '--url') a.url = argv[++i];
    else if (x.startsWith('--move=')) {
      const [from, to] = x.slice(7).split(':');
      if (!from || !to) throw new Error(`--move expects <from>:<to>, got ${x}`);
      a.moves.set(from, to);
    } else if (x.startsWith('--set=')) {
      const [id, to] = x.slice(6).split('=');
      if (!id || !to) throw new Error(`--set expects <id>=<project>, got ${x}`);
      a.sets.set(id, to);
    } else throw new Error(`unknown argument: ${x}`);
  }
  return a;
}

/** id → target project, plus the rows it applies to, for the plan printout. */
export function planRelabel(rows, moves, sets) {
  const plan = [];
  for (const r of rows) {
    if (!r || !r.id) continue;
    const to = sets.get(r.id) ?? moves.get(r.project);
    if (to && to !== r.project) plan.push({ id: r.id, kind: r.kind, from: r.project, to, label: r.label });
  }
  return plan;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.moves.size === 0 && args.sets.size === 0) throw new Error('nothing to do: pass --move and/or --set');
  if (args.apply) await waitForConsolidation(args.url);
  const obs = (await getAll(args.url, '/api/coding/observations')).map((r) => ({
    id: r.id, project: r.project, kind: 'obs', label: `${String(r.timestamp).slice(0, 16)} ${r.agent} ${String(r.content).replace(/\s+/g, ' ').slice(0, 90)}`,
  }));
  const dig = (await getAll(args.url, '/api/coding/digests')).map((r) => ({
    id: r.id, project: r.project, kind: 'digest', label: `${r.date} ${String(r.theme || '').slice(0, 90)}`,
  }));
  const plan = planRelabel([...obs, ...dig], args.moves, args.sets);
  const missing = [...args.sets.keys()].filter((id) => !obs.some((r) => r.id === id) && !dig.some((r) => r.id === id));

  const byPair = new Map();
  for (const p of plan) byPair.set(`${p.from} -> ${p.to}`, (byPair.get(`${p.from} -> ${p.to}`) || 0) + 1);
  process.stdout.write(`${obs.length} observations, ${dig.length} digests; to relabel: ${plan.length}\n`);
  for (const [k, n] of byPair) process.stdout.write(`  ${k}: ${n}\n`);
  for (const p of plan) process.stdout.write(`    [${p.kind}] ${p.from} -> ${p.to}  ${p.id}  ${p.label}\n`);
  if (missing.length) process.stdout.write(`--set ids not found: ${missing.join(', ')}\n`);
  if (!args.apply) {
    process.stdout.write('dry run — re-run with --apply to write\n');
    return;
  }

  const byTarget = new Map();
  for (const p of plan) {
    if (!byTarget.has(p.to)) byTarget.set(p.to, []);
    byTarget.get(p.to).push(p.id);
  }
  const total = { km: 0, cold: 0, slicePruned: 0, notFound: 0 };
  for (const [project, ids] of byTarget) {
    for (let i = 0; i < ids.length; i += 100) {
      const res = await fetchRetry(`${args.url}/api/observations/relabel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ids.slice(i, i + 100), project, reason: 'relabel-observations' }),
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(`relabel: HTTP ${res.status}: ${text.slice(0, 200)}`); }
      if (!res.ok) throw new Error(`relabel: HTTP ${res.status}: ${JSON.stringify(body)}`);
      total.km += body.km;
      total.cold += body.cold.relabelled;
      total.slicePruned += body.cold.slicePruned;
      total.notFound += body.notFound.length;
    }
  }
  process.stdout.write(`relabelled ${total.cold} cold-store rows, ${total.km} km-core entities; ${total.slicePruned} removed from other projects' slices; ${total.notFound} not found\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`relabel-observations: ${err.message}\n`);
    process.exit(1);
  });
}
