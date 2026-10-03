/**
 * lib/kb/embed-index.mjs — knowledge that arrives by git gets embedded (T8).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createIndexScheduler } from '../../lib/kb/embed-index.mjs';

const dir = mkdtempSync(join(tmpdir(), 'embed-index-'));
const script = join(dir, 'backfill.js');
writeFileSync(script, '');
test.after(() => rmSync(dir, { recursive: true, force: true }));

function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    calls.push({ cmd, args, child });
    return child;
  };
  return { spawn, calls };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('triggers inside the debounce window run ONE pass of the backfill script', async () => {
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const s = createIndexScheduler({ script, delayMs: 20, spawn, log: (m) => logs.push(m) });
  s.schedule('startup');
  s.schedule('kb reload');
  await wait(50);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [script]);
  calls[0].child.stderr.emit('data', '[Backfill] Total: 3 points across 4 collections (0 skipped, 0 failed)\n');
  calls[0].child.emit('exit', 0);
  assert.match(logs.at(-1), /startup, kb reload: exit 0 .*Total: 3 points/);
});

test('a trigger during a pass runs exactly one more pass after it', async () => {
  const { spawn, calls } = fakeSpawn();
  const s = createIndexScheduler({ script, delayMs: 10, spawn, log: () => {} });
  s.schedule('startup');
  await wait(30);
  assert.equal(s.running, true);
  s.schedule('kb reload');
  s.schedule('kb reload');
  await wait(30);
  assert.equal(calls.length, 1, 'never two passes at once');
  calls[0].child.emit('exit', 0);
  await wait(30);
  assert.equal(calls.length, 2);
  calls[1].child.emit('exit', 0);
  await wait(30);
  assert.equal(calls.length, 2);
  assert.equal(s.pending, false);
});

test('a pass killed by a signal names the signal and the fatal error', async () => {
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const s = createIndexScheduler({ script, delayMs: 5, spawn, log: (m) => logs.push(m) });
  s.schedule('startup');
  await wait(20);
  calls[0].child.stderr.emit('data', '[Backfill] Fatal error: fetch failed\n');
  calls[0].child.emit('exit', null, 'SIGABRT');
  assert.match(logs.at(-1), /exit SIGABRT .*Fatal error: fetch failed/);
});

test('an unbuilt script is skipped, not spawned', async () => {
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const s = createIndexScheduler({ script: join(dir, 'missing.js'), delayMs: 5, spawn, log: (m) => logs.push(m) });
  s.schedule('startup');
  await wait(20);
  assert.equal(calls.length, 0);
  assert.match(logs[0], /not built/);
});
