#!/usr/bin/env node
/**
 * coding agent box — the network gate.
 *
 * The box sits on its own `--internal` Docker network: no route anywhere.
 * This gate is the only other container on that network, and inside the box
 * `host.docker.internal` points at it. It offers exactly two things:
 *
 *   1. TCP forwards for fixed ports (the LLM proxy and the guard daemon) to the
 *      real host. Any other port is simply not listened on: refused.
 *   2. An HTTP CONNECT proxy for a short, per-agent allow-list of hosts (the
 *      agent's own login, e.g. Claude's OAuth refresh) on port 443 only.
 *      Everything else gets 403 and one JSON line on stdout, which the
 *      launcher summarises when the box exits.
 *
 * Runs from the box image as `nobody`, read-only, no capabilities. The agent
 * has no Docker socket, so it cannot reach into this container or change its
 * arguments. Plan: .planning/guardrail-hardening.md, "Box network".
 *
 *   node gate.mjs --target host.docker.internal --forward 12435 --forward 3035 \
 *     --connect 3128 --allow-file /opt/coding-box/egress-allow.json --agent claude \
 *     [--upstream http://host.docker.internal:3128]
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
  target, forward = [], connectPort = null, allow = [], allowPorts = [443], upstream = null,
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
  const o = { forward: [], allowFile: null, agent: null, target: null, connectPort: null, upstream: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--target': o.target = v; i++; break;
      case '--forward': o.forward.push(Number(v)); i++; break;
      case '--connect': o.connectPort = Number(v); i++; break;
      case '--allow-file': o.allowFile = v; i++; break;
      case '--agent': o.agent = v; i++; break;
      case '--upstream': o.upstream = v || null; i++; break;
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
    const gate = await createGate({ target: o.target, forward: o.forward, connectPort: o.connectPort, allow, upstream: o.upstream });
    log({ ready: true, forward: o.forward, connect: o.connectPort, allow, upstream: o.upstream });
    const stop = () => gate.close().then(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch (err) {
    log({ fatal: err.message }, process.stderr);
    process.exit(1);
  }
}
