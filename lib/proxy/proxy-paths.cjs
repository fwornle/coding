'use strict';
/**
 * Where coding finds its sibling rapid-llm-proxy checkout, in one place.
 *
 *   proxyDir()      RAPID_LLM_PROXY_DIR, else the _work/rapid-llm-proxy sibling of the
 *                   checkout this file lives in — proxy CODE follows coding's code, not
 *                   CODING_REPO (tests point CODING_REPO at a sandbox data root). From a
 *                   linked git worktree that is the sibling of its main checkout.
 *   proxyDistDir()  LLM_PROXY_DIST_DIR, else the sibling of CODING_REPO + /dist (the tsc
 *                   build; the default the measurement scripts always used)
 *   openDb(file, opts)  the proxy's SQLite opener (proxy-bridge/db-open.cjs:
 *                   better-sqlite3 or node:sqlite, see CODING_SQLITE_BACKEND),
 *                   resolving better-sqlite3 from coding's own node_modules.
 *
 * Every function reads the environment on each call — tests repoint
 * LLM_PROXY_DIST_DIR at stubs at runtime.
 *
 * Without the proxy checkout (coding's hosted CI) openDb falls back to coding's
 * better-sqlite3 directly — the same behaviour as db-open's better backend.
 *
 * CommonJS so the statusline gauge can require() it synchronously; ESM callers
 * import the named exports.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * The main checkout of `dir`: a linked worktree's .git is a file naming
 * <main>/.git/worktrees/<name>, whose commondir leads back to <main>/.git.
 * Read from disk, not `git`, so the statusline's require() stays cheap.
 */
function mainCheckout(dir) {
  try {
    const gitdir = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, '.git'), 'utf8'))?.[1].trim();
    if (!gitdir) return dir;
    const abs = path.resolve(dir, gitdir);
    const common = path.resolve(abs, fs.readFileSync(path.join(abs, 'commondir'), 'utf8').trim());
    return path.dirname(common);
  } catch {
    return dir; // a plain checkout (.git is a directory) or no git at all
  }
}

const CODING_CHECKOUT = path.resolve(__dirname, '..', '..');
let codingMain = null; // mainCheckout(CODING_CHECKOUT), read once

function codingRepo() {
  return process.env.CODING_REPO || CODING_CHECKOUT;
}

function proxyDir() {
  return process.env.RAPID_LLM_PROXY_DIR || path.resolve((codingMain ??= mainCheckout(CODING_CHECKOUT)), '..', '_work', 'rapid-llm-proxy');
}

function proxyDistDir() {
  return process.env.LLM_PROXY_DIST_DIR
    || path.resolve(codingRepo(), '..', '_work', 'rapid-llm-proxy', 'dist');
}

function betterSqliteOpen(file, { readonly = false, fileMustExist = false, timeout } = {}) {
  if (process.env.CODING_SQLITE_BACKEND === 'node') {
    const e = new Error(`CODING_SQLITE_BACKEND=node needs ${path.join(proxyDir(), 'proxy-bridge', 'db-open.cjs')}`);
    e.code = 'ERR_SQLITE_BACKEND';
    throw e;
  }
  const Database = require('better-sqlite3');
  const o = { readonly, fileMustExist };
  if (timeout !== undefined) o.timeout = timeout;
  return new Database(file, o);
}

const dbOpenByPath = new Map();

function openDb(file, opts = {}) {
  const modPath = path.join(proxyDir(), 'proxy-bridge', 'db-open.cjs');
  if (!dbOpenByPath.has(modPath)) {
    let mod = null;
    try { mod = require(modPath); } catch { mod = null; }
    dbOpenByPath.set(modPath, mod);
  }
  const mod = dbOpenByPath.get(modPath);
  if (!mod) return betterSqliteOpen(file, opts);
  return mod.openDb(file, { requireFrom: __filename, ...opts });
}

module.exports = { codingRepo, proxyDir, proxyDistDir, openDb, mainCheckout };
