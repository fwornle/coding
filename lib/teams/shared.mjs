/**
 * Shared learning repos — a team member's `<repo>-history` that is not checked
 * out on this machine.
 *
 * A team's `repos:` may name a history remote without a local checkout of the
 * project itself (you want RaaS's knowledge without working in RaaS). Such a
 * remote is cloned under `<data home>/var/shared/<name>/` — `var/` because it
 * is a machine-local copy of someone else's data (D7), never a place this
 * machine writes learned data to. `<name>` is the remote's repo name minus the
 * `-history` suffix, i.e. the project's name.
 *
 * Clone-only, like every launch-time path: refreshing a clone is T4's sync,
 * and nothing here ever pushes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { cloneInto, urlSlug } from '../history/repo-link.mjs';
import { discover } from './discover.mjs';

const require = createRequire(import.meta.url);
const teamsConfig = require('./config.cjs');

/** `<data home>/var/shared`. */
export function sharedRoot(opts = {}) {
  if (opts.sharedRoot) return opts.sharedRoot;
  return path.join(require('../paths/data-home.cjs').varDir(opts), 'shared');
}

/** The project name a history remote stands for. */
export function sharedName(remote) {
  const slug = urlSlug(remote) || remote.replace(/\.git$/, '');
  return path.basename(slug.replace(/\.git$/, '')).replace(/-history$/, '');
}

/**
 * Every remote-only `repos:` entry, with where it is (or would be) on disk.
 * @returns {Array<{team:string, remote:string, path:string, state:'local'|'shared'|'missing'}>}
 */
export function sharedPlan(opts = {}) {
  const teamsDoc = opts.teamsDoc || teamsConfig.loadTeams(opts);
  const repos = opts.repos || discover({ ...opts, teamsDoc }).repos;
  const local = new Map(repos.filter((r) => r.learningRemote).map((r) => [teamsConfig.remoteKey(r.learningRemote), r.path]));
  const root = sharedRoot(opts);
  const out = [];
  const seen = new Set();
  for (const [id, t] of Object.entries(teamsDoc.teams)) {
    for (const ref of t.repos || []) {
      if (!ref.remote || ref.path) continue;
      const key = teamsConfig.remoteKey(ref.remote);
      if (seen.has(key)) continue;
      seen.add(key);
      if (local.has(key)) { out.push({ team: id, remote: ref.remote, path: local.get(key), state: 'local' }); continue; }
      const dir = path.join(root, sharedName(ref.remote));
      out.push({ team: id, remote: ref.remote, path: dir, state: fs.existsSync(path.join(dir, '.git')) ? 'shared' : 'missing' });
    }
  }
  return out;
}

/** Clone every missing shared repo. Returns the plan with `state` updated. */
export function syncShared(opts = {}) {
  const log = opts.log || (() => {});
  return sharedPlan(opts).map((item) => {
    if (item.state !== 'missing') return item;
    const ok = cloneInto(item.path, item.remote, { log, run: opts.run, legacy: 'restructure' });
    if (!ok) {
      try { if (fs.readdirSync(item.path).length === 0) fs.rmdirSync(item.path); } catch { /* absent */ }
    }
    return { ...item, state: ok ? 'shared' : 'missing' };
  });
}
