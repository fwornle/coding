/**
 * The three protection levels and what tells them apart: the host's web UIs.
 *
 *   --box (default)  the agent can LOOK at the dashboard, its API and the
 *                    knowledge viewer — GET/HEAD/OPTIONS through the gate's
 *                    view relay, at their usual localhost ports in the box.
 *   --strict-box     none of that: no view relay, no localhost relay.
 *   --no-box         the host itself (not tested here).
 *
 * Plus the browser and docs toolchain the image carries for looking at them.
 * Real sockets for the relays; argv, Dockerfile and launcher by content.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { createGate, parseArgs, viewRefusal, viewRequestHeaders, viewResponseHeaders, VIEW_METHODS } from '../../docker/agent-box/gate/gate.mjs';
import { parsePorts, relay } from '../../docker/agent-box/localhost-relay.mjs';
import {
  boxStrict, hostViewPorts, BOX_HOST_VIEWS, gateRunArgs, boxRunArgs, playwrightVersion, PLAYWRIGHT_FALLBACK, IMAGE,
} from '../../scripts/agent-box.mjs';

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });

function sink() {
  const lines = [];
  return { lines, write: (s) => { lines.push(...s.trim().split('\n').map((l) => JSON.parse(l))); return true; } };
}

/** A stand-in host UI that records what reaches it. */
async function hostUi() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, cookie: req.headers.cookie, authorization: req.headers.authorization, accept: req.headers.accept, body });
      if (req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: one\n\n');
        setTimeout(() => res.end('data: two\n\n'), 20);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sid=1', 'access-control-allow-origin': 'http://localhost:3032' });
      res.end(req.method === 'HEAD' ? undefined : '<h1>dashboard</h1>');
    });
  });
  srv.on('upgrade', (req, socket) => { seen.push({ method: 'UPGRADE', url: req.url }); socket.end('HTTP/1.1 101 Switching Protocols\r\n\r\n'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => srv.close(r)));
  return { port: srv.address().port, seen };
}

async function viewGate(port) {
  const out = sink();
  const g = await createGate({ target: '127.0.0.1', listenHost: '127.0.0.1', out, view: [{ listen: 0, port }] });
  closers.push(() => g.close());
  return { gport: g.ports[`view:${port}`], out };
}

function ask(port, method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('gate view relay — the default box looks, never touches', () => {
  test('GET and HEAD pass with path and query; Host is localhost:<port>; cookies and auth go nowhere', async () => {
    const ui = await hostUi();
    const { gport } = await viewGate(ui.port);
    const ok = await ask(gport, 'GET', '/api/health-verifier/status?x=1', { cookie: 'sid=evil', authorization: 'Bearer t', accept: 'application/json' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, '<h1>dashboard</h1>');
    assert.equal(ok.headers['set-cookie'], undefined, 'no cookie comes back');
    assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:3032', 'CORS answers pass, so the page can call its API');
    assert.equal((await ask(gport, 'HEAD', '/')).status, 200);
    const [get] = ui.seen;
    assert.equal(get.url, '/api/health-verifier/status?x=1');
    assert.equal(get.host, `localhost:${ui.port}`);
    assert.equal(get.cookie, undefined);
    assert.equal(get.authorization, undefined);
    assert.equal(get.accept, 'application/json', 'ordinary headers pass');
  });

  test('every write method is refused at the gate, never reaches the UI, and is logged', async () => {
    const ui = await hostUi();
    const { gport, out } = await viewGate(ui.port);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await ask(gport, method, '/api/features', { 'content-type': 'application/json' }, '{"knowledge":"off"}');
      assert.equal(r.status, 403, method);
      assert.match(r.body, /view-only/);
    }
    assert.deepEqual(ui.seen, [], 'nothing reached the host UI');
    assert.ok(out.lines.some((l) => l.deny === `http://127.0.0.1:${ui.port}/api/features` && l.method === 'PUT'));
  });

  test('a GET carries no body upstream, even if the client sends one', async () => {
    const ui = await hostUi();
    const { gport } = await viewGate(ui.port);
    const r = await ask(gport, 'GET', '/x', { 'content-type': 'text/plain', 'content-length': '5' }, 'hello');
    assert.equal(r.status, 200);
    assert.equal(ui.seen[0].body, '');
  });

  test('a WebSocket upgrade is refused before it reaches the UI', async () => {
    const ui = await hostUi();
    const { gport, out } = await viewGate(ui.port);
    const reply = await new Promise((resolve, reject) => {
      const s = net.connect(gport, '127.0.0.1', () => s.write('GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'));
      let buf = '';
      s.on('data', (d) => { buf += d; });
      s.on('end', () => resolve(buf));
      s.on('error', reject);
    });
    assert.match(reply, /^HTTP\/1\.1 403/);
    assert.deepEqual(ui.seen, []);
    assert.ok(out.lines.some((l) => /upgrade to websocket/.test(l.why || '')));
  });

  test('a streamed answer (SSE) streams through', async () => {
    const ui = await hostUi();
    const { gport } = await viewGate(ui.port);
    const r = await ask(gport, 'GET', '/stream');
    assert.equal(r.body, 'data: one\n\ndata: two\n\n');
  });

  test('helpers: methods, refusals, header filters, --view argv', () => {
    assert.deepEqual(VIEW_METHODS, ['GET', 'HEAD', 'OPTIONS']);
    assert.equal(viewRefusal('GET', {}), null);
    assert.equal(viewRefusal('OPTIONS', {}), null);
    assert.match(viewRefusal('POST', {}), /POST/);
    assert.match(viewRefusal('GET', { upgrade: 'websocket' }), /websocket/);
    assert.deepEqual(viewRequestHeaders({ Host: 'gate', Cookie: 'a', 'X-Ok': '1', Connection: 'Upgrade', Upgrade: 'websocket' }, 3032), { 'X-Ok': '1', host: 'localhost:3032' });
    assert.deepEqual(viewResponseHeaders({ 'set-cookie': ['a'], 'content-type': 'text/html' }), { 'content-type': 'text/html' });
    assert.deepEqual(parseArgs(['--target', 't', '--view', '3032', '--view', '12436']).view, [3032, 12436]);
    assert.throws(() => parseArgs(['--target', 't', '--view', 'x']), /bad --view/);
  });
});

describe('localhost relay in the box', () => {
  test('parsePorts keeps valid, distinct ports only', () => {
    assert.deepEqual(parsePorts('3032, 3033,3032,abc,0,70000,12436'), [3032, 3033, 12436]);
    assert.deepEqual(parsePorts(''), []);
  });

  test('relays localhost:<port> bytes to the target at the same port', async () => {
    const ui = await hostUi();
    // Target 127.0.0.1 on a second loopback address stands in for host.docker.internal.
    const srv = await relay(ui.port, { host: '127.0.0.2', target: '127.0.0.1' }).catch(() => null);
    if (!srv) return; // no 127.0.0.2 on this platform (macOS without an alias): covered by the gate tests
    closers.push(() => new Promise((r) => srv.close(r)));
    const r = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.2', port: ui.port, path: '/' }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b)); }).on('error', reject);
    });
    assert.equal(r, '<h1>dashboard</h1>');
  });

  test('a port already taken is reported as null, not a crash', async () => {
    const held = net.createServer();
    await new Promise((r) => held.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise((r) => held.close(r)));
    assert.equal(await relay(held.address().port, { host: '127.0.0.1' }), null);
  });
});

describe('protection levels in the launcher', () => {
  test('boxStrict reads CODING_BOX_STRICT', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) assert.equal(boxStrict({ CODING_BOX_STRICT: v }), true, v);
    for (const v of [undefined, '', '0', 'false', 'off']) assert.equal(boxStrict({ CODING_BOX_STRICT: v }), false, String(v));
  });

  test('default box: the three host UIs; strict: none; never a port the gate already serves', () => {
    assert.deepEqual(BOX_HOST_VIEWS.map((v) => v.port), [3032, 3033, 12436]);
    assert.deepEqual(hostViewPorts({}), [3032, 3033, 12436]);
    assert.deepEqual(hostViewPorts({ CODING_BOX_STRICT: 'true' }), []);
    assert.deepEqual(hostViewPorts({ SYSTEM_HEALTH_DASHBOARD_PORT: '4032' }), [4032, 3033, 12436], 'port overrides apply');
    assert.deepEqual(hostViewPorts({ OBSERVATIONS_API_PORT: '12435' }, [12435, 3035]), [3032, 3033], 'never shadows the LLM proxy');
  });

  test('the gate gets one --view per UI port', () => {
    const flag = (argv, f) => argv.flatMap((a, i) => (a === f ? [argv[i + 1]] : []));
    const argv = gateRunArgs({ name: 'b', agent: 'claude', ports: [12435, 3035], network: 'n', views: [3032, 3033, 12436], platform: 'darwin' });
    assert.deepEqual(flag(argv.slice(argv.indexOf(IMAGE) + 1), '--view'), ['3032', '3033', '12436']);
    assert.ok(!flag(argv, '--forward').includes('3032'), 'a view relay, never a raw forward');
    assert.deepEqual(flag(gateRunArgs({ name: 'b', agent: 'claude', ports: [1], network: 'n', platform: 'darwin' }), '--view'), []);
  });

  test('the box env names its mode; only the default box gets the localhost relay', () => {
    const base = { agent: 'claude', cwd: '/Users/u/proj', codingRepo: '/Users/u/coding', home: '/Users/u', platform: 'darwin', uid: 501, gid: 20, name: 'coding-box-claude-1', exists: () => true, env: {} };
    const envs = (argv) => Object.fromEntries(argv.flatMap((a, i) => (a === '-e' ? [argv[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));
    const box = envs(boxRunArgs({ ...base, hostViews: [3032, 3033, 12436] }));
    assert.equal(box.CODING_BOX_MODE, 'box');
    assert.equal(box.CODING_BOX_HOST_VIEW, '3032,3033,12436');
    const strict = envs(boxRunArgs({ ...base, hostViews: [3032], strict: true }));
    assert.equal(strict.CODING_BOX_MODE, 'strict');
    assert.equal(strict.CODING_BOX_HOST_VIEW, undefined, 'strict never starts the relay, whatever it is handed');
  });

  test('bin/coding parses --strict-box into the box plus CODING_BOX_STRICT; --box clears it', () => {
    const src = read('bin/coding');
    assert.match(src, /--strict-box\)\n[\s\S]*?export CODING_BOX=true\n\s*export CODING_BOX_STRICT=true/);
    assert.match(src, /--box\)\n[\s\S]*?export CODING_BOX=true\n\s*export CODING_BOX_STRICT=false/);
    assert.match(src, /--strict-box\s+Agent box/, 'listed in --help');
  });

  test('the tmux wrapper carries the box mode into the session exactly (set, or env -u)', () => {
    const src = read('scripts/tmux-session-wrapper.sh');
    assert.match(src, /local box_vars=\(CODING_BOX_STRICT CODING_BOX_NETWORK\)/);
    assert.match(src, /for var in "\$\{routing_vars\[@\]\}" "\$\{box_vars\[@\]\}"; do/);
  });
});

describe('the image: a browser, the docs toolchain, the relay', () => {
  const dockerfile = read('docker/agent-box/Dockerfile');
  const entrypoint = read('docker/agent-box/entrypoint.sh');

  test('Chromium at the repo\'s Playwright version, with its libraries, root-owned', () => {
    assert.match(dockerfile, /ARG PLAYWRIGHT_VERSION=/);
    assert.match(dockerfile, /ENV PLAYWRIGHT_BROWSERS_PATH=\/opt\/ms-playwright/);
    assert.match(dockerfile, /playwright install --with-deps chromium/);
    assert.match(dockerfile, /chown -R root:root \/opt\/ms-playwright/);
  });

  test('build passes the locked Playwright version', () => {
    assert.match(read('scripts/agent-box.mjs'), /'--build-arg', `PLAYWRIGHT_VERSION=\$\{playwrightVersion\(\)\}`/);
    const lock = JSON.stringify({ packages: { 'node_modules/playwright': { version: '1.60.1' } } });
    assert.equal(playwrightVersion('/r', () => lock), '1.60.1');
    assert.equal(playwrightVersion('/r', () => '{}'), PLAYWRIGHT_FALLBACK);
    assert.equal(playwrightVersion('/r', () => { throw new Error('no file'); }), PLAYWRIGHT_FALLBACK);
    assert.match(playwrightVersion(), /^\d+\.\d+\.\d+$/);
  });

  test('mkdocs with the plugins mkdocs.yml uses', () => {
    assert.match(dockerfile, /pip install --no-cache-dir mkdocs-material mkdocs-minify-plugin/);
    assert.match(dockerfile, /ln -s \/opt\/mkdocs\/bin\/mkdocs \/usr\/local\/bin\/mkdocs/);
  });

  test('the localhost relay ships root-owned and starts as nobody, only when the launcher asks', () => {
    assert.match(dockerfile, /COPY localhost-relay\.mjs \/opt\/coding-box\/localhost-relay\.mjs/);
    assert.match(entrypoint, /if \[ -n "\$\{CODING_BOX_HOST_VIEW:-\}" \]; then\n\s*setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs -- \\\n\s*node \/opt\/coding-box\/localhost-relay\.mjs "\$CODING_BOX_HOST_VIEW"/);
    // Before the agent starts: the relay must hold its ports first.
    assert.ok(entrypoint.indexOf('localhost-relay.mjs') < entrypoint.indexOf('exec setpriv'));
  });
});
