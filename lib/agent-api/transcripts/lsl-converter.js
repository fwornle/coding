/**
 * LSL Converter - Core Live Session Logging format conversion
 *
 * Provides utilities for converting between agent-specific transcript
 * formats and the unified LSL (Live Session Logging) format.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { createLogger } from '../../logging/Logger.js';
import { LSLEntryType } from '../transcript-api.js';

const logger = createLogger('lsl-converter');

/**
 * @typedef {Object} LSLMetadata
 * @property {string} agent - Agent type ('claude', 'copilot')
 * @property {string} sessionId - Unique session identifier
 * @property {string} projectPath - Path to the project being worked on
 * @property {string} startTime - ISO timestamp of session start
 * @property {string} [endTime] - ISO timestamp of session end
 * @property {string} userHash - Hash of the user identifier
 * @property {string} [timeWindow] - Time window identifier (e.g., '0800-0900')
 */

/**
 * @typedef {Object} LSLEntry
 * @property {string} type - Entry type (user, assistant, tool_use, tool_result, system, error)
 * @property {string} timestamp - ISO timestamp
 * @property {string} content - Entry content
 * @property {Object} [metadata] - Additional metadata
 * @property {Object} [tool] - Tool information
 */

/**
 * @typedef {Object} LSLSession
 * @property {LSLMetadata} metadata - Session metadata
 * @property {LSLEntry[]} entries - Session entries
 */

/**
 * LSL Converter class
 */
class LSLConverter {
  constructor(options = {}) {
    this.options = {
      includeToolResults: options.includeToolResults !== false,
      maxContentLength: options.maxContentLength || 10000,
      redactSecrets: options.redactSecrets !== false,
      ...options
    };
  }

  /**
   * Convert a session to LSL markdown format
   * @param {LSLSession} session - Session to convert
   * @returns {string}
   */
  toMarkdown(session) {
    const lines = [];

    // Header
    lines.push(`# Session Log`);
    lines.push('');
    lines.push(`**Agent:** ${session.metadata.agent}`);
    lines.push(`**Session ID:** ${session.metadata.sessionId}`);
    lines.push(`**Project:** ${session.metadata.projectPath}`);
    lines.push(`**Started:** ${session.metadata.startTime}`);

    if (session.metadata.endTime) {
      lines.push(`**Ended:** ${session.metadata.endTime}`);
    }

    if (session.metadata.timeWindow) {
      lines.push(`**Time Window:** ${session.metadata.timeWindow}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');

    // Entries
    for (const entry of session.entries) {
      lines.push(this.entryToMarkdown(entry));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Convert a single entry to markdown
   * @param {LSLEntry} entry
   * @returns {string}
   */
  entryToMarkdown(entry) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const lines = [];

    switch (entry.type) {
      case LSLEntryType.USER:
        lines.push(`## [${time}] User`);
        lines.push('');
        lines.push(this.truncateContent(entry.content));
        break;

      case LSLEntryType.ASSISTANT:
        lines.push(`## [${time}] Assistant`);
        lines.push('');
        lines.push(this.truncateContent(entry.content));
        break;

      case LSLEntryType.TOOL_USE:
        lines.push(`### [${time}] Tool: ${entry.tool?.name || 'unknown'}`);
        lines.push('');
        lines.push('**Input:**');
        lines.push('```json');
        lines.push(this.formatJSON(entry.tool?.input));
        lines.push('```');
        break;

      case LSLEntryType.TOOL_RESULT:
        if (!this.options.includeToolResults) {
          return '';
        }
        lines.push(`### [${time}] Result: ${entry.tool?.name || 'unknown'}`);
        lines.push('');
        lines.push('```');
        lines.push(this.truncateContent(
          typeof entry.tool?.output === 'string' ?
            entry.tool.output :
            JSON.stringify(entry.tool?.output, null, 2)
        ));
        lines.push('```');
        break;

      case LSLEntryType.SYSTEM:
        lines.push(`> [${time}] **System:** ${entry.content}`);
        break;

      case LSLEntryType.ERROR:
        lines.push(`> [${time}] ⚠️ **Error:** ${entry.content}`);
        break;

      default:
        lines.push(`> [${time}] ${entry.type}: ${entry.content}`);
    }

    return lines.join('\n');
  }

  /**
   * Convert a session to JSON-Lines format
   * @param {LSLSession} session
   * @returns {string}
   */
  toJSONL(session) {
    const lines = [];

    // Write metadata as first line
    lines.push(JSON.stringify({
      type: 'metadata',
      ...session.metadata
    }));

    // Write entries
    for (const entry of session.entries) {
      lines.push(JSON.stringify(entry));
    }

    return lines.join('\n');
  }

  /**
   * Parse JSON-Lines format to session
   * @param {string} content - JSONL content
   * @returns {LSLSession}
   */
  fromJSONL(content) {
    const lines = content.trim().split('\n').filter(l => l.trim());
    let metadata = null;
    const entries = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        if (parsed.type === 'metadata') {
          metadata = parsed;
        } else {
          entries.push(parsed);
        }
      } catch {
        logger.warn('Failed to parse JSONL line');
      }
    }

    return {
      metadata: metadata || {
        agent: 'unknown',
        sessionId: 'unknown',
        projectPath: process.cwd(),
        startTime: new Date().toISOString(),
        userHash: 'unknown'
      },
      entries
    };
  }

  /**
   * Convert Claude transcript entry to LSL format
   * @param {Object} claudeEntry - Claude-format entry
   * @returns {LSLEntry|LSLEntry[]|null}
   */
  fromClaudeEntry(claudeEntry) {
    if (!claudeEntry || !claudeEntry.type) {
      return null;
    }

    const timestamp = claudeEntry.timestamp || new Date().toISOString();

    switch (claudeEntry.type) {
      case 'user':
        return {
          type: LSLEntryType.USER,
          timestamp,
          content: this.extractClaudeContent(claudeEntry.message?.content)
        };

      case 'assistant': {
        const content = this.extractClaudeContent(claudeEntry.message?.content);
        const toolCalls = this.extractClaudeToolCalls(claudeEntry.message?.content);

        const entries = [];

        if (content) {
          entries.push({
            type: LSLEntryType.ASSISTANT,
            timestamp,
            content
          });
        }

        for (const tool of toolCalls) {
          entries.push({
            type: LSLEntryType.TOOL_USE,
            timestamp,
            content: `Tool: ${tool.name}`,
            tool: {
              name: tool.name,
              input: tool.input
            }
          });
        }

        return entries.length === 1 ? entries[0] : entries;
      }

      case 'tool_result':
        return {
          type: LSLEntryType.TOOL_RESULT,
          timestamp,
          content: 'Tool result',
          tool: {
            name: claudeEntry.tool_use_id || 'unknown',
            output: this.extractClaudeContent(claudeEntry.content)
          }
        };

      default:
        return null;
    }
  }

  /**
   * Convert Copilot (copi) log entry to LSL format
   * @param {Object} copiEntry - Copi-format entry
   * @returns {LSLEntry|null}
   */
  fromCopiEntry(copiEntry) {
    if (!copiEntry || !copiEntry.type) {
      return null;
    }

    const timestamp = copiEntry.timestamp || new Date().toISOString();

    switch (copiEntry.type) {
      case 'user_input':
      case 'prompt':
        return {
          type: LSLEntryType.USER,
          timestamp,
          content: copiEntry.content || copiEntry.text || ''
        };

      case 'response':
      case 'assistant':
        return {
          type: LSLEntryType.ASSISTANT,
          timestamp,
          content: copiEntry.content || copiEntry.text || ''
        };

      case 'tool_call':
      case 'command':
        return {
          type: LSLEntryType.TOOL_USE,
          timestamp,
          content: `Tool: ${copiEntry.name || copiEntry.command || 'unknown'}`,
          tool: {
            name: copiEntry.name || copiEntry.command || 'unknown',
            input: copiEntry.args || copiEntry.input || {}
          }
        };

      case 'tool_result':
      case 'output':
        return {
          type: LSLEntryType.TOOL_RESULT,
          timestamp,
          content: 'Result',
          tool: {
            name: copiEntry.tool || 'unknown',
            output: copiEntry.result || copiEntry.output || ''
          }
        };

      case 'error':
        return {
          type: LSLEntryType.ERROR,
          timestamp,
          content: copiEntry.message || copiEntry.error || 'Unknown error'
        };

      default:
        return null;
    }
  }

  /**
   * Extract text content from Claude message content
   */
  extractClaudeContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
      return content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');
    }

    return '';
  }

  /**
   * Extract tool calls from Claude message content
   */
  extractClaudeToolCalls(content) {
    if (!content || !Array.isArray(content)) return [];

    return content
      .filter(item => item.type === 'tool_use')
      .map(item => ({
        name: item.name,
        input: item.input,
        id: item.id
      }));
  }

  /**
   * Truncate content to max length
   */
  truncateContent(content) {
    if (!content) return '';
    if (content.length <= this.options.maxContentLength) return content;

    return content.substring(0, this.options.maxContentLength) +
      `\n\n... (truncated, ${content.length - this.options.maxContentLength} chars omitted)`;
  }

  /**
   * Format JSON for display
   */
  formatJSON(obj) {
    try {
      const json = JSON.stringify(obj, null, 2);
      return this.truncateContent(json);
    } catch {
      return String(obj);
    }
  }

  /**
   * Generate session statistics
   */
  getStats(session) {
    const stats = {
      entryCount: session.entries.length,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      errors: 0,
      duration: null,
      toolsUsed: new Set()
    };

    for (const entry of session.entries) {
      switch (entry.type) {
        case LSLEntryType.USER:
          stats.userMessages++;
          break;
        case LSLEntryType.ASSISTANT:
          stats.assistantMessages++;
          break;
        case LSLEntryType.TOOL_USE:
          stats.toolCalls++;
          if (entry.tool?.name) {
            stats.toolsUsed.add(entry.tool.name);
          }
          break;
        case LSLEntryType.TOOL_RESULT:
          stats.toolResults++;
          break;
        case LSLEntryType.ERROR:
          stats.errors++;
          break;
      }
    }

    if (session.metadata.startTime) {
      const start = new Date(session.metadata.startTime);
      const end = session.metadata.endTime ?
        new Date(session.metadata.endTime) :
        new Date();
      stats.duration = end.getTime() - start.getTime();
    }

    stats.toolsUsed = Array.from(stats.toolsUsed);
    return stats;
  }
}

/**
 * Create an LSL converter instance
 */
function createConverter(options = {}) {
  return new LSLConverter(options);
}

export { LSLConverter, createConverter };
export default LSLConverter;
