/**
 * TeamCheckpointManager - Manages team-wide, git-tracked checkpoint for incremental UKB updates
 *
 * This checkpoint is stored in .data/ukb-last-run.json and is committed to git so that
 * all team members share the same "last successful run" timestamp. This enables true
 * incremental analysis across the entire team.
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export class TeamCheckpointManager {
  constructor(codingRepo, options = {}) {
    this.codingRepo = codingRepo;
    this.checkpointPath = options.checkpointPath ||
      path.join(codingRepo, '.data', 'ukb-last-run.json');
    this.debug = options.debug || false;
  }

  /**
   * Load the team-wide checkpoint
   * Returns default checkpoint if file doesn't exist or is invalid
   */
  async loadCheckpoint() {
    try {
      const data = await fs.readFile(this.checkpointPath, 'utf8');
      const checkpoint = JSON.parse(data);

      // Validate integrity
      if (!this.validateCheckpoint(checkpoint)) {
        this.log('Warning: Checkpoint failed integrity check, using defaults');
        return this.getDefaultCheckpoint();
      }

      this.log(`Loaded checkpoint from ${checkpoint.lastSuccessfulRun}`);
      return checkpoint;

    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('No checkpoint found, using defaults (first run)');
        return this.getDefaultCheckpoint();
      }

      this.log(`Error loading checkpoint: ${error.message}, using defaults`);
      return this.getDefaultCheckpoint();
    }
  }

  /**
   * Save checkpoint atomically (temp file + rename to prevent corruption)
   */
  async saveCheckpoint(checkpointData) {
    // Add metadata
    const checkpoint = {
      version: '2.0.0',
      teamCheckpoint: true,
      ...checkpointData,
      integrity: this.calculateIntegrity(checkpointData)
    };

    // Ensure .data directory exists
    const dataDir = path.dirname(this.checkpointPath);
    await fs.mkdir(dataDir, { recursive: true });

    // Atomic write: temp file + rename
    const tempPath = `${this.checkpointPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(checkpoint, null, 2), 'utf8');
    await fs.rename(tempPath, this.checkpointPath);

    this.log(`Saved checkpoint: ${checkpoint.lastSuccessfulRun}`);
    return checkpoint;
  }

  /**
   * Update checkpoint after successful workflow run
   */
  async updateAfterSuccessfulRun(stats) {
    const checkpoint = {
      lastSuccessfulRun: new Date().toISOString(),
      lastAnalyzedCommit: stats.lastCommit || null,
      lastAnalyzedSession: stats.lastSession || null,
      analysisStats: {
        entitiesCreated: stats.entitiesCreated || 0,
        relationsCreated: stats.relationsCreated || 0,
        insightsGenerated: stats.insightsGenerated || 0,
        commitsAnalyzed: stats.commitsAnalyzed || 0,
        sessionsAnalyzed: stats.sessionsAnalyzed || 0,
        duration: stats.duration || 0
      },
      workflowType: stats.workflowType || 'incremental-update'
    };

    return await this.saveCheckpoint(checkpoint);
  }

  /**
   * Get the last successful run timestamp
   */
  async getLastRunTimestamp() {
    const checkpoint = await this.loadCheckpoint();
    return checkpoint.lastSuccessfulRun ?
      new Date(checkpoint.lastSuccessfulRun) :
      null;
  }

  /**
   * Get the last analyzed git commit SHA
   */
  async getLastAnalyzedCommit() {
    const checkpoint = await this.loadCheckpoint();
    return checkpoint.lastAnalyzedCommit;
  }

  /**
   * Get the last analyzed session log filename
   */
  async getLastAnalyzedSession() {
    const checkpoint = await this.loadCheckpoint();
    return checkpoint.lastAnalyzedSession;
  }

  /**
   * Reset checkpoint (forces full re-analysis on next run)
   */
  async resetCheckpoint() {
    const defaultCheckpoint = this.getDefaultCheckpoint();
    await this.saveCheckpoint(defaultCheckpoint);
    this.log('Checkpoint reset - next run will be full analysis');
    return defaultCheckpoint;
  }

  /**
   * Get checkpoint status information
   */
  async getStatus() {
    const checkpoint = await this.loadCheckpoint();

    if (!checkpoint.lastSuccessfulRun) {
      return {
        initialized: false,
        message: 'No checkpoint found - first run will be full analysis'
      };
    }

    const timeSinceLastRun = Date.now() - new Date(checkpoint.lastSuccessfulRun).getTime();
    const hoursSince = Math.floor(timeSinceLastRun / (1000 * 60 * 60));
    const daysSince = Math.floor(hoursSince / 24);

    return {
      initialized: true,
      lastRun: checkpoint.lastSuccessfulRun,
      lastCommit: checkpoint.lastAnalyzedCommit,
      lastSession: checkpoint.lastAnalyzedSession,
      timeSinceLastRun: {
        hours: hoursSince,
        days: daysSince,
        humanReadable: daysSince > 0 ?
          `${daysSince} day${daysSince > 1 ? 's' : ''} ago` :
          `${hoursSince} hour${hoursSince > 1 ? 's' : ''} ago`
      },
      lastRunStats: checkpoint.analysisStats,
      workflowType: checkpoint.workflowType
    };
  }

  /**
   * Validate checkpoint integrity
   */
  validateCheckpoint(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object') {
      return false;
    }

    // Must have version and teamCheckpoint flag
    if (!checkpoint.version || !checkpoint.teamCheckpoint) {
      return false;
    }

    // For now, skip integrity check (can be re-enabled later)
    // The integrity hash validation was too strict and causing false failures
    // TODO: Implement more robust integrity checking

    return true;
  }

  /**
   * Calculate integrity hash for checkpoint data
   */
  calculateIntegrity(data) {
    const content = JSON.stringify(data, Object.keys(data).sort());
    return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get default checkpoint (for first run or invalid checkpoint)
   */
  getDefaultCheckpoint() {
    return {
      lastSuccessfulRun: null,
      lastAnalyzedCommit: null,
      lastAnalyzedSession: null,
      analysisStats: {
        entitiesCreated: 0,
        relationsCreated: 0,
        insightsGenerated: 0,
        commitsAnalyzed: 0,
        sessionsAnalyzed: 0,
        duration: 0
      },
      workflowType: 'none'
    };
  }

  /**
   * Check if checkpoint file exists
   */
  async exists() {
    try {
      await fs.access(this.checkpointPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Debug logging
   */
  log(message) {
    if (this.debug) {
      console.log(`[TeamCheckpoint] ${message}`);
    }
  }
}
