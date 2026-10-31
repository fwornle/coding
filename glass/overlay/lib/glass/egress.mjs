// lib/glass/egress.mjs — how the daemon reaches the real upstreams.
//
// undici's EnvHttpProxyAgent honours HTTPS_PROXY / HTTP_PROXY / NO_PROXY from the
// daemon's own environment (the user's corporate proxy, if any) — Node's built-in
// fetch ignores them on the Node 22 floor. A proxy URL that points back at glass
// itself is dropped: following it would loop.
import { fetch as undiciFetch, EnvHttpProxyAgent } from 'undici';
import { LOCAL_PROXY_PORT } from '../network/location-probe.mjs';

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

const PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'];

/**
 * Just the proxy settings of an environment — what `glass <agent>` sends the
 * daemon with each new session, so the daemon follows the shell you are in now
 * rather than the one that happened to start it.
 */
export function proxyEnvOf(env = {}) {
  const out = {};
  for (const k of PROXY_KEYS) if (typeof env[k] === 'string') out[k] = env[k];
  return out;
}

/** NO_PROXY of an environment, '' when unset. */
export function noProxyOf(env = {}) {
  return env.NO_PROXY ?? env.no_proxy ?? '';
}

const LOCAL_PROXY = `http://127.0.0.1:${LOCAL_PROXY_PORT}`;

/** Does this proxy URL name the local proxy (proxydetox on :3128)? */
function isLocalProxy(proxy) {
  try {
    const u = new URL(proxy);
    return LOCAL_PROXY_PORT === Number(u.port || 80) && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * The proxy settings egress uses: the newest session's shell, unless the network
 * monitor's last completed probe shows them wrong for where the machine is now.
 * A shell keeps the proxy variables of the network it was opened on, so a
 * session from a VPN shell left glass tunnelling through a :3128 that refused
 * every CONNECT at home (2026-10-24), and a session from a home shell left it
 * going direct on the corporate network, where direct egress is blocked.
 *   open internet, the shell names the local proxy, which does not forward → direct
 *   CN / VPN, the shell names no proxy, the local proxy forwards → the local proxy
 * Anything else — another proxy, an unprobed network, a proxy that forwards — is
 * the shell's choice and kept.
 * @param {object} shellEnv  proxyEnvOf() of the newest session's shell
 * @param {object|null} network  createNetworkMonitor().facts()
 * @param {number} port  glass's own port
 * @returns {{ env: object, why: string }}  why: '' when the shell's settings stand
 */
export function egressEnvFor(shellEnv, network, port) {
  if (!network?.last_probe_end) return { env: shellEnv, why: '' };
  const proxy = upstreamProxy(shellEnv, port);
  const forwards = Boolean(network.proxy_running && network.proxy_functional);
  const open = network.location === 'open' || network.location === 'home';
  const corporate = network.location === 'corporate' || network.location === 'vpn';
  if (proxy && isLocalProxy(proxy) && open && !forwards) {
    return { env: {}, why: `open internet and the local proxy on :${LOCAL_PROXY_PORT} does not forward` };
  }
  if (!proxy && corporate && forwards) {
    const noProxy = noProxyOf(shellEnv) || 'localhost,127.0.0.1,::1';
    return {
      env: { HTTPS_PROXY: LOCAL_PROXY, HTTP_PROXY: LOCAL_PROXY, NO_PROXY: noProxy },
      why: `${network.location === 'vpn' ? 'VPN' : 'corporate network'}: direct egress is blocked and the local proxy forwards`,
    };
  }
  return { env: shellEnv, why: '' };
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
    + 'The proxy could not reach it: check that this machine has internet at all; on the corporate network, '
    + 'that a Kerberos ticket exists (klist); right after a network change the local proxy may need a restart.');
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
