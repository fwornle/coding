import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export class DuckDBAnalytics {
  constructor(config = {}) {
    this.config = {
      memory: config.memory || '256MB',
      threads: config.threads || 4,
      enableOptimizer: config.enableOptimizer !== false,
      dbPath: config.dbPath || ':memory:', // In-memory for speed
      ...config
    };
    
    this.db = null;
    this.connection = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      // Initialize SQLite database (more reliable than DuckDB)
      this.db = new Database(this.config.path || this.config.dbPath || ':memory:');
      
      // Set performance optimizations
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 10000');
      this.db.pragma('temp_store = memory');
      
      if (this.config.enableOptimizer !== false) {
        this.db.pragma('optimize');
      }

      await this.createTables();
      await this.createIndexes();
      
      this.initialized = true;
      logger.info('SQLite analytics database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize SQLite database:', error);
      throw error;
    }
  }

  async createTables() {
    const createConstraintEvents = `
      CREATE TABLE IF NOT EXISTS constraint_events (
        uuid VARCHAR PRIMARY KEY,
        session_id VARCHAR,
        agent VARCHAR,
        event_type VARCHAR,
        constraint_id VARCHAR,
        violation_severity INTEGER,
        trajectory_score REAL,
        timestamp TIMESTAMP,
        resolution_pattern VARCHAR,
        content_length INTEGER,
        constraint_context TEXT,
        user_intent TEXT,
        intervention_applied BOOLEAN DEFAULT FALSE,
        intervention_successful BOOLEAN DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createViolationPatterns = `
      CREATE TABLE IF NOT EXISTS violation_patterns (
        pattern_id VARCHAR PRIMARY KEY,
        constraint_type VARCHAR,
        frequency INTEGER DEFAULT 1,
        success_rate REAL DEFAULT 0.0,
        avg_trajectory_score REAL,
        resolution_strategies TEXT[], -- Array of strategies
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createSessionMetrics = `
      CREATE TABLE IF NOT EXISTS session_metrics (
        session_id VARCHAR PRIMARY KEY,
        agent VARCHAR,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        total_events INTEGER DEFAULT 0,
        violation_count INTEGER DEFAULT 0,
        intervention_count INTEGER DEFAULT 0,
        compliance_score REAL DEFAULT 10.0,
        constraint_drift REAL DEFAULT 0.0, -- How much constraints changed
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await this.exec(createConstraintEvents);
    await this.exec(createViolationPatterns);  
    await this.exec(createSessionMetrics);
  }

  async createIndexes() {
    // Indexes for fast analytical queries
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_session_time ON constraint_events(session_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_constraint_type ON constraint_events(constraint_id, event_type)',
      'CREATE INDEX IF NOT EXISTS idx_violation_severity ON constraint_events(violation_severity, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_agent_events ON constraint_events(agent, event_type, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_trajectory_score ON constraint_events(trajectory_score, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_resolution_patterns ON constraint_events(resolution_pattern, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_session_compliance ON session_metrics(compliance_score, end_time)'
    ];

    for (const index of indexes) {
      await this.exec(index);
    }
  }

  async addConstraintEvent(eventData) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const query = `
        INSERT INTO constraint_events (
          uuid, session_id, agent, event_type, constraint_id,
          violation_severity, trajectory_score, timestamp,
          resolution_pattern, content_length, constraint_context,
          user_intent, intervention_applied
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (uuid) DO UPDATE SET
          violation_severity = excluded.violation_severity,
          trajectory_score = excluded.trajectory_score,
          resolution_pattern = excluded.resolution_pattern,
          intervention_applied = excluded.intervention_applied
      `;

      await this.exec(query, [
        eventData.uuid,
        eventData.sessionId,
        eventData.agent,
        eventData.eventType,
        eventData.constraintId,
        eventData.violationSeverity || 0,
        eventData.trajectoryScore || 10.0,
        new Date(eventData.timestamp),
        eventData.resolutionPattern,
        eventData.content?.length || 0,
        eventData.constraintContext,
        eventData.userIntent,
        eventData.interventionApplied || false
      ]);

      logger.debug(`Added constraint event to DuckDB: ${eventData.uuid}`);
    } catch (error) {
      logger.error('Failed to add constraint event to DuckDB:', error);
      throw error;
    }
  }

  async findViolationPatterns(constraintIds, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      limit = 10,
      minFrequency = 2,
      timeWindow = '7 days'
    } = options;

    try {
      const query = `
        SELECT 
          constraint_id,
          resolution_pattern,
          COUNT(*) as frequency,
          AVG(trajectory_score) as avg_success,
          AVG(CASE WHEN intervention_successful THEN 1.0 ELSE 0.0 END) as intervention_success_rate,
          MAX(timestamp) as last_occurrence,
          STRING_AGG(DISTINCT user_intent, ' | ') as common_intents
        FROM constraint_events 
        WHERE constraint_id = ANY($1)
          AND violation_severity > 0
          AND timestamp > NOW() - INTERVAL '${timeWindow}'
          AND resolution_pattern IS NOT NULL
        GROUP BY constraint_id, resolution_pattern
        HAVING COUNT(*) >= $2
        ORDER BY frequency DESC, avg_success DESC
        LIMIT $3
      `;

      const results = await this.all(query, [constraintIds, minFrequency, limit]);
      return results;
    } catch (error) {
      logger.error('Failed to find violation patterns:', error);
      throw error;
    }
  }

  async getSessionMetrics(sessionId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const query = `
        SELECT 
          COUNT(*) as total_events,
          COUNT(CASE WHEN violation_severity > 0 THEN 1 END) as violations,
          COUNT(CASE WHEN intervention_applied THEN 1 END) as interventions,
          AVG(trajectory_score) as avg_trajectory_score,
          MIN(timestamp) as session_start,
          MAX(timestamp) as session_end,
          STRING_AGG(DISTINCT constraint_id, ', ') as active_constraints
        FROM constraint_events
        WHERE session_id = ?
      `;

      const result = await this.get(query, [sessionId]);
      return result;
    } catch (error) {
      logger.error('Failed to get session metrics:', error);
      throw error;
    }
  }

  async getComplianceMetrics(timeWindow = '24 hours') {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const query = `
        SELECT 
          agent,
          COUNT(*) as total_events,
          COUNT(CASE WHEN violation_severity > 0 THEN 1 END) as violations,
          ROUND(AVG(trajectory_score), 2) as avg_trajectory_score,
          ROUND(
            (COUNT(*) - COUNT(CASE WHEN violation_severity > 0 THEN 1 END)) * 100.0 / COUNT(*), 
            2
          ) as compliance_percentage,
          COUNT(DISTINCT session_id) as active_sessions
        FROM constraint_events
        WHERE timestamp > NOW() - INTERVAL '${timeWindow}'
        GROUP BY agent
        ORDER BY compliance_percentage DESC
      `;

      const results = await this.all(query);
      return results;
    } catch (error) {
      logger.error('Failed to get compliance metrics:', error);
      throw error;
    }
  }

  async getTopViolations(limit = 10, timeWindow = '7 days') {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const query = `
        SELECT 
          constraint_id,
          COUNT(*) as frequency,
          AVG(violation_severity) as avg_severity,
          STRING_AGG(DISTINCT resolution_pattern, ' | ') as resolutions,
          MAX(timestamp) as last_occurrence
        FROM constraint_events
        WHERE violation_severity > 0
          AND timestamp > NOW() - INTERVAL '${timeWindow}'
        GROUP BY constraint_id
        ORDER BY frequency DESC, avg_severity DESC
        LIMIT ?
      `;

      const results = await this.all(query, [limit]);
      return results;
    } catch (error) {
      logger.error('Failed to get top violations:', error);
      throw error;
    }
  }

  // Helper methods for database operations
  async exec(query, params = []) {
    try {
      return this.db.exec(query);
    } catch (error) {
      logger.error('SQLite exec error:', error);
      throw error;
    }
  }

  async all(query, params = []) {
    try {
      const stmt = this.db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      logger.error('SQLite all error:', error);
      throw error;
    }
  }

  async get(query, params = []) {
    try {
      const stmt = this.db.prepare(query);
      return stmt.get(...params);
    } catch (error) {
      logger.error('SQLite get error:', error);
      throw error;
    }
  }

  async cleanup(retentionDays = 30) {
    try {
      const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
      
      await this.exec(`
        DELETE FROM constraint_events 
        WHERE timestamp < ? AND violation_severity = 0
      `, [cutoffDate]);

      // Keep violations longer for pattern analysis
      await this.exec(`
        DELETE FROM constraint_events 
        WHERE timestamp < ? AND violation_severity > 0
      `, [new Date(Date.now() - (90 * 24 * 60 * 60 * 1000))]);

      logger.info('Cleaned up old analytical data');
    } catch (error) {
      logger.warn('Failed to cleanup old analytical data:', error);
    }
  }

  async close() {
    if (this.db) {
      this.db.close();
    }
    this.initialized = false;
    logger.info('SQLite database closed');
  }
}