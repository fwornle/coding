/**
 * Claude Parser - Parse Claude Code transcripts
 *
 * Handles parsing of Claude Code transcript files from:
 * ~/.claude/projects/<project>/conversation.jsonl
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../../logging/Logger.js';
import { LSLConverter } from './lsl-converter.js';
import { LSLEntryType } from '../transcript-api.js';

const logger = createLogger('claude-parser');

/**
 * Claude Transcript Parser
 */
class ClaudeParser {
  constructor(options = {}) {
    this.options = {
      projectPath: options.projectPath || process.cwd(),
      maxSessionAge: options.maxSessionAge || 7200000, // 2 hours
      includeToolResults: options.includeToolResults !== false,
      ...options
    };

    this.converter = new LSLConverter(options);
  }

  /**
   * Get the Claude transcript directory for a project
   * @param {string} [projectPath] - Project path (optional)
   * @returns {string}
   */
  getTranscriptDirectory(projectPath) {
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    const project = projectPath || this.options.projectPath;

    // Convert project path to Claude's directory name format
    // Claude uses: -/path/to/project -> --path-to-project
    const dirName = `-${project.replace(/[^a-zA-Z0-9]/g, '-')}`;

    return path.join(baseDir, dirName);
  }

  /**
   * List all available transcript files
   * @param {Object} [options]
   * @param {string} [options.projectPath] - Project path
   * @param {number} [options.limit] - Max number of files
   * @param {boolean} [options.sortNewest=true] - Sort newest first
   * @returns {Promise<Array<{path: string, mtime: Date, size: number}>>}
   */
  async listTranscripts(options = {}) {
    const transcriptDir = this.getTranscriptDirectory(options.projectPath);

    if (!fsSync.existsSync(transcriptDir)) {
      logger.debug(`Transcript directory not found: ${transcriptDir}`);
      return [];
    }

    try {
      const files = await fs.readdir(transcriptDir);
      const transcripts = [];

      for (const file of files) {
        if (!file.endsWith('.jsonl')) {
          continue;
        }

        const filePath = path.join(transcriptDir, file);
        const stats = await fs.stat(filePath);

        transcripts.push({
          path: filePath,
          name: file,
          sessionId: file.replace('.jsonl', ''),
          mtime: stats.mtime,
          size: stats.size
        });
      }

      // Sort by modification time
      transcripts.sort((a, b) => {
        const order = options.sortNewest === false ? 1 : -1;
        return order * (b.mtime.getTime() - a.mtime.getTime());
      });

      // Apply limit
      if (options.limit && options.limit > 0) {
        transcripts.splice(options.limit);
      }

      return transcripts;
    } catch (error) {
      logger.error('Failed to list transcripts', { error: error.message });
      return [];
    }
  }

  /**
   * Find the current (most recent active) transcript
   * @returns {Promise<string|null>}
   */
  async findCurrentTranscript() {
    const transcripts = await this.listTranscripts({ limit: 1 });

    if (transcripts.length === 0) {
      return null;
    }

    const mostRecent = transcripts[0];
    const age = Date.now() - mostRecent.mtime.getTime();

    // Only return if session is recent
    if (age > this.options.maxSessionAge) {
      logger.debug(`Most recent transcript too old: ${age}ms`);
      return null;
    }

    return mostRecent.path;
  }

  /**
   * Parse a single transcript file
   * @param {string} filePath - Path to transcript file
   * @returns {Promise<import('../transcript-api.js').LSLSession>}
   */
  async parseFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    const sessionId = path.basename(filePath, '.jsonl');
    const entries = [];
    let startTime = null;
    let endTime = null;

    for (const line of lines) {
      try {
        const claudeEntry = JSON.parse(line);
        const lslEntry = this.converter.fromClaudeEntry(claudeEntry);

        if (!lslEntry) {
          continue;
        }

        // Handle array of entries (e.g., assistant with tool calls)
        const entryList = Array.isArray(lslEntry) ? lslEntry : [lslEntry];

        for (const entry of entryList) {
          entries.push(entry);

          if (!startTime) {
            startTime = entry.timestamp;
          }
          endTime = entry.timestamp;
        }
      } catch (error) {
        logger.debug(`Failed to parse line: ${error.message}`);
      }
    }

    return {
      metadata: {
        agent: 'claude',
        sessionId,
        projectPath: this.options.projectPath,
        startTime: startTime || new Date().toISOString(),
        endTime,
        userHash: process.env.USER || 'unknown'
      },
      entries
    };
  }

  /**
   * Parse multiple transcript files
   * @param {Object} [options]
   * @param {string} [options.projectPath]
   * @param {number} [options.limit]
   * @param {Date|string} [options.since]
   * @param {Date|string} [options.until]
   * @returns {Promise<import('../transcript-api.js').LSLSession[]>}
   */
  async parseMultiple(options = {}) {
    const transcripts = await this.listTranscripts(options);
    const sessions = [];

    for (const transcript of transcripts) {
      // Filter by time range
      if (options.since) {
        const since = new Date(options.since);
        if (transcript.mtime < since) {
          continue;
        }
      }

      if (options.until) {
        const until = new Date(options.until);
        if (transcript.mtime > until) {
          continue;
        }
      }

      try {
        const session = await this.parseFile(transcript.path);
        sessions.push(session);
      } catch (error) {
        logger.error(`Failed to parse transcript: ${transcript.path}`, {
          error: error.message
        });
      }
    }

    return sessions;
  }

  /**
   * Stream parse a transcript file (for large files)
   * @param {string} filePath - Path to transcript file
   * @param {function(Object): void} onEntry - Callback for each entry
   * @returns {Promise<void>}
   */
  async streamParse(filePath, onEntry) {
    const readline = await import('readline');
    const fileStream = fsSync.createReadStream(filePath);

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const claudeEntry = JSON.parse(line);
        const lslEntry = this.converter.fromClaudeEntry(claudeEntry);

        if (lslEntry) {
          const entries = Array.isArray(lslEntry) ? lslEntry : [lslEntry];
          for (const entry of entries) {
            await onEntry(entry);
          }
        }
      } catch (error) {
        logger.debug(`Failed to parse streaming line: ${error.message}`);
      }
    }
  }

  /**
   * Watch a transcript file for new entries
   * @param {string} filePath - Path to transcript file
   * @param {function(Object): void} onEntry - Callback for new entries
   * @returns {Promise<{stop: function}>}
   */
  async watchFile(filePath, onEntry) {
    let lastSize = 0;
    let isWatching = true;

    // Get initial size
    try {
      const stats = await fs.stat(filePath);
      lastSize = stats.size;
    } catch {
      lastSize = 0;
    }

    const checkInterval = setInterval(async () => {
      if (!isWatching) {
        return;
      }

      try {
        const stats = await fs.stat(filePath);

        if (stats.size <= lastSize) {
          return;
        }

        // Read new content
        const fd = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(stats.size - lastSize);
        await fd.read(buffer, 0, buffer.length, lastSize);
        await fd.close();

        lastSize = stats.size;

        // Parse new lines
        const newContent = buffer.toString('utf8');
        const lines = newContent.trim().split('\n');

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          try {
            const claudeEntry = JSON.parse(line);
            const lslEntry = this.converter.fromClaudeEntry(claudeEntry);

            if (lslEntry) {
              const entries = Array.isArray(lslEntry) ? lslEntry : [lslEntry];
              for (const entry of entries) {
                await onEntry(entry);
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
      } catch (error) {
        logger.debug(`Watch check error: ${error.message}`);
      }
    }, 1000);

    return {
      stop: () => {
        isWatching = false;
        clearInterval(checkInterval);
      }
    };
  }
}

/**
 * Create a Claude parser instance
 */
function createClaudeParser(options = {}) {
  return new ClaudeParser(options);
}

export { ClaudeParser, createClaudeParser };
export default ClaudeParser;
