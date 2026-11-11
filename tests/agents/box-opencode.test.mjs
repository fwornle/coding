/**
 * opencode in the agent box, by default, with its sessions visible on the host.
 *
 * opencode's store is SQLite in WAL mode, which must not be shared between the
 * Linux box and the macOS host. So the box keeps its own database, and
 * scripts/box-opencode-sync.mjs exports a single-file snapshot into a host
 * directory that every host reader finds through lib/lsl/opencode-dbs.cjs.
 *
 * Uses node:sqlite throughout, so it runs both on the host and inside the box
 * (where the macOS better-sqlite3 build cannot load).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { boxRunArgs, BOX_OPENCODE_DB, BOX_OPENCODE_EXPORT } from '../../scripts/agent-box.mjs';
import { parseArgs, snapshot, run } from '../../scripts/box-opencode-sync.mjs';

const require = createRequire(import.meta.url);
const stores = require('../../lib/lsl/opencode-dbs.cjs');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'box-opencode-'));

function walDb(file, rows = 3) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE session (id TEXT, directory TEXT, time_updated INTEGER)');
  const ins = db.prepare('INSERT INTO session VALUES (?, ?, ?)');
  for (let i = 0; i < rows; i++) ins.run(`ses_${i}`, '/proj', i);
  return db; // left open: the WAL holds the rows, as while opencode runs
}

describe('lib/lsl/opencode-dbs.cjs — which stores the host reads', () => {
  test('host store first, then the box snapshot — only the ones that exist', () => {
    const home = tmpdir();
    const env = {};
    assert.deepEqual(stores.opencodeDbs({ home, env }), []);
    walDb(stores.hostOpencodeDb({ home })).close();
    assert.deepEqual(stores.opencodeDbs({ home, env }), [stores.hostOpencodeDb({ home })]);
    walDb(stores.boxOpencodeDb({ home, env })).close();
    assert.deepEqual(stores.opencodeDbs({ home, env }), [stores.hostOpencodeDb({ home }), stores.boxOpencodeDb({ home, env })]);
  });

  test('the box snapshot lives under ~/.coding/box/opencode unless CODING_BOX_OPENCODE_EXPORT moves it', () => {
    assert.equal(stores.boxOpencodeDb({ home: '/h', env: {} }), '/h/.coding/box/opencode/opencode.db');
    assert.equal(stores.boxOpencodeDb({ home: '/h', env: { CODING_BOX_OPENCODE_EXPORT: '/x' } }), '/x/opencode.db');
  });

  test('an override (test fixture, --db) means exactly that store', () => {
    const home = tmpdir();
    walDb(stores.hostOpencodeDb({ home })).close();
    walDb(stores.boxOpencodeDb({ home, env: {} })).close();
    const fixture = path.join(home, 'fixture.db');
    walDb(fixture).close();
    assert.deepEqual(stores.opencodeDbs({ home, env: {}, override: fixture }), [fixture]);
    assert.deepEqual(stores.opencodeDbs({ home, env: {}, override: path.join(home, 'absent.db') }), []);
  });

  test('newestOpencodeDb picks the store written last (a WAL write counts)', () => {
    const home = tmpdir();
    const host = stores.hostOpencodeDb({ home });
    const box = stores.boxOpencodeDb({ home, env: {} });
    walDb(host).close();
    walDb(box).close();
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(host, old, old);
    assert.equal(stores.newestOpencodeDb({ home, env: {} }), box);
    fs.utimesSync(box, old, old);
    fs.writeFileSync(`${host}-wal`, 'x');
    assert.equal(stores.newestOpencodeDb({ home, env: {} }), host);
  });
});

describe('scripts/box-opencode-sync.mjs — the export inside the box', () => {
  test('parseArgs needs a db, an export dir and a command', () => {
    assert.deepEqual(parseArgs(['--db', '/d', '--out', '/o', '--', 'opencode', '-c']),
      { db: '/d', out: '/o', every: 3000, command: ['opencode', '-c'] });
    assert.equal(parseArgs(['--db', '/d', '--out', '/o', '--every', '500', '--', 'x']).every, 500);
    assert.throws(() => parseArgs(['--db', '/d', '--', 'x']), /usage/);
    assert.throws(() => parseArgs(['--db', '/d', '--out', '/o']), /usage/);
    assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  });

  test('snapshot: a consistent single-file copy (no WAL) of a database opencode still has open', async () => {
    const dir = tmpdir();
    const live = walDb(path.join(dir, 'live.db'), 5);
    assert.equal(await snapshot(path.join(dir, 'live.db'), path.join(dir, 'out')), true);
    live.close();
    const copy = new DatabaseSync(path.join(dir, 'out', 'opencode.db'), { readOnly: true });
    try {
      assert.equal(copy.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
      assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM session').get().n, 5);
    } finally { copy.close(); }
    assert.deepEqual(fs.readdirSync(path.join(dir, 'out')), ['opencode.db'], 'no temp files left behind');
  });

  test('snapshot: nothing to copy before opencode has created its database', async () => {
    const dir = tmpdir();
    assert.equal(await snapshot(path.join(dir, 'absent.db'), path.join(dir, 'out')), false);
    assert.equal(fs.existsSync(path.join(dir, 'out', 'opencode.db')), false);
  });

  function fakeChild() {
    const child = new EventEmitter();
    child.killed = [];
    child.kill = (sig) => child.killed.push(sig);
    return child;
  }

  test('run: copies while the agent runs and once more after it exits; the exit code is the agent\'s', async () => {
    const dir = tmpdir();
    const db = path.join(dir, 'live.db');
    walDb(db).close();
    const child = fakeChild();
    const calls = [];
    const done = run({ db, out: path.join(dir, 'out'), every: 60_000, command: ['opencode', '-c'] }, {
      spawnImpl: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return child; },
      snapshotImpl: async () => { calls.push('snap'); return true; },
      log: () => {},
    });
    await new Promise((r) => setImmediate(r));
    child.emit('exit', 3, null);
    assert.equal(await done, 3);
    assert.deepEqual(calls[0], { cmd: 'opencode', args: ['-c'], opts: { stdio: 'inherit' } });
    assert.equal(calls.filter((c) => c === 'snap').length, 2, 'the first copy, then the final one at exit');
  });

  test('run: a failed copy is logged, never thrown into the agent\'s terminal', async () => {
    const dir = tmpdir();
    const child = fakeChild();
    const logged = [];
    const done = run({ db: path.join(dir, 'x.db'), out: dir, every: 60_000, command: ['opencode'] }, {
      spawnImpl: () => child,
      snapshotImpl: async () => { throw new Error('disk full'); },
      log: (m) => logged.push(m),
    });
    await new Promise((r) => setImmediate(r));
    child.emit('exit', 0, null);
    assert.equal(await done, 0);
    assert.ok(logged.some((m) => /snapshot failed: disk full/.test(m)), logged.join('\n'));
  });

  test('run: an agent killed by a signal exits 128+n', async () => {
    const child = fakeChild();
    const done = run({ db: '/nonexistent.db', out: tmpdir(), every: 60_000, command: ['opencode'] }, {
      spawnImpl: () => child, snapshotImpl: async () => false, log: () => {},
    });
    await new Promise((r) => setImmediate(r));
    child.emit('exit', null, 'SIGTERM');
    assert.equal(await done, 143);
  });
});

describe('boxRunArgs — opencode', () => {
  const base = {
    agent: 'opencode', args: ['-c'], env: {}, cwd: '/work/proj', codingRepo: '/work/coding', home: '/home/u',
    platform: 'linux', exists: () => false, guardDir: '/home/u/.coding/guard',
  };

  test('runs opencode under the exporter, with its own database and the host export dir mounted', () => {
    const argv = boxRunArgs({ ...base, opencodeExport: '/home/u/.coding/box/opencode' });
    const tail = argv.slice(argv.indexOf('-w') + 3);
    assert.deepEqual(tail, ['node', '--no-warnings', '/work/coding/scripts/box-opencode-sync.mjs',
      '--db', BOX_OPENCODE_DB, '--out', BOX_OPENCODE_EXPORT, '--', 'opencode', '-c']);
    assert.ok(argv.includes(`/home/u/.coding/box/opencode:${BOX_OPENCODE_EXPORT}`));
    assert.ok(argv.includes(`OPENCODE_DB=${BOX_OPENCODE_DB}`));
  });

  test('the box database is on the box home volume — the host\'s opencode store is never mounted', () => {
    assert.ok(BOX_OPENCODE_DB.startsWith('/home/agent/'));
    const argv = boxRunArgs({ ...base, opencodeExport: '/home/u/.coding/box/opencode' });
    assert.ok(!argv.some((a) => a.includes('/home/u/.local/share/opencode')), argv.join(' '));
  });

  test('the export dir must not expose the guard\'s keys', () => {
    assert.throws(() => boxRunArgs({ ...base, opencodeExport: '/home/u/.coding' }), /guard's keys/);
  });

  test('other agents are not wrapped', () => {
    const argv = boxRunArgs({ ...base, agent: 'pi', args: [], opencodeExport: '/home/u/.coding/box/opencode' });
    assert.ok(!argv.some((a) => a.includes('box-opencode-sync')));
    assert.ok(!argv.some((a) => a.startsWith('OPENCODE_DB=')));
  });
});

describe('lib/lsl/adapters/index.mjs — opencode search paths', () => {
  test('the host store, plus the box snapshot when one exists; LSL_OPENCODE_DB pins one', async () => {
    const home = tmpdir();
    const prev = { HOME: process.env.HOME, LSL: process.env.LSL_OPENCODE_DB, EXP: process.env.CODING_BOX_OPENCODE_EXPORT };
    process.env.HOME = home;
    delete process.env.LSL_OPENCODE_DB;
    delete process.env.CODING_BOX_OPENCODE_EXPORT;
    try {
      const { getAgentSearchPaths } = await import('../../lib/lsl/adapters/index.mjs');
      const host = path.join(home, '.local/share/opencode/opencode.db');
      const box = path.join(home, '.coding/box/opencode/opencode.db');
      assert.deepEqual(getAgentSearchPaths('opencode'), [{ type: 'sqlite', dbPath: host }]);
      walDb(box).close();
      assert.deepEqual(getAgentSearchPaths('opencode'), [{ type: 'sqlite', dbPath: host }, { type: 'sqlite', dbPath: box }]);
      process.env.LSL_OPENCODE_DB = '/fixture.db';
      assert.deepEqual(getAgentSearchPaths('opencode'), [{ type: 'sqlite', dbPath: '/fixture.db' }]);
    } finally {
      for (const [k, v] of [['HOME', prev.HOME], ['LSL_OPENCODE_DB', prev.LSL], ['CODING_BOX_OPENCODE_EXPORT', prev.EXP]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
