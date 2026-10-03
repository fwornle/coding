#!/usr/bin/env node
/**
 * git merge driver for a learning checkout's `kb/**.json` (T4).
 *
 * Two people learning in the same repo both rewrite that repo's knowledge
 * export; a line merge of two pretty-printed JSON graphs conflicts on nearly
 * every pull. This driver merges by MEANING instead, with the same rule the
 * live store hydrates by (km-core store/merge.ts): entities by id, newest
 * `updatedAt` wins, relations by (from, type, to), deletions as tombstones.
 *
 *   knowledge-graph/<project>.json   a serialized graph → mergeGraphs
 *   observation-export/*.json        an array of rows   → union by id
 *
 * Registered per checkout by lib/history/sync.mjs:
 *   .gitattributes            kb/**\/*.json merge=coding-kb
 *   .git/config               merge.coding-kb.driver = node <this> %O %A %B
 *
 * Usage: merge-driver.mjs <ancestor> <ours> <theirs>. Writes the result over
 * <ours>; exit 0 = merged, 1 = leave the conflict to git (not JSON we know).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOMBSTONES_ATTR = 'kmTombstones';

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

const isGraph = (g) => g && typeof g === 'object' && Array.isArray(g.nodes);

function ms(s) {
  const t = typeof s === 'string' ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** The same canonical form the km-core exporter writes (sorted, 2-space). */
export function serializeGraph(g) {
  const triple = (e) => `${e.source}\u0000${e.attributes?.type ?? ''}\u0000${e.target}`;
  const nodes = [...g.nodes].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const edges = [...g.edges].sort((a, b) => (triple(a) < triple(b) ? -1 : triple(a) > triple(b) ? 1 : 0));
  const { [TOMBSTONES_ATTR]: stones, ...attrs } = g.attributes || {};
  const has = stones && (Object.keys(stones.entities || {}).length + Object.keys(stones.relations || {}).length) > 0;
  return JSON.stringify({ attributes: has ? { ...attrs, [TOMBSTONES_ATTR]: stones } : attrs, options: g.options, nodes, edges }, null, 2);
}

export async function mergeGraphFiles(ours, theirs) {
  const { mergeGraphs } = await import(path.join(HERE, '..', 'km-core', 'dist', 'store', 'merge.js'));
  const { graph, dangling } = mergeGraphs([ours, theirs]);
  // In ONE project's file, a relation to another project's entity is normal:
  // that entity lives in another file. Nothing is "dangling" here.
  const seen = new Set(graph.edges.map((e) => `${e.source}\u0000${e.attributes?.type ?? ''}\u0000${e.target}`));
  for (const { edge } of dangling) {
    const k = `${edge.source}\u0000${edge.attributes?.type ?? ''}\u0000${edge.target}`;
    if (!seen.has(k)) { seen.add(k); graph.edges.push(edge); }
  }
  return graph;
}

/** Rows merged by id; the row updated last wins; ours keeps its order. */
export function mergeRows(ours, theirs) {
  const stamp = (r) => ms(r?.lastUpdated) || ms(r?.updatedAt) || ms(r?.createdAt) || ms(r?.date);
  const out = [...ours];
  const at = new Map(out.map((r, i) => [r?.id, i]));
  for (const r of theirs) {
    if (!r || r.id === undefined) { out.push(r); continue; }
    const i = at.get(r.id);
    if (i === undefined) { at.set(r.id, out.length); out.push(r); }
    else if (stamp(r) > stamp(out[i])) out[i] = r;
  }
  return out;
}

async function main() {
  const [, , , oursFile, theirsFile] = process.argv;
  const ours = read(oursFile);
  const theirs = read(theirsFile);
  if (isGraph(ours) && isGraph(theirs)) {
    fs.writeFileSync(oursFile, serializeGraph(await mergeGraphFiles(ours, theirs)));
    return 0;
  }
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    fs.writeFileSync(oursFile, JSON.stringify(mergeRows(ours, theirs), null, 2) + '\n');
    return 0;
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => {
    process.stderr.write(`[coding-kb merge] ${err.message}\n`);
    process.exit(1);
  });
}
