#!/usr/bin/env node
/**
 * coding agent box — build the box image and run an agent inside it.
 *
 *   node scripts/agent-box.mjs build             bake the COMMITTED guard + rules into the image
 *   node scripts/agent-box.mjs status            image present? built from the current guard?
 *   node scripts/agent-box.mjs run <agent> [-- args…]
 *
 * `bin/coding box …` and `coding --<agent> --box` call this. Node, not bash, so
 * the same code runs on macOS, Linux, WSL and native Windows.
 *
 * Trust: the image is built only by the user, on the host, from what is
 * COMMITTED (the superproject's pinned constraint-monitor SHA and the
 * committed rules). Inside the box the agent has no Docker socket and the
 * guard is root-owned, so nothing it edits in the mounted repo reaches the
 * guard it runs under; `run` warns when the image is older than the
 * committed guard but never rebuilds on its own.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 1, item 1).
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ROUTING_ENV_VARS } from '../lib/agents/proxy-routing.mjs';
import { guardHome, guardPaths, guardPort, exposesGuardHome, readToken } from '../lib/guard/home.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const IMAGE = 'coding-agent-box:latest';
export const HOME_VOLUME = 'coding-box-home';
export const BOX_HOME = '/home/agent';
/** The guard's PUBLIC key directory inside the box (verifies grants, Phase 1 item 4). */
export const BOX_GUARD_KEYS = '/etc/coding-guard';
export const AGENT_COMMANDS = { claude: 'claude', copilot: 'copilot', opencode: 'opencode', pi: 'pi' };

/**
 * How each agent loads its guard (docker/agent-box/agents/), fixed on the
 * command line the agent cannot change. claude: the managed policy in
 * /etc/claude-code; opencode: its managed config in /etc/opencode — neither
 * needs an argument.
 */
export const AGENT_GUARD_ARGS = {
  copilot: ['--plugin-dir', '/opt/coding-guard/agents/copilot'],
  pi: ['-e', '/opt/coding-guard/agents/pi/guard.js'],
};

/**
 * Copilot reads repository settings that can switch every hook off
 * (`disableAllHooks`, in a folder the user trusted — and trust is stored in
 * a file the agent can write). The box mounts these directories read-only in
 * every directory from the workspace down to the cwd (any of them can become
 * the repository root). `.github` itself is re-mounted read-write so it cannot
 * be renamed away from under the read-only `.github/copilot`; a top-level
 * mount point cannot be renamed.
 */
export const COPILOT_CONFIG_DIRS = ['.github/copilot', '.claude'];
const COPILOT_SETTINGS = ['settings.json', 'settings.local.json'];

const GUARD_SUBMODULE = 'integrations/constraint-monitor';
const RULES = 'config/constraints/constraint-monitor.yaml';
const BOX_DIR = 'docker/agent-box';
/** The grant verifier the in-box hook imports (node:crypto only). */
const GRANTS_LIB = 'lib/guard/grants.mjs';

/** Env passed into the box besides the routing set: terminal, locale, egress proxy. */
const EXTRA_ENV = ['TERM', 'COLORTERM', 'LANG', 'LC_ALL', 'TASK_ID', 'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'];

/** Routing vars that name a host directory the agent must see at the same path. */
const PATH_ENV = ['PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR'];

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Where a host path appears inside the box. POSIX paths keep their exact path —
 * Claude names its transcript folder after the cwd, so the host's session
 * logging finds box transcripts where it expects them. A Windows path has no
 * POSIX equivalent and lands under /host/<drive>/….
 */
export function boxPath(hostPath, platform = process.platform) {
  if (platform !== 'win32') return hostPath;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(hostPath);
  if (!m) return hostPath.replace(/\\/g, '/');
  return `/host/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

/** localhost in a URL on the host is host.docker.internal from inside the box. */
export function toBoxUrl(value) {
  return value.replace(/\b(localhost|127\.0\.0\.1)\b|\[::1\]/g, 'host.docker.internal');
}

/**
 * Identity of the guard a build would bake in: the constraint-monitor SHA the
 * superproject pins, the committed rules blob, the committed box files and the
 * committed grant verifier. Working-tree edits never count.
 */
export function guardSource(repo = REPO) {
  const submodule = git(['rev-parse', `HEAD:${GUARD_SUBMODULE}`], repo);
  const rules = git(['rev-parse', `HEAD:${RULES}`], repo);
  const box = git(['rev-parse', `HEAD:${BOX_DIR}`], repo);
  const grants = git(['rev-parse', `HEAD:${GRANTS_LIB}`], repo);
  const digest = createHash('sha256').update(`${submodule}|${rules}|${box}|${grants}`).digest('hex').slice(0, 16);
  return { submodule, rules, box, grants, digest };
}

/** Uncommitted guard changes — they are NOT in the image, so say so. */
function uncommittedGuardChanges(repo = REPO) {
  const out = git(['status', '--porcelain', '--', GUARD_SUBMODULE, RULES, BOX_DIR, GRANTS_LIB], repo);
  return out ? out.split('\n') : [];
}

/** Write the docker build context (committed content only) into `dir`. */
export function stageContext(dir, src = guardSource(), repo = REPO) {
  const guardDir = path.join(dir, 'guard', GUARD_SUBMODULE);
  fs.mkdirSync(guardDir, { recursive: true });
  const tar = execFileSync('git', ['-C', path.join(repo, GUARD_SUBMODULE), 'archive', '--format=tar', src.submodule],
    { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', guardDir], { input: tar });

  const rulesOut = path.join(dir, 'guard', RULES);
  fs.mkdirSync(path.dirname(rulesOut), { recursive: true });
  fs.writeFileSync(rulesOut, execFileSync('git', ['cat-file', 'blob', src.rules], { cwd: repo }));

  // Same relative place as in the repo: the hook finds it at ../../../../lib/guard.
  const grantsOut = path.join(dir, 'guard', GRANTS_LIB);
  fs.mkdirSync(path.dirname(grantsOut), { recursive: true });
  fs.writeFileSync(grantsOut, execFileSync('git', ['cat-file', 'blob', src.grants], { cwd: repo }));

  // The box files as committed: Dockerfile, policy, entrypoint, agents/.
  const boxTar = execFileSync('git', ['archive', '--format=tar', `${src.box}`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: boxTar });
}

/** The digest label of the built image, or null when there is no image. */
export function imageDigest(image = IMAGE) {
  const res = spawnSync('docker', ['image', 'inspect', image, '--format', '{{index .Config.Labels "coding.guard.digest"}}'],
    { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() || null : null;
}

/**
 * The full `docker run` argv for one agent session. Pure: everything it needs
 * comes in through the argument, so tests can pin it per platform.
 */
export function boxRunArgs({
  agent, args = [], env = process.env, cwd = process.cwd(), codingRepo = REPO,
  home = os.homedir(), platform = process.platform, uid, gid, tty = false,
  image = IMAGE, name = `coding-box-${agent}-${process.pid}`, exists = fs.existsSync,
  guardDir = guardHome(env, home), guardPortNum = guardPort(env), boxToken = null,
}) {
  const command = AGENT_COMMANDS[agent];
  if (!command) throw new Error(`unknown agent '${agent}' (one of: ${Object.keys(AGENT_COMMANDS).join(', ')})`);

  const workspace = env.TARGET_PROJECT_DIR || cwd;
  const argv = ['run', '--rm', '-i'];
  const protectedDirs = agent === 'copilot' ? configRoots(workspace, cwd) : [];
  if (tty) argv.push('-t');
  // The hostname IS the guard session: grants are bound to it, and a non-root
  // process cannot change it (an env var could be set by a nested agent).
  argv.push('--name', name, '--hostname', name, '--label', 'coding.box=1', '--label', `coding.box.agent=${agent}`);
  argv.push('-e', `CODING_BOX_UID=${uid ?? 1000}`, '-e', `CODING_BOX_GID=${gid ?? 1000}`, '-e', 'CODING_BOX=1');
  if (platform === 'linux') argv.push('--add-host', 'host.docker.internal:host-gateway');

  const mounts = new Map(); // box path → [host path, mode]
  const mount = (host, mode = 'rw') => {
    // The guard's signing key and approver token must never be visible in the box.
    if (exposesGuardHome(host, guardDir)) {
      throw new Error(`refusing to mount ${host}: it contains the guard's keys (${guardDir})`);
    }
    const target = boxPath(host, platform);
    if (!mounts.has(target)) mounts.set(target, [host, mode]);
  };
  mount(workspace, 'rw');
  for (const dir of protectedDirs) {
    mount(path.join(dir, '.github'), 'rw');
    for (const sub of COPILOT_CONFIG_DIRS) mount(path.join(dir, sub), 'ro');
  }
  const insideWorkspace = (p) => path.relative(workspace, p) === '' || !path.relative(workspace, p).startsWith('..');
  if (!insideWorkspace(codingRepo)) mount(codingRepo, 'ro'); // opencode plugins, pi extensions

  for (const key of [...ROUTING_ENV_VARS, ...EXTRA_ENV]) {
    const value = env[key];
    if (value === undefined || value === '') continue;
    let boxed = value;
    if (/^no_proxy$/i.test(key)) {
      boxed = `${value},host.docker.internal`;
    } else if (key === 'NODE_EXTRA_CA_CERTS') {
      if (exists(value)) mount(value, 'ro');
      boxed = boxPath(value, platform);
    } else if (PATH_ENV.includes(key)) {
      if (exists(value)) mount(value, 'rw');
      boxed = boxPath(value, platform);
    } else {
      boxed = toBoxUrl(value);
    }
    argv.push('-e', `${key}=${boxed}`);
  }

  // Host guard (scripts/coding-guard-daemon.mjs): where to ask, and who is asking.
  argv.push('-e', `CODING_GUARD_URL=http://host.docker.internal:${guardPortNum}`, '-e', `CODING_GUARD_SESSION=${name}`);
  // Binds `coding svc` to THIS box's session (registerBox); the agent may read it — it is only this box's.
  if (boxToken) argv.push('-e', `CODING_GUARD_BOX_TOKEN=${boxToken}`);

  argv.push('-v', `${HOME_VOLUME}:${BOX_HOME}`);
  // Claude transcripts on the host's disk, where session logging reads them.
  const projects = path.join(home, '.claude', 'projects');
  argv.push('-v', `${projects}:${BOX_HOME}/.claude/projects`);
  for (const [target, [host, mode]] of mounts) argv.push('-v', `${host}:${target}${mode === 'ro' ? ':ro' : ''}`);
  // The directory, not the file: single-file bind mounts go stale on VirtioFS.
  const publicDir = guardPaths(guardDir).publicDir;
  if (exists(publicDir)) argv.push('-v', `${publicDir}:${BOX_GUARD_KEYS}:ro`);

  argv.push('-w', boxPath(cwd, platform), image, command, ...(AGENT_GUARD_ARGS[agent] ?? []), ...args);
  return argv;
}

/**
 * Provider config an agent needs inside the box, as files to place in the
 * box home — generated COPIES with loopback URLs pointed at the host, never
 * mounts: `~/.pi/agent` mounted writable would let the box plant an extension
 * the HOST pi then loads. Returns [{ path (relative to the box home), content }];
 * a source that does not exist is skipped.
 */
export function boxAgentConfig(agent, { home = os.homedir(), readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const sources = {
    opencode: ['.config/opencode/opencode.json'],
    pi: ['.pi/agent/models.json', '.pi/agent/settings.json'],
  }[agent] ?? [];
  const files = [];
  for (const rel of sources) {
    let text;
    try { text = readFile(path.join(home, rel)); } catch { continue; }
    files.push({ path: rel, content: toBoxUrl(text) });
  }
  return files;
}

/** The workspace and every directory below it down to `cwd`. */
export function configRoots(workspace, cwd) {
  const rel = path.relative(workspace, cwd);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return [workspace];
  const roots = [workspace];
  let dir = workspace;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    dir = path.join(dir, part);
    roots.push(dir);
  }
  return roots;
}

/**
 * Before a copilot box starts: refuse when a repository settings file already
 * disables hooks (the guard would never run), and create the directories the
 * read-only mounts need — empty directories, which git does not track.
 */
export function prepareCopilotConfig(workspace, cwd, fsImpl = fs) {
  const roots = configRoots(workspace, cwd);
  for (const dir of roots) {
    for (const sub of COPILOT_CONFIG_DIRS) {
      for (const name of COPILOT_SETTINGS) {
        const file = path.join(dir, sub, name);
        let text;
        try { text = fsImpl.readFileSync(file, 'utf8'); } catch { continue; }
        if (/"disable(All)?Hooks"\s*:\s*true|"disabledHooks"\s*:\s*\[\s*"/.test(text)) {
          throw new Error(`${file} disables Copilot hooks, so the guard would not run. Remove that setting, or run copilot outside the box (--no-box).`);
        }
      }
      fsImpl.mkdirSync(path.join(dir, sub), { recursive: true });
    }
  }
  return roots;
}

function build() {
  const changes = uncommittedGuardChanges();
  if (changes.length) {
    process.stderr.write(`agent-box: uncommitted guard changes are NOT built in (commit them first):\n  ${changes.join('\n  ')}\n`);
  }
  const src = guardSource();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-agent-box-'));
  try {
    stageContext(dir, src);
    process.stderr.write(`agent-box: building ${IMAGE} (guard ${src.digest}: constraint-monitor ${src.submodule.slice(0, 9)}, rules ${src.rules.slice(0, 9)})\n`);
    const res = spawnSync('docker', ['build', '-t', IMAGE,
      '--label', `coding.guard.digest=${src.digest}`,
      '--label', `coding.guard.submodule=${src.submodule}`,
      '--label', `coding.guard.rules=${src.rules}`,
      dir], { stdio: 'inherit' });
    return res.status ?? 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function status() {
  const built = imageDigest();
  const current = guardSource().digest;
  if (!built) {
    process.stdout.write(`no image — run: coding box build\n`);
    return 1;
  }
  process.stdout.write(built === current
    ? `${IMAGE} up to date (guard ${built})\n`
    : `${IMAGE} STALE: built from guard ${built}, committed guard is ${current} — run: coding box build\n`);
  return built === current ? 0 : 2;
}

/**
 * Register a box with the host guard (approver token, host-only) and get the
 * token that binds its `coding svc` calls to `session`; release it on exit.
 * No guard running → null, and the box starts without `coding svc`.
 */
export async function registerBox(session, { env = process.env, release = false } = {}) {
  try {
    const res = await fetch(`http://127.0.0.1:${guardPort(env)}/boxes${release ? '/release' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${readToken(guardPaths(guardHome(env)))}` },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return release ? true : (await res.json()).token ?? null;
  } catch {
    return null;
  }
}

async function run(agent, args) {
  const built = imageDigest();
  if (!built) {
    process.stderr.write(`agent-box: no ${IMAGE} image — run: coding box build\n`);
    return 1;
  }
  const current = guardSource().digest;
  if (built !== current) {
    process.stderr.write(`agent-box: WARNING the box runs guard ${built}; the committed guard is ${current}. Run: coding box build\n`);
  }
  if (agent === 'copilot') {
    try {
      prepareCopilotConfig(process.env.TARGET_PROJECT_DIR || process.cwd(), process.cwd());
    } catch (err) {
      process.stderr.write(`agent-box: ${err.message}\n`);
      return 1;
    }
  }
  const name = `coding-box-${agent}-${process.pid}`;
  const boxToken = await registerBox(name);
  if (!boxToken) process.stderr.write('agent-box: the host guard did not register this box — `coding svc` will be refused inside it\n');
  const argv = boxRunArgs({
    agent, args, name, boxToken,
    uid: process.getuid?.(), gid: process.getgid?.(),
    tty: Boolean(process.stdin.isTTY),
  });
  const res = spawnSync('docker', argv, { stdio: 'inherit' });
  if (boxToken) await registerBox(name, { release: true });
  return res.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  let code;
  if (cmd === 'build') code = build();
  else if (cmd === 'status') code = status();
  else if (cmd === 'redteam') {
    code = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'redteam-box.mjs'), ...rest], { stdio: 'inherit' }).status ?? 1;
  }
  else if (cmd === 'run') {
    const [agent, ...more] = rest;
    code = await run(agent, more[0] === '--' ? more.slice(1) : more);
  } else {
    process.stderr.write('usage: agent-box.mjs build | status | redteam [options] | run <claude|copilot|opencode|pi> [-- args…]\n');
    code = 64;
  }
  process.exit(code);
}
