/**
 * SQLite FTS5/LIKE keyword search across knowledge tiers.
 *
 * Uses FTS5 MATCH for observations (FTS table exists), LIKE fallback
 * for digests and insights (no FTS tables per Research Pitfall 2).
 * Accepts an already-open better-sqlite3 db instance (readonly) from
 * the caller to share server.js's cached _obsDb connection.
 *
 * All queries use parameterized placeholders (? or @param) to prevent
 * SQL injection (T-29-01 mitigation).
 *
 * @module keyword-search
 */

/**
 * Keyword search across observations (FTS5), digests (LIKE), and insights (LIKE).
 */
export class KeywordSearch {
  /**
   * @param {object} options
   * @param {number} [options.limit=20] - Max results per tier
   */
  constructor(options = {}) {
    this.limit = options.limit ?? 20;
  }

  /**
   * Run keyword search across all three tiers.
   *
   * @param {import('better-sqlite3').Database} db - Readonly better-sqlite3 instance
   * @param {string} query - Search query string
   * @returns {{ observations: Array, digests: Array, insights: Array }}
   */
  search(db, query) {
    if (!db || !query) {
      return { observations: [], digests: [], insights: [] };
    }
    return {
      observations: this._searchObservations(db, query),
      digests: this._searchDigests(db, query),
      insights: this._searchInsights(db, query),
    };
  }

  /**
   * Search observations using FTS5 MATCH with LIKE fallback.
   * FTS5 probe pattern from server.js lines 3941-3951.
   *
   * @param {import('better-sqlite3').Database} db
   * @param {string} query
   * @returns {Array<object>}
   */
  _searchObservations(db, query) {
    try {
      // Probe for FTS5 table existence
      db.prepare('SELECT 1 FROM observations_fts LIMIT 0').get();
      return db
        .prepare(
          `SELECT id, summary as summary_preview, agent,
                  created_at as date, quality, 'observations' as tier
           FROM observations
           WHERE rowid IN (SELECT rowid FROM observations_fts WHERE observations_fts MATCH ?)
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(query, this.limit);
    } catch {
      // FTS5 table missing or query syntax error -- fall back to LIKE
      try {
        return db
          .prepare(
            `SELECT id, summary as summary_preview, agent,
                    created_at as date, quality, 'observations' as tier
             FROM observations WHERE summary LIKE ?
             ORDER BY created_at DESC LIMIT ?`
          )
          .all(`%${query}%`, this.limit);
      } catch {
        return [];
      }
    }
  }

  /**
   * Search digests using LIKE (no FTS table exists per Research Pitfall 2).
   * Searches both summary and theme columns.
   *
   * @param {import('better-sqlite3').Database} db
   * @param {string} query
   * @returns {Array<object>}
   */
  _searchDigests(db, query) {
    try {
      return db
        .prepare(
          `SELECT id, summary as summary_preview, theme, date, agents, quality, 'digests' as tier
           FROM digests WHERE summary LIKE ? OR theme LIKE ?
           ORDER BY date DESC LIMIT ?`
        )
        .all(`%${query}%`, `%${query}%`, this.limit);
    } catch {
      return [];
    }
  }

  /**
   * Search insights using LIKE (no FTS table exists per Research Pitfall 2).
   * Searches both summary and topic columns.
   * Limit halved since insights are fewer and higher-value.
   *
   * @param {import('better-sqlite3').Database} db
   * @param {string} query
   * @returns {Array<object>}
   */
  _searchInsights(db, query) {
    try {
      return db
        .prepare(
          `SELECT id, summary as summary_preview, topic, confidence, 'insights' as tier
           FROM insights WHERE summary LIKE ? OR topic LIKE ?
           ORDER BY confidence DESC LIMIT ?`
        )
        .all(`%${query}%`, `%${query}%`, Math.floor(this.limit / 2));
    } catch {
      return [];
    }
  }
}
