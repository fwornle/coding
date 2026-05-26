/**
 * lib/lsl/window.mjs — N-prompt LSL window walker.
 *
 * Phase 50 Plan 01 Task 1 (CONTEXT.md "Window specification" + D-Primitives).
 *
 * Walks .specstory/history/{YYYY}/{MM}/{YYYY-MM-DD}_HHMM-HHMM_*.md backward
 * from `observation.created_at` and collects the most recent N user→assistant
 * exchanges. The window is "interaction-time", not wall-clock — the wall-clock
 * ceiling is a safety net (default 24h), and a byte ceiling (default 30 KB)
 * caps prompt size by trimming tool-call/result blocks first.
 *
 * Phase 51 imports this module unchanged (CONTEXT.md D-Reuse). Do NOT modify
 * the public signature without coordinated Phase 51 follow-up.
 *
 * Pure read against the filesystem — no DB writes, no LLM calls.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Resolve the LSL root directory.
 *
 * The caller may pass:
 *   - an absolute path  → treated as the LSL root (test convenience)
 *   - a project name    → resolved to `<cwd>/.specstory/history/` for now
 *                         (Phase 50 only consumer is `coding`)
 *   - nothing           → cwd lookup for `.specstory/history/`
 */
function resolveLSLRoot(project) {
  if (project && path.isAbsolute(project)) {
    return project;
  }
  // Walk up from cwd looking for .specstory/history/
  let cwd = process.cwd();
  while (cwd && cwd !== path.dirname(cwd)) {
    const candidate = path.join(cwd, '.specstory', 'history');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    cwd = path.dirname(cwd);
  }
  return path.resolve('.specstory/history');
}

/**
 * Parse the YYYY-MM-DD_HHMM start timestamp embedded in an LSL filename.
 * Returns null when the filename does not match the canonical shape.
 */
function parseLSLFilenameStart(basename) {
  const m = basename.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})-/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  // Interpret as UTC for ordering purposes — the LSL file's own `**Time:**` field
  // is authoritative for ISO timestamps inside, but the filename start is enough
  // to coarsely order files newest-first.
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
}

/**
 * Recursively list LSL files under root matching the canonical filename shape.
 * Each entry: { absPath, basename, startMs }. Sorted by startMs descending
 * (newest first).
 *
 * Sub-agent transcripts (`-S{slot}` suffix) are deliberately excluded —
 * Phase 51 handles those.
 */
function listLSLFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  walk(root);
  out.sort((a, b) => b.startMs - a.startMs);
  return out;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.name.endsWith('.md')) continue;
      const startMs = parseLSLFilenameStart(e.name);
      if (startMs == null) continue;
      out.push({ absPath: full, basename: e.name, startMs });
    }
  }
}

/**
 * Parse a single LSL file into prompt-set exchanges.
 *
 * Returns array of `{ tsMs, userText, assistantText }`, oldest first.
 *
 * Format (verified against .specstory/history/2025/11/2025-11-14_0700-0800_g9b30a.md):
 *   <a name="ps_<unix-ms>"></a>
 *   ## Prompt Set N (ps_<unix-ms>)
 *   ...
 *   ### User
 *   <user text...>
 *   ### Assistant
 *   <assistant text — may be split across multiple ### Assistant blocks>
 *
 * Per plan W2 clarification: the `ps_<unix-ms>` anchor is the canonical
 * machine-readable timestamp source. Convert via Number() + new Date().
 */
function parseLSLFile(absPath) {
  let content;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return [];
  }

  // Split into prompt-set sections using the `<a name="ps_<ms>"></a>` anchor.
  const anchorRe = /<a name="ps_(\d+)"><\/a>/g;
  const anchors = [];
  let m;
  while ((m = anchorRe.exec(content)) !== null) {
    anchors.push({ tsMs: Number(m[1]), idx: m.index });
  }
  if (anchors.length === 0) return [];

  const exchanges = [];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].idx;
    const end = i + 1 < anchors.length ? anchors[i + 1].idx : content.length;
    const section = content.slice(start, end);

    // Extract User block (between `### User` and next `### Assistant`).
    const userMatch = section.match(/### User\s*\n([\s\S]*?)(?=\n### Assistant|\n### User|$)/);
    const userText = userMatch ? userMatch[1].trim() : '';

    // Concatenate all `### Assistant` blocks until end of section.
    const assistantBlocks = [];
    const asstRe = /### Assistant\s*\n([\s\S]*?)(?=\n### (User|Assistant)|$)/g;
    let am;
    while ((am = asstRe.exec(section)) !== null) {
      assistantBlocks.push(am[1].trim());
    }
    const assistantText = assistantBlocks.join('\n\n');

    if (!userText && !assistantText) continue;
    exchanges.push({ tsMs: anchors[i].tsMs, userText, assistantText });
  }
  return exchanges;
}

/**
 * Strip tool-call / tool-result fenced blocks from a single content string.
 *
 * Per plan W1 clarification: the regex pattern that matches the actual
 * specstory format covers fenced blocks tagged as `tool_use`, `tool_result`,
 * or `json` (the dominant tool-output dump format).
 */
function stripToolBlocks(text) {
  return text.replace(/```(?:tool_use|tool_result|json)[\s\S]*?```/g, '[tool-output stripped]');
}

/**
 * Trim a single exchange to fit within a byte budget. Strategy:
 *   1. Strip tool blocks from user+assistant content.
 *   2. If still over, truncate assistant content first (user content is more
 *      semantically important for resolving "the X" references).
 *   3. If still over, truncate user content.
 */
function trimExchangeToBudget(exchange, budget) {
  let userText = stripToolBlocks(exchange.userText || '');
  let assistantText = stripToolBlocks(exchange.assistantText || '');
  let current = Buffer.byteLength(userText, 'utf-8') + Buffer.byteLength(assistantText, 'utf-8');
  if (current <= budget) {
    return { ...exchange, userText, assistantText };
  }

  // Truncate assistant first.
  const userBytes = Buffer.byteLength(userText, 'utf-8');
  if (userBytes < budget) {
    const remaining = budget - userBytes;
    assistantText = sliceByBytes(assistantText, Math.max(0, remaining - 32)) + '… [truncated]';
  } else {
    assistantText = '';
    userText = sliceByBytes(userText, Math.max(0, budget - 32)) + '… [truncated]';
  }
  return { ...exchange, userText, assistantText };
}

function sliceByBytes(s, maxBytes) {
  // Slice on a code-point boundary so we never produce a half-UTF-8 sequence.
  const buf = Buffer.from(s, 'utf-8');
  if (buf.length <= maxBytes) return s;
  // Decode the first maxBytes; replace dangling bytes with the replacement char by truncating.
  return buf.subarray(0, maxBytes).toString('utf-8').replace(/[�]+$/g, '');
}

/**
 * Render exchange content for the LLM. Returns a single string that combines
 * user + assistant turns — this is what the resolver feeds into the prompt.
 */
function renderExchangeContent(ex) {
  const parts = [];
  if (ex.userText) parts.push(`<user>\n${ex.userText}\n</user>`);
  if (ex.assistantText) parts.push(`<assistant>\n${ex.assistantText}\n</assistant>`);
  return parts.join('\n');
}

/**
 * Public API — see CONTEXT.md D-Primitives module shape.
 *
 * @param {{created_at: string}} observation
 * @param {object} [opts]
 * @param {number} [opts.maxPrompts=3]      Primary stop condition (user-prompt count).
 * @param {number} [opts.maxWallClockMs=86400000]  Safety net (24h default).
 * @param {number} [opts.maxBytes=30720]    Prompt-size cap (30 KB default).
 * @param {string} [opts.project]           Project name or absolute LSL-root path.
 * @returns {{
 *   exchanges: Array<{role: 'user'|'assistant', content: string, timestamp: string}>,
 *   sourceFile: string|null,
 *   byteCount: number,
 *   windowSpanMs: number,
 * }}
 */
export function getLSLWindow(observation, {
  maxPrompts = 3,
  maxWallClockMs = 24 * 60 * 60 * 1000,
  maxBytes = 30 * 1024,
  project,
} = {}) {
  const empty = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
  if (!observation || !observation.created_at) return empty;

  const createdMs = Date.parse(observation.created_at);
  if (!Number.isFinite(createdMs)) return empty;
  const wallClockFloorMs = createdMs - maxWallClockMs;

  const root = resolveLSLRoot(project);
  const files = listLSLFiles(root);
  if (files.length === 0) return empty;

  // Walk files newest-first, keeping only those whose start time is ≤ created_at.
  // (A file that started slightly after created_at MIGHT contain earlier prompts
  // due to clock skew, but the canonical shape pins the start time to the filename,
  // so we trust it.)
  const candidateFiles = files.filter(f => f.startMs <= createdMs);
  if (candidateFiles.length === 0) return empty;

  /** @type {Array<{tsMs: number, content: string, sourceFile: string}>} */
  const collected = [];
  let mostRecentSource = null;
  let accumulatedBytes = 0;

  outer: for (const file of candidateFiles) {
    const exchanges = parseLSLFile(file.absPath);
    if (exchanges.length === 0) continue;

    // Walk exchanges newest-first within this file.
    for (let i = exchanges.length - 1; i >= 0; i--) {
      const ex = exchanges[i];
      // Reject exchanges that happened AFTER observation.created_at.
      if (ex.tsMs > createdMs) continue;
      // Stop if we've crossed the wall-clock floor.
      if (ex.tsMs < wallClockFloorMs) break outer;

      // Compute the rendered content size BEFORE trimming.
      const baseContent = renderExchangeContent(ex);
      const baseBytes = Buffer.byteLength(baseContent, 'utf-8');

      let finalContent = baseContent;
      let finalBytes = baseBytes;

      // Byte-ceiling enforcement: if adding this exchange whole would overflow,
      // trim tool blocks first; if still over, truncate assistant then user.
      if (accumulatedBytes + baseBytes > maxBytes) {
        const remaining = Math.max(0, maxBytes - accumulatedBytes);
        if (remaining === 0) {
          // No room at all — stop collecting further exchanges.
          break outer;
        }
        const trimmed = trimExchangeToBudget(ex, remaining);
        finalContent = renderExchangeContent(trimmed);
        finalBytes = Buffer.byteLength(finalContent, 'utf-8');
        // If even after trimming we'd still overflow, hard-truncate.
        if (accumulatedBytes + finalBytes > maxBytes) {
          finalContent = sliceByBytes(finalContent, remaining);
          finalBytes = Buffer.byteLength(finalContent, 'utf-8');
        }
      }

      collected.push({
        tsMs: ex.tsMs,
        content: finalContent,
        sourceFile: file.basename,
      });
      accumulatedBytes += finalBytes;
      if (!mostRecentSource) mostRecentSource = file.basename;

      if (collected.length >= maxPrompts) break outer;
    }
  }

  if (collected.length === 0) return empty;

  // Sort chronologically (oldest first) for the LLM.
  collected.sort((a, b) => a.tsMs - b.tsMs);

  const oldestMs = collected[0].tsMs;
  const newestMs = collected[collected.length - 1].tsMs;

  // The plan signature names exchanges as `{ role, content, timestamp }` with
  // user+assistant combined per turn — here `role` is informational ('user'
  // is the canonical anchor; the content string carries both turns).
  const exchanges = collected.map(c => ({
    role: 'user',
    content: c.content,
    timestamp: new Date(c.tsMs).toISOString(),
  }));

  // byteCount per plan W1: sum of exchanges[*].content byte sizes after trimming.
  const byteCount = exchanges.reduce(
    (acc, e) => acc + Buffer.byteLength(e.content, 'utf-8'),
    0,
  );

  return {
    exchanges,
    sourceFile: mostRecentSource,
    byteCount,
    windowSpanMs: newestMs - oldestMs,
  };
}
