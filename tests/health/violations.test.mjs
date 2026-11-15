/**
 * lib/health/violations.mjs — one builder for the dashboard's violation count
 * AND list. 2026-11-15: during consolidation obs_api was 'busy'; the dashboard
 * said "1 Total Violations" with no row in the table, and [🏥] went red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildViolations, summarizeViolations, OK_SERVICE_STATUSES } from '../../lib/health/violations.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = '2026-11-15T10:00:00.000Z';
const base = (extra = {}) => ({
  generated_at: stamp,
  container: { healthcheck: 'healthy' },
  databases: { status: 'healthy' },
  services: [{ name: 'constraint_monitor', status: 'running' }],
  ...extra,
});

describe('buildViolations', () => {
  it('a busy obs_api is not a violation', () => {
    const v = buildViolations(base({ services: [{ name: 'obs_api', status: 'busy' }] }));
    assert.deepEqual(v, []);
    assert.equal(summarizeViolations(v).overallStatus, 'healthy');
  });

  it('a stopped service is a named, healable violation', () => {
    const v = buildViolations(base({ services: [{ name: 'obs_api', status: 'stopped' }] }), {
      autoHealMap: { obs_api: { action: 'restart_obs_api', recommendation: 'r' } },
    });
    assert.equal(v.length, 1);
    assert.equal(v[0].check, 'obs_api');
    assert.equal(v[0].auto_heal_action, 'restart_obs_api');
  });

  it('an unrecognised service status still gets a row (never counted invisibly)', () => {
    const v = buildViolations(base({ services: [{ name: 'x', status: 'wobbly' }] }));
    assert.equal(v.length, 1);
    assert.match(v[0].message, /wobbly/);
  });

  it('internet unreachable on VPN is listed, not just counted', () => {
    const v = buildViolations(base({ network: { location: 'vpn', internet_reachable: false, proxy_running: true } }));
    assert.deepEqual(v.map(x => x.kind), ['network.internet_unreachable']);
  });

  it('summary counts are derived from the list', () => {
    const v = buildViolations(base({ container: { healthcheck: 'unhealthy' }, services: [{ name: 's', status: 'unknown' }] }));
    assert.deepEqual(summarizeViolations(v), { overallStatus: 'unhealthy', violationCount: 2, criticalCount: 1 });
  });

  it('OK set includes running and busy', () => {
    assert.ok(OK_SERVICE_STATUSES.has('running') && OK_SERVICE_STATUSES.has('busy'));
  });
});

describe('dashboard server uses the shared builder for both endpoints', () => {
  const src = fs.readFileSync(path.join(REPO, 'integrations/system-health-dashboard/server.js'), 'utf8');
  const section = (start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
  const status = section('async handleGetHealthStatus(', 'async handleGetHealthReport(');
  const report = section('async handleGetHealthReport(', 'health-verifier/report proxy failed');

  it('/status and /report both call buildViolations and push nothing themselves', () => {
    for (const body of [status, report]) {
      assert.match(body, /buildViolations\(state/);
      assert.doesNotMatch(body, /violations\.push\(/);
    }
  });
});

describe('status line [🏥] uses the shared OK set', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts/combined-status-line.js'), 'utf8');
  it('filters services through OK_SERVICE_STATUSES', () => {
    assert.match(src, /!OK_SERVICE_STATUSES\.has\(s\.status\)/);
  });
});
