/**
 * PiSessionWriter - emits pi session JSONL entries for LSL tranche files.
 *
 * ONE emitter serves both producers, so their output cannot drift:
 *   - the ETM runtime, converting live `exchange` objects (exchangesToBlocks)
 *   - the backfill, converting parsed legacy markdown (LslMarkdownParser)
 * Both normalise to the same `block` shape and call the same entry builders.
 *
 * FORMAT (pi session version 3; see PiSessionReader.js for the read side)
 * ----------------------------------------------------------------------
 *   session          file header; `parentSession` chains rotation parts
 *   session_info     human title ("WORK SESSION (1100-1200)")
 *   custom           `lsl.tranche`   - the SPINE; tranche metadata
 *   custom           `lsl.promptSet` - one per prompt set, parented to spine
 *   message          role=user | assistant | toolResult
 *   label            bookmarks a set on its first user message
 *
 * WHY A SPINE RATHER THAN ONE LONG CHAIN
 * --------------------------------------
 * Every prompt set parents off the single spine entry, so a set is a
 * self-contained subtree. Removing one (the idempotent re-flush that
 * _removeExistingPromptSetBlock used to do with regex surgery on markdown) is
 * then a line filter with no re-linking. Verified safe to render: pi's export
 * walks `entries` in file order, not the branch to `leafId`, so sibling
 * subtrees all display.
 *
 * WHY METADATA GOES IN `custom` AND NOT `custom_message`
 * ------------------------------------------------------
 * `custom` payloads round-trip through `pi --export` verbatim but are not
 * rendered (they are classed as settings entries). `custom_message` WOULD
 * render, but it also enters LLM context via buildSessionContext(), which
 * would poison a future `pi --resume` of an archived tranche. Anything a human
 * must see goes in `session_info` or a `label` instead.
 */

import crypto from 'crypto';

export const SESSION_VERSION = 3;

const USAGE_ZERO = Object.freeze({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/** 8-hex entry id, matching pi's own id width. */
export function entryId(seed) {
  return crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 8);
}

/** Stable uuid derived from a name, so re-running a conversion is idempotent. */
export function uuidFrom(name) {
  return crypto.createHash('sha1').update(String(name)).digest('hex')
    .replace(/^(.{8})(.{4})(.{3})(.{3})(.{12}).*$/, '$1-$2-4$3-8$4-$5');
}

/** Deterministic id sequence for one file; `random` for live writes. */
export function makeIdGen(seed) {
  if (seed === 'random') return () => crypto.randomBytes(4).toString('hex');
  let n = 0;
  return () => entryId(`${seed}:${n++}`);
}

const iso = (v, fallback) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
};

export function sessionHeader({ id, timestamp, cwd, parentSession }) {
  return {
    type: 'session', version: SESSION_VERSION, id, timestamp, cwd,
    ...(parentSession ? { parentSession } : {}),
  };
}

/**
 * Tranche header: `session_info` + the `lsl.tranche` spine.
 * @returns {{entries: object[], spineId: string, infoId: string}}
 */
export function buildTrancheEntries(meta, idGen, timestamp) {
  const infoId = idGen();
  const spineId = idGen();
  const title = `WORK SESSION (${meta.timeWindow || '?'})`
    + (meta.fromProject ? ` — from ${meta.fromProject}` : '');
  return {
    infoId,
    spineId,
    entries: [
      { type: 'session_info', id: infoId, parentId: null, timestamp, name: title },
      {
        type: 'custom', id: spineId, parentId: infoId, timestamp,
        customType: 'lsl.tranche', data: { ...meta },
      },
    ],
  };
}

/**
 * Build the entries for one prompt set, as a subtree hanging off `spineId`.
 * @param {object} o
 * @param {string} o.promptSetId
 * @param {Array}  o.blocks     normalised blocks (see exchangesToBlocks)
 * @param {string} o.spineId
 * @param {object} [o.meta]     slice/duration/toolCall counts, classification
 * @param {function} o.idGen
 * @param {string} o.fallbackIso
 * @returns {object[]}
 */
export function buildPromptSetEntries({ promptSetId, blocks, spineId, meta = {}, idGen, fallbackIso }) {
  const psIso = iso(meta.time, fallbackIso);
  const psId = idGen();
  const out = [{
    type: 'custom', id: psId, parentId: spineId, timestamp: psIso,
    customType: 'lsl.promptSet', data: { promptSetId, ...meta },
  }];

  let parentId = psId;
  let lastUser = null;
  let firstUserId = null;
  const provider = meta.agent || 'unknown';

  for (const b of blocks) {
    const bIso = iso(b.time, psIso);
    const ts = new Date(bIso).getTime();

    // The markdown writer repeated **User Request:** on every tool block; emit
    // a user message only when the text actually changes.
    if (b.userText && b.userText !== lastUser) {
      const id = idGen();
      out.push({
        type: 'message', id, parentId, timestamp: bIso,
        message: { role: 'user', content: [{ type: 'text', text: b.userText }], timestamp: ts },
      });
      parentId = id;
      lastUser = b.userText;
      firstUserId ??= id;
    }

    if (b.kind === 'text') {
      if (!b.assistantText) continue;
      const id = idGen();
      out.push({
        type: 'message', id, parentId, timestamp: bIso,
        message: {
          role: 'assistant', content: [{ type: 'text', text: b.assistantText }],
          api: b.api || 'lsl', provider, model: b.model || 'unknown',
          usage: b.usage || USAGE_ZERO, stopReason: 'stop', timestamp: ts,
        },
      });
      parentId = id;
      continue;
    }

    let args = b.input;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { _raw: args }; } }
    if (args == null || typeof args !== 'object') args = {};

    const callId = b.toolCallId || `tc_${idGen()}`;
    const aId = idGen();
    out.push({
      type: 'message', id: aId, parentId, timestamp: bIso,
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: callId, name: b.toolName, arguments: args }],
        api: b.api || 'lsl', provider, model: b.model || 'unknown',
        usage: b.usage || USAGE_ZERO, stopReason: 'toolUse', timestamp: ts,
      },
    });

    const details = {};
    if (b.analysis) details.lslAnalysis = b.analysis;
    if (b.truncated) details.lslTruncated = { reason: 'missing-part', afterPart: b.part ?? null };
    const rId = idGen();
    out.push({
      type: 'message', id: rId, parentId: aId, timestamp: bIso,
      message: {
        role: 'toolResult', toolCallId: callId, toolName: b.toolName,
        content: [{ type: 'text', text: b.output ?? '' }],
        isError: Boolean(b.isError), timestamp: ts,
        ...(Object.keys(details).length ? { details } : {}),
      },
    });
    parentId = rId;
  }

  if (firstUserId) {
    out.push({
      type: 'label', id: idGen(), parentId, timestamp: psIso,
      targetId: firstUserId, label: promptSetId,
    });
  }
  return out;
}

/**
 * Normalise live ETM `exchange` objects into blocks.
 *
 * Mirrors what formatExchangeForLogging/formatToolCallContent used to write:
 * one block per tool call, plus a text block when the exchange has no tools.
 */
export function exchangesToBlocks(exchanges, { formatTime } = {}) {
  const blocks = [];
  for (const ex of exchanges) {
    const time = formatTime ? formatTime(ex.timestamp) : ex.timestamp;
    const userText = (ex.userMessage && String(ex.userMessage).trim())
      || (ex.humanMessage && String(ex.humanMessage).trim()) || null;
    const toolCalls = ex.toolCalls || [];

    if (toolCalls.length === 0) {
      const assistantText = ex.assistantResponse || ex.claudeResponse || null;
      if (userText || assistantText) {
        blocks.push({ kind: 'text', time, userText, assistantText: assistantText || null });
      }
      continue;
    }
    for (const tc of toolCalls) {
      const result = ex.results?.[tc.id] ?? tc.result ?? null;
      const raw = result?.content;
      blocks.push({
        kind: 'tool', time, userText,
        toolName: tc.function?.name || tc.name || 'Unknown Tool',
        toolCallId: tc.id || null,
        input: tc.function?.arguments ?? tc.input ?? tc.parameters ?? {},
        isError: Boolean(result?.is_error),
        output: raw == null ? '' : (typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)),
      });
    }
  }
  return blocks;
}

/** Convert LslMarkdownParser blocks (already the right shape) for a set. */
export const markdownBlocksToBlocks = (blocks) => blocks;

/** Serialize entries to JSONL (trailing newline, ready to append). */
export function serialize(entries) {
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

/**
 * Remove every entry belonging to a prompt set — the JSONL replacement for
 * _removeExistingPromptSetBlock()'s regex block surgery on markdown.
 *
 * Because a set is a subtree rooted at its `lsl.promptSet` entry, removal is a
 * reachability filter: drop that entry and everything transitively parented to
 * it. No re-linking, and nothing outside the set can be caught by accident.
 *
 * @param {string} text - full JSONL file contents
 * @param {string} promptSetId
 * @returns {{text: string, removed: number}}
 */
export function removePromptSet(text, promptSetId) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const parsed = lines.map((l) => {
    try { return { l, e: JSON.parse(l) }; } catch { return { l, e: null }; }
  });
  const doomed = new Set();
  for (const { e } of parsed) {
    if (e && e.type === 'custom' && e.customType === 'lsl.promptSet'
        && e.data?.promptSetId === promptSetId) {
      doomed.add(e.id);
    }
  }
  if (doomed.size === 0) return { text, removed: 0 };
  // Entries are appended in tree order, so one forward pass closes the subtree.
  for (const { e } of parsed) {
    if (e && e.parentId && doomed.has(e.parentId)) doomed.add(e.id);
  }
  const kept = parsed.filter(({ e }) => !(e && doomed.has(e.id)));
  return {
    text: kept.length ? kept.map((k) => k.l).join('\n') + '\n' : '',
    removed: parsed.length - kept.length,
  };
}
