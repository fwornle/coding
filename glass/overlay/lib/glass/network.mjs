// lib/glass/network.mjs — the facts behind the status line's [N:… P:…] field,
// polled by the daemon while a session is live.
//
// The probes, the location verdict, the hysteresis and the functional debounce
// are coding's own (lib/network/location-probe.mjs, location-hysteresis.mjs,
// network-change-watcher.mjs — extracted, not copied), so glass shows exactly
// what coding's status line shows. Unlike coding's health coordinator, glass
// never restarts proxydetox and never changes anyone's proxy variables; the
// daemon only reads the facts to pick its own egress (egress.mjs egressEnvFor).
import {
  observeLocation, probePortListening, probeProxyFunctional, probeKerberosTicket, requestKerberosTicket, readProxyEnabledByUser, probeInternetDirect,
  countFunctionalFailures, publishedFunctional, FUNCTIONAL_FAIL_THRESHOLD, AWAY_NETWORK_PROBE_INTERVAL_MS,
} from '../network/location-probe.mjs';
import { settleLocation } from '../network/location-hysteresis.mjs';
import { startNetworkChangeWatcher, networkChangeRecent } from '../network/network-change-watcher.mjs';
import { humanPresentByHid } from '../presence/hid-idle.mjs';

export const NETWORK_PROBE_INTERVAL_MS = 15_000; // the coordinator's cadence

/**
 * @param {object} [o]
 * @param {object} [o.probes]   { location, port, functional, enabled, kerberos, renewTicket, internet, away } — injectable for tests
 * @param {boolean} [o.watch]   subscribe to the OS's network changes (macOS, Linux / WSL; Windows polls)
 * @param {(line: string) => void} [o.log]
 */
export function createNetworkMonitor({ probes = {}, watch = true, log = () => {} } = {}) {
  const location = probes.location || observeLocation;
  const port = probes.port || probePortListening;
  const functional = probes.functional || probeProxyFunctional;
  const enabled = probes.enabled || readProxyEnabledByUser;
  const kerberos = probes.kerberos || probeKerberosTicket;
  const renewTicket = probes.renewTicket || requestKerberosTicket;
  const internet = probes.internet || probeInternetDirect;
  const now = probes.now || Date.now;
  // Nobody at the machine: probe every 5 min, not every 15 s (location-probe.mjs networkProbeIntervalMs).
  const away = probes.away || (() => humanPresentByHid() === false);
  let lastTicketRequest = 0;
  const state = {
    location: 'unknown', proxy_running: false, proxy_functional: false, proxy_enabled_by_user: false, kerberos_ticket: null, internet_reachable: null,
    location_demotion_pending: 0, consecutive_functional_failures: 0, last_network_change_at: null, last_probe_end: null,
  };
  let running = null;
  let timer = null;
  const listeners = new Set();
  let stopWatch = () => {};

  async function probe() {
    const listening = await port();
    const raw = listening ? await functional() : false;
    state.consecutive_functional_failures = countFunctionalFailures({ raw, portListening: listening, failures: state.consecutive_functional_failures });
    state.proxy_running = listening;
    state.proxy_functional = publishedFunctional({
      raw, confirmed: state.consecutive_functional_failures >= FUNCTIONAL_FAIL_THRESHOLD, portListening: listening, previous: state.proxy_functional,
    });
    state.proxy_enabled_by_user = enabled();
    const { observed } = await location();
    const settled = settleLocation({
      observed,
      previous: state.location,
      pending: state.location_demotion_pending,
      networkChanged: networkChangeRecent(state.last_network_change_at),
    });
    if (settled.location !== state.location) log(`network: location ${state.location} → ${settled.location}`);
    state.location = settled.location;
    state.location_demotion_pending = settled.pending;
    state.kerberos_ticket = await kerberos();
    // Off the corporate network, does anything get out at all? On CN direct
    // egress is blocked by design, and a working proxy proves it either way.
    // null = not judged; the badge shows OFFLINE only for false.
    const wasOnline = state.internet_reachable;
    state.internet_reachable = state.location === 'open' && !state.proxy_functional ? await internet() : null;
    if (state.internet_reachable === false && wasOnline !== false) log('network: no internet from this machine — not a proxy or Kerberos fault');
    // On CN / VPN without a ticket the corporate proxy refuses every tunnel,
    // and macOS can take minutes to fetch one on its own (2m20s measured after
    // an overnight expiry). Ask for it now; every 2 min at most.
    if (state.kerberos_ticket === false && (state.location === 'corporate' || state.location === 'vpn')
        && now() - lastTicketRequest >= 120_000) {
      lastTicketRequest = now();
      renewTicket().then((realms) => {
        if (realms?.length) log(`network: asked the Kerberos SSO extension for a ticket (${realms.join(', ')})`);
      }).catch(() => {});
    }
    state.last_probe_end = new Date().toISOString();
    for (const fn of listeners) {
      try { fn({ ...state }); } catch (err) { log(`network listener failed: ${err?.message || err}`); }
    }
  }

  /** Whether the interval timer should probe now: always, unless nobody has been at the machine and the last round is under 5 min old. */
  function due() {
    if (!away()) return true;
    const last = Date.parse(state.last_probe_end || '') || 0;
    return now() - last >= AWAY_NETWORK_PROBE_INTERVAL_MS;
  }

  /** One probe round; concurrent callers share it. */
  function tick() {
    if (!running) running = probe().catch((err) => log(`network probe failed: ${err?.message || err}`)).finally(() => { running = null; });
    return running;
  }

  return {
    /** The published facts (networkBadge() input). */
    facts: () => ({ ...state }),
    /** Call `fn(facts)` after every completed probe round; returns the unsubscribe. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    tick,
    due,
    /** Poll every interval while `active()` says a session is live; every 5 min while nobody is at the machine. */
    start({ active = () => true, intervalMs = NETWORK_PROBE_INTERVAL_MS } = {}) {
      if (timer) return;
      timer = setInterval(() => { if (active() && due()) tick(); }, intervalMs);
      timer.unref?.();
      if (watch) {
        stopWatch = startNetworkChangeWatcher({
          onChange: () => {
            state.last_network_change_at = Date.now();
            if (active()) tick();
          },
        });
      }
    },
    stop() {
      clearInterval(timer);
      timer = null;
      stopWatch();
      stopWatch = () => {};
    },
  };
}
