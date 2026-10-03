/**
 * Team selection → the projects it covers — the one mapping every team
 * filter uses (obs-api read routes, the viewer, insight injection; T6).
 *
 * A team is a set of repos (config.cjs); what is learned in a repo carries
 * that repo's project id in `metadata.project` (legacy: `metadata.team`).
 * So filtering by teams = filtering by the union of their repos' project ids:
 *
 *   - every discovered repo whose teamsOf() hits a selected team → projectIdFor(repo)
 *   - every `repos:` entry: `id:` as given, a path → projectIdFor(path),
 *     a remote-only entry → the remote's project name (shared clone naming)
 *   - a team with neither `repos` nor `include` → the team id itself
 *     (the old "a team is the repo of the same name")
 *
 * Membership is derived here at read time, never stamped (T5), so a repo can
 * belong to several teams and a reassignment applies to existing knowledge.
 */

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

import { discoveredProjects } from './discover.mjs';

const require = createRequire(import.meta.url);
const teamsConfig = require('./config.cjs');

const TTL_MS = 30_000;
const memo = new Map();

/** `?teams=a,b` (or an array) → ['a','b']; empty/absent → [] (= no filter). */
export function parseTeams(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].sort();
}

/** The project an entity / row belongs to. */
export function projectOf(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  return metadata.project || metadata.team || null;
}

function remoteName(remote) {
  const s = String(remote).replace(/\.git$/, '').replace(/\/+$/, '');
  return path.basename(s.includes(':') && !s.includes('/') ? s.split(':').pop() : s).replace(/-history$/, '');
}

/**
 * @param {string[]} teamIds
 * @param {{codingRoot?: string, teamsDoc?: object, repos?: object[]}} opts
 * @returns {{teams: string[], projects: Set<string>, unknown: string[]}}
 */
export function projectsOfTeams(teamIds, opts = {}) {
  const teams = parseTeams(teamIds);
  const cacheable = !opts.teamsDoc && !opts.repos;
  const key = `${teams.join(',')}|${opts.codingRoot || ''}`;
  const hit = cacheable && memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const doc = opts.teamsDoc || teamsConfig.loadTeams(opts);
  const projects = new Set();
  // An id that is not a defined team is a project id (the viewer's "views":
  // a project some session learned in, with no team declared for it).
  const unknown = teams.filter((t) => !doc.teams[t]);
  for (const id of unknown) projects.add(id);
  const wanted = new Set(teams.filter((t) => doc.teams[t]));

  for (const id of wanted) {
    const t = doc.teams[id];
    const repos = t.repos || [];
    if (!repos.length && !(t.include || []).length) projects.add(id);
    for (const r of repos) {
      if (r.id) projects.add(r.id);
      else if (r.path) projects.add(teamsConfig.projectIdFor(r.path, { teamsDoc: doc }));
      else if (r.remote) projects.add(remoteName(r.remote));
    }
  }

  let repos = opts.repos;
  if (!repos) {
    try { repos = discoveredProjects({ codingRoot: opts.codingRoot }); } catch { repos = []; }
  }
  for (const r of repos) {
    const p = r.hostPath || r.path;
    let mine;
    try { mine = teamsConfig.teamsOf(p, { teamsDoc: doc, learningRemote: r.learningRemote ?? undefined }); } catch { mine = []; }
    if (mine.some((t) => wanted.has(t))) projects.add(teamsConfig.projectIdFor(p, { teamsDoc: doc }));
  }

  const value = { teams, projects, unknown };
  if (cacheable) memo.set(key, { at: Date.now(), value });
  return value;
}

/**
 * A predicate over metadata for a team selection, or null when there is
 * nothing to filter (no teams selected). Matching is case-insensitive on the
 * project id (ids are lowercased like team ids; repo names are not always).
 */
export function teamPredicate(teamIds, opts = {}) {
  const { teams, projects } = projectsOfTeams(teamIds, opts);
  if (!teams.length) return null;
  const lower = new Set([...projects].map((p) => String(p).toLowerCase()));
  return (metadata) => {
    const p = projectOf(metadata);
    return p !== null && lower.has(String(p).toLowerCase());
  };
}

/** The git repo root containing `dir` (nearest `.git`), or null. */
export function repoRootOf(dir) {
  let cur = path.resolve(dir || '.');
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/**
 * The teams to filter injection by for a session in `cwd`: the active
 * selection if one is set, else the teams the cwd's repo belongs to, else
 * the repo's own project id (an id that is no team is a project id), so a
 * repo in no team only sees what was learned in it. [] = no filter: no
 * active teams and the cwd is in no repo.
 */
export function defaultTeamsFor(cwd, opts = {}) {
  const doc = opts.teamsDoc || teamsConfig.loadTeams(opts);
  if (doc.active.length) return [...doc.active];
  const root = cwd ? repoRootOf(cwd) : null;
  if (!root) return [];
  let mine = [];
  try { mine = teamsConfig.teamsOf(root, { teamsDoc: doc }); } catch { /* fall through to the repo's project */ }
  if (mine.length) return mine;
  return parseTeams([teamsConfig.projectIdFor(root, { teamsDoc: doc })]);
}
