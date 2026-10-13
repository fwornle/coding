// lib/glass/egress.mjs — how the daemon reaches the real upstreams.
//
// undici's EnvHttpProxyAgent honours HTTPS_PROXY / HTTP_PROXY / NO_PROXY from the
// daemon's own environment (the user's corporate proxy, if any) — Node's built-in
// fetch ignores them on the Node 22 floor. A proxy URL that points back at glass
// itself is dropped: following it would loop.
import { fetch as undiciFetch, EnvHttpProxyAgent } from 'undici';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** The daemon's upstream proxy URL (or null), never glass's own port. */
export function upstreamProxy(env, port) {
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '';
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (LOOPBACK.has(u.hostname) && Number(u.port || 80) === port) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// How long a refused tunnel is remembered per host. The forward retries a
// network error twice within ~1.2 s (forwardWithRetry); asking the same proxy
// again that soon only makes the user wait for the same refusal.
export const TUNNEL_REFUSAL_MEMORY_MS = 10_000;

/**
 * The status an upstream proxy refused a CONNECT with, from undici's error
 * (three causes deep: "Proxy response (502) !== 200 when HTTP Tunneling"), or
 * null when the failure was anything else.
 */
export function tunnelRefusalStatus(err) {
  for (let c = err, i = 0; c && i < 6; c = c.cause, i++) {
    const m = /Proxy response \((\d{3})\) !== 200 when HTTP Tunneling/.exec(c.message || '');
    if (m) return Number(m[1]);
  }
  return null;
}

function refusalError(proxy, host, status) {
  const err = new Error(`the upstream proxy ${proxy} refused the tunnel to ${host} (HTTP ${status}). `
    + 'On the corporate network: check the Kerberos ticket (klist); right after a network change the local proxy may need a restart.');
  err.code = 'GLASS_TUNNEL_REFUSED';
  return err;
}

/**
 * fetch through the environment's proxy (minus glass itself). A tunnel the
 * proxy refuses fails with an error that says so instead of "fetch failed",
 * and the same host fails at once for TUNNEL_REFUSAL_MEMORY_MS.
 * @param {object} [o]
 * @param {(r: {host: string, status: number, at: number}) => void} [o.onRefusal]
 * @param {() => number} [o.now]
 */
export function createEgressFetch(env, port, { onRefusal = () => {}, now = Date.now } = {}) {
  const proxy = upstreamProxy(env, port);
  const dispatcher = new EnvHttpProxyAgent(proxy
    ? { httpProxy: proxy, httpsProxy: proxy, noProxy: env.NO_PROXY ?? env.no_proxy ?? '' }
    : { httpProxy: '', httpsProxy: '', noProxy: '' });
  const refused = new Map();
  return async (url, init = {}) => {
    const host = new URL(url).host;
    const r = refused.get(host);
    if (r && now() - r.at < TUNNEL_REFUSAL_MEMORY_MS) throw refusalError(proxy, host, r.status);
    try {
      const res = await undiciFetch(url, { ...init, dispatcher });
      refused.delete(host);
      return res;
    } catch (err) {
      const status = proxy ? tunnelRefusalStatus(err) : null;
      if (status === null) throw err;
      const at = now();
      refused.set(host, { status, at });
      onRefusal({ host, status, at });
      throw refusalError(proxy, host, status);
    }
  };
}
