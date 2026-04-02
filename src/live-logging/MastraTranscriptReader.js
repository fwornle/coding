/**
 * MastraTranscriptReader - File-watching reader for mastra native transcript format
 *
 * Watches mastra lifecycle hook transcript files (NDJSON) and emits parsed
 * message/exchange events for consumption by the enhanced-transcript-monitor.
 *
 * Mastra lifecycle hooks produce NDJSON files with events like:
 *   {"type":"session_start","sessionId":"abc-123","timestamp":"..."}
 *   {"type":"message","role":"user","content":"fix the bug","timestamp":"..."}
 *   {"type":"message","role":"assistant","content":"I will fix it","timestamp":"..."}
 *   {"type":"onStepFinish","step":"...","timestamp":"..."}
 *   {"type":"onToolCall","tool":"...","input":"...","timestamp":"..."}
 *   {"type":"session_end","sessionId":"abc-123","timestamp":"..."}
 *
 * Features:
 * - Watches a transcript directory for new .jsonl / .ndjson files
 * - Tails active files for new content (incremental reads)
 * - Parses native mastra lifecycle hook format
 * - Emits 'message' events with role/content/timestamp/metadata
 * - Emits 'exchange' events when a complete user->assistant turn is detected
 * - Handles file rotation (new session = new file)
 * - Static extractExchangesFromBatch() for batch processing
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

class MastraTranscriptReader extends EventEmitter {
  /**
   * @param {string} transcriptPath - Directory to watch for mastra transcript files
   * @param {object} options
   * @param {string} [options.encoding='utf-8'] - File encoding
   * @param {number} [options.pollInterval=1000] - Poll interval in ms for file changes
   * @param {boolean} [options.debug=false] - Enable debug logging
   */
  constructor(transcriptPath, options = {}) {
    super();

    this.transcriptDir = transcriptPath;
    this.encoding = options.encoding || 'utf-8';
    this.pollInterval = options.pollInterval || 1000;
    this.debugEnabled = options.debug || false;

    // Track file read offsets for incremental tailing
    this.fileOffsets = new Map();

    // Current pending exchange (user message waiting for assistant reply)
    this.pendingExchange = null;

    // Active file watcher handle
    this._watcher = null;
    this._pollTimer = null;

    // Stats
    this.stats = {
      filesProcessed: 0,
      messagesEmitted: 0,
      exchangesEmitted: 0,
      errors: 0,
      startTime: null
    };
  }

  /**
   * Start watching the transcript directory for new/updated files.
   */
  start() {
    this.stats.startTime = Date.now();
    this._log('Starting MastraTranscriptReader on ' + this.transcriptDir);

    // Ensure directory exists
    if (!fs.existsSync(this.transcriptDir)) {
      fs.mkdirSync(this.transcriptDir, { recursive: true });
      this._log('Created transcript directory: ' + this.transcriptDir);
    }

    // Process any existing files first
    this._scanExistingFiles();

    // Watch for new files and changes
    try {
      this._watcher = fs.watch(this.transcriptDir, (eventType, filename) => {
        if (!filename) return;
        if (!this._isTranscriptFile(filename)) return;

        const filePath = path.join(this.transcriptDir, filename);
        if (eventType === 'rename' && fs.existsSync(filePath)) {
          // New file appeared
          this._log('New transcript file detected: ' + filename);
          this._tailFile(filePath);
        } else if (eventType === 'change') {
          // Existing file modified
          this._tailFile(filePath);
        }
      });
    } catch (err) {
      this._log('fs.watch failed, falling back to polling: ' + err.message);
    }

    // Also poll for changes (fs.watch can be unreliable on some platforms)
    this._pollTimer = setInterval(() => {
      this._scanForChanges();
    }, this.pollInterval);

    this.emit('started', { directory: this.transcriptDir });
  }

  /**
   * Stop watching.
   */
  stop() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._log('Stopped MastraTranscriptReader (' + this.stats.messagesEmitted + ' messages, ' + this.stats.exchangesEmitted + ' exchanges)');
    this.emit('stopped', { ...this.stats });
  }

  /**
   * Scan existing transcript files on startup.
   */
  _scanExistingFiles() {
    try {
      const files = fs.readdirSync(this.transcriptDir)
        .filter(f => this._isTranscriptFile(f))
        .map(f => {
          const fp = path.join(this.transcriptDir, f);
          return { path: fp, mtime: fs.statSync(fp).mtime };
        })
        .sort((a, b) => a.mtime - b.mtime);

      for (const file of files) {
        this._tailFile(file.path);
      }
    } catch (err) {
      this._log('Error scanning existing files: ' + err.message);
    }
  }

  /**
   * Poll-based change detection as fallback.
   */
  _scanForChanges() {
    try {
      const files = fs.readdirSync(this.transcriptDir)
        .filter(f => this._isTranscriptFile(f));

      for (const filename of files) {
        const filePath = path.join(this.transcriptDir, filename);
        try {
          const stat = fs.statSync(filePath);
          const currentOffset = this.fileOffsets.get(filePath) || 0;
          if (stat.size > currentOffset) {
            this._tailFile(filePath);
          }
        } catch (e) {
          // File may have been removed between readdir and stat
        }
      }
    } catch (err) {
      // Directory may not exist yet
    }
  }

  /**
   * Read new content from a transcript file starting at the last known offset.
   */
  _tailFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      const currentOffset = this.fileOffsets.get(filePath) || 0;

      if (stat.size <= currentOffset) return;

      // Read only the new portion
      const fd = fs.openSync(filePath, 'r');
      const bufSize = stat.size - currentOffset;
      const buf = Buffer.alloc(bufSize);
      fs.readSync(fd, buf, 0, bufSize, currentOffset);
      fs.closeSync(fd);

      this.fileOffsets.set(filePath, stat.size);

      const newContent = buf.toString(this.encoding);
      const lines = newContent.split('\n').filter(l => l.trim());

      for (const line of lines) {
        this._parseLine(line, filePath);
      }

      if (!this.fileOffsets.has(filePath) || currentOffset === 0) {
        this.stats.filesProcessed++;
      }
    } catch (err) {
      this.stats.errors++;
      this._log('Error tailing ' + filePath + ': ' + err.message);
      this.emit('error', { type: 'tail', file: filePath, error: err.message });
    }
  }

  /**
   * Parse a single NDJSON line from the transcript file.
   */
  _parseLine(line, filePath) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (err) {
      this.stats.errors++;
      this.emit('error', {
        type: 'parse',
        file: filePath,
        error: err.message,
        content: line.substring(0, 100)
      });
      return;
    }

    // Map mastra lifecycle event to a normalized message
    const message = this._normalizeEvent(event);
    if (!message) return;

    this.stats.messagesEmitted++;
    this.emit('message', message);

    // Exchange detection: user -> assistant turn
    this._detectExchange(message);
  }

  /**
   * Normalize a mastra lifecycle hook event into a standard message object.
   *
   * Mastra hooks produce events with varying shapes:
   * - { type: "message", role: "user"|"assistant", content: "...", timestamp: "..." }
   * - { type: "onStepFinish", step: "...", output: "...", timestamp: "..." }
   * - { type: "onToolCall", tool: "...", input: "...", timestamp: "..." }
   * - { type: "onToolResult", tool: "...", output: "...", timestamp: "..." }
   * - { type: "session_start", sessionId: "...", timestamp: "..." }
   * - { type: "session_end", sessionId: "...", timestamp: "..." }
   *
   * Returns a normalized object or null for non-content events.
   */
  _normalizeEvent(event) {
    const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
    const hookType = event.type || 'unknown';

    // Direct message events
    if (event.type === 'message' && event.role && event.content) {
      return {
        role: event.role,
        content: event.content,
        timestamp,
        metadata: { agent: 'mastra', hookType, sessionId: event.sessionId || null }
      };
    }

    // Step finish events (assistant-like output)
    if (event.type === 'onStepFinish' && event.output) {
      return {
        role: 'assistant',
        content: typeof event.output === 'string' ? event.output : JSON.stringify(event.output),
        timestamp,
        metadata: { agent: 'mastra', hookType, step: event.step || null, sessionId: event.sessionId || null }
      };
    }

    // Tool call events
    if (event.type === 'onToolCall') {
      return {
        role: 'tool',
        content: 'Tool call: ' + (event.tool || event.name || 'unknown') +
          (event.input ? '\nInput: ' + (typeof event.input === 'string' ? event.input : JSON.stringify(event.input)) : ''),
        timestamp,
        metadata: { agent: 'mastra', hookType, tool: event.tool || event.name || null, sessionId: event.sessionId || null }
      };
    }

    // Tool result events
    if (event.type === 'onToolResult') {
      return {
        role: 'tool',
        content: 'Tool result: ' + (event.tool || event.name || 'unknown') +
          (event.output ? '\nOutput: ' + (typeof event.output === 'string' ? event.output : JSON.stringify(event.output)) : ''),
        timestamp,
        metadata: { agent: 'mastra', hookType, tool: event.tool || event.name || null, sessionId: event.sessionId || null }
      };
    }

    // Session lifecycle events (emit but don't create content messages)
    if (event.type === 'session_start' || event.type === 'session_end') {
      this.emit(event.type === 'session_start' ? 'session_start' : 'session_end', {
        sessionId: event.sessionId,
        timestamp
      });

      // Reset pending exchange on new session
      if (event.type === 'session_start') {
        this.pendingExchange = null;
      }

      return null;
    }

    // Unknown event types with content -- pass through as assistant
    if (event.content) {
      return {
        role: event.role || 'assistant',
        content: typeof event.content === 'string' ? event.content : JSON.stringify(event.content),
        timestamp,
        metadata: { agent: 'mastra', hookType, sessionId: event.sessionId || null }
      };
    }

    return null;
  }

  /**
   * Detect complete user->assistant exchanges and emit 'exchange' events.
   */
  _detectExchange(message) {
    if (message.role === 'user') {
      // Start a new pending exchange
      this.pendingExchange = {
        timestamp: message.timestamp,
        humanMessage: message.content,
        assistantMessage: null,
        toolCalls: [],
        metadata: message.metadata
      };
    } else if (message.role === 'assistant' && this.pendingExchange) {
      // Complete the exchange
      this.pendingExchange.assistantMessage = message.content;
      this.stats.exchangesEmitted++;
      this.emit('exchange', { ...this.pendingExchange });
      this.pendingExchange = null;
    } else if (message.role === 'tool' && this.pendingExchange) {
      // Accumulate tool calls within the exchange
      this.pendingExchange.toolCalls.push({
        name: message.metadata?.tool || 'unknown',
        content: message.content
      });
    }
  }

  /**
   * Check if a filename is a transcript file we should process.
   */
  _isTranscriptFile(filename) {
    return filename.endsWith('.jsonl') || filename.endsWith('.ndjson');
  }

  /**
   * Extract exchanges from a batch of messages (static, for batch processing).
   * Follows the same pattern as StreamingTranscriptReader.extractExchangesFromBatch.
   *
   * @param {Array} messages - Array of raw NDJSON-parsed event objects
   * @param {object} [options] - Options (unused, for API compat)
   * @returns {Array} Array of exchange objects
   */
  static extractExchangesFromBatch(messages, options = {}) {
    const exchanges = [];
    let currentExchange = null;

    for (const event of messages) {
      const hookType = event.type || 'unknown';

      if (event.type === 'message' && event.role === 'user' && event.content) {
        // Start new exchange; finalize previous if pending
        if (currentExchange && currentExchange.humanMessage) {
          exchanges.push(currentExchange);
        }
        currentExchange = {
          timestamp: event.timestamp || new Date().toISOString(),
          humanMessage: event.content,
          assistantMessage: null,
          toolCalls: [],
          metadata: { agent: 'mastra', hookType }
        };
      } else if (event.type === 'message' && event.role === 'assistant' && event.content && currentExchange) {
        currentExchange.assistantMessage = event.content;
        exchanges.push(currentExchange);
        currentExchange = null;
      } else if (event.type === 'onStepFinish' && event.output && currentExchange) {
        const content = typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
        currentExchange.assistantMessage = content;
        exchanges.push(currentExchange);
        currentExchange = null;
      } else if ((event.type === 'onToolCall' || event.type === 'onToolResult') && currentExchange) {
        currentExchange.toolCalls.push({
          name: event.tool || event.name || 'unknown',
          type: event.type,
          content: event.input || event.output || null
        });
      }
    }

    // Finalize any remaining exchange
    if (currentExchange && currentExchange.humanMessage) {
      exchanges.push(currentExchange);
    }

    return exchanges;
  }

  /**
   * Debug logging via process.stderr.write (not console, per project constraints).
   */
  _log(message) {
    if (this.debugEnabled) {
      process.stderr.write('[MastraTranscriptReader] ' + message + '\n');
    }
  }
}

export default MastraTranscriptReader;
