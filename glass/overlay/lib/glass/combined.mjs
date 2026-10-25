// lib/glass/combined.mjs — glass's figures together with coding's, on a machine
// where both are installed.
//
// coding's proxy records this machine's other LLM traffic (its background jobs,
// agents started without glass) in a token DB of its own, so glass's figures
// alone read low next to the account's bill. The usage views can read both: a
// second, read-only connection on glass's DB attaches coding's (read-only too —
// SQLite refuses any write through it) and shadows `token_usage` with a TEMP
// VIEW over the two. The proxy's queries name the table unqualified, so they
// read the union unchanged.
//
// A call glass forwards through coding's proxy is recorded by both, and coding
// files it under glass's session id (coexist.mjs). The view keeps glass's row
// and drops coding's copy of any task id glass has; coding-only rows — its own
// work, and glass sessions from before this glass home existed — are kept. An
// empty task id (an unbound call) is nobody's session, so it never matches.
//
// coding also rebuilds sessions from the agents' own files (its opencode and
// Copilot CLI adapters, process token-adapter-*), and those copies carry coding's
// ids, not glass's: an opencode session glass measured on the wire came back as
// a second, unbound set of rows (2026-10-10: 113 calls twice, the Copilot tile
// €11 above GitHub's own figure). Such a row is dropped when a glass session of
// the same agent ran in the same project at that time (its first to last call,
// ±2 min — an adapter stamps the message, the wire the response). Rows coding
// saw on a wire, and adapter rows of another project — a second session at the
// same time, outside glass — are kept.
//
// cost.json `includeCoding: false` switches it off (it is on when absent).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { openDb } = createRequire(import.meta.url)('../../proxy/proxy-bridge/db-open.cjs');

const DB_REL = path.join('var', 'llm-proxy', 'token-usage.db');

/**
 * coding's token DB on this machine, or null. GLASS_CODING_TOKEN_DB names it
 * outright; else the most recently written of ~/.coding/data/<scope>/ (one per
 * coding scope). Not CODING_DATA_HOME: the daemon sets that to its own data dir
 * for the coding libraries it ships (home.mjs daemonEnv).
 */
export function codingTokenDb(env = process.env, home = os.homedir()) {
  const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  if (env.GLASS_CODING_TOKEN_DB) return exists(env.GLASS_CODING_TOKEN_DB) ? path.resolve(env.GLASS_CODING_TOKEN_DB) : null;
  const root = path.join(home, '.coding', 'data');
  let scopes = [];
  try { scopes = fs.readdirSync(root); } catch { return null; }
  // The WAL is where a live proxy writes; the DB file's mtime moves only at a checkpoint.
  const written = (f) => Math.max(...[f, `${f}-wal`].map((x) => { try { return fs.statSync(x).mtimeMs; } catch { return 0; } }));
  const found = scopes.map((s) => path.join(root, s, DB_REL)).filter(exists);
  return found.sort((a, b) => written(b) - written(a))[0] ?? null;
}

const quoteSql = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * A read-only handle ({ db }) whose `token_usage` is glass's rows plus coding's,
 * without coding's copies of glass sessions. Throws when either file cannot be opened.
 */
export function openCombined(glassDbPath, codingDbPath) {
  const db = openDb(glassDbPath, { readonly: true, fileMustExist: true });
  try {
    db.exec(`ATTACH DATABASE ${quoteSql(codingDbPath)} AS coding`);
    const cols = (schema) => db.prepare(`PRAGMA ${schema}.table_info(token_usage)`).all().map((r) => r.name);
    const theirs = new Set(cols('coding'));
    // The two schemas migrate on their own; read only the columns both have.
    const shared = cols('main').filter((c) => theirs.has(c)).map((c) => `"${c}"`).join(', ');
    if (!shared) throw new Error('coding token DB has no token_usage table');
    const both = (c) => theirs.has(c) && cols('main').includes(c);
    const rebuiltCopy = ['agent', 'project', 'process', 'timestamp'].every(both)
      ? `AND NOT (c.process LIKE 'token-adapter-%' AND EXISTS (
           SELECT 1 FROM temp.glass_spans s
           WHERE s.agent = c.agent AND s.project = c.project AND c.timestamp BETWEEN s.t0 AND s.t1))`
      : '';
    if (rebuiltCopy) {
      db.exec(`
        CREATE TEMP VIEW glass_spans AS
          SELECT agent, project,
                 strftime('%Y-%m-%dT%H:%M:%fZ', MIN(timestamp), '-120 seconds') AS t0,
                 strftime('%Y-%m-%dT%H:%M:%fZ', MAX(timestamp), '+120 seconds') AS t1
          FROM main.token_usage
          WHERE task_id LIKE 'glass-%' AND COALESCE(agent, '') <> '' AND COALESCE(project, '') <> ''
          GROUP BY task_id, agent, project
      `);
    }
    const cshared = shared.split(', ').map((c) => `c.${c}`).join(', ');
    db.exec(`
      CREATE TEMP VIEW token_usage AS
        SELECT ${shared} FROM main.token_usage
        UNION ALL
        SELECT ${cshared} FROM coding.token_usage AS c
        WHERE (COALESCE(c.task_id, '') = ''
           OR c.task_id NOT IN (SELECT task_id FROM main.token_usage WHERE COALESCE(task_id, '') <> ''))
          ${rebuiltCopy}
    `);
  } catch (err) {
    try { db.close(); } catch { /* closing a failed open */ }
    throw err;
  }
  return { db };
}

/**
 * The handle the usage views read: the combined one while it is wanted and
 * coding's DB is there, else glass's own. Re-checked at most every `recheckMs`,
 * so coding installed (or removed) later is picked up without a restart.
 *
 * @param {object} o
 * @param {() => object|null} o.own        glass's live handle
 * @param {string} o.glassDbPath
 * @param {() => boolean} o.wanted         the includeCoding setting
 * @param {() => string|null} [o.locate]   coding's DB path (codingTokenDb)
 * @returns {{ handle: () => object|null, state: () => { found: boolean, included: boolean, path: string|null }, close: () => void }}
 */
export function createUsageSource({ own, glassDbPath, wanted, locate = () => codingTokenDb(), recheckMs = 60_000, log = () => {} }) {
  let current = null; // { path, handle }
  let checkedAt = 0;
  let found = null;
  let lastError = '';

  const drop = () => {
    if (current) { try { current.handle.db.close(); } catch { /* already closed */ } }
    current = null;
  };

  function refresh() {
    if (Date.now() - checkedAt < recheckMs) return;
    checkedAt = Date.now();
    found = locate();
    if (found && path.resolve(found) === path.resolve(glassDbPath)) found = null; // never glass's own, twice
    if (current && current.path !== found) drop();
  }

  return {
    handle() {
      if (!wanted()) { drop(); return own(); }
      refresh();
      if (!found) return own();
      if (!current) {
        try {
          current = { path: found, handle: openCombined(glassDbPath, found) };
          lastError = '';
          log(`usage views include coding's token DB (${found})`);
        } catch (err) {
          // Glass's own figures rather than none; said once, not every read.
          if (err.message !== lastError) log(`coding token DB not readable, glass figures only: ${err.message}`);
          lastError = err.message;
          return own();
        }
      }
      return current.handle;
    },
    state() {
      refresh();
      return { found: Boolean(found), included: Boolean(found) && wanted(), path: found };
    },
    /** Forget the last look, so a changed setting or a new install shows at once. */
    recheck() { checkedAt = 0; },
    close: drop,
  };
}
