/**
 * Service liveness probe helpers — Phase 33 G1 closure (plan 33-09).
 *
 * Used by `scripts/health-coordinator.js` to populate `currentState.services`
 * status from a rule's `check_type` ('http_health' or 'port_listening'). The
 * coordinator iterates over each enabled rule in `config/health-verification-rules.json`
 * (services category) on every 5s tick and dispatches to one of these probes.
 *
 * Contract — every probe returns:
 *   { status: 'running' | 'stopped' | 'unknown',
 *     latency_ms: number | null,
 *     error: string | null }
 *
 * SPEC R6 invariant: a probe NEVER returns 'healthy', and on exception/error
 * surfaces 'unknown' or 'stopped' — never silently passes a service through
 * as up. Configuration errors (bad URL, invalid port) → 'unknown'. Network
 * conditions (refused / timeout / non-2xx response) → 'stopped'.
 *
 * No external dependencies — built-in `node:net` + global `fetch` (Node ≥18).
 *
 * @module lib/utils/service-probe
 */
import net from 'node:net';

/**
 * HTTP GET probe with timeout via AbortController.
 *
 * Status mapping:
 *   - 2xx / 3xx response       → 'running' (with measured latency_ms)
 *   - Other HTTP status        → 'stopped' (with `HTTP <code>` error)
 *   - Network error / refused  → 'stopped'
 *   - Timeout (abort)          → 'stopped' (with 'timeout' error)
 *   - Bad / missing URL        → 'unknown' (config error, not a target failure)
 *
 * @param {string} endpoint - HTTP/HTTPS URL string
 * @param {number} [timeoutMs=3000] - Per-probe deadline in ms
 * @returns {Promise<{ status: string, latency_ms: number | null, error: string | null }>}
 */
export async function probeHttpHealth(endpoint, timeoutMs = 3000) {
  if (!endpoint || typeof endpoint !== 'string') {
    return { status: 'unknown', latency_ms: null, error: 'invalid endpoint' };
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch (err) {
    return { status: 'unknown', latency_ms: null, error: `bad URL: ${err.message}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: ctrl.signal, method: 'GET' });
    const latency_ms = Date.now() - t0;
    if (r.status >= 200 && r.status < 400) {
      return { status: 'running', latency_ms, error: null };
    }
    return { status: 'stopped', latency_ms, error: `HTTP ${r.status}` };
  } catch (err) {
    // ECONNREFUSED / DNS / abort / network → 'stopped' (target not serving).
    // SPEC R6: NEVER return 'healthy'.
    const msg = err?.name === 'AbortError'
      ? 'timeout'
      : (err?.cause?.code || err?.code || err?.message || 'unknown error');
    return { status: 'stopped', latency_ms: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TCP-connect probe with timeout. Bounded: a single bad port cannot stall the
 * coordinator's 5s tick because the deadline is enforced via `setTimeout` on
 * the socket.
 *
 * Status mapping:
 *   - Connect succeeds         → 'running' (with measured latency_ms)
 *   - ECONNREFUSED             → 'stopped'
 *   - Timeout                  → 'stopped' (with 'timeout' error)
 *   - Other socket error       → 'stopped' (with err.code or err.message)
 *   - Invalid host / port      → 'unknown' (config error)
 *
 * @param {string} host
 * @param {number} port - Integer in [1, 65535]
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<{ status: string, latency_ms: number | null, error: string | null }>}
 */
export async function probeTcpPort(host, port, timeoutMs = 2000) {
  if (!host || typeof host !== 'string' ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    return { status: 'unknown', latency_ms: null, error: 'invalid host/port' };
  }
  const t0 = Date.now();
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const settle = (status, error) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* socket already closed */ }
      resolve({
        status,
        latency_ms: status === 'running' ? Date.now() - t0 : null,
        error
      });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => settle('running', null));
    sock.once('timeout', () => settle('stopped', 'timeout'));
    sock.once('error', (err) => settle('stopped', err.code || err.message || 'connect error'));
    try {
      sock.connect(port, host);
    } catch (err) {
      // Synchronous throw from connect (rare — invalid args). SPEC R6: 'unknown',
      // never 'healthy'.
      settle('unknown', err.message || 'sync connect threw');
    }
  });
}
