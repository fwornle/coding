/**
 * Clipboard bridge for the agent box: image paste from the host clipboard.
 *
 *   lib/guard/clipboard.mjs                       host side: read the clipboard image
 *   scripts/coding-guard-daemon.mjs GET /clipboard box-token gated, audited, images only
 *   docker/agent-box/clipboard/clipboard-shim.mjs  xclip / wl-paste stand-in in the box
 *
 * The shim is driven with the exact command lines Claude Code (Linux build)
 * runs to paste an image, as a real process against a live daemon.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { peekClipboardImage, readClipboardImage, MAX_IMAGE_BYTES } from '../../lib/guard/clipboard.mjs';
import { createGuard } from '../../scripts/coding-guard-daemon.mjs';
import { guardPaths } from '../../lib/guard/home.mjs';
import { readAudit } from '../../lib/guard/audit.mjs';
import { parseArgs } from '../../docker/agent-box/clipboard/clipboard-shim.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIM = path.join(REPO, 'docker', 'agent-box', 'clipboard', 'clipboard-shim.mjs');
const PNG = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from([0, 1, 2, 250, 251, 252, 10, 13, 0])]);
const ok = (stdout) => ({ code: 0, stdout: Buffer.from(stdout), stderr: '' });

describe('host reader (lib/guard/clipboard.mjs)', () => {
  test('macOS: writes «class PNGf» to a temp file, returns it, removes it', async () => {
    let written;
    const run = async (file, args) => {
      assert.equal(file, 'osascript');
      written = /POSIX file "([^"]+)"/.exec(args[1])[1];
      fs.writeFileSync(written, PNG);
      return ok('ok\n');
    };
    assert.deepEqual(await readClipboardImage({ platform: 'darwin', run }), PNG);
    assert.equal(fs.existsSync(written), false, 'temp file removed');
  });

  test('macOS: no image on the clipboard → null', async () => {
    assert.equal(await readClipboardImage({ platform: 'darwin', run: async () => ok('none\n') }), null);
  });

  test('Linux: xclip on X11, wl-paste on Wayland', async () => {
    const calls = [];
    const run = async (file, args) => { calls.push([file, ...args]); return ok(PNG); };
    await readClipboardImage({ platform: 'linux', run, env: {} });
    await readClipboardImage({ platform: 'linux', run, env: { WAYLAND_DISPLAY: 'wayland-0' } });
    assert.deepEqual(calls[0], ['xclip', '-selection', 'clipboard', '-t', 'image/png', '-o']);
    assert.equal(calls[1][0], 'wl-paste');
  });

  test('something that is not a PNG is not handed over', async () => {
    assert.equal(await readClipboardImage({ platform: 'linux', run: async () => ok('hunter2'), env: {} }), null);
  });

  test('an oversized image is refused', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    PNG.copy(big);
    await assert.rejects(readClipboardImage({ platform: 'linux', run: async () => ({ code: 0, stdout: big, stderr: '' }), env: {} }), /limit/);
  });

  test('peek: image types count, text does not; unknown platform has none', async () => {
    assert.equal(await peekClipboardImage({ platform: 'linux', run: async () => ok('TARGETS\nimage/png\n'), env: {} }), true);
    assert.equal(await peekClipboardImage({ platform: 'linux', run: async () => ok('TARGETS\nUTF8_STRING\n'), env: {} }), false);
    assert.equal(await peekClipboardImage({ platform: 'darwin', run: async () => ok('«class PNGf», 1234') }), true);
    assert.equal(await peekClipboardImage({ platform: 'aix' }), false);
  });
});

describe('shim command lines (Claude Code, Linux build)', () => {
  test('the probe and the read Claude runs', () => {
    assert.deepEqual(parseArgs('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']), { action: 'peek' });
    assert.deepEqual(parseArgs('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']), { action: 'read', type: 'image/png' });
    assert.deepEqual(parseArgs('wl-paste', ['-l']), { action: 'peek' });
    assert.deepEqual(parseArgs('wl-paste', ['--type', 'image/png']), { action: 'read', type: 'image/png' });
  });

  test('copying and text reads are refused', () => {
    assert.equal(parseArgs('xclip', ['-selection', 'clipboard']).action, 'unsupported');
    assert.equal(parseArgs('xclip', ['-selection', 'clipboard', '-o']).action, 'unsupported');
    assert.equal(parseArgs('xclip', ['-selection', 'clipboard', '-t', 'UTF8_STRING', '-o']).action, 'unsupported');
    assert.equal(parseArgs('wl-paste', []).action, 'unsupported');
  });
});

describe('daemon route + shim end to end', () => {
  let server; let base; let paths; let token; let box;
  let clipboardImage = PNG;
  let enabled = true;

  const start = async () => {
    paths = guardPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-clip-')));
    let handler = null;
    server = http.createServer((req, res) => handler(req, res));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    base = `http://127.0.0.1:${port}`;
    ({ handler } = createGuard({
      paths, port, codingRepo: '/repo',
      runDocker: async () => ({ code: 0, stdout: '', stderr: '' }),
      clipboard: { peek: async () => Boolean(clipboardImage), read: async () => clipboardImage },
      clipboardEnabled: () => enabled,
    }));
    token = fs.readFileSync(paths.token, 'utf8').trim();
    const reg = await fetch(`${base}/boxes`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'coding-box-claude-1' }),
    });
    box = (await reg.json()).token;
  };
  before(start);
  after(() => server?.close());

  const shim = (tool, args, env = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [SHIM, tool, ...args], {
      env: { PATH: process.env.PATH, CODING_GUARD_URL: base, CODING_GUARD_BOX_TOKEN: box, ...env },
    });
    const out = []; let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
  });

  test('without a box token → 401', async () => {
    assert.equal((await fetch(`${base}/clipboard`)).status, 401);
    assert.equal((await fetch(`${base}/clipboard`, { headers: { 'x-coding-box-token': 'forged' } })).status, 401);
  });

  test('a browser request is refused even with a token', async () => {
    const res = await fetch(`${base}/clipboard`, { headers: { 'x-coding-box-token': box, origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });

  test('xclip probe + read return the host image byte for byte, and the read is audited', async () => {
    const probe = await shim('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']);
    assert.equal(probe.code, 0, probe.stderr);
    assert.match(probe.stdout.toString(), /^image\/png$/m);
    const read = await shim('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
    assert.equal(read.code, 0, read.stderr);
    assert.deepEqual(read.stdout, PNG);
    const events = readAudit(paths.audit).filter((e) => e.event === 'clipboard.read');
    assert.equal(events.at(-1).session, 'coding-box-claude-1');
    assert.equal(events.at(-1).bytes, PNG.length);
  });

  test('wl-paste works the same way', async () => {
    const read = await shim('wl-paste', ['--type', 'image/png']);
    assert.equal(read.code, 0, read.stderr);
    assert.deepEqual(read.stdout, PNG);
  });

  test('no image: the probe prints nothing (Claude\'s grep fails) and the read exits 1', async () => {
    clipboardImage = null;
    try {
      const probe = await shim('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']);
      assert.equal(probe.stdout.length, 0);
      assert.equal((await shim('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'])).code, 1);
    } finally { clipboardImage = PNG; }
  });

  test('bmp is not offered (the host hands over PNG only)', async () => {
    assert.equal((await shim('xclip', ['-selection', 'clipboard', '-t', 'image/bmp', '-o'])).code, 1);
  });

  test('turned off on the host → the shim says so', async () => {
    enabled = false;
    try {
      const r = await shim('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /CODING_GUARD_CLIPBOARD=off/);
    } finally { enabled = true; }
  });

  test('outside a registered box the shim fails cleanly', async () => {
    const r = await shim('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], { CODING_GUARD_BOX_TOKEN: '' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not in a registered agent box/);
  });
});
