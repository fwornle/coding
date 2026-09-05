/**
 * Platform-abstracted control of the background daemons `coding` installs.
 *
 * Three service managers, one vocabulary:
 *
 *   macOS    launchd            ~/Library/LaunchAgents/<label>.plist
 *   Linux    systemd --user     ~/.config/systemd/user/<name>.service
 *   Windows  Task Scheduler     \coding\<name>
 *
 * This module only STARTS and STOPS units that already exist. Installing them
 * is install.sh's job, and deliberately stays there: creating a unit is a change
 * to the user's machine that belongs in the mutation manifest they consented to,
 * not in a config-apply step.
 *
 * Every operation is idempotent and reports what it actually did, because
 * "stopped" and "was not installed in the first place" lead to very different
 * next steps for whoever is reading the output.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { join } from 'node:path';

import { FEATURE_IDS } from './index.mjs';

const exec = promisify(execFile);

/**
 * The host daemons, and which feature owns each.
 *
 * The container-side half of this table lives in docker/entrypoint.sh; both are
 * cross-checked against docs/architecture/features.md by
 * tests/features/daemon-gating.test.mjs.
 *
 * Names are given without the `com.coding.` prefix (macOS) / `.service` suffix
 * (Linux), which each backend adds.
 */
export const DAEMONS = {
  'lsl-lock-sweeper': 'lsl',
  'sub-agent-live-claude': 'lsl',
  'sub-agent-live-copilot': 'lsl',
  'sub-agent-live-opencode': 'lsl',
  'sub-agent-sweep': 'lsl',
  'obs-api': 'observations',
  'digest-refs-sweeper': 'observations',
  'llm-cli-proxy': 'llm-proxy',
  'prompt-classifier': 'llm-proxy',
  'measurement-reconciler': 'performance',
  'auto-measure-foreground': 'performance',
  'context-turns-sweeper': 'performance',
  'health-coordinator': 'health',
};

/** @returns {'macos'|'linux'|'windows'|'unsupported'} */
export function platform() {
  switch (osPlatform()) {
    case 'darwin': return 'macos';
    case 'linux': return 'linux';
    case 'win32': return 'windows';
    default: return 'unsupported';
  }
}

const label = (name) => `com.coding.${name}`;
const plistPath = (name) => join(homedir(), 'Library', 'LaunchAgents', `${label(name)}.plist`);
const unitPath = (name) => join(homedir(), '.config', 'systemd', 'user', `${name}.service`);

/** Run a command, never throwing. Callers decide what a non-zero status means. */
async function run(cmd, args) {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 20000 });
    return { ok: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message, code: err.code };
  }
}

/**
 * Is a unit installed on this machine? A daemon that was never installed is not
 * an error — a wrapper-scoped install has none of them — so callers must be able
 * to tell "not installed" from "failed to stop".
 */
export async function isInstalled(name) {
  switch (platform()) {
    case 'macos':
      return existsSync(plistPath(name));
    case 'linux':
      return existsSync(unitPath(name));
    case 'windows': {
      const r = await run('schtasks', ['/Query', '/TN', `\\coding\\${name}`]);
      return r.ok;
    }
    default:
      return false;
  }
}

/** Which of our daemons are currently loaded/active. */
export async function listRunning() {
  const out = new Set();
  switch (platform()) {
    case 'macos': {
      const r = await run('launchctl', ['list']);
      if (!r.ok) return out;
      for (const line of r.stdout.split('\n')) {
        const name = line.trim().split(/\s+/)[2];
        if (name?.startsWith('com.coding.')) out.add(name.slice('com.coding.'.length));
      }
      return out;
    }
    case 'linux': {
      const r = await run('systemctl', ['--user', 'list-units', '--type=service', '--state=active', '--no-legend', '--plain']);
      if (!r.ok) return out;
      for (const line of r.stdout.split('\n')) {
        const unit = line.trim().split(/\s+/)[0];
        if (!unit?.endsWith('.service')) continue;
        const name = unit.slice(0, -'.service'.length);
        if (DAEMONS[name]) out.add(name);
      }
      return out;
    }
    case 'windows': {
      for (const name of Object.keys(DAEMONS)) {
        const r = await run('schtasks', ['/Query', '/TN', `\\coding\\${name}`, '/FO', 'LIST']);
        if (r.ok && !/Disabled/i.test(r.stdout)) out.add(name);
      }
      return out;
    }
    default:
      return out;
  }
}

/**
 * Stop a daemon and keep it stopped.
 *
 * On macOS `bootout` alone is not enough: a plist in ~/Library/LaunchAgents with
 * RunAtLoad comes back at the next login, so a feature switched off today would
 * quietly switch itself on tomorrow. `launchctl disable` records the decision in
 * launchd's override database, which is what makes it stick.
 */
export async function stop(name, { dryRun = false } = {}) {
  if (!(await isInstalled(name))) return { name, action: 'skipped', reason: 'not installed' };
  if (dryRun) return { name, action: 'would-stop' };

  switch (platform()) {
    case 'macos': {
      const target = `gui/${process.getuid()}/${label(name)}`;
      await run('launchctl', ['bootout', target]);
      const dis = await run('launchctl', ['disable', target]);
      // bootout returns non-zero when the job was already unloaded, which is a
      // success for our purposes; `disable` is the operation that must land.
      return { name, action: 'stopped', ok: dis.ok, detail: dis.ok ? '' : dis.stderr.trim() };
    }
    case 'linux': {
      await run('systemctl', ['--user', 'stop', `${name}.service`]);
      const dis = await run('systemctl', ['--user', 'disable', `${name}.service`]);
      return { name, action: 'stopped', ok: dis.ok, detail: dis.ok ? '' : dis.stderr.trim() };
    }
    case 'windows': {
      await run('schtasks', ['/End', '/TN', `\\coding\\${name}`]);
      const dis = await run('schtasks', ['/Change', '/TN', `\\coding\\${name}`, '/DISABLE']);
      return { name, action: 'stopped', ok: dis.ok, detail: dis.ok ? '' : dis.stderr.trim() };
    }
    default:
      return { name, action: 'skipped', reason: `unsupported platform ${osPlatform()}` };
  }
}

/** Start a daemon, undoing a previous stop. */
export async function start(name, { dryRun = false } = {}) {
  if (!(await isInstalled(name))) {
    // Enabling a feature whose daemon was never installed is the case
    // `coding-features repair` exists for; say so rather than reporting success.
    return { name, action: 'skipped', reason: 'not installed — run: coding-features repair' };
  }
  if (dryRun) return { name, action: 'would-start' };

  switch (platform()) {
    case 'macos': {
      const domain = `gui/${process.getuid()}`;
      await run('launchctl', ['enable', `${domain}/${label(name)}`]);
      const boot = await run('launchctl', ['bootstrap', domain, plistPath(name)]);
      // "service already bootstrapped" is success, not failure.
      const already = /already (bootstrapped|loaded)/i.test(boot.stderr);
      return { name, action: 'started', ok: boot.ok || already, detail: boot.ok || already ? '' : boot.stderr.trim() };
    }
    case 'linux': {
      await run('systemctl', ['--user', 'enable', `${name}.service`]);
      const st = await run('systemctl', ['--user', 'start', `${name}.service`]);
      return { name, action: 'started', ok: st.ok, detail: st.ok ? '' : st.stderr.trim() };
    }
    case 'windows': {
      await run('schtasks', ['/Change', '/TN', `\\coding\\${name}`, '/ENABLE']);
      const st = await run('schtasks', ['/Run', '/TN', `\\coding\\${name}`]);
      return { name, action: 'started', ok: st.ok, detail: st.ok ? '' : st.stderr.trim() };
    }
    default:
      return { name, action: 'skipped', reason: `unsupported platform ${osPlatform()}` };
  }
}

/**
 * Bring the daemons in line with a resolved feature set.
 *
 * @param {ReturnType<import('./index.mjs').loadFeatures>} resolved
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<{started: object[], stopped: object[], unchanged: string[]}>}
 */
export async function reconcile(resolved, opts = {}) {
  const running = await listRunning();
  const out = { started: [], stopped: [], unchanged: [] };

  for (const [name, feature] of Object.entries(DAEMONS)) {
    const want = resolved.features[feature]?.enabled === true;
    const is = running.has(name);
    if (want === is) { out.unchanged.push(name); continue; }
    const result = want ? await start(name, opts) : await stop(name, opts);
    (want ? out.started : out.stopped).push(result);
  }
  return out;
}

/** Every feature named by a daemon, for the drift test. */
export function daemonFeatures() {
  return [...new Set(Object.values(DAEMONS))].filter((f) => FEATURE_IDS.includes(f));
}
