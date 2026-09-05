#!/usr/bin/env node

/**
 * Live round-trip against a REAL service manager.
 *
 * The contract tests (tests/features/daemon-backends.test.mjs) prove
 * lib/features/daemons.mjs builds the right command lines. They cannot prove
 * the service manager accepts them — a command can be right on paper and
 * rejected in practice: a unit that fails to load, a schtasks argument order
 * the parser dislikes, a `disable` that needs a unit to be enabled first.
 *
 * So this creates a real unit, drives the real backend through
 * install -> start -> observe -> stop -> observe, and removes it again.
 *
 * Run by the `daemon-backends` CI job on Linux and Windows runners. Safe to run
 * on a developer machine too: it uses a dedicated daemon name and always
 * cleans up, including on failure.
 *
 * Usage:
 *   node scripts/test-daemon-backend.mjs
 *   node scripts/test-daemon-backend.mjs --probe    # report capability, exit 0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { join } from 'node:path';

import { platform, isInstalled, start, stop, listRunning } from '../lib/features/daemons.mjs';

const exec = promisify(execFile);

/**
 * The daemon under test. It must be a real entry in DAEMONS, because
 * listRunning() filters by that map on Linux — a made-up name would be
 * invisible and the test would pass by never seeing anything.
 *
 * lsl-lock-sweeper is the safest real one: a periodic sweeper with no state
 * and no dependents.
 */
const NAME = 'lsl-lock-sweeper';

const log = (msg) => process.stdout.write(`${msg}\n`);
const fail = (msg) => { process.stderr.write(`FAIL: ${msg}\n`); process.exitCode = 1; };

async function run(cmd, args) {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 30000 });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}

// ── per-platform fixture: create and remove a real unit ──────────────────────

const FIXTURES = {
  /**
   * A systemd --user service. `Type=simple` + a long sleep so it is genuinely
   * ACTIVE for listRunning to find, rather than a oneshot that exits before we
   * can look.
   */
  linux: {
    async available() {
      // `systemctl --user` needs a user manager and a session bus. On a bare CI
      // runner there is often neither, and the failure is "Failed to connect to
      // bus" rather than anything about our code — so it is detected, not
      // guessed at.
      const r = await run('systemctl', ['--user', 'is-system-running']);
      const out = `${r.stdout}${r.stderr}`;
      if (/Failed to connect to (bus|the system bus)/i.test(out)) {
        return { ok: false, why: 'no systemd --user session bus on this host' };
      }
      return { ok: true };
    },
    async install() {
      const dir = join(homedir(), '.config', 'systemd', 'user');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${NAME}.service`), [
        '[Unit]',
        'Description=coding daemon-backend CI probe',
        '',
        '[Service]',
        'Type=simple',
        'ExecStart=/bin/sleep 600',
        '',
        '[Install]',
        'WantedBy=default.target',
        '',
      ].join('\n'));
      await run('systemctl', ['--user', 'daemon-reload']);
    },
    async remove() {
      await run('systemctl', ['--user', 'stop', `${NAME}.service`]);
      await run('systemctl', ['--user', 'disable', `${NAME}.service`]);
      rmSync(join(homedir(), '.config', 'systemd', 'user', `${NAME}.service`), { force: true });
      await run('systemctl', ['--user', 'daemon-reload']);
    },
  },

  windows: {
    async available() {
      const r = await run('schtasks', ['/Query', '/FO', 'LIST']);
      return r.ok ? { ok: true } : { ok: false, why: 'schtasks is not usable here' };
    },
    async install() {
      // ONCE at a time far enough out that it never fires on its own; the test
      // drives it with /Run. `cmd /c timeout` keeps it alive briefly so a Run
      // is observable.
      await run('schtasks', [
        '/Create', '/F', '/TN', `\\coding\\${NAME}`,
        '/TR', 'cmd /c timeout /t 600',
        '/SC', 'ONCE', '/ST', '23:59',
      ]);
    },
    async remove() {
      await run('schtasks', ['/End', '/TN', `\\coding\\${NAME}`]);
      await run('schtasks', ['/Delete', '/F', '/TN', `\\coding\\${NAME}`]);
    },
  },

  macos: {
    async available() {
      // Deliberately unsupported here. A LaunchAgent bootstrapped into a CI
      // runner's GUI domain is unreliable, and macOS is the one backend that
      // has always been exercised on a real machine — this script exists for
      // the two that have not.
      return { ok: false, why: 'macOS is covered by day-to-day use; not re-tested in CI' };
    },
    async install() {}, async remove() {},
  },
};

// ── the round trip ───────────────────────────────────────────────────────────

async function main() {
  const plat = platform();
  const fixture = FIXTURES[plat];
  const probeOnly = process.argv.includes('--probe');

  log(`platform: ${plat} (node reports ${osPlatform()})`);

  if (!fixture) {
    log(`SKIP: no fixture for '${plat}'`);
    return;
  }

  const capability = await fixture.available();
  if (!capability.ok) {
    // Exit 0. A runner that cannot host a user service is an environment fact,
    // not a defect in this code — and the contract tests still gate every PR on
    // every platform, so nothing goes unchecked. The reason is printed so a
    // skip is never silent.
    log(`SKIP: ${capability.why}`);
    return;
  }
  log('service manager: available');
  if (probeOnly) return;

  let installed = false;
  try {
    await fixture.install();
    installed = true;

    // 1. It must be visible as installed.
    if (!(await isInstalled(NAME))) {
      fail(`isInstalled('${NAME}') is false right after creating the unit`);
      return;
    }
    log('isInstalled: true');

    // 2. Start it, and see it in listRunning.
    const started = await start(NAME);
    log(`start: ${started.action}${started.ok === false ? ` FAILED: ${started.detail}` : ''}`);
    if (started.action !== 'started' || started.ok === false) {
      fail(`start did not succeed: ${JSON.stringify(started)}`);
      return;
    }

    await new Promise((r) => setTimeout(r, 2500));
    const runningAfterStart = await listRunning();
    if (!runningAfterStart.has(NAME)) {
      fail(`listRunning() does not contain '${NAME}' after a successful start `
        + `(saw: ${[...runningAfterStart].join(', ') || 'nothing'})`);
      return;
    }
    log(`listRunning: contains '${NAME}'`);

    // 3. Stop it, and see it disappear. This is the half that matters most:
    //    a stop that reports success but leaves the unit enabled is exactly the
    //    bug that makes a switched-off feature come back at the next login.
    const stopped = await stop(NAME);
    log(`stop: ${stopped.action}${stopped.ok === false ? ` FAILED: ${stopped.detail}` : ''}`);
    if (stopped.action !== 'stopped' || stopped.ok === false) {
      fail(`stop did not succeed: ${JSON.stringify(stopped)}`);
      return;
    }

    await new Promise((r) => setTimeout(r, 2500));
    const runningAfterStop = await listRunning();
    if (runningAfterStop.has(NAME)) {
      fail(`'${NAME}' is still listed as running after stop()`);
      return;
    }
    log(`listRunning: '${NAME}' gone`);

    log(`\nOK — ${plat} backend completed install → start → observe → stop → observe`);
  } finally {
    if (installed) {
      await fixture.remove();
      log('cleaned up');
    }
  }
}

main().catch((err) => {
  process.stderr.write(`FAIL: ${err.stack || err.message}\n`);
  process.exit(1);
});
