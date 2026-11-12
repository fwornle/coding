/**
 * glass update — install the latest release over this one: the release tarball
 * through the GitHub CLI (the repository is private to the enterprise host, so an
 * anonymous download is refused), then `npm install -g` of it, the same two steps
 * the README gives by hand.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { runGh, ghEnvIn } from './copilot-quota.mjs';
import { PKG_ROOT } from './home.mjs';

export const RELEASE_REPO = 'bmw.ghe.com/AIMAAD/glass';

const parse = (v) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(v || '')?.slice(1, 4).map(Number) || null;

/** Whether release `a` is newer than `b` (x.y.z, an optional leading v). */
export function newer(a, b) {
  const x = parse(a); const y = parse(b);
  if (!x || !y) return false;
  return (x[0] - y[0] || x[1] - y[1] || x[2] - y[2]) > 0;
}

/** spawnSync with output captured; npm is a .cmd on Windows, which needs a shell. */
export function run(cmd, args) {
  const win = process.platform === 'win32';
  if (win && cmd === 'npm') return spawnSync('npm.cmd', args.map((a) => `"${a}"`), { encoding: 'utf8', shell: true });
  return spawnSync(cmd, args, { encoding: 'utf8' });
}

const manual = (repo) => `download glass-<version>.tgz from https://${repo}/releases/latest, then: npm install -g ./glass-<version>.tgz`;

// gh's wording when the request never got an answer from the host: a proxy or
// gateway error, DNS, a refused or timed-out connection. A login would not help.
const NETWORK = /\b(Bad Gateway|Service Unavailable|Gateway Time-?out|HTTP 50[234])\b|could not resolve|no such host|dial tcp|i\/o timeout|connection (refused|reset)|TLS handshake|proxyconnect/i;

/** What to try when `gh release view` failed, from what gh said. */
export function viewFailureHint(stderr, host, env = process.env) {
  if (NETWORK.test(stderr)) {
    const proxy = env.HTTPS_PROXY || env.https_proxy;
    return `  a network or proxy problem, not the login — can this machine reach https://${host}?`
      + (proxy ? ` (requests go through HTTPS_PROXY=${proxy}; is it up?)` : '')
      + ` gh auth status --hostname ${host} shows whether the login itself is fine`;
  }
  return `  logged in? gh auth login --hostname ${host}`;
}

/**
 * @param {object} o
 * @param {string} o.version                      the running glass
 * @param {(line: string) => void} o.out
 * @param {(line: string) => void} o.err
 * @param {(latest: string) => Promise<void>} [o.afterInstall]  replace the daemon
 * @param {boolean} [o.check]                     report only, install nothing
 * @returns {Promise<number>} exit code
 */
export async function update({
  version, out, err, afterInstall = async () => {}, check = false,
  repo = RELEASE_REPO, exec = run, tmpRoot = os.tmpdir(), retryMs = 2000,
}) {
  const host = repo.split('/')[0];
  const view = exec('gh', ['release', 'view', '--repo', repo, '--json', 'tagName', '-q', '.tagName']);
  if (view.error?.code === 'ENOENT') {
    err(`glass update needs the GitHub CLI (gh). Without it, ${manual(repo)}`);
    return 1;
  }
  if (view.status !== 0) {
    err(`glass: could not read the latest release of ${repo}: ${(view.stderr || '').trim()}`);
    err(viewFailureHint(view.stderr || '', host));
    return 1;
  }
  const latest = view.stdout.trim().replace(/^v/, '');
  if (!newer(latest, version)) {
    out(`glass ${version} is the latest release`);
    return 0;
  }
  if (check) {
    out(`glass ${latest} is available (this is ${version}) — glass update installs it`);
    return 0;
  }

  const dir = fs.mkdtempSync(path.join(tmpRoot, 'glass-update-'));
  try {
    // The release host answers an asset download with a passing 500 now and then.
    let dl;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, retryMs));
      dl = exec('gh', ['release', 'download', `v${latest}`, '--repo', repo, '--pattern', 'glass-*.tgz', '--dir', dir, '--clobber']);
      if (dl.status === 0) break;
    }
    const tgz = fs.readdirSync(dir).find((f) => /^glass-.*\.tgz$/.test(f));
    if (dl.status !== 0 || !tgz) {
      err(`glass: download of v${latest} failed: ${(dl.stderr || '').trim()}`);
      err(`  ${manual(repo)}`);
      return 1;
    }
    out(`installing glass ${latest} (this is ${version})…`);
    const inst = exec('npm', ['install', '-g', path.join(dir, tgz)]);
    if (inst.status !== 0) {
      err(`glass: npm install -g failed:\n${inst.stdout || ''}${inst.stderr || ''}`);
      return 1;
    }
    out(`installed glass ${latest}`);
    await afterInstall(latest);
    return 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** How often the daemon asks for the latest release. */
export const UPDATE_CHECK_MS = 6 * 3_600_000;
const OUTPUT_TAIL_BYTES = 4096;

function tail(file) {
  try {
    const buf = fs.readFileSync(file);
    return buf.subarray(Math.max(0, buf.length - OUTPUT_TAIL_BYTES)).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * `glass update` as a detached process, its output in `logFile`. Detached: when it
 * replaces the daemon that started it, it must outlive that daemon.
 */
export function launchUpdate({ logFile, env, onExit }) {
  const fd = fs.openSync(logFile, 'w', 0o600);
  try {
    // --restart: the UI that asked needs a daemon to come back to, sessions or not.
    const child = spawn(process.execPath, [path.join(PKG_ROOT, 'bin', 'glass.mjs'), 'update', '--restart'], {
      detached: true, stdio: ['ignore', fd, fd], env, windowsHide: true,
    });
    child.on('error', (e) => { fs.appendFileSync(logFile, `glass: could not start glass update: ${e.message}\n`); onExit(1); });
    child.on('exit', (code) => onExit(code ?? 1));
    child.unref();
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The daemon's watch on new releases: the latest tag through gh (its own login,
 * the agents' egress), at most every UPDATE_CHECK_MS, and `glass update` started
 * on request from the UI or the status line. No gh, no login, no network: the
 * view says so and nothing is offered. ~/.glass/config.json { "updateCheck": false }
 * stops the check.
 *
 * @param {{ version: string, dir: string, config?: object, env?: () => object, repo?: string,
 *           run?: typeof runGh, launch?: typeof launchUpdate, now?: () => number, log?: Function }} deps
 */
export function createUpdateCheck({
  version, dir, config = {}, env = () => process.env, repo = RELEASE_REPO,
  run = runGh, launch = launchUpdate, now = Date.now, log = () => {},
}) {
  const enabled = config.updateCheck !== false;
  const state = { latest: null, checkedAt: 0, error: null };
  let install = null;
  let pending = null;

  /** The newer release, or null. */
  const available = () => (state.latest && newer(state.latest, version) ? state.latest : null);

  async function refresh({ force = false } = {}) {
    if (!enabled) return view();
    if (!pending && (force || !state.checkedAt || now() - state.checkedAt >= UPDATE_CHECK_MS)) {
      pending = (async () => {
        const r = await run(['release', 'view', '--repo', repo, '--json', 'tagName', '-q', '.tagName'], ghEnvIn(path.join(dir, 'gh'), env()));
        state.checkedAt = now();
        if (!r.ok) { state.error = r.error; return; }
        const before = available();
        state.latest = String(r.stdout || '').trim().replace(/^v/, '') || null;
        state.error = null;
        if (available() && available() !== before) log(`update: glass ${available()} is available (this is ${version})`);
      })().finally(() => { pending = null; });
    }
    await pending;
    return view();
  }

  /** Start `glass update`; one at a time, and only when there is something newer. */
  function start() {
    if (!enabled) return { ok: false, error: 'the update check is switched off (updateCheck: false)' };
    if (install?.running) return { ok: true, ...view() };
    if (!available()) return { ok: false, error: `glass ${version} is the latest release` };
    const logFile = path.join(dir, 'update.log');
    install = { running: true, target: available(), startedAt: now(), exit: null, logFile };
    log(`update: installing glass ${install.target}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      launch({
        logFile, env: env(),
        onExit: (code) => {
          install = { ...install, running: false, exit: code };
          log(`update: glass update exited ${code}`);
        },
      });
    } catch (e) {
      install = { ...install, running: false, exit: 1, error: e.message };
    }
    return { ok: true, ...view() };
  }

  function view() {
    return {
      enabled, current: version, latest: state.latest, available: available(), repo,
      checkedAt: state.checkedAt ? new Date(state.checkedAt).toISOString() : null, error: state.error,
      install: install && {
        running: install.running, target: install.target, exit: install.exit,
        startedAt: new Date(install.startedAt).toISOString(), output: install.error || tail(install.logFile),
      },
    };
  }

  return { refresh, start, view, available, settled: () => pending || Promise.resolve() };
}
