/**
 * Where the knowledge graph is persisted: one JSON file per PROJECT, in that
 * project's own learning checkout when it has one.
 *
 *   <repo>/.coding/kb/knowledge-graph/<project>.json   a repo with a .coding/
 *                                                      (linked → shared by git;
 *                                                      skipped → untracked, local)
 *   <data home>/var/shared/<X>/kb/knowledge-graph/…    a teammate's repo cloned
 *                                                      for a team (T5) — READ only
 *   <data home>/kb/knowledge-graph/exports/projects/…  everything else (no repo
 *                                                      on this machine)
 *
 * The tools repo is no exception (T7): its knowledge lives in its own
 * coding-history checkout, `<coding>/.coding/kb/`.
 *
 * The project of an entity is `metadata.project`, else the legacy
 * `metadata.team` (both name the repo since T5); nothing at all → `general`.
 *
 * Hydrate reads ALL of those, plus `exports/general.json` — the pre-T4
 * single-file export, still written by the container's stores, which cannot
 * write into the read-only /workspace mount. km-core merges them
 * (newest `updatedAt` wins, tombstones for deletions; store/merge.ts).
 *
 * Two modes:
 *   - 'owner' (obs-api, the one live store per machine — D6): writes each
 *     project's file where it belongs.
 *   - 'local' (the container's stores): reads everything, writes the whole
 *     graph to `exports/general.json` as before. Reading everything matters:
 *     a store that never sees the owner's tombstones would keep re-exporting
 *     what the owner deleted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { discoveredProjects } from '../teams/discover.mjs';

const require = createRequire(import.meta.url);
const dataHome = require('../paths/data-home.cjs');
const teamsConfig = require('../teams/config.cjs');

export const GRAPH_SUBDIR = 'knowledge-graph';
export const FALLBACK_BUCKET = 'general';

/** A bucket name safe as a file name (project ids already are; this is a guard). */
export function bucketName(metadata) {
  const raw = String(metadata?.project || metadata?.team || FALLBACK_BUCKET);
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_');
  return safe || FALLBACK_BUCKET;
}

/** `<repo>/.coding/kb` */
export function repoKbDir(repoPath) {
  return path.join(repoPath, '.coding', 'kb');
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/**
 * Whether the outer repo ignores `.coding/` — set up by repo-link's
 * `ensureLayout` on the repo's first launch since T3. A repo that has a
 * `.coding/` but was never launched since may not ignore it yet, and writing
 * kb files there would show up as untracked files in the user's own repo.
 */
function ignoresCodingDir(repoPath) {
  const lines = (f) => {
    try { return fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()); } catch { return []; }
  };
  const hit = (ls) => ls.some((l) => l === '.coding' || l === '.coding/' || l === '/.coding' || l === '/.coding/');
  return hit(lines(path.join(repoPath, '.git', 'info', 'exclude'))) || hit(lines(path.join(repoPath, '.gitignore')));
}

function jsonFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.includes('.tmp.'))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * project id → kb dir, for every place on this machine a project's knowledge
 * can live. A local checkout beats a shared clone of the same project.
 *
 * @param {{codingRoot?: string, sharedRoot?: string}} opts  (plus data-home/teams opts)
 * @returns {Map<string, {kbDir: string, repo: string, kind: 'linked'|'local'|'shared'}>}
 */
export function projectKbDirs(opts = {}) {
  const codingRoot = opts.codingRoot ? path.resolve(opts.codingRoot) : null;
  const out = new Map();
  let teamsDoc;
  try { teamsDoc = opts.teamsDoc || teamsConfig.loadTeams(opts); } catch { teamsDoc = undefined; }

  const repos = opts.repos || discoveredProjects({ ...opts, codingRoot: codingRoot || undefined });
  for (const r of repos) {
    if (!isDir(path.join(r.path, '.coding')) || !ignoresCodingDir(r.path)) continue;
    let id;
    try { id = teamsConfig.projectIdFor(r.hostPath || r.path, { teamsDoc }); } catch { id = path.basename(r.path); }
    if (!id || out.has(id)) continue;
    const linked = isDir(path.join(r.path, '.coding', '.git'));
    out.set(id, { kbDir: repoKbDir(r.path), repo: r.path, kind: linked ? 'linked' : 'local' });
  }

  const sharedRoot = opts.sharedRoot || path.join(dataHome.varDir(opts), 'shared');
  let shared = [];
  try { shared = fs.readdirSync(sharedRoot, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { /* none */ }
  for (const e of shared) {
    const dir = path.join(sharedRoot, e.name);
    if (out.has(e.name) || !isDir(path.join(dir, '.git'))) continue;
    out.set(e.name, { kbDir: path.join(dir, 'kb'), repo: dir, kind: 'shared' });
  }
  return out;
}

/**
 * The km-core ExportLayout for this machine (see the header).
 *
 * @param {{mode?: 'owner'|'local', codingRoot?: string}} opts
 */
export function kbLayout(opts = {}) {
  const mode = opts.mode || 'owner';
  const exportsDir = opts.exportsDir || dataHome.graphExportsDir(opts);
  const localDir = path.join(exportsDir, 'projects');
  const legacyFile = path.join(exportsDir, `${FALLBACK_BUCKET}.json`);
  let dirs = projectKbDirs(opts);

  const fileFor = (bucket) => {
    if (mode === 'local') return legacyFile;
    // A shared clone is someone else's data (T5, D7): read, never written —
    // what this machine learns about that project stays in its local file.
    const hit = dirs.get(bucket);
    const writable = hit && hit.kind !== 'shared';
    return path.join(writable ? path.join(hit.kbDir, GRAPH_SUBDIR) : localDir, `${bucket}.json`);
  };

  return {
    mode,
    bucketOf: (metadata) => (mode === 'local' ? FALLBACK_BUCKET : bucketName(metadata)),
    fileFor,
    sources() {
      const files = [legacyFile, ...jsonFiles(localDir)];
      for (const { kbDir } of dirs.values()) files.push(...jsonFiles(path.join(kbDir, GRAPH_SUBDIR)));
      return files;
    },
    // Only this machine's own local files may be emptied. A repo's file can
    // only ever be rewritten with that project's current content.
    owns: (file) => (mode === 'local' ? file === legacyFile : path.dirname(file) === localDir),
    canonicalOrder: mode === 'owner',
    /** Re-read which repos exist (after a clone, a link, a new discovery). */
    refresh() { dirs = projectKbDirs(opts); },
    /** project → where its file goes, for logs and the API. */
    describe() {
      return Object.fromEntries([...dirs].map(([id, d]) => [id, { ...d, file: fileFor(id) }]));
    },
  };
}
