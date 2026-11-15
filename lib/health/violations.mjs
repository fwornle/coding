/**
 * lib/health/violations.mjs — the ONE answer to "which parts of the
 * coordinator's /health/state are violations?".
 *
 * Before this module the rule existed in four copies (the dashboard's /status
 * count, its /report list, the status line's [🏥] badge and the prompt hook),
 * and they drifted. When the coordinator learned to report obs_api as 'busy'
 * during consolidation (2026-08-09, health-coordinator.js
 * reclassifyBusyService) only the prompt hook was taught that 'busy' is fine.
 * The dashboard's count then said "1 Total Violations" while its list, built
 * by different code, had no row for it — so the Active Violations table was
 * hidden — and the status line turned red, until consolidation finished.
 *
 * Pure: no I/O, no clock unless passed in. The dashboard builds both the
 * count and the list from buildViolations(), so they cannot disagree.
 */

import { restartingServices } from './deliberate-restart.mjs';

/**
 * Service statuses that are NOT an issue.
 * 'busy' = alive, event loop blocked by known heavy work (consolidation);
 * a timeout during that window is not evidence of anything being wrong.
 */
export const OK_SERVICE_STATUSES = new Set(['running', 'busy']);

/** Statuses that mean "confirmed broken" (as opposed to unknown / degraded). */
export const HARD_FAILURE_STATUSES = new Set(['stopped', 'unhealthy', 'failed', 'error']);

export function isHardFailure(raw) {
  return HARD_FAILURE_STATUSES.has(raw);
}

/** Is this service entry an issue at all (any severity)? */
export function isServiceIssue(svc) {
  return Boolean(svc && svc.status && !OK_SERVICE_STATUSES.has(svc.status));
}

/**
 * Build the violation list for the dashboard from coordinator state.
 *
 * @param {object} state  coordinator /health/state payload
 * @param {object} [opts]
 * @param {Record<string,{action:string,recommendation:string}>} [opts.autoHealMap]
 * @param {number} [opts.now]  clock for the deliberate-restart grace window
 * @returns {Array<object>} rows in the violations-table.tsx shape
 */
export function buildViolations(state, { autoHealMap = {}, now = Date.now() } = {}) {
  const violations = [];
  if (!state || typeof state !== 'object') return violations;
  const stamp = state.generated_at || new Date(now).toISOString();
  const tsFor = (ls) => {
    if (!ls) return stamp;
    if (typeof ls === 'string') return ls;
    if (typeof ls === 'number') return new Date(ls).toISOString();
    return stamp;
  };

  // Container
  const containerRaw = state.container && state.container.healthcheck;
  if (containerRaw && isHardFailure(containerRaw)) {
    violations.push({ check: 'container', kind: 'container', severity: 'critical', detail: containerRaw, message: `Container reports ${containerRaw}`, timestamp: stamp });
  }

  // Services
  if (Array.isArray(state.services)) {
    const restarting = restartingServices(state, now);
    for (const svc of state.services) {
      if (!svc || !svc.name || !isServiceIssue(svc)) continue;
      const raw = svc.status;
      const ts = tsFor(svc.last_seen);
      const heal = autoHealMap[svc.name];
      const healFields = heal ? { auto_heal: true, auto_heal_action: heal.action, recommendation: heal.recommendation } : {};
      if (restarting.has(svc.name)) {
        // The coordinator's own remedy in progress — a transition, not an outage.
        violations.push({ check: svc.name, kind: `service.${svc.name}`, category: 'services', status: 'warning', severity: 'warning', detail: raw, message: `${svc.name} is being restarted by the coordinator`, timestamp: ts });
      } else if (isHardFailure(raw)) {
        violations.push({ check: svc.name, kind: `service.${svc.name}`, category: 'services', status: 'error', severity: 'high', detail: raw, message: `${svc.name} ${raw}`, timestamp: ts, ...healFields });
      } else if (raw === 'unknown') {
        violations.push({ check: svc.name, kind: `service.${svc.name}`, category: 'services', status: 'warning', severity: 'warning', detail: 'unknown', message: `${svc.name} has not reported (no probe data yet)`, timestamp: ts, ...healFields });
      } else {
        // Any status nobody taught this module about. Show it rather than
        // count it invisibly — an unnamed violation is the bug this module fixes.
        violations.push({ check: svc.name, kind: `service.${svc.name}`, category: 'services', status: 'warning', severity: 'warning', detail: raw, message: `${svc.name} ${raw}`, timestamp: ts, ...healFields });
      }
    }
  }

  // Processes
  if (Array.isArray(state.processes)) {
    for (const p of state.processes) {
      if (!p || !p.name || !isHardFailure(p.status)) continue;
      violations.push({ check: p.name, kind: `process.${p.name}`, severity: 'medium', detail: p.detail || p.status, message: p.detail ? `${p.name}: ${p.detail}` : `${p.name} ${p.status}`, timestamp: stamp });
    }
  }

  // LSL per project
  if (state.lsl_by_project && typeof state.lsl_by_project === 'object') {
    for (const [project, status] of Object.entries(state.lsl_by_project)) {
      if (!isHardFailure(status)) continue;
      violations.push({ check: `lsl.${project}`, kind: `lsl.${project}`, severity: 'medium', detail: status, message: `LSL ${project} ${status}`, timestamp: stamp });
    }
  }

  // Databases — anything but healthy/unknown is shown (degraded included).
  const dbRaw = state.databases && state.databases.status;
  if (dbRaw && dbRaw !== 'healthy' && dbRaw !== 'unknown') {
    violations.push({ check: 'databases', kind: 'databases', severity: isHardFailure(dbRaw) ? 'high' : 'warning', detail: dbRaw, message: `databases ${dbRaw}`, timestamp: stamp });
  }

  // LLM proxy semantic readiness
  if (state.proxy && state.proxy.semantic_ok === false && state.proxy.auto_heal_status !== 'disabled') {
    violations.push({ check: 'proxy.semantic_readiness', kind: 'proxy.semantic_readiness', severity: 'high', detail: state.proxy.reason || 'semantic probe failed', message: `LLM proxy not responding — ${state.proxy.consecutive_failures || '?'} consecutive failures`, timestamp: stamp });
  }

  // Network
  if (state.network) {
    const loc = state.network.location;
    if (loc === 'corporate' || loc === 'vpn') {
      if (state.network.internet_reachable === false) {
        violations.push({ check: 'network.internet_unreachable', kind: 'network.internet_unreachable', severity: 'high', detail: `On ${loc}, internet unreachable`, message: `On ${loc} network and the internet is unreachable`, timestamp: stamp });
      }
      if (state.network.proxy_running === false) {
        violations.push({ check: 'network.proxy_mismatch', kind: 'network.proxy_mismatch', severity: 'medium', detail: `On ${loc} but proxy not active`, message: `On ${loc} network but local proxy is inactive — internet access may fail`, timestamp: stamp });
      }
    }
  }

  return violations;
}

/** overallStatus + counts derived from the same list the table renders. */
export function summarizeViolations(violations) {
  const criticalCount = violations.filter(v => v.severity === 'critical').length;
  const overallStatus = violations.length === 0 ? 'healthy'
    : criticalCount > 0 ? 'unhealthy' : 'degraded';
  return { overallStatus, violationCount: violations.length, criticalCount };
}
