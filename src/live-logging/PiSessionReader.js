/**
 * PiSessionReader - File-watching reader for pi's native session format
 *
 * Watches pi session JSONL files and emits parsed message/exchange events for
 * consumption by the enhanced-transcript-monitor. Replaces MastraTranscriptReader.
 *
 * The important difference from the mastra reader this supersedes: pi WRITES
 * THIS FILE ITSELF. mastracode had no readable transcript, so config/agents/
 * mastra.sh had to generate a Python hook script, register it against six
 * lifecycle events, and invent an NDJSON format for it to append to. Here we
 * read pi's own persisted session — no hook to install, no format to invent, and
 * nothing to keep in sync when pi changes.
 *
 * config/agents/pi.sh pins PI_CODING_AGENT_SESSION_DIR to
 * <project>/.observations/pi-sessions/, so there is also no directory to guess.
 * pi's default is ~/.pi/agent/sessions/--<cwd-with-slashes-replaced>--/, which is
 * why mastra needed a findMastraTranscriptDir() heuristic and claude needs
 * encoded-path discovery. Pinning removes that class of bug outright.
 *
 * Format (pi docs/session-format.md, session version 3). Entries form a TREE via
 * id/parentId — branching happens in place rather than by creating a new file:
 *
 *   {"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"..."}
 *   {"type":"model_change","id":"..","parentId":null,"provider":"..","modelId":".."}
 *   {"type":"thinking_level_change","id":"..","parentId":"..","thinkingLevel":".."}
 *   {"type":"message","id":"..","parentId":"..","timestamp":"..","message":{...}}
 *
 * Note the nesting: the payload lives under `.message`, not at the top level the
 * way mastra's flat events did. Content is an ARRAY of typed blocks:
 *   text     -> { type:"text", text }
 *   thinking -> { type:"thinking", thinking }
 *   toolCall -> { type:"toolCall", id, name, arguments }
 *   image    -> { type:"image", data, mimeType }
 * and the roles are user / assistant / toolResult (NOT "tool" — toolResult
 * carries toolCallId, toolName and isError).
 *
 * Features:
 * - Watches the session directory for new .jsonl files
 * - Tails active files for new content (incremental reads by offset)
 * - Emits 'message' events with role/content/timestamp/metadata
 * - Emits 'exchange' events when a complete user->assistant turn is detected
 * - Handles rotation (new session = new file)
 * - Static extractExchangesFromBatch() for batch processing
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * Flatten pi's content-block array to plain text.
 *
 * `thinking` blocks are deliberately excluded: they are the model's reasoning,
 * not its answer, and folding them into observation content would both distort
 * summaries and persist reasoning the user never saw.
 *
 * @param {string|Array} content
 * @returns {string}
 */
function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/**
 * Extract toolCall blocks from a content array.
 * @param {string|Array} content
 * @returns {Array<{name: string, id: string|null, arguments: any}>}
 */
function extractToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b && b.type === 'toolCall')
    .map((b) => ({ name: b.name || 'unknown', id: b.id || null, arguments: b.arguments ?? null }));
}

class PiSessionReader extends EventEmitter {
  /**
   * @param {string} sessionPath - Directory to watch for pi session files
   * @param {object} options
   * @param {string} [options.encoding='utf-8'] - File encoding
   * @param {number} [options.pollInterval=1000] - Poll interval in ms for file changes
   * @param {boolean} [options.debug=false] - Enable debug logging
   */
  constructor(sessionPath, options = {}) {
    super();

    this.transcriptDir = sessionPath;
    this.encoding = options.encoding || 'utf-8';
    this.pollInterval = options.pollInterval || 1000;
    this.debugEnabled = options.debug || false;

    // Track file read offsets for incremental tailing
    this.fileOffsets = new Map();

    // sessionId per file, learned from each file's `session` header line. pi puts
    // it only in that header, so later message lines have no id of their own.
    this.sessionIds = new Map();

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
   * Start watching the session directory for new/updated files.
   */
  start() {
    this.stats.startTime = Date.now();
    this._log('Starting PiSessionReader on ' + this.transcriptDir);

    if (!fs.existsSync(this.transcriptDir)) {
      fs.mkdirSync(this.transcriptDir, { recursive: true });
      this._log('Created session directory: ' + this.transcriptDir);
    }

    this._scanExistingFiles();

    try {
      this._watcher = fs.watch(this.transcriptDir, (eventType, filename) => {
        if (!filename) return;
        if (!this._isTranscriptFile(filename)) return;

        const filePath = path.join(this.transcriptDir, filename);
        if (eventType === 'rename' && fs.existsSync(filePath)) {
          this._log('New session file detected: ' + filename);
          this._tailFile(filePath);
        } else if (eventType === 'change') {
          this._tailFile(filePath);
        }
      });
    } catch (err) {
      this._log('fs.watch failed, falling back to polling: ' + err.message);
    }

    // Also poll (fs.watch can be unreliable on some platforms)
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
    this._log('Stopped PiSessionReader (' + this.stats.messagesEmitted + ' messages, ' + this.stats.exchangesEmitted + ' exchanges)');
    this.emit('stopped', { ...this.stats });
  }

  /**
   * Scan existing session files on startup.
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
   * Read new content from a session file starting at the last known offset.
   */
  _tailFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      const currentOffset = this.fileOffsets.get(filePath) || 0;

      if (stat.size <= currentOffset) return;

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
   * Parse a single JSONL line from a session file.
   *
   * Unlike the mastra reader, one line can yield MORE than one message: an
   * assistant entry may carry both toolCall blocks and text. Those are emitted
   * tool-calls-first, because _detectExchange closes the pending exchange on the
   * assistant message — emitting text first would strand the tool calls after the
   * exchange they belong to had already been flushed.
   */
  _parseLine(line, filePath) {
    let entry;
    try {
      entry = JSON.parse(line);
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

    // The session header carries the only copy of the session id.
    if (entry && entry.type === 'session') {
      if (entry.id) this.sessionIds.set(filePath, entry.id);
      return;
    }

    const messages = this._normalizeEntry(entry, filePath);
    for (const message of messages) {
      this.stats.messagesEmitted++;
      this.emit('message', message);
      this._detectExchange(message);
    }
  }

  /**
   * Normalize a pi session entry into zero or more standard message objects.
   *
   * @param {object} entry - a parsed JSONL line
   * @param {string} filePath - used to resolve the session id
   * @returns {Array<{role: string, content: string, timestamp: Date, metadata: object}>}
   */
  _normalizeEntry(entry, filePath) {
    if (!entry || entry.type !== 'message' || !entry.message) return [];

    const msg = entry.message;
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const sessionId = this.sessionIds.get(filePath) || null;
    const base = { agent: 'pi', hookType: entry.type, sessionId, entryId: entry.id || null };
    const out = [];

    if (msg.role === 'user') {
      const content = flattenContent(msg.content);
      if (!content) return [];
      return [{ role: 'user', content, timestamp, metadata: { ...base } }];
    }

    if (msg.role === 'assistant') {
      // Tool calls first — see _parseLine.
      for (const call of extractToolCalls(msg.content)) {
        out.push({
          role: 'tool',
          content: 'Tool call: ' + call.name +
            (call.arguments != null ? '\nInput: ' + JSON.stringify(call.arguments) : ''),
          timestamp,
          metadata: { ...base, tool: call.name, toolCallId: call.id }
        });
      }

      const content = flattenContent(msg.content);
      // An assistant entry that is ONLY tool calls has no text; emitting an empty
      // assistant message would close the exchange with a blank reply.
      if (content) {
        out.push({
          role: 'assistant',
          content,
          timestamp,
          metadata: {
            ...base,
            // pi reports real usage, so unlike mastra there is no zero-token
            // special case downstream.
            usage: msg.usage || null,
            model: msg.model || null,
            provider: msg.provider || null,
            stopReason: msg.stopReason || null
          }
        });
      }
      return out;
    }

    if (msg.role === 'toolResult') {
      const content = flattenContent(msg.content);
      return [{
        role: 'tool',
        content: 'Tool result: ' + (msg.toolName || 'unknown') + (content ? '\nOutput: ' + content : ''),
        timestamp,
        metadata: {
          ...base,
          tool: msg.toolName || null,
          toolCallId: msg.toolCallId || null,
          isError: msg.isError === true
        }
      }];
    }

    return [];
  }

  /**
   * Detect complete user->assistant exchanges and emit 'exchange' events.
   */
  _detectExchange(message) {
    if (message.role === 'user') {
      this.pendingExchange = {
        timestamp: message.timestamp,
        humanMessage: message.content,
        assistantMessage: null,
        toolCalls: [],
        metadata: message.metadata
      };
    } else if (message.role === 'assistant' && this.pendingExchange) {
      this.pendingExchange.assistantMessage = message.content;
      this.stats.exchangesEmitted++;
      this.emit('exchange', { ...this.pendingExchange });
      this.pendingExchange = null;
    } else if (message.role === 'tool' && this.pendingExchange) {
      this.pendingExchange.toolCalls.push({
        name: message.metadata?.tool || 'unknown',
        content: message.content
      });
    }
  }

  /**
   * Check if a filename is a session file we should process.
   */
  _isTranscriptFile(filename) {
    return filename.endsWith('.jsonl');
  }

  /**
   * Extract exchanges from a batch of raw session entries (static, for batch
   * processing). Mirrors StreamingTranscriptReader.extractExchangesFromBatch.
   *
   * @param {Array} entries - Array of raw JSONL-parsed session entry objects
   * @param {object} [options] - Options (unused, for API compat)
   * @returns {Array} Array of exchange objects
   */
  static extractExchangesFromBatch(entries, options = {}) {
    const exchanges = [];
    let currentExchange = null;
    let sessionId = null;

    for (const entry of entries) {
      if (!entry) continue;

      if (entry.type === 'session') {
        sessionId = entry.id || sessionId;
        continue;
      }
      if (entry.type !== 'message' || !entry.message) continue;

      const msg = entry.message;
      const timestamp = entry.timestamp || new Date().toISOString();
      const metadata = { agent: 'pi', hookType: entry.type, sessionId };

      if (msg.role === 'user') {
        const content = flattenContent(msg.content);
        if (!content) continue;
        if (currentExchange && currentExchange.humanMessage) {
          exchanges.push(currentExchange);
        }
        currentExchange = {
          timestamp,
          humanMessage: content,
          assistantMessage: null,
          toolCalls: [],
          metadata
        };
      } else if (msg.role === 'assistant' && currentExchange) {
        for (const call of extractToolCalls(msg.content)) {
          currentExchange.toolCalls.push({
            name: call.name,
            type: 'toolCall',
            content: call.arguments != null ? JSON.stringify(call.arguments) : null
          });
        }
        const content = flattenContent(msg.content);
        // Tool-call-only turns do not end the exchange — pi will send the text in
        // a later assistant entry once the tool results are back.
        if (content) {
          currentExchange.assistantMessage = content;
          exchanges.push(currentExchange);
          currentExchange = null;
        }
      } else if (msg.role === 'toolResult' && currentExchange) {
        currentExchange.toolCalls.push({
          name: msg.toolName || 'unknown',
          type: 'toolResult',
          content: flattenContent(msg.content) || null
        });
      }
    }

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
      process.stderr.write('[PiSessionReader] ' + message + '\n');
    }
  }
}

export default PiSessionReader;
