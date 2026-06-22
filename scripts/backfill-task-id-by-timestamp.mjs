#!/usr/bin/env node
/**
 * Completed-session backfill sweep (TELEM-03, Plan 68-03 Task 2).
 *
 * Sets `task_id` on already-written token_usage rows by timestamp-joining them
 * against ARCHIVED measurement spans. Each archived span file
 * (`.data/measurements/<task_id>.json`, written by Plan 68-02's stopMeasurement)
 * carries { task_id, started_at, ended_at } as ISO-8601 UTC strings. A
 * token_usage row whose `timestamp` falls within [started_at, ended_at] belongs
 * to that span, so we UPDATE its task_id — but ONLY rows still carrying the
 * empty-string default, so a live-stamped value (Plan 68-03 Task 1 write path)
 * is NEVER overwritten.
 *
 * token_usage.timestamp is ISO-8601 UTC TEXT and the archived span timestamps
 * are likewise ISO-8601 UTC (`new Date().toISOString()`), so lexical string
 * comparison is chronologically correct — no date parsing needed in SQL.
 *
 * Properties:
 *   - Rows with a non-empty task_id are never touched (WHERE task_id = '').
 *   - A row matching no span stays '' (unattributed).
 *   - Idempotent: a second run changes nothing.
 *   - --dry-run reports the would-be updates (SELECT COUNT) without mutating.
 *   - One unreadable/corrupt/invalid span never aborts the whole sweep.
 *
 * Usage:
 *   node scripts/backfill-task-id-by-timestamp.mjs                 # apply
 *   node scripts/backfill-task-id-by-timestamp.mjs --dry-run       # report only
 *   node scripts/backfill-task-id-by-timestamp.mjs --measurements-dir <dir>
 *   node scripts/backfill-task-id-by-timestamp.mjs --db <path>
 *   node scripts/backfill-task-id-by-timestamp.mjs --self-test     # node:test fixture
 *
 * Env:
 *   LLM_PROXY_DATA_DIR  default /Users/Q284340/Agentic/coding/.data — derives
 *                       both the token DB (<dir>/llm-proxy/token-usage.db) and
 *                       the archive dir (<dir>/measurements).
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const out = (s) => process.stdout.write(s + '\n');
const warn = (s) => process.stderr.write(s + '\n');

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

/** Resolve the default data dir (mirrors the proxy's resolveTokenDbPath order). */
function resolveDataDir() {
  return process.env.LLM_PROXY_DATA_DIR
    || '/Users/Q284340/Agentic/coding/.data';
}

function resolveDbPath(override) {
  return override || path.join(resolveDataDir(), 'llm-proxy', 'token-usage.db');
}

function resolveMeasurementsDir(override) {
  return override || path.join(resolveDataDir(), 'measurements');
}

/**
 * Read + validate the archived span files under measurementsDir.
 * Skips unreadable/corrupt/shape-invalid files with a stderr warning (never
 * throws). Returns the valid spans (task_id + started_at + ended_at present).
 */
export function loadArchivedSpans(measurementsDir) {
  let names;
  try {
    names = fs.readdirSync(measurementsDir);
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e && e.code === 'ENOENT') {
      warn(`[backfill] measurements dir does not exist (nothing to sweep): ${measurementsDir}`);
      return [];
    }
    warn(`[backfill] cannot read measurements dir ${measurementsDir}: ${e?.message ?? String(err)}`);
    return [];
  }

  const spans = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(measurementsDir, name);
    let span;
    try {
      span = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      warn(`[backfill] skipping unreadable/corrupt span ${name}: ${err?.message ?? String(err)}`);
      continue;
    }
    if (
      !span || typeof span !== 'object'
      || typeof span.task_id !== 'string' || !span.task_id
      || typeof span.started_at !== 'string' || !span.started_at
      || typeof span.ended_at !== 'string' || !span.ended_at
    ) {
      warn(`[backfill] skipping span ${name} with invalid shape (need task_id+started_at+ended_at)`);
      continue;
    }
    spans.push(span);
  }
  return spans;
}

/**
 * Run the sweep against an OPEN better-sqlite3 db handle.
 *
 * WR-03 (Phase 69 review fix): an optional `userHashFilter` scopes the
 * UPDATE/COUNT to one adapter namespace so `stats.backfilled` does not
 * cross-contaminate when both the Claude and Copilot sweep emitters call
 * runSweep in the same pass. The filter is OPT-IN and defaults to null — with
 * no filter the behavior is IDENTICAL to the prior signature (the D-03
 * timestamp-join contract is unchanged). When supplied, the `user_hash = ?`
 * predicate is added (parameterized — never interpolated).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<{task_id:string,started_at:string,ended_at:string}>} spans
 * @param {boolean} dryRun
 * @param {string|null} [userHashFilter] restrict the sweep to one adapter user_hash
 * @returns {{ total:number, perSpan: Array<{task_id:string,changes:number}> }}
 */
export function runSweep(db, spans, dryRun, userHashFilter = null) {
  // Lexical comparison on ISO-8601 UTC text is chronologically correct.
  const hasFilter = typeof userHashFilter === 'string' && userHashFilter.length > 0;
  const updateStmt = hasFilter
    ? db.prepare(
        "UPDATE token_usage SET task_id = ? WHERE task_id = '' AND user_hash = ? AND timestamp >= ? AND timestamp <= ?",
      )
    : db.prepare(
        "UPDATE token_usage SET task_id = ? WHERE task_id = '' AND timestamp >= ? AND timestamp <= ?",
      );
  const countStmt = hasFilter
    ? db.prepare(
        "SELECT COUNT(*) AS n FROM token_usage WHERE task_id = '' AND user_hash = ? AND timestamp >= ? AND timestamp <= ?",
      )
    : db.prepare(
        "SELECT COUNT(*) AS n FROM token_usage WHERE task_id = '' AND timestamp >= ? AND timestamp <= ?",
      );

  let total = 0;
  const perSpan = [];
  for (const span of spans) {
    let changes = 0;
    try {
      if (dryRun) {
        changes = hasFilter
          ? countStmt.get(userHashFilter, span.started_at, span.ended_at).n
          : countStmt.get(span.started_at, span.ended_at).n;
      } else {
        const info = hasFilter
          ? updateStmt.run(span.task_id, userHashFilter, span.started_at, span.ended_at)
          : updateStmt.run(span.task_id, span.started_at, span.ended_at);
        changes = info.changes;
      }
    } catch (err) {
      // One bad span must never abort the whole sweep.
      warn(`[backfill] span task_id=${span.task_id} sweep error (skipped): ${err?.message ?? String(err)}`);
      continue;
    }
    total += changes;
    perSpan.push({ task_id: span.task_id, changes });
  }
  return { total, perSpan };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dbPath = resolveDbPath(parseStrArg(args, '--db'));
  const measurementsDir = resolveMeasurementsDir(parseStrArg(args, '--measurements-dir'));

  out(`[backfill] mode=${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  out(`[backfill] db=${dbPath}`);
  out(`[backfill] measurements=${measurementsDir}`);

  const spans = loadArchivedSpans(measurementsDir);
  out(`[backfill] archived spans with valid window: ${spans.length}`);
  if (spans.length === 0) {
    out('[backfill] nothing to do.');
    return;
  }

  let db;
  try {
    // Read-only handle for dry-run; read-write for apply.
    db = new Database(dbPath, { readonly: dryRun, fileMustExist: true });
  } catch (err) {
    warn(`[backfill] cannot open token DB ${dbPath}: ${err?.message ?? String(err)}`);
    process.exitCode = 1;
    return;
  }

  try {
    const { total, perSpan } = runSweep(db, spans, dryRun);
    for (const s of perSpan) {
      out(`[backfill]   task_id=${s.task_id} ${dryRun ? 'would-update' : 'updated'}=${s.changes}`);
    }
    out(`[backfill] ${dryRun ? 'would-update' : 'updated'} total rows: ${total}`);
  } finally {
    db.close();
  }
}

/**
 * Self-test: a constructed-fixture node:test run proving the sweep contract
 * against a temp DB + synthetic archived span. Invoked with --self-test so the
 * proof lives next to the code without a separate spec file in the proxy repo.
 */
async function selfTest() {
  const { test } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;
  const os = await import('node:os');

  test('sweep: attributes an unattributed in-window row, idempotent, never clobbers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-selftest-'));
    const dbPath = path.join(dir, 'token-usage.db');
    try {
      const db = new Database(dbPath);
      db.exec(`CREATE TABLE token_usage (
        id INTEGER PRIMARY KEY,
        timestamp TEXT NOT NULL,
        task_id TEXT NOT NULL DEFAULT ''
      );`);
      // Row 1: in-window, unattributed → should be set.
      db.prepare('INSERT INTO token_usage (timestamp, task_id) VALUES (?, ?)')
        .run('2026-06-22T10:00:00.000Z', '');
      // Row 2: out-of-window, unattributed → stays ''.
      db.prepare('INSERT INTO token_usage (timestamp, task_id) VALUES (?, ?)')
        .run('2026-06-22T23:00:00.000Z', '');
      // Row 3: in-window but PRE-SET → must never be overwritten.
      db.prepare('INSERT INTO token_usage (timestamp, task_id) VALUES (?, ?)')
        .run('2026-06-22T10:30:00.000Z', 'live-stamped');

      const span = {
        task_id: 'archived-span-x',
        started_at: '2026-06-22T09:00:00.000Z',
        ended_at: '2026-06-22T11:00:00.000Z',
      };

      // First sweep (apply).
      const r1 = runSweep(db, [span], false);
      assert.equal(r1.total, 1, 'exactly the one in-window unattributed row is updated');

      const rows = db.prepare('SELECT id, task_id FROM token_usage ORDER BY id').all();
      assert.equal(rows[0].task_id, 'archived-span-x', 'in-window row attributed');
      assert.equal(rows[1].task_id, '', 'out-of-window row left unattributed');
      assert.equal(rows[2].task_id, 'live-stamped', 'pre-set row never overwritten');

      // Second sweep is idempotent — no further changes.
      const r2 = runSweep(db, [span], false);
      assert.equal(r2.total, 0, 'second run is a no-op (idempotent)');

      // Dry-run reports 0 now (nothing left to attribute) and mutates nothing.
      const before = db.prepare('SELECT task_id FROM token_usage ORDER BY id').all();
      const rDry = runSweep(db, [span], true);
      assert.equal(rDry.total, 0, 'dry-run count after attribution is 0');
      const after = db.prepare('SELECT task_id FROM token_usage ORDER BY id').all();
      assert.deepEqual(after, before, 'dry-run mutated nothing');

      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Entry-point guard — only run the CLI when invoked directly, NOT when this
// module is imported for its exported runSweep / loadArchivedSpans (Plan 69-05
// reuses the locked timestamp-join from the sweep, D-03). Without this guard an
// `import` of this module would execute main() (open the DB + sweep) as a side
// effect.
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    main();
  }
}
