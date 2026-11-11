#!/usr/bin/env node
/**
 * Runs opencode inside the agent box and keeps a host-readable copy of its
 * session database.
 *
 *   node --no-warnings box-opencode-sync.mjs --db <box db> --out <export dir> [--every ms] -- opencode [args…]
 *
 * opencode's database is SQLite in WAL mode and lives on the box's Linux home
 * volume, where only the boxed opencode writes it. The host cannot read it in
 * place: a WAL database shared over VirtioFS between the Linux box and the
 * macOS host can be corrupted (the `-shm` index is mmap'd memory that does not
 * cross the VM boundary). So this wrapper, in the same kernel as opencode,
 * copies it with SQLite's online backup API — a consistent snapshot while
 * opencode keeps writing — switches the copy to a rollback journal (a single
 * file, no -shm), and renames it into <export dir>/opencode.db. The host's
 * session logging, token capture and context gauge read that snapshot
 * (lib/lsl/opencode-dbs.cjs).
 *
 * Copies run every --every ms when the database changed, and once more after
 * opencode exits. Nothing is written to the terminal (opencode owns it); errors
 * go to <export dir>/sync.log. The exit status is opencode's.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_EVERY_MS = 3000;

export function parseArgs(argv) {
  const out = { db: null, out: null, every: DEFAULT_EVERY_MS, command: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.command = argv.slice(i + 1); break; }
    if (a === '--db') out.db = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--every') out.every = Number(argv[++i]) || DEFAULT_EVERY_MS;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.db || !out.out || out.command.length === 0) {
    throw new Error('usage: box-opencode-sync.mjs --db <db> --out <dir> [--every ms] -- <command> [args…]');
  }
  return out;
}

/** What changes when opencode writes: the WAL file, and the main file on checkpoint. */
export function signature(db) {
  return [db, `${db}-wal`].map((p) => {
    try { const s = fs.statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; }
  }).join('|');
}

/**
 * One consistent copy of `db` at `<outDir>/opencode.db`, written atomically.
 * Returns true when a copy was written, false when there is no database yet.
 */
export async function snapshot(db, outDir, { sqlite } = {}) {
  if (!fs.existsSync(db)) return false;
  const { DatabaseSync, backup } = sqlite ?? await import('node:sqlite');
  fs.mkdirSync(outDir, { recursive: true });
  const final = path.join(outDir, 'opencode.db');
  const tmp = path.join(outDir, `.opencode.db.${process.pid}.tmp`);
  fs.rmSync(tmp, { force: true });
  try {
    // A normal connection in the same kernel as opencode: a reader like any other.
    const src = new DatabaseSync(db);
    try { await backup(src, tmp); } finally { src.close(); }
    // The copy inherits WAL mode from the page-1 header; the host must open a
    // plain single-file database, so switch it to a rollback journal here.
    const copy = new DatabaseSync(tmp);
    try { copy.exec('PRAGMA journal_mode = DELETE'); } finally { copy.close(); }
    fs.renameSync(tmp, final);
    return true;
  } finally {
    for (const p of [tmp, `${tmp}-wal`, `${tmp}-shm`, `${tmp}-journal`]) fs.rmSync(p, { force: true });
  }
}

function logTo(outDir) {
  return (msg) => {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.appendFileSync(path.join(outDir, 'sync.log'), `${new Date().toISOString()} ${msg}\n`);
    } catch { /* nowhere left to report it */ }
  };
}

/**
 * Keep `db` mirrored while `command` runs. Resolves to the command's exit code.
 * `spawnImpl` / `snapshotImpl` are seams for the tests.
 */
export async function run({ db, out, every, command }, { spawnImpl = spawn, snapshotImpl = snapshot, log = logTo(out) } = {}) {
  let last = null;
  let busy = null;
  const sync = (force = false) => {
    if (busy) return busy;
    const sig = signature(db);
    if (!force && sig === last) return Promise.resolve();
    busy = snapshotImpl(db, out)
      .then((wrote) => { if (wrote) last = sig; })
      .catch((err) => log(`snapshot failed: ${err.message}`))
      .finally(() => { busy = null; });
    return busy;
  };

  const child = spawnImpl(command[0], command.slice(1), { stdio: 'inherit' });
  // The terminal belongs to opencode: Ctrl+C reaches it as a key in raw mode, and
  // a SIGINT to the process group reaches it directly — never kill the wrapper
  // first. TERM/HUP (docker stop, a closed terminal) are passed on.
  const onInt = () => {};
  const forward = (sig) => () => { try { child.kill(sig); } catch { /* gone */ } };
  const onTerm = forward('SIGTERM');
  const onHup = forward('SIGHUP');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  process.on('SIGHUP', onHup);

  const timer = setInterval(() => { sync(); }, every);
  timer.unref?.();
  sync();

  const code = await new Promise((resolve) => {
    child.on('error', (err) => { log(`cannot start ${command[0]}: ${err.message}`); resolve(127); });
    child.on('exit', (c, signal) => resolve(c ?? (signal ? 128 + (signalNumber(signal) || 1) : 1)));
  });
  clearInterval(timer);
  if (busy) await busy;
  await sync(true);
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
  process.off('SIGHUP', onHup);
  return code;
}

function signalNumber(name) {
  return { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }[name];
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`box-opencode-sync: ${err.message}\n`);
    process.exit(64);
  }
  process.exit(await run(opts));
}
