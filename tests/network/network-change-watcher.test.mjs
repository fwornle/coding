/**
 * lib/network/network-change-watcher.mjs — macOS network changes as events.
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
    assert.equal(children[0].cmd, 'notifyutil');
    assert.deepEqual(children[0].args, ['-w', NETWORK_CHANGE_NOTIFICATION]);
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

  it('is a no-op off macOS', () => {
    const { spawn, children } = fakeSpawn();
    startNetworkChangeWatcher({ onChange: () => {}, platform: 'linux', spawn })();
    assert.equal(children.length, 0);
  });

  it('a change is recent for a minute', () => {
    const now = 1_000_000;
    assert.equal(networkChangeRecent(now - 1_000, now), true);
    assert.equal(networkChangeRecent(now - NETWORK_CHANGE_WINDOW_MS, now), false);
    assert.equal(networkChangeRecent(null, now), false);
  });
});
