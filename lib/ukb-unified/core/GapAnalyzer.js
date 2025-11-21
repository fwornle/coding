/**
 * GapAnalyzer - Determines what needs analysis since last checkpoint
 *
 * Analyzes git commits and session logs to identify the "gap" between the last
 * successful UKB run and now. This enables efficient incremental updates.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GapAnalyzer {
  constructor(codingRepo, options = {}) {
    this.codingRepo = codingRepo;
    this.debug = options.debug || false;
  }

  /**
   * Generate complete analysis scope for incremental run
   * Returns object describing what needs to be analyzed
   */
  async generateIncrementalScope(checkpoint) {
    const scope = {
      isEmpty: () => scope.commits.length === 0 && scope.sessions.length === 0,
      commits: [],
      sessions: [],
      hasChanges: false,
      sinceTimestamp: checkpoint.lastSuccessfulRun ?
        new Date(checkpoint.lastSuccessfulRun) :
        null,
      sinceCommit: checkpoint.lastAnalyzedCommit,
      sinceSession: checkpoint.lastAnalyzedSession
    };

    // If no checkpoint, return empty scope (full analysis will be triggered differently)
    if (!checkpoint.lastSuccessfulRun) {
      this.log('No previous run found - scope is empty (will trigger full analysis)');
      return scope;
    }

    // Get new commits
    scope.commits = await this.getNewCommits(checkpoint.lastAnalyzedCommit);
    this.log(`Found ${scope.commits.length} new commits`);

    // Get new session logs
    scope.sessions = await this.getNewSessionLogs(
      new Date(checkpoint.lastSuccessfulRun)
    );
    this.log(`Found ${scope.sessions.length} new session logs`);

    // Check for other significant changes
    scope.hasChanges = scope.commits.length > 0 || scope.sessions.length > 0;

    return scope;
  }

  /**
   * Get new git commits since the specified commit SHA
   * If sinceCommit is null, returns recent commits (for first run)
   */
  async getNewCommits(sinceCommit) {
    try {
      let gitCommand;

      if (sinceCommit) {
        // Get commits since the specified commit
        gitCommand = `git log ${sinceCommit}..HEAD --pretty=format:'%H|%an|%ae|%at|%s' --no-merges`;
      } else {
        // First run: get last 100 commits as a reasonable starting point
        gitCommand = `git log -100 --pretty=format:'%H|%an|%ae|%at|%s' --no-merges`;
      }

      const { stdout } = await execAsync(gitCommand, { cwd: this.codingRepo });

      if (!stdout.trim()) {
        return [];
      }

      return stdout.trim().split('\n').map(line => {
        const [sha, author, email, timestamp, ...messageParts] = line.split('|');
        return {
          sha,
          author,
          email,
          timestamp: parseInt(timestamp) * 1000, // Convert to ms
          date: new Date(parseInt(timestamp) * 1000),
          message: messageParts.join('|')
        };
      });

    } catch (error) {
      this.log(`Error getting git commits: ${error.message}`);
      return [];
    }
  }

  /**
   * Get new session log files since the specified timestamp
   * Looks in both local .specstory/history and coding/.specstory/history (cross-project logs)
   */
  async getNewSessionLogs(sinceTimestamp) {
    const sessions = [];

    // Paths to check
    const localHistoryPath = path.join(this.codingRepo, '.specstory', 'history');

    try {
      // Get all .md files in history directory
      const files = await fs.readdir(localHistoryPath);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      for (const filename of mdFiles) {
        const filePath = path.join(localHistoryPath, filename);

        // Get file stats
        const stats = await fs.stat(filePath);

        // Check if created/modified after checkpoint
        if (sinceTimestamp && stats.mtime > sinceTimestamp) {
          sessions.push({
            filename,
            path: filePath,
            created: stats.birthtime,
            modified: stats.mtime,
            size: stats.size,
            // Parse session info from filename: YYYY-MM-DD_HHMM-HHMM_hash[_from-project].md
            ...this.parseSessionFilename(filename)
          });
        } else if (!sinceTimestamp) {
          // No checkpoint: include all recent sessions (last 30 days as default)
          const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
          if (stats.mtime.getTime() > thirtyDaysAgo) {
            sessions.push({
              filename,
              path: filePath,
              created: stats.birthtime,
              modified: stats.mtime,
              size: stats.size,
              ...this.parseSessionFilename(filename)
            });
          }
        }
      }

      // Sort by date (oldest first for chronological analysis)
      sessions.sort((a, b) => a.modified.getTime() - b.modified.getTime());

    } catch (error) {
      this.log(`Error scanning session logs: ${error.message}`);
    }

    return sessions;
  }

  /**
   * Parse session filename to extract metadata
   * Format: YYYY-MM-DD_HHMM-HHMM_hash[_from-project].md
   */
  parseSessionFilename(filename) {
    const match = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})-(\d{4})_([^_]+)(?:_from-(.+))?\.md$/);

    if (!match) {
      return { isValid: false };
    }

    const [, date, startTime, endTime, userHash, sourceProject] = match;

    return {
      isValid: true,
      date,
      startTime,
      endTime,
      userHash,
      sourceProject: sourceProject || null, // null means local session, not redirected
      isRedirected: !!sourceProject
    };
  }

  /**
   * Check if there are significant changes in the repository
   * (This is a helper method for more sophisticated gap detection)
   */
  async hasSignificantChanges(sinceTimestamp) {
    if (!sinceTimestamp) return true; // First run is always significant

    // Check for new commits
    const commits = await this.getNewCommits(null);
    const newCommits = commits.filter(c => c.timestamp > sinceTimestamp.getTime());

    if (newCommits.length > 0) {
      return true;
    }

    // Check for new session logs
    const sessions = await this.getNewSessionLogs(sinceTimestamp);

    return sessions.length > 0;
  }

  /**
   * Get summary of the gap for display purposes
   */
  async getGapSummary(checkpoint) {
    const scope = await this.generateIncrementalScope(checkpoint);

    if (scope.isEmpty()) {
      return {
        hasGap: false,
        message: 'Knowledge base is up to date - no new content to analyze'
      };
    }

    const summary = {
      hasGap: true,
      commits: {
        count: scope.commits.length,
        first: scope.commits[0]?.sha.substring(0, 7),
        last: scope.commits[scope.commits.length - 1]?.sha.substring(0, 7),
        dateRange: scope.commits.length > 0 ? {
          start: scope.commits[0].date.toISOString(),
          end: scope.commits[scope.commits.length - 1].date.toISOString()
        } : null
      },
      sessions: {
        count: scope.sessions.length,
        first: scope.sessions[0]?.filename,
        last: scope.sessions[scope.sessions.length - 1]?.filename,
        redirected: scope.sessions.filter(s => s.isRedirected).length,
        local: scope.sessions.filter(s => !s.isRedirected).length
      },
      sinceLastRun: checkpoint.lastSuccessfulRun ?
        this.getTimeSinceString(new Date(checkpoint.lastSuccessfulRun)) :
        'never'
    };

    return summary;
  }

  /**
   * Get human-readable time since string
   */
  getTimeSinceString(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;

    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  /**
   * Debug logging
   */
  log(message) {
    if (this.debug) {
      console.log(`[GapAnalyzer] ${message}`);
    }
  }
}
