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

/** fetch through the environment's proxy (minus glass itself). */
export function createEgressFetch(env, port) {
  const proxy = upstreamProxy(env, port);
  const dispatcher = new EnvHttpProxyAgent(proxy
    ? { httpProxy: proxy, httpsProxy: proxy, noProxy: env.NO_PROXY ?? env.no_proxy ?? '' }
    : { httpProxy: '', httpsProxy: '', noProxy: '' });
  return (url, init = {}) => undiciFetch(url, { ...init, dispatcher });
}
