/**
 * glass update: the latest release through gh, installed with npm -g, then the
 * daemon hook. gh and npm are faked; no network, no global install.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { update, newer } = await import('../lib/glass/update.mjs');

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
