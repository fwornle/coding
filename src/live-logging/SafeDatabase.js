/**
 * SafeDatabase — Crash-safe SQLite wrapper for the observations DB.
 *
 * Every consumer of observations.db MUST use this module instead of opening
 * better-sqlite3 directly.  It enforces:
 *
 *   1. WAL journal mode (even for readonly connections)
 *   2. busy_timeout to survive lock contention from concurrent writers
 *   3. Integrity check on first open — auto-recovers from SHM/WAL corruption
 *   4. Clean shutdown handlers so the WAL is checkpointed on exit
 *
 * Usage:
 *   import { openDatabase } from '../src/live-logging/SafeDatabase.js';
 *   const db = openDatabase('/path/to/observations.db');           // read-write
 *   const db = openDatabase('/path/to/observations.db', { readonly: true });
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);

/** @type {Set<import('better-sqlite3').Database>} */
const _openConnections = new Set();
let _shutdownRegistered = false;

/**
 * Register process-level shutdown handlers exactly once.
 * Checkpoints WAL and closes all open connections on exit.
 */
function _ensureShutdownHandlers() {
  if (_shutdownRegistered) return;
  _shutdownRegistered = true;

  const cleanup = () => {
    for (const db of _openConnections) {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
      try { db.close(); } catch { /* best effort */ }
    }
    _openConnections.clear();
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('beforeExit', cleanup);
  // 'exit' handler must be synchronous — close() is synchronous in better-sqlite3
  process.on('exit', cleanup);
}

/**
 * Attempt to recover a corrupted database.
 *
 * Strategy (in order of preference):
 *   1. Delete SHM + reopen — fixes stale shared-memory from crashed processes
 *   2. Delete SHM + WAL + reopen — loses uncommitted WAL data but recovers DB
 *   3. sqlite3 CLI dump + reimport — last resort, salvages whatever is readable
 *
 * @param {string} dbPath
 * @returns {boolean} true if recovery succeeded
 */
function _attemptRecovery(dbPath) {
  const shmPath = dbPath + '-shm';
  const walPath = dbPath + '-wal';
  const Database = require('better-sqlite3');

  // Strategy 1: delete SHM only (process crash left stale shared memory)
  if (fs.existsSync(shmPath)) {
    try {
      fs.unlinkSync(shmPath);
      const probe = new Database(dbPath, { readonly: true });
      const result = probe.pragma('integrity_check');
      probe.close();
      if (result?.[0]?.integrity_check === 'ok') {
        process.stderr.write('[SafeDatabase] Recovered by deleting stale SHM file\n');
        return true;
      }
    } catch { /* try next strategy */ }
  }

  // Strategy 2: delete both SHM + WAL (loses uncommitted transactions)
  for (const f of [shmPath, walPath]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ }
  }
  try {
    const probe = new Database(dbPath, { readonly: true });
    const result = probe.pragma('integrity_check');
    probe.close();
    if (result?.[0]?.integrity_check === 'ok') {
      process.stderr.write('[SafeDatabase] Recovered by deleting stale SHM+WAL files\n');
      return true;
    }
  } catch { /* try next strategy */ }

  // Strategy 3: dump + reimport via sqlite3 CLI
  const backupPath = dbPath + '.corrupted-' + Date.now();
  const recoveredPath = dbPath + '.recovered';
  try {
    // Use CLI sqlite3 for dump — it handles some corruption better than the library
    execSync(`sqlite3 "${dbPath}" ".dump" | sqlite3 "${recoveredPath}"`, {
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (fs.existsSync(recoveredPath) && fs.statSync(recoveredPath).size > 0) {
      const check = new Database(recoveredPath, { readonly: true });
      const ok = check.pragma('integrity_check');
      check.close();
      if (ok?.[0]?.integrity_check === 'ok') {
        fs.renameSync(dbPath, backupPath);
        for (const f of [shmPath, walPath]) {
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ok */ }
        }
        fs.renameSync(recoveredPath, dbPath);
        process.stderr.write(`[SafeDatabase] Recovered via CLI dump. Backup: ${path.basename(backupPath)}\n`);
        return true;
      }
    }
  } catch (err) {
    process.stderr.write(`[SafeDatabase] CLI dump recovery failed: ${err.message}\n`);
  }

  // Clean up failed recovery attempt
  try { if (fs.existsSync(recoveredPath)) fs.unlinkSync(recoveredPath); } catch { /* ok */ }

  return false;
}

/**
 * Best-effort: restore observations.db tables from the JSON exports
 * after a fresh-start has been forced by failed recovery. This is the
 * last line of defense against full data loss.
 *
 * Looks for ../.data/observation-export/{observations,digests,insights}.json
 * relative to the DB path. If exports aren't present (e.g. tests, fresh
 * checkout), the DB stays empty and writers populate it normally.
 *
 * @param {string} dbPath
 */
function _restoreFromExportIfPossible(dbPath) {
  try {
    const obsDir = path.dirname(dbPath);                 // .../.observations
    const repoRoot = path.dirname(obsDir);               // repo root
    const exportDir = path.join(repoRoot, '.data', 'observation-export');
    const obsExport = path.join(exportDir, 'observations.json');
    const digExport = path.join(exportDir, 'digests.json');
    const insExport = path.join(exportDir, 'insights.json');

    if (!fs.existsSync(obsExport)) {
      process.stderr.write('[SafeDatabase] No observation-export to restore from — DB starts empty.\n');
      return;
    }

    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY, summary TEXT, messages TEXT, agent TEXT,
        session_id TEXT, source_file TEXT, created_at TEXT, metadata TEXT,
        content_hash TEXT, quality TEXT DEFAULT 'normal', digested_at TEXT
      );
      CREATE TABLE IF NOT EXISTS digests (
        id TEXT PRIMARY KEY, date TEXT NOT NULL, theme TEXT NOT NULL,
        summary TEXT NOT NULL, observation_ids TEXT NOT NULL, agents TEXT,
        files_touched TEXT, quality TEXT DEFAULT 'normal',
        created_at TEXT NOT NULL, metadata TEXT, project TEXT
      );
      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY, topic TEXT NOT NULL, summary TEXT NOT NULL,
        confidence REAL DEFAULT 0.8, digest_ids TEXT NOT NULL,
        last_updated TEXT NOT NULL, created_at TEXT NOT NULL, metadata TEXT,
        project TEXT
      );
    `);

    const observations = JSON.parse(fs.readFileSync(obsExport, 'utf8'));
    const obsStmt = db.prepare(`
      INSERT OR REPLACE INTO observations
        (id, summary, agent, session_id, source_file, content_hash,
         created_at, digested_at, quality, metadata)
      VALUES (@id, @summary, @agent, @sessionId, @sourceFile, @contentHash,
              @createdAt, @digestedAt, @quality, @metadata)
    `);
    db.transaction((rows) => {
      for (const r of rows) {
        // Preserve the export's full metadata blob if present so fields
        // like project, llmModel, agent provenance survive the round
        // trip. Add a restoredFromExport flag without overwriting other
        // keys. Older exports may have only a `project` scalar at the
        // top level — fold it into metadata.project as a fallback.
        let metaObj = {};
        if (r.metadata && typeof r.metadata === 'object') {
          metaObj = { ...r.metadata };
        } else if (typeof r.metadata === 'string') {
          try { metaObj = JSON.parse(r.metadata) || {}; } catch { metaObj = {}; }
        }
        if (!metaObj.project && r.project) metaObj.project = r.project;
        metaObj.restoredFromExport = true;

        obsStmt.run({
          id: r.id,
          summary: r.summary ?? '',
          agent: r.agent ?? null,
          sessionId: r.sessionId ?? metaObj.sessionId ?? null,
          sourceFile: r.sourceFile ?? metaObj.sourceFile ?? null,
          contentHash: r.contentHash ?? null,
          createdAt: r.createdAt ?? null,
          digestedAt: r.digestedAt ?? null,
          quality: r.quality ?? 'normal',
          metadata: JSON.stringify(metaObj),
        });
      }
    })(observations);

    if (fs.existsSync(digExport)) {
      const digests = JSON.parse(fs.readFileSync(digExport, 'utf8'));
      const digStmt = db.prepare(`
        INSERT OR REPLACE INTO digests
          (id, date, theme, summary, observation_ids, agents, files_touched, quality, created_at, metadata, project)
        VALUES (@id, @date, @theme, @summary, @oids, @agents, @files, @quality, @createdAt, @metadata, @project)
      `);
      db.transaction((rows) => {
        for (const r of rows) {
          digStmt.run({
            id: r.id,
            date: r.date,
            theme: r.theme ?? '',
            summary: r.summary ?? '',
            oids: JSON.stringify(r.observationIds ?? []),
            agents: JSON.stringify(r.agents ?? []),
            files: JSON.stringify(r.filesTouched ?? []),
            quality: r.quality ?? 'normal',
            createdAt: r.createdAt ?? new Date().toISOString(),
            metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata ?? {}),
            project: r.project ?? 'unknown',
          });
        }
      })(digests);
    }

    if (fs.existsSync(insExport)) {
      const insights = JSON.parse(fs.readFileSync(insExport, 'utf8'));
      const insStmt = db.prepare(`
        INSERT OR REPLACE INTO insights
          (id, topic, summary, confidence, digest_ids, last_updated, created_at, metadata, project)
        VALUES (@id, @topic, @summary, @confidence, @digestIds, @lastUpdated, @createdAt, @metadata, @project)
      `);
      db.transaction((rows) => {
        for (const r of rows) {
          insStmt.run({
            id: r.id,
            topic: r.topic ?? '',
            summary: r.summary ?? '',
            confidence: r.confidence ?? 0.8,
            digestIds: JSON.stringify(r.digestIds ?? []),
            lastUpdated: r.lastUpdated ?? r.createdAt ?? new Date().toISOString(),
            createdAt: r.createdAt ?? new Date().toISOString(),
            metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata ?? {}),
            project: r.project ?? 'unknown',
          });
        }
      })(insights);
    }

    const obsCount = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
    const digCount = db.prepare('SELECT COUNT(*) AS n FROM digests').get().n;
    const insCount = db.prepare('SELECT COUNT(*) AS n FROM insights').get().n;
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();

    process.stderr.write(
      `[SafeDatabase] Restored from JSON export: ${obsCount} observations, ${digCount} digests, ${insCount} insights\n`
    );
  } catch (err) {
    process.stderr.write(`[SafeDatabase] Restore from export failed: ${err.message}\n`);
  }
}

/**
 * Open the observations database with crash-safe defaults.
 *
 * @param {string} dbPath — absolute path to the .db file
 * @param {object} [options]
 * @param {boolean} [options.readonly=false] — open in readonly mode
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(dbPath, options = {}) {
  const Database = require('better-sqlite3');
  const readonly = options.readonly ?? false;

  // Ensure parent directory exists (for first-time creation)
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Integrity check before opening (only if file already exists)
  if (fs.existsSync(dbPath)) {
    let needsRecovery = false;
    try {
      const probe = new Database(dbPath, { readonly: true });
      const result = probe.pragma('integrity_check');
      probe.close();
      needsRecovery = !result || result[0]?.integrity_check !== 'ok';
    } catch {
      needsRecovery = true;
    }

    if (needsRecovery) {
      process.stderr.write('[SafeDatabase] Corruption detected — attempting recovery...\n');
      const recovered = _attemptRecovery(dbPath);
      if (!recovered) {
        // Last resort: rename corrupted file and start fresh
        const backupPath = dbPath + '.corrupted-' + Date.now();
        fs.renameSync(dbPath, backupPath);
        for (const suffix of ['-shm', '-wal']) {
          const f = dbPath + suffix;
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ok */ }
        }
        process.stderr.write(`[SafeDatabase] Recovery failed — starting fresh. Backup: ${path.basename(backupPath)}\n`);
        _restoreFromExportIfPossible(dbPath);
      }
    }
  }

  // Open with correct mode
  const db = new Database(dbPath, { readonly });

  // Enforce WAL mode + busy_timeout on EVERY connection.
  // Even readonly connections must use WAL to coexist safely with WAL writers.
  // Without this, a readonly connection in DELETE journal mode can see
  // inconsistent state from a concurrent WAL writer.
  if (!readonly) {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('busy_timeout = 5000');

  // Track for shutdown cleanup
  _openConnections.add(db);
  _ensureShutdownHandlers();

  return db;
}

/**
 * Close a database opened with openDatabase.
 * Checkpoints WAL and removes from the tracked set.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function closeDatabase(db) {
  if (!db) return;
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
  try { db.close(); } catch { /* best effort */ }
  _openConnections.delete(db);
}
