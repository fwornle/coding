/**
 * lib/network/location-probe.mjs — where this machine is (N) and how it gets
 * out (P): the probes and rules behind the [N:… P:…] badge.
 *
 * One definition, two readers: the health coordinator (which publishes the
 * facts on /health/state and heals proxydetox from them) and glass's daemon
 * (which only shows them). Moved here from scripts/health-coordinator.js so
 * the two cannot drift into disagreeing about what "CN" means.
 *
 * N (network location) — NEVER influenced by the proxy:
 *   'vpn'        Cisco Secure Client says Connected (definitive), or the PAC
 *                host resolves but answers slowly
 *   'corporate'  the PAC host resolves and answers in < 100 ms (on-site)
 *   'open'       no corporate name resolves — home / public internet
 *
 * P (local proxy) — NEVER influences N:
 *   ON    proxydetox on :3128 is up and forwards, and the user's `px` toggle
 *         is on (an uncommented `http_proxy=` line in ~/.bash_profile)
 *   AUTO  up and forwarding, toggle off (adaptive / --direct-fallback)
 *   OFF   not listening, or not forwarding
 *
 * The probes take their process / socket / DNS primitives as options, so the
 * rules are unit tests rather than something you check by unplugging a laptop.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';
import { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process';

// Reachability probe target. MUST be reachable from every network we run on,
// including the CN corporate network where GitHub is throttled/blocked by the
// GFW. `captive.apple.com` is a tiny fixed "Success" page served from Apple's
// globally-distributed CDN (reachable in mainland China), the de-facto standard
// captive-portal check — fast, unauthenticated, and returns HTTP 200. Do NOT
// use api.github.com here: it produces false "Internet Unreachable" errors in CN.
export const REACHABILITY_HOST = process.env.HEALTH_REACHABILITY_HOST || 'captive.apple.com';
// The corporate host: resolving it means corporate DNS, its latency separates
// on-site from VPN, and the coordinator proxies to it to tell "proxydetox is
// broken" from "the network behind it is".
export const PAC_HOST = process.env.HEALTH_PAC_HOST || 'muc.proxy-pac.bmwgroup.net';
export const LOCAL_PROXY_PORT = 3128;
export const ON_SITE_LATENCY_MS = 100;
// A single transient probe failure must not flip P to OFF (see publishedFunctional).
export const FUNCTIONAL_FAIL_THRESHOLD = 3;

const VPN_CLI = {
  darwin: '/opt/cisco/secureclient/bin/vpn',
  linux: '/opt/cisco/secureclient/bin/vpn',
  win32: 'C:\\Program Files (x86)\\Cisco\\Cisco Secure Client\\vpncli.exe',
};

const execFileAsync = (execFile, file, args, opts) => new Promise((resolve, reject) => {
  execFile(file, args, opts, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

/** Is something accepting TCP connections on host:port? */
export function probePortListening({ host = '127.0.0.1', port = LOCAL_PROXY_PORT, timeoutMs = 2000, connect = net.connect } = {}) {
  return new Promise((resolve) => {
    const sock = connect({ host, port, timeout: timeoutMs });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

/**
 * The user's `px` toggle: the persistent line in ~/.bash_profile written by
 * ~/proxy.sh. proxydetox is a launchctl daemon that's always running, so
 * :3128 alone says nothing about intent.
 *   "http_proxy=..."  → enabled (user ran `px` to enable)
 *   "#http_proxy=..." → disabled (user ran `px` to disable)
 */
export function readProxyEnabledByUser({ home = os.homedir(), readFile = fs.readFileSync } = {}) {
  try {
    return /^http_proxy=/m.test(readFile(path.join(home, '.bash_profile'), 'utf8'));
  } catch {
    return false; // file missing — treat as disabled
  }
}

/** Can the local proxy actually forward a request (not just accept TCP)? */
export async function probeProxyFunctional({
  port = LOCAL_PROXY_PORT, host = REACHABILITY_HOST, execFile = nodeExecFile, platform = process.platform,
} = {}) {
  // Async (non-blocking) — a sync exec here froze the coordinator's event loop
  // for up to 8s per poll.
  try {
    const stdout = await execFileAsync(execFile, 'curl', [
      '-s', '--connect-timeout', '3', '--max-time', '5',
      '-x', `http://127.0.0.1:${port}`,
      '-o', platform === 'win32' ? 'NUL' : '/dev/null', '-w', '%{http_code}',
      `https://${host}`,
    ], { timeout: 8000 });
    return stdout.trim() === '200';
  } catch {
    return false;
  }
}

/**
 * Consecutive raw functional failures. Only counted while the port listens: a
 * dead port is its own, hard signal. `>= FUNCTIONAL_FAIL_THRESHOLD` confirms an
 * outage.
 */
export function countFunctionalFailures({ raw, portListening, failures = 0 }) {
  const count = Number.isFinite(failures) && failures > 0 ? failures : 0;
  if (!portListening) return count;
  return raw ? 0 : count + 1;
}

/**
 * The published functional state. A live pass is reported at once; a raw miss
 * holds the previous value until the outage is confirmed, so one blip cannot
 * flap the badge to P:OFF. A dead port is not debounced.
 */
export function publishedFunctional({ raw, confirmed, portListening, previous = false }) {
  if (raw) return true;
  if (confirmed || !portListening) return false;
  return previous;
}

/**
 * Cisco Secure Client's own verdict. The CLI drops into an interactive VPN>
 * prompt after its output, so stdin is closed and it is killed on a timeout.
 */
export function probeVpnConnected({ platform = process.platform, spawn = nodeSpawn, timeoutMs = 3000 } = {}) {
  const bin = VPN_CLI[platform];
  if (!bin) return Promise.resolve(false);
  return new Promise((resolve) => {
    let stdout = '';
    let child;
    try {
      child = spawn(bin, ['state'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs, windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.on('close', () => resolve(/state:\s*Connected/i.test(stdout)));
    child.on('error', () => resolve(false));
    setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs).unref?.();
  });
}

/**
 * Does the PAC host resolve (corporate DNS)? `dig`, not Node's resolver: c-ares
 * caches the system DNS servers from process start, so a process started on a
 * hotspot would never resolve internal names after moving to the office LAN.
 * Where there is no dig (Windows), getaddrinfo — the OS resolver, read afresh
 * on every call.
 *
 * +tries=2: this single lookup decides the whole location verdict, and a lost
 * UDP packet is not evidence of anything.
 */
export async function probePacResolves({ host = PAC_HOST, execFile = nodeExecFile, lookup = dns.promises.lookup } = {}) {
  try {
    const out = await execFileAsync(execFile, 'dig', ['+short', '+timeout=2', '+tries=2', host, 'A'], { timeout: 6000, encoding: 'utf8' });
    return /\d+\.\d+\.\d+\.\d+/.test(out.trim());
  } catch (err) {
    if (err?.code !== 'ENOENT') return false;
  }
  try {
    const r = await lookup(host, { family: 4 });
    return Boolean(r?.address);
  } catch {
    return false;
  }
}

/** On-site or VPN, once the PAC host resolves: TCP connect latency to it. */
export function probePacOnSite({ host = PAC_HOST, connect = net.connect, onLatency = () => {} } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = connect({ host, port: 80, timeout: 2000 });
    sock.once('connect', () => {
      const ms = Date.now() - start;
      onLatency(ms);
      sock.destroy();
      resolve(ms < ON_SITE_LATENCY_MS);
    });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

/** This tick's location from the three signals (before settleLocation's hysteresis). */
export function classifyLocation({ vpnConnected, pacResolved, onPhysicalCN }) {
  if (vpnConnected) return 'vpn';                     // Cisco says connected — definitive
  if (pacResolved && onPhysicalCN) return 'corporate'; // PAC resolves + low latency = on-site
  if (pacResolved) return 'vpn';                      // PAC resolves + high latency = VPN (CLI missed?)
  return 'open';                                      // no corporate access whatsoever
}

/** The three N signals in order — latency only when needed — and their verdict. */
export async function observeLocation(probes = {}) {
  const vpn = probes.vpn || probeVpnConnected;
  const pac = probes.pac || probePacResolves;
  const onSite = probes.onSite || probePacOnSite;
  const vpnConnected = await vpn();
  const pacResolved = await pac();
  const onPhysicalCN = pacResolved && !vpnConnected ? await onSite() : false;
  return { vpnConnected, pacResolved, onPhysicalCN, observed: classifyLocation({ vpnConnected, pacResolved, onPhysicalCN }) };
}

const LOCATION_LABEL = { corporate: 'CN', vpn: 'VPN', open: 'OPEN', home: 'OPEN', unknown: '??' };

/**
 * The badge halves from published network facts.
 * @returns {{ n: string, p: string, text: string, warn: boolean }}  warn: on CN/VPN
 *   without a working local proxy — external APIs are unreachable
 */
export function networkBadge(network) {
  const loc = network?.location || 'unknown';
  const n = LOCATION_LABEL[loc] || loc.toUpperCase().slice(0, 4);
  const up = Boolean(network?.proxy_running && network?.proxy_functional);
  const p = !up ? 'OFF' : network?.proxy_enabled_by_user ? 'ON' : 'AUTO';
  return { n, p, text: `N:${n} P:${p}`, warn: (loc === 'corporate' || loc === 'vpn') && !up };
}
