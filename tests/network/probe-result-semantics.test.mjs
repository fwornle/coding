/**
 * Unit suite for lib/network/probe-result-semantics.mjs.
 *
 * Two readings of a failed probe, both of which the coordinator got wrong on
 * 2026-08-30 during a two-minute host network outage. The prompt banner said
 * `llm_cli_proxy stopped, obs_api stopped, db degraded`; all three were fine —
 * llm_cli_proxy's pid matched launchd throughout, obs_api had been up four
 * days, and the Qdrant container had zero restarts.
 *
 * Run: node --test tests/network/probe-result-semantics.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reclassifyTimeoutAsUnknown, debounceDbStatus, TIMEOUT_ERROR,
  classifyProxyHttpFailure, isProxyRestartActionable, CONFIG_ERROR,
} from '../../lib/network/probe-result-semantics.mjs';

const timedOut = { status: 'stopped', latency_ms: null, error: TIMEOUT_ERROR };
const refused = { status: 'stopped', latency_ms: null, error: 'ECONNREFUSED' };
const running = { status: 'running', latency_ms: 4, error: null };

describe('a timeout is not evidence that a service stopped', () => {
  it('softens a timed-out probe to unknown', () => {
    assert.equal(reclassifyTimeoutAsUnknown(timedOut).status, 'unknown');
  });

  it('leaves ECONNREFUSED as stopped — the case that keeps a dead service healable', () => {
    // Masking this would suppress every restart the coordinator exists to
    // trigger, which is a strictly worse failure than the one being fixed.
    assert.equal(reclassifyTimeoutAsUnknown(refused).status, 'stopped');
  });

  it('never touches a healthy result', () => {
    assert.deepEqual(reclassifyTimeoutAsUnknown(running), running);
  });

  it('only ever softens — it can never invent a failure', () => {
    for (const status of ['running', 'busy', 'unknown']) {
      assert.equal(
        reclassifyTimeoutAsUnknown({ status, error: TIMEOUT_ERROR }).status, status,
        `${status} must survive untouched`,
      );
    }
  });

  it("does not overwrite obs_api's more specific 'busy' classification", () => {
    // Production order is reclassifyBusyService THEN this, so a result already
    // reclassified as busy must pass through unchanged.
    assert.equal(reclassifyTimeoutAsUnknown({ status: 'busy', error: TIMEOUT_ERROR }).status, 'busy');
  });

  it('is service-agnostic — it takes no service name at all', () => {
    // The 2026-08-30 banner named llm_cli_proxy, which the obs_api-only busy
    // window could never have covered. Being nameless IS the fix.
    // Function.length counts only params before the first default, so the
    // injectable sentinel does not show up here — 1 means "result, and nothing
    // else is required".
    assert.equal(reclassifyTimeoutAsUnknown.length, 1);
    assert.doesNotMatch(reclassifyTimeoutAsUnknown.toString().split(')')[0], /name/i,
      'no service-name parameter may creep back in');
  });

  it('honours an injected sentinel, so it cannot drift from service-probe.js', () => {
    const r = { status: 'stopped', error: 'PROBE_TIMED_OUT' };
    assert.equal(reclassifyTimeoutAsUnknown(r).status, 'stopped', 'default sentinel does not match');
    assert.equal(reclassifyTimeoutAsUnknown(r, 'PROBE_TIMED_OUT').status, 'unknown');
  });

  it('preserves the error, so the reason survives into the published state', () => {
    assert.equal(reclassifyTimeoutAsUnknown(timedOut).error, TIMEOUT_ERROR);
  });

  it('tolerates a missing result rather than throwing inside a health check', () => {
    assert.equal(reclassifyTimeoutAsUnknown(null), null);
  });
});

describe('the database status is debounced, like the proxy check next door', () => {
  it('reports healthy immediately on a good sample', () => {
    assert.deepEqual(debounceDbStatus(true, 0), { status: 'healthy', failures: 0, confirmed: false });
  });

  it('does NOT call a single failed sample degraded', () => {
    // The 2026-08-30 case: one failed GET /readyz during a network blip, against
    // a Qdrant with zero restarts that had been up two days.
    const d = debounceDbStatus(false, 0);
    assert.equal(d.status, 'unknown');
    assert.equal(d.confirmed, false);
  });

  it('reports unknown — never healthy — while a failure is unconfirmed', () => {
    // A real outage must not be briefly reported as fine on its way to being
    // confirmed. Same SPEC R6 reading the service probes take.
    assert.equal(debounceDbStatus(false, 1).status, 'unknown');
  });

  it('confirms degraded on the third consecutive failure', () => {
    assert.equal(debounceDbStatus(false, 1).status, 'unknown');
    assert.equal(debounceDbStatus(false, 2).status, 'degraded');
    assert.equal(debounceDbStatus(false, 2).confirmed, true);
  });

  it('a genuinely down database still degrades — the debounce only delays it', () => {
    let failures = 0;
    let last;
    for (let tick = 0; tick < 5; tick += 1) {
      last = debounceDbStatus(false, failures);
      failures = last.failures;
    }
    assert.equal(last.status, 'degraded');
    assert.equal(failures, 5);
  });

  it('one good sample resets the counter', () => {
    assert.equal(debounceDbStatus(true, 9).failures, 0);
  });

  it('honours a caller-supplied threshold', () => {
    assert.equal(debounceDbStatus(false, 0, 1).status, 'degraded');
  });

  it('treats a missing previous count as zero rather than NaN', () => {
    assert.equal(debounceDbStatus(false, undefined).failures, 1);
    assert.equal(debounceDbStatus(false, null).failures, 1);
  });
});

// ── The one 5xx a restart can never fix ──────────────────────────────────────
//
// On 2026-08-31 the proxy was left with an unparseable llm-routing.yaml. It did
// what it is designed to do — refused to serve on a routing policy it cannot
// read — and answered 500 ROUTING_CONFIG_ERROR to everything. The coordinator
// read that as a sick proxy and dispatched a kickstart, which restarted a
// process that re-read the same broken file and refused identically. Counted
// over the coordinator's log: 158 such 500s across five distinct config
// mistakes, every one of them remediated by an action that could not possibly
// have worked.
//
// The cost was not only the wasted restart. Three probe paths (cheap, its retry,
// and the strong-probe escalation) all fired off the same underlying failure and
// spent the entire 3-kickstarts-per-300s budget in 68ms — so a GENUINE proxy
// fault in the following five minutes would have found no remediation left.
describe('a proxy that will not parse its config is not a proxy a restart can fix', () => {
  const configErrBody = { error: 'routing config unusable: ...', type: 'ROUTING_CONFIG_ERROR' };

  it('names the config error apart from every other 500', () => {
    assert.equal(classifyProxyHttpFailure(500, configErrBody), CONFIG_ERROR);
  });

  it('and only that one is written off — an unlabelled 500 stays http_500', () => {
    // The safe direction to be wrong in: an unrecognised 500 keeps its
    // remediation rather than being silently dismissed as an author's typo.
    assert.equal(classifyProxyHttpFailure(500, null), 'http_500');
    assert.equal(classifyProxyHttpFailure(500, {}), 'http_500');
    assert.equal(classifyProxyHttpFailure(500, { type: 'SOMETHING_ELSE' }), 'http_500');
  });

  it('a body that cannot be parsed arrives as null and keeps the status reason', () => {
    // The caller passes null when json() throws. It must not be mistaken for a
    // config error just because the status matched.
    assert.equal(classifyProxyHttpFailure(500, undefined), 'http_500');
  });

  it('never claims a config error on a status that cannot carry one', () => {
    // The proxy answers ROUTING_CONFIG_ERROR with 500 and nothing else. A body
    // carrying that type on another status is not this fault, and treating it
    // as one would disable remediation for a genuine 502/503.
    for (const status of [400, 404, 429, 502, 503]) {
      assert.equal(classifyProxyHttpFailure(status, configErrBody), `http_${status}`);
    }
  });

  it('marks the config error non-actionable', () => {
    assert.equal(isProxyRestartActionable(CONFIG_ERROR), false);
  });

  it('leaves every OTHER reason actionable — this narrows the set by exactly one', () => {
    // The regression that matters in the other direction: a change here that
    // over-reaches would stop the coordinator healing faults it currently fixes.
    for (const reason of [
      'http_500', 'http_502', 'http_503', 'http_429', 'http_401',
      'network_fetch failed', 'timeout', 'empty_content', 'oksub_missing', '',
    ]) {
      assert.equal(isProxyRestartActionable(reason), true, `${reason} must stay actionable`);
    }
  });

  it('the classify -> actionable path is closed end to end', () => {
    // The property the coordinator actually depends on: a 500 whose body says
    // ROUTING_CONFIG_ERROR must reach the FSM as something it will not restart
    // on, and an identical 500 without that body must not.
    assert.equal(isProxyRestartActionable(classifyProxyHttpFailure(500, configErrBody)), false);
    assert.equal(isProxyRestartActionable(classifyProxyHttpFailure(500, null)), true);
  });
});
