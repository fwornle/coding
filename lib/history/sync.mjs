#!/usr/bin/env node
/**
 * Sync of the per-repo learning checkouts (`<repo>/.coding/`, T3) and of the
 * shared clones of teammates' repos (`<data home>/var/shared/<X>/`, T5).
 *
 * D3, the whole rule:
 *   - PULL automatically at session start (the launcher);
 *   - COMMIT automatically, locally only (session end + the coordinator's
 *     periodic sweep);
 *   - PUSH only on confirmation: `coding sync --push` asks first (`--yes` to
 *     skip the question). Nothing else ever pushes.
 *
 * Shared clones are pull-only: they are someone else's data, nothing here
 * commits to or pushes them.
 *
 * Conflicts: `kb/**.json` merges through lib/kb/merge-driver.mjs (by entity
 * id, newest wins) — registered in each checkout on every sync. Anything else
 * that still conflicts (two machines editing the same transcript, which the
 * per-session file names make unlikely) aborts the merge and is reported; the
 * checkout is left exactly as it was before the pull.
 *
 * Every git call is non-interactive (GIT_TERMINAL_PROMPT=0) and bounded by a
 * timeout. Nothing throws: each checkout gets a result row, and the summary is
 * cached in `<data home>/var/sync-state.json` for the status line.
 *
 * CLI:
 *   sync.mjs [status]                  table of every checkout (ahead/behind/dirty)
 *   sync.mjs pull   [--repo <dir>]     commit local changes, then pull (+ shared clones)
 *   sync.mjs commit [--repo <dir>]     local commit only
 *   sync.mjs push   [--repo <dir>] [--yes]
 *   --json  machine-readable output
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { CODING_DIR, defaultRun, readRegistry } from './repo-link.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODING_ROOT = path.resolve(HERE, '..', '..');

export const MERGE_DRIVER = 'coding-kb';
const ATTRIBUTES_LINE = `kb/**/*.json merge=${MERGE_DRIVER}`;
const NET_TIMEOUT = 60000;

function git(run, cwd, args, timeout) {
  return run('git', args, { cwd, timeout });
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// ── what to sync ─────────────────────────────────────────────────────────────

/**
 * Every learning checkout on this machine.
 * @returns {Array<{dir: string, project: string, kind: 'linked'|'shared'}>}
 */
export function checkouts(opts = {}) {
  const out = [];
  const seen = new Set();
  const add = (dir, project, kind) => {
    const real = (() => { try { return fs.realpathSync(dir); } catch { return dir; } })();
    if (seen.has(real) || !isDir(path.join(dir, '.git'))) return;
    seen.add(real);
    out.push({ dir, project, kind });
  };
  const reg = readRegistry(opts);
  for (const [repo, entry] of Object.entries(reg.repos || {})) {
    if (entry && entry.remote) add(path.join(repo, CODING_DIR), path.basename(repo), 'linked');
  }
  let sharedRoot = opts.sharedRoot;
  if (!sharedRoot) {
    try { sharedRoot = path.join(require('../paths/data-home.cjs').varDir(opts), 'shared'); } catch { sharedRoot = null; }
  }
  if (sharedRoot) {
    let names = [];
    try { names = fs.readdirSync(sharedRoot); } catch { /* none */ }
    for (const n of names.sort()) add(path.join(sharedRoot, n), n, 'shared');
  }
  return out;
}

/** The checkout a project dir (or a `.coding` dir itself) stands for. */
export function checkoutFor(dir, opts = {}) {
  const abs = path.resolve(dir);
  const candidates = [abs, path.join(abs, CODING_DIR)];
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  return checkouts(opts).find((c) => candidates.some((p) => real(p) === real(c.dir))) || null;
}

// ── per-checkout operations ──────────────────────────────────────────────────

/**
 * Register the kb merge driver: `.gitattributes` (tracked, so every clone
 * routes kb JSON to it) and the driver command (local config — it names this
 * machine's path to coding).
 */
export function ensureMergeDriver(dir, opts = {}) {
  const run = opts.run || defaultRun;
  const attrs = path.join(dir, '.gitattributes');
  let text = '';
  try { text = fs.readFileSync(attrs, 'utf8'); } catch { /* new */ }
  if (!text.split('\n').includes(ATTRIBUTES_LINE)) {
    fs.writeFileSync(attrs, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${ATTRIBUTES_LINE}\n`);
  }
  const driver = `node "${path.join(opts.codingRoot || CODING_ROOT, 'lib', 'kb', 'merge-driver.mjs')}" %O %A %B`;
  git(run, dir, ['config', `merge.${MERGE_DRIVER}.name`, 'coding knowledge export (merge by entity id)']);
  git(run, dir, ['config', `merge.${MERGE_DRIVER}.driver`, driver]);
}

function hasHead(run, dir) {
  return git(run, dir, ['rev-parse', '-q', '--verify', 'HEAD']).code === 0;
}

function upstream(run, dir) {
  const r = git(run, dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return r.code === 0 ? r.stdout.trim() : null;
}

function hasOrigin(run, dir) {
  return git(run, dir, ['remote', 'get-url', 'origin']).code === 0;
}

/** Commit whatever changed in the checkout, locally. */
export function commit(dir, opts = {}) {
  const run = opts.run || defaultRun;
  ensureMergeDriver(dir, opts);
  if (git(run, dir, ['add', '-A']).code !== 0) return { committed: false, error: 'git add failed' };
  if (git(run, dir, ['diff', '--cached', '--quiet']).code === 0) return { committed: false };
  const host = os.hostname().split('.')[0];
  const msg = opts.message || `coding: learned data from ${host} (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
  const r = git(run, dir, ['commit', '-q', '--no-verify', '-m', msg]);
  return r.code === 0 ? { committed: true } : { committed: false, error: (r.stderr || r.stdout).trim().split('\n')[0] };
}

/** Ahead/behind (as of the last fetch) and whether the tree is dirty. */
export function status(dir, opts = {}) {
  const run = opts.run || defaultRun;
  const u = upstream(run, dir);
  let ahead = 0;
  let behind = 0;
  if (u) {
    const r = git(run, dir, ['rev-list', '--left-right', '--count', `HEAD...${u}`]);
    if (r.code === 0) [ahead, behind] = r.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);
  } else if (hasHead(run, dir) && hasOrigin(run, dir)) {
    // Never pushed: every local commit is "ahead".
    const r = git(run, dir, ['rev-list', '--count', 'HEAD']);
    ahead = Number(r.stdout.trim()) || 0;
  }
  const dirty = git(run, dir, ['status', '--porcelain']).stdout.trim() !== '';
  return { upstream: u, ahead, behind, dirty };
}

/**
 * Pull. A linked checkout commits its own changes first (a merge needs a
 * clean tree, and they are worth keeping anyway); a shared clone throws its
 * local changes away (it has none of its own — only stray rewrites).
 *
 * @returns {{pulled: boolean, changed: boolean, error?: string}}
 */
export function pull(dir, opts = {}) {
  const run = opts.run || defaultRun;
  if (!hasOrigin(run, dir)) return { pulled: false, changed: false, error: 'no origin' };
  if (opts.kind === 'shared') {
    git(run, dir, ['reset', '-q', '--hard']);
    git(run, dir, ['clean', '-q', '-fd']);
  } else {
    const c = commit(dir, opts);
    if (c.error) return { pulled: false, changed: false, error: c.error };
  }
  ensureMergeDriver(dir, opts);
  const before = git(run, dir, ['rev-parse', '-q', '--verify', 'HEAD']).stdout.trim();
  const fetch = git(run, dir, ['fetch', '-q', 'origin'], opts.timeout ?? NET_TIMEOUT);
  if (fetch.code !== 0) return { pulled: false, changed: false, error: `fetch: ${(fetch.stderr || '').trim().split('\n')[0] || fetch.code}` };

  let u = upstream(run, dir);
  if (!u) {
    // First pull after `git init` + push without -u, or a fresh clone of an
    // empty remote: track origin/<current branch> if it exists.
    const branch = git(run, dir, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
    if (branch && git(run, dir, ['rev-parse', '-q', '--verify', `origin/${branch}`]).code === 0) {
      git(run, dir, ['branch', '-q', `--set-upstream-to=origin/${branch}`]);
      u = `origin/${branch}`;
    }
  }
  if (!u) return { pulled: true, changed: false }; // nothing upstream yet

  const m = before
    ? git(run, dir, ['merge', '-q', '--no-edit', '-m', `coding: merge ${u}`, u])
    : git(run, dir, ['reset', '-q', '--hard', u]);
  if (m.code !== 0) {
    const conflicted = git(run, dir, ['diff', '--name-only', '--diff-filter=U']).stdout.trim();
    git(run, dir, ['merge', '--abort']);
    return { pulled: false, changed: false, error: `merge conflict: ${conflicted.split('\n').join(', ') || (m.stderr || '').trim()}` };
  }
  const after = git(run, dir, ['rev-parse', '-q', '--verify', 'HEAD']).stdout.trim();
  return { pulled: true, changed: before !== after };
}

/** Push (sets the upstream on first push). Only `coding sync --push` calls this. */
export function push(dir, opts = {}) {
  const run = opts.run || defaultRun;
  if (!hasOrigin(run, dir)) return { pushed: false, error: 'no origin' };
  const args = upstream(run, dir) ? ['push', '-q'] : ['push', '-q', '-u', 'origin', 'HEAD'];
  const r = git(run, dir, args, opts.timeout ?? NET_TIMEOUT);
  return r.code === 0 ? { pushed: true } : { pushed: false, error: (r.stderr || '').trim().split('\n')[0] || `exit ${r.code}` };
}

// ── state cache (the status line reads this, never git) ──────────────────────

export function stateFile(opts = {}) {
  if (opts.stateFile) return opts.stateFile;
  return path.join(require('../paths/data-home.cjs').varDir(opts), 'sync-state.json');
}

/** Refresh `sync-state.json` from the checkouts' current status. */
export function writeState(rows, opts = {}) {
  const doc = {
    updatedAt: new Date().toISOString(),
    ahead: rows.filter((r) => r.kind !== 'shared' && r.ahead > 0).length,
    repos: rows,
  };
  try {
    const file = stateFile(opts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
    fs.renameSync(tmp, file);
  } catch { /* the cache is a convenience */ }
  return doc;
}

/**
 * Run one action over the selected checkouts and refresh the state cache.
 * @param {'status'|'pull'|'commit'|'push'} action
 * @param {{repo?: string}} opts  `repo` = one project dir (pull also refreshes shared clones)
 */
export function syncAll(action, opts = {}) {
  const all = checkouts(opts);
  let selected = all;
  if (opts.repo) {
    const one = checkoutFor(opts.repo, opts);
    selected = all.filter((c) => (one && c.dir === one.dir) || (action === 'pull' && c.kind === 'shared'));
  }
  const rows = [];
  for (const c of all) {
    const row = { ...c };
    if (selected.includes(c)) {
      try {
        if (action === 'pull') Object.assign(row, pull(c.dir, { ...opts, kind: c.kind }));
        else if (action === 'commit' && c.kind !== 'shared') Object.assign(row, commit(c.dir, opts));
        else if (action === 'push' && c.kind !== 'shared') {
          Object.assign(row, commit(c.dir, opts));
          Object.assign(row, push(c.dir, opts));
        }
      } catch (err) {
        row.error = err.message;
      }
      row.selected = true;
    }
    Object.assign(row, status(c.dir, opts));
    rows.push(row);
  }
  const doc = writeState(rows, opts);
  return { action, ...doc };
}

/** Tell obs-api to merge what a pull brought in (fails open: it may be down). */
export async function notifyReload(opts = {}) {
  const port = opts.port || process.env.OBSERVATIONS_API_PORT || '12436';
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/kb/reload`, { method: 'POST', signal: AbortSignal.timeout(opts.timeoutMs ?? 30000) });
    return r.ok ? await r.json() : { error: `HTTP ${r.status}` };
  } catch (err) {
    return { error: err.message };
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function table(doc) {
  const lines = [];
  for (const r of doc.repos) {
    const flags = [
      r.kind === 'shared' ? 'shared' : null,
      r.ahead ? `${r.ahead} to push` : null,
      r.behind ? `${r.behind} behind` : null,
      r.dirty ? 'uncommitted' : null,
      r.committed ? 'committed' : null,
      r.changed ? 'pulled changes' : null,
      r.pushed ? 'pushed' : null,
      r.error ? `ERROR ${r.error}` : null,
    ].filter(Boolean);
    lines.push(`  ${r.project.padEnd(28)} ${flags.join(', ') || 'up to date'}`);
  }
  return lines.length ? lines.join('\n') : '  (no learning checkouts with a remote on this machine)';
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main(argv) {
  const args = argv.slice(2);
  const flag = (n) => args.includes(n);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  let action = args.find((a) => ['status', 'pull', 'commit', 'push'].includes(a)) || 'status';
  if (flag('--push')) action = 'push';
  if (flag('--pull')) action = 'pull';
  const opts = { repo: val('--repo') };
  const json = flag('--json');

  if (action === 'push' && !flag('--yes')) {
    syncAll('commit', opts);
    const pending = syncAll('status', opts).repos.filter((r) => r.kind !== 'shared' && r.ahead > 0 && (!opts.repo || r.selected));
    if (!pending.length) {
      process.stdout.write('Nothing to push.\n');
      return 0;
    }
    process.stdout.write(`Push learned data (transcripts + knowledge) to:\n${pending.map((r) => `  ${r.project.padEnd(28)} ${r.ahead} commit(s) → ${r.upstream || 'origin (first push)'}`).join('\n')}\n`);
    if (!(await confirm('Push now? [y/N] '))) {
      process.stdout.write('Not pushed.\n');
      return 0;
    }
  }

  const doc = syncAll(action, opts);
  if (action === 'pull' && doc.repos.some((r) => r.changed)) doc.reload = await notifyReload();
  if (json) process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
  else process.stdout.write(`coding sync ${action}\n${table(doc)}\n${doc.reload ? `  obs-api reload: ${doc.reload.error ? `failed (${doc.reload.error})` : `+${doc.reload.added} -${doc.reload.removed} ~${doc.reload.replaced}`}\n` : ''}`);
  return doc.repos.some((r) => r.error && r.selected) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((code) => process.exit(code), (err) => {
    process.stderr.write(`coding sync: ${err.message}\n`);
    process.exit(1);
  });
}
