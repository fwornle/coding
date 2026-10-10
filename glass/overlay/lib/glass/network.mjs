// lib/glass/network.mjs — the facts behind the status line's [N:… P:…] field,
// polled by the daemon while a session is live.
//
// The probes, the location verdict, the hysteresis and the functional debounce
// are coding's own (lib/network/location-probe.mjs, location-hysteresis.mjs,
// network-change-watcher.mjs — extracted, not copied), so glass shows exactly
// what coding's status line shows. Unlike coding's health coordinator, glass
// only observes: it never restarts proxydetox and never changes proxy
// variables.
import {
  observeLocation, probePortListening, probeProxyFunctional, readProxyEnabledByUser,
  countFunctionalFailures, publishedFunctional, FUNCTIONAL_FAIL_THRESHOLD,
} from '../network/location-probe.mjs';
import { settleLocation } from '../network/location-hysteresis.mjs';
import { startNetworkChangeWatcher, networkChangeRecent } from '../network/network-change-watcher.mjs';

export const NETWORK_PROBE_INTERVAL_MS = 15_000; // the coordinator's cadence

/**
 * @param {object} [o]
 * @param {object} [o.probes]   { location, port, functional, enabled } — injectable for tests
 * @param {boolean} [o.watch]   subscribe to the OS's network-change notification (macOS)
 * @param {(line: string) => void} [o.log]
 */
export function createNetworkMonitor({ probes = {}, watch = true, log = () => {} } = {}) {
  const location = probes.location || observeLocation;
  const port = probes.port || probePortListening;
  const functional = probes.functional || probeProxyFunctional;
  const enabled = probes.enabled || readProxyEnabledByUser;
  const state = {
    location: 'unknown', proxy_running: false, proxy_functional: false, proxy_enabled_by_user: false,
    location_demotion_pending: 0, consecutive_functional_failures: 0, last_network_change_at: null, last_probe_end: null,
  };
  let running = null;
  let timer = null;
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
    state.last_probe_end = new Date().toISOString();
  }

  /** One probe round; concurrent callers share it. */
  function tick() {
    if (!running) running = probe().catch((err) => log(`network probe failed: ${err?.message || err}`)).finally(() => { running = null; });
    return running;
  }

  return {
    /** The published facts (networkBadge() input). */
    facts: () => ({ ...state }),
    tick,
    /** Poll every interval while `active()` says a session is live. */
    start({ active = () => true, intervalMs = NETWORK_PROBE_INTERVAL_MS } = {}) {
      if (timer) return;
      timer = setInterval(() => { if (active()) tick(); }, intervalMs);
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
