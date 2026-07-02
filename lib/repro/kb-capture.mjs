// lib/repro/kb-capture.mjs
//
// Phase 67, Plan 67-04 (Wave 2) — REPRO-01 internal-state capture, KB channel (D-02).
// Captures the live km-core knowledge graph as (a) a BYTE-EXACT filesystem copy of the
// LevelDB dir and (b) the atomically-written JSON export — by filesystem copy ONLY,
// never by opening a second GraphKMStore on the live single-owner DB (RESEARCH Pitfall 5;
// obs-api holds the sole writer handle). The JSON export is the canonical restore source
// (the km-core hydrate() patch prefers it over the LevelDB cache — CLAUDE.md "km-core
// node_modules patch").
//
// captureKb is PURE stdlib (node:fs only) — it deliberately has NO static km-core import
// so it can never open a store. hydrateSandbox (restore side) is the ONLY function that
// touches km-core, and it imports GraphKMStore LAZILY so this module loads with km-core
// absent (tests + capture-only callers never pay for it).
//
// Analog: lib/experiments/store.mjs (km-core store paths + mandatory ontologyDir) + the
// CLAUDE.md km-core hydrate patch note. Diagnostics via process.stderr.write only
// (no console.* — no-console-log, CLAUDE.md); capture is fail-soft (never throws).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';

/**
 * Human-readable honesty caveat attached to every capture result (RESEARCH Pitfall 1,
 * threat T-67-04-04): a filesystem copy of a live LevelDB is consistent only as of the
 * instant the copy opened; mid-copy writes may not be reflected. The JSON export — an
 * atomically-written whole-graph snapshot — is the canonical, compaction-independent
 * restore source. Do NOT over-promise byte-exact LevelDB semantics.
 */
const KB_CAVEAT =
  'KB captured by filesystem copy: the leveldb/ artifact is byte-exact only for the ' +
  'point-in-time it was read (consistent-at-span-open; the live DB is single-owner and ' +
  'may have been mid-write). The atomic exports/general.json is the canonical restore ' +
  'source (km-core hydrate() prefers the JSON export over the LevelDB cache).';

/**
 * Capture the live KB as a byte-exact filesystem artifact + the atomic JSON export.
 *
 * Copies `<dataDir>/knowledge-graph/leveldb/` → `<destDir>/kb/leveldb/` and
 * `<dataDir>/knowledge-graph/exports/general.json` → `<destDir>/kb/exports/general.json`.
 * NEVER opens a GraphKMStore on the live dir (Pitfall 5). Best-effort per artifact — a
 * missing/broken artifact degrades to a `false` flag rather than throwing, so a partial
 * KB still yields a usable partial snapshot.
 *
 * @param {string} dataDir absolute path to the live LLM_PROXY_DATA_DIR (holds knowledge-graph/)
 * @param {string} destDir absolute path to the snapshot dir (kb/ is created under it)
 * @returns {{ levelDbCaptured: boolean, exportCaptured: boolean, caveat: string }}
 */
export function captureKb(dataDir, destDir) {
  let levelDbCaptured = false;
  let exportCaptured = false;

  // 1) Byte-exact leveldb/ copy (target the LIVE `leveldb/` subdir — NOT the stale
  //    `level.db` / `leveldb.before-*` backups; RESEARCH State-of-the-Art).
  try {
    const srcLevel = path.join(dataDir, 'knowledge-graph', 'leveldb');
    if (fs.existsSync(srcLevel) && fs.statSync(srcLevel).isDirectory()) {
      const dstLevel = path.join(destDir, 'kb', 'leveldb');
      fs.mkdirSync(path.dirname(dstLevel), { recursive: true });
      // recursive byte-exact copy; no store handle is ever opened.
      fs.cpSync(srcLevel, dstLevel, { recursive: true });
      levelDbCaptured = true;
    }
  } catch (err) {
    process.stderr.write(`[kb-capture] leveldb copy skipped: ${err?.message || err}\n`);
  }

  // 2) Atomic JSON export copy (canonical restore source).
  try {
    const srcExport = path.join(dataDir, 'knowledge-graph', 'exports', 'general.json');
    if (fs.existsSync(srcExport) && fs.statSync(srcExport).isFile()) {
      const dstExport = path.join(destDir, 'kb', 'exports', 'general.json');
      fs.mkdirSync(path.dirname(dstExport), { recursive: true });
      fs.copyFileSync(srcExport, dstExport);
      exportCaptured = true;
    }
  } catch (err) {
    process.stderr.write(`[kb-capture] export copy skipped: ${err?.message || err}\n`);
  }

  return { levelDbCaptured, exportCaptured, caveat: KB_CAVEAT };
}

/**
 * Hydrate a FRESH sandbox km-core store from a captured JSON export (restore side).
 *
 * Opens a GraphKMStore whose dbPath/exportDir live UNDER `sandboxDataDir` (never the live
 * `.data/knowledge-graph/`), so the single-owner invariant is never violated. The store is
 * constructed with a mandatory `ontologyDir` (CLAUDE.md km-core rule — else `resolveEntities`
 * throws `opts.classes omitted but store has no ontology registry`). The captured export is
 * placed into the sandbox exportDir so km-core's patched `hydrate()` restores from it on
 * `open()` (it prefers the JSON export over the LevelDB cache). The caller-agnostic contract:
 * this function OWNS the store lifecycle and always `await store.close()` in a finally
 * (LevelDB is single-owner — the handle must be released before any other reader).
 *
 * GraphKMStore is imported LAZILY so kb-capture.mjs loads even when km-core is absent
 * (capture-only callers and the capture test never trigger this import).
 *
 * @param {string} exportPath absolute path to the captured exports/general.json
 * @param {string} sandboxDataDir absolute path to the sandbox LLM_PROXY_DATA_DIR
 * @param {object} [opts]
 * @param {string} [opts.ontologyDir] ontology dir (defaults to `<REPO>/.data/ontologies`)
 * @returns {Promise<{ hydrated: boolean, dbPath: string, exportDir: string }>}
 */
export async function hydrateSandbox(exportPath, sandboxDataDir, opts = {}) {
  const dbPath = path.join(sandboxDataDir, 'knowledge-graph', 'leveldb');
  const exportDir = path.join(sandboxDataDir, 'knowledge-graph', 'exports');
  const ontologyDir = opts.ontologyDir || path.join(REPO, '.data', 'ontologies');

  // Stage the captured export into the sandbox exportDir so hydrate() picks it up on open.
  fs.mkdirSync(exportDir, { recursive: true });
  fs.mkdirSync(dbPath, { recursive: true });
  fs.copyFileSync(exportPath, path.join(exportDir, 'general.json'));

  // Lazy import: only the restore path depends on km-core.
  const { GraphKMStore } = await import('@fwornle/km-core');
  const store = new GraphKMStore({
    dbPath,
    exportDir,
    ontologyDir, // MANDATORY (CLAUDE.md) — else resolveEntities throws on default-class resolution.
    ontologyStrict: false,
    debounceMs: 0,
  });

  let hydrated = false;
  try {
    await store.open(); // patched hydrate() restores from the JSON export in exportDir.
    hydrated = true;
    return { hydrated, dbPath, exportDir };
  } finally {
    // Single-owner: always release the handle, even on a hydrate failure.
    try {
      await store.close();
    } catch (err) {
      process.stderr.write(`[kb-capture] sandbox store close failed: ${err?.message || err}\n`);
    }
  }
}
