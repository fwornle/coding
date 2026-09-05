#!/usr/bin/env node

/**
 * Reconcile the running system with the resolved feature set.
 *
 * This is the "applied on save" tier from docs/architecture/features.md: a
 * feature change that neither takes effect on the next read (status line,
 * dashboard, CLI gates) nor has to wait for a new agent session (hooks) is
 * applied here, by starting or stopping exactly the delta.
 *
 * Two backends, both of which no-op cleanly when they are not applicable:
 *
 *   host daemons        launchd / systemd --user / Task Scheduler, via
 *                       lib/features/daemons.mjs
 *   container programs  supervisorctl inside coding-services, when it is up
 *
 * Deliberately NOT restarting the whole world: `coding --claude` already does
 * a full start, and a config edit should cost the user the smallest disruption
 * that makes the config true.
 *
 * Usage:
 *   node scripts/apply-features.mjs [--dry-run] [--quiet]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFeatures } from '../lib/features/index.mjs';
import { writeSnapshot } from '../lib/features/snapshot.cjs';
import { reconcile as reconcileDaemons, platform } from '../lib/features/daemons.mjs';
import { runIfMain } from '../lib/utils/esm-cli.js';

const exec = promisify(execFile);
const REPO = process.env.CODING_REPO || join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Container programs and their features. Mirrors PROGRAM_FEATURES in
 * docker/entrypoint.sh — the entrypoint decides what autostarts at container
 * boot; this decides what happens to an ALREADY RUNNING container when the
 * config changes. tests/features/daemon-gating.test.mjs asserts the two agree.
 */
const CONTAINER_PROGRAMS = {
  'semantic-analysis': 'knowledge',
  'vkb-server': 'knowledge',
  'embedding-listener': 'knowledge',
  graphify: 'codegraph',
  'constraint-monitor': 'constraints',
  'constraint-dashboard': 'constraints',
  'constraint-dashboard-api': 'constraints',
  'health-dashboard': 'health',
  'health-dashboard-frontend': 'health',
};

const CONTAINER = 'coding-services';

async function run(cmd, args, timeout = 30000) {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout });
    return { ok: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}

/** supervisorctl status, as {program: 'RUNNING'|'STOPPED'|...}, or null if unreachable. */
async function containerStatus() {
  const r = await run('docker', ['exec', CONTAINER, 'supervisorctl', 'status']);
  // `supervisorctl status` exits non-zero when ANY program is not running, so a
  // non-zero status with parseable output is normal, not a failure.
  if (!r.stdout.trim()) return null;

  const status = {};
  for (const line of r.stdout.split('\n')) {
    // "web-services:vkb-server   RUNNING   pid 42, uptime 0:01:00"
    const m = /^(\S+)\s+(\w+)/.exec(line.trim());
    if (!m) continue;
    const name = m[1].includes(':') ? m[1].split(':').pop() : m[1];
    status[name] = m[2];
  }
  return Object.keys(status).length ? status : null;
}

async function reconcileContainer(resolved, { dryRun }) {
  const status = await containerStatus();
  if (!status) {
    return { available: false, started: [], stopped: [], unchanged: [] };
  }

  const out = { available: true, started: [], stopped: [], unchanged: [] };
  for (const [program, feature] of Object.entries(CONTAINER_PROGRAMS)) {
    const want = resolved.features[feature]?.enabled === true;
    const state = status[program];
    if (state === undefined) continue; // not in this image
    const is = state === 'RUNNING' || state === 'STARTING';
    if (want === is) { out.unchanged.push(program); continue; }

    if (dryRun) {
      (want ? out.started : out.stopped).push({ name: program, action: want ? 'would-start' : 'would-stop' });
      continue;
    }
    const r = await run('docker', ['exec', CONTAINER, 'supervisorctl', want ? 'start' : 'stop', program], 60000);
    (want ? out.started : out.stopped).push({
      name: program,
      action: want ? 'started' : 'stopped',
      ok: r.ok,
      detail: r.ok ? '' : (r.stderr || r.stdout).trim().split('\n')[0],
    });
  }
  return out;
}

/**
 * @param {{resolved?: object, dryRun?: boolean, quiet?: boolean}} [opts]
 */
export async function applyFeatures(opts = {}) {
  const resolved = opts.resolved || loadFeatures({ force: true });
  const dryRun = opts.dryRun === true;
  const say = opts.quiet ? () => {} : (msg) => process.stdout.write(`${msg}\n`);

  if (!dryRun) writeSnapshot({ repoPath: REPO });

  const daemons = await reconcileDaemons(resolved, { dryRun });
  const container = await reconcileContainer(resolved, { dryRun });

  const changed = [
    ...daemons.started, ...daemons.stopped,
    ...container.started, ...container.stopped,
  ];

  if (!changed.length) {
    say(`✅ Already in sync (${platform()}): nothing to start or stop.`);
  } else {
    say(dryRun ? '🔎 Would apply:' : '🔧 Applying feature changes:');
    for (const r of changed) {
      const failed = r.ok === false;
      const suffix = r.reason ? ` — ${r.reason}` : (failed ? ` — FAILED: ${r.detail}` : '');
      say(`   ${failed ? '❌' : '•'} ${r.action} ${r.name}${suffix}`);
    }
  }

  if (!container.available) {
    // Not a failure: with knowledge, codegraph and constraints all off there is
    // no container, which is the whole point of the proxy-only profile.
    const wanted = Object.entries(CONTAINER_PROGRAMS)
      .some(([, f]) => resolved.features[f]?.enabled);
    if (wanted) {
      say('   ℹ️  coding-services is not running — container programs will follow the '
        + 'config at its next start.');
    }
  }

  // Hooks are fixed at launch (--settings), so nothing here can change them.
  // Saying so is the difference between "applied" and "applied, mostly".
  const sessionScoped = resolved.disabled
    .concat(resolved.enabled)
    .filter((id) => resolved.features[id].applyTier === 'session');
  if (sessionScoped.length && changed.length) {
    say(`   ℹ️  ${sessionScoped.join(', ')} affect agent hooks — new sessions only.`);
  }

  return { daemons, container, changed };
}

runIfMain(import.meta.url, async () => {
  const dryRun = process.argv.includes('--dry-run');
  const quiet = process.argv.includes('--quiet');
  try {
    await applyFeatures({ dryRun, quiet });
  } catch (error) {
    process.stderr.write(`❌ apply-features failed: ${error.message}\n`);
    process.exit(1);
  }
});
