/**
 * Shared job classes — a team's taxonomy in a learning repo
 * (.planning/shared-job-classes.md, P2: the read side).
 *
 * THE PACKAGE. `<learning repo>/job-classes/`:
 *   taxonomy.yaml   the taxonomy, in the format of config/job-classes.yaml plus
 *                   a `name` (its labels are tagged `<name>-v<version>`, so two
 *                   teams' taxonomies never share a tag)
 *   CHANGELOG.md    one line per version
 * Nothing else: no prompts and no reference set. Those stay on each member's
 * machine (<data home>/var/job-classes/), which is what keeps the package safe
 * on a public repo too.
 *
 * THE BINDING. A team names the learning repo in teams.yaml:
 *   teams: { coding: { jobClasses: { repo: https://…/coding-history.git } } }
 * The repo is found where coding already keeps learning repos: the member's
 * own checkout (`<project>/.coding/`) when the remote is theirs, else the
 * pull-only clone under <data home>/var/shared/ (lib/teams/shared.mjs clones
 * it, `coding sync` pulls it).
 *
 * THE INDEX. rapid-llm-proxy does not know about teams. This module resolves
 * project → team → taxonomy file once and writes it to
 * <proxy data dir>/job-classes/bindings.json, which the proxy's tagger reads
 * (reloaded by mtime). A project with no bound team keeps the default
 * taxonomy (coding's config/job-classes.yaml). A project in two teams bound to
 * two different repos is a CONFLICT: listed in the index and labelled by
 * nobody, because picking one would be a guess.
 *
 * Rewritten by `coding job-classes init|join|index` and after every
 * `coding sync pull`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { CODING_DIR, readRegistry } from '../history/repo-link.mjs';
import { discoveredProjects } from '../teams/discover.mjs';
import { projectsOfTeams } from '../teams/scope.mjs';
import { sharedRoot, sharedName } from '../teams/shared.mjs';

const require = createRequire(import.meta.url);
const yaml = require('../features/vendor/js-yaml.cjs');
const teamsConfig = require('../teams/config.cjs');
const dataHome = require('../paths/data-home.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CODING_ROOT = path.resolve(HERE, '..', '..');
export const PACKAGE_DIR = 'job-classes';
export const TAXONOMY_FILE = 'taxonomy.yaml';
export const CHANGELOG_FILE = 'CHANGELOG.md';
export const DEFAULT_TAXONOMY = path.join('config', 'job-classes.yaml');

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

// ── validation ───────────────────────────────────────────────────────────────

/**
 * Check a taxonomy file. The rules are rapid-llm-proxy's `loadTaxonomy` (which
 * refuses the file at load) plus the package's own: a `name`, an integer
 * version, slug class ids. Run before a package is committed, so a teammate
 * never pulls a taxonomy their proxy refuses.
 *
 * @param {string} file
 * @param {{requireName?: boolean}} [opts]
 * @returns {{errors: string[], tag: string|null, name: string|null, version: number|null, classes: number}}
 */
export function validateTaxonomy(file, opts = {}) {
  const errors = [];
  let raw;
  try { raw = yaml.load(fs.readFileSync(file, 'utf8')); } catch (err) {
    return { errors: [`${file}: ${err.message.split('\n')[0]}`], tag: null, name: null, version: null, classes: 0 };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: [`${file}: expected a mapping`], tag: null, name: null, version: null, classes: 0 };

  const name = raw.name == null ? null : String(raw.name);
  if (name !== null && !SLUG.test(name)) errors.push(`name '${name}' must be lowercase letters, digits and hyphens`);
  if (name === null && opts.requireName) errors.push('name is required in a shared package (labels are tagged <name>-v<version>)');
  const version = raw.version ?? 0;
  if (!Number.isInteger(version) || version < 0) errors.push(`version must be a non-negative integer, not ${JSON.stringify(raw.version)}`);
  if (typeof raw.prompt !== 'string' || !raw.prompt.includes('{request}')) errors.push('prompt must be a template containing {request}');
  if (raw.none != null && typeof raw.none !== 'string') errors.push('none must be a string');

  const classes = Array.isArray(raw.classes) ? raw.classes : [];
  if (!classes.length) errors.push('classes must be a non-empty list of {id, test}');
  const ids = [];
  for (const [i, c] of classes.entries()) {
    const id = c && typeof c === 'object' ? String(c.id || '') : '';
    if (!id) { errors.push(`classes[${i}] has no id`); continue; }
    if (!SLUG.test(id)) errors.push(`class id '${id}' must be lowercase letters, digits and hyphens`);
    if (typeof c.test !== 'string' || !c.test.trim()) errors.push(`class ${id} has no test`);
    ids.push(id);
  }
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) errors.push(`duplicate class ids: ${[...new Set(dup)].join(', ')}`);
  for (const id of Array.isArray(raw.precedence) ? raw.precedence.map(String) : []) {
    if (!ids.includes(id)) errors.push(`precedence names unknown class ${id}`);
  }
  const groups = new Set((Array.isArray(raw.groups) ? raw.groups : []).map((g) => String(g?.id || '')));
  for (const c of classes) {
    if (c?.group && !groups.has(String(c.group))) errors.push(`class ${c.id} names undeclared group ${c.group}`);
  }
  // The cap (P3) and the tombstones a merge leaves: a retired id is no current
  // class, and its mergedInto chain ends at one, so an old label still resolves.
  if (raw.maxClasses != null && (!Number.isInteger(raw.maxClasses) || raw.maxClasses < 1)) errors.push('maxClasses must be a positive integer');
  else if (Number.isInteger(raw.maxClasses) && ids.length > raw.maxClasses) errors.push(`${ids.length} classes, over maxClasses ${raw.maxClasses}`);
  const retired = Array.isArray(raw.retired) ? raw.retired : raw.retired == null ? [] : null;
  if (retired === null) errors.push('retired must be a list of {id, mergedInto, version}');
  const merged = new Map((retired || []).map((r) => [String(r?.id || ''), String(r?.mergedInto || '')]));
  for (const [rid, into] of merged) {
    if (!rid || !into) { errors.push('every retired entry needs id and mergedInto'); continue; }
    if (ids.includes(rid)) errors.push(`retired class ${rid} is still a class`);
    let cur = into;
    for (let i = 0; i < 32 && merged.has(cur); i++) cur = merged.get(cur);
    if (!ids.includes(cur)) errors.push(`retired class ${rid} resolves to ${cur}, which is no current class`);
  }
  const tagName = name ?? path.basename(file).replace(/\.ya?ml$/, '');
  return { errors, tag: `${tagName}-v${version}`, name, version: Number.isInteger(version) ? version : null, classes: ids.length };
}

// ── where a binding's repo is on this machine ────────────────────────────────

/**
 * The checkout of a learning remote here: the member's own (`linked`, they
 * write it), a pull-only clone (`shared`), or nowhere yet (`missing`).
 *
 * @returns {{dir: string, state: 'linked'|'shared'|'missing', project: string|null}}
 */
export function checkoutOf(remote, opts = {}) {
  const key = teamsConfig.remoteKey(remote);
  const own = [];
  try {
    for (const [repo, entry] of Object.entries(readRegistry(opts).repos || {})) {
      if (entry?.remote) own.push({ project: repo, remote: entry.remote });
    }
  } catch { /* no registry: fall through to discovery */ }
  const repos = opts.repos || safe(() => discoveredProjects({ codingRoot: opts.codingRoot || CODING_ROOT, home: opts.home }), []);
  for (const r of repos) if (r.learningRemote) own.push({ project: r.hostPath || r.path, remote: r.learningRemote });
  for (const o of own) {
    const dir = path.join(o.project, CODING_DIR);
    if (teamsConfig.remoteKey(o.remote) === key && fs.existsSync(path.join(dir, '.git'))) return { dir, state: 'linked', project: o.project };
  }
  const dir = path.join(sharedRoot(opts), sharedName(remote));
  return { dir, state: fs.existsSync(path.join(dir, '.git')) ? 'shared' : 'missing', project: null };
}

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

// ── the index the proxy reads ────────────────────────────────────────────────

/** `<proxy data dir>/job-classes/bindings.json` — the proxy's DATA_DIR, by the same rule. */
export function bindingsFile(opts = {}) {
  if (opts.bindingsFile) return opts.bindingsFile;
  return path.join(dataHome.proxyDataDir(opts), PACKAGE_DIR, 'bindings.json');
}

/**
 * Every team binding, resolved on this machine, and the project → taxonomy map.
 *
 * @returns {{teams: Record<string, object>, projects: Record<string, object>,
 *            conflicts: Array<{project: string, teams: string[]}>, warnings: string[]}}
 */
export function resolveBindings(opts = {}) {
  const teamsDoc = opts.teamsDoc || teamsConfig.loadTeams(opts);
  const repos = opts.repos || safe(() => discoveredProjects({ codingRoot: opts.codingRoot || CODING_ROOT, home: opts.home }), []);
  const warnings = [...teamsDoc.warnings.filter((w) => w.includes('jobClasses'))];
  const teams = {};
  const byProject = new Map(); // lowercased project id → Map(team → file)

  for (const [id, t] of Object.entries(teamsDoc.teams)) {
    if (!t.jobClasses) continue;
    const where = checkoutOf(t.jobClasses.repo, { ...opts, repos });
    const file = path.join(where.dir, PACKAGE_DIR, TAXONOMY_FILE);
    const entry = { repo: t.jobClasses.repo, dir: where.dir, state: where.state, file, tag: null, errors: [] };
    if (where.state === 'missing') entry.errors.push('the repo is not cloned on this machine yet (coding sync pull, or coding job-classes join)');
    else if (!fs.existsSync(file)) entry.errors.push(`no ${PACKAGE_DIR}/${TAXONOMY_FILE} in it (coding job-classes init --team ${id})`);
    else {
      const v = validateTaxonomy(file, { requireName: true });
      entry.tag = v.tag;
      entry.errors.push(...v.errors);
    }
    entry.usable = entry.errors.length === 0;
    teams[id] = entry;
    if (!entry.usable) { warnings.push(`team ${id}: ${entry.errors[0]}`); continue; }
    const { projects } = projectsOfTeams([id], { teamsDoc, repos, codingRoot: opts.codingRoot || CODING_ROOT });
    entry.projects = [...projects].sort();
    for (const p of projects) {
      const k = String(p).toLowerCase();
      if (!byProject.has(k)) byProject.set(k, new Map());
      byProject.get(k).set(id, entry);
    }
  }

  const projects = {};
  const conflicts = [];
  for (const [project, bound] of [...byProject].sort()) {
    const files = new Set([...bound.values()].map((e) => e.file));
    if (files.size > 1) {
      const ids = [...bound.keys()].sort();
      conflicts.push({ project, teams: ids });
      projects[project] = { conflict: ids };
      warnings.push(`project ${project} is in teams ${ids.join(' and ')}, bound to different job-class repos: it is not labelled until one binding goes`);
      continue;
    }
    const [team, e] = [...bound][0];
    projects[project] = { team, file: e.file, tag: e.tag };
  }
  return { teams, projects, conflicts, warnings };
}

/** Write the index atomically. Returns what was written. */
export function writeBindingsIndex(opts = {}) {
  const resolved = resolveBindings(opts);
  const doc = {
    generatedAt: new Date().toISOString(),
    default: path.join(opts.codingRoot || CODING_ROOT, DEFAULT_TAXONOMY),
    ...resolved,
  };
  const file = bindingsFile(opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { file, ...doc };
}

// ── init and join ────────────────────────────────────────────────────────────

/** The source taxonomy's text with `name:` set (comments kept). */
export function withName(text, name) {
  if (/^name:.*$/m.test(text)) return text.replace(/^name:.*$/m, `name: ${name}`);
  if (/^version:/m.test(text)) return text.replace(/^version:/m, `name: ${name}\nversion:`);
  return `name: ${name}\n${text}`;
}

/**
 * The learning remote init should use for a team: `repo` when given, else the
 * cwd's repo when it is in the team, else the first team repo with one.
 */
export function defaultRepoFor(team, opts = {}) {
  if (opts.repo) return opts.repo;
  const teamsDoc = opts.teamsDoc || teamsConfig.loadTeams(opts);
  const repos = opts.repos || safe(() => discoveredProjects({ codingRoot: opts.codingRoot || CODING_ROOT, home: opts.home }), []);
  const mine = repos.filter((r) => r.learningRemote && teamsConfig.teamsOf(r.hostPath || r.path, { teamsDoc, learningRemote: r.learningRemote }).includes(team));
  const cwd = opts.cwd ? safe(() => fs.realpathSync(opts.cwd), opts.cwd) : null;
  const here = cwd && mine.find((r) => cwd === r.path || cwd.startsWith(`${r.path}${path.sep}`));
  return (here || mine[0])?.learningRemote || null;
}

/**
 * Bind a team to a job-class repo on this machine (~/.coding/teams.yaml),
 * clone the repo when it is not here, and rewrite the index.
 */
export function joinTeam({ team, repo, ...opts }) {
  const id = String(team || '').toLowerCase();
  const teamsDoc = teamsConfig.loadTeams({ ...opts, force: true });
  if (!teamsDoc.teams[id]) throw new Error(`no team '${id}' (teams: ${Object.keys(teamsDoc.teams).sort().join(', ') || 'none'})`);
  if (!repo) throw new Error('--repo <learning repo remote> is required');
  teamsConfig.writeUserTeams({ teams: { [id]: { jobClasses: { repo } } } }, opts);
  const where = checkoutOf(repo, opts);
  let cloned = false;
  if (where.state === 'missing') {
    if (!opts.clone) throw new Error(`${repo} is not on this machine (pass a clone function)`);
    cloned = opts.clone(where.dir, repo);
  }
  return { team: id, repo, cloned, index: writeBindingsIndex(opts) };
}

/**
 * Create a team's package in the member's own learning checkout, from coding's
 * default taxonomy, commit it there locally, and bind the team to it.
 * Pushing stays `coding sync --push`.
 */
export function initPackage({ team, ...opts }) {
  const id = String(team || '').toLowerCase();
  const teamsDoc = teamsConfig.loadTeams({ ...opts, force: true });
  if (!teamsDoc.teams[id]) throw new Error(`no team '${id}' (teams: ${Object.keys(teamsDoc.teams).sort().join(', ') || 'none'})`);
  const repo = defaultRepoFor(id, { ...opts, teamsDoc });
  if (!repo) throw new Error(`no repo of team '${id}' has a learning repo on this machine; pass --repo <remote>`);
  const where = checkoutOf(repo, opts);
  if (where.state !== 'linked') {
    throw new Error(`${repo} is not your own learning checkout here (${where.state}); init writes into your checkout — to use a teammate's package: coding job-classes join --team ${id} --repo ${repo}`);
  }
  const pkg = path.join(where.dir, PACKAGE_DIR);
  const file = path.join(pkg, TAXONOMY_FILE);
  let created = false;
  if (!fs.existsSync(file)) {
    const source = opts.source || path.join(opts.codingRoot || CODING_ROOT, DEFAULT_TAXONOMY);
    const name = `job-classes-${id}`;
    const from = validateTaxonomy(source);
    if (from.errors.length) throw new Error(`${source}: ${from.errors.join('; ')}`);
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(file, withName(fs.readFileSync(source, 'utf8'), name));
    const host = os.hostname().split('.')[0];
    fs.writeFileSync(path.join(pkg, CHANGELOG_FILE), [
      `# Job classes — team ${id}`, '',
      'One line per taxonomy version. Labels are tagged `<name>-v<version>`.', '',
      `- v${from.version} (${new Date().toISOString().slice(0, 10)}): started from coding's ${DEFAULT_TAXONOMY} (${from.tag}) on ${host}.`, '',
    ].join('\n'));
    created = true;
  }
  const v = validateTaxonomy(file, { requireName: true });
  if (v.errors.length) throw new Error(`${file}: ${v.errors.join('; ')}`);
  let commit = null;
  if (created && opts.commit) commit = opts.commit(where.dir, `coding: job-class taxonomy for team ${id} (${v.tag})`);
  const joined = joinTeam({ ...opts, team: id, repo });
  return { team: id, repo, dir: where.dir, file, tag: v.tag, created, commit, index: joined.index };
}
