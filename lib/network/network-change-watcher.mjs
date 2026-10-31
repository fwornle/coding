// lib/network/network-change-watcher.mjs
//
// Tell the coordinator the moment the OS changes its network configuration, so
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
// Linux (and WSL): `ip -o monitor address route` prints one line per netlink
// address or route change, again with no privilege. Lines for container
// plumbing — Docker's bridges and veth pairs, libvirt, CNI — are dropped: a
// container starting is not the network moving. Under WSL 2's default NAT
// networking the distro's own interface does not change when the Windows host
// joins VPN, so there the watcher rarely fires and polling does the work; in
// mirrored mode the host's changes are seen.
//
// Windows (glass) has no subscription here: polling every 15 s.
//
// The event says only "something changed". What changed is still the probes'
// to establish: the coordinator re-probes at once and, for a short window, lets
// an `open` reading through without the debounce and does not heal proxydetox.
//
// Failure policy: the watcher is an accelerator. Polling still runs; if
// notifyutil / ip is missing or keeps dying, the coordinator is exactly as it was.
//
// The watcher command must not outlive its parent. stop() kills it, but a
// parent that ends any other way — SIGKILL after launchd's exit timeout, a
// crash, a test runner tearing down a daemon it started — left it running:
// 2026-10-14, eleven orphaned `notifyutil -w` under launchd, one per such exit.
// So it runs under a small sh guard that ends it once the parent pid is gone
// (checked every 30 s, PARENT_GUARD) or on SIGTERM. Neither command reads stdin, and macOS
// has no parent-death signal to ask for instead.

import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const NETWORK_CHANGE_NOTIFICATION = 'com.apple.system.config.network_change';

/** How long after a change the network counts as "changing". */
export const NETWORK_CHANGE_WINDOW_MS = 60_000;

/** One change usually arrives as a burst of posts; report the burst once. */
export const NETWORK_CHANGE_DEBOUNCE_MS = 1_000;

const MAX_RESPAWN_DELAY_MS = 60_000;

/**
 * sh -c script: run "$@" and end it when this shell is told to stop or its
 * parent — the Node process, $PPID — has gone, checked every `intervalS`
 * seconds. Exits when the command does, so the respawn logic still sees the
 * command's own exit.
 */
export function parentGuard(intervalS) {
  return 'trap \'kill "$c" 2>/dev/null; exit 0\' TERM INT HUP; '
    + '"$@" & c=$!; '
    + `while kill -0 "$PPID" 2>/dev/null && kill -0 "$c" 2>/dev/null; do sleep ${intervalS}; done; `
    + 'kill "$c" 2>/dev/null; wait "$c"';
}

/**
 * Every 30 s. It was 2 s: one `sleep` process forked every 2 s for as long as
 * the parent lives, ~43k a day per watcher, with the coordinator and glass's
 * daemon each running one, all night on a laptop that did not sleep
 * (2026-10-30). An orphan outliving its parent by half a minute costs nothing.
 */
export const PARENT_GUARD = parentGuard(30);

/** An `ip monitor` line about container plumbing rather than the host's network. */
const CONTAINER_IFACE = /(?:^|[\s:])(?:veth\w*|docker\d*|br-[0-9a-f]+|virbr\d*|cni\d*|flannel\S*|cali\w+)(?:[\s:@]|$)/;

/** Per platform: the command whose stdout lines are change events, and which lines count. */
export const WATCHERS = {
  darwin: {
    cmd: 'notifyutil',
    args: ['-w', NETWORK_CHANGE_NOTIFICATION],
    isChange: (line) => line.trim() === NETWORK_CHANGE_NOTIFICATION,
  },
  linux: {
    cmd: 'ip',
    args: ['-o', 'monitor', 'address', 'route'],
    isChange: (line) => line.trim() !== '' && !CONTAINER_IFACE.test(line),
  },
};

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
 * @param {string} [opts.platform]     defaults to process.platform; no entry in WATCHERS → no-op
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
  const watcher = WATCHERS[platform];
  if (!watcher) return () => {};
  const { cmd, args, isChange } = watcher;

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
      child = spawn('/bin/sh', ['-c', PARENT_GUARD, 'sh', cmd, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      log(`network-change watcher: cannot start ${cmd}: ${err.message} — polling only`, 'WARN');
      return;
    }
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (isChange(line)) fire();
    });
    child.on('error', (err) => {
      log(`network-change watcher: ${cmd} failed: ${err.message} — polling only`, 'WARN');
    });
    child.on('exit', (code, signal) => {
      child = null;
      if (stopped) return;
      // A child that lived a while earns a fast restart; one that dies at once
      // backs off, so a broken watcher command does not spin.
      respawnDelay = Date.now() - startedAt > MAX_RESPAWN_DELAY_MS
        ? 1_000
        : Math.min(respawnDelay * 2, MAX_RESPAWN_DELAY_MS);
      log(`network-change watcher: ${cmd} exited (${signal || code}); restarting in ${respawnDelay / 1000}s`, 'WARN');
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
