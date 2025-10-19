/**
 * Trajectory History Service
 *
 * Persists trajectory state changes to database for historical analysis and cross-session learning.
 * Enables queries for trajectory patterns across sessions, success analysis, and common workflows.
 *
 * Features:
 * - Async persistence (doesn't block live trajectory updates)
 * - Efficient batch writes for high-volume scenarios
 * - Flexible querying by project, session, intent, date range
 * - Trajectory pattern detection across sessions
 * - Success pattern analysis (what worked in similar contexts)
 * - Data retention policies (archive old trajectories)
 * - Analytics: time in each state, common intents, transition patterns
 */

import { DatabaseManager } from '../databases/DatabaseManager.js';

export class TrajectoryHistoryService {
  constructor(config = {}) {
    this.config = {
      projectPath: config.projectPath,
      retentionDays: config.retentionDays || 365, // Keep 1 year by default
      batchSize: config.batchSize || 50,
      flushInterval: config.flushInterval || 60000, // Flush every 60 seconds
      debug: config.debug || false,
      ...config
    };

    // Initialize database manager
    this.databaseManager = null;
    this.initializeDatabaseManager();

    // Batch write buffer
    this.writeBuffer = [];
    this.lastFlush = Date.now();

    // Start periodic flush
    this.startPeriodicFlush();

    this.debug('TrajectoryHistoryService initialized', {
      projectPath: this.config.projectPath,
      retentionDays: this.config.retentionDays
    });
  }

  /**
   * Initialize database manager
   */
  async initializeDatabaseManager() {
    try {
      this.databaseManager = new DatabaseManager({
        projectPath: this.config.projectPath,
        debug: this.config.debug
      });

      await this.databaseManager.initialize();
      await this.ensureTrajectoryHistoryTable();

      this.debug('DatabaseManager initialized for trajectory history');
    } catch (error) {
      console.error('Failed to initialize DatabaseManager:', error.message);
      this.databaseManager = null;
    }
  }

  /**
   * Ensure trajectory_history table exists in SQLite
   */
  async ensureTrajectoryHistoryTable() {
    if (!this.databaseManager?.sqliteDb) {
      throw new Error('SQLite database not available');
    }

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS trajectory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        session_id TEXT,
        state TEXT NOT NULL,
        intent TEXT,
        goal TEXT,
        confidence REAL,
        timestamp INTEGER NOT NULL,
        duration INTEGER,
        from_state TEXT,
        to_state TEXT,
        trigger TEXT,
        reasoning TEXT,
        concepts_json TEXT,
        metadata_json TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `;

    this.databaseManager.sqliteDb.exec(createTableSQL);

    // Create indexes for fast queries
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_trajectory_project ON trajectory_history(project_path)',
      'CREATE INDEX IF NOT EXISTS idx_trajectory_session ON trajectory_history(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_trajectory_state ON trajectory_history(state)',
      'CREATE INDEX IF NOT EXISTS idx_trajectory_intent ON trajectory_history(intent)',
      'CREATE INDEX IF NOT EXISTS idx_trajectory_timestamp ON trajectory_history(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_trajectory_project_timestamp ON trajectory_history(project_path, timestamp)'
    ];

    indexes.forEach(indexSQL => {
      this.databaseManager.sqliteDb.exec(indexSQL);
    });

    this.debug('trajectory_history table and indexes created');
  }

  /**
   * Persist trajectory state change (async, buffered)
   */
  async persistStateChange(stateChange, options = {}) {
    if (!this.databaseManager?.sqliteDb) {
      this.debug('Database not available, skipping persistence');
      return null;
    }

    const record = {
      project_path: stateChange.projectPath || this.config.projectPath,
      session_id: stateChange.sessionId || this.generateSessionId(),
      state: stateChange.state || stateChange.to,
      intent: stateChange.intent,
      goal: stateChange.goal,
      confidence: stateChange.confidence,
      timestamp: stateChange.timestamp || Date.now(),
      duration: stateChange.duration,
      from_state: stateChange.from || stateChange.fromState,
      to_state: stateChange.to || stateChange.toState,
      trigger: stateChange.trigger,
      reasoning: stateChange.reasoning,
      concepts_json: stateChange.concepts ? JSON.stringify(stateChange.concepts) : null,
      metadata_json: stateChange.metadata ? JSON.stringify(stateChange.metadata) : null
    };

    // Add to buffer
    this.writeBuffer.push(record);

    // Flush if buffer is full or immediate write requested
    if (options.immediate || this.writeBuffer.length >= this.config.batchSize) {
      return await this.flushBuffer();
    }

    return { buffered: true, bufferSize: this.writeBuffer.length };
  }

  /**
   * Flush write buffer to database
   */
  async flushBuffer() {
    if (!this.databaseManager?.sqliteDb || this.writeBuffer.length === 0) {
      return { flushed: 0 };
    }

    const recordsToWrite = [...this.writeBuffer];
    this.writeBuffer = [];
    this.lastFlush = Date.now();

    try {
      const insertSQL = `
        INSERT INTO trajectory_history (
          project_path, session_id, state, intent, goal, confidence,
          timestamp, duration, from_state, to_state, trigger, reasoning,
          concepts_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const insertStmt = this.databaseManager.sqliteDb.prepare(insertSQL);

      // Batch insert for performance
      const insertMany = this.databaseManager.sqliteDb.transaction((records) => {
        for (const record of records) {
          insertStmt.run(
            record.project_path,
            record.session_id,
            record.state,
            record.intent,
            record.goal,
            record.confidence,
            record.timestamp,
            record.duration,
            record.from_state,
            record.to_state,
            record.trigger,
            record.reasoning,
            record.concepts_json,
            record.metadata_json
          );
        }
      });

      insertMany(recordsToWrite);

      this.debug('Flushed trajectory history buffer', { count: recordsToWrite.length });

      return { flushed: recordsToWrite.length };
    } catch (error) {
      console.error('Failed to flush trajectory history buffer:', error.message);
      // Put records back in buffer for retry
      this.writeBuffer.unshift(...recordsToWrite);
      return { flushed: 0, error: error.message };
    }
  }

  /**
   * Query trajectory patterns across sessions
   */
  async queryTrajectoryPatterns(filters = {}) {
    if (!this.databaseManager?.sqliteDb) {
      throw new Error('Database not available');
    }

    const {
      projectPath = this.config.projectPath,
      intent,
      state,
      startDate,
      endDate,
      limit = 100
    } = filters;

    let sql = `
      SELECT
        state,
        intent,
        COUNT(*) as occurrence_count,
        AVG(duration) as avg_duration,
        AVG(confidence) as avg_confidence,
        GROUP_CONCAT(DISTINCT from_state) as from_states,
        GROUP_CONCAT(DISTINCT to_state) as to_states
      FROM trajectory_history
      WHERE project_path = ?
    `;

    const params = [projectPath];

    if (intent) {
      sql += ' AND intent = ?';
      params.push(intent);
    }

    if (state) {
      sql += ' AND state = ?';
      params.push(state);
    }

    if (startDate) {
      sql += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND timestamp <= ?';
      params.push(endDate);
    }

    sql += `
      GROUP BY state, intent
      ORDER BY occurrence_count DESC
      LIMIT ?
    `;
    params.push(limit);

    const patterns = this.databaseManager.sqliteDb.prepare(sql).all(...params);

    return patterns.map(p => ({
      state: p.state,
      intent: p.intent,
      occurrenceCount: p.occurrence_count,
      avgDuration: p.avg_duration,
      avgConfidence: p.avg_confidence,
      fromStates: p.from_states ? p.from_states.split(',') : [],
      toStates: p.to_states ? p.to_states.split(',') : []
    }));
  }

  /**
   * Query trajectory analytics for a project
   */
  async getTrajectoryAnalytics(filters = {}) {
    if (!this.databaseManager?.sqliteDb) {
      throw new Error('Database not available');
    }

    const {
      projectPath = this.config.projectPath,
      startDate,
      endDate
    } = filters;

    const params = [projectPath];
    let dateFilter = '';

    if (startDate) {
      dateFilter += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      dateFilter += ' AND timestamp <= ?';
      params.push(endDate);
    }

    // Time in each state
    const timeInStateSQL = `
      SELECT
        state,
        SUM(duration) as total_time,
        COUNT(*) as occurrence_count,
        AVG(duration) as avg_time
      FROM trajectory_history
      WHERE project_path = ? ${dateFilter}
        AND duration IS NOT NULL
      GROUP BY state
      ORDER BY total_time DESC
    `;

    const timeInState = this.databaseManager.sqliteDb.prepare(timeInStateSQL).all(...params);

    // Intent distribution
    const intentDistributionSQL = `
      SELECT
        intent,
        COUNT(*) as count,
        AVG(confidence) as avg_confidence
      FROM trajectory_history
      WHERE project_path = ? ${dateFilter}
        AND intent IS NOT NULL
      GROUP BY intent
      ORDER BY count DESC
    `;

    const intentDistribution = this.databaseManager.sqliteDb.prepare(intentDistributionSQL).all(...params);

    // Common transitions
    const transitionsSQL = `
      SELECT
        from_state,
        to_state,
        COUNT(*) as count
      FROM trajectory_history
      WHERE project_path = ? ${dateFilter}
        AND from_state IS NOT NULL
        AND to_state IS NOT NULL
      GROUP BY from_state, to_state
      ORDER BY count DESC
      LIMIT 20
    `;

    const transitions = this.databaseManager.sqliteDb.prepare(transitionsSQL).all(...params);

    return {
      timeInState: timeInState.map(t => ({
        state: t.state,
        totalTime: t.total_time,
        occurrenceCount: t.occurrence_count,
        avgTime: t.avg_time
      })),
      intentDistribution: intentDistribution.map(i => ({
        intent: i.intent,
        count: i.count,
        avgConfidence: i.avg_confidence
      })),
      commonTransitions: transitions.map(t => ({
        from: t.from_state,
        to: t.to_state,
        count: t.count
      }))
    };
  }

  /**
   * Find similar sessions based on intent and goal
   */
  async findSimilarSessions(currentSession, options = {}) {
    if (!this.databaseManager?.sqliteDb) {
      throw new Error('Database not available');
    }

    const {
      projectPath = this.config.projectPath,
      intent = currentSession.intent,
      limit = 10
    } = options;

    const sql = `
      SELECT
        session_id,
        intent,
        goal,
        state,
        COUNT(*) as state_changes,
        MIN(timestamp) as session_start,
        MAX(timestamp) as session_end,
        AVG(confidence) as avg_confidence
      FROM trajectory_history
      WHERE project_path = ?
        AND intent = ?
        AND session_id != ?
      GROUP BY session_id
      ORDER BY session_start DESC
      LIMIT ?
    `;

    const sessions = this.databaseManager.sqliteDb.prepare(sql).all(
      projectPath,
      intent,
      currentSession.sessionId || 'current',
      limit
    );

    return sessions.map(s => ({
      sessionId: s.session_id,
      intent: s.intent,
      goal: s.goal,
      finalState: s.state,
      stateChanges: s.state_changes,
      sessionStart: s.session_start,
      sessionEnd: s.session_end,
      avgConfidence: s.avg_confidence,
      duration: s.session_end - s.session_start
    }));
  }

  /**
   * Archive old trajectory data
   */
  async archiveOldTrajectories() {
    if (!this.databaseManager?.sqliteDb) {
      throw new Error('Database not available');
    }

    const cutoffDate = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);

    const deleteSQL = `
      DELETE FROM trajectory_history
      WHERE timestamp < ?
        AND project_path = ?
    `;

    const result = this.databaseManager.sqliteDb.prepare(deleteSQL).run(
      cutoffDate,
      this.config.projectPath
    );

    this.debug('Archived old trajectories', {
      deleted: result.changes,
      cutoffDate: new Date(cutoffDate).toISOString()
    });

    return { deleted: result.changes };
  }

  /**
   * Generate session ID (can be overridden for custom session tracking)
   */
  generateSessionId() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const random = Math.random().toString(36).substring(2, 8);
    return `session_${date}_${random}`;
  }

  /**
   * Start periodic buffer flush
   */
  startPeriodicFlush() {
    this.flushTimer = setInterval(async () => {
      const timeSinceLastFlush = Date.now() - this.lastFlush;
      if (timeSinceLastFlush >= this.config.flushInterval && this.writeBuffer.length > 0) {
        await this.flushBuffer();
      }
    }, this.config.flushInterval);

    this.debug('Periodic flush started', { interval: this.config.flushInterval });
  }

  /**
   * Stop periodic buffer flush
   */
  stopPeriodicFlush() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      this.debug('Periodic flush stopped');
    }
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown() {
    this.stopPeriodicFlush();

    // Flush any remaining buffered records
    if (this.writeBuffer.length > 0) {
      await this.flushBuffer();
    }

    this.debug('TrajectoryHistoryService shutdown complete');
  }

  /**
   * Debug logging
   */
  debug(message, data = null) {
    if (this.config.debug) {
      console.error(`[TrajectoryHistoryService] ${message}`);
      if (data) {
        console.error('  Data:', data);
      }
    }
  }
}

export default TrajectoryHistoryService;
