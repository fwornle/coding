/**
 * coding update — install the latest release beside the running one and switch
 * to it (lib/install/layout.cjs for the folders, docs/architecture/release-layout.md).
 *
 * Release channel, in this order — every step before the flip leaves the
 * running install untouched, so a failure there needs no undo:
 *   1. ask GitHub for the latest release (anonymous: the repo is public)
 *   2. download the tarball + .sha256, verify, unpack, adopt as releases/<ver>
 *   3. carry the machine-local files (CARRY) from the current release
 *   4. `install.sh --update=build` in the new folder: dependencies and builds,
 *      nothing outside the tree
 *   5. pull the release's service image when a Docker feature is on
 *   6. flip `current`
 *   7. `current/install.sh --update=register`: MCP config, agent settings,
 *      hooks, daemons — run through `current`, so every stored path names it
 *   8. apply-features, restart the daemons, recreate the services container
 * A failure in 7 or 8 flips back and restarts again, so the machine ends on a
 * release that ran before.
 *
 * Dev channel (a git checkout): never touched without being asked — it says so
 * and names the git commands; `--pull` runs them.
 *
 * Downloads go through curl, not fetch: curl honours HTTPS_PROXY/NO_PROXY the
 * way every other tool on a corporate machine does, and it reads file:// URLs,
 * which is how the tests stand up a release server.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const layout = require('./layout.cjs');

export const RELEASE_API = 'https://api.github.com/repos/fwornle/coding/releases';
export const IMAGE = 'ghcr.io/fwornle/coding-services';
/** The name compose gives the built coding-services image (project `docker`). */
export const COMPOSE_IMAGE = 'docker-coding-services:latest';

/**
 * Machine-local files that live in the code tree and must survive an update:
 * [relative path, why]. Copied, not moved, so the previous release still has
 * its own copy to roll back to.
 */
export const CARRY = [
  ['.env', 'local settings install.sh appended (history repo URL, feature flags)'],
  ['.npmrc', 'the npm proxy, when the environment variables are not honoured'],
  ['.coding', 'per-launch agent config and the tools repo learning checkout'],
  ['.data', 'machine data install.sh keeps in the tree (knowledge.db, codegraph); shipped files of the new release win'],
];

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...opts });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? r.error.message : '') };
}

const apiBase = (env) => env.CODING_RELEASE_API || RELEASE_API;

/** The latest published release: { version, tarballUrl, shaUrl }. */
export function latestRelease({ exec = run, env = process.env } = {}) {
  const r = exec('curl', ['-fsSL', '--retry', '2', '-H', 'Accept: application/vnd.github+json', `${apiBase(env)}/latest`]);
  if (!r.ok) throw new Error(`could not read the latest release: ${r.stderr.trim() || `curl exit ${r.status}`}`);
  let rel;
  try {
    rel = JSON.parse(r.stdout);
  } catch {
    throw new Error('the release API answered with something that is not JSON');
  }
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!layout.VERSION_RE.test(version)) throw new Error(`latest release has no usable tag (${rel.tag_name})`);
  const asset = (name) => rel.assets?.find((a) => a.name === name)?.browser_download_url;
  const tarballUrl = asset(`coding-${version}.tar.gz`);
  const shaUrl = asset(`coding-${version}.tar.gz.sha256`);
  if (!tarballUrl || !shaUrl) throw new Error(`release v${version} is missing its tarball or checksum`);
  return { version, tarballUrl, shaUrl };
}

const newer = (a, b) => !b || layout.compareVersions(a, b) > 0;

/** Download, verify and adopt a release; returns its folder. Leaves `current` alone. */
export function fetchRelease(rel, { exec = run, opts = {}, out = () => {} } = {}) {
  const existing = layout.listReleases(opts).find((r) => r.version === rel.version);
  if (existing?.complete) {
    out(`release ${rel.version} is already unpacked`);
    return existing.dir;
  }
  if (existing) layout.remove(rel.version, { ...opts, force: true }); // a broken earlier attempt

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-update-'));
  try {
    const tgz = path.join(tmp, `coding-${rel.version}.tar.gz`);
    for (const [url, file] of [[rel.tarballUrl, tgz], [rel.shaUrl, `${tgz}.sha256`]]) {
      const d = exec('curl', ['-fsSL', '--retry', '3', '-o', file, url]);
      if (!d.ok) throw new Error(`download failed: ${url}: ${d.stderr.trim()}`);
    }
    const want = fs.readFileSync(`${tgz}.sha256`, 'utf8').trim().split(/\s+/)[0];
    const got = createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
    if (want !== got) throw new Error(`checksum mismatch for coding-${rel.version}.tar.gz (expected ${want}, got ${got})`);
    out(`downloaded coding ${rel.version}, checksum ok`);

    const unpack = path.join(tmp, 'u');
    fs.mkdirSync(unpack);
    const x = exec('tar', ['-xzf', tgz, '-C', unpack]);
    if (!x.ok) throw new Error(`unpack failed: ${x.stderr.trim()}`);
    const tree = path.join(unpack, `coding-${rel.version}`);
    const marker = JSON.parse(fs.readFileSync(path.join(tree, layout.MARKER), 'utf8'));
    if (marker.version !== rel.version) throw new Error(`tarball says ${marker.version}, release says ${rel.version}`);
    return layout.adopt(tree, opts).dir;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Copy CARRY from one code tree into another; files already in `to` win. */
export function carry(from, to) {
  const carried = [];
  if (!from) return carried;
  for (const [rel] of CARRY) {
    const src = path.join(from, rel);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(to, rel), { recursive: true, force: false, errorOnExist: false, verbatimSymlinks: true });
    carried.push(rel);
  }
  return carried;
}

function resolvedFeatures(root, exec) {
  const r = exec(process.execPath, [path.join(root, 'bin', 'coding-features'), 'json']);
  if (!r.ok) throw new Error(`coding-features json failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}

/**
 * Steps 4 and 7: one phase of a release's own installer (install.sh
 * run_update_phase). CODING_REPO is set to the folder the script is run from:
 * install.sh compares the two and turns on sandbox mode when an inherited
 * CODING_REPO names another install.
 *   build     root = the new version folder (before the flip)
 *   register  root = releases/current (after it), so stored paths name `current`
 */
export function installPhase(phase, root, { exec = run, env = process.env } = {}) {
  const r = exec('bash', [path.join(root, 'install.sh'), `--update=${phase}`], {
    cwd: root,
    stdio: 'inherit',
    env: { ...env, CODING_REPO: root },
  });
  if (!r.ok) throw new Error(`install.sh --update=${phase} failed (exit ${r.status})`);
}

/** Step 5: pull the release image and give it the name compose uses for the built one. */
export function pullImage(version, { exec = run, out = () => {} } = {}) {
  const ref = `${IMAGE}:${version}`;
  const p = exec('docker', ['pull', ref], { stdio: 'inherit' });
  if (!p.ok) throw new Error(`docker pull ${ref} failed`);
  const t = exec('docker', ['tag', ref, COMPOSE_IMAGE]);
  if (!t.ok) throw new Error(`docker tag ${ref} ${COMPOSE_IMAGE} failed: ${t.stderr.trim()}`);
  out(`image ${ref} ready`);
}

/** Step 7: bring the running services onto whatever `current` is now. */
export async function restartOnto(root, { exec = run, needsDocker = false, out = () => {}, restartDaemons } = {}) {
  const a = exec(process.execPath, [path.join(root, 'scripts', 'apply-features.mjs')], { stdio: 'inherit', env: { ...process.env, CODING_REPO: root } });
  if (!a.ok) throw new Error('apply-features failed');
  const restarted = await restartDaemons(root);
  const failed = restarted.filter((r) => r.ok === false);
  if (failed.length) throw new Error(`daemons did not restart: ${failed.map((r) => `${r.name} (${r.detail})`).join(', ')}`);
  if (needsDocker) {
    const c = exec('docker', ['compose', '-f', path.join(root, 'docker', 'docker-compose.yml'), 'up', '-d', '--force-recreate', 'coding-services'], {
      stdio: 'inherit',
      env: { ...process.env, CODING_REPO: root },
    });
    if (!c.ok) throw new Error('recreating the coding-services container failed');
  }
  out(`services restarted on ${root}`);
}

/** Restart every installed coding daemon through the platform's service manager. */
export async function restartInstalledDaemons(root) {
  const d = await import(path.join(root, 'lib', 'features', 'daemons.mjs'));
  const results = [];
  for (const name of Object.keys(d.DAEMONS)) {
    if (await d.isInstalled(name)) results.push(await d.restart(name));
  }
  return results;
}

/**
 * @returns {Promise<number>} exit code
 */
export async function update({
  check = false,
  rollback = false,
  pull = false,
  exec = run,
  opts = {},
  env = process.env,
  out = () => {},
  err = () => {},
  steps = {},
} = {}) {
  const s = {
    installPhase,
    pullImage,
    restartOnto,
    restartDaemons: restartInstalledDaemons,
    features: resolvedFeatures,
    ...steps,
  };
  let rec;
  try {
    rec = layout.readInstall(opts);
  } catch (e) {
    err(`coding update: ${e.message}`);
    return 1;
  }

  if (rec.channel === 'dev') return updateDev(rec, { check, pull, exec, out, err });

  const cur = layout.currentLink(opts);
  if (rollback) {
    try {
      const r = layout.rollback(opts);
      out(`current: ${r.from} → ${r.to}`);
      await s.restartOnto(cur, { exec, needsDocker: s.features(cur, exec).needsDocker, out, restartDaemons: s.restartDaemons });
      return 0;
    } catch (e) {
      err(`coding update --rollback: ${e.message}`);
      return 1;
    }
  }

  let rel;
  try {
    rel = latestRelease({ exec, env });
  } catch (e) {
    err(`coding update: ${e.message}`);
    return 1;
  }
  if (!newer(rel.version, rec.version)) {
    out(`coding ${rec.version} is the latest release`);
    return 0;
  }
  if (check) {
    out(`coding ${rel.version} is available (this is ${rec.version}) — coding update installs it`);
    return 0;
  }

  // 2–5: nothing the running install uses is touched.
  let dir;
  let needsDocker;
  try {
    out(`updating coding ${rec.version} → ${rel.version}`);
    dir = fetchRelease(rel, { exec, opts, out });
    const carried = carry(layout.currentVersion(opts) ? cur : null, dir);
    if (carried.length) out(`carried over: ${carried.join(', ')}`);
    s.installPhase('build', dir, { exec, env });
    needsDocker = !!s.features(dir, exec).needsDocker;
    if (needsDocker) s.pullImage(rel.version, { exec, out });
  } catch (e) {
    err(`coding update: ${e.message}`);
    err(`  nothing was switched; coding ${rec.version} is still current`);
    return 1;
  }

  // 6–8, with the flip undone on failure.
  const { from } = layout.activate(rel.version, opts);
  try {
    s.installPhase('register', cur, { exec, env });
    await s.restartOnto(cur, { exec, needsDocker, out, restartDaemons: s.restartDaemons });
  } catch (e) {
    err(`coding update: ${e.message}`);
    if (!from) return 1;
    err(`  switching back to ${from}`);
    try {
      layout.activate(from, opts);
      await s.restartOnto(cur, { exec, needsDocker, out, restartDaemons: s.restartDaemons });
      err(`  back on ${from}; ${rel.version} stays unpacked for a retry`);
    } catch (e2) {
      err(`  switching back failed too: ${e2.message}`);
    }
    return 1;
  }
  out(`coding ${rel.version} is installed and running (coding update --rollback returns to ${from ?? 'nothing'})`);
  return 0;
}

function updateDev(rec, { check, pull, exec, out, err }) {
  const repo = rec.source;
  const cmds = [
    ['git', ['-C', repo, 'pull', '--ff-only']],
    ['git', ['-C', repo, 'submodule', 'update', '--init', '--recursive']],
  ];
  if (!pull || check) {
    out(`${repo} is a development checkout (channel: dev); releases do not apply to it.`);
    out(`To update it: ${cmds.map(([c, a]) => `${c} ${a.join(' ')}`).join(' && ')}`);
    out('(coding update --pull runs exactly that.)');
    return 0;
  }
  for (const [c, a] of cmds) {
    const r = exec(c, a, { stdio: 'inherit' });
    if (!r.ok) {
      err(`coding update: ${c} ${a.join(' ')} failed`);
      return 1;
    }
  }
  out('checkout updated — restart your coding sessions to pick it up');
  return 0;
}
