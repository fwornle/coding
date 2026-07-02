// lib/repro/fixtures/harness-record.mjs
//
// Phase 67, Plan 67-02 (Wave 2) — D-08 harness channel (WebSearch / WebFetch /
// MCP), shipped as an HONEST record-present / replay-hard-fails pair.
//
// WHY the split (RESEARCH feasibility verdict, Assumption A1): these tools run
// inside the Claude harness, not the rapid-llm-proxy, so there is NO in-repo tap
// that could feed them synthetic tool results on replay. Rather than silently
// hitting the live services (which would destroy run-to-run comparability —
// D-06 / SC-4), we:
//
//   • record() is REAL — a post-hoc scrape of the Claude transcript JSONL for
//     the tool_use/tool_result pairs whose tool is WebSearch/WebFetch/MCP and
//     whose invocation timestamp falls within the run's span window. This
//     mirrors the transcript-reader contract in lib/lsl/route/build-trace.mjs
//     (env-override → home default; inclusive lexical ISO-8601 window compare).
//
//   • replay() is UNSUPPORTED BY DESIGN — replayHarnessChannel(name) throws
//     `REPLAY_UNSUPPORTED_CHANNEL: <name>`. It NEVER returns a fabricated or
//     live result. The integration layer (Plan 07) surfaces this at span-open
//     when a run is armed for replay, so the operator learns up-front that a
//     harness channel cannot be reproduced — not mid-run via a silent live hit.
//
// The recorder is BEST-EFFORT (never throws on the hot path): all I/O is wrapped
// in try/catch and it returns a written-count (0 on any failure). Fixtures are
// written ONLY under the caller-provided span/snapshot `outDir` (T-67-02-01 —
// tool_result content may carry fetched web content or PII, so it must never
// land in a tracked repo path; tests use mkdtemp only).
//
// Convention: pure ESM (no build step). No console.* (no-console-log).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** Home default for the Claude transcript store (this repo's project slug). */
const HOME_TRANSCRIPT_DIR = path.join(
  os.homedir(), '.claude', 'projects', '-Users-Q284340-Agentic-coding',
);

/** The harness tools whose replay is unsupported by design (D-06 / SC-4). */
const HARNESS_CHANNELS = Object.freeze(['WebSearch', 'WebFetch', 'MCP']);

/**
 * Resolve the transcript directory: explicit opt → `LSL_CLAUDE_PROJECTS_DIR`
 * env override → `~/.claude/projects/-Users-Q284340-Agentic-coding` home
 * default (mirrors lib/lsl/route/build-trace.mjs env-override → home-default).
 * @param {{transcriptDir?: string}} opts
 * @returns {string}
 */
function resolveTranscriptDir(opts) {
  if (opts && typeof opts.transcriptDir === 'string' && opts.transcriptDir) {
    return opts.transcriptDir;
  }
  return process.env.LSL_CLAUDE_PROJECTS_DIR || HOME_TRANSCRIPT_DIR;
}

/**
 * True iff `name` is a harness tool we record: WebSearch, WebFetch, or an MCP
 * tool (Claude MCP tools are named `mcp__<server>__<tool>`).
 * @param {unknown} name
 * @returns {boolean}
 */
function isHarnessTool(name) {
  if (typeof name !== 'string') return false;
  return name === 'WebSearch' || name === 'WebFetch' || name.startsWith('mcp__');
}

/**
 * Inclusive lexical ISO-8601 UTC window compare (build-trace.mjs:30-35 contract).
 * @param {string} ts
 * @param {string} lo
 * @param {string} hi
 * @returns {boolean}
 */
function inWindow(ts, lo, hi) {
  return typeof ts === 'string' && ts.length > 0 && ts >= lo && ts <= hi;
}

/**
 * Sanitize a tool_use id into a safe fixture filename component.
 * @param {string} id
 * @returns {string}
 */
function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Extract the content blocks of a parsed transcript line's `message`.
 * @param {any} rec
 * @returns {any[]}
 */
function contentBlocks(rec) {
  const content = rec && rec.message && rec.message.content;
  return Array.isArray(content) ? content : [];
}

/**
 * Record the harness (WebSearch/WebFetch/MCP) tool_use/tool_result pairs that
 * fall within a run's span window into `<outDir>/harness/`.
 *
 * BEST-EFFORT — never throws. Returns the number of fixtures written (0 on any
 * error or when no in-window harness pairs exist).
 *
 * @param {object} opts
 * @param {string} [opts.transcriptDir] Explicit transcript dir (else
 *        `LSL_CLAUDE_PROJECTS_DIR` → home default).
 * @param {string} opts.startedAt Span start (inclusive), ISO-8601 UTC.
 * @param {string} opts.endedAt   Span end (inclusive), ISO-8601 UTC.
 * @param {string} opts.outDir    Span/snapshot fixtures root; pairs land under
 *        `<outDir>/harness/`.
 * @returns {number}
 */
export function recordHarnessFixtures(opts = {}) {
  try {
    const { startedAt, endedAt, outDir } = opts;
    if (!startedAt || !endedAt || !outDir) return 0;

    const dir = resolveTranscriptDir(opts);
    if (!fs.existsSync(dir)) return 0;

    const jsonlFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) return 0;

    // Pass 1: index tool_use blocks (tool name + invocation timestamp) by id.
    // Pass 2 (interleaved): collect tool_result / toolUseResult payloads by id.
    /** @type {Map<string, {name:string, startedAt:string, input:any}>} */
    const uses = new Map();
    /** @type {Map<string, {result:any, endedAt:string}>} */
    const results = new Map();

    for (const file of jsonlFiles) {
      let raw;
      try {
        raw = fs.readFileSync(path.join(dir, file), 'utf8');
      } catch {
        continue; // best-effort per file
      }
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let rec;
        try {
          rec = JSON.parse(trimmed);
        } catch {
          continue; // skip malformed lines
        }
        const ts = typeof rec.timestamp === 'string' ? rec.timestamp : '';

        // Top-level toolUseResult (some Claude transcript shapes attach it to
        // the user turn) — keyed by tool_use_id when present.
        if (rec.toolUseResult && typeof rec.toolUseResult === 'object') {
          const id = rec.toolUseResult.tool_use_id
            || rec.toolUseResult.toolUseId;
          if (id) results.set(String(id), { result: rec.toolUseResult, endedAt: ts });
        }

        for (const block of contentBlocks(rec)) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'tool_use' && isHarnessTool(block.name)) {
            uses.set(String(block.id), {
              name: block.name,
              startedAt: ts,
              input: block.input,
            });
          } else if (block.type === 'tool_result' && block.tool_use_id) {
            results.set(String(block.tool_use_id), {
              result: block.content,
              endedAt: ts,
            });
          }
        }
      }
    }

    // Emit one fixture per harness tool_use whose invocation timestamp is in the
    // span window. Pair it with its recorded tool_result when available.
    const outHarness = path.join(outDir, 'harness');
    let written = 0;
    for (const [id, use] of uses) {
      if (!inWindow(use.startedAt, startedAt, endedAt)) continue;
      const res = results.get(id);
      const record = {
        tool: use.name,
        tool_use_id: id,
        input: use.input,
        started_at: use.startedAt,
        result: res ? res.result : null,
        ended_at: res ? res.endedAt : null,
      };
      try {
        fs.mkdirSync(outHarness, { recursive: true });
        fs.writeFileSync(
          path.join(outHarness, `${safeName(id)}.json`),
          JSON.stringify(record),
          'utf8',
        );
        written += 1;
      } catch {
        // best-effort: a single fixture write failure never aborts the scrape.
      }
    }
    return written;
  } catch {
    // Best-effort: recording must never break or slow the surrounding run.
    return 0;
  }
}

/**
 * Replay of a harness channel is UNSUPPORTED BY DESIGN (RESEARCH Assumption
 * A1): these tools run in the Claude harness, which cannot be fed synthetic
 * tool results from the repo. This ALWAYS throws — it NEVER returns a fabricated
 * or live result (D-06 / SC-4 comparability guarantee). The integration layer
 * (Plan 07) surfaces this at span-open so the operator learns a channel is
 * non-reproducible up-front rather than via a silent live hit mid-run.
 *
 * @param {string} name The harness channel (WebSearch | WebFetch | MCP | mcp__*).
 * @returns {never} always throws.
 */
export function replayHarnessChannel(name) {
  throw new Error(
    `REPLAY_UNSUPPORTED_CHANNEL: ${name} — harness channels (`
    + `${HARNESS_CHANNELS.join('/')}) cannot be replayed from fixtures; `
    + 'record is post-hoc only (D-06/D-08/SC-4).',
  );
}
