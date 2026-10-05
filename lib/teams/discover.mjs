/**
 * Discovery — which repos on this machine hold learned data.
 *
 * One scanner for everything that used to walk the disk on its own (the
 * coordinator's ETM candidate walk, the dashboard's LSL-sessions and
 * workflow-reports scans — each limited to the tools checkout's parent dir).
 *
 * A repo qualifies when it is a git repo carrying one of the markers:
 *   .coding/               the per-repo learning repo (T3)
 *   .specstory/history     LSL history in the pre-T3 layout (a repo not relaunched since)
 * The walk starts at the configured roots (default $HOME, see
 * lib/teams/config.cjs `discovery:`), skips dot-dirs and the ignore list,
 * stops at `depth`, and does not descend into a repo it has classified.
 *
 * The result is cached in `<data home>/var/projects.json`. The scan runs on the
 * HOST (coordinator, CLIs); the dashboard container reads the cache through its
 * data-home mount and translates host paths (`$HOME/Agentic/x` → `/workspace/x`,
 * the tools checkout → its own root). When there is no cache it falls back to
 * the old sibling scan, so a display surface never goes empty for lack of one.
 *
 * Top-level imports are node built-ins plus lib/paths only — both available in
 * the container. The YAML config is loaded lazily, on the scanning path.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 2: the `history` marker (T9) — an older cache has no repo carrying it.
const CACHE_VERSION = 2;

/** Markers a repo is recognised by, keyed by the name reported in `markers`. */
const MARKERS = {
  coding: ['.coding'],
  specstory: ['.specstory', 'history'],
  // Has session transcripts, in either layout — what transcript readers ask
  // for (T9: a repo set up fresh has .coding/history and no .specstory/).
  history: [['.coding', 'history'], ['.specstory', 'history']],
};

function exists(p) {
  try { fs.statSync(p); return true; } catch { return false; }
}

function originFromConfig(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  const m = /\[remote "origin"\]([^[]*)/.exec(text);
  if (!m) return '';
  const u = /^\s*url\s*=\s*(.+)$/m.exec(m[1]);
  return u ? u[1].trim() : '';
}

/** Describe a repo dir, or null when it is not a marked git repo. */
export function describeRepo(dir) {
  if (!exists(path.join(dir, '.git'))) return null;
  const markers = Object.entries(MARKERS)
    .filter(([, rel]) => (Array.isArray(rel[0]) ? rel : [rel]).some((r) => exists(path.join(dir, ...r))))
    .map(([name]) => name);
  if (!markers.length) return null;
  const learning = ['.coding', path.join('.specstory', 'history')]
    .map((sub) => originFromConfig(path.join(dir, sub, '.git', 'config')))
    .find(Boolean) || '';
  return {
    path: dir,
    name: path.basename(dir),
    markers,
    learningRepo: exists(path.join(dir, '.coding', '.git')),
    learningRemote: learning,
    outerRemote: originFromConfig(path.join(dir, '.git', 'config')),
  };
}

/**
 * Walk the roots. Pure — no cache, no config.
 * @param {{roots: string[], depth?: number, ignore?: string[]}} opts
 * @returns {object[]} repos, sorted by path
 */
export function scan(opts) {
  const depth = opts.depth ?? 4;
  const ignore = new Set(opts.ignore || []);
  const home = path.resolve(opts.home || os.homedir());
  const found = new Map();

  const visit = (dir, level) => {
    // $HOME and a filesystem root are never projects (a session opened there is
    // a scratch shell), but they are fine places to start walking from.
    if (dir !== home && dir !== path.parse(dir).root) {
      const repo = describeRepo(dir);
      if (repo) { found.set(dir, repo); return; }
      if (exists(path.join(dir, '.git'))) return; // an unmarked repo: nothing below is ours
    }
    if (level >= depth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      // Real directories only: following symlinks invites loops and double counts.
      if (!e.isDirectory() || e.name.startsWith('.') || ignore.has(e.name)) continue;
      visit(path.join(dir, e.name), level + 1);
    }
  };

  for (const root of opts.roots || []) visit(path.resolve(root), 0);
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// ── cache ────────────────────────────────────────────────────────────────────

/** Where the cache lives: `<data home>/var/projects.json` (null when unresolvable). */
export function cachePath(opts = {}) {
  if (opts.cachePath) return opts.cachePath;
  try {
    return path.join(require('../paths/data-home.cjs').varDir(opts), 'projects.json');
  } catch {
    return null;
  }
}

export function readCache(opts = {}) {
  const file = cachePath(opts);
  if (!file) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!doc || !Array.isArray(doc.repos)) return null;
    if (doc.version === CACHE_VERSION) return doc;
    // A version-1 cache — written by a coordinator still running the code from
    // before the `history` marker — stays usable: derive the marker here, so a
    // reader restarted first does not fall back to the narrow sibling scan
    // until the writer is restarted too.
    if (doc.version === 1) {
      for (const r of doc.repos) {
        if (r.markers && !r.markers.includes('history')
          && (r.markers.includes('specstory') || exists(path.join(r.path, '.coding', 'history')))) {
          r.markers = [...r.markers, 'history'];
        }
      }
      return doc;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover, using the cache while it is fresh. Host-side.
 * @param {{refresh?: boolean, now?: number, teamsDoc?: object}} opts
 */
export function discover(opts = {}) {
  const now = opts.now ?? Date.now();
  const teamsDoc = opts.teamsDoc || require('./config.cjs').loadTeams(opts);
  const d = { ...teamsDoc.discovery, ...(opts.discovery || {}) };
  const cached = readCache(opts);
  const sameRoots = cached && JSON.stringify(cached.roots) === JSON.stringify(d.roots) && cached.depth === d.depth;
  if (!opts.refresh && sameRoots && now - Date.parse(cached.scannedAt) < d.ttlMinutes * 60000) return cached;

  const repos = scan({ roots: d.roots, depth: d.depth, ignore: d.ignore, home: opts.home });
  const doc = {
    version: CACHE_VERSION,
    scannedAt: new Date(now).toISOString(),
    home: path.resolve(opts.home || os.homedir()),
    toolsRepo: process.env.CODING_REPO || process.env.CODING_TOOLS_PATH || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'),
    roots: d.roots,
    depth: d.depth,
    repos,
  };
  const file = cachePath(opts);
  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
      fs.renameSync(tmp, file);
    } catch { /* a read-only data home still gets an answer, just no cache */ }
  }
  return doc;
}

// ── readers (host or container) ─────────────────────────────────────────────

/**
 * Translate a host path from the cache to one that exists here. Identity on
 * the host; inside the container `$HOME/Agentic/...` lives at the workspace
 * mount and the tools checkout at `codingRoot`.
 */
function localPath(p, cache, codingRoot) {
  if (exists(p)) return p;
  if (codingRoot && cache.toolsRepo && p === cache.toolsRepo) return codingRoot;
  const ws = process.env.LSL_WORKSPACE_ROOT || '/workspace';
  const hostWs = path.join(cache.home || '', 'Agentic');
  if (cache.home && (p === hostWs || p.startsWith(`${hostWs}${path.sep}`))) {
    const mapped = path.join(ws, path.relative(hostWs, p));
    if (exists(mapped)) return mapped;
  }
  return null;
}

/** The old sibling scan — the fallback when there is no cache to read. */
function siblingScan(codingRoot) {
  const roots = [path.resolve(codingRoot, '..')];
  const ws = process.env.LSL_WORKSPACE_ROOT || '/workspace';
  if (exists(ws) && !roots.includes(ws)) roots.push(ws);
  const dirs = [codingRoot];
  for (const base of roots) {
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const n of names) dirs.push(path.join(base, n));
  }
  return [...new Set(dirs.map((d) => path.resolve(d)))].map((d) => describeRepo(d)).filter(Boolean);
}

/**
 * The discovered repos as paths valid in THIS process (host or container),
 * optionally only those with a given marker. Never throws, never empty for
 * lack of a cache.
 *
 * @param {{codingRoot: string, marker?: 'coding'|'specstory'|'history'}} opts
 * @returns {object[]} repos with `path` translated; `hostPath` keeps the original
 */
export function discoveredProjects(opts = {}) {
  const codingRoot = opts.codingRoot ? path.resolve(opts.codingRoot) : null;
  const cache = readCache(opts);
  let repos;
  if (cache) {
    repos = cache.repos
      .map((r) => {
        const p = localPath(r.path, cache, codingRoot);
        return p ? { ...r, hostPath: r.path, path: p } : null;
      })
      .filter(Boolean);
  } else {
    repos = codingRoot ? siblingScan(codingRoot).map((r) => ({ ...r, hostPath: r.path })) : [];
  }
  // The tools checkout is always a project, even before its first launch.
  if (codingRoot && !repos.some((r) => path.resolve(r.path) === codingRoot)) {
    const self = describeRepo(codingRoot);
    if (self) repos.unshift({ ...self, hostPath: self.path });
  }
  if (opts.marker) repos = repos.filter((r) => r.markers.includes(opts.marker));
  return repos;
}
