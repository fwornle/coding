/**
 * ObservationExporter - Git-friendly JSON export of observations, digests, and insights.
 *
 * Reads from a km-core `GraphKMStore` (post Plan 44-18 — the legacy SQLite
 * file at `.observations/observations.db` was archived on 2026-06-05) and
 * writes human-readable JSON to `.data/observation-export/` for git tracking,
 * cross-machine portability, and backup. The dashboard's
 * `/api/coding/observations` endpoint reads this directory via ColdStoreReader.
 *
 * Backwards-compat: a legacy `db` (better-sqlite3 handle) is still accepted
 * so the pre-44 test fixture continues to work, but production callers
 * MUST pass `kmStore`. When both are present, `kmStore` wins.
 *
 * Exported files:
 *   observations.json  — structured summaries (no raw messages)
 *   digests.json       — daily thematic digests
 *   insights.json      — persistent project knowledge
 *   metadata.json      — export stats and timestamp
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
   * @param {Object} [options.kmStore] - km-core GraphKMStore handle (preferred).
   *   Must expose `.graph` (the underlying Graphology instance) so we can
   *   iterate nodes + read attributes. The store does NOT need to be open
   *   exclusively — read-only iteration is safe alongside writes.
   * @param {import('better-sqlite3').Database} [options.db] - Legacy SQLite
   *   handle. Used only when `kmStore` is absent (test fixtures, Plan 44-pre
   *   environments). When the file is the archived 4KB stub, the SELECT
   *   throws and the export returns []; the safety-merge below preserves
   *   the historic JSON unchanged.
   * @param {string} [options.projectRoot] - Project root (for resolving export dir)
   * @param {string} [options.exportDir] - Override export directory path
   */
  constructor({ kmStore, db, projectRoot, exportDir }) {
    this.kmStore = kmStore || null;
    this.db = db || null;
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
   *
   * Tombstones: when consolidation merges insight A into insight B, B's
   * metadata.absorbed records A's id as a tombstone. Tombstoned IDs are
   * NEVER preserved — they were intentionally deleted and resurrecting
   * them would re-introduce the duplicate the consolidation removed.
   */
  _mergeWithExisting(dbObs, dbDigests, dbInsights) {
    const result = { observations: dbObs, digests: dbDigests, insights: dbInsights };

    // Content-key extractor — defines a "same record" identity stronger
    // than the bare `id`. Used to suppress duplicates when km-core mints
    // a new UUID v7 for what is logically the same legacy SQLite row.
    // Without this, a digest re-keyed from `019eb732-…` (graphology key)
    // to `288fdf74-…` (legacyId.id) would be seen as a brand-new row by
    // the id-only set check and accumulate every export pass.
    const contentKey = (filename, r) => {
      if (filename === 'digests.json') return `D|${r.date || ''}|${r.theme || ''}`;
      if (filename === 'insights.json') return `I|${r.topic || ''}`;
      // Observations don't suffer the same re-keying because their export
      // shape was stable across Plan 44; key on id alone for them.
      return `O|${r.id || ''}`;
    };

    const mergeArrays = (dbRecords, filename) => {
      if (!dbRecords) return null;
      try {
        const existing = JSON.parse(fs.readFileSync(path.join(this.exportDir, filename), 'utf-8'));
        if (!Array.isArray(existing)) return dbRecords;
        if (existing.length <= dbRecords.length) return dbRecords;

        // Build tombstone set from canonicals' metadata.absorbed lists.
        // Any existing record whose id appears here was intentionally
        // deleted by consolidation and must not be resurrected.
        const tombstoned = this._collectTombstones(dbRecords);

        const dbIds = new Set(dbRecords.map((r) => r.id));
        const dbContentKeys = new Set(dbRecords.map((r) => contentKey(filename, r)));
        const preserved = existing.filter((r) =>
          !dbIds.has(r.id) &&
          !tombstoned.has(r.id) &&
          !dbContentKeys.has(contentKey(filename, r)),
        );
        const resurrected = existing.filter((r) => !dbIds.has(r.id) && tombstoned.has(r.id));
        const merged = [...preserved, ...dbRecords];
        process.stderr.write(
          `[ObservationExporter] Safety merge for ${filename}: kept ${preserved.length} historic + ${dbRecords.length} current = ${merged.length} total` +
            (resurrected.length > 0 ? ` (skipped ${resurrected.length} tombstoned)` : '') +
            `\n`
        );
        return merged;
      } catch { return dbRecords; }
    };

    result.observations = mergeArrays(dbObs, 'observations.json') ?? result.observations;
    result.digests = mergeArrays(dbDigests, 'digests.json') ?? result.digests;
    result.insights = mergeArrays(dbInsights, 'insights.json') ?? result.insights;

    return result;
  }

  /**
   * Scan a record list for tombstone IDs. Looks at each record's
   * `metadata.absorbed` array (written by ObservationConsolidator when
   * merging insights) and returns the union of every id mentioned there.
   *
   * The tombstone pattern generalises to any future consolidator that
   * uses the same `metadata.absorbed: [{id, topic}, ...]` convention.
   *
   * @param {Array<{metadata?: Object}>} records
   * @returns {Set<string>}
   */
  _collectTombstones(records) {
    const tombstoned = new Set();
    for (const r of records || []) {
      const meta = r.metadata;
      if (!meta || typeof meta !== 'object') continue;
      const absorbed = meta.absorbed;
      if (!Array.isArray(absorbed)) continue;
      for (const entry of absorbed) {
        if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
          tombstoned.add(entry.id);
        }
      }
    }
    return tombstoned;
  }


  /**
   * Iterate every km-core node with the given entityType. Returns plain
   * `{ id, attrs }` records — callers do the type-specific projection.
   * Throws if no kmStore is wired (callers should fall back to SQLite).
   *
   * @private
   * @param {string} entityType
   * @returns {Array<{id: string, attrs: any}>}
   */
  _kmEntitiesByType(entityType) {
    if (!this.kmStore || !this.kmStore.graph) {
      throw new Error('ObservationExporter: kmStore.graph not available');
    }
    const graph = this.kmStore.graph;
    const out = [];
    for (const id of graph.nodes()) {
      const attrs = graph.getNodeAttributes(id);
      if (attrs && attrs.entityType === entityType) out.push({ id, attrs });
    }
    return out;
  }

  _exportObservations() {
    // km-core path (production, post Plan 44-18).
    if (this.kmStore && this.kmStore.graph) {
      const rows = this._kmEntitiesByType('Observation');
      const mapped = rows
        .map(({ id, attrs }) => {
          const m = (attrs && attrs.metadata) || {};
          return {
            id,
            summary: attrs.description || attrs.name || '',
            agent: m.agent || attrs.agent || 'unknown',
            project: m.project || 'coding',
            source: m.source || null,
            quality: m.quality || 'normal',
            createdAt: attrs.createdAt || null,
            digestedAt: m.digestedAt || null,
            llm: m.llmModel ? { model: m.llmModel, provider: m.llmProvider || null } : null,
            modifiedFiles: Array.isArray(m.modifiedFiles) ? m.modifiedFiles : null,
          };
        })
        .filter((r) => r.quality !== 'low');
      mapped.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      return mapped;
    }
    // Legacy SQLite path — kept for test fixtures that still set up an
    // in-memory better-sqlite3 handle. Production never reaches here.
    if (!this.db) return [];
    const rows = this.db.prepare(`
      SELECT id, summary, agent, session_id, source_file, created_at,
             quality, content_hash, digested_at,
             json_extract(metadata, '$.project') as project,
             json_extract(metadata, '$.source') as source,
             json_extract(metadata, '$.llmModel') as llmModel,
             json_extract(metadata, '$.llmProvider') as llmProvider,
             json_extract(metadata, '$.modifiedFiles') as modifiedFiles
      FROM observations
      WHERE quality != 'low'
      ORDER BY created_at ASC
    `).all();
    return rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      agent: r.agent,
      project: r.project || null,
      source: r.source || null,
      quality: r.quality,
      createdAt: r.created_at,
      digestedAt: r.digested_at || null,
      llm: r.llmModel ? { model: r.llmModel, provider: r.llmProvider } : null,
      modifiedFiles: r.modifiedFiles ? JSON.parse(r.modifiedFiles) : null,
    }));
  }

  _exportDigests() {
    if (this.kmStore && this.kmStore.graph) {
      const rows = this._kmEntitiesByType('Digest');
      const mapped = rows.map(({ id, attrs }) => {
        const m = (attrs && attrs.metadata) || {};
        // km-core metadata uses SNAKE_CASE for the legacy SQLite-derived
        // relationship fields — observation_ids, files_touched (see the
        // wire-shape lock in @fwornle/km-core's digestToLegacy). Reading
        // camelCase here returned undefined → empty arrays → the dashboard
        // showed "0 obs" on every km-core-sourced digest.
        return {
          id: (attrs.legacyId && attrs.legacyId.id) || id,
          date: m.date || (attrs.createdAt || '').slice(0, 10),
          theme: m.theme || attrs.name || '',
          summary: m.summary || attrs.description || '',
          observationIds: Array.isArray(m.observation_ids)
            ? m.observation_ids
            : (Array.isArray(m.observationIds) ? m.observationIds : []),
          agents: Array.isArray(m.agents) ? m.agents : [],
          filesTouched: Array.isArray(m.files_touched)
            ? m.files_touched
            : (Array.isArray(m.filesTouched) ? m.filesTouched : []),
          quality: m.quality || 'normal',
          createdAt: m.createdAt || attrs.createdAt || null,
          metadata: m,
          project: m.project || 'coding',
        };
      });
      mapped.sort((a, b) => {
        const cmp = (a.date || '').localeCompare(b.date || '');
        if (cmp !== 0) return cmp;
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });
      return mapped;
    }
    if (!this.db) return [];
    try {
      this.db.prepare('SELECT 1 FROM digests LIMIT 0').get();
    } catch {
      return [];
    }
    const hasProject = this._tableHasColumn('digests', 'project');
    const projectExpr = hasProject ? 'project' : 'NULL AS project';
    const rows = this.db.prepare(`
      SELECT id, date, theme, summary, observation_ids, agents,
             files_touched, quality, created_at, metadata,
             ${projectExpr}
      FROM digests
      ORDER BY date ASC, created_at ASC
    `).all();
    return rows.map((r) => ({
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
    if (this.kmStore && this.kmStore.graph) {
      const rows = this._kmEntitiesByType('Insight');
      const mapped = rows.map(({ id, attrs }) => {
        const m = (attrs && attrs.metadata) || {};
        // Same snake_case convention as Digest — km-core stores digest_ids
        // and last_updated under the legacy SQLite naming. insightToLegacy
        // in @fwornle/km-core reads m.digest_ids; do likewise here so the
        // ColdStore JSON matches the dashboard's km-core-backed view.
        return {
          // id = km-core UUID key (NOT legacyId.id, which can be a topic-string
          // or null for online insights) so deep-links resolve. Matches the
          // obs-api /api/coding/insights override.
          id,
          topic: m.topic || attrs.name || '',
          summary: m.summary || attrs.description || '',
          confidence: typeof m.confidence === 'number' ? m.confidence : 0,
          digestIds: Array.isArray(m.digest_ids)
            ? m.digest_ids
            : (Array.isArray(m.digestIds) ? m.digestIds : []),
          lastUpdated: m.last_updated || attrs.updatedAt || attrs.createdAt || null,
          createdAt: m.createdAt || attrs.createdAt || null,
          metadata: m,
          project: m.project || 'coding',
        };
      });
      mapped.sort((a, b) => {
        const cmp = (b.confidence || 0) - (a.confidence || 0);
        if (cmp !== 0) return cmp;
        return (b.lastUpdated || '').localeCompare(a.lastUpdated || '');
      });
      return mapped;
    }
    if (!this.db) return [];
    try {
      this.db.prepare('SELECT 1 FROM insights LIMIT 0').get();
    } catch {
      return [];
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
    return rows.map((r) => ({
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
    if (this.kmStore && this.kmStore.graph) {
      // km-core path — re-iterate is cheap (single pass over node names).
      try { obsCnt = this._kmEntitiesByType('Observation').filter((r) => (r.attrs?.metadata?.quality !== 'low')).length; } catch { /* ok */ }
      try { digestCnt = this._kmEntitiesByType('Digest').length; } catch { /* ok */ }
      try { insightCnt = this._kmEntitiesByType('Insight').length; } catch { /* ok */ }
    } else if (this.db) {
      try { obsCnt = this.db.prepare("SELECT COUNT(*) as c FROM observations WHERE quality != 'low'").get().c; } catch { /* ok */ }
      try { digestCnt = this.db.prepare('SELECT COUNT(*) as c FROM digests').get().c; } catch { /* ok */ }
      try { insightCnt = this.db.prepare('SELECT COUNT(*) as c FROM insights').get().c; } catch { /* ok */ }
    }

    // Trust the DB count after consolidation legitimately drops rows — the
    // previous Math.max heuristic kept the higher number forever, so a single
    // consolidation that deleted 8 rows would leave the metadata count
    // permanently inflated by 8 until another insight was created. Only fall
    // back to the existing count if the DB returned 0 (likely a transient
    // table-missing or empty-DB error, not a legitimate drop).
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(this.exportDir, 'metadata.json'), 'utf-8'));
      if (obsCnt === 0 && existing.counts?.observations > 0) obsCnt = existing.counts.observations;
      if (digestCnt === 0 && existing.counts?.digests > 0) digestCnt = existing.counts.digests;
      if (insightCnt === 0 && existing.counts?.insights > 0) insightCnt = existing.counts.insights;
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
