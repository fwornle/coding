/**
 * glass update — install the latest release over this one: the release tarball
 * through the GitHub CLI (the repository is private to the enterprise host, so an
 * anonymous download is refused), then `npm install -g` of it, the same two steps
 * the README gives by hand.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
    err(`  logged in? gh auth login --hostname ${host}`);
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
