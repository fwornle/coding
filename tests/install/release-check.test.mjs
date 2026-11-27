/**
 * Release notification state (lib/install/release-check.mjs): what the
 * coordinator records and the status line / dashboard show. Fails open.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { check, readState, notes, startUpdate, updateStatus, updateLog } from '../../lib/install/release-check.mjs';

const require = createRequire(import.meta.url);
const layout = require('../../lib/install/layout.cjs');

let home;
let opts;
const env = { CODING_RELEASE_URL: 'https://github.com/fwornle/coding/releases' };
const redirectTo = (tag) => async () => ({ ok: true, status: 0, stdout: `<html/>\nhttps://github.com/fwornle/coding/releases/tag/${tag}`, stderr: '' });
const down = async () => ({ ok: false, status: 6, stdout: '', stderr: 'curl: (6) Could not resolve host' });

function onRelease(version) {
  fs.mkdirSync(path.join(layout.releaseDir(version, opts), 'bin'), { recursive: true });
  fs.writeFileSync(path.join(layout.releaseDir(version, opts), layout.MARKER), JSON.stringify({ version }));
  layout.activate(version, opts);
}

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-relcheck-')));
  opts = { homeDir: home };
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('release check', () => {
  test('a newer release is recorded as available, with its notes and page', async () => {
    onRelease('8.0.0');
    const s = await check({ opts, env, exec: redirectTo('v8.1.0') });
    assert.equal(s.available, '8.1.0');
    assert.equal(s.current, '8.0.0');
    assert.equal(s.notesUrl, 'https://github.com/fwornle/coding/releases/download/v8.1.0/coding-8.1.0-notes.md');
    assert.equal(s.pageUrl, 'https://github.com/fwornle/coding/releases/tag/v8.1.0');
    assert.deepEqual(readState(opts), s, 'persisted for the status line');
  });

  test('on the latest release: nothing available', async () => {
    onRelease('8.1.0');
    assert.equal((await check({ opts, env, exec: redirectTo('v8.1.0') })).available, null);
  });

  test('a dev checkout is never checked', async () => {
    let called = false;
    const s = await check({ opts, env, exec: async () => { called = true; return { ok: true, stdout: '' }; } });
    assert.equal(s.channel, 'dev');
    assert.equal(s.available, null);
    assert.equal(called, false);
  });

  test('CODING_UPDATE_CHECK=off: no network, no badge', async () => {
    onRelease('8.0.0');
    let called = false;
    const s = await check({ opts, env: { ...env, CODING_UPDATE_CHECK: 'off' }, exec: async () => { called = true; return { ok: true, stdout: '' }; } });
    assert.equal(s.enabled, false);
    assert.equal(called, false);
  });

  test('no network: fails open, keeps the last known update', async () => {
    onRelease('8.0.0');
    await check({ opts, env, exec: redirectTo('v8.1.0') });
    const s = await check({ opts, env, exec: down });
    assert.match(s.error, /Could not resolve host/);
    assert.equal(s.available, '8.1.0', 'one failed check does not hide a known update');
  });

  test('a known update for an OLDER install is not carried over after updating', async () => {
    onRelease('8.0.0');
    await check({ opts, env, exec: redirectTo('v8.1.0') });
    onRelease('8.1.0');
    const s = await check({ opts, env, exec: down });
    assert.equal(s.available, null);
  });

  test('no state file: readState is null, never a throw', () => {
    assert.equal(readState(opts), null);
  });

  test('notes: fetched only when something is available, null on failure', async () => {
    assert.equal(await notes({ available: null }), null);
    const ok = async () => ({ ok: true, stdout: '## coding 8.1.0\n' });
    assert.equal(await notes({ available: '8.1.0', notesUrl: 'x' }, { exec: ok }), '## coding 8.1.0\n');
    assert.equal(await notes({ available: '8.1.0', notesUrl: 'x' }, { exec: down }), null);
  });
});

describe('starting an update', () => {
  test('refuses when nothing newer is known', async () => {
    onRelease('8.1.0');
    await check({ opts, env, exec: redirectTo('v8.1.0') });
    const r = await startUpdate({ codeRoot: '/nowhere', opts });
    assert.equal(r.ok, false);
    assert.match(r.error, /latest release/);
  });

  test('runs detached, records its exit; status survives a restart of the caller', async () => {
    onRelease('8.0.0');
    await check({ opts, env, exec: redirectTo('v8.1.0') });
    // A stand-in for scripts/update.mjs that the real spawn runs.
    const root = path.join(home, 'root');
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'update.mjs'), "console.log('updating…'); process.exit(3)");
    const r = await startUpdate({ codeRoot: root, opts });
    assert.equal(r.ok, true);
    assert.equal(r.target, '8.1.0');
    let st;
    for (let i = 0; i < 50; i++) {
      st = updateStatus(opts);
      if (!st.running) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(st.running, false);
    assert.equal(st.exit, 3);
    assert.match(st.log, /updating…/);
    assert.doesNotMatch(st.log, /UPDATE_EXIT/, 'the marker is not shown to the user');
    assert.ok(fs.existsSync(updateLog(opts)));
  });
});
