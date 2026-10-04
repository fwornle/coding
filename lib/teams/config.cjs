'use strict';

/**
 * Teams — which repos make up which team, and which teams are active.
 *
 * A TEAM IS A SET OF REPOS (D6). There is one live store per machine; every
 * team filter (viewer, injection) maps repo → team through this module. The
 * repo stays the unit of persistence (`<repo>/.coding/`, T3), so an entity's
 * `metadata.project` names its repo and team membership is derived, never
 * stamped — a repo can belong to several teams, and moving it between teams
 * must not require rewriting the graph.
 *
 * LAYERS (later wins, per team, per field):
 *   1. config/teams/<id>.json   ontology + validation config (unchanged; the
 *                               semantic-analysis pipeline reads these directly)
 *   2. config/teams.yaml        shipped: labels, kinds, membership defaults
 *   3. ~/.coding/teams.yaml     this user: membership, own teams, `active:`
 *   4. CODING_TEAMS=a,b         env override of the active selection
 *
 * A team entry:
 *   label, kind ('team'|'project'), description
 *   repos:   local paths (abs or ~), history remotes, or {path?, remote?, id?}
 *   include: basename globs ('rapid-*')
 * A team with neither `repos` nor `include` matches the repo whose basename is
 * its id — exactly what the basename stamping has always meant, so a machine
 * with no teams.yaml sees no change.
 *
 * FAIL-OPEN: this feeds display and filtering surfaces, so an unreadable layer
 * is skipped with a warning instead of throwing. Writers (`writeUserTeams`)
 * validate and throw.
 *
 * CommonJS for the same reason as lib/features/resolve.cjs: the ETM and the
 * status line are hot CJS consumers.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('../features/vendor/js-yaml.cjs');

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KINDS = new Set(['team', 'project']);

const DEFAULT_DISCOVERY = {
  roots: ['~'],
  depth: 4,
  ignore: ['node_modules', 'Library', 'Applications', 'Pictures', 'Music', 'Movies', 'Downloads',
    'dist', 'build', 'vendor', 'venv', 'target', '__pycache__'],
  ttlMinutes: 10,
};

// ── paths ────────────────────────────────────────────────────────────────────

function repoRoot(opts = {}) {
  return opts.repoRoot || process.env.CODING_REPO || process.env.CODING_TOOLS_PATH || path.resolve(__dirname, '..', '..');
}

function homeDir(opts = {}) {
  return opts.home || process.env.CODING_HOME || os.homedir();
}

function configPaths(opts = {}) {
  const repo = repoRoot(opts);
  return {
    jsonDir: path.join(repo, 'config', 'teams'),
    shipped: opts.shippedPath || path.join(repo, 'config', 'teams.yaml'),
    user: opts.userPath || path.join(homeDir(opts), '.coding', 'teams.yaml'),
  };
}

function expandHome(p, opts = {}) {
  if (typeof p !== 'string') return p;
  // The same home the config paths use, so a sandboxed CODING_HOME resolves
  // `~/…` repo paths inside the sandbox instead of the real home.
  if (p === '~') return homeDir(opts);
  if (p.startsWith('~/')) return path.join(homeDir(opts), p.slice(2));
  return p;
}

function realPath(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

// ── reading ──────────────────────────────────────────────────────────────────

function readYaml(file, warnings) {
  if (!fs.existsSync(file)) return null;
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    if (doc == null) return null;
    if (typeof doc !== 'object' || Array.isArray(doc)) {
      warnings.push(`${file}: expected a mapping — ignored`);
      return null;
    }
    return doc;
  } catch (err) {
    warnings.push(`${file}: ${err.message.split('\n')[0]} — ignored`);
    return null;
  }
}

/** Layer 1: config/teams/<id>.json, ontology fields kept verbatim under `ontology`. */
function readJsonTeams(dir, warnings) {
  const out = {};
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'view-groups.json').sort(); } catch { return out; }
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (err) {
      warnings.push(`${f}: ${err.message} — ignored`);
      continue;
    }
    const label = typeof doc.team === 'string' ? doc.team.trim() : '';
    if (!label) { warnings.push(`${f}: no "team" field — ignored`); continue; }
    const { team: _team, kind, description, ...ontology } = doc;
    out[label.toLowerCase()] = {
      label,
      kind: kind === 'project' ? 'project' : 'team',
      description: typeof description === 'string' ? description : '',
      ontology,
      sources: [`config/teams/${f}`],
    };
  }
  return out;
}

/** Normalise one `repos:` entry to {path?, remote?, id?}, or null. */
function normaliseRepoRef(ref, opts = {}) {
  if (typeof ref === 'string') ref = isRemote(ref) ? { remote: ref } : { path: ref };
  if (!ref || typeof ref !== 'object') return null;
  const out = {};
  if (typeof ref.path === 'string' && ref.path.trim()) out.path = path.resolve(expandHome(ref.path.trim(), opts));
  if (typeof ref.remote === 'string' && ref.remote.trim()) out.remote = ref.remote.trim();
  if (typeof ref.id === 'string' && ref.id.trim()) out.id = ref.id.trim();
  return out.path || out.remote ? out : null;
}

function isRemote(s) {
  return /^[a-z+]+:\/\//i.test(s) || /^[^@/\s]+@[^:\s]+:/.test(s);
}

/** Compare remotes across https/ssh spellings and a trailing .git. */
function remoteKey(url) {
  if (!url) return '';
  let u = String(url).trim().replace(/\.git$/, '').replace(/\/+$/, '');
  let m = /^[^@/]+@([^:]+):(.+)$/.exec(u);
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  m = /^[a-z+]+:\/\/(?:[^@/]+@)?(.+)$/i.exec(u);
  if (m) return m[1].toLowerCase();
  return u.toLowerCase();
}

function mergeTeam(base, layer, source, warnings, id, opts) {
  const out = { ...(base || { label: id, kind: 'team', description: '', ontology: {}, sources: [] }) };
  out.sources = [...(out.sources || []), source];
  if (layer == null) return out;
  if (typeof layer !== 'object' || Array.isArray(layer)) {
    warnings.push(`${source}: team '${id}' must be a mapping — ignored`);
    return out;
  }
  if (typeof layer.label === 'string' && layer.label.trim()) out.label = layer.label.trim();
  if (typeof layer.description === 'string') out.description = layer.description;
  if (layer.kind != null) {
    if (KINDS.has(layer.kind)) out.kind = layer.kind;
    else warnings.push(`${source}: team '${id}' kind must be team|project`);
  }
  if (layer.repos != null) {
    if (!Array.isArray(layer.repos)) warnings.push(`${source}: team '${id}' repos must be a list`);
    else out.repos = layer.repos.map((r) => normaliseRepoRef(r, opts)).filter(Boolean);
  }
  if (layer.include != null) {
    if (!Array.isArray(layer.include)) warnings.push(`${source}: team '${id}' include must be a list`);
    else out.include = layer.include.filter((g) => typeof g === 'string' && g.trim());
  }
  return out;
}

function parseActive(v) {
  if (v == null) return null;
  const list = Array.isArray(v) ? v : String(v).split(',');
  return list.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

let _cache = null;
let _stamp = null;

function stampOf(paths, env) {
  const m = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  let jsonStamp = 0;
  try { for (const f of fs.readdirSync(paths.jsonDir)) jsonStamp += m(path.join(paths.jsonDir, f)); } catch { /* none */ }
  return [m(paths.shipped), m(paths.user), jsonStamp, env.CODING_TEAMS || '', paths.user].join('|');
}

/**
 * The resolved team configuration.
 * @returns {{teams: Record<string, object>, active: string[], activeSource: string,
 *            discovery: object, warnings: string[], paths: object}}
 */
function loadTeams(opts = {}) {
  const env = opts.env || process.env;
  const paths = configPaths(opts);
  const cacheable = !opts.repoRoot && !opts.home && !opts.shippedPath && !opts.userPath && !opts.env;
  const stamp = stampOf(paths, env);
  if (cacheable && !opts.force && _cache && _stamp === stamp) return _cache;

  const warnings = [];
  const teams = readJsonTeams(paths.jsonDir, warnings);
  const shipped = readYaml(paths.shipped, warnings) || {};
  const user = readYaml(paths.user, warnings) || {};

  for (const [doc, source] of [[shipped, 'config/teams.yaml'], [user, '~/.coding/teams.yaml']]) {
    const declared = doc.teams;
    if (declared == null) continue;
    if (typeof declared !== 'object' || Array.isArray(declared)) {
      warnings.push(`${source}: 'teams' must be a mapping — ignored`);
      continue;
    }
    for (const [rawId, layer] of Object.entries(declared)) {
      const id = String(rawId).toLowerCase();
      if (!ID_RE.test(id)) { warnings.push(`${source}: invalid team id '${rawId}' — ignored`); continue; }
      teams[id] = mergeTeam(teams[id], layer, source, warnings, id, opts);
    }
  }
  for (const [id, t] of Object.entries(teams)) {
    teams[id] = { id, repos: [], include: [], ...t };
  }

  let active = [];
  let activeSource = 'none (all teams)';
  const envActive = parseActive(env.CODING_TEAMS);
  if (envActive && envActive.length) { active = envActive; activeSource = 'env CODING_TEAMS'; }
  else if (parseActive(user.active)) { active = parseActive(user.active); activeSource = '~/.coding/teams.yaml'; }
  else if (parseActive(shipped.active)) { active = parseActive(shipped.active); activeSource = 'config/teams.yaml'; }
  for (const id of active) {
    if (!teams[id]) warnings.push(`active team '${id}' is not defined`);
  }

  const discovery = { ...DEFAULT_DISCOVERY };
  for (const doc of [shipped, user]) {
    const d = doc.discovery;
    if (!d || typeof d !== 'object') continue;
    if (Array.isArray(d.roots)) discovery.roots = d.roots.filter((r) => typeof r === 'string');
    if (Number.isInteger(d.depth) && d.depth > 0 && d.depth <= 10) discovery.depth = d.depth;
    if (Array.isArray(d.ignore)) discovery.ignore = d.ignore.filter((r) => typeof r === 'string');
    if (Number.isFinite(d.ttlMinutes) && d.ttlMinutes >= 0) discovery.ttlMinutes = d.ttlMinutes;
  }
  discovery.roots = discovery.roots.map((r) => path.resolve(expandHome(r, opts)));

  const result = { teams, active, activeSource, discovery, warnings, paths };
  if (cacheable) { _cache = result; _stamp = stamp; }
  return result;
}

// ── mapping ──────────────────────────────────────────────────────────────────

function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

/**
 * The origin of a repo's learning checkout (`.coding/`, or an older nested
 * `.specstory/history`), read from its git config without spawning git.
 */
function learningRemoteOf(repoPath) {
  for (const sub of [['.coding'], ['.specstory', 'history']]) {
    const cfg = path.join(repoPath, ...sub, '.git', 'config');
    const url = originFromConfig(cfg);
    if (url) return url;
  }
  return '';
}

function originFromConfig(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  const m = /\[remote "origin"\]([^[]*)/.exec(text);
  if (!m) return '';
  const u = /^\s*url\s*=\s*(.+)$/m.exec(m[1]);
  return u ? u[1].trim() : '';
}

/**
 * Which teams a repo belongs to.
 *
 * @param {string} repoPath
 * @param {object} [opts]  {teamsDoc, learningRemote} — both looked up when absent
 * @returns {string[]} team ids, sorted
 */
function teamsOf(repoPath, opts = {}) {
  if (!repoPath) return [];
  const doc = opts.teamsDoc || loadTeams(opts);
  const real = realPath(repoPath);
  const name = path.basename(real);
  const remote = remoteKey(opts.learningRemote !== undefined ? opts.learningRemote : learningRemoteOf(real));
  const out = [];
  for (const [id, t] of Object.entries(doc.teams)) {
    const repos = t.repos || [];
    const include = t.include || [];
    let hit = false;
    for (const r of repos) {
      if (r.path && realPath(r.path) === real) hit = true;
      else if (r.remote && remote && remoteKey(r.remote) === remote) hit = true;
      if (hit) break;
    }
    if (!hit && include.some((g) => globToRegExp(g).test(name))) hit = true;
    if (!hit && !repos.length && !include.length && name.toLowerCase() === id) hit = true;
    if (hit) out.push(id);
  }
  return out.sort();
}

/**
 * The project id stamped on what is learned in a repo (`metadata.project`, and
 * the legacy `metadata.team`). A `repos:` entry may name it (`id:`) — e.g. two
 * checkouts of one project under different directory names; otherwise it is
 * the directory name, as it has always been.
 */
function projectIdFor(repoPath, opts = {}) {
  if (!repoPath) return '';
  const real = realPath(repoPath);
  let doc;
  try { doc = opts.teamsDoc || loadTeams(opts); } catch { return path.basename(real); }
  let remote = null; // read only if some entry needs it: this runs per observation
  for (const t of Object.values(doc.teams)) {
    for (const r of t.repos || []) {
      if (!r.id) continue;
      if (r.path && realPath(r.path) === real) return r.id;
      if (!r.remote) continue;
      if (remote === null) remote = remoteKey(opts.learningRemote !== undefined ? opts.learningRemote : learningRemoteOf(real));
      if (remote && remoteKey(r.remote) === remote) return r.id;
    }
  }
  return path.basename(real);
}

/** Whether a repo passes the active-team filter (no active teams = everything passes). */
function isActiveRepo(repoPath, opts = {}) {
  const doc = opts.teamsDoc || loadTeams(opts);
  if (!doc.active.length) return true;
  const mine = teamsOf(repoPath, { ...opts, teamsDoc: doc });
  return mine.some((id) => doc.active.includes(id));
}

// ── writing ──────────────────────────────────────────────────────────────────

/**
 * Patch ~/.coding/teams.yaml. `patch.active` replaces the selection (null
 * clears it); `patch.teams` merges per team id (null deletes the user's entry
 * for that team); `patch.discovery` replaces the discovery block.
 * Validates and throws; writes atomically.
 */
function writeUserTeams(patch, opts = {}) {
  const paths = configPaths(opts);
  const warnings = [];
  const doc = readYaml(paths.user, warnings) || {};
  if (warnings.length) throw new Error(`refusing to rewrite an unreadable ${paths.user}: ${warnings[0]}`);

  if ('active' in patch) {
    if (patch.active === null) delete doc.active;
    else {
      const list = parseActive(patch.active) || [];
      for (const id of list) if (!ID_RE.test(id)) throw new Error(`invalid team id '${id}'`);
      doc.active = list;
    }
  }
  if (patch.teams) {
    doc.teams = doc.teams && typeof doc.teams === 'object' ? doc.teams : {};
    for (const [rawId, entry] of Object.entries(patch.teams)) {
      const id = String(rawId).toLowerCase();
      if (!ID_RE.test(id)) throw new Error(`invalid team id '${rawId}'`);
      if (entry === null) { delete doc.teams[id]; continue; }
      if (typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`team '${id}' must be a mapping`);
      if (entry.kind != null && !KINDS.has(entry.kind)) throw new Error(`team '${id}': kind must be team|project`);
      for (const key of ['repos', 'include']) {
        if (entry[key] != null && !Array.isArray(entry[key])) throw new Error(`team '${id}': ${key} must be a list`);
      }
      const next = { ...(doc.teams[id] || {}) };
      for (const key of ['label', 'kind', 'description', 'repos', 'include']) {
        if (key in entry) {
          if (entry[key] === null) delete next[key];
          else next[key] = entry[key];
        }
      }
      doc.teams[id] = next;
    }
    if (!Object.keys(doc.teams).length) delete doc.teams;
  }
  if (patch.discovery) doc.discovery = patch.discovery;

  fs.mkdirSync(path.dirname(paths.user), { recursive: true });
  const header = '# coding — teams for this user. A team is a set of repos.\n'
    + '# Written by the dashboard (Teams) and by hand; overrides config/teams.yaml.\n';
  const tmp = `${paths.user}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, header + yaml.dump(doc, { lineWidth: 200 }));
  fs.renameSync(tmp, paths.user);
  _cache = null;
  return loadTeams({ ...opts, force: true });
}

module.exports = {
  DEFAULT_DISCOVERY,
  configPaths,
  loadTeams,
  teamsOf,
  projectIdFor,
  isActiveRepo,
  learningRemoteOf,
  originFromConfig,
  remoteKey,
  normaliseRepoRef,
  writeUserTeams,
};
