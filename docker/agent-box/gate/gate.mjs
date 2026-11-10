#!/usr/bin/env node
/**
 * coding agent box — the network gate.
 *
 * The box sits on its own `--internal` Docker network: no route anywhere.
 * This gate is the only other container on that network, and inside the box
 * `host.docker.internal` points at it. It offers exactly four things:
 *
 *   1. TCP forwards for fixed ports (the LLM proxy and the guard daemon) to the
 *      real host. Any other port is simply not listened on: refused.
 *   2. An HTTP CONNECT proxy for a short, per-agent allow-list of hosts (the
 *      agent's own login, e.g. Claude's OAuth refresh) on port 443 only.
 *      Everything else gets 403 and one JSON line on stdout, which the
 *      launcher summarises when the box exits.
 *
 *   3. Read-only HTTP relays: GET of a fixed list of paths on a host service
 *      (the health coordinator's /health/state for the prompt hook). Any other
 *      method or path gets 403, so the rest of that service stays out of reach.
 *   4. MCP relays: one MCP endpoint (graphify's /mcp), where each JSON-RPC
 *      message is checked before it goes on. Only the listed tools can be
 *      called, and only on the server's default graph: a call that names a
 *      project_path is refused, because the services container sees every repo
 *      under ~/Agentic and the box must not.
 *
 * Runs from the box image as `nobody`, read-only, no capabilities. The agent
 * has no Docker socket, so it cannot reach into this container or change its
 * arguments. Plan: .planning/guardrail-hardening.md, "Box network".
 *
 *   node gate.mjs --target host.docker.internal --forward 12435 --forward 3035 \
 *     --connect 3128 --allow-file /opt/coding-box/egress-allow.json --agent claude \
 *     [--upstream http://host.docker.internal:3128] [--http-get 3034:/health/state] \
 *     [--mcp 3851:/mcp:query_graph,get_node]
 */

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const log = (obj, out = process.stdout) => out.write(`${JSON.stringify({ t: new Date().toISOString(), ...obj })}\n`);

/** "host:port" of a CONNECT request, or null for anything malformed. */
export function parseAuthority(s) {
  const m = /^\[?([A-Za-z0-9.-]+|[0-9a-fA-F:]+)\]?:(\d{1,5})$/.exec(String(s || ''));
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  return { host: m[1].toLowerCase(), port };
}

/** "port:/a,/b" → { port, paths }, or null for anything malformed. */
export function parseRelay(s) {
  const m = /^(\d{1,5}):(\/[A-Za-z0-9._\/-]*(?:,\/[A-Za-z0-9._\/-]*)*)$/.exec(String(s || ''));
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1 || port > 65535) return null;
  return { port, paths: m[2].split(',') };
}

/** "port:/path:tool,tool" → { port, path, tools }, or null for anything malformed. */
export function parseMcpRelay(s) {
  const m = /^(\d{1,5}):(\/[A-Za-z0-9._\/-]*):([A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*)$/.exec(String(s || ''));
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1 || port > 65535) return null;
  return { port, path: m[2], tools: m[3].split(',') };
}

/** JSON-RPC methods a client may send through an MCP relay: discovery, reads, tool calls. */
export const MCP_METHODS = [
  'initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read',
  'prompts/list', 'notifications/initialized', 'notifications/cancelled', 'notifications/progress',
];

/** Why the MCP message `msg` is refused, or null when it may pass. */
export function mcpRefusal(msg, tools) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'not a JSON-RPC message';
  if (msg.method === undefined) return null; // the client's answer to a server request
  if (!MCP_METHODS.includes(msg.method)) return `method ${msg.method}`;
  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    if (!tools.includes(name)) return `tool ${name}`;
    // graphify reads <project_path>/…/graph.json, with project_path resolved inside
    // the services container, which sees all of ~/Agentic. Empty means the default.
    if (msg.params?.arguments?.project_path) return 'project_path (the box queries the default graph only)';
  }
  return null;
}

/**
 * A tools/list answer with only the relayable tools in it, and without the
 * project_path argument, as JSON or as an SSE
 * stream of `data:` lines. Anything it cannot parse comes back unchanged.
 */
export function filterToolList(text, tools) {
  const keep = (line) => {
    try {
      const msg = JSON.parse(line);
      if (Array.isArray(msg?.result?.tools)) {
        msg.result.tools = msg.result.tools.filter((t) => tools.includes(t?.name));
        // Refused by mcpRefusal, so not offered either.
        for (const t of msg.result.tools) {
          delete t.inputSchema?.properties?.project_path;
          if (Array.isArray(t.inputSchema?.required)) t.inputSchema.required = t.inputSchema.required.filter((r) => r !== 'project_path');
        }
      }
      return JSON.stringify(msg);
    } catch { return line; }
  };
  if (!/^\s*(event:|data:|id:|:)/m.test(text)) return keep(text);
  return text.split('\n').map((l) => (l.startsWith('data: ') ? `data: ${keep(l.slice(6))}` : l)).join('\n');
}

/** Exact host names only — no wildcards, no IPs, so the list says precisely what is reachable. */
export function allowed(list, { host, port }, ports = [443]) {
  return ports.includes(port) && list.includes(host);
}

function pipeBoth(a, b) {
  a.on('error', () => b.destroy());
  b.on('error', () => a.destroy());
  a.pipe(b);
  b.pipe(a);
}

/** CONNECT through an upstream HTTP proxy (the host's web proxy); resolves the tunnel socket. */
function viaUpstream(upstream, { host, port }) {
  return new Promise((resolve, reject) => {
    const u = new URL(upstream);
    const sock = net.connect(Number(u.port || 80), u.hostname);
    let buf = Buffer.alloc(0);
    const fail = (err) => { sock.destroy(); reject(err); };
    sock.once('error', fail);
    sock.on('connect', () => sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`));
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      sock.off('data', onData);
      sock.off('error', fail);
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(buf.subarray(0, end).toString('latin1'));
      if (!status || status[1] !== '200') return fail(new Error(`upstream refused CONNECT (${status ? status[1] : 'bad reply'})`));
      const rest = buf.subarray(end + 4);
      if (rest.length) sock.unshift(rest);
      resolve(sock);
    };
    sock.on('data', onData);
  });
}

/**
 * Start the gate. Returns { servers, close() }. `listenHost` is where the
 * gate listens (all interfaces in the container); tests use 127.0.0.1.
 */
export async function createGate({
  target, forward = [], connectPort = null, allow = [], allowPorts = [443], upstream = null, httpGet = [], mcp = [],
  listenHost = '0.0.0.0', out = process.stdout,
}) {
  const servers = [];
  const listen = (srv, port) => new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, listenHost, () => resolve(srv.address().port));
  });

  const ports = {};
  for (const f of forward) {
    const { listen: lport, port } = typeof f === 'number' ? { listen: f, port: f } : f;
    const srv = net.createServer((client) => {
      const up = net.connect(port, target);
      up.on('error', (err) => log({ forward: port, error: err.code || err.message }, out));
      pipeBoth(client, up);
    });
    ports[port] = await listen(srv, lport);
    servers.push(srv);
  }

  for (const r of httpGet) {
    const { listen: lport, port, paths } = { listen: r.port, ...r };
    const srv = http.createServer((req, res) => {
      let pathname = null;
      try { pathname = new URL(req.url, 'http://gate').pathname; } catch { /* malformed: refused below */ }
      // Exact paths, GET only, and only the path goes upstream: no query, no
      // client headers, no body — a relay for reading one document, nothing more.
      if (req.method !== 'GET' || !paths.includes(pathname)) {
        log({ deny: `http://${target}:${port}${pathname ?? req.url}`, method: req.method }, out);
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('coding agent box: only GET of a fixed list of paths is relayed to this host service\n');
        return;
      }
      const up = http.request({ host: target, port, path: pathname, method: 'GET', headers: { accept: 'application/json' } }, (upRes) => {
        const headers = upRes.headers['content-type'] ? { 'content-type': upRes.headers['content-type'] } : {};
        res.writeHead(upRes.statusCode || 502, headers);
        upRes.pipe(res);
      });
      up.on('error', (err) => {
        log({ relay: port, error: err.code || err.message }, out);
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
        res.end();
      });
      up.end();
    });
    ports[`get:${port}`] = await listen(srv, lport);
    servers.push(srv);
  }

  for (const r of mcp) {
    const { listen: lport, port, path: mcpPath, tools } = { listen: r.port, ...r };
    const srv = http.createServer((req, res) => {
      let pathname = null;
      try { pathname = new URL(req.url, 'http://gate').pathname; } catch { /* malformed: refused below */ }
      const refuse = (status, why, id) => {
        log({ deny: `mcp://${target}:${port}${pathname ?? req.url}`, method: req.method, why }, out);
        if (id !== undefined) {
          // A refused request still gets its JSON-RPC answer, so the agent sees why.
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32001, message: `coding agent box: ${why} is not allowed here` } }));
          return;
        }
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.end(`coding agent box: ${why} is not allowed here\n`);
      };
      if (pathname !== mcpPath || !['POST', 'GET', 'DELETE'].includes(req.method)) return refuse(403, `${req.method} ${pathname}`);

      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 1024 * 1024) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        let listing = false;
        if (req.method === 'POST') {
          let msgs;
          try { msgs = JSON.parse(body.toString('utf8')); } catch { return refuse(400, 'a body that is not JSON'); }
          const list = Array.isArray(msgs) ? msgs : [msgs];
          for (const m of list) {
            const why = mcpRefusal(m, tools);
            if (why) return refuse(403, why, Array.isArray(msgs) ? undefined : m?.id);
          }
          listing = list.some((m) => m?.method === 'tools/list');
        }
        // Only what the MCP transport needs goes upstream: no cookies or auth.
        const headers = {};
        for (const h of ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']) {
          if (req.headers[h]) headers[h] = req.headers[h];
        }
        if (body.length) headers['content-length'] = String(body.length);
        const up = http.request({ host: target, port, path: mcpPath, method: req.method, headers }, (upRes) => {
          const back = {};
          for (const h of ['content-type', 'mcp-session-id', 'cache-control']) if (upRes.headers[h]) back[h] = upRes.headers[h];
          if (!listing) {
            res.writeHead(upRes.statusCode || 502, back);
            upRes.pipe(res);
            return;
          }
          // The tool list is short: read it whole and drop the tools the box cannot call.
          const parts = [];
          upRes.on('data', (c) => parts.push(c));
          upRes.on('end', () => {
            res.writeHead(upRes.statusCode || 502, back);
            res.end(filterToolList(Buffer.concat(parts).toString('utf8'), tools));
          });
        });
        up.on('error', (err) => {
          log({ relay: port, error: err.code || err.message }, out);
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
          res.end();
        });
        res.on('close', () => up.destroy());
        up.end(body);
      });
    });
    ports[`mcp:${port}`] = await listen(srv, lport);
    servers.push(srv);
  }

  if (connectPort !== null) {
    const proxy = http.createServer((req, res) => {
      // Plain-HTTP proxying is never offered: only CONNECT to allow-listed hosts.
      log({ deny: req.headers.host || req.url, method: req.method }, out);
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('coding agent box: only the LLM proxy and the guard are reachable (see the box network docs)\n');
    });
    proxy.on('connect', async (req, client, head) => {
      const dest = parseAuthority(req.url);
      if (!dest || !allowed(allow, dest, allowPorts)) {
        log({ deny: req.url }, out);
        client.end('HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\ncoding agent box: host not on the allow-list\n');
        return;
      }
      try {
        const up = upstream ? await viaUpstream(upstream, dest) : await new Promise((resolve, reject) => {
          const s = net.connect(dest.port, dest.host, () => resolve(s));
          s.once('error', reject);
        });
        log({ allow: `${dest.host}:${dest.port}` }, out);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) up.write(head);
        pipeBoth(client, up);
      } catch (err) {
        log({ allow: `${dest.host}:${dest.port}`, error: err.message }, out);
        client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      }
    });
    ports.connect = await listen(proxy, connectPort);
    servers.push(proxy);
  }

  return {
    servers,
    ports,
    close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(() => r())))),
  };
}

/** argv → options. Unknown flags are an error: the launcher builds this argv. */
export function parseArgs(argv) {
  const o = { forward: [], httpGet: [], mcp: [], allowFile: null, agent: null, target: null, connectPort: null, upstream: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--target': o.target = v; i++; break;
      case '--forward': o.forward.push(Number(v)); i++; break;
      case '--connect': o.connectPort = Number(v); i++; break;
      case '--allow-file': o.allowFile = v; i++; break;
      case '--agent': o.agent = v; i++; break;
      case '--upstream': o.upstream = v || null; i++; break;
      case '--http-get': {
        const r = parseRelay(v);
        if (!r) throw new Error(`gate: bad --http-get ${v}`);
        o.httpGet.push(r); i++; break;
      }
      case '--mcp': {
        const r = parseMcpRelay(v);
        if (!r) throw new Error(`gate: bad --mcp ${v}`);
        o.mcp.push(r); i++; break;
      }
      default: throw new Error(`gate: unknown argument ${argv[i]}`);
    }
  }
  if (!o.target) throw new Error('gate: --target is required');
  if (o.forward.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error('gate: bad --forward port');
  return o;
}

/** The agent's allow-list from the committed file (missing agent → nothing). */
export function allowListFor(file, agent) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = doc.agents?.[agent] ?? [];
  if (!Array.isArray(list) || list.some((h) => typeof h !== 'string' || !/^[a-z0-9.-]+$/.test(h))) {
    throw new Error(`gate: bad allow-list for ${agent} in ${file}`);
  }
  return list;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    const allow = o.allowFile ? allowListFor(o.allowFile, o.agent) : [];
    const gate = await createGate({ target: o.target, forward: o.forward, connectPort: o.connectPort, allow, upstream: o.upstream, httpGet: o.httpGet, mcp: o.mcp });
    log({ ready: true, forward: o.forward, connect: o.connectPort, allow, upstream: o.upstream, httpGet: o.httpGet, mcp: o.mcp });
    const stop = () => gate.close().then(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch (err) {
    log({ fatal: err.message }, process.stderr);
    process.exit(1);
  }
}
