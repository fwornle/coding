// lib/network/probe-result-semantics.mjs
//
// What a failed probe is actually evidence OF.
//
// probeHttpHealth/probeTcpPort (lib/utils/service-probe.js) map every failure
// onto status 'stopped'. That collapses two facts which are not the same:
//
//   ECONNREFUSED  nobody is listening on the port  — real evidence of death
//   timeout       no answer inside the budget      — evidence of nothing
//
// A timeout happens when the target is slow, when the machine is loaded, when
// the coordinator's own event loop is saturated, or when the network stack
// blips. None of those mean a service stopped, and reporting them as death
// wakes an operator for a fault that does not exist — or worse, triggers a
// restart of something that was working.
//
// ── Observed twice ──────────────────────────────────────────────────────────
// 2026-08-09  the prompt hook told the operator "service obs_api stopped" about
//             a service that never stopped. Fixed narrowly, with a busy window
//             covering obs_api alone and only while heavy work was known to be
//             in flight (see reclassifyBusyService in health-coordinator.js).
//
// 2026-08-30  a two-minute host network outage (internet=false from 12:10:28 to
//             12:12:46) produced the banner `llm_cli_proxy stopped, obs_api
//             stopped, db degraded` while all three were provably fine:
//             llm_cli_proxy's pid matched launchd throughout, obs_api had been
//             up four days, and the Qdrant container had zero restarts. The
//             busy window could not help — it covers one service, inside one
//             window, and llm_cli_proxy is not that service.
//
// So the reading is generalised here, as a pure function, rather than widened
// in place: three simultaneous false negatives from one transient is a property
// of the probe semantics, not of any one service.
//
// PURE — every input is an argument. No env, no I/O, no clock. It lives in its
// own module because health-coordinator.js binds ports on import and therefore
// cannot be imported by a test (see tests/integration/obs-api-busy-signal.test.js,
// which resorts to grepping the coordinator's source for this reason).

/**
 * Fallback sentinel, matching service-probe.js's PROBE_TIMEOUT_ERROR.
 *
 * NOT imported from there, so this module stays dependency-free and pure — but
 * the coordinator passes the real constant in at the call site, so the two
 * cannot drift into disagreeing about what a timeout looks like. This default
 * exists for direct callers and tests, not as a second source of truth.
 */
export const TIMEOUT_ERROR = 'timeout';

/**
 * Soften a timed-out probe from 'stopped' to 'unknown'.
 *
 * 'unknown' rather than keeping the previous value, because SPEC R6's rule is
 * that a failed probe must never assert health — and asserting DEATH on no
 * evidence is the same mistake pointed the other way. 'unknown' is also what
 * the coordinator's per-rule exception path already returns, so this adds no
 * new vocabulary.
 *
 * Only ever softens: a result that is not a timed-out 'stopped' is returned
 * untouched, so this can never invent a failure, and never masks ECONNREFUSED —
 * the case that keeps a genuinely dead service healable.
 *
 * @param {{status: string, error: string|null}} result
 * @param {string} [timeoutError] the sentinel to match; injectable for tests
 * @returns {{status: string, error: string|null}}
 */
export function reclassifyTimeoutAsUnknown(result, timeoutError = TIMEOUT_ERROR) {
  if (!result || result.status !== 'stopped') return result;
  if (result.error !== timeoutError) return result;
  return { ...result, status: 'unknown' };
}

/**
 * Should a failing database sample be published as `degraded` yet?
 *
 * The db check had no debounce at all: one failed
 * `fetch('http://localhost:6333/readyz')` was published as a degraded database.
 * On 2026-08-30 that is exactly what happened, to a Qdrant with zero restarts
 * that had been up two days. A database that is genuinely down stays down
 * across three ticks; a network blip does not.
 *
 * Mirrors the FUNCTIONAL_FAIL_THRESHOLD hysteresis the proxy check next door
 * has had since 2026-07-17, for the same reason and with the same threshold.
 *
 * @param {boolean} probeOk
 * @param {number} previousFailures
 * @param {number} [threshold]
 * @returns {{status: 'healthy'|'degraded'|'unknown', failures: number, confirmed: boolean}}
 */
export function debounceDbStatus(probeOk, previousFailures = 0, threshold = 3) {
  if (probeOk) return { status: 'healthy', failures: 0, confirmed: false };
  const failures = (Number(previousFailures) || 0) + 1;
  const confirmed = failures >= threshold;
  // Unconfirmed is 'unknown', not 'healthy': a real outage must never be
  // reported as fine while it is being confirmed.
  return { status: confirmed ? 'degraded' : 'unknown', failures, confirmed };
}

/**
 * The reason string for the one 5xx a restart can never fix.
 *
 * The proxy refuses to run on a routing config it cannot parse — deliberately,
 * since every routing decision depends on it — and answers `500` with
 * `{type: 'ROUTING_CONFIG_ERROR'}` to everything until the YAML is fixed.
 *
 * That is an authoring error, not a runtime fault. Restarting the process
 * cannot repair a syntax error: the fresh one reads the same file and refuses
 * the same way. Counted over the coordinator's own log, 158 such 500s across
 * five distinct config mistakes each dispatched a restart that could not
 * possibly help — and each one spent a slot from the 3-per-300s cooldown, so a
 * GENUINE proxy fault arriving in the next five minutes got no remediation at
 * all. The remediation was not merely useless; it consumed the budget the real
 * fault needed.
 */
export const CONFIG_ERROR = 'config_error';

/**
 * What a non-2xx answer from the proxy is evidence of.
 *
 * Separates CONFIG_ERROR from every other status, which keep the plain
 * `http_<code>` reason they have always had — so this narrows the actionable
 * set by exactly one case and changes nothing else.
 *
 * The body is passed in already-parsed (or null) rather than fetched here, to
 * keep this pure: the caller owns the one small json() on a path that has
 * already failed. A body that will not parse arrives as null and falls through
 * to the status-only reason, which is the safe direction — an unrecognised 500
 * stays actionable rather than being silently written off as an author's typo.
 *
 * @param {number} status HTTP status of the failed response
 * @param {{type?: string}|null} [body] the parsed JSON body, or null if unparseable
 * @returns {string} CONFIG_ERROR or `http_<status>`
 */
export function classifyProxyHttpFailure(status, body = null) {
  if (status === 500 && body?.type === 'ROUTING_CONFIG_ERROR') return CONFIG_ERROR;
  return `http_${status}`;
}

/**
 * Can restarting the LLM proxy plausibly clear this failure reason?
 *
 * The coordinator's remediation is exactly one action — `launchctl kickstart` —
 * so the only question worth asking of a reason is whether a fresh process
 * would answer differently. A dropped socket or a wedged event loop: yes. An
 * unparseable YAML file: never, and the attempt costs a 3-8s window with no
 * listening port plus a cooldown slot.
 *
 * @param {string} reason
 * @returns {boolean}
 */
export function isProxyRestartActionable(reason) {
  return reason !== CONFIG_ERROR;
}
