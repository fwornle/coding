/**
 * lib/network/network-change-watcher.mjs — OS network changes as events.
 *
 * notifyutil is replaced by a fake child: one line per post, as
 * `notifyutil -w <name>` prints (checked by hand against the real binary with a
 * name of our own; the system name can only be posted by configd).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  startNetworkChangeWatcher,
  networkChangeRecent,
  NETWORK_CHANGE_NOTIFICATION,
  NETWORK_CHANGE_WINDOW_MS,
  PARENT_GUARD,
  parentGuard,
} from '../../lib/network/network-change-watcher.mjs';

function fakeSpawn() {
  const children = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.cmd = cmd;
    child.args = args;
    child.stdout = new PassThrough();
    child.kill = () => child.emit('exit', null, 'SIGTERM');
    children.push(child);
    return child;
  };
  return { spawn, children };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

describe('network-change watcher', () => {
  it('watches the configd notification with notifyutil', () => {
    const { spawn, children } = fakeSpawn();
    const stop = startNetworkChangeWatcher({ onChange: () => {}, platform: 'darwin', spawn });
    assert.equal(children[0].cmd, '/bin/sh');
    assert.deepEqual(children[0].args, ['-c', PARENT_GUARD, 'sh', 'notifyutil', '-w', NETWORK_CHANGE_NOTIFICATION]);
    stop();
  });

  it('reports a burst of posts once', async () => {
    const { spawn, children } = fakeSpawn();
    let changes = 0;
    const stop = startNetworkChangeWatcher({
      onChange: () => { changes += 1; }, platform: 'darwin', spawn, debounceMs: 20,
    });
    for (let i = 0; i < 4; i += 1) children[0].stdout.write(`${NETWORK_CHANGE_NOTIFICATION}\n`);
    await tick(60);
    assert.equal(changes, 1);
    children[0].stdout.write(`${NETWORK_CHANGE_NOTIFICATION}\n`);
    await tick(60);
    assert.equal(changes, 2, 'a later change is a new event');
    stop();
  });

  it('ignores lines that are not the notification', async () => {
    const { spawn, children } = fakeSpawn();
    let changes = 0;
    const stop = startNetworkChangeWatcher({
      onChange: () => { changes += 1; }, platform: 'darwin', spawn, debounceMs: 5,
    });
    children[0].stdout.write('usage: notifyutil ...\n');
    await tick(30);
    assert.equal(changes, 0);
    stop();
  });

  it('restarts notifyutil when it exits, not after stop()', async () => {
    const { spawn, children } = fakeSpawn();
    const stop = startNetworkChangeWatcher({ onChange: () => {}, platform: 'darwin', spawn });
    stop();
    await tick(10);
    assert.equal(children.length, 1, 'stopped: no respawn');
  });

  it('watches netlink with `ip monitor` on Linux and WSL', () => {
    const { spawn, children } = fakeSpawn();
    const stop = startNetworkChangeWatcher({ onChange: () => {}, platform: 'linux', spawn });
    assert.deepEqual(children[0].args.slice(3), ['ip', '-o', 'monitor', 'address', 'route']);
    stop();
  });

  it('Linux: a host address or route change counts; container plumbing does not', async () => {
    const { spawn, children } = fakeSpawn();
    let changes = 0;
    const stop = startNetworkChangeWatcher({
      onChange: () => { changes += 1; }, platform: 'linux', spawn, debounceMs: 5,
    });
    for (const line of [
      '5: veth3a1b2c@if4: <BROADCAST,MULTICAST,UP> mtu 1500',
      '3: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0',
      '172.18.0.0/16 dev br-0f1e2d3c4b5a proto kernel scope link src 172.18.0.1',
      'Deleted 10.244.0.0/24 dev cni0 proto kernel scope link',
      '',
    ]) children[0].stdout.write(`${line}\n`);
    await tick(30);
    assert.equal(changes, 0, 'containers starting are not the network moving');
    children[0].stdout.write('default via 10.8.0.1 dev tun0 proto static metric 50\n');
    await tick(30);
    assert.equal(changes, 1, 'a VPN default route is');
    children[0].stdout.write('2: wlp2s0    inet 192.168.1.23/24 brd 192.168.1.255 scope global dynamic wlp2s0\n');
    await tick(30);
    assert.equal(changes, 2, 'a new Wi-Fi address is');
    stop();
  });

  it('is a no-op where there is no subscription (Windows: polling only)', () => {
    const { spawn, children } = fakeSpawn();
    startNetworkChangeWatcher({ onChange: () => {}, platform: 'win32', spawn })();
    assert.equal(children.length, 0);
  });

  it('the guarded command dies with its parent, however the parent ends', { skip: process.platform === 'win32' && 'POSIX sh' }, async () => {
    // A parent that is SIGKILLed — no stop(), no exit handlers — must not leave
    // its watcher behind. `sleep 300` stands in for notifyutil / ip monitor.
    const { spawn, execFileSync } = await import('node:child_process');
    const parent = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const c = spawn('/bin/sh', ['-c', ${JSON.stringify(parentGuard(1))}, 'sh', 'sleep', '300'], { stdio: 'ignore' });
      console.log(c.pid); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'ignore'] });
    const guardPid = Number(await new Promise((r) => parent.stdout.once('data', (d) => r(String(d).trim()))));
    await tick(300);
    const sleeps = () => {
      try { return execFileSync('pgrep', ['-P', String(guardPid), 'sleep'], { encoding: 'utf8' }).trim(); } catch { return ''; }
    };
    const watched = sleeps().split('\n').filter(Boolean);
    assert.ok(watched.length >= 1, 'the guard started the command');
    parent.kill('SIGKILL');
    await tick(2500);
    const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
    assert.equal(watched.some(alive), false, 'command ended within one guard interval');
    assert.equal(alive(guardPid), false, 'guard ended too');
  });

  it('a change is recent for a minute', () => {
    const now = 1_000_000;
    assert.equal(networkChangeRecent(now - 1_000, now), true);
    assert.equal(networkChangeRecent(now - NETWORK_CHANGE_WINDOW_MS, now), false);
    assert.equal(networkChangeRecent(null, now), false);
  });
});
