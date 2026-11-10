/**
 * The box network gate (docker/agent-box/gate/gate.mjs), over real sockets:
 * forwards only its ports, CONNECTs only to allow-listed hosts (direct or
 * through an upstream proxy), refuses everything else and says so.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import { createGate, parseArgs, parseAuthority, parseRelay, parseMcpRelay, mcpRefusal, filterToolList, allowed, allowListFor } from '../../docker/agent-box/gate/gate.mjs';

const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });

/** A TCP echo server standing in for a host service. */
async function echoServer() {
  const srv = net.createServer((s) => s.pipe(s));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => srv.close(r)));
  return srv.address().port;
}

function roundTrip(port, payload = 'ping') {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(payload));
    s.once('data', (d) => { resolve(d.toString()); s.destroy(); });
    s.once('error', reject);
  });
}

function connectThrough(proxyPort, authority) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: authority });
    req.on('connect', (res, sock) => resolve({ status: res.statusCode, sock }));
    req.on('response', (res) => resolve({ status: res.statusCode, sock: null }));
    req.on('error', reject);
    req.end();
  });
}

function sink() {
  const lines = [];
  return { lines, write: (s) => { lines.push(...s.trim().split('\n').map((l) => JSON.parse(l))); return true; } };
}

async function gate(opts) {
  const out = sink();
  const g = await createGate({ target: '127.0.0.1', listenHost: '127.0.0.1', out, ...opts });
  closers.push(() => g.close());
  return { g, out };
}

describe('box gate', () => {
  test('forwards its ports to the host service', async () => {
    const svc = await echoServer();
    const { g } = await gate({ forward: [{ listen: 0, port: svc }] });
    assert.equal(await roundTrip(g.ports[svc], 'hello'), 'hello');
  });

  test('CONNECT to an allow-listed host works; anything else is 403 and logged', async () => {
    const svc = await echoServer();
    const { g, out } = await gate({ connectPort: 0, allow: ['localhost'], allowPorts: [svc] });
    const ok = await connectThrough(g.ports.connect, `localhost:${svc}`);
    assert.equal(ok.status, 200);
    ok.sock.write('tunnel');
    assert.equal(await new Promise((r) => ok.sock.once('data', (d) => r(d.toString()))), 'tunnel');
    ok.sock.destroy();

    const bad = await connectThrough(g.ports.connect, 'example.com:443');
    assert.equal(bad.status, 403);
    const wrongPort = await connectThrough(g.ports.connect, `localhost:${svc + 1}`);
    assert.equal(wrongPort.status, 403);
    assert.ok(out.lines.some((l) => l.deny === 'example.com:443'));
    assert.ok(out.lines.some((l) => l.allow === `localhost:${svc}`));
  });

  test('a client that resets after a refused CONNECT does not take the gate down', async () => {
    // Claude probes api.anthropic.com through HTTPS_PROXY at start, gets the 403
    // and resets the socket; an unhandled ECONNRESET there killed the gate, and
    // every later request from the box was ECONNREFUSED.
    const svc = await echoServer();
    const { g } = await gate({ connectPort: 0, allow: ['localhost'], allowPorts: [svc] });
    await new Promise((resolve, reject) => {
      const s = net.connect(g.ports.connect, '127.0.0.1', () => s.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'));
      s.once('data', () => { s.resetAndDestroy(); setTimeout(resolve, 50); });
      s.once('error', reject);
    });
    const ok = await connectThrough(g.ports.connect, `localhost:${svc}`);
    assert.equal(ok.status, 200);
    ok.sock.destroy();
  });

  test('plain HTTP through the proxy is refused (only CONNECT is offered)', async () => {
    const { g, out } = await gate({ connectPort: 0, allow: ['localhost'] });
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: g.ports.connect, path: 'http://example.com/', headers: { host: 'example.com' } },
        (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(status, 403);
    assert.ok(out.lines.some((l) => l.deny === 'example.com'));
  });

  test('an allowed CONNECT goes through the upstream proxy when one is set', async () => {
    const svc = await echoServer();
    const seen = [];
    const upstream = http.createServer();
    upstream.on('connect', (req, client) => {
      seen.push(req.url);
      const [h, p] = req.url.split(':');
      const s = net.connect(Number(p), h === 'localhost' ? '127.0.0.1' : h, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        s.pipe(client); client.pipe(s);
      });
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise((r) => upstream.close(r)));
    const { g } = await gate({ connectPort: 0, allow: ['localhost'], allowPorts: [svc], upstream: `http://127.0.0.1:${upstream.address().port}` });
    const ok = await connectThrough(g.ports.connect, `localhost:${svc}`);
    assert.equal(ok.status, 200);
    ok.sock.write('via-upstream');
    assert.equal(await new Promise((r) => ok.sock.once('data', (d) => r(d.toString()))), 'via-upstream');
    ok.sock.destroy();
    assert.deepEqual(seen, [`localhost:${svc}`]);
  });

  test('a port the gate does not forward is refused by the kernel', async () => {
    const { g } = await gate({ forward: [] });
    assert.deepEqual(g.servers, []);
  });
});

describe('gate helpers', () => {
  test('parseAuthority', () => {
    assert.deepEqual(parseAuthority('Claude.AI:443'), { host: 'claude.ai', port: 443 });
    assert.equal(parseAuthority('claude.ai'), null);
    assert.equal(parseAuthority('a b:443'), null);
    assert.equal(parseAuthority('x:99999'), null);
  });

  test('allowed: exact name and port, no suffix matching', () => {
    assert.ok(allowed(['claude.ai'], { host: 'claude.ai', port: 443 }));
    assert.ok(!allowed(['claude.ai'], { host: 'evil.claude.ai', port: 443 }));
    assert.ok(!allowed(['claude.ai'], { host: 'claude.ai.evil.com', port: 443 }));
    assert.ok(!allowed(['claude.ai'], { host: 'claude.ai', port: 80 }));
  });

  test('a read-only relay passes GET of its paths and refuses everything else', async () => {
    const seen = [];
    const svc = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`.trim());
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'x=1' });
      res.end('{"overallStatus":"healthy"}');
    });
    await new Promise((r) => svc.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise((r) => svc.close(r)));
    const port = svc.address().port;
    const { g, out } = await gate({ httpGet: [{ listen: 0, port, paths: ['/health/state'] }] });
    const ask = (method, p, headers = {}) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: g.ports[`get:${port}`], method, path: p, headers }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      });
      req.on('error', reject);
      req.end(method === 'GET' ? undefined : '{}');
    });

    const ok = await ask('GET', '/health/state?x=1', { authorization: 'Bearer t' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, '{"overallStatus":"healthy"}');
    assert.equal(ok.headers['set-cookie'], undefined, 'only the content type comes back');
    for (const [method, p] of [['POST', '/health/remediate'], ['PUT', '/features'], ['POST', '/health/state'], ['GET', '/features'], ['GET', '/health/state/../../features']]) {
      assert.equal((await ask(method, p)).status, 403, `${method} ${p}`);
    }
    assert.deepEqual(seen, ['GET /health/state'], 'no query, no client headers, nothing else upstream');
    assert.ok(out.lines.some((l) => l.deny === `http://127.0.0.1:${port}/features` && l.method === 'PUT'));
  });

  test('a relay whose service is down answers 502', async () => {
    const dead = await echoServer();
    const { g } = await gate({ httpGet: [{ listen: 0, port: dead + 1, paths: ['/health/state'] }] });
    const status = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: g.ports[`get:${dead + 1}`], path: '/health/state' }, (res) => { res.resume(); resolve(res.statusCode); })
        .on('error', () => resolve('error'));
    });
    assert.equal(status, 502);
  });

  test('an MCP relay passes the listed tools on the default graph and refuses the rest', async () => {
    const seen = [];
    const svc = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const msg = JSON.parse(body);
        seen.push(`${msg.method} ${req.headers['mcp-session-id'] ?? '-'} ${req.headers.cookie ?? ''}`.trim());
        const result = msg.method === 'tools/list'
          ? { tools: [
            { name: 'graph_stats', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } } } },
            { name: 'list_prs', inputSchema: { type: 'object', properties: {} } },
          ] }
          : { content: [{ type: 'text', text: 'Nodes: 3' }] };
        // Streamable HTTP answers as an SSE stream.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 's1', 'set-cookie': 'x=1' });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
      });
    });
    await new Promise((r) => svc.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise((r) => svc.close(r)));
    const port = svc.address().port;
    const { g, out } = await gate({ mcp: [{ listen: 0, port, path: '/mcp', tools: ['graph_stats'] }] });
    const call = async (body, p = '/mcp') => {
      const r = await fetch(`http://127.0.0.1:${g.ports[`mcp:${port}`]}${p}`, {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': 's1', cookie: 'c=1' },
      });
      const text = await r.text();
      const data = text.includes('data: ') ? JSON.parse(text.split('data: ')[1]) : (text.startsWith('{') ? JSON.parse(text) : text);
      return { status: r.status, data, cookie: r.headers.get('set-cookie'), session: r.headers.get('mcp-session-id') };
    };

    const list = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.deepEqual(list.data.result.tools.map((t) => t.name), ['graph_stats'], 'only the relayable tools are offered');
    assert.equal(list.data.result.tools[0].inputSchema.properties.project_path, undefined);
    assert.equal(list.session, 's1');
    assert.equal(list.cookie, null);
    const ok = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_stats', arguments: {} } });
    assert.equal(ok.data.result.content[0].text, 'Nodes: 3');

    for (const [body, why] of [
      [{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_prs', arguments: {} } }, /tool list_prs/],
      [{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'graph_stats', arguments: { project_path: '/workspace/other' } } }, /project_path/],
      [{ jsonrpc: '2.0', id: 5, method: 'logging/setLevel', params: {} }, /method logging\/setLevel/],
    ]) {
      const r = await call(body);
      assert.equal(r.data.id, body.id);
      assert.match(r.data.error.message, why);
    }
    assert.equal((await call([{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_prs' } }])).status, 403, 'one bad message refuses the batch');
    assert.equal((await call({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, '/admin')).status, 403);
    assert.deepEqual(seen, ['tools/list s1', 'tools/call s1'], 'refused messages never reach the server; no cookies go upstream');
    assert.ok(out.lines.some((l) => l.why === 'tool list_prs'));
  });

  test('mcpRefusal, filterToolList and parseMcpRelay', () => {
    const tools = ['query_graph'];
    assert.equal(mcpRefusal({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, tools), null);
    assert.equal(mcpRefusal({ jsonrpc: '2.0', id: 1, result: {} }, tools), null, "the client's answer to a server request");
    assert.equal(mcpRefusal({ method: 'tools/call', params: { name: 'query_graph', arguments: { project_path: '' } } }, tools), null, 'empty = default graph');
    assert.match(mcpRefusal({ method: 'tools/call', params: { name: 'query_graph', arguments: { project_path: '/x' } } }, tools), /project_path/);
    assert.match(mcpRefusal({ method: 'tools/call', params: { name: 'constructor' } }, tools), /tool constructor/);
    assert.match(mcpRefusal([], tools), /not a JSON-RPC/);
    assert.equal(filterToolList('not json', tools), 'not json');
    assert.equal(JSON.parse(filterToolList(JSON.stringify({ result: { tools: [{ name: 'query_graph' }, { name: 'x' }] } }), tools)).result.tools.length, 1);
    assert.deepEqual(parseMcpRelay('3851:/mcp:query_graph,get_node'), { port: 3851, path: '/mcp', tools: ['query_graph', 'get_node'] });
    for (const bad of ['3851:/mcp', '3851:/mcp:', '3851:mcp:a', '0:/mcp:a', '3851:/mcp:a b', '3851:/mcp:*']) assert.equal(parseMcpRelay(bad), null, bad);
    assert.deepEqual(parseArgs(['--target', 't', '--mcp', '3851:/mcp:a']).mcp, [{ port: 3851, path: '/mcp', tools: ['a'] }]);
    assert.throws(() => parseArgs(['--target', 't', '--mcp', '3851']), /bad --mcp/);
  });

  test('parseRelay takes a port and absolute paths only', () => {
    assert.deepEqual(parseRelay('3034:/health/state'), { port: 3034, paths: ['/health/state'] });
    assert.deepEqual(parseRelay('1:/a,/b'), { port: 1, paths: ['/a', '/b'] });
    for (const bad of ['3034', '3034:', '3034:health', '0:/a', '70000:/a', '3034:/a?b', '3034:/a,b', 'x:/a']) assert.equal(parseRelay(bad), null, bad);
    assert.deepEqual(parseArgs(['--target', 't', '--http-get', '3034:/health/state']).httpGet, [{ port: 3034, paths: ['/health/state'] }]);
    assert.throws(() => parseArgs(['--target', 't', '--http-get', '3034:*']), /bad --http-get/);
  });

  test('parseArgs builds the options the launcher passes, and rejects anything else', () => {
    const o = parseArgs(['--target', 'host.docker.internal', '--forward', '12435', '--forward', '3035', '--connect', '3128', '--agent', 'claude']);
    assert.deepEqual(o.forward, [12435, 3035]);
    assert.equal(o.connectPort, 3128);
    assert.throws(() => parseArgs(['--target', 'x', '--exec', 'sh']), /unknown argument/);
    assert.throws(() => parseArgs(['--forward', '1']), /--target/);
  });

  test('the committed allow-list names login hosts only — no model API', () => {
    const file = new URL('../../docker/agent-box/gate/egress-allow.json', import.meta.url);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const agent of ['claude', 'copilot', 'opencode', 'pi']) assert.ok(Array.isArray(doc.agents[agent]), agent);
    const all = Object.values(doc.agents).flat();
    for (const banned of ['api.anthropic.com', 'api.githubcopilot.com', 'api.openai.com', 'openrouter.ai']) {
      assert.ok(!all.includes(banned), `${banned} would let the agent call models around the proxy`);
    }
    assert.deepEqual(allowListFor(file, 'pi'), []);
    assert.deepEqual(allowListFor(file, 'nobody'), []);
  });
});
