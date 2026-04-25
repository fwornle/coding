#!/usr/bin/env node
/**
 * Restore observations.db from the JSON exports.
 *
 * When SafeDatabase recovery fails and the live DB is rotated to
 * .corrupted-{timestamp}, this script rebuilds a fresh DB from the
 * git-tracked JSON exports under .data/observation-export/.
 *
 * Usage:
 *   node scripts/restore-observations-from-export.js [--dry-run] [--force]
 *
 * Behavior:
 *   - Refuses to run if observations.db already exists, unless --force.
 *   - Reads observations.json, digests.json, insights.json.
 *   - Creates the 3 tables via the canonical CREATE TABLE statements
 *     (kept in sync with ObservationWriter / ObservationConsolidator).
 *   - Inserts every row, mapping camelCase JSON fields to snake_case columns.
 *
 * Note: the JSON export does not preserve every DB column. Lost on restore:
 *   - observations.messages (raw conversation text)
 *   - observations.session_id, source_file, content_hash
 *   - per-row metadata blobs
 * The visible fields (summary, agent, theme, topic, etc.) are restored.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/live-logging/SafeDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(REPO_ROOT, '.observations', 'observations.db');
const EXPORT_DIR = path.join(REPO_ROOT, '.data', 'observation-export');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');

function log(msg) {
  process.stderr.write(`[restore-observations] ${msg}\n`);
}

function readJson(file) {
  const fullPath = path.join(EXPORT_DIR, file);
  if (!fs.existsSync(fullPath)) {
    log(`Missing export: ${fullPath}`);
    return [];
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      summary TEXT,
      messages TEXT,
      agent TEXT,
      session_id TEXT,
      source_file TEXT,
      created_at TEXT,
      metadata TEXT,
      content_hash TEXT,
      quality TEXT DEFAULT 'normal',
      digested_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS digests (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      theme TEXT NOT NULL,
      summary TEXT NOT NULL,
      observation_ids TEXT NOT NULL,
      agents TEXT,
      files_touched TEXT,
      quality TEXT DEFAULT 'normal',
      created_at TEXT NOT NULL,
      metadata TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      summary TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      digest_ids TEXT NOT NULL,
      last_updated TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata TEXT
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_obs_digested ON observations(digested_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_digests_date ON digests(date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_insights_topic ON insights(topic)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_obs_agent_hash ON observations(agent, content_hash)');
}

function restoreObservations(db, rows) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO observations
      (id, summary, agent, created_at, digested_at, quality, metadata)
    VALUES (@id, @summary, @agent, @createdAt, @digestedAt, @quality, @metadata)
  `);
  const insertMany = db.transaction((items) => {
    for (const r of items) {
      stmt.run({
        id: r.id,
        summary: r.summary ?? '',
        agent: r.agent ?? null,
        createdAt: r.createdAt ?? null,
        digestedAt: r.digestedAt ?? null,
        quality: r.quality ?? 'normal',
        metadata: JSON.stringify({
          project: r.project ?? null,
          llm: r.llm ?? null,
          modifiedFiles: r.modifiedFiles ?? null,
          restoredFromExport: true,
        }),
      });
    }
  });
  insertMany(rows);
}

function restoreDigests(db, rows) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO digests
      (id, date, theme, summary, observation_ids, agents, files_touched, quality, created_at)
    VALUES (@id, @date, @theme, @summary, @observation_ids, @agents, @files_touched, @quality, @created_at)
  `);
  const insertMany = db.transaction((items) => {
    for (const r of items) {
      stmt.run({
        id: r.id,
        date: r.date,
        theme: r.theme ?? '',
        summary: r.summary ?? '',
        observation_ids: JSON.stringify(r.observationIds ?? []),
        agents: JSON.stringify(r.agents ?? []),
        files_touched: JSON.stringify(r.filesTouched ?? []),
        quality: r.quality ?? 'normal',
        created_at: r.createdAt ?? new Date().toISOString(),
      });
    }
  });
  insertMany(rows);
}

function restoreInsights(db, rows) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO insights
      (id, topic, summary, confidence, digest_ids, last_updated, created_at)
    VALUES (@id, @topic, @summary, @confidence, @digest_ids, @last_updated, @created_at)
  `);
  const insertMany = db.transaction((items) => {
    for (const r of items) {
      stmt.run({
        id: r.id,
        topic: r.topic ?? '',
        summary: r.summary ?? '',
        confidence: r.confidence ?? 0.8,
        digest_ids: JSON.stringify(r.digestIds ?? []),
        last_updated: r.lastUpdated ?? r.createdAt ?? new Date().toISOString(),
        created_at: r.createdAt ?? new Date().toISOString(),
      });
    }
  });
  insertMany(rows);
}

function main() {
  if (fs.existsSync(DB_PATH) && !FORCE) {
    log(`DB already exists at ${DB_PATH}. Use --force to overwrite.`);
    process.exit(1);
  }

  const observations = readJson('observations.json');
  const digests = readJson('digests.json');
  const insights = readJson('insights.json');

  log(`Loaded exports: ${observations.length} observations, ${digests.length} digests, ${insights.length} insights`);

  if (DRY_RUN) {
    log('Dry run — no DB writes. Exiting.');
    return;
  }

  if (FORCE && fs.existsSync(DB_PATH)) {
    fs.renameSync(DB_PATH, DB_PATH + '.before-restore-' + Date.now());
    log(`Renamed existing DB`);
  }

  const db = openDatabase(DB_PATH);
  ensureSchema(db);

  log('Restoring observations...');
  restoreObservations(db, observations);
  log('Restoring digests...');
  restoreDigests(db, digests);
  log('Restoring insights...');
  restoreInsights(db, insights);

  // Verify
  const obsCount = db.prepare('SELECT COUNT(*) as n FROM observations').get().n;
  const digCount = db.prepare('SELECT COUNT(*) as n FROM digests').get().n;
  const insCount = db.prepare('SELECT COUNT(*) as n FROM insights').get().n;
  log(`Restored: ${obsCount} observations, ${digCount} digests, ${insCount} insights`);

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

main();
