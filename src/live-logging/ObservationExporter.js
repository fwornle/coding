/**
 * ObservationExporter - Git-friendly JSON export of observations, digests, and insights.
 *
 * Mirrors the UKB knowledge-export pattern: SQLite stays as the runtime store,
 * this module exports human-readable JSON to `.data/observation-export/` for
 * git tracking, cross-machine portability, and backup.
 *
 * Exported files:
 *   observations.json  — structured summaries (no raw messages)
 *   digests.json        — daily thematic digests
 *   insights.json       — persistent project knowledge
 *   metadata.json       — export stats and timestamp
 *
 * @module ObservationExporter
 */

import fs from 'node:fs';
import path from 'node:path';

/** Default export directory relative to project root */
const DEFAULT_EXPORT_DIR = '.data/observation-export';

/** Parse JSON, returning {} on any failure. */
function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export class ObservationExporter {
  /**
   * @param {Object} options
   * @param {import('better-sqlite3').Database} options.db - Open SQLite database handle
   * @param {string} [options.projectRoot] - Project root (for resolving export dir)
   * @param {string} [options.exportDir] - Override export directory path
   */
  constructor({ db, projectRoot, exportDir }) {
    this.db = db;
    this.exportDir = exportDir || path.resolve(projectRoot || '.', DEFAULT_EXPORT_DIR);
  }

  /**
   * Export all three tiers to JSON files.
   * Called after observation writes and consolidation runs.
   *
   * Safety: if the existing export has more records than the DB (e.g. DB was
   * reset/recreated), we APPEND new records from the DB rather than
   * overwriting — this prevents data loss.
   */
  exportAll() {
    fs.mkdirSync(this.exportDir, { recursive: true });

    const observations = this._exportObservations();
    const digests = this._exportDigests();
    const insights = this._exportInsights();

    // Guard: merge with existing exports if DB has fewer records
    const merged = this._mergeWithExisting(observations, digests, insights);

    const metadata = {
      exportedAt: new Date().toISOString(),
      counts: {
        observations: merged.observations.length,
        digests: merged.digests.length,
        insights: merged.insights.length,
      },
      source: 'observations.db',
    };

    this._writeJSON('observations.json', merged.observations);
    this._writeJSON('digests.json', merged.digests);
    this._writeJSON('insights.json', merged.insights);
    this._writeJSON('metadata.json', metadata);

    process.stderr.write(
      `[ObservationExporter] Exported ${merged.observations.length} obs, ${merged.digests.length} digests, ${merged.insights.length} insights → ${this.exportDir}\n`
    );
  }

  /**
   * Export only observations (lightweight — called after each write).
   */
  exportObservations() {
    fs.mkdirSync(this.exportDir, { recursive: true });
    const observations = this._exportObservations();
    const merged = this._mergeWithExisting(observations, null, null);
    this._writeJSON('observations.json', merged.observations);
    this._updateMetadataCounts();
  }

  /**
   * Export digests and insights (called after consolidation).
   */
  exportConsolidated() {
    fs.mkdirSync(this.exportDir, { recursive: true });
    const digests = this._exportDigests();
    const insights = this._exportInsights();
    const merged = this._mergeWithExisting(null, digests, insights);
    this._writeJSON('digests.json', merged.digests);
    this._writeJSON('insights.json', merged.insights);
    this._updateMetadataCounts();
  }

  // --- Internal ---

  /**
   * Merge DB records with existing export files to prevent data loss.
   * If the existing export has records not in the DB (DB was reset),
   * those records are preserved and new DB records are appended.
   */
  _mergeWithExisting(dbObs, dbDigests, dbInsights) {
    const result = { observations: dbObs, digests: dbDigests, insights: dbInsights };

    const mergeArrays = (dbRecords, filename) => {
      if (!dbRecords) return null;
      try {
        const existing = JSON.parse(fs.readFileSync(path.join(this.exportDir, filename), 'utf-8'));
        if (!Array.isArray(existing)) return dbRecords;
        if (existing.length <= dbRecords.length) return dbRecords;

        // Existing export has more records — merge by ID
        const dbIds = new Set(dbRecords.map(r => r.id));
        const preserved = existing.filter(r => !dbIds.has(r.id));
        const merged = [...preserved, ...dbRecords];
        process.stderr.write(
          `[ObservationExporter] Safety merge for ${filename}: kept ${preserved.length} historic + ${dbRecords.length} current = ${merged.length} total\n`
        );
        return merged;
      } catch { return dbRecords; }
    };

    result.observations = mergeArrays(dbObs, 'observations.json') ?? result.observations;
    result.digests = mergeArrays(dbDigests, 'digests.json') ?? result.digests;
    result.insights = mergeArrays(dbInsights, 'insights.json') ?? result.insights;

    return result;
  }


  _exportObservations() {
    const rows = this.db.prepare(`
      SELECT id, summary, agent, session_id, source_file, created_at,
             quality, content_hash, digested_at,
             json_extract(metadata, '$.project') as project,
             json_extract(metadata, '$.llmModel') as llmModel,
             json_extract(metadata, '$.llmProvider') as llmProvider,
             json_extract(metadata, '$.modifiedFiles') as modifiedFiles
      FROM observations
      WHERE quality != 'low'
      ORDER BY created_at ASC
    `).all();

    return rows.map(r => ({
      id: r.id,
      summary: r.summary,
      agent: r.agent,
      project: r.project || null,
      quality: r.quality,
      createdAt: r.created_at,
      digestedAt: r.digested_at || null,
      llm: r.llmModel ? { model: r.llmModel, provider: r.llmProvider } : null,
      modifiedFiles: r.modifiedFiles ? JSON.parse(r.modifiedFiles) : null,
    }));
  }

  _exportDigests() {
    try {
      this.db.prepare('SELECT 1 FROM digests LIMIT 0').get();
    } catch {
      return []; // table doesn't exist yet
    }

    // Project may be missing from older DBs that pre-date Phase A — fall
    // back to NULL via COALESCE in the projection so the column read
    // doesn't fail before the schema is upgraded.
    const hasProject = this._tableHasColumn('digests', 'project');
    const projectExpr = hasProject ? 'project' : 'NULL AS project';
    const rows = this.db.prepare(`
      SELECT id, date, theme, summary, observation_ids, agents,
             files_touched, quality, created_at, metadata,
             ${projectExpr}
      FROM digests
      ORDER BY date ASC, created_at ASC
    `).all();

    return rows.map(r => ({
      id: r.id,
      date: r.date,
      theme: r.theme,
      summary: r.summary,
      observationIds: JSON.parse(r.observation_ids || '[]'),
      agents: JSON.parse(r.agents || '[]'),
      filesTouched: JSON.parse(r.files_touched || '[]'),
      quality: r.quality,
      createdAt: r.created_at,
      metadata: r.metadata ? safeParseJson(r.metadata) : {},
      project: r.project || 'unknown',
    }));
  }

  _exportInsights() {
    try {
      this.db.prepare('SELECT 1 FROM insights LIMIT 0').get();
    } catch {
      return []; // table doesn't exist yet
    }

    const hasProject = this._tableHasColumn('insights', 'project');
    const projectExpr = hasProject ? 'project' : 'NULL AS project';
    const rows = this.db.prepare(`
      SELECT id, topic, summary, confidence, digest_ids,
             last_updated, created_at, metadata,
             ${projectExpr}
      FROM insights
      ORDER BY confidence DESC, last_updated DESC
    `).all();

    return rows.map(r => ({
      id: r.id,
      topic: r.topic,
      summary: r.summary,
      confidence: r.confidence,
      digestIds: JSON.parse(r.digest_ids || '[]'),
      lastUpdated: r.last_updated,
      createdAt: r.created_at,
      metadata: r.metadata ? safeParseJson(r.metadata) : {},
      project: r.project || 'unknown',
    }));
  }

  /**
   * Probe a table for a column. Used to keep the exporter compatible
   * with DBs created before Phase A added the project column.
   */
  _tableHasColumn(table, column) {
    try {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all();
      return cols.some(c => c.name === column);
    } catch {
      return false;
    }
  }

  _updateMetadataCounts() {
    let obsCnt = 0, digestCnt = 0, insightCnt = 0;
    try { obsCnt = this.db.prepare("SELECT COUNT(*) as c FROM observations WHERE quality != 'low'").get().c; } catch { /* ok */ }
    try { digestCnt = this.db.prepare('SELECT COUNT(*) as c FROM digests').get().c; } catch { /* ok */ }
    try { insightCnt = this.db.prepare('SELECT COUNT(*) as c FROM insights').get().c; } catch { /* ok */ }

    // Use the larger of DB count vs existing export count (safety against DB reset)
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(this.exportDir, 'metadata.json'), 'utf-8'));
      obsCnt = Math.max(obsCnt, existing.counts?.observations || 0);
      digestCnt = Math.max(digestCnt, existing.counts?.digests || 0);
      insightCnt = Math.max(insightCnt, existing.counts?.insights || 0);
    } catch { /* first export or corrupted metadata */ }

    this._writeJSON('metadata.json', {
      exportedAt: new Date().toISOString(),
      counts: { observations: obsCnt, digests: digestCnt, insights: insightCnt },
      source: 'observations.db',
    });
  }

  /**
   * Write JSON with stable key ordering for clean git diffs.
   */
  _writeJSON(filename, data) {
    const filePath = path.join(this.exportDir, filename);
    const content = JSON.stringify(data, null, 2) + '\n';

    // Skip write if content hasn't changed (avoids unnecessary git churn)
    try {
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (existing === content) return;
    } catch { /* file doesn't exist yet */ }

    fs.writeFileSync(filePath, content, 'utf-8');
  }
}
