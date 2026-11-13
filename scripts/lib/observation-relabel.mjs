/**
 * Re-label observation-export rows (observations, digests, insights) with a new
 * project — the cold-store half of POST /api/observations/relabel.
 *
 * Why the cold store needs its own pass: the exporter's safety merge PRESERVES
 * rows km-core no longer holds (most observations — km-core keeps only the
 * working set), verbatim. Re-labelling the km-core entity alone would leave
 * every older row under its old project for good.
 *
 * Per-project slices (`<repo>/.coding/kb/observation-export/`) are union-merged
 * by the exporter, so a row that moves OUT of a project would also survive in
 * that project's slice forever: it is removed there, and the next export adds
 * it to the new project's slice from the combined files.
 */
import fs from 'node:fs';
import path from 'node:path';

export const RELABEL_FILES = ['observations.json', 'digests.json', 'insights.json'];

/** A project id a relabel may write: a repo-style slug, never the learning checkout. */
export function validRelabelProject(p) {
  return typeof p === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(p) && p !== '.coding';
}

function readArray(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} o
 * @param {string} o.exportDir   combined cold store (what the dashboard reads)
 * @param {Array<{project: string, dir: string}>} [o.slices] writable per-project slices
 * @param {Set<string>} o.ids
 * @param {string} o.project      the new project
 * @param {boolean} [o.dryRun]
 * @returns {{relabelled: number, previous: Record<string, number>, slicePruned: number, ids: Set<string>}}
 *   ids: the requested ids found in the combined cold store
 */
export function relabelColdStore({ exportDir, slices = [], ids, project, dryRun = false }) {
  let relabelled = 0;
  let slicePruned = 0;
  const previous = {};
  const found = new Set();
  for (const name of RELABEL_FILES) {
    const file = path.join(exportDir, name);
    const rows = readArray(file);
    if (!rows) continue;
    let changed = false;
    for (const r of rows) {
      if (!r || !ids.has(r.id)) continue;
      found.add(r.id);
      if (r.project === project) continue;
      const from = r.project ?? 'unknown';
      previous[from] = (previous[from] || 0) + 1;
      r.project = project;
      relabelled++;
      changed = true;
    }
    if (changed && !dryRun) fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\n');
  }
  for (const { project: owner, dir } of slices) {
    if (!dir || owner === project) continue;
    for (const name of RELABEL_FILES) {
      const file = path.join(dir, name);
      const rows = readArray(file);
      if (!rows) continue;
      const kept = rows.filter((r) => !(r && ids.has(r.id)));
      if (kept.length === rows.length) continue;
      slicePruned += rows.length - kept.length;
      if (!dryRun) fs.writeFileSync(file, JSON.stringify(kept, null, 2) + '\n');
    }
  }
  return { relabelled, previous, slicePruned, ids: found };
}

/**
 * Delete rows by id from the cold store: the combined files AND every writable
 * slice — the delete half of the same problem. The exporter preserves rows
 * km-core no longer holds, so a km-core delete alone never reaches a digest or
 * an older observation, and a slice keeps whatever it once held.
 *
 * @returns {{pruned: number, slicePruned: number, ids: Set<string>}} ids: found anywhere
 */
export function pruneColdStore({ exportDir, slices = [], ids }) {
  let pruned = 0;
  let slicePruned = 0;
  const found = new Set();
  const dirs = [{ dir: exportDir, combined: true }, ...slices.map((s) => ({ dir: s.dir, combined: false }))];
  for (const { dir, combined } of dirs) {
    if (!dir) continue;
    for (const name of RELABEL_FILES) {
      const file = path.join(dir, name);
      const rows = readArray(file);
      if (!rows) continue;
      const kept = rows.filter((r) => {
        if (!(r && ids.has(r.id))) return true;
        found.add(r.id);
        return false;
      });
      const n = rows.length - kept.length;
      if (n === 0) continue;
      if (combined) pruned += n; else slicePruned += n;
      fs.writeFileSync(file, JSON.stringify(kept, null, 2) + '\n');
    }
  }
  return { pruned, slicePruned, ids: found };
}
