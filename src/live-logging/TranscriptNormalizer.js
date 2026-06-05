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
/**
 * Set of Copilot event types that contain conversation content.
 *
 * Phase 51 Plan 04 Task 1 extended for Copilot CLI v1.0.48 dotted event names
 * (user.message, assistant.message, assistant.turn_start/end). Legacy entries
 * (conversation.message, conversation.turn, completion.response) preserved for
 * backward compat against older sessions on disk.
 *
 * @type {Set<string>}
 */
const COPILOT_CONVERSATION_EVENTS = new Set([
  // v1.0.48+ dotted names
  'user.message',
  'assistant.message',
  'assistant.turn_start',
  'assistant.turn_end',
  // Legacy / older versions
  'conversation.message',
  'conversation.turn',
  'completion.response',
]);

/**
 * Set of Copilot sub-agent lifecycle events.
 *
 * Phase 51 Plan 04 Task 1: first-class sub-agent boundary events emitted by
 * Copilot CLI v1.0.48+. These do NOT carry conversation content — parseCopilot
 * returns a structured sub-agent record (type:'subagent' discriminator) rather
 * than a chat MastraDBMessage so the Path B adapter can register them in the
 * sub-agent registry.
 *
 * @type {Set<string>}
 */
const COPILOT_SUBAGENT_EVENTS = new Set([
  'subagent.started',
  'subagent.completed',
  'subagent.failed',
]);

export function parseCopilot(eventLine) {
  if (!eventLine || !eventLine.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(eventLine);
  } catch {
    return null;
  }

  // v1.0.48 uses top-level `type` field; legacy v1.0.12 used `event` field.
  const eventType = parsed.type || parsed.event;
  if (!eventType) return null;

  // Sub-agent branch — return structured record for the Path B adapter.
  if (COPILOT_SUBAGENT_EVENTS.has(eventType)) {
    const data = parsed.data || {};
    return {
      type: 'subagent', // discriminator — adapter checks this
      subEventType: eventType.split('.')[1], // 'started' | 'completed' | 'failed'
      toolCallId: data.toolCallId,
      agentName: data.agentName,
      agentDisplayName: data.agentDisplayName,
      agentDescription: data.agentDescription,
      timestamp: parsed.timestamp,
      errorMessage: data.error || null,
    };
  }

  // Only process conversation-related events; skip status events, heartbeats, etc.
  if (!COPILOT_CONVERSATION_EVENTS.has(eventType)) return null;

  // assistant.turn_start / assistant.turn_end are boundary events; they carry
  // no content. Adapter / writer keys exchange boundaries on role='assistant'
  // messages, not turn markers — return null.
  if (eventType === 'assistant.turn_start' || eventType === 'assistant.turn_end') {
    return null;
  }

  const data = parsed.data;
  if (!data) return null;

  // Extract content from multiple possible shapes:
  // 1. data.content (string) -- most common for user.message / assistant.message
  //    in v1.0.48 AND for legacy conversation.message
  // 2. data.message.content (nested) -- some event formats
  // 3. data.choices[0].message.content -- completion.response format
  // 4. data.choices[0].delta.content -- incremental delta events
  let content = null;
  let role = null;

  // Derive role from event-type prefix for v1.0.48 dotted names, else
  // fall back to data.role.
  let prefixRole = null;
  if (eventType.startsWith('user.')) prefixRole = 'user';
  else if (eventType.startsWith('assistant.')) prefixRole = 'assistant';

  if (typeof data.content === 'string' && data.content.trim()) {
    content = data.content;
    role = prefixRole || data.role || 'assistant';
  } else if (data.message && typeof data.message.content === 'string' && data.message.content.trim()) {
    content = data.message.content;
    role = prefixRole || data.message.role || data.role || 'assistant';
  } else if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
    const choice = data.choices[0];
    // Full message (completion.response)
    if (choice.message && typeof choice.message.content === 'string' && choice.message.content.trim()) {
      content = choice.message.content;
      role = choice.message.role || 'assistant';
    }
    // Delta (incremental streaming)
    else if (choice.delta && typeof choice.delta.content === 'string' && choice.delta.content.trim()) {
      content = choice.delta.content;
      role = choice.delta.role || 'assistant';
    }
  }

  // Skip events with no meaningful content
  if (!content) return null;

  const timestamp = parsed.timestamp || data.timestamp || new Date().toISOString();

  return {
    id: deterministicId(content, timestamp),
    role,
    content,
    createdAt: timestamp,
    metadata: {
      agent: 'copilot',
      format: 'events',
      eventType,
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

  // ETM-produced LSL tranche format (current): `## Prompt Set (ps_<id>)`
  // blocks with `**User Request:**` + `### <ToolName>` sub-blocks. Detected
  // by presence of the prompt-set marker near the top of the file. Falls
  // through to the legacy ### Human/Assistant parser when not detected.
  if (isLslTrancheFormat(mdContent)) {
    return parseLslTranche(mdContent, options);
  }

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
 * Detect the ETM-produced LSL tranche format. Triggers on the first
 * `## Prompt Set (ps_<id>)` block or the `<a name="ps_<id>">` anchor.
 */
function isLslTrancheFormat(content) {
  // Scan only the first 4kB so a Cursor-export with an inline mention
  // of "Prompt Set" in a code fence doesn't accidentally trigger.
  const head = content.slice(0, 4096);
  return /^##\s+Prompt Set\s*\(ps_\d+\)/m.test(head)
    || /<a\s+name="ps_\d+"><\/a>/m.test(head);
}

/**
 * Parse a single ETM LSL tranche file into MastraDBMessages.
 *
 * Each `## Prompt Set (ps_<id>)` block becomes a user + assistant pair:
 *   - user message: the literal `**User Request:** <text>` value
 *   - assistant message: tool-call synthesis (one line per `### <ToolName>`
 *     sub-block, plus the first 200 chars of each tool's Output). This
 *     gives the LLM enough signal to summarize the exchange into a
 *     meaningful observation without exploding the token budget.
 *
 * Timestamps come from each prompt set's `**Time:** <ISO>` field; falls
 * back to filename-derived base + per-set offset.
 */
function parseLslTranche(content, options = {}) {
  const messages = [];
  const baseTimestamp = extractSpecstoryTimestamp(content, options.sourceFile);
  const sourceFile = options.sourceFile || undefined;

  // Split on prompt-set headings while preserving the header line itself
  // for downstream regex extraction. Use the `## Prompt Set (ps_<id>)`
  // anchor so we don't split on `### <ToolName>` sub-headings.
  const parts = content.split(/(?=^##\s+Prompt Set\s*\(ps_\d+\))/m);

  let setIndex = 0;
  for (const part of parts) {
    if (!/^##\s+Prompt Set\s*\(ps_(\d+)\)/m.test(part)) continue;

    const idMatch = part.match(/^##\s+Prompt Set\s*\(ps_(\d+)\)/m);
    const psId = idMatch ? `ps_${idMatch[1]}` : `ps_${setIndex}`;

    // Block-level timestamp; fall back to filename-derived ordering.
    const timeMatch = part.match(/^\*\*Time:\*\*\s+(\S+)/m);
    let blockTs;
    if (timeMatch) {
      const parsed = new Date(timeMatch[1]);
      blockTs = isNaN(parsed.getTime()) ? offsetTimestamp(baseTimestamp, setIndex) : parsed.toISOString();
    } else {
      blockTs = offsetTimestamp(baseTimestamp, setIndex);
    }

    // First **User Request:** line in the block is the canonical user prompt.
    // Subsequent identical occurrences in sibling tool blocks repeat it.
    const userMatch = part.match(/^\*\*User Request:\*\*\s+(.+?)(?:\n|$)/m);
    const userText = userMatch ? userMatch[1].trim() : '';

    if (!userText) {
      // No user prompt → cannot anchor an observation; skip the block.
      setIndex++;
      continue;
    }

    // Tool-call synthesis: one bullet per `### <ToolName>` sub-block plus
    // a truncated Output preview. Cap to 4000 chars total to keep the
    // assistant message bounded.
    const toolBlocks = part.split(/(?=^###\s+\S)/m).slice(1);
    const toolLines = [];
    let synthLen = 0;
    const SYNTH_CAP = 4000;
    for (const tb of toolBlocks) {
      const nameMatch = tb.match(/^###\s+(\S+)/);
      const name = nameMatch ? nameMatch[1] : 'Tool';
      const resultMatch = tb.match(/^\*\*Result:\*\*\s+(.+?)$/m);
      const resultIcon = resultMatch ? resultMatch[1].trim().split(/\s+/)[0] : '';
      // Pick first non-empty Output line, truncated.
      const outMatch = tb.match(/\*\*Output:\*\*\s*```[a-z]*\n([\s\S]*?)```/);
      const outPreview = outMatch
        ? outMatch[1].trim().split('\n').slice(0, 2).join(' ').slice(0, 200)
        : '';
      const line = outPreview
        ? `- ${name} ${resultIcon}: ${outPreview}`
        : `- ${name} ${resultIcon}`;
      if (synthLen + line.length > SYNTH_CAP) {
        toolLines.push(`- ... (${toolBlocks.length - toolLines.length} more tool calls truncated)`);
        break;
      }
      toolLines.push(line);
      synthLen += line.length + 1;
    }
    const assistantText = toolLines.length > 0
      ? `Tool-call synthesis (${toolBlocks.length} calls):\n${toolLines.join('\n')}`
      : '(no tool calls)';

    messages.push({
      id: deterministicId(userText, blockTs),
      role: 'user',
      content: userText,
      createdAt: blockTs,
      metadata: {
        agent: 'claude',
        format: 'lsl-tranche',
        sourceFile,
        promptSetId: psId,
      },
    });
    messages.push({
      id: deterministicId(assistantText, blockTs),
      role: 'assistant',
      content: assistantText,
      createdAt: offsetTimestamp(blockTs, 1),
      metadata: {
        agent: 'claude',
        format: 'lsl-tranche',
        sourceFile,
        promptSetId: psId,
      },
    });

    setIndex++;
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
