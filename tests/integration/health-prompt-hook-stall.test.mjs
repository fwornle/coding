/**
 * The prompt hook must go amber when the observation pipeline has STOPPED
 * WRITING, not only when a service has stopped RUNNING.
 *
 * Regression origin (2026-09-16 → 2026-09-17): observations stopped for ~31h
 * while obs_api stayed up and answered every probe. deriveSummary() read
 * databases, services[] and lsl_by_project — all three passed — so the hook
 * printed "All systems operational" for the entire outage and the gap was
 * eventually spotted by hand in the dashboard. The coordinator had known
 * throughout: pollKnowledgePipeline() had been publishing
 * knowledge_pipeline.status = 'stalled'. Nothing consumed it.
 *
 * The other half of the contract matters as much as the stall itself: four of
 * the six statuses must stay GREEN here. 'stale' is the coordinator's word for
 * an idle afternoon, 'busy' is a blocked event loop mid-consolidation, and
 * 'unreachable' is already reported (and healed) by the services[] loop. Firing
 * on those would re-create the false "service obs_api stopped" alarm that
 * loop's OK_SERVICE_STATUSES exists to prevent, and a line that cries wolf on
 * every quiet afternoon is one nobody reads on the day it is right.
 *
 * Driven through the hook's real entry point over HTTP (HEALTH_COORDINATOR_URL)
 * because deriveSummary is module-private — this asserts the string the
 * operator actually sees, not an internal shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = path.join(REPO, 'scripts/health-prompt-hook.js');

const HEALTHY_BASE = {
  container: { healthcheck: 'healthy' },
  databases: { status: 'healthy' },
  services: [{ name: 'obs_api', status: 'running' }],
  lsl_by_project: { coding: 'healthy' },
};

/** Run the hook against a one-shot coordinator serving `state`. */
async function hookSays(state) {
  const srv = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(state));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const stdout = await new Promise((resolve) => {
      const child = execFile(
        process.execPath, [HOOK],
        { cwd: REPO, env: { ...process.env, HEALTH_COORDINATOR_URL: url } },
        (_err, so) => resolve(so || ''),
      );
      child.stdin.end('{}');
    });
    return JSON.parse(stdout).hookSpecificOutput.additionalContext.trim();
  } finally {
    srv.close();
  }
}

test('a stalled pipeline turns the line amber, with the age that makes it actionable', async () => {
  const line = await hookSays({
    ...HEALTHY_BASE,
    knowledge_pipeline: { status: 'stalled', obsAgeMs: 31 * 3600_000 },
  });
  assert.match(line, /^⚠️ System Health:/);
  assert.match(line, /observations stalled \(31h\)/);
});

test('a stall with no age still reports, without an empty bracket', async () => {
  const line = await hookSays({
    ...HEALTHY_BASE,
    knowledge_pipeline: { status: 'stalled' },
  });
  assert.match(line, /observations stalled/);
  assert.doesNotMatch(line, /\(\)|\(NaNh\)|undefined/);
});

for (const [status, why] of [
  ['stale', 'idle — no active session inside OBS_FRESH_MS'],
  ['busy', 'event loop blocked by consolidation'],
  ['unreachable', 'already reported and healed by the services[] loop'],
  ['disabled', 'fresh install, no rows in any table yet'],
  ['healthy', 'writing normally'],
]) {
  test(`'${status}' stays green (${why})`, async () => {
    const line = await hookSays({
      ...HEALTHY_BASE,
      knowledge_pipeline: { status, obsAgeMs: 20 * 60_000 },
    });
    assert.match(line, /All systems operational/);
  });
}

test('a coordinator with no knowledge_pipeline key at all stays green', async () => {
  // Older coordinator, or a probe that has not completed its first tick. An
  // absent verdict is not a stall verdict.
  assert.match(await hookSays(HEALTHY_BASE), /All systems operational/);
});

test('a stall does not mask a stopped service — both are reported', async () => {
  const line = await hookSays({
    ...HEALTHY_BASE,
    services: [{ name: 'obs_api', status: 'stopped' }],
    knowledge_pipeline: { status: 'stalled', obsAgeMs: 31 * 3600_000 },
  });
  assert.match(line, /service obs_api stopped/);
  assert.match(line, /observations stalled/);
});
