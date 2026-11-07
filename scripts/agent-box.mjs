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
import { guardHome, guardPaths, guardPort, exposesGuardHome } from '../lib/guard/home.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const IMAGE = 'coding-agent-box:latest';
export const HOME_VOLUME = 'coding-box-home';
export const BOX_HOME = '/home/agent';
/** The guard's PUBLIC key directory inside the box (verifies grants, Phase 1 item 4). */
export const BOX_GUARD_KEYS = '/etc/coding-guard';
export const AGENT_COMMANDS = { claude: 'claude', copilot: 'copilot', opencode: 'opencode', pi: 'pi' };

const GUARD_SUBMODULE = 'integrations/constraint-monitor';
const RULES = 'config/constraints/constraint-monitor.yaml';
const BOX_DIR = 'docker/agent-box';

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
 * superproject pins, the committed rules blob, and the committed box files.
 * Working-tree edits never count.
 */
export function guardSource(repo = REPO) {
  const submodule = git(['rev-parse', `HEAD:${GUARD_SUBMODULE}`], repo);
  const rules = git(['rev-parse', `HEAD:${RULES}`], repo);
  const box = git(['rev-parse', `HEAD:${BOX_DIR}`], repo);
  const digest = createHash('sha256').update(`${submodule}|${rules}|${box}`).digest('hex').slice(0, 16);
  return { submodule, rules, box, digest };
}

/** Uncommitted guard changes — they are NOT in the image, so say so. */
function uncommittedGuardChanges(repo = REPO) {
  const out = git(['status', '--porcelain', '--', GUARD_SUBMODULE, RULES, BOX_DIR], repo);
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

  for (const name of ['Dockerfile', 'managed-settings.json', 'entrypoint.sh']) {
    fs.writeFileSync(path.join(dir, name), execFileSync('git', ['show', `HEAD:${BOX_DIR}/${name}`], { cwd: repo }));
  }
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
  guardDir = guardHome(env, home), guardPortNum = guardPort(env),
}) {
  const command = AGENT_COMMANDS[agent];
  if (!command) throw new Error(`unknown agent '${agent}' (one of: ${Object.keys(AGENT_COMMANDS).join(', ')})`);

  const workspace = env.TARGET_PROJECT_DIR || cwd;
  const argv = ['run', '--rm', '-i'];
  if (tty) argv.push('-t');
  argv.push('--name', name, '--label', 'coding.box=1', '--label', `coding.box.agent=${agent}`);
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

  argv.push('-v', `${HOME_VOLUME}:${BOX_HOME}`);
  // Claude transcripts on the host's disk, where session logging reads them.
  const projects = path.join(home, '.claude', 'projects');
  argv.push('-v', `${projects}:${BOX_HOME}/.claude/projects`);
  for (const [target, [host, mode]] of mounts) argv.push('-v', `${host}:${target}${mode === 'ro' ? ':ro' : ''}`);
  // The directory, not the file: single-file bind mounts go stale on VirtioFS.
  const publicDir = guardPaths(guardDir).publicDir;
  if (exists(publicDir)) argv.push('-v', `${publicDir}:${BOX_GUARD_KEYS}:ro`);

  argv.push('-w', boxPath(cwd, platform), image, command, ...args);
  return argv;
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

function run(agent, args) {
  const built = imageDigest();
  if (!built) {
    process.stderr.write(`agent-box: no ${IMAGE} image — run: coding box build\n`);
    return 1;
  }
  const current = guardSource().digest;
  if (built !== current) {
    process.stderr.write(`agent-box: WARNING the box runs guard ${built}; the committed guard is ${current}. Run: coding box build\n`);
  }
  const argv = boxRunArgs({
    agent, args,
    uid: process.getuid?.(), gid: process.getgid?.(),
    tty: Boolean(process.stdin.isTTY),
  });
  const res = spawnSync('docker', argv, { stdio: 'inherit' });
  return res.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  let code;
  if (cmd === 'build') code = build();
  else if (cmd === 'status') code = status();
  else if (cmd === 'run') {
    const [agent, ...more] = rest;
    code = run(agent, more[0] === '--' ? more.slice(1) : more);
  } else {
    process.stderr.write('usage: agent-box.mjs build | status | run <claude|copilot|opencode|pi> [-- args…]\n');
    code = 64;
  }
  process.exit(code);
}
