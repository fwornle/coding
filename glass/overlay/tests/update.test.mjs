/**
 * glass update: the latest release through gh, installed with npm -g, then the
 * daemon hook. gh and npm are faked; no network, no global install.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { update, newer, viewFailureHint, createUpdateCheck, UPDATE_CHECK_MS } = await import('../lib/glass/update.mjs');

/** A fake gh/npm: `latest` is the release tag; `fail` names steps that fail (download fails that many times). */
function fake({ latest = 'v0.2.0', fail = {} } = {}) {
  const calls = [];
  let downloads = 0;
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh' && args[1] === 'view') {
      if (fail.gh === 'missing') return { error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) };
      if (fail.gh === 'auth') return { status: 1, stdout: '', stderr: 'HTTP 401: Bad credentials' };
      return { status: 0, stdout: `${latest}\n`, stderr: '' };
    }
    if (cmd === 'gh' && args[1] === 'download') {
      if (downloads++ < (fail.download || 0)) return { status: 1, stdout: '', stderr: 'HTTP 500' };
      const dir = args[args.indexOf('--dir') + 1];
      fs.writeFileSync(path.join(dir, `glass-${latest.replace(/^v/, '')}.tgz`), 'tgz');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'npm') return fail.npm ? { status: 1, stdout: '', stderr: 'EACCES' } : { status: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
  };
  return { exec, calls };
}

function io() {
  const lines = { out: [], err: [] };
  return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
}

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glass-update-test-'));

test('versions compare numerically, a leading v allowed', () => {
  assert.equal(newer('0.1.10', '0.1.9'), true);
  assert.equal(newer('v0.2.0', '0.1.7'), true);
  assert.equal(newer('0.1.7', '0.1.7'), false);
  assert.equal(newer('0.1.6', '0.1.7'), false);
  assert.equal(newer('garbage', '0.1.7'), false);
});

test('a newer release is downloaded, installed with npm -g, then the daemon hook runs', async () => {
  const f = fake({ latest: 'v0.2.0' });
  const o = io();
  const root = tmpRoot();
  let after = null;
  const code = await update({ version: '0.1.7', ...o, exec: f.exec, tmpRoot: root, afterInstall: async (v) => { after = v; } });
  assert.equal(code, 0);
  assert.equal(after, '0.2.0');
  const npm = f.calls.find((c) => c[0] === 'npm');
  assert.deepEqual(npm.slice(0, 3), ['npm', 'install', '-g']);
  assert.match(npm[3], /glass-0\.2\.0\.tgz$/);
  assert.deepEqual(fs.readdirSync(root), [], 'the download directory is removed');
});

test('already the latest: nothing is downloaded', async () => {
  const f = fake({ latest: 'v0.1.7' });
  const o = io();
  assert.equal(await update({ version: '0.1.7', ...o, exec: f.exec, tmpRoot: tmpRoot() }), 0);
  assert.match(o.lines.out[0], /0\.1\.7 is the latest/);
  assert.equal(f.calls.length, 1);
});

test('--check reports a newer release and installs nothing', async () => {
  const f = fake({ latest: 'v0.2.0' });
  const o = io();
  assert.equal(await update({ version: '0.1.7', ...o, exec: f.exec, check: true, tmpRoot: tmpRoot() }), 0);
  assert.match(o.lines.out[0], /0\.2\.0 is available/);
  assert.equal(f.calls.length, 1);
});

test('a passing download failure is retried', async () => {
  const f = fake({ fail: { download: 2 } });
  const o = io();
  assert.equal(await update({ version: '0.1.7', ...o, exec: f.exec, tmpRoot: tmpRoot(), retryMs: 0 }), 0);
  assert.equal(f.calls.filter((c) => c[1] === 'release' && c[2] === 'download').length, 3);
});

test('no gh, no login, failed install: exit 1 with what to do', async () => {
  for (const [fail, pattern] of [[{ gh: 'missing' }, /needs the GitHub CLI.*npm install -g/], [{ gh: 'auth' }, /401/], [{ npm: true }, /npm install -g failed/], [{ download: 3 }, /download of v0\.2\.0 failed/]]) {
    const f = fake({ fail });
    const o = io();
    let after = false;
    assert.equal(await update({ version: '0.1.7', ...o, exec: f.exec, tmpRoot: tmpRoot(), retryMs: 0, afterInstall: async () => { after = true; } }), 1);
    assert.match(o.lines.err.join('\n'), pattern);
    assert.equal(after, false, 'the daemon is left alone when nothing was installed');
  }
});

test('a gateway or network failure points at the network, a refused login at gh auth login', () => {
  const host = 'ghe.example.com';
  for (const stderr of [
    'Get "https://api.ghe.example.com/repos/acme/glass/releases/latest": Bad Gateway',
    'HTTP 503: Service Unavailable',
    'dial tcp: lookup api.ghe.example.com: no such host',
    'proxyconnect tcp: dial tcp 127.0.0.1:3128: connect: connection refused',
  ]) {
    const hint = viewFailureHint(stderr, host, { HTTPS_PROXY: 'http://127.0.0.1:3128' });
    assert.match(hint, /network or proxy problem/, stderr);
    assert.match(hint, /HTTPS_PROXY=http:\/\/127\.0\.0\.1:3128/);
    assert.doesNotMatch(hint, /gh auth login/);
  }
  assert.doesNotMatch(viewFailureHint('Bad Gateway', host, {}), /HTTPS_PROXY/, 'no proxy named when none is set');
  for (const stderr of ['HTTP 401: Bad credentials', 'HTTP 404: Not Found', 'To get started with GitHub CLI, please run:  gh auth login']) {
    assert.match(viewFailureHint(stderr, host, {}), /gh auth login --hostname ghe\.example\.com/, stderr);
  }
});

/** createUpdateCheck with a fake gh (`tags` answered in turn) and a fake launch. */
function watcher({ tags = ['v0.2.0'], config = {}, exit = 0 } = {}) {
  const dir = tmpRoot();
  const calls = []; const launches = []; let t = 1_000_000; const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const run = async (args) => {
    calls.push(args);
    const tag = tags[Math.min(calls.length - 1, tags.length - 1)];
    return tag instanceof Error ? { ok: false, error: tag.message } : { ok: true, stdout: `${tag}\n` };
  };
  const launch = ({ logFile, onExit }) => {
    launches.push(logFile);
    fs.writeFileSync(logFile, 'installing glass 0.2.0 (this is 0.1.7)…\ninstalled glass 0.2.0\n');
    if (exit !== null) onExit(exit);
  };
  const check = createUpdateCheck({ version: '0.1.7', dir, config, run, launch, now: clock.now, repo: 'ghe.example.com/acme/glass' });
  return { check, calls, launches, clock, dir };
}

test('update check: a newer release is offered, read again only after the interval', async () => {
  const w = watcher({ tags: ['v0.2.0', 'v0.3.0'] });
  const v = await w.check.refresh();
  assert.equal(v.available, '0.2.0');
  assert.equal(v.current, '0.1.7');
  assert.deepEqual(w.calls[0].slice(0, 4), ['release', 'view', '--repo', 'ghe.example.com/acme/glass']);
  await w.check.refresh();
  assert.equal(w.calls.length, 1, 'cached within the interval');
  w.clock.advance(UPDATE_CHECK_MS);
  assert.equal((await w.check.refresh()).available, '0.3.0');
  assert.equal((await w.check.refresh({ force: true })).available, '0.3.0');
  assert.equal(w.calls.length, 3);
});

test('update check: the same or an older release, or a gh failure, offers nothing', async () => {
  assert.equal((await watcher({ tags: ['v0.1.7'] }).check.refresh()).available, null);
  assert.equal((await watcher({ tags: ['v0.1.6'] }).check.refresh()).available, null);
  const failed = await watcher({ tags: [new Error('gh is not installed')] }).check.refresh();
  assert.equal(failed.available, null);
  assert.equal(failed.error, 'gh is not installed');
  const off = watcher({ config: { updateCheck: false } });
  assert.equal((await off.check.refresh()).enabled, false);
  assert.equal(off.calls.length, 0, 'updateCheck: false never asks');
  assert.equal(off.check.start().ok, false);
});

test('update check: start runs glass update once, only when something is newer, and reports its output', async () => {
  const none = watcher({ tags: ['v0.1.7'] });
  await none.check.refresh();
  assert.equal(none.check.start().ok, false);
  assert.equal(none.launches.length, 0);

  const w = watcher({ exit: null }); // still running
  await w.check.refresh();
  const r = w.check.start();
  assert.equal(r.ok, true);
  assert.equal(r.install.running, true);
  assert.equal(r.install.target, '0.2.0');
  w.check.start();
  assert.equal(w.launches.length, 1, 'one update at a time');

  const done = watcher({ exit: 0 });
  await done.check.refresh();
  const v = done.check.start();
  assert.equal(v.install.running, false);
  assert.equal(v.install.exit, 0);
  assert.match(v.install.output, /installed glass 0\.2\.0/);
  assert.equal(path.dirname(done.launches[0]), done.dir, 'its log is in the run directory');
});
