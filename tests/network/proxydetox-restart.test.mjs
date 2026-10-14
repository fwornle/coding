/**
 * lib/network/proxydetox-restart.mjs — the heal's restart, per service manager.
 * The command runner is injected; every platform's command line is asserted on
 * every host.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { restartProxydetox, SYSTEMD_UNIT, LAUNCHD_LABEL } from '../../lib/network/proxydetox-restart.mjs';

function fakeRun(fail = () => null) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const err = fail(cmd, args);
    if (err) throw err;
    return { stdout: '', stderr: '' };
  };
  return { run, calls };
}

describe('restartProxydetox', () => {
  it('macOS: launchctl kickstart, falling back to bootstrap / load', async () => {
    const { run, calls } = fakeRun();
    const r = await restartProxydetox({ platform: 'darwin', run });
    assert.equal(r.action, 'restarted');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'bash');
    assert.match(calls[0][2], new RegExp(`launchctl kickstart -k gui/\\$\\(id -u\\)/${LAUNCHD_LABEL}`));
    assert.match(calls[0][2], /\|\| launchctl bootstrap .*\|\| launchctl load /);
  });

  it('Linux / WSL: systemctl --user restart, once the unit is known to exist', async () => {
    const { run, calls } = fakeRun();
    const r = await restartProxydetox({ platform: 'linux', run });
    assert.equal(r.action, 'restarted');
    assert.deepEqual(calls, [
      ['systemctl', '--user', 'cat', SYSTEMD_UNIT],
      ['systemctl', '--user', 'restart', SYSTEMD_UNIT],
    ]);
  });

  it('Linux without the unit: unmanaged, and nothing is restarted', async () => {
    const { run, calls } = fakeRun((cmd, args) => (args[1] === 'cat' ? new Error('No files found for proxydetox.service.') : null));
    const r = await restartProxydetox({ platform: 'linux', run });
    assert.equal(r.action, 'unmanaged');
    assert.match(r.detail, /proxydetox\.service/);
    assert.deepEqual(calls, [['systemctl', '--user', 'cat', SYSTEMD_UNIT]]);
  });

  it('a restart that times out throws with killed, for the caller to tell from a failure', async () => {
    const { run } = fakeRun((cmd, args) => (args[1] === 'restart' ? Object.assign(new Error('timeout'), { killed: true }) : null));
    await assert.rejects(restartProxydetox({ platform: 'linux', run }), (e) => e.killed === true);
  });

  it('Windows and anything else: unmanaged, no command run', async () => {
    const { run, calls } = fakeRun();
    assert.equal((await restartProxydetox({ platform: 'win32', run })).action, 'unmanaged');
    assert.equal(calls.length, 0);
  });
});
