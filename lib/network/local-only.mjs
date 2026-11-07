/**
 * Local-only HTTP exposure for the host services (obs-api :12436, health
 * coordinator :3034).
 *
 * Three layers, each closing a different door:
 *
 *  1. listenLocal() — bind loopback (IPv4 + IPv6) instead of every interface.
 *     Containers still reach the host: Docker Desktop (macOS, Windows, WSL)
 *     forwards host.docker.internal to the host's loopback; native Linux
 *     Docker resolves it to the docker0 bridge, so that address is bound too.
 *  2. Host-header allow-list — a page that DNS-rebinds its own name to
 *     127.0.0.1 sends `Host: evil.example`, which is refused. Without this,
 *     loopback binding alone still lets any web page READ the knowledge base.
 *  3. Origin allow-list — CORS answers only loopback origins, and a
 *     state-changing request that carries a non-loopback Origin is refused
 *     (cross-site writes from a web page). Clients without an Origin header
 *     — curl, the transcript monitors, containers — are not browsers and pass.
 *
 * This does NOT stop a process running as the user (an agent with Bash) from
 * calling the APIs; that needs the privilege boundary of Phase 1
 * (.planning/guardrail-hardening.md).
 *
 * Escape hatches: CODING_BIND_HOST (one explicit listen address, e.g. 0.0.0.0
 * for a deliberate remote setup), CODING_ALLOWED_HOSTS and
 * CODING_ALLOWED_ORIGINS (comma-separated additions).
 */

import http from 'node:http';
import os from 'node:os';
import net from 'node:net';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function splitEnv(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Hostname of a Host header or URL host, without port or IPv6 brackets. */
export function hostnameOf(host) {
  if (!host) return '';
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  const parts = h.split(':');
  return parts.length === 2 ? parts[0] : h; // bare IPv6 has many colons
}

export function isLoopbackHostname(name) {
  return LOOPBACK_NAMES.has(name) || name.endsWith('.localhost') || /^127\./.test(name);
}

/**
 * Addresses to listen on. Loopback both families, plus docker0's IPv4 on a
 * host that has one (native Linux Docker: host.docker.internal = docker0).
 */
export function listenAddresses({ env = process.env, interfaces = os.networkInterfaces() } = {}) {
  if (env.CODING_BIND_HOST) return [env.CODING_BIND_HOST];
  const addrs = ['127.0.0.1', '::1'];
  for (const iface of interfaces.docker0 || []) {
    if (iface.family === 'IPv4' || iface.family === 4) addrs.push(iface.address);
  }
  return addrs;
}

/**
 * Listen `handler` (an Express app or request listener) on every local
 * address. Returns the first server; the callback runs once all are bound.
 * A missing IPv6 stack (EADDRNOTAVAIL/EAFNOSUPPORT on ::1) is tolerated; any
 * other bind error — EADDRINUSE above all — is emitted on the returned
 * server, where callers already handle it.
 */
export function listenLocal(handler, port, onListening, opts = {}) {
  const addrs = listenAddresses(opts);
  const servers = addrs.map(() => http.createServer(handler));
  const primary = servers[0];
  let pending = servers.length;
  const done = () => { if (--pending === 0 && onListening) onListening(addrs); };

  servers.forEach((server, i) => {
    const addr = addrs[i];
    if (i > 0) {
      server.on('error', (err) => {
        if (net.isIPv6(addr) && (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT')) {
          done();
          return;
        }
        primary.emit('error', err);
      });
    }
    server.listen(port, addr, done);
  });

  const closePrimary = primary.close.bind(primary);
  primary.close = (cb) => {
    servers.slice(1).forEach((s) => s.close());
    return closePrimary(cb);
  };
  return primary;
}

/** True when the Host header names this machine (not a rebinding domain). */
export function isAllowedHost(hostHeader, env = process.env) {
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  if (isLoopbackHostname(name) || net.isIP(name)) return true;
  return splitEnv(env.CODING_ALLOWED_HOSTS).map((h) => h.toLowerCase()).includes(name);
}

/** True when a browser Origin is a local page (any port) or explicitly allowed. */
export function isAllowedOrigin(origin, env = process.env) {
  if (!origin) return false;
  if (splitEnv(env.CODING_ALLOWED_ORIGINS).includes(origin)) return true;
  try {
    return isLoopbackHostname(hostnameOf(new URL(origin).host));
  } catch {
    return false;
  }
}

/**
 * Express middleware: Host check, CORS for loopback origins only, and refusal
 * of cross-origin state-changing requests. Replaces `app.use(cors())`.
 */
export function localOnly({ env = process.env } = {}) {
  return (req, res, next) => {
    if (!isAllowedHost(req.headers.host, env)) {
      res.status(403).json({ error: 'forbidden host', host: req.headers.host || null });
      return;
    }

    const origin = req.headers.origin;
    const originOk = origin ? isAllowedOrigin(origin, env) : false;
    if (originOk) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
      const requested = req.headers['access-control-request-headers'];
      if (requested) res.setHeader('Access-Control-Allow-Headers', requested);
    }

    if (req.method === 'OPTIONS' && origin) {
      res.status(originOk ? 204 : 403).end();
      return;
    }
    if (origin && !originOk && !SAFE_METHODS.has(req.method)) {
      res.status(403).json({ error: 'forbidden origin', origin });
      return;
    }
    next();
  };
}
