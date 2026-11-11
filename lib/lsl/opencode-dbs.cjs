'use strict';
/**
 * Where OpenCode session stores live, for every host-side reader.
 *
 * OpenCode keeps ALL its sessions in one SQLite database, in WAL mode (forced:
 * opencode runs `PRAGMA journal_mode = WAL` unconditionally). WAL needs a
 * shared-memory index (`-shm`, mmap'd) and POSIX locks that do not work across
 * the VM boundary between the macOS host and the Linux agent box, so the two
 * sides must never open the same live database.
 *
 * So there are two stores:
 *
 *   host  ~/.local/share/opencode/opencode.db — opencode run on the host.
 *   box   <export dir>/opencode.db — a SNAPSHOT of the box's own database
 *         (which lives on the box's Linux home volume, written by the boxed
 *         opencode only). scripts/box-opencode-sync.mjs runs beside opencode
 *         inside the box, copies the database with SQLite's backup API every
 *         few seconds and at exit, switches the copy out of WAL mode and
 *         renames it into place. The host therefore only ever reads a
 *         complete, single-file database that nothing on the host writes.
 *
 * Readers call opencodeDbs() and treat the result like any list of stores.
 * An explicit override (a test fixture, a --db flag) means exactly that store.
 *
 * CommonJS so both the CJS status line and the ESM LSL code can load it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The host's own opencode database. */
function hostOpencodeDb({ home = os.homedir() } = {}) {
  return path.join(home, '.local', 'share', 'opencode', 'opencode.db');
}

/** Host directory the box exports its snapshot into (mounted into the box). */
function boxOpencodeExportDir({ env = process.env, home = os.homedir() } = {}) {
  return path.resolve(env.CODING_BOX_OPENCODE_EXPORT || path.join(home, '.coding', 'box', 'opencode'));
}

/** The snapshot of the boxed opencode's database, as the host sees it. */
function boxOpencodeDb(opts = {}) {
  return path.join(boxOpencodeExportDir(opts), 'opencode.db');
}

/**
 * Every opencode store that exists, host first.
 *
 * @param {object} [opts]
 * @param {string} [opts.override]  explicit store (env override, --db): only it
 * @param {string} [opts.primary]   the host store, when a reader resolves it itself
 * @param {object} [opts.env]
 * @param {string} [opts.home]
 * @param {(p: string) => boolean} [opts.exists]
 * @returns {string[]}
 */
function opencodeDbs({ override, primary, env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  const ok = (p) => { try { return Boolean(p) && exists(p); } catch { return false; } };
  if (override) return ok(override) ? [override] : [];
  const all = [primary || hostOpencodeDb({ home }), boxOpencodeDb({ env, home })];
  return [...new Set(all)].filter(ok);
}

/** Last write to a store: in WAL mode the main file only moves on checkpoint. */
function storeMtimeMs(dbPath) {
  let t = 0;
  for (const p of [dbPath, `${dbPath}-wal`]) {
    try { t = Math.max(t, fs.statSync(p).mtimeMs); } catch { /* absent */ }
  }
  return t;
}

/** The most recently written store, or '' — for readers that take one store. */
function newestOpencodeDb(opts = {}) {
  let best = '';
  let bestT = -1;
  for (const p of opencodeDbs(opts)) {
    const t = storeMtimeMs(p);
    if (t > bestT) { best = p; bestT = t; }
  }
  return best;
}

module.exports = {
  hostOpencodeDb,
  boxOpencodeExportDir,
  boxOpencodeDb,
  opencodeDbs,
  storeMtimeMs,
  newestOpencodeDb,
};
