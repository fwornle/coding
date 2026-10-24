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

// Plain internet reachability, used DIRECT (bypassing any proxy): does this
// machine have internet at all. `captive.apple.com` is a tiny fixed "Success"
// page, the de-facto captive-portal check — fast, unauthenticated, HTTP 200.
export const REACHABILITY_HOST = process.env.HEALTH_REACHABILITY_HOST || 'captive.apple.com';
// Whether proxydetox FORWARDS — the P half. Must be a host the corporate proxy
// has to carry, never one the network lets through on its own: N:CN is the
// corporate network (not China), and there captive.apple.com passes even when
// every tunnel the agents need is refused. Measured 2026-10-13 09:30-13:48 on
// CN: the captive.apple.com probe through :3128 passed 760 times while every
// CONNECT to api.github.com / copilot-api through :3128 returned 502 — P read
// AUTO for four hours of total outage. api.github.com is what the agents need
// and what rapid-llm-proxy's egress check probes (EGRESS_PROBE_URL), so the two
// agree. Probed with a bare CONNECT (probeProxyFunctional): the tunnel is what
// failed, and nothing needs to reach GitHub to prove it opens.
export const PROXY_PROBE_HOST = process.env.HEALTH_PROXY_PROBE_HOST || 'api.github.com';
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
  // WSL: the client is installed on the Windows host, not in the distro, and
  // WSL interop runs the Windows CLI from here.
  wsl: '/mnt/c/Program Files (x86)/Cisco/Cisco Secure Client/vpncli.exe',
};

/** Linux running under WSL (both WSL 1 and 2 put "microsoft" in the kernel release). */
export function isWsl({ platform = process.platform, release = os.release(), env = process.env } = {}) {
  return platform === 'linux' && (Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(release));
}

// windowsHide: the glass daemon runs these with no console of its own, and a
// console program (curl, dig) started from one gets a fresh window on Windows —
// a flash every probe interval.
const execFileAsync = (execFile, file, args, opts) => new Promise((resolve, reject) => {
  execFile(file, args, { ...opts, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
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

/**
 * Can the local proxy actually open a tunnel to a host that needs it (not just
 * accept TCP)? A bare CONNECT to PROXY_PROBE_HOST:443: the proxy answers 200
 * once its upstream connected, and refuses with 502 (proxydetox) or 407 when
 * the corporate proxy will not carry it. Nothing is sent through the tunnel —
 * the agents' own failure mode is the tunnel, and an HTTPS request per poll
 * would only run into GitHub's anonymous rate limit. No child process either,
 * so nothing can flash a console window on Windows.
 */
export function probeProxyFunctional({
  port = LOCAL_PROXY_PORT, host = PROXY_PROBE_HOST, timeoutMs = 5000, connect = net.connect,
} = {}) {
  return new Promise((resolve) => {
    let done = false;
    let head = '';
    const finish = (ok) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    const sock = connect({ host: '127.0.0.1', port, timeout: timeoutMs });
    sock.once('connect', () => sock.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
    sock.on('data', (chunk) => {
      head += String(chunk);
      const eol = head.indexOf('\r\n');
      if (eol >= 0) finish(/^HTTP\/1\.[01] 200\b/.test(head.slice(0, eol)));
    });
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
    sock.once('close', () => finish(false));
  });
}

/**
 * Does this user hold a Kerberos ticket? proxydetox authenticates to the
 * corporate proxy with it (`--negotiate`), so on CN / VPN no ticket means no
 * tunnel for anything that needs the proxy. `klist -s` is silent and exits 0
 * only with a valid, unexpired ticket. null where it cannot be told (no klist,
 * Windows' klist has no -s).
 * @returns {Promise<boolean|null>}
 */
export async function probeKerberosTicket({ execFile = nodeExecFile, platform = process.platform } = {}) {
  if (platform === 'win32') return null;
  return new Promise((resolve) => {
    execFile('klist', ['-s'], { timeout: 3000, windowsHide: true }, (err) => {
      if (!err) return resolve(true);
      resolve(err.code === 'ENOENT' ? null : false);
    });
  });
}

/**
 * Ask macOS's Kerberos SSO extension for a ticket now, instead of waiting for
 * it to notice the network on its own. Measured 2026-10-14: the overnight
 * ticket had expired, VPN came up at 05:27:52 and the extension issued a TGT
 * only at 05:30:12 — 2m20s in which every tunnel through :3128 was refused and
 * `coding --claude` showed "502 proxy forward failed". `app-sso -a REALM -R -q`
 * requests a fresh TGT without a dialog when the password is in the keychain
 * (11.7s measured on VPN); with no saved password it shows the extension's own
 * login dialog, which is the prompt the user needs anyway.
 *
 * Fire-and-forget: resolves to the list of realms it asked for (empty when
 * there is no extension or no realm), never rejects, and never waits for the
 * ticket — the next `klist -s` poll sees it land.
 *
 * macOS only. Linux and WSL have no extension to ask — `kinit` needs the
 * password, so K:NO there is the user's cue to run it; WSL keeps its own
 * credential cache, apart from the Windows logon's. Windows renews the logon
 * session's tickets itself.
 * @returns {Promise<string[]>}
 */
export async function requestKerberosTicket({ execFile = nodeExecFile, platform = process.platform } = {}) {
  if (platform !== 'darwin') return [];
  const realms = await new Promise((resolve) => {
    execFile('app-sso', ['-l', '-j'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const list = JSON.parse(String(stdout));
        resolve(Array.isArray(list) ? list.filter((r) => typeof r === 'string' && r) : []);
      } catch { resolve([]); }
    });
  });
  for (const realm of realms) {
    // Not awaited: the refresh takes ~12s and the network poll has 15s in all.
    execFile('app-sso', ['-a', realm, '-R', '-q'], { timeout: 60_000 }, () => {});
  }
  return realms;
}

/**
 * How soon the next network probe runs. Every 15 s normally; every 5 s while
 * the path an agent needs is broken and a heal or a ticket is on its way — on
 * CN / VPN with the local proxy not forwarding, or no Kerberos ticket. That is
 * when a faster probe shortens the outage: the heal is confirmed, and the LLM
 * proxy nudged, one 15 s cycle sooner. Off the corporate network the local
 * proxy is not on the path, so a failure there is no reason to probe faster.
 *
 * This replaced a check of `network.proxy_enabled`, a field nothing wrote, so
 * the fast cadence had never once applied.
 * @param {{location?: string, proxy_functional?: boolean, kerberos_ticket?: boolean|null}} network
 * @returns {number} milliseconds
 */
export function networkProbeIntervalMs(network = {}) {
  const onCorp = network.location === 'corporate' || network.location === 'vpn';
  const broken = network.proxy_functional !== true || network.kerberos_ticket === false;
  return onCorp && broken ? 5_000 : 15_000;
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
export function probeVpnConnected({ platform = process.platform, wsl = isWsl({ platform }), spawn = nodeSpawn, timeoutMs = 3000 } = {}) {
  const bin = VPN_CLI[wsl ? 'wsl' : platform];
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
  if (!host) return false; // no corporate host configured: never on the corporate network
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
 * @returns {{ n: string, p: string, k: boolean, offline: boolean, text: string, warn: boolean }}  warn: on
 *   CN/VPN without a working local proxy, or without the Kerberos ticket the proxy
 *   authenticates with — external APIs are unreachable. `K:NO` is appended only then;
 *   off the corporate network the ticket does not matter and is not shown.
 *   `OFFLINE` (and warn) off the corporate network when a completed probe found no
 *   internet, direct or proxied — the proxy is not the cause and cannot be the cure.
 */
export function networkBadge(network) {
  const loc = network?.location || 'unknown';
  const n = LOCATION_LABEL[loc] || loc.toUpperCase().slice(0, 4);
  const up = Boolean(network?.proxy_running && network?.proxy_functional);
  const p = !up ? 'OFF' : network?.proxy_enabled_by_user ? 'ON' : 'AUTO';
  const corporate = loc === 'corporate' || loc === 'vpn';
  // internet_reachable is false before the first probe too; last_probe_end tells them apart.
  // Not on CN / VPN: there direct egress is blocked by design, so a dead proxy
  // or a missing ticket reads the same way and has its own label.
  const offline = !corporate && network?.internet_reachable === false && Boolean(network?.last_probe_end);
  const noTicket = corporate && network?.kerberos_ticket === false;
  const tail = offline ? ' OFFLINE' : noTicket ? ' K:NO' : '';
  return { n, p, k: !noTicket, offline, text: `N:${n} P:${p}${tail}`, warn: offline || (corporate && (!up || noTicket)) };
}

/**
 * Does this machine reach the internet WITHOUT the local proxy? A TCP connect
 * to REACHABILITY_HOST:443 — DNS plus a handshake, nothing sent. Meaningful off
 * the corporate network only: on CN direct egress is blocked by design.
 * @returns {Promise<boolean>}
 */
export function probeInternetDirect({ host = REACHABILITY_HOST, timeoutMs = 5000, connect = net.connect } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    const sock = connect({ host, port: 443, timeout: timeoutMs });
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
    sock.once('close', () => finish(false));
  });
}
