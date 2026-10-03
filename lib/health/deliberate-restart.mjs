// lib/health/deliberate-restart.mjs
//
// Which services are down because the coordinator is restarting them.
//
// A service the coordinator restarts on purpose is not running for a few
// seconds, and its probe says so. Read as an outage, that turned the
// statusline's [🏥] red after every network change: leaving VPN needs the LLM
// proxy restarted onto the new egress (health-coordinator.js,
// restart_llm_cli_proxy), and for the ~20s it took to come back the badge
// reported a critical failure of the system's own remedy.
//
// So a down service the coordinator dispatched a restart for within
// RESTART_GRACE_MS is "restarting": the statusline shows it as a transition,
// and the prompt hook does not report it. After the grace period it counts as
// down again — a restart that does not bring the service back IS an outage.
//
// Shared by scripts/combined-status-line.js and scripts/health-prompt-hook.js,
// so the line and the prompt agree.

export const RESTART_GRACE_MS = 120_000;

/**
 * Service name → where /health/state records the coordinator's last restart of
 * it (epoch ms). Only restarts the coordinator itself dispatches belong here.
 */
const RESTART_MARKS = {
  llm_cli_proxy: (state) => state?.proxy?.last_kickstart_dispatch_at,
};

/**
 * The names of services in ``state`` that are down within the grace period of
 * a restart the coordinator dispatched.
 *
 * @param {object} state  /health/state
 * @param {number} [now]
 * @returns {Set<string>}
 */
export function restartingServices(state, now = Date.now()) {
  const names = new Set();
  for (const [name, markOf] of Object.entries(RESTART_MARKS)) {
    const at = Number(markOf(state));
    if (Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < RESTART_GRACE_MS) {
      names.add(name);
    }
  }
  return names;
}
