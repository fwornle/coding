/**
 * coding update (lib/install/update.mjs) against a file:// release server.
 *
 * The installer, image pull and service restarts are stubbed — what is under
 * test is the order of the steps, what each failure leaves behind, and that
 * user data and the previous release survive. P4 acceptance in miniature:
 * N-1 → N keeps features/teams/data intact, rollback returns to N-1.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { update, latestRelease, carry, CARRY } from '../../lib/install/update.mjs';

const require = createRequire(import.meta.url);
const layout = require('../../lib/install/layout.cjs');

let home;
let server;
let opts;
let env;
let log;

function publish(version, { corrupt = false } = {}) {
  const stage = fs.mkdtempSync(path.join(home, 'stage-'));
  const root = path.join(stage, `coding-${version}`);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'probe'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, layout.MARKER), JSON.stringify({ version }));
  const tgz = path.join(server, `coding-${version}.tar.gz`);
  execFileSync('tar', ['-czf', tgz, '-C', stage, `coding-${version}`]);
  const sum = corrupt ? '0'.repeat(64) : createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
  fs.writeFileSync(`${tgz}.sha256`, `${sum}  coding-${version}.tar.gz\n`);
  fs.writeFileSync(
    path.join(server, 'latest'),
    JSON.stringify({
      tag_name: `v${version}`,
      assets: [
        { name: `coding-${version}.tar.gz`, browser_download_url: `file://${tgz}` },
        { name: `coding-${version}.tar.gz.sha256`, browser_download_url: `file://${tgz}.sha256` },
      ],
    }),
  );
}

/** Install `version` the way a first install would: adopt + activate, plus machine files. */
function installed(version) {
  publish(version);
  const r = latestRelease({ env });
  const dir = path.join(home, 'first');
  fs.mkdirSync(dir);
  execFileSync('tar', ['-xzf', path.join(server, `coding-${version}.tar.gz`), '-C', dir]);
  layout.adopt(path.join(dir, `coding-${version}`), opts);
  layout.activate(version, opts);
  fs.writeFileSync(path.join(layout.releaseDir(version, opts), '.env'), 'CODING_HISTORY_REPO=git@x:me/h.git\n');
  return r;
}

function stubs({ failInstall = false, failRestartOn = null } = {}) {
  return {
    installPhase: (phase, root) => {
      log.push(`${phase} ${phase === 'register' ? layout.currentVersion(opts) : path.basename(root)}`);
      if (phase === 'register') assert.equal(root, layout.currentLink(opts), 'register runs through current');
      if (failInstall && phase === 'build') throw new Error('install.sh --update=build failed (exit 1)');
    },
    pullImage: (v) => log.push(`pull ${v}`),
    features: () => ({ needsDocker: true }),
    restartDaemons: async () => [],
    restartOnto: async () => {
      const v = layout.currentVersion(opts);
      log.push(`restart on ${v}`);
      if (v === failRestartOn) throw new Error('daemons did not restart: obs-api (exit 1)');
    },
  };
}

const probe = () => execFileSync(path.join(layout.currentLink(opts), 'bin', 'probe'), { encoding: 'utf8' }).trim();

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-update-')));
  server = path.join(home, 'server');
  fs.mkdirSync(server);
  opts = { homeDir: home };
  env = { ...process.env, CODING_RELEASE_API: `file://${server}` };
  log = [];
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const lines = () => {
  const o = [];
  return { o, out: (s) => o.push(s), err: (s) => o.push(`ERR ${s}`) };
};

describe('coding update — release channel', () => {
  test('N-1 → N: download, verify, carry, install, pull, flip, restart; data untouched; rollback returns', async () => {
    installed('8.0.0');
    const dot = layout.codingDir(opts);
    fs.writeFileSync(path.join(dot, 'features.yaml'), 'profile: learning\n');
    fs.mkdirSync(path.join(dot, 'data', 'me', 'kb'), { recursive: true });
    fs.writeFileSync(path.join(dot, 'data', 'me', 'kb', 'x.json'), '{"k":1}');
    publish('8.1.0');

    const t = lines();
    assert.equal(await update({ opts, env, steps: stubs(), ...t }), 0, t.o.join('\n'));
    assert.deepEqual(log, ['build 8.1.0', 'pull 8.1.0', 'register 8.1.0', 'restart on 8.1.0']);
    assert.equal(probe(), '8.1.0');
    assert.equal(fs.readFileSync(path.join(layout.releaseDir('8.1.0', opts), '.env'), 'utf8'), 'CODING_HISTORY_REPO=git@x:me/h.git\n');
    assert.equal(fs.readFileSync(path.join(dot, 'features.yaml'), 'utf8'), 'profile: learning\n');
    assert.equal(fs.readFileSync(path.join(dot, 'data', 'me', 'kb', 'x.json'), 'utf8'), '{"k":1}');

    log = [];
    assert.equal(await update({ rollback: true, opts, env, steps: stubs(), ...lines() }), 0);
    assert.equal(probe(), '8.0.0');
    assert.deepEqual(log, ['restart on 8.0.0']);
    assert.ok(fs.existsSync(path.join(layout.releaseDir('8.0.0', opts), '.env')), 'the old release kept its own copy');
  });

  test('--check reports and installs nothing', async () => {
    installed('8.0.0');
    publish('8.1.0');
    const t = lines();
    assert.equal(await update({ check: true, opts, env, steps: stubs(), ...t }), 0);
    assert.match(t.o.join('\n'), /coding 8\.1\.0 is available \(this is 8\.0\.0\)/);
    assert.deepEqual(log, []);
    assert.deepEqual(layout.listReleases(opts).map((r) => r.version), ['8.0.0']);
  });

  test('already on the latest: nothing to do', async () => {
    installed('8.1.0');
    const t = lines();
    assert.equal(await update({ opts, env, steps: stubs(), ...t }), 0);
    assert.match(t.o.join('\n'), /8\.1\.0 is the latest release/);
    assert.deepEqual(log, []);
  });

  test('a bad checksum stops before anything is installed', async () => {
    installed('8.0.0');
    publish('8.1.0', { corrupt: true });
    const t = lines();
    assert.equal(await update({ opts, env, steps: stubs(), ...t }), 1);
    assert.match(t.o.join('\n'), /checksum mismatch/);
    assert.deepEqual(layout.listReleases(opts).map((r) => r.version), ['8.0.0']);
    assert.equal(probe(), '8.0.0');
  });

  test('a failing install leaves the current release current', async () => {
    installed('8.0.0');
    publish('8.1.0');
    const t = lines();
    assert.equal(await update({ opts, env, steps: stubs({ failInstall: true }), ...t }), 1);
    assert.match(t.o.join('\n'), /nothing was switched; coding 8\.0\.0 is still current/);
    assert.equal(probe(), '8.0.0');
  });

  test('a failed restart after the flip switches back and restarts the old release', async () => {
    installed('8.0.0');
    publish('8.1.0');
    const t = lines();
    assert.equal(await update({ opts, env, steps: stubs({ failRestartOn: '8.1.0' }), ...t }), 1);
    assert.deepEqual(log, ['build 8.1.0', 'pull 8.1.0', 'register 8.1.0', 'restart on 8.1.0', 'restart on 8.0.0']);
    assert.equal(probe(), '8.0.0');
    assert.match(t.o.join('\n'), /back on 8\.0\.0; 8\.1\.0 stays unpacked/);
  });

  test('no network: one clear error, exit 1', async () => {
    installed('8.0.0');
    const t = lines();
    const bad = { ...env, CODING_RELEASE_API: `file://${home}/nowhere` };
    assert.equal(await update({ opts, env: bad, steps: stubs(), ...t }), 1);
    assert.match(t.o.join('\n'), /could not read the latest release/);
  });

  test('carry copies machine files without overwriting what the new release has', () => {
    const a = path.join(home, 'a');
    const b = path.join(home, 'b');
    fs.mkdirSync(path.join(a, '.coding'), { recursive: true });
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, '.env'), 'old');
    fs.writeFileSync(path.join(a, '.coding', 'x'), 'cfg');
    fs.writeFileSync(path.join(b, '.env'), 'new');
    assert.deepEqual(carry(a, b), ['.env', '.coding']);
    assert.equal(fs.readFileSync(path.join(b, '.env'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(b, '.coding', 'x'), 'utf8'), 'cfg');
    for (const [p, why] of CARRY) assert.ok(p && why);
  });
});

describe('coding update — dev channel', () => {
  test('names the git commands and runs nothing unless --pull', async () => {
    layout.writeInstall({ channel: 'dev', source: '/src/coding', version: '8.0.0' }, opts);
    const calls = [];
    const exec = (c, a) => {
      calls.push([c, ...a].join(' '));
      return { ok: true, status: 0, stdout: '', stderr: '' };
    };
    const t = lines();
    assert.equal(await update({ opts, env, exec, ...t }), 0);
    assert.deepEqual(calls, []);
    assert.match(t.o.join('\n'), /development checkout.*git -C \/src\/coding pull --ff-only/s);
    assert.equal(await update({ pull: true, opts, env, exec, ...lines() }), 0);
    assert.deepEqual(calls, ['git -C /src/coding pull --ff-only', 'git -C /src/coding submodule update --init --recursive']);
  });
});
