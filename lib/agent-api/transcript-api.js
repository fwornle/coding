/**
 * Transcript API - Interface for agent transcript/session log adapters
 *
 * Provides a unified abstraction for reading and converting transcripts
 * from different agent formats into the LSL (Live Session Logging) format.
 *
 * Supported formats:
 * - Claude Code: ~/.claude/projects/<project>/conversation.jsonl
 * - Copilot CLI: Session logs from copi (JSON-Lines format)
 */

import { createLogger } from '../logging/Logger.js';

const logger = createLogger('transcript-api');

/**
 * Unified LSL entry types
 * @enum {string}
 */
const LSLEntryType = {
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result',
  SYSTEM: 'system',
  ERROR: 'error'
};

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
 * @property {LSLEntryType} type - Entry type
 * @property {string} timestamp - ISO timestamp
 * @property {string} content - Entry content (text or JSON string)
 * @property {Object} [metadata] - Additional metadata
 * @property {Object} [tool] - Tool information (for tool_use/tool_result)
 * @property {string} [tool.name] - Tool name
 * @property {Object} [tool.input] - Tool input
 * @property {Object} [tool.output] - Tool output
 */

/**
 * @typedef {Object} LSLSession
 * @property {LSLMetadata} metadata - Session metadata
 * @property {LSLEntry[]} entries - Session entries
 */

/**
 * @typedef {Object} TranscriptReadOptions
 * @property {string} [sessionId] - Specific session to read
 * @property {string} [projectPath] - Filter by project path
 * @property {Date|string} [since] - Read entries since this time
 * @property {Date|string} [until] - Read entries until this time
 * @property {number} [limit] - Maximum number of entries to return
 * @property {number} [offset] - Number of entries to skip
 * @property {boolean} [includeToolResults=true] - Include tool results
 */

/**
 * @typedef {Object} TranscriptConfig
 * @property {string} [transcriptDir] - Directory containing transcripts
 * @property {string} [outputDir] - Directory for LSL output
 * @property {boolean} [enableCache=true] - Enable transcript caching
 * @property {number} [cacheTimeout=10000] - Cache timeout in milliseconds
 */

/**
 * @callback TranscriptWatchCallback
 * @param {LSLEntry} entry - New entry received
 * @param {LSLMetadata} metadata - Session metadata
 */

/**
 * Abstract base class for transcript adapters
 * Implement this class to provide agent-specific transcript functionality
 */
class TranscriptAdapter {
  /**
   * @param {TranscriptConfig} config - Adapter configuration
   */
  constructor(config = {}) {
    if (new.target === TranscriptAdapter) {
      throw new Error('TranscriptAdapter is abstract and cannot be instantiated directly');
    }

    this.config = {
      enableCache: true,
      cacheTimeout: 10000,
      ...config
    };

    /** @type {Map<string, LSLSession>} */
    this.sessionCache = new Map();

    /** @type {Map<string, number>} */
    this.cacheTimestamps = new Map();

    /** @type {Set<TranscriptWatchCallback>} */
    this.watchers = new Set();

    this.watchInterval = null;
  }

  // ============================================
  // Abstract Methods - MUST be implemented
  // ============================================

  /**
   * Get the agent type this adapter handles
   * @returns {string} Agent type ('claude', 'copilot', etc.)
   * @abstract
   */
  getAgentType() {
    throw new Error('getAgentType() must be implemented by subclass');
  }

  /**
   * Get the path to the transcript directory for this agent
   * @param {string} [projectPath] - Optional project path
   * @returns {string} Transcript directory path
   * @abstract
   */
  getTranscriptDirectory(projectPath) {
    throw new Error('getTranscriptDirectory() must be implemented by subclass');
  }

  /**
   * Read transcripts from the agent's native format
   * @param {TranscriptReadOptions} options - Read options
   * @returns {Promise<LSLSession[]>}
   * @abstract
   */
  async readTranscripts(options = {}) {
    throw new Error('readTranscripts() must be implemented by subclass');
  }

  /**
   * Convert a single entry from agent-native format to LSL format
   * @param {Object} nativeEntry - Entry in agent-native format
   * @returns {LSLEntry}
   * @abstract
   */
  convertToLSL(nativeEntry) {
    throw new Error('convertToLSL() must be implemented by subclass');
  }

  /**
   * Get the current session being recorded
   * @returns {Promise<LSLSession|null>}
   * @abstract
   */
  async getCurrentSession() {
    throw new Error('getCurrentSession() must be implemented by subclass');
  }

  // ============================================
  // Common Methods - CAN be overridden
  // ============================================

  /**
   * Start watching for new transcript entries
   * @param {TranscriptWatchCallback} callback - Callback for new entries
   * @param {Object} [options] - Watch options
   * @param {number} [options.interval=1000] - Poll interval in milliseconds
   * @returns {Promise<void>}
   */
  async watchTranscripts(callback, options = {}) {
    const interval = options.interval || 1000;

    this.watchers.add(callback);

    if (this.watchInterval) {
      // Already watching
      return;
    }

    let lastEntryCount = 0;

    this.watchInterval = setInterval(async () => {
      try {
        const session = await this.getCurrentSession();

        if (!session || !session.entries) {
          return;
        }

        const newEntries = session.entries.slice(lastEntryCount);
        lastEntryCount = session.entries.length;

        for (const entry of newEntries) {
          for (const watcher of this.watchers) {
            try {
              await watcher(entry, session.metadata);
            } catch (error) {
              logger.error('Watcher callback error', { error: error.message });
            }
          }
        }
      } catch (error) {
        logger.error('Watch poll error', { error: error.message });
      }
    }, interval);
  }

  /**
   * Stop watching for transcript entries
   * @param {TranscriptWatchCallback} [callback] - Specific callback to remove, or all if not specified
   */
  stopWatching(callback) {
    if (callback) {
      this.watchers.delete(callback);
    } else {
      this.watchers.clear();
    }

    if (this.watchers.size === 0 && this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
  }

  /**
   * Get a cached session or null if not cached/expired
   * @param {string} sessionId - Session ID
   * @returns {LSLSession|null}
   */
  getCachedSession(sessionId) {
    if (!this.config.enableCache) {
      return null;
    }

    const cached = this.sessionCache.get(sessionId);
    const timestamp = this.cacheTimestamps.get(sessionId);

    if (!cached || !timestamp) {
      return null;
    }

    if (Date.now() - timestamp > this.config.cacheTimeout) {
      this.sessionCache.delete(sessionId);
      this.cacheTimestamps.delete(sessionId);
      return null;
    }

    return cached;
  }

  /**
   * Cache a session
   * @param {string} sessionId - Session ID
   * @param {LSLSession} session - Session data
   */
  cacheSession(sessionId, session) {
    if (!this.config.enableCache) {
      return;
    }

    this.sessionCache.set(sessionId, session);
    this.cacheTimestamps.set(sessionId, Date.now());
  }

  /**
   * Clear the session cache
   */
  clearCache() {
    this.sessionCache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * Format an LSL session as markdown
   * @param {LSLSession} session - Session to format
   * @returns {string}
   */
  formatAsMarkdown(session) {
    const lines = [];

    // Header
    lines.push(`# Session: ${session.metadata.sessionId}`);
    lines.push('');
    lines.push(`- **Agent**: ${session.metadata.agent}`);
    lines.push(`- **Project**: ${session.metadata.projectPath}`);
    lines.push(`- **Started**: ${session.metadata.startTime}`);

    if (session.metadata.endTime) {
      lines.push(`- **Ended**: ${session.metadata.endTime}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');

    // Entries
    for (const entry of session.entries) {
      const time = new Date(entry.timestamp).toLocaleTimeString();

      switch (entry.type) {
        case LSLEntryType.USER:
          lines.push(`## [${time}] User`);
          lines.push('');
          lines.push(entry.content);
          lines.push('');
          break;

        case LSLEntryType.ASSISTANT:
          lines.push(`## [${time}] Assistant`);
          lines.push('');
          lines.push(entry.content);
          lines.push('');
          break;

        case LSLEntryType.TOOL_USE:
          lines.push(`### [${time}] Tool: ${entry.tool?.name || 'unknown'}`);
          lines.push('');
          lines.push('```json');
          lines.push(JSON.stringify(entry.tool?.input, null, 2));
          lines.push('```');
          lines.push('');
          break;

        case LSLEntryType.TOOL_RESULT:
          lines.push(`### [${time}] Tool Result: ${entry.tool?.name || 'unknown'}`);
          lines.push('');
          lines.push('```');
          const output = typeof entry.tool?.output === 'string' ?
            entry.tool.output :
            JSON.stringify(entry.tool?.output, null, 2);
          lines.push(output.substring(0, 500) + (output.length > 500 ? '...' : ''));
          lines.push('```');
          lines.push('');
          break;

        case LSLEntryType.SYSTEM:
          lines.push(`> [${time}] System: ${entry.content}`);
          lines.push('');
          break;

        case LSLEntryType.ERROR:
          lines.push(`> [${time}] ⚠️ Error: ${entry.content}`);
          lines.push('');
          break;
      }
    }

    return lines.join('\n');
  }

  /**
   * Get session summary statistics
   * @param {LSLSession} session - Session to analyze
   * @returns {Object}
   */
  getSessionStats(session) {
    const stats = {
      entryCount: session.entries.length,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
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
        case LSLEntryType.ERROR:
          stats.errors++;
          break;
      }
    }

    // Calculate duration
    if (session.metadata.startTime) {
      const start = new Date(session.metadata.startTime);
      const end = session.metadata.endTime ?
        new Date(session.metadata.endTime) :
        new Date();
      stats.duration = end.getTime() - start.getTime();
    }

    // Convert Set to Array for JSON serialization
    stats.toolsUsed = Array.from(stats.toolsUsed);

    return stats;
  }
}

/**
 * Factory function to create a transcript adapter for a specific agent
 * @param {string} agentType - Agent type ('claude', 'copilot', etc.)
 * @param {TranscriptConfig} config - Adapter configuration
 * @returns {Promise<TranscriptAdapter>}
 */
async function createTranscriptAdapter(agentType, config = {}) {
  switch (agentType) {
    case 'claude':
      const { ClaudeTranscriptAdapter } = await import('./adapters/claude-adapter.js');
      return new ClaudeTranscriptAdapter(config);

    case 'copilot':
      const { CopilotTranscriptAdapter } = await import('./adapters/copilot-adapter.js');
      return new CopilotTranscriptAdapter(config);

    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

export {
  TranscriptAdapter,
  LSLEntryType,
  createTranscriptAdapter
};
export default TranscriptAdapter;
