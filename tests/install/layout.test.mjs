/**
 * Release layout (lib/install/layout.cjs + scripts/lib/code-root.sh).
 *
 * P2 acceptance in miniature: two releases side by side, flipping `current`
 * switches which code a (re)started process runs, a registered plist names
 * `current` rather than a version folder, and nothing under ~/.coding outside
 * releases/ changes on a flip.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const layout = require('../../lib/install/layout.cjs');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let home;
let opts;

function makeTree(dir, version, { marker = true } = {}) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  // Stands in for a daemon: prints the version of the code it was started from.
  fs.writeFileSync(path.join(dir, 'bin', 'probe'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  if (marker) fs.writeFileSync(path.join(dir, layout.MARKER), JSON.stringify({ version }));
  return dir;
}

function installRelease(version, o = {}) {
  const src = makeTree(path.join(home, 'unpacked', version), version, o);
  if (o.marker === false) {
    fs.mkdirSync(layout.releasesDir(opts), { recursive: true });
    fs.cpSync(src, layout.releaseDir(version, opts), { recursive: true });
    return;
  }
  layout.adopt(src, opts);
}

function hashTree(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      h.update(path.relative(dir, p));
      if (st.isDirectory()) walk(p);
      else h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

const runProbe = () =>
  execFileSync(path.join(layout.currentLink(opts), 'bin', 'probe'), { encoding: 'utf8' }).trim();

const shellRoot = (dir) =>
  execFileSync('bash', ['-c', `source "${REPO}/scripts/lib/code-root.sh"; coding_code_root "$1"`, '_', dir], {
    encoding: 'utf8',
    env: { ...process.env, CODING_HOME: home },
  });

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-layout-')));
  opts = { homeDir: home };
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('install record', () => {
  test('no install.json = implicit dev install of this checkout', () => {
    const rec = layout.readInstall({ ...opts, selfRoot: REPO });
    assert.equal(rec.channel, 'dev');
    assert.equal(rec.source, REPO);
    assert.equal(rec.implicit, true);
    assert.equal(layout.codeRoot({ ...opts, selfRoot: REPO }), REPO);
  });

  test('a malformed record throws (start paths fail closed); status reports it', () => {
    fs.mkdirSync(layout.codingDir(opts), { recursive: true });
    fs.writeFileSync(layout.installFile(opts), '{"channel":"nightly"}');
    assert.throws(() => layout.readInstall(opts), /channel/);
    const s = layout.status(opts);
    assert.match(s.error, /channel/);
    assert.equal(s.codeRoot, null);
  });

  test('a dev record keeps its checkout as the code root', () => {
    layout.writeInstall({ channel: 'dev', source: '/src/coding', version: '2.0.0' }, opts);
    assert.equal(layout.codeRoot(opts), '/src/coding');
  });
});

describe('releases side by side', () => {
  test('flipping current switches what a started process runs; rollback flips back', () => {
    installRelease('8.0.0');
    installRelease('8.1.0');
    assert.deepEqual(layout.listReleases(opts).map((r) => r.version), ['8.0.0', '8.1.0']);

    layout.activate('8.0.0', opts);
    assert.equal(runProbe(), '8.0.0');
    assert.equal(layout.codeRoot(opts), layout.currentLink(opts));

    const r = layout.activate('8.1.0', opts);
    assert.deepEqual(r, { from: '8.0.0', to: '8.1.0' });
    assert.equal(runProbe(), '8.1.0');
    assert.equal(layout.readInstall(opts).previous, '8.0.0');

    layout.rollback(opts);
    assert.equal(runProbe(), '8.0.0');
    assert.equal(layout.readInstall(opts).previous, '8.1.0');
  });

  test('current is a relative link, so ~/.coding can move as a whole', { skip: process.platform === 'win32' }, () => {
    installRelease('8.0.0');
    layout.activate('8.0.0', opts);
    assert.equal(fs.readlinkSync(layout.currentLink(opts)), '8.0.0');
  });

  test('a flip leaves everything outside releases/ byte-identical', () => {
    const dot = layout.codingDir(opts);
    fs.mkdirSync(path.join(dot, 'data', 'default', 'kb'), { recursive: true });
    fs.writeFileSync(path.join(dot, 'data', 'default', 'kb', 'x.json'), '{"k":1}');
    fs.writeFileSync(path.join(dot, 'features.yaml'), 'profile: learning\n');
    fs.writeFileSync(path.join(dot, 'teams.yaml'), 'active: [coding]\n');
    installRelease('8.0.0');
    installRelease('8.1.0');
    layout.activate('8.0.0', opts);

    const snapshot = () =>
      ['data', 'features.yaml', 'teams.yaml'].map((n) => {
        const p = path.join(dot, n);
        return fs.statSync(p).isDirectory() ? hashTree(p) : fs.readFileSync(p, 'utf8');
      });
    const before = snapshot();
    layout.activate('8.1.0', opts);
    layout.rollback(opts);
    assert.deepEqual(snapshot(), before);
  });

  test('refuses a missing, an incomplete or a malformed version', () => {
    installRelease('8.0.0', { marker: false });
    assert.throws(() => layout.activate('9.9.9', opts), /not installed/);
    assert.throws(() => layout.activate('8.0.0', opts), /incomplete/);
    assert.throws(() => layout.activate('../evil', opts), /not a release version/);
    assert.throws(() => layout.activate('current', opts), /not a release version/);
    assert.equal(fs.existsSync(layout.currentLink(opts)), false);
  });

  test('adopt never leaves a half-copied folder under the version name; refuses a duplicate', () => {
    installRelease('8.0.0');
    const names = fs.readdirSync(layout.releasesDir(opts));
    assert.deepEqual(names, ['8.0.0']);
    assert.throws(() => layout.adopt(path.join(home, 'unpacked', '8.0.0'), opts), /already installed/);
  });

  test('remove refuses current and the rollback target', () => {
    installRelease('8.0.0');
    installRelease('8.1.0');
    layout.activate('8.0.0', opts);
    layout.activate('8.1.0', opts);
    assert.throws(() => layout.remove('8.1.0', opts), /current/);
    assert.throws(() => layout.remove('8.0.0', opts), /rollback target/);
    layout.remove('8.0.0', { ...opts, force: true });
    assert.deepEqual(layout.listReleases(opts).map((r) => r.version), ['8.1.0']);
  });

  test('versions sort as versions, not strings', () => {
    for (const v of ['8.10.0', '8.2.0', '8.2.0-rc.1']) installRelease(v);
    assert.deepEqual(layout.listReleases(opts).map((r) => r.version), ['8.2.0-rc.1', '8.2.0', '8.10.0']);
  });
});

describe('what gets persisted names current, not a version folder', () => {
  test('stableRoot and the bash coding_code_root agree', () => {
    installRelease('8.0.0');
    installRelease('8.1.0');
    layout.activate('8.1.0', opts);
    const cur = layout.currentLink(opts);
    const cases = [layout.releaseDir('8.1.0', opts), cur, layout.releaseDir('8.0.0', opts), REPO];
    const expected = [cur, cur, layout.releaseDir('8.0.0', opts), REPO];
    assert.deepEqual(cases.map((d) => layout.stableRoot(d, opts)), expected);
    assert.deepEqual(cases.map(shellRoot), expected);
  });

  test('no releases installed: the checkout is returned unchanged', () => {
    assert.equal(shellRoot(REPO), REPO);
    assert.equal(layout.stableRoot(REPO, opts), REPO);
  });

  test('a plist rendered from inside a release names current', { skip: process.platform !== 'darwin' }, () => {
    installRelease('8.1.0');
    layout.activate('8.1.0', opts);
    const out = path.join(home, 'rendered.plist');
    execFileSync(
      'bash',
      [
        '-c',
        `source "${REPO}/scripts/lib/launchd-plist.sh"; render_plist "${REPO}/launchd/com.coding.obs-api.plist" "$1" "$(launchd_repo_root)"`,
        '_',
        out,
      ],
      { env: { ...process.env, CODING_HOME: home, CODING_REPO: layout.releaseDir('8.1.0', opts) } },
    );
    const plist = fs.readFileSync(out, 'utf8');
    assert.ok(plist.includes(`${layout.currentLink(opts)}/scripts/`), 'plist names releases/current');
    assert.ok(!plist.includes(`${layout.releaseDir('8.1.0', opts)}/`), 'plist does not name the version folder');
  });
});

describe('coding releases CLI', () => {
  test('a reader that closes the pipe early (| head) is not a crash', () => {
    for (let i = 0; i < 12; i++) makeTree(path.join(home, 'u', `p${i}`), `9.0.${i}`);
    for (let i = 0; i < 12; i++) layout.adopt(path.join(home, 'u', `p${i}`), opts);
    const r = execFileSync('bash', ['-c', `node "${REPO}/scripts/releases.mjs" status 2>"${home}/err" | head -1 >/dev/null; echo "\${PIPESTATUS[0]}"`], {
      encoding: 'utf8',
      env: { ...process.env, CODING_HOME: home },
    });
    assert.equal(r.trim(), '0');
    assert.equal(fs.readFileSync(path.join(home, 'err'), 'utf8'), '', 'no EPIPE stack trace');
  });

  const cli = (...a) =>
    execFileSync(process.execPath, [path.join(REPO, 'scripts', 'releases.mjs'), ...a], {
      encoding: 'utf8',
      env: { ...process.env, CODING_HOME: home },
    });

  test('adopt → use → status --json → rollback', () => {
    makeTree(path.join(home, 'u', 'a'), '8.0.0');
    makeTree(path.join(home, 'u', 'b'), '8.1.0');
    cli('adopt', path.join(home, 'u', 'a'));
    cli('adopt', path.join(home, 'u', 'b'));
    cli('use', '8.0.0');
    assert.match(cli('use', '8.1.0'), /8\.0\.0 → 8\.1\.0/);
    const s = JSON.parse(cli('status', '--json'));
    assert.equal(s.install.channel, 'release');
    assert.equal(s.current, '8.1.0');
    assert.equal(s.codeRoot, layout.currentLink(opts));
    assert.match(cli('rollback'), /8\.1\.0 → 8\.0\.0/);
    assert.equal(cli('root').trim(), layout.currentLink(opts));
  });
});
