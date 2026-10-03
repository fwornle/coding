// lib/network/network-change-watcher.mjs
//
// Tell the coordinator the moment macOS changes its network configuration, so
// leaving VPN is acted on as an event rather than discovered by polling.
//
// ── Why ──────────────────────────────────────────────────────────────────────
// The coordinator learns of a network change only from its own probes: every
// 15s, then 2.5-5s apart once one fails, then three confirmations before the
// location hysteresis believes it. Leaving VPN on 2026-10-03 took that path,
// and the proxydetox heal debounce counted to three faster than the hysteresis
// did — a network change healed as a broken daemon (see
// proxydetox-heal-decision.mjs, NETWORK_CHANGE).
//
// ── How ──────────────────────────────────────────────────────────────────────
// configd posts the notify(3) name `com.apple.system.config.network_change`
// whenever the dynamic store's network state changes: interfaces, routes, DNS,
// a VPN tunnel coming or going. `notifyutil -w <name>` prints the name once per
// post and flushes it, so one child process and a line reader are the whole
// subscription — no native module, no polling. Observing the name needs no
// privilege; posting it does, which is why it is trustworthy evidence.
//
// The event says only "something changed". What changed is still the probes'
// to establish: the coordinator re-probes at once and, for a short window, lets
// an `open` reading through without the debounce and does not heal proxydetox.
//
// Failure policy: the watcher is an accelerator. Polling still runs; if
// notifyutil is missing or keeps dying, the coordinator is exactly as it was.

import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const NETWORK_CHANGE_NOTIFICATION = 'com.apple.system.config.network_change';

/** How long after a change the network counts as "changing". */
export const NETWORK_CHANGE_WINDOW_MS = 60_000;

/** One change usually arrives as a burst of posts; report the burst once. */
export const NETWORK_CHANGE_DEBOUNCE_MS = 1_000;

const MAX_RESPAWN_DELAY_MS = 60_000;

/**
 * Whether ``lastChangeAt`` (epoch ms, or null) is recent enough that the network
 * should be treated as mid-change.
 */
export function networkChangeRecent(lastChangeAt, now = Date.now()) {
  return Number.isFinite(lastChangeAt) && now - lastChangeAt < NETWORK_CHANGE_WINDOW_MS;
}

/**
 * Start watching. Returns ``stop()``.
 *
 * @param {object} opts
 * @param {() => void} opts.onChange   called once per burst of change notifications
 * @param {(msg: string, level?: string) => void} [opts.log]
 * @param {string} [opts.platform]     defaults to process.platform; not darwin → no-op
 * @param {Function} [opts.spawn]      child_process.spawn, injectable for tests
 * @param {number} [opts.debounceMs]
 */
export function startNetworkChangeWatcher({
  onChange,
  log = () => {},
  platform = process.platform,
  spawn = nodeSpawn,
  debounceMs = NETWORK_CHANGE_DEBOUNCE_MS,
}) {
  if (platform !== 'darwin') return () => {};

  let child = null;
  let stopped = false;
  let debounce = null;
  let respawnDelay = 1_000;
  let respawnTimer = null;

  const fire = () => {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      try { onChange(); } catch (err) { log(`network-change watcher: onChange threw: ${err.message}`, 'ERROR'); }
    }, debounceMs);
  };

  const start = () => {
    const startedAt = Date.now();
    try {
      child = spawn('notifyutil', ['-w', NETWORK_CHANGE_NOTIFICATION], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (err) {
      log(`network-change watcher: cannot start notifyutil: ${err.message} — polling only`, 'WARN');
      return;
    }
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.trim() === NETWORK_CHANGE_NOTIFICATION) fire();
    });
    child.on('error', (err) => {
      log(`network-change watcher: notifyutil failed: ${err.message} — polling only`, 'WARN');
    });
    child.on('exit', (code, signal) => {
      child = null;
      if (stopped) return;
      // A child that lived a while earns a fast restart; one that dies at once
      // backs off, so a broken notifyutil does not spin.
      respawnDelay = Date.now() - startedAt > MAX_RESPAWN_DELAY_MS
        ? 1_000
        : Math.min(respawnDelay * 2, MAX_RESPAWN_DELAY_MS);
      log(`network-change watcher: notifyutil exited (${signal || code}); restarting in ${respawnDelay / 1000}s`, 'WARN');
      respawnTimer = setTimeout(start, respawnDelay);
    });
  };

  start();
  return () => {
    stopped = true;
    clearTimeout(debounce);
    clearTimeout(respawnTimer);
    if (child) child.kill();
  };
}
