/**
 * TranscriptNormalizer - Shared normalization layer for transcript formats
 *
 * Converts Claude JSONL, Copilot events, and .specstory markdown into
 * a common MastraDBMessage shape for unified observation processing.
 *
 * @module TranscriptNormalizer
 */

import crypto from 'node:crypto';

/**
 * @typedef {Object} MastraDBMessage
 * @property {string} id - Unique message ID (deterministic hash or uuidv4)
 * @property {string} role - 'user' | 'assistant' | 'system' | 'tool'
 * @property {string} content - Message text content
 * @property {string} createdAt - ISO 8601 timestamp
 * @property {Object} [metadata] - Optional metadata
 * @property {string} [metadata.agent] - Source agent: 'claude' | 'copilot' | 'mastra'
 * @property {string} [metadata.sessionId] - Original session identifier
 * @property {string} [metadata.sourceFile] - Path to source transcript file
 * @property {string} [metadata.format] - Original format: 'jsonl' | 'events' | 'specstory'
 */

/**
 * Generate a deterministic ID from content and timestamp to avoid duplicates.
 * @param {string} content
 * @param {string} timestamp
 * @returns {string} SHA-256 based ID (first 32 hex chars)
 */
function deterministicId(content, timestamp) {
  const hash = crypto.createHash('sha256');
  hash.update(content || '');
  hash.update(timestamp || '');
  return hash.digest('hex').substring(0, 32);
}

/**
 * Extract text content from a Claude message content field.
 * Content may be a string or an array of content blocks.
 * @param {string|Array} content
 * @returns {string}
 */
function extractContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');
  }
  return '';
}

/**
 * Map Claude transcript type to standard role.
 * @param {string} type - 'human' | 'assistant' | 'system' | 'user' | 'tool_use' | 'tool_result'
 * @returns {string} Normalized role
 */
function mapClaudeRole(type) {
  if (type === 'human' || type === 'user') return 'user';
  if (type === 'assistant') return 'assistant';
  if (type === 'system') return 'system';
  if (type === 'tool_use' || type === 'tool_result') return 'tool';
  return 'assistant';
}

/**
 * Parse a single line from a Claude JSONL transcript.
 *
 * Claude JSONL lines have shape:
 *   {"type":"assistant"|"human"|"system","message":{"role":"...","content":"..."},"timestamp":"..."}
 *
 * Also handles the newer format with human_turn_start/claude_turn_start types.
 *
 * @param {string} jsonlLine - A single line from the JSONL file
 * @returns {MastraDBMessage|null} Parsed message or null if unparseable/skippable
 */
export function parseClaude(jsonlLine) {
  if (!jsonlLine || !jsonlLine.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(jsonlLine);
  } catch {
    return null;
  }

  // Skip system messages (prompt caching metadata, not conversation content)
  if (parsed.type === 'system' || (parsed.message && parsed.message.role === 'system')) {
    return null;
  }

  // Handle tool_use messages: map to role "tool" with tool info as content
  if (parsed.type === 'tool_use') {
    const toolName = parsed.tool_name || parsed.name || 'unknown_tool';
    const toolInput = parsed.input_json || parsed.input || '';
    const content = `[Tool Use: ${toolName}] ${typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput)}`;
    const timestamp = parsed.timestamp || new Date().toISOString();
    return {
      id: deterministicId(content, timestamp),
      role: 'tool',
      content,
      createdAt: timestamp,
      metadata: { agent: 'claude', format: 'jsonl', toolName },
    };
  }

  // Handle tool_result messages: map to role "tool" with result as content
  if (parsed.type === 'tool_result') {
    const output = parsed.output_json || parsed.output || parsed.content || '';
    const content = `[Tool Result] ${typeof output === 'string' ? output : JSON.stringify(output)}`;
    const timestamp = parsed.timestamp || new Date().toISOString();
    return {
      id: deterministicId(content, timestamp),
      role: 'tool',
      content,
      createdAt: timestamp,
      metadata: { agent: 'claude', format: 'jsonl', isError: parsed.is_error || false },
    };
  }

  // Handle standard format: { type, message: { role, content }, timestamp }
  if (parsed.message && parsed.message.content !== undefined) {
    const type = parsed.type || parsed.message.role || 'assistant';
    // Skip system messages nested in message object
    if (type === 'system') return null;
    const role = mapClaudeRole(type);
    const content = extractContent(parsed.message.content);
    if (!content) return null;

    const timestamp = parsed.timestamp || new Date().toISOString();
    return {
      id: deterministicId(content, timestamp),
      role,
      content,
      createdAt: timestamp,
      metadata: {
        agent: 'claude',
        format: 'jsonl',
      },
    };
  }

  // Handle turn-based format: { type: "human_turn_end", content: "..." }
  if (parsed.type === 'human_turn_end' && parsed.content) {
    const content = extractContent(parsed.content);
    if (!content) return null;
    const timestamp = parsed.timestamp || new Date().toISOString();
    return {
      id: deterministicId(content, timestamp),
      role: 'user',
      content,
      createdAt: timestamp,
      metadata: { agent: 'claude', format: 'jsonl' },
    };
  }

  if (parsed.type === 'claude_turn_end' && parsed.content) {
    const content = extractContent(parsed.content);
    if (!content) return null;
    const timestamp = parsed.timestamp || new Date().toISOString();
    return {
      id: deterministicId(content, timestamp),
      role: 'assistant',
      content,
      createdAt: timestamp,
      metadata: { agent: 'claude', format: 'jsonl' },
    };
  }

  return null;
}

/**
 * Parse a single line from a Copilot events.jsonl file.
 *
 * Copilot events have shape:
 *   {"event":"conversation.message","data":{"role":"user"|"assistant","content":"...","timestamp":"..."}}
 *
 * Only conversation.message events produce messages; others return null.
 *
 * @param {string} eventLine - A single line from the events JSONL file
 * @returns {MastraDBMessage|null} Parsed message or null if not a conversation message
 */
export function parseCopilot(eventLine) {
  if (!eventLine || !eventLine.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(eventLine);
  } catch {
    return null;
  }

  // Only process conversation.message events
  if (parsed.event !== 'conversation.message') return null;

  const data = parsed.data;
  if (!data || !data.content) return null;

  const role = data.role || 'assistant';
  const content = typeof data.content === 'string' ? data.content : JSON.stringify(data.content);
  const timestamp = data.timestamp || parsed.timestamp || new Date().toISOString();

  return {
    id: deterministicId(content, timestamp),
    role,
    content,
    createdAt: timestamp,
    metadata: {
      agent: 'copilot',
      format: 'events',
    },
  };
}

/**
 * Parse a full .specstory markdown file into an array of MastraDBMessages.
 *
 * .specstory files use `### Human:` and `### Assistant:` headers to delimit exchanges.
 * Timestamps may come from YAML frontmatter or the filename pattern
 * (YYYY-MM-DD_HHMM-HHMM_hash.md).
 *
 * Handles code blocks (``` fences) within messages without splitting on them.
 *
 * @param {string} mdContent - Full markdown content of a .specstory file
 * @param {Object} [options] - Optional configuration
 * @param {string} [options.sourceFile] - Source filename for timestamp extraction
 * @returns {MastraDBMessage[]} Array of messages in chronological order
 */
export function parseSpecstory(mdContent, options = {}) {
  if (!mdContent || typeof mdContent !== 'string') return [];

  const messages = [];

  // Try to extract a base timestamp from frontmatter or filename
  let baseTimestamp = extractSpecstoryTimestamp(mdContent, options.sourceFile);

  // Split content into segments by ### Human: and ### Assistant: headers
  // We need to handle code blocks that might contain these patterns
  const segments = splitSpecstorySegments(mdContent);

  let messageIndex = 0;
  for (const segment of segments) {
    if (!segment.content.trim()) continue;

    // Increment timestamp by index to maintain ordering
    const ts = offsetTimestamp(baseTimestamp, messageIndex);
    const content = segment.content.trim();

    messages.push({
      id: deterministicId(content, ts),
      role: segment.role,
      content,
      createdAt: ts,
      metadata: {
        agent: 'claude',
        format: 'specstory',
        sourceFile: options.sourceFile || undefined,
      },
    });
    messageIndex++;
  }

  return messages;
}

/**
 * Extract a timestamp from .specstory frontmatter or filename.
 * @param {string} content - Markdown content
 * @param {string} [filename] - Source filename
 * @returns {string} ISO timestamp
 */
function extractSpecstoryTimestamp(content, filename) {
  // Try YAML frontmatter: look for date or created fields
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    const dateMatch = fm.match(/(?:date|created|timestamp):\s*['"]?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/);
    if (dateMatch) {
      return new Date(dateMatch[1]).toISOString();
    }
  }

  // Try filename pattern: YYYY-MM-DD_HHMM-HHMM_hash.md
  if (filename) {
    const fnMatch = filename.match(/(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})-(\d{2})(\d{2})/);
    if (fnMatch) {
      const [, date, startH, startM] = fnMatch;
      return new Date(`${date}T${startH}:${startM}:00Z`).toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * Offset a timestamp by a number of seconds for ordering.
 * @param {string} baseTs - ISO timestamp
 * @param {number} offsetSec - Seconds to add
 * @returns {string} Offset ISO timestamp
 */
function offsetTimestamp(baseTs, offsetSec) {
  const d = new Date(baseTs);
  d.setSeconds(d.getSeconds() + offsetSec);
  return d.toISOString();
}

/**
 * Split .specstory markdown into role-tagged segments, respecting code fences.
 * @param {string} content
 * @returns {Array<{role: string, content: string}>}
 */
function splitSpecstorySegments(content) {
  const segments = [];
  const lines = content.split('\n');

  let currentRole = null;
  let currentContent = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Track code fence state
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (currentRole) {
        currentContent.push(line);
      }
      continue;
    }

    // Only detect headers outside code blocks
    if (!inCodeBlock) {
      const headerMatch = line.match(/^###\s+(Human|Assistant):/i);
      if (headerMatch) {
        // Save previous segment
        if (currentRole && currentContent.length > 0) {
          segments.push({
            role: currentRole,
            content: currentContent.join('\n'),
          });
        }
        currentRole = headerMatch[1].toLowerCase() === 'human' ? 'user' : 'assistant';
        currentContent = [];
        continue;
      }
    }

    // Skip frontmatter
    if (!currentRole && (line.startsWith('---') || line.match(/^\w+:/))) {
      continue;
    }

    if (currentRole) {
      currentContent.push(line);
    }
  }

  // Save last segment
  if (currentRole && currentContent.length > 0) {
    segments.push({
      role: currentRole,
      content: currentContent.join('\n'),
    });
  }

  return segments;
}
