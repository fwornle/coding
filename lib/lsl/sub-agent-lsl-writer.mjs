/**
 * lib/lsl/sub-agent-lsl-writer.mjs — D-LSL-Filename sub-agent writer.
 *
 * Phase 51 Plan 06 Task 2.
 *
 * Produces sub-agent LSL files matching the locked CONTEXT.md convention:
 *
 *   {YYYY-MM-DD}_{HHHH-HHHH}_S{parent-slot}-{sub-index}-{sub-hash}[-part{N}].md
 *
 * Per-agent sub_hash rule (CONTEXT.md D-LSL-Filename, planner-locked):
 *   claude   → agentId[:7]
 *   copilot  → stripPrefix(toolCallId)[:7]   (toolu_vrtx_ stripped)
 *   opencode → session.id[:7]                (full 'ses_XXXX' prefix)
 *   mastra   → subAgentSessionId[:7]         (forward-compat)
 *
 * The 7-char sub_hash is the SHORT prefix carried in the filename. The
 * full per-agent session identifier travels in the frontmatter's
 * `sub_session_id:` field so downstream consumers can recover the
 * original identifier when needed (Test 7).
 *
 * Format B labels are non-negotiable (Plan 50-01 §Dual LSL format parser):
 *   `**User Message:**` and `**Assistant Response:**` with
 *   `<a name="ps_<unix-ms>"></a>` anchors. These are the labels Phase 50's
 *   `lib/lsl/window.mjs` parser consumes — see parseLSLFile() Format B
 *   block. The writer NEVER emits `### User` / `### Assistant` (older
 *   specstory shape).
 *
 * Idempotency (Test 9): files are not overwritten when they already exist
 * unless `force: true` is passed. The slot allocator state file
 * (`.data/sub-agent-slot-state.json`) carries the parentSlot mapping so
 * reruns produce stable filenames.
 *
 * Backward-compat (Test 8): existing parent LSL files
 * (`{YYYY-MM-DD}_{HHHH-HHHH}_{userhash}.md` without an `_S{n}-` segment)
 * are NEVER touched. The `S` segment makes filename collision impossible
 * by construction.
 *
 * Atomic write semantics (T-51-06-CR): all on-disk writes go through a
 * `<path>.tmp` sibling + `fs.renameSync` swap — matches Plan 50-03's
 * lsl-resolver-job.sh state-file pattern.
 *
 * Per CLAUDE.md no-console-log rule: this module emits no console calls.
 *
 * Pure ESM. Zero new package installs.
 */

import fs from 'node:fs';
import path from 'node:path';

import { allocateSlot } from './sub-agent-slot-allocator.mjs';

/**
 * Per-file byte threshold for chunking (Test 11). Matches the implicit
 * cap that Phase 50's window parser is comfortable with on a single
 * LSL file — kept conservative at 100 KB so resolver windows over a
 * heavy sub-agent fan-out don't blow the parser's per-file buffer.
 */
export const CHUNK_THRESHOLD_BYTES = 100 * 1024;

/**
 * Per-block tool-output strip threshold. Matches Plan 50-01's
 * `stripToolBlocks()` regex idiom — keeps the LSL files readable by
 * humans while preserving the user/assistant turn structure.
 */
const TOOL_BLOCK_RE = /```(?:tool_use|tool_result|json)[\s\S]*?```/g;

/**
 * Defensive subHash validator. The D-LSL-Filename spec is verbatim
 * "first 7 characters of the per-agent identifier" — anything else is a
 * planner-rule violation. Throw early so the bug surfaces in tests
 * rather than producing a malformed filename on disk.
 */
function assertSubHashLength(subHash) {
  if (typeof subHash !== 'string' || subHash.length !== 7) {
    throw new RangeError(
      `computeLSLFilename: sub_hash must be exactly 7 chars; got "${subHash}" (length ${subHash ? subHash.length : 0})`,
    );
  }
  // Charset gate (T-51-06-FI): only [A-Za-z0-9_] allowed so the filename
  // cannot embed path traversal or shell metacharacters.
  if (!/^[A-Za-z0-9_]+$/.test(subHash)) {
    throw new RangeError(`computeLSLFilename: sub_hash "${subHash}" contains disallowed characters`);
  }
}

/**
 * Pure filename helper. Validates subHash, derives the date string (YYYY-MM-DD)
 * from a Date or ISO string, and assembles the D-LSL-Filename shape.
 *
 * @param {object} args
 * @param {Date|string} args.date
 * @param {string}      args.hhhh_hhhh  e.g. '1400-1500'
 * @param {number}      args.parentSlot 1-indexed
 * @param {number}      args.subIndex   1-indexed
 * @param {string}      args.subHash    exactly 7 chars from per-agent rule
 * @param {number|null} [args.partNumber] omit/null for non-chunked
 * @returns {string} filename basename (no directory)
 */
export function computeLSLFilename({
  date,
  hhhh_hhhh,
  parentSlot,
  subIndex,
  subHash,
  partNumber,
}) {
  assertSubHashLength(subHash);
  let dateStr;
  if (date instanceof Date) {
    dateStr = date.toISOString().slice(0, 10);
  } else if (typeof date === 'string') {
    // Accept ISO timestamps or bare 'YYYY-MM-DD'.
    dateStr = date.slice(0, 10);
  } else {
    throw new TypeError('computeLSLFilename: date must be Date or string');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new RangeError(`computeLSLFilename: invalid date "${date}"`);
  }
  if (!/^\d{4}-\d{4}$/.test(hhhh_hhhh)) {
    throw new RangeError(`computeLSLFilename: invalid hhhh_hhhh "${hhhh_hhhh}"`);
  }
  if (!Number.isInteger(parentSlot) || parentSlot < 1) {
    throw new RangeError(`computeLSLFilename: parentSlot must be a positive integer; got ${parentSlot}`);
  }
  if (!Number.isInteger(subIndex) || subIndex < 1) {
    throw new RangeError(`computeLSLFilename: subIndex must be a positive integer; got ${subIndex}`);
  }
  const partSuffix = partNumber != null ? `-part${partNumber}` : '';
  // D-LSL-Filename literal template: `S${parentSlot}-${subIndex}-${subHash}`.
  return `${dateStr}_${hhhh_hhhh}_S${parentSlot}-${subIndex}-${subHash}${partSuffix}.md`;
}

/**
 * Derive the canonical full sub-session identifier from the row's
 * agent-specific metadata. The 7-char sub_hash is a PREFIX of this
 * identifier; the writer emits the full id into frontmatter so consumers
 * can recover it without storing a separate side-table.
 *
 * @param {object} row Plan 51-01 Registry row.
 * @returns {string|null}
 */
function subSessionIdFromRow(row) {
  const meta = row.agent_metadata || {};
  switch (row.agent) {
    case 'claude': return meta.agent_id || null;
    case 'copilot': return meta.toolCallId || null;
    case 'opencode': return meta.session_id || null;
    case 'mastra': return meta.subAgentSessionId || null;
    default: return null;
  }
}

/**
 * Compute the local LSL date and hhhh_hhhh window from a list of
 * exchange timestamps. Uses UTC throughout for deterministic test output;
 * mirrors the existing parent LSL convention where the filename's HH
 * fields are UTC-derived (see window.mjs:parseLSLFilenameStart).
 *
 * Returns { dateKey, hhhh_hhhh, firstMs, lastMs }.
 */
function deriveTimeWindow(exchanges) {
  if (!Array.isArray(exchanges) || exchanges.length === 0) {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const hh = now.toISOString().slice(11, 13);
    return {
      dateKey,
      hhhh_hhhh: `${hh}00-${hh}00`,
      firstMs: now.getTime(),
      lastMs: now.getTime(),
    };
  }
  const stamps = exchanges
    .map((e) => Date.parse(e.timestamp || ''))
    .filter((n) => Number.isFinite(n));
  if (stamps.length === 0) {
    const now = new Date();
    return {
      dateKey: now.toISOString().slice(0, 10),
      hhhh_hhhh: `${now.toISOString().slice(11, 13)}00-${now.toISOString().slice(11, 13)}00`,
      firstMs: now.getTime(),
      lastMs: now.getTime(),
    };
  }
  const firstMs = Math.min(...stamps);
  const lastMs = Math.max(...stamps);
  const first = new Date(firstMs);
  const last = new Date(lastMs);
  const dateKey = first.toISOString().slice(0, 10);
  const hhStart = first.toISOString().slice(11, 13);
  const mmStart = first.toISOString().slice(14, 16);
  const hhEnd = last.toISOString().slice(11, 13);
  const mmEnd = last.toISOString().slice(14, 16);
  const hhhh_hhhh = `${hhStart}${mmStart}-${hhEnd}${mmEnd}`;
  return { dateKey, hhhh_hhhh, firstMs, lastMs };
}

/**
 * Build the YAML frontmatter block (without surrounding `---` fences;
 * caller wraps).
 */
function buildFrontmatter(row, exchanges, { partNumber, partTotal } = {}) {
  const meta = row.agent_metadata || {};
  const lslIncomplete = Boolean(meta.lsl_incomplete);
  const lslIncompleteReason = meta.lsl_incomplete_reason || null;
  const subSessionId = subSessionIdFromRow(row);
  const capturedAt = new Date().toISOString();
  const lines = [
    `agent: ${row.agent}`,
    `parent_session_id: ${row.parent_session_id}`,
    `sub_index: ${row.sub_index}`,
    `sub_hash: ${row.sub_hash}`,
    `project: ${row.project}`,
    `sub_session_id: ${subSessionId == null ? 'null' : subSessionId}`,
    `lsl_incomplete: ${lslIncomplete}`,
    `lsl_incomplete_reason: ${lslIncompleteReason == null ? 'null' : lslIncompleteReason}`,
    `captured_via: sub-agent-backfill`,
    `captured_at: ${capturedAt}`,
  ];
  if (partNumber != null) {
    lines.push(`part_number: ${partNumber}`);
    lines.push(`part_total: ${partTotal}`);
  }
  return lines.join('\n');
}

/**
 * Strip tool-output fenced blocks (`tool_use|tool_result|json`) when they
 * exceed 10 KB in a single block — preserves the readable structure but
 * keeps the LSL file size in check. Same regex idiom as Plan 50-01
 * `stripToolBlocks()`.
 */
function shrinkLargeToolBlocks(text) {
  return text.replace(TOOL_BLOCK_RE, (block) => {
    if (block.length > 10 * 1024) return '[tool-output trimmed]';
    return block;
  });
}

/**
 * Render a single exchange as a Format-B section. `exchange` may carry
 * either `{role:'user'|'assistant', content, timestamp}` shape (writer
 * input contract — Plan 51-06 <interfaces>) OR a flattened
 * `{user, assistant, timestamp}` shape (defensive fallback). The
 * function normalizes both into the same output.
 *
 * Returns string with trailing newlines so segments can be concatenated.
 */
function renderExchangeSegment(userExchange, assistantExchange) {
  const userTs = userExchange && userExchange.timestamp
    ? Date.parse(userExchange.timestamp)
    : null;
  const anchor = Number.isFinite(userTs)
    ? `<a name="ps_${userTs}"></a>\n`
    : '';
  const userContent = userExchange
    ? shrinkLargeToolBlocks(String(userExchange.content || ''))
    : '';
  const assistantContent = assistantExchange
    ? shrinkLargeToolBlocks(String(assistantExchange.content || ''))
    : '';
  const parts = [];
  parts.push(`${anchor}**User Message:**\n${userContent}\n`);
  if (assistantExchange) {
    parts.push(`**Assistant Response:**\n${assistantContent}\n`);
  }
  return parts.join('\n');
}

/**
 * Pair user/assistant exchanges into segments. Exchanges come in as
 * `Array<{role, content, timestamp}>` (writer's documented shape).
 * Returns Array<{segment, byteSize}> in chronological order.
 */
function pairExchangesIntoSegments(exchanges) {
  const segments = [];
  let i = 0;
  while (i < exchanges.length) {
    const cur = exchanges[i];
    if (!cur) {
      i += 1;
      continue;
    }
    if (cur.role === 'user') {
      const next = exchanges[i + 1];
      if (next && next.role === 'assistant') {
        const seg = renderExchangeSegment(cur, next);
        segments.push({ segment: seg, byteSize: Buffer.byteLength(seg, 'utf-8') });
        i += 2;
        continue;
      }
      // Orphan user message — emit as user-only segment.
      const seg = renderExchangeSegment(cur, null);
      segments.push({ segment: seg, byteSize: Buffer.byteLength(seg, 'utf-8') });
      i += 1;
      continue;
    }
    // Orphan assistant — emit with synthetic empty user.
    const seg = renderExchangeSegment(
      { role: 'user', content: '', timestamp: cur.timestamp },
      cur,
    );
    segments.push({ segment: seg, byteSize: Buffer.byteLength(seg, 'utf-8') });
    i += 1;
  }
  return segments;
}

/**
 * Build the markdown body (after the frontmatter fences).
 */
function buildBody(exchanges, headingTs) {
  const heading = `# Sub-agent session — ${headingTs.firstIso} to ${headingTs.lastIso}\n\n`;
  const segments = pairExchangesIntoSegments(exchanges);
  return heading + segments.map((s) => s.segment).join('\n');
}

/**
 * Split a list of pre-rendered exchange segments into N chunks each
 * under CHUNK_THRESHOLD_BYTES, snapping at segment boundaries (never
 * mid-content). Returns Array<string> — each entry is the body portion
 * for one chunk (heading + segments). Caller wraps with frontmatter.
 */
function chunkSegments(segments, headingFn) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const { segment, byteSize } of segments) {
    if (currentBytes + byteSize > CHUNK_THRESHOLD_BYTES && current.length > 0) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(segment);
    currentBytes += byteSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.map((segList, idx) => `${headingFn(idx + 1, chunks.length)}\n\n${segList.join('\n')}`);
}

/**
 * Atomic write via .tmp sibling + renameSync. Throws on rename error
 * (caller has already mkdir'd the parent).
 */
function atomicWriteSync(filePath, text) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * writeSubAgentLSL — main entry point.
 *
 * @param {object} args
 * @param {object} args.row           Plan 51-01 Registry row.
 * @param {Array<{role:'user'|'assistant', content:string, timestamp:string}>} args.exchanges
 * @param {string} args.outputRoot    LSL history root (e.g. '.specstory/history').
 * @param {object} args.slotAllocator `{ state }` — the slot-state map (mutated in place).
 * @param {boolean} [args.dryRun=false]
 * @param {boolean} [args.force=false]
 * @returns {Promise<{filePath: string, bytesWritten: number, chunked: number, skipped: boolean}>}
 */
export async function writeSubAgentLSL({
  row,
  exchanges,
  outputRoot,
  slotAllocator,
  dryRun = false,
  force = false,
} = {}) {
  if (!row || typeof row !== 'object') throw new TypeError('writeSubAgentLSL: row is required');
  if (!Array.isArray(exchanges)) throw new TypeError('writeSubAgentLSL: exchanges must be an array');
  if (!outputRoot || typeof outputRoot !== 'string') {
    throw new TypeError('writeSubAgentLSL: outputRoot must be a string');
  }
  if (!slotAllocator || typeof slotAllocator !== 'object' || !slotAllocator.state) {
    throw new TypeError('writeSubAgentLSL: slotAllocator.state is required');
  }
  if (typeof row.sub_index !== 'number' || row.sub_index < 1) {
    throw new RangeError(`writeSubAgentLSL: row.sub_index must be a positive integer (got ${row.sub_index})`);
  }
  if (!row.sub_hash || typeof row.sub_hash !== 'string') {
    throw new TypeError('writeSubAgentLSL: row.sub_hash is required');
  }

  const { dateKey, hhhh_hhhh, firstMs, lastMs } = deriveTimeWindow(exchanges);
  const parentSlot = allocateSlot(slotAllocator.state, row.parent_session_id, dateKey);

  const year = dateKey.slice(0, 4);
  const month = dateKey.slice(5, 7);
  const targetDir = path.join(outputRoot, year, month);
  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

  const headingTs = {
    firstIso: new Date(firstMs).toISOString(),
    lastIso: new Date(lastMs).toISOString(),
  };
  const segments = pairExchangesIntoSegments(exchanges);
  const totalBytes = segments.reduce((acc, s) => acc + s.byteSize, 0);

  // Decide single-file vs chunked.
  let chunkBodies;
  if (totalBytes <= CHUNK_THRESHOLD_BYTES) {
    chunkBodies = [buildBody(exchanges, headingTs)];
  } else {
    chunkBodies = chunkSegments(
      segments,
      (i, n) => `# Sub-agent session — ${headingTs.firstIso} to ${headingTs.lastIso} (part ${i}/${n})`,
    );
  }
  const totalParts = chunkBodies.length;

  let firstFilePath = null;
  let bytesWritten = 0;
  let chunkedCount = 0;
  let anyExisting = false;

  for (let i = 0; i < chunkBodies.length; i += 1) {
    const partNumber = totalParts > 1 ? i + 1 : null;
    const filename = computeLSLFilename({
      date: dateKey,
      hhhh_hhhh,
      parentSlot,
      subIndex: row.sub_index,
      subHash: row.sub_hash,
      partNumber,
    });
    const filePath = path.join(targetDir, filename);
    if (!firstFilePath) firstFilePath = filePath;

    const frontmatter = buildFrontmatter(row, exchanges, {
      partNumber: totalParts > 1 ? i + 1 : null,
      partTotal: totalParts > 1 ? totalParts : null,
    });
    const fileContent = `---\n${frontmatter}\n---\n\n${chunkBodies[i]}`;

    if (dryRun) {
      // Compute, do not write.
      continue;
    }

    if (!force && fs.existsSync(filePath)) {
      anyExisting = true;
      continue;
    }

    atomicWriteSync(filePath, fileContent);
    bytesWritten += Buffer.byteLength(fileContent, 'utf-8');
    chunkedCount += 1;
  }

  // Final classification:
  // - dry-run → skipped:false, bytesWritten:0, chunked:0
  // - all parts already existed AND nothing forced → skipped:true
  // - otherwise we wrote at least one part → skipped:false, chunked counts
  if (dryRun) {
    return {
      filePath: firstFilePath,
      bytesWritten: 0,
      chunked: 0,
      skipped: false,
    };
  }
  const allSkipped = anyExisting && chunkedCount === 0;
  return {
    filePath: firstFilePath,
    bytesWritten,
    chunked: totalParts > 1 ? chunkedCount : 0,
    skipped: allSkipped,
  };
}
