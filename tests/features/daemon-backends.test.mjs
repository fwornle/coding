/**
 * The three daemon backends, asserted on every platform.
 *
 * `lib/features/daemons.mjs` speaks launchd, systemd --user and Task Scheduler.
 * Until this file existed, only the launchd path had ever run — the other two
 * were shipped-but-unverified, and a wrong flag or argument order in either
 * would have surfaced as "the toggle did nothing" on a machine none of us was
 * sitting at.
 *
 * These are CONTRACT tests: they drive the real code with a substituted
 * executor and assert the exact command lines and the parsing of real command
 * output. They run everywhere, so a Linux regression is caught on a Mac.
 *
 * The live round-trip against an actual service manager is
 * scripts/test-daemon-backend.mjs, run by the daemon-backends CI job on Linux
 * and Windows runners. Contract tests catch the wrong command; the live test
 * catches a command that is right on paper and rejected in practice.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DAEMONS, platform, listRunning, start, stop, reconcile } from '../../lib/features/daemons.mjs';

/** An executor that records calls and replays canned output. */
function recorder(responses = {}) {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(' ');
    for (const [pattern, value] of Object.entries(responses)) {
      if (key.includes(pattern)) return { ok: true, stdout: value, stderr: '' };
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  return { exec, calls, joined: () => calls.map((c) => c.join(' ')) };
}

const UID = process.getuid ? process.getuid() : 0;

describe('platform detection', () => {
  test('maps node platform names and accepts an override', () => {
    assert.equal(platform({ platform: 'darwin' }), 'macos');
    assert.equal(platform({ platform: 'linux' }), 'linux');
    assert.equal(platform({ platform: 'win32' }), 'windows');
    // The override also accepts our own vocabulary, so callers can pass either.
    assert.equal(platform({ platform: 'macos' }), 'macos');
    assert.equal(platform({ platform: 'windows' }), 'windows');
    assert.equal(platform({ platform: 'sunos' }), 'unsupported');
  });
});

describe('linux — systemd --user', () => {
  const opts = (r) => ({ platform: 'linux', exec: r.exec });

  test('listRunning asks for ACTIVE services in a parseable form', async () => {
    const r = recorder();
    await listRunning(opts(r));
    assert.deepEqual(r.calls[0], [
      'systemctl', '--user', 'list-units', '--type=service',
      '--state=active', '--no-legend', '--plain',
    ]);
    // --no-legend --plain matter: without them systemctl emits a header, a
    // trailing summary and unicode bullets, and the first column stops being
    // the unit name.
  });

  test('listRunning parses real systemctl output, and ignores units that are not ours', async () => {
    const r = recorder({
      'list-units': [
        'obs-api.service                loaded active running Coding observations API',
        'lsl-lock-sweeper.service       loaded active running Coding LSL lock sweeper',
        'pipewire.service               loaded active running PipeWire Multimedia Service',
        'dbus.service                   loaded active running D-Bus User Message Bus',
      ].join('\n'),
    });
    const running = await listRunning(opts(r));
    assert.deepEqual([...running].sort(), ['lsl-lock-sweeper', 'obs-api']);
  });

  test('stop disables as well as stopping', async () => {
    // Stopping alone leaves the unit enabled, so it comes back at the next
    // login and a feature switched off today switches itself on tomorrow.
    const r = recorder();
    await stopForced('obs-api', opts(r));
    assert.deepEqual(r.joined(), [
      'systemctl --user stop obs-api.service',
      'systemctl --user disable obs-api.service',
    ]);
  });

  test('a missing unit file is skipped, and runs no commands', async () => {
    const r = recorder();
    const result = await stop('obs-api', { ...opts(r), exists: () => false });
    assert.equal(result.action, 'skipped');
    assert.deepEqual(r.joined(), [], 'nothing should be executed for a unit that is not there');
  });

  test('start enables before starting', async () => {
    const r = recorder();
    await startForced('obs-api', opts(r));
    assert.deepEqual(r.joined(), [
      'systemctl --user enable obs-api.service',
      'systemctl --user start obs-api.service',
    ]);
  });

  test('unit names carry the .service suffix but no com.coding prefix', async () => {
    // The prefix is launchd's; a systemd unit called com.coding.obs-api.service
    // would simply not exist.
    const r = recorder();
    await startForced('sub-agent-live-claude', opts(r));
    for (const call of r.joined()) {
      assert.match(call, /sub-agent-live-claude\.service$/);
      assert.doesNotMatch(call, /com\.coding/);
    }
  });
});

describe('windows — Task Scheduler', () => {
  const opts = (r) => ({ platform: 'windows', exec: r.exec });

  test('isInstalled queries the task by its full path', async () => {
    const r = recorder();
    await import('../../lib/features/daemons.mjs').then((m) => m.isInstalled('obs-api', opts(r)));
    assert.deepEqual(r.calls[0], ['schtasks', '/Query', '/TN', '\\coding\\obs-api']);
  });

  test('listRunning treats a Disabled task as not running', async () => {
    const disabled = recorder({ '/Query': 'Status: Disabled\nTaskName: \\coding\\obs-api' });
    assert.equal((await listRunning(opts(disabled))).size, 0);

    const ready = recorder({ '/Query': 'Status: Ready\nTaskName: \\coding\\obs-api' });
    const running = await listRunning(opts(ready));
    assert.ok(running.size > 0, 'a Ready task must count as running');
  });

  // Windows has no unit FILE to stat, so its existence check shells out to
  // schtasks /Query — which is why every start/stop here opens with one.
  const afterProbe = (r) => {
    assert.deepEqual(r.joined()[0], 'schtasks /Query /TN \\coding\\obs-api',
      'the existence check must run before anything is changed');
    return r.joined().slice(1);
  };

  test('stop ends the task AND disables it', async () => {
    const r = recorder();
    await stopForced('obs-api', opts(r));
    assert.deepEqual(afterProbe(r), [
      'schtasks /End /TN \\coding\\obs-api',
      'schtasks /Change /TN \\coding\\obs-api /DISABLE',
    ]);
  });

  test('start enables the task then runs it', async () => {
    const r = recorder();
    await startForced('obs-api', opts(r));
    assert.deepEqual(afterProbe(r), [
      'schtasks /Change /TN \\coding\\obs-api /ENABLE',
      'schtasks /Run /TN \\coding\\obs-api',
    ]);
  });

  test('task paths use backslashes, which is not optional on schtasks', async () => {
    const r = recorder();
    await startForced('lsl-lock-sweeper', opts(r));
    for (const call of r.joined()) assert.match(call, /\\coding\\lsl-lock-sweeper/);
  });
});

describe('macos — launchd', () => {
  const opts = (r) => ({ platform: 'macos', exec: r.exec });

  test('listRunning parses the third column of launchctl list', async () => {
    const r = recorder({
      list: [
        'PID\tStatus\tLabel',
        '123\t0\tcom.coding.obs-api',
        '-\t0\tcom.coding.lsl-lock-sweeper',
        '456\t0\tcom.apple.something',
      ].join('\n'),
    });
    const running = await listRunning(opts(r));
    assert.deepEqual([...running].sort(), ['lsl-lock-sweeper', 'obs-api']);
  });

  test('stop boots out AND disables', async () => {
    // launchctl disable writes to the override database; without it a plist
    // with RunAtLoad returns at the next login.
    const r = recorder();
    await stopForced('obs-api', opts(r));
    assert.deepEqual(r.joined(), [
      `launchctl bootout gui/${UID}/com.coding.obs-api`,
      `launchctl disable gui/${UID}/com.coding.obs-api`,
    ]);
  });

  test('start enables then bootstraps the plist', async () => {
    const r = recorder();
    await startForced('obs-api', opts(r));
    assert.match(r.joined()[0], new RegExp(`launchctl enable gui/${UID}/com\\.coding\\.obs-api`));
    assert.match(r.joined()[1], /launchctl bootstrap gui\/\d+ .*com\.coding\.obs-api\.plist/);
  });
});

describe('reconcile', () => {
  test('starts what is missing and stops what should not run', async () => {
    const r = recorder({
      'list-units': 'obs-api.service loaded active running x\nmeasurement-reconciler.service loaded active running x',
    });
    const resolved = {
      features: Object.fromEntries(
        [...new Set(Object.values(DAEMONS))].map((f) => [f, { enabled: f === 'observations' }]),
      ),
    };
    const out = await reconcile(resolved, { platform: 'linux', exec: r.exec });

    // observations is on and obs-api is running -> unchanged.
    assert.ok(out.unchanged.includes('obs-api'));
    // performance is off and measurement-reconciler is running -> stop it.
    assert.ok(out.stopped.some((s) => s.name === 'measurement-reconciler'));
    // Nothing else was running, so nothing else needs stopping.
    for (const s of out.stopped) {
      assert.notEqual(s.name, 'obs-api');
    }
  });

  test('every daemon is considered exactly once', async () => {
    const r = recorder();
    const resolved = {
      features: Object.fromEntries([...new Set(Object.values(DAEMONS))].map((f) => [f, { enabled: true }])),
    };
    const out = await reconcile(resolved, { platform: 'linux', exec: r.exec });
    const seen = [...out.started.map((x) => x.name), ...out.stopped.map((x) => x.name), ...out.unchanged];
    assert.deepEqual(seen.sort(), Object.keys(DAEMONS).sort());
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
//
// start()/stop() short-circuit on "not installed", which is right in production
// and useless here: no runner has a com.coding.* unit file. `exists` is the
// seam that satisfies that check, so the assertions are about the BACKEND
// rather than about the guard.

const installed = { exists: () => true };
const startForced = (name, opts) => start(name, { ...opts, ...installed });
const stopForced = (name, opts) => stop(name, { ...opts, ...installed });
