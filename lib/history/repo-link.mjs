#!/usr/bin/env node
/**
 * One per-repo learning repo — the single implementation.
 *
 * Every project `coding` runs in gets a nested checkout at `<repo>/.coding/`
 * holding what was learned there:
 *
 *   <repo>/.coding/               a private `<repo>-history` repo (or untracked, on skip)
 *   ├── history/                  LSL transcripts, YYYY/MM/<file> + logs/
 *   ├── kb/                       knowledge exports, measurement exports
 *   ├── README.md
 *   └── .gitignore                lock artefacts + machine-local state
 *
 *   <repo>/.specstory/history  →  .coding/history     (relative symlink)
 *
 * The symlink keeps every writer and reader that addresses `.specstory/history`
 * working unchanged (the ETM, SpecStory, the dashboards). The outer repo ignores
 * both paths through `.git/info/exclude`, never its tracked `.gitignore`: the
 * repo belongs to its team, and only clones that run `coding` have a `.coding/`.
 *
 * Which remote backs which repo is recorded per user in `~/.coding/repos.yaml`
 * (`<realpath> → {remote} | {skip: true}`, optional `team`). A skip is
 * remembered and never re-asked.
 *
 * Linking a remote (`linkRemote`):
 *   public     refused — transcripts never go to a public repo
 *   populated  cloned (a teammate's repo is how knowledge is shared); an older
 *              transcripts-only layout (YYYY/ at the root) is restructured into
 *              history/ with a LOCAL commit
 *   empty      initialised and the skeleton pushed
 *   absent     created as a PRIVATE repo (`gh repo create`, or `git init --bare`
 *              for a local path), then as empty
 *   unknown    (no gh for that host) cloned if possible, else local-only
 *
 * Nothing but the skeleton is ever pushed from here (D3: pushing transcripts is
 * confirmed, never a side effect of launching an agent).
 *
 * Called by the launcher (`ensure_private_history_repo` in
 * scripts/agent-common-setup.sh → `node lib/history/repo-link.mjs ensure <dir>`)
 * and by bin/init-history.sh for the clone into the tools repo's data home.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('../features/vendor/js-yaml.cjs');
const scope = require('../scope/resolve.cjs');

export const CODING_DIR = '.coding';
const LEGACY_LINK = path.join('.specstory', 'history');
const SKIP_MARKER = path.join('.specstory', '.history-repo-skipped');

/** Entries of `.coding/` that are layout, not transcripts. */
const META = new Set([
  '.git', '.gitignore', 'README.md', 'history', 'kb', 'var', '.DS_Store',
  // Machine-local files other parts of coding keep in <repo>/.coding/.
  'session-state.json', 'hooks.json',
]);

const GITIGNORE_LINES = [
  '# LSL flush-lock artefacts (ETM proper-lockfile)',
  '**/.flush.lock',
  '**/.flush.lock.lock/',
  '.DS_Store',
  '# machine-local state, never shared',
  'session-state.json',
  'var/',
];

const EXCLUDE_LINES = [`${CODING_DIR}/`, '.specstory/history'];

// ── process helpers ─────────────────────────────────────────────────────────

/** Default runner: never prompts for credentials, never throws. */
export function defaultRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout ?? 120000,
    cwd: opts.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) },
  });
  return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout || '', stderr: r.stderr || '' };
}

function git(run, cwd, ...args) {
  return run('git', args, { cwd });
}

const noop = () => {};

// ── URLs ────────────────────────────────────────────────────────────────────

/** A local path or file:// URL — a bare repo on disk (tests, NAS mounts). */
export function isLocalRemote(url) {
  return /^file:\/\//.test(url) || path.isAbsolute(url);
}

function localPathOf(url) {
  return url.replace(/^file:\/\//, '');
}

export function urlHost(url) {
  let m = /^[^@/]+@([^:]+):/.exec(url);
  if (m) return m[1];
  m = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/]+)\//i.exec(url);
  return m && !url.startsWith('file:') ? m[1] : '';
}

export function urlSlug(url) {
  const u = url.replace(/\.git$/, '');
  let m = /^[^@/]+@[^:]+:(.+)$/.exec(u);
  if (m) return m[1];
  m = /^[a-z+]+:\/\/(?:[^@/]+@)?[^/]+\/(.+)$/i.exec(u);
  return m && !u.startsWith('file:') ? m[1] : '';
}

// ── registry ────────────────────────────────────────────────────────────────

export function registryPath(opts = {}) {
  return path.join(opts.home || scope.codingHome(opts), '.coding', 'repos.yaml');
}

export function repoKey(projectDir) {
  try { return fs.realpathSync(projectDir); } catch { return path.resolve(projectDir); }
}

export function readRegistry(opts = {}) {
  const file = registryPath(opts);
  if (!fs.existsSync(file)) return { repos: {} };
  const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`${file}: expected a mapping`);
  const repos = doc.repos && typeof doc.repos === 'object' ? doc.repos : {};
  return { ...doc, repos };
}

export function writeRegistry(reg, opts = {}) {
  const file = registryPath(opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = '# coding — where each repo\'s learned data lives (per user).\n'
    + '#   <repo path>: { remote: <url> } | { skip: true }   [team: <name>]\n'
    + '# Written by the launcher; safe to edit by hand.\n';
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, header + yaml.dump({ ...reg, repos: reg.repos }, { lineWidth: 200 }));
  fs.renameSync(tmp, file);
}

/**
 * The registry entry for a repo, or null. A legacy skip marker
 * (`.specstory/.history-repo-skipped`) is migrated into the registry on first
 * read and removed, so "skip" has one home.
 */
export function lookup(projectDir, opts = {}) {
  const key = repoKey(projectDir);
  const reg = readRegistry(opts);
  if (reg.repos[key]) return reg.repos[key];
  const marker = path.join(projectDir, SKIP_MARKER);
  if (fs.existsSync(marker)) {
    record(projectDir, { skip: true }, opts);
    fs.rmSync(marker, { force: true });
    return { skip: true };
  }
  return null;
}

/** Set a repo's entry, keeping fields (e.g. `team`) the caller did not name. */
export function record(projectDir, entry, opts = {}) {
  const key = repoKey(projectDir);
  const reg = readRegistry(opts);
  const prev = reg.repos[key] || {};
  const next = { ...prev, ...entry };
  if (next.skip) delete next.remote;
  if (next.remote) delete next.skip;
  reg.repos[key] = next;
  writeRegistry(reg, opts);
  return next;
}

// ── default remote ──────────────────────────────────────────────────────────

/**
 * The URL to suggest for `<repo>-history`. Never a public host by accident:
 *   1. LSL_HISTORY_REMOTE_TEMPLATE ({project} substituted)
 *   2. https://bmw.ghe.com/<gh user>/<repo>-history.git, user from gh's hosts.yml
 *   3. derived from the outer remote, only when that is itself on bmw.ghe.com
 * Otherwise '' — the user types a URL or skips.
 */
export function defaultRemote(projectDir, opts = {}) {
  const env = opts.env || process.env;
  const run = opts.run || defaultRun;
  const name = path.basename(repoKey(projectDir));
  if (env.LSL_HISTORY_REMOTE_TEMPLATE) return env.LSL_HISTORY_REMOTE_TEMPLATE.replaceAll('{project}', name);

  const hosts = path.join(opts.home || os.homedir(), '.config', 'gh', 'hosts.yml');
  if (fs.existsSync(hosts)) {
    try {
      const doc = yaml.load(fs.readFileSync(hosts, 'utf8')) || {};
      const user = doc['bmw.ghe.com'] && doc['bmw.ghe.com'].user;
      if (user) return `https://bmw.ghe.com/${user}/${name}-history.git`;
    } catch { /* unreadable hosts.yml: fall through */ }
  }
  const outer = git(run, projectDir, 'config', '--get', 'remote.origin.url').stdout.trim();
  if (outer.includes('bmw.ghe.com')) return `${outer.replace(/\.git$/, '')}-history.git`;
  return '';
}

// ── remote state ────────────────────────────────────────────────────────────

/**
 * What is at the far end: 'public' | 'absent' | 'empty' | 'populated' | 'unknown'.
 *
 * gh answers all of it, privacy included, when it is authenticated to the host.
 * Without gh: github.com is asked anonymously (anything an anonymous request
 * can see is public); anything else falls back to `git ls-remote`, which can
 * tell empty from populated but not public from private — 'unknown' when even
 * that fails, since a failed ls-remote may only mean missing credentials.
 */
export function remoteState(url, opts = {}) {
  const run = opts.run || defaultRun;
  if (isLocalRemote(url)) {
    const p = localPathOf(url);
    if (!fs.existsSync(p)) return 'absent';
    const r = run('git', ['ls-remote', p]);
    if (r.code !== 0) return 'absent';
    return r.stdout.trim() ? 'populated' : 'empty';
  }

  const host = urlHost(url);
  const slug = urlSlug(url);
  if (host && slug && run('gh', ['auth', 'status', '--hostname', host]).code === 0) {
    const r = run('gh', ['repo', 'view', slug, '--json', 'isEmpty,isPrivate'], { env: { GH_HOST: host } });
    if (r.code !== 0) return 'absent';
    try {
      const v = JSON.parse(r.stdout);
      if (v.isPrivate === false) return 'public';
      return v.isEmpty ? 'empty' : 'populated';
    } catch { return 'unknown'; }
  }
  if (host === 'github.com' && slug) {
    const r = run('curl', ['-sf', '-o', '/dev/null', '-w', '%{http_code}', `https://api.github.com/repos/${slug}`], { timeout: 15000 });
    if (r.stdout.trim() === '200') return 'public';
  }
  const r = run('git', ['ls-remote', url], { timeout: 30000 });
  if (r.code !== 0) return 'unknown';
  return r.stdout.trim() ? 'populated' : 'empty';
}

/** Create the remote as PRIVATE. Returns true on success. */
export function createRemote(url, opts = {}) {
  const run = opts.run || defaultRun;
  if (isLocalRemote(url)) {
    const p = localPathOf(url);
    fs.mkdirSync(p, { recursive: true });
    return run('git', ['init', '--bare', '-q', '-b', 'main', p]).code === 0;
  }
  const host = urlHost(url);
  const slug = urlSlug(url);
  if (!host || !slug) return false;
  return run('gh', ['repo', 'create', slug, '--private'], { env: { GH_HOST: host } }).code === 0;
}

// ── layout ──────────────────────────────────────────────────────────────────

function isEmptyDir(p) {
  try { return fs.readdirSync(p).length === 0; } catch { return false; }
}

function lstat(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

/** Move every entry of `from` into `to`, never overwriting. Returns leftovers. */
function moveEntries(from, to, log) {
  fs.mkdirSync(to, { recursive: true });
  const left = [];
  for (const name of fs.readdirSync(from)) {
    const dst = path.join(to, name);
    if (lstat(dst)) {
      // Same name on both sides: a directory merges, a file is left for a human.
      const src = path.join(from, name);
      if (lstat(src).isDirectory() && lstat(dst).isDirectory()) {
        left.push(...moveEntries(src, dst, log).map((n) => path.join(name, n)));
        if (isEmptyDir(src)) fs.rmdirSync(src);
      } else {
        left.push(name);
      }
      continue;
    }
    fs.renameSync(path.join(from, name), dst);
  }
  if (left.length) log(`⚠️  left in place (already exists in ${to}): ${left.join(', ')}`);
  return left;
}

/**
 * An older `<repo>-history` repo keeps transcripts at its ROOT (YYYY/, logs/).
 * Move everything that is not layout into history/, and commit that locally
 * when it is a git checkout. Never pushed from here.
 */
export function restructure(dir, opts = {}) {
  const run = opts.run || defaultRun;
  const log = opts.log || noop;
  const moved = [];
  fs.mkdirSync(path.join(dir, 'history'), { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (META.has(name) || name.startsWith('.clone')) continue;
    const dst = path.join(dir, 'history', name);
    if (lstat(dst)) {
      const src = path.join(dir, name);
      if (lstat(src).isDirectory() && lstat(dst).isDirectory()) {
        moveEntries(src, dst, log);
        if (isEmptyDir(src)) fs.rmdirSync(src);
        moved.push(name);
      } else {
        log(`⚠️  ${name} exists in both ${dir} and history/ — left at the root`);
      }
      continue;
    }
    fs.renameSync(path.join(dir, name), dst);
    moved.push(name);
  }
  if (moved.length && fs.existsSync(path.join(dir, '.git'))) {
    git(run, dir, 'add', '-A');
    const c = git(run, dir, 'commit', '-q', '-m', 'Restructure into the .coding layout (transcripts → history/)');
    if (c.code === 0) log(`✅ Restructured ${dir} (moved ${moved.join(', ')} → history/), committed locally — not pushed`);
    else log(`ℹ️  Restructured ${dir}; commit it yourself (${c.stderr.trim().split('\n')[0] || 'nothing to commit'})`);
  }
  return moved;
}

/** Append lines a file lacks; returns whether anything was added. */
function ensureLines(file, lines) {
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const set = new Set(have.split('\n').map((l) => l.trim()));
  const missing = lines.filter((l) => !set.has(l));
  if (!missing.length) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${have && !have.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  return true;
}

/** Make the outer repo ignore `.coding/` and the symlink, without a tracked change. */
export function excludeFromOuter(projectDir, opts = {}) {
  const run = opts.run || defaultRun;
  const r = git(run, projectDir, 'rev-parse', '--git-path', 'info/exclude');
  if (r.code !== 0) return false;
  const file = path.resolve(projectDir, r.stdout.trim());
  return ensureLines(file, ['# coding: per-repo learning data (see lib/history/repo-link.mjs)', ...EXCLUDE_LINES]);
}

/**
 * Bring an existing `.specstory/history` into `.coding/`:
 *   - a nested git checkout (an older `<repo>-history` clone) BECOMES `.coding/`
 *     and is restructured;
 *   - a plain directory's transcripts move into `.coding/history/`.
 * Then the symlink. Re-checked once, because a running ETM can recreate the
 * directory in the instant between the move and the link.
 */
export function migrateLegacy(projectDir, opts = {}) {
  const log = opts.log || noop;
  const link = path.join(projectDir, LEGACY_LINK);
  const dir = path.join(projectDir, CODING_DIR);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const st = lstat(link);
    if (!st || st.isSymbolicLink() || !st.isDirectory()) return;
    const nested = fs.existsSync(path.join(link, '.git'));
    if (nested && !fs.existsSync(path.join(dir, '.git'))) {
      moveEntries(link, dir, log);
      log(`✅ Moved the history checkout ${link} → ${dir}`);
      restructure(dir, opts);
    } else {
      moveEntries(link, path.join(dir, 'history'), log);
      if (attempt === 0) log(`✅ Moved transcripts ${link} → ${path.join(dir, 'history')}`);
    }
    if (!isEmptyDir(link)) return; // leftovers reported by moveEntries; keep the real dir
    fs.rmdirSync(link);
    try {
      fs.symlinkSync(path.join('..', CODING_DIR, 'history'), link);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

/** Skeleton files, the symlink and the outer exclude. Idempotent. */
export function ensureLayout(projectDir, opts = {}) {
  const dir = path.join(projectDir, CODING_DIR);
  const name = path.basename(repoKey(projectDir));
  migrateLegacy(projectDir, opts);
  fs.mkdirSync(path.join(dir, 'history', 'logs', 'classification'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'kb'), { recursive: true });
  ensureLines(path.join(dir, '.gitignore'), GITIGNORE_LINES);
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, `# ${name}-history\n\nWhat \`coding\` learned in **${name}**: session transcripts (\`history/\`)\nand knowledge exports (\`kb/\`). Private — never make this repo public.\nChecked out at \`${name}/.coding/\`.\n`);
  }
  if (fs.existsSync(path.join(dir, 'kb')) && !fs.readdirSync(path.join(dir, 'kb')).length) {
    fs.writeFileSync(path.join(dir, 'kb', '.gitkeep'), '');
  }
  const link = path.join(projectDir, LEGACY_LINK);
  if (!lstat(link)) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join('..', CODING_DIR, 'history'), link);
  }
  excludeFromOuter(projectDir, opts);
  commitSkeleton(dir, opts);
  return dir;
}

/**
 * In a checkout, commit the skeleton files this step adds — those exact paths
 * only, never transcripts — so the layout does not sit there as a dirty tree.
 */
function commitSkeleton(dir, opts = {}) {
  if (!fs.existsSync(path.join(dir, '.git'))) return;
  const run = opts.run || defaultRun;
  const paths = ['.gitignore', 'README.md', 'kb/.gitkeep'].filter((p) => fs.existsSync(path.join(dir, p)));
  // A fresh `git init` has no HEAD yet; its first commit is initAndSeed's.
  if (git(run, dir, 'rev-parse', '-q', '--verify', 'HEAD').code !== 0) return;
  git(run, dir, 'add', '--', ...paths);
  if (git(run, dir, 'diff', '--cached', '--quiet', '--', ...paths).code === 0) return;
  git(run, dir, 'commit', '-q', '-m', 'Add the .coding layout skeleton', '--', ...paths);
}

// ── linking ─────────────────────────────────────────────────────────────────

/**
 * Clone `url` into `dir`, which may already hold files (a session-state.json,
 * a freshly migrated history). Cloned beside it, then the .git moved in and the
 * tracked files checked out; untracked local files are kept.
 *
 * `legacy`: what to do with a transcripts-only repo (YYYY/ at its root) —
 * 'restructure' (per-repo .coding/) or 'nest' (clone it into history/, as the
 * tools repo's data home has always done).
 */
export function cloneInto(dir, url, opts = {}) {
  const run = opts.run || defaultRun;
  const log = opts.log || noop;
  fs.mkdirSync(dir, { recursive: true });
  const staging = fs.mkdtempSync(path.join(dir, '.clone.'));
  try {
    const c = run('git', ['clone', '-q', '--no-checkout', url, path.join(staging, 'repo')], { timeout: 600000 });
    if (c.code !== 0) {
      log(`clone of ${url} failed: ${c.stderr.trim().split('\n').pop() || 'error'}`);
      return false;
    }
    const repo = path.join(staging, 'repo');
    const hasHistory = git(run, repo, 'cat-file', '-e', 'HEAD:history').code === 0;
    if (!hasHistory && opts.legacy === 'nest') {
      const hist = path.join(dir, 'history');
      if (lstat(hist) && !isEmptyDir(hist)) { log(`${hist} is not empty — not cloning into it`); return false; }
      if (lstat(hist)) fs.rmdirSync(hist);
      fs.renameSync(repo, hist);
      git(run, hist, 'reset', '-q', '--hard');
      log(`✅ Cloned ${url} → ${hist} (transcripts-only layout)`);
      return true;
    }
    fs.renameSync(path.join(repo, '.git'), path.join(dir, '.git'));
    // reset --hard writes only TRACKED paths: the clone's version of a file
    // wins over a local one of the same name (a data home's generated
    // .gitignore), while untracked local files — var/, session-state.json,
    // freshly migrated transcripts — are left exactly as they are.
    git(run, dir, 'reset', '-q', '--hard');
    log(`✅ Cloned ${url} → ${dir}`);
    if (!hasHistory && opts.legacy !== 'nest') restructure(dir, opts);
    return true;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** First commit of a fresh checkout; pushes it only while it is the bare skeleton. */
function initAndSeed(dir, url, opts) {
  const run = opts.run || defaultRun;
  const log = opts.log || noop;
  git(run, dir, 'init', '-q', '-b', 'main');
  if (url) git(run, dir, 'remote', 'add', 'origin', url);
  git(run, dir, 'add', '-A');
  const transcripts = git(run, dir, 'diff', '--cached', '--name-only').stdout
    .split('\n').filter((f) => f.startsWith('history/') && !f.startsWith('history/logs/') && /\.(md|jsonl)$/.test(f));
  const c = git(run, dir, 'commit', '-q', '-m', `Initial ${path.basename(path.dirname(dir))}-history layout`);
  if (c.code !== 0) log(`ℹ️  initial commit failed: ${c.stderr.trim().split('\n')[0]}`);
  if (!url) return 'local';
  if (transcripts.length) {
    log(`ℹ️  ${transcripts.length} existing transcript(s) committed locally, NOT pushed.`);
    log(`    Publish them when ready: git -C ${dir} push -u origin main`);
    return 'seeded-local';
  }
  if (git(run, dir, 'push', '-q', '-u', 'origin', 'main').code === 0) {
    log(`✅ Pushed the initial layout to ${url}`);
    return 'seeded';
  }
  log(`ℹ️  Could not push to ${url} yet: git -C ${dir} push -u origin main`);
  return 'seeded-local';
}

/**
 * Back `<repo>/.coding/` with `url`. Returns {ok, state, action}.
 * Writes no registry entry — `ensure()` does that.
 */
export function linkRemote(projectDir, url, opts = {}) {
  const run = opts.run || defaultRun;
  const log = opts.log || noop;
  const dir = path.join(projectDir, CODING_DIR);

  if (fs.existsSync(path.join(dir, '.git'))) {
    const origin = git(run, dir, 'remote', 'get-url', 'origin');
    if (origin.code !== 0) git(run, dir, 'remote', 'add', 'origin', url);
    return { ok: true, state: 'checkout', action: 'existing' };
  }

  let state = remoteState(url, { run });
  if (state === 'public') {
    log(`❌ ${url} is PUBLIC — refusing to keep session transcripts there.`);
    return { ok: false, state, action: 'refused' };
  }
  if (state === 'absent') {
    if (opts.create !== false && createRemote(url, { run })) {
      log(`✅ Created PRIVATE repo ${url}`);
      state = 'empty';
    } else {
      log(`ℹ️  ${url} does not exist and could not be created — local-only until it does.`);
      if (!isLocalRemote(url)) log(`    Create it: gh repo create ${urlSlug(url)} --private (GH_HOST=${urlHost(url)})`);
    }
  }
  if ((state === 'populated' || state === 'unknown') && cloneInto(dir, url, { ...opts, legacy: 'restructure' })) {
    return { ok: true, state, action: 'cloned' };
  }
  ensureLayout(projectDir, opts);
  const action = initAndSeed(dir, url, { run, log });
  return { ok: true, state, action };
}

// ── the launch flow ─────────────────────────────────────────────────────────

async function promptTty(question) {
  let input = process.stdin;
  let close = noop;
  if (!process.stdin.isTTY) {
    try {
      input = fs.createReadStream('/dev/tty');
      close = () => input.destroy();
    } catch { return null; }
  }
  const rl = readline.createInterface({ input, output: process.stderr });
  try {
    return await new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
  } finally {
    rl.close();
    close();
  }
}

/**
 * Make sure `<projectDir>/.coding/` exists and is what the user chose.
 *
 * opts.auto      'yes' | 'no' | undefined   (LSL_HISTORY_AUTO)
 * opts.ask       async (question) => answer | null   (null = cannot ask)
 * opts.log, opts.run, opts.home, opts.toolsRepo — for tests
 *
 * Returns {action, ...}.
 */
export async function ensure(projectDir, opts = {}) {
  const run = opts.run || defaultRun;
  const log = opts.log || noop;
  const env = opts.env || process.env;
  const auto = opts.auto ?? env.LSL_HISTORY_AUTO;

  // The tools repo's own history lives in the data home (bin/init-history.sh),
  // and its .coding/ is the per-launch runtime dir.
  if (scope.isToolsRepo(projectDir, { toolsRepo: opts.toolsRepo })) return { action: 'tools-repo' };
  if (git(run, projectDir, 'rev-parse', '--git-dir').code !== 0) return { action: 'not-a-repo' };

  // Transcripts already committed to the outer repo: the state most worth
  // fixing, and never silenced by a skip.
  const tracked = git(run, projectDir, 'ls-files', '.specstory/history').stdout.trim();
  if (tracked) {
    const n = tracked.split('\n').length;
    log(`⚠️  The outer repo tracks ${n} file(s) under .specstory/history/ — session transcripts are committed to it.`);
    log(`    Refusing to set up .coding/ over them. Migrate: ${path.join(scope.toolsRepo({ toolsRepo: opts.toolsRepo }), 'scripts', 'migrate-history-to-private.sh')} ${projectDir}`);
    return { action: 'tracked-history' };
  }

  const dir = path.join(projectDir, CODING_DIR);
  const legacyNested = (() => {
    const st = lstat(path.join(projectDir, LEGACY_LINK));
    return st && st.isDirectory() && !st.isSymbolicLink() && fs.existsSync(path.join(projectDir, LEGACY_LINK, '.git'));
  })();

  let entry = lookup(projectDir, opts);

  // An existing checkout (an older nested history repo, or a .coding/ from
  // another machine's setup) already answers the question.
  if (!entry && (legacyNested || fs.existsSync(path.join(dir, '.git')))) {
    ensureLayout(projectDir, { run, log });
    const origin = git(run, dir, 'remote', 'get-url', 'origin').stdout.trim();
    entry = record(projectDir, origin ? { remote: origin } : { skip: true }, opts);
    return { action: 'migrated', entry };
  }

  if (entry && entry.skip) {
    ensureLayout(projectDir, { run, log });
    return { action: 'skip', entry };
  }
  if (entry && entry.remote) {
    if (legacyNested) ensureLayout(projectDir, { run, log });
    const r = fs.existsSync(path.join(dir, '.git'))
      ? { ok: true, action: 'existing' }
      : linkRemote(projectDir, entry.remote, { run, log, create: opts.create });
    ensureLayout(projectDir, { run, log });
    return { action: r.action, entry };
  }

  // First time here: decide.
  const name = path.basename(repoKey(projectDir));
  const suggested = defaultRemote(projectDir, { env, run, home: opts.ghHome });
  let answer;
  if (auto === 'no') answer = 'skip';
  else if (auto === 'yes') answer = suggested || 'skip';
  else if (opts.ask) {
    log('');
    log(`🔐 Where should what coding learns in ${name} be kept?`);
    log(`   A private ${name}-history repo, checked out at ${name}/.coding/.`);
    log('   An existing repo (e.g. a teammate\'s) is cloned and shared.');
    answer = await opts.ask(`   Remote URL [Enter=${suggested || 'skip'}, a URL, or 'skip']: `);
    if (answer === null) answer = undefined;
    else if (answer === '') answer = suggested || 'skip';
  }

  if (answer === undefined) {
    // Cannot ask: keep the transcripts out of the outer repo, decide next time.
    ensureLayout(projectDir, { run, log });
    log(`ℹ️  ${name}: no learning repo chosen (non-interactive). Set LSL_HISTORY_AUTO=yes|no, or launch interactively.`);
    return { action: 'undecided' };
  }
  if (/^(skip|no|n)$/i.test(answer)) {
    ensureLayout(projectDir, { run, log });
    return { action: 'skip', entry: record(projectDir, { skip: true }, opts) };
  }

  const r = linkRemote(projectDir, answer, { run, log, create: opts.create });
  ensureLayout(projectDir, { run, log });
  if (!r.ok) return { action: r.action, state: r.state };
  return { action: r.action, state: r.state, entry: record(projectDir, { remote: answer }, opts) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(argv) {
  const [cmd, ...rest] = argv;
  const log = (m) => process.stderr.write(`[history] ${m}\n`);
  if (cmd === 'ensure' && rest[0]) {
    const interactive = process.stdout.isTTY || process.stdin.isTTY;
    const r = await ensure(path.resolve(rest[0]), {
      log,
      ask: interactive ? promptTty : undefined,
    });
    process.stdout.write(`${JSON.stringify(r)}\n`);
    return 0;
  }
  if (cmd === 'clone' && rest.length >= 2) {
    // clone <dir> <url> [--nest]: used by bin/init-history.sh for the data home.
    const ok = cloneInto(path.resolve(rest[0]), rest[1], { log, legacy: rest.includes('--nest') ? 'nest' : 'restructure' });
    return ok ? 0 : 1;
  }
  if (cmd === 'state' && rest[0]) {
    process.stdout.write(`${remoteState(rest[0])}\n`);
    return 0;
  }
  process.stderr.write('usage: repo-link.mjs ensure <dir> | clone <dir> <url> [--nest] | state <url>\n');
  return 2;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    process.stderr.write(`[history] ${err.stack || err.message}\n`);
    // Never break an agent launch over this.
    process.exit(0);
  });
}
