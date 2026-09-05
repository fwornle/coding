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
 *   ETMs                the one artifact with no supervisor of either kind —
 *                       spawned detached by the health coordinator, so only a
 *                       process listing can find it and only a signal can stop it
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
import { writeSnapshot, readSnapshot } from '../lib/features/snapshot.cjs';
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

/**
 * supervisorctl status, as {program: {state, target}}, or null if unreachable.
 *
 * `target` keeps the GROUP-QUALIFIED name ("mcp-servers:graphify"). Programs in
 * this image all belong to a group, and supervisorctl rejects the bare name —
 * `supervisorctl start graphify` is "ERROR (no such process)". The bare name is
 * still the key, because that is what the feature mapping and supervisord.conf
 * use; only the command needs the qualifier.
 */
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
    const target = m[1];
    const name = target.includes(':') ? target.split(':').pop() : target;
    status[name] = { state: m[2], target };
  }
  return Object.keys(status).length ? status : null;
}

/**
 * Running ETMs, as `{pid, projectPath}`.
 *
 * The enhanced transcript monitor is the writer behind the `lsl` feature, and
 * it is the one artifact that is neither a host DAEMON nor a container program:
 * the health coordinator spawns it `detached` and `unref()`s it, so it has no
 * supervisor entry to stop and it outlives whoever started it. Process listing
 * is therefore the only handle on it.
 *
 * @param {{list?: () => Promise<{ok:boolean, stdout:string}>}} [opts] seam for tests
 */
export async function listEtms(opts = {}) {
  if (platform() === 'windows') return [];
  // /bin/ps by absolute path: `ps` is aliased on this developer's shells, and a
  // seam that silently returns nothing would make the reap below a no-op that
  // still reports success.
  const list = opts.list || (() => run('/bin/ps', ['-Ao', 'pid=,args=']));
  const r = await list();
  if (!r.ok) return [];
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+.*enhanced-transcript-monitor\.js\s+(\S+)/.exec(line);
    if (m) out.push({ pid: parseInt(m[1], 10), projectPath: m[2] });
  }
  return out;
}

/**
 * Stop the ETMs when `lsl` is off.
 *
 * Only ever STOPS. Spawning is the coordinator's safety-net sweep, which is
 * gated on the same feature — an apply that started ETMs itself would be a
 * second spawner racing the first.
 *
 * This exists because the coordinator's own reap cannot cover every case: turn
 * `lsl` and `health` off in one change and the coordinator is stopped in the
 * same pass, leaving detached ETMs writing .specstory/history indefinitely —
 * measured at two of them, up 8-9 hours, under `minimal`.
 *
 * SIGTERM so the ETM's shutdown handler runs; a dead pid is success, not an
 * error, because "not running" is the state being asked for.
 */
export async function reconcileEtm(resolved, { dryRun, ...opts } = {}) {
  const out = { started: [], stopped: [], unchanged: [] };
  const running = await listEtms(opts);
  if (resolved.features.lsl?.enabled === true) {
    for (const e of running) out.unchanged.push(etmName(e));
    return out;
  }
  const kill = opts.kill || ((pid) => process.kill(pid, 'SIGTERM'));
  for (const e of running) {
    if (dryRun) { out.stopped.push({ name: etmName(e), action: 'would-stop' }); continue; }
    let ok = true;
    let detail = '';
    try { kill(e.pid); } catch (err) { ok = err.code === 'ESRCH'; detail = err.message; }
    out.stopped.push({ name: etmName(e), action: 'stopped', ok, detail });
  }
  return out;
}

const etmName = (e) => `etm(${e.projectPath.split('/').filter(Boolean).pop() || e.projectPath})`;

async function reconcileContainer(resolved, { dryRun }) {
  const status = await containerStatus();
  if (!status) {
    return { available: false, started: [], stopped: [], unchanged: [] };
  }

  const out = { available: true, started: [], stopped: [], unchanged: [] };
  for (const [program, feature] of Object.entries(CONTAINER_PROGRAMS)) {
    const want = resolved.features[feature]?.enabled === true;
    const entry = status[program];
    if (entry === undefined) continue; // not in this image
    const is = entry.state === 'RUNNING' || entry.state === 'STARTING';
    if (want === is) { out.unchanged.push(program); continue; }

    if (dryRun) {
      (want ? out.started : out.stopped).push({ name: program, action: want ? 'would-start' : 'would-stop' });
      continue;
    }
    const r = await run('docker', ['exec', CONTAINER, 'supervisorctl', want ? 'start' : 'stop', entry.target], 60000);
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

  // Read the previous snapshot BEFORE overwriting it: it is the only record of
  // what the system was last told to run, and without it the hook advice below
  // would have to fire on every apply — including ones that changed nothing
  // hook-related, which trains the reader to ignore it.
  const previous = readSnapshot({ repoPath: REPO })?.features ?? null;

  if (!dryRun) writeSnapshot({ repoPath: REPO });

  const daemons = await reconcileDaemons(resolved, { dryRun });
  const etm = await reconcileEtm(resolved, { dryRun, ...(opts.etm || {}) });
  const container = await reconcileContainer(resolved, { dryRun });

  const changed = [
    ...daemons.started, ...daemons.stopped,
    ...etm.started, ...etm.stopped,
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

  // Stopping `health` takes down the coordinator and the dashboard — including
  // the editor that most likely just requested this. Whatever terminal or log
  // this lands in is the ONLY place the way back can still be printed, so it is
  // printed unconditionally rather than as a nicety.
  // `stopped` or `would-stop`: a --dry-run that does not mention the way back
  // is precisely the run someone does BEFORE deciding, so it is the one that
  // most needs to say it.
  if (!resolved.features.health?.enabled
      && changed.some((r) => r.name === 'health-coordinator' && r.action.endsWith('stop'))) {
    say('');
    say('⚠️  Health Monitoring is now off: the coordinator and the dashboard have stopped.');
    say('    The dashboard cannot turn it back on, because the dashboard is part of it.');
    say('    To restore everything:  coding-features profile full');
    say('    Or just health:         coding-features set health on');
    say('');
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
  // Saying so is the difference between "applied" and "applied, mostly" — but
  // only for features that actually FLIPPED, and only ones whose reach is an
  // agent session.
  const flipped = previous
    ? Object.keys(resolved.features).filter(
      (id) => previous[id] !== undefined && previous[id] !== resolved.features[id].enabled,
    )
    : [];
  const sessionScoped = flipped.filter((id) => resolved.features[id].applyTier === 'session');
  if (sessionScoped.length) {
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
