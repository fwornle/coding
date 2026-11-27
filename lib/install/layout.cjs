'use strict';

/**
 * Release layout — WHERE the code of this installation lives, as opposed to its
 * data (lib/paths/data-home.cjs).
 *
 *   ~/.coding/
 *   ├── install.json             {channel, version, source, previous?}
 *   └── releases/
 *       ├── 8.0.0/               one unpacked release (has release.json)
 *       ├── 8.1.0/
 *       └── current -> 8.1.0     RELATIVE symlink; the only path anything
 *                                long-lived is registered against
 *
 * WHY A `current` LINK. Daemons (launchd/systemd/schtasks), the shell rc's
 * CODING_REPO and the compose bind mounts all persist a path. If that path named
 * a version, every update would have to re-register every one of them, and
 * pruning an old release would break whatever still pointed at it. Registered
 * against `current`, an update is: unpack beside, flip the link, restart.
 * Rollback is the same flip backwards.
 *
 * WHY THE FLIP IS A RENAME. A new link is created under a temporary name and
 * rename(2)d over `current`, which replaces it atomically: at no instant is
 * there no `current`. Unlinking first would leave a window in which a daemon
 * restarted by launchd KeepAlive finds nothing and exits for good.
 *
 * TWO CHANNELS. `release` = the code is a folder under releases/. `dev` = the
 * code is a git checkout (the developer's), registered against the checkout
 * itself, exactly as before this layout existed. No install.json means dev with
 * the checkout this file lives in — so a machine that never installed a release
 * behaves exactly as it did.
 *
 * Release folders are code only. Nothing under ~/.coding/data, features.yaml,
 * teams.yaml or install.json lives inside one, so a flip cannot touch user data.
 *
 * CJS for the same reason as data-home.cjs: the status line requires it.
 * scripts/lib/code-root.sh is the bash mirror of stableRoot(); keep them equal.
 */

const fs = require('node:fs');
const path = require('node:path');
const { codingHome } = require('../scope/resolve.cjs');

const SELF_ROOT = path.resolve(__dirname, '..', '..');
const CHANNELS = ['release', 'dev'];
// Semver-ish, and nothing that could be a path segment trick ('current', '..', '/').
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const MARKER = 'release.json';

const codingDir = (opts = {}) => path.join(codingHome(opts), '.coding');
const installFile = (opts = {}) => path.join(codingDir(opts), 'install.json');
const releasesDir = (opts = {}) => path.join(codingDir(opts), 'releases');
const currentLink = (opts = {}) => path.join(releasesDir(opts), 'current');

function assertVersion(version) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error(`not a release version: ${JSON.stringify(version)} (expected x.y.z[-tag])`);
  }
  return version;
}

const releaseDir = (version, opts = {}) => path.join(releasesDir(opts), assertVersion(version));

function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre] = v.split('-');
    return { nums: core.split('.').map(Number), pre: pre ?? null };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1; // 1.0.0 > 1.0.0-rc.1
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pkgVersion(root) {
  try {
    return readJson(path.join(root, 'package.json')).version ?? null;
  } catch {
    return null;
  }
}

/**
 * The install record. Absent → implicit dev install of this checkout.
 * Present but malformed → throws: callers that START things must fail closed,
 * and a display caller can catch and say so.
 */
function readInstall(opts = {}) {
  const file = installFile(opts);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const source = opts.selfRoot ?? SELF_ROOT;
    return { channel: 'dev', version: pkgVersion(source), source, implicit: true };
  }
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`);
  }
  if (!rec || typeof rec !== 'object' || !CHANNELS.includes(rec.channel)) {
    throw new Error(`${file}: "channel" must be one of ${CHANNELS.join(', ')}`);
  }
  if (rec.channel === 'release') assertVersion(rec.version);
  if (rec.channel === 'dev' && typeof rec.source !== 'string') {
    throw new Error(`${file}: a dev install needs "source" (the checkout path)`);
  }
  return { ...rec, implicit: false };
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function writeInstall(rec, opts = {}) {
  const clean = { ...rec };
  delete clean.implicit;
  if (!CHANNELS.includes(clean.channel)) throw new Error(`channel must be one of ${CHANNELS.join(', ')}`);
  if (clean.channel === 'release') assertVersion(clean.version);
  writeJsonAtomic(installFile(opts), clean);
  return clean;
}

/** The version `current` points at, or null when there is no (valid) link. */
function currentVersion(opts = {}) {
  let target;
  try {
    target = fs.readlinkSync(currentLink(opts));
  } catch {
    return null;
  }
  const v = path.basename(target);
  return VERSION_RE.test(v) ? v : null;
}

/** A release folder is complete once its marker is in place (written last by an unpack). */
function readMarker(dir) {
  try {
    return readJson(path.join(dir, MARKER));
  } catch {
    return null;
  }
}

function listReleases(opts = {}) {
  let names;
  try {
    names = fs.readdirSync(releasesDir(opts));
  } catch {
    return [];
  }
  const cur = currentVersion(opts);
  return names
    .filter((n) => VERSION_RE.test(n))
    .sort(compareVersions)
    .map((version) => {
      const dir = path.join(releasesDir(opts), version);
      const marker = readMarker(dir);
      return { version, dir, current: version === cur, complete: !!marker && marker.version === version };
    });
}

/**
 * The root anything long-lived should be registered against.
 * release → releases/current (stable across flips); dev → the checkout.
 */
function codeRoot(opts = {}) {
  const rec = readInstall(opts);
  return rec.channel === 'release' ? currentLink(opts) : rec.source;
}

/**
 * Map a directory the code is running from to the path worth persisting:
 * a release folder that `current` points at becomes `current`; anything else
 * (a dev checkout, an explicitly started older release) stays as it is.
 * Mirrored by coding_code_root in scripts/lib/code-root.sh.
 */
function stableRoot(dir, opts = {}) {
  const cur = realpathOrNull(currentLink(opts));
  if (cur && realpathOrNull(dir) === cur) return currentLink(opts);
  return dir;
}

function makeLink(version, linkPath) {
  if (process.platform === 'win32') {
    // Junctions need no privilege but must be absolute.
    fs.symlinkSync(path.join(path.dirname(linkPath), version), linkPath, 'junction');
  } else {
    fs.symlinkSync(version, linkPath); // relative: ~/.coding can move as a whole
  }
}

/**
 * Point `current` at `version` atomically and record it in install.json.
 * Refuses a release folder that is missing or not completely unpacked.
 */
function activate(version, opts = {}) {
  assertVersion(version);
  const rel = listReleases(opts).find((r) => r.version === version);
  if (!rel) throw new Error(`release ${version} is not installed (${releaseDir(version, opts)})`);
  if (!rel.complete) throw new Error(`release ${version} is incomplete: ${MARKER} missing or names another version`);

  const from = currentVersion(opts);
  const link = currentLink(opts);
  const tmp = path.join(releasesDir(opts), `.current.${process.pid}.tmp`);
  fs.rmSync(tmp, { force: true });
  makeLink(version, tmp);
  if (process.platform === 'win32') fs.rmSync(link, { force: true }); // rename cannot replace a junction
  fs.renameSync(tmp, link);

  let prev = {};
  try {
    prev = readInstall(opts);
  } catch {
    /* a broken record is replaced by a valid one */
  }
  const rec = {
    channel: 'release',
    version,
    source: prev.channel === 'release' ? prev.source ?? null : opts.source ?? null,
    previous: from && from !== version ? from : prev.previous ?? null,
    activatedAt: new Date().toISOString(),
  };
  writeInstall(rec, opts);
  return { from, to: version };
}

/** Flip back to the version recorded as `previous`. */
function rollback(opts = {}) {
  const rec = readInstall(opts);
  if (rec.channel !== 'release') throw new Error('rollback: this is a dev install (a git checkout); use git');
  if (!rec.previous) throw new Error('rollback: no previous release recorded');
  return activate(rec.previous, opts);
}

/**
 * Install an unpacked release tree as releases/<version>: copy to a temporary
 * sibling, then rename into place, so a half-copied folder never carries the
 * version's name. The version comes from the tree's own release.json.
 */
function adopt(srcDir, opts = {}) {
  const marker = readMarker(srcDir);
  if (!marker) throw new Error(`${srcDir}: no ${MARKER} — not an unpacked release`);
  const version = assertVersion(marker.version);
  const dest = releaseDir(version, opts);
  if (fs.existsSync(dest)) throw new Error(`release ${version} is already installed (${dest})`);
  fs.mkdirSync(releasesDir(opts), { recursive: true });
  const tmp = `${dest}.${process.pid}.partial`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(srcDir, tmp, { recursive: true, verbatimSymlinks: true });
  fs.renameSync(tmp, dest);
  return { version, dir: dest };
}

/** Remove an installed release. Never the one `current` points at, nor `previous`. */
function remove(version, opts = {}) {
  assertVersion(version);
  if (currentVersion(opts) === version) throw new Error(`release ${version} is current; activate another first`);
  let rec = {};
  try {
    rec = readInstall(opts);
  } catch {
    /* removing is still safe when the record is broken */
  }
  if (rec.previous === version && !opts.force) {
    throw new Error(`release ${version} is the rollback target; pass force to remove it anyway`);
  }
  fs.rmSync(releaseDir(version, opts), { recursive: true, force: true });
  return { removed: version };
}

/** Everything a status surface needs, failing open (errors are reported, not thrown). */
function status(opts = {}) {
  let install;
  let error = null;
  try {
    install = readInstall(opts);
  } catch (err) {
    error = err.message;
    install = null;
  }
  return {
    install,
    error,
    codeRoot: install ? (install.channel === 'release' ? currentLink(opts) : install.source) : null,
    current: currentVersion(opts),
    releases: listReleases(opts),
    paths: { installFile: installFile(opts), releasesDir: releasesDir(opts), currentLink: currentLink(opts) },
  };
}

module.exports = {
  CHANNELS,
  MARKER,
  VERSION_RE,
  codingDir,
  installFile,
  releasesDir,
  currentLink,
  releaseDir,
  compareVersions,
  readInstall,
  writeInstall,
  currentVersion,
  listReleases,
  codeRoot,
  stableRoot,
  activate,
  rollback,
  adopt,
  remove,
  status,
};
