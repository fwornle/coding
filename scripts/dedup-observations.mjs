#!/usr/bin/env node
/**
 * Remove duplicate observations: rows of one project with the SAME timestamp.
 *
 * An observation's timestamp is the start of the exchange it summarises, so two
 * completion rows sharing (project, timestamp) are one prompt observed twice —
 * a monitor replaying exchanges it had already fired (see the 2026-11-11 fix in
 * scripts/enhanced-transcript-monitor.js: _cursorFor, _lastFiredExchangeTs).
 * Progress snapshots (kind 'progress') are left alone; they share their turn's
 * start by design.
 *
 * Per group it keeps every row a digest cites (deleting one would orphan the
 * digest's provenance) — or, when none is cited, the best row: highest quality,
 * then longest summary. The rest are deleted through obs-api, which prunes both
 * km-core and the cold-store export.
 *
 *   node scripts/dedup-observations.mjs              dry run: counts + plan file
 *   node scripts/dedup-observations.mjs --apply      back up the rows, then delete
 *
 * Options: --url <obs-api base> (default http://localhost:12436), --out <dir>
 * for the plan/backup files (default <data home>/var/observation-dedup).
 * The backup holds the rows as /api/coding/observations returns them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = { apply: false, url: 'http://localhost:12436', out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function getAll(base, route) {
  const rows = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const res = await fetch(`${base}${route}?limit=${limit}&offset=${offset}`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body.data)) throw new Error(`${route}: ${JSON.stringify(body).slice(0, 200)}`);
    rows.push(...body.data);
    if (body.data.length < limit) return rows;
  }
}

const QUALITY = { high: 3, normal: 2, low: 1 };

/** The ids to delete, given all observations and the ids digests cite. */
export function planDedup(observations, citedIds) {
  const groups = new Map();
  for (const r of observations) {
    if (!r || !r.id || r.kind === 'progress') continue;
    const key = `${r.project}|${r.timestamp}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const remove = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const cited = rows.filter((r) => citedIds.has(r.id));
    const keep = cited.length > 0
      ? cited
      : [[...rows].sort((a, b) =>
        (QUALITY[b.quality] || 0) - (QUALITY[a.quality] || 0)
        || String(b.content || '').length - String(a.content || '').length)[0]];
    const keepIds = new Set(keep.map((r) => r.id));
    for (const r of rows) if (!keepIds.has(r.id)) remove.push(r);
  }
  return remove;
}

function defaultOutDir() {
  try {
    const { dataHome } = require('../lib/paths/data-home.cjs');
    return path.join(dataHome(), 'var', 'observation-dedup');
  } catch {
    return path.join(process.cwd(), '.data', 'observation-dedup');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('usage: dedup-observations.mjs [--apply] [--url <obs-api>] [--out <dir>]\n');
    return;
  }
  const outDir = args.out || defaultOutDir();
  const observations = await getAll(args.url, '/api/coding/observations');
  const digests = await getAll(args.url, '/api/coding/digests');
  const cited = new Set(digests.flatMap((d) => d.observationIds || []));
  const remove = planDedup(observations, cited);

  const byMonth = {};
  for (const r of remove) byMonth[String(r.timestamp).slice(0, 7)] = (byMonth[String(r.timestamp).slice(0, 7)] || 0) + 1;
  process.stdout.write(`${observations.length} observations, ${digests.length} digests; duplicates to delete: ${remove.length}\n`);
  for (const [m, n] of Object.entries(byMonth).sort()) process.stdout.write(`  ${m}  ${n}\n`);

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `${args.apply ? 'deleted' : 'plan'}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(remove, null, 1));
  process.stdout.write(`${args.apply ? 'backup' : 'plan'}: ${file}\n`);
  if (!args.apply) {
    process.stdout.write('dry run — re-run with --apply to delete\n');
    return;
  }

  const total = { deleted: 0, coldPruned: 0, notFound: 0 };
  const ids = remove.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetch(`${args.url}/api/observations/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(i, i + 100) }),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`delete: HTTP ${res.status}: ${text.slice(0, 200)}`); }
    if (!res.ok) throw new Error(`delete: HTTP ${res.status}: ${JSON.stringify(body)}`);
    total.deleted += body.deleted;
    total.coldPruned += body.coldPruned;
    total.notFound += body.notFound.length;
  }
  process.stdout.write(`deleted ${total.deleted} from km-core, pruned ${total.coldPruned} from the cold store, ${total.notFound} not found\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`dedup-observations: ${err.message}\n`);
    process.exit(1);
  });
}
