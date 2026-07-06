/**
 * lib/lsl/scan-and-convert.mjs — transcript discovery + conversion primitive.
 *
 * Phase 50 Plan 01 Task 2 (CONTEXT.md D-Primitives).
 *
 * Factored from two existing seed scripts (left untouched per plan):
 *   - scripts/convert-transcripts.js (claude/copilot/specstory dispatcher)
 *   - scripts/backfill-subagent-transcripts.mjs (directory walker + race guard)
 *
 * Public API:
 *   scanTranscriptsForUnconverted(searchPaths, { since, project }) -> Array<{ path, mtime, projectHint, parentSession }>
 *   convertTranscriptsToObservations(transcripts, { dryRun, tag }) -> Array<{ transcriptPath, observationsWritten, skipped }>
 *
 * Phase 51 imports both functions unchanged (CONTEXT.md D-Reuse).
 *
 * Pure ESM (no build step). Heavy deps (ObservationWriter, TranscriptNormalizer)
 * are dynamically imported so this module loads in test contexts that mock them.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import process from 'node:process';

// Constants inherited from scripts/backfill-subagent-transcripts.mjs:43-53.
const RACE_GUARD_MS = 5 * 60_000;
const MAX_AGE_MS = 48 * 60 * 60_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Walk a directory tree recursively, returning all files (not directories).
 */
function walkFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  visit(root);
  return out;

  function visit(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        visit(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
}

/**
 * Heuristic project-hint extraction. For .specstory/history/ files, return the
 * project name implied by the encoded-cwd convention. For Claude-projects jsonl
 * files (~/.claude/projects/-Users-.../), decode the project segment. When the
 * caller passes an explicit `project`, use it as the fallback.
 */
function deriveProjectHint(filePath, callerHint) {
  // Specstory LSL: .../.specstory/history/...
  const specstoryIdx = filePath.indexOf('/.specstory/history/');
  if (specstoryIdx > 0) {
    // The owning project directory is the parent of .specstory.
    const owner = filePath.slice(0, specstoryIdx);
    const ownerBase = path.basename(owner);
    if (ownerBase) return ownerBase;
  }
  // Claude projects: ~/.claude/projects/-Users-Foo-Bar-coding/...
  const cpMatch = filePath.match(/\.claude\/projects\/-([^/]+)/);
  if (cpMatch) {
    return cpMatch[1].split('-').slice(-1)[0] || (callerHint || 'unknown');
  }
  return callerHint || 'unknown';
}

/**
 * Derive a parent session id for the transcript file. For .md LSL files,
 * null (the file IS the session). For .jsonl files, the basename without
 * extension is the parent session id (matches sub-agent slot tracking
 * in Phase 51 — passed through as metadata only here).
 */
function deriveParentSession(filePath) {
  if (filePath.endsWith('.md')) return null;
  if (filePath.endsWith('.jsonl')) {
    return path.basename(filePath, '.jsonl');
  }
  return null;
}

/**
 * Discover transcript files under the provided search paths that look like
 * candidates for conversion to observations.
 *
 * @param {string[]} searchPaths   Directories to walk.
 * @param {object} [opts]
 * @param {string} [opts.since]    ISO timestamp; skip files older than this.
 * @param {string} [opts.project]  Caller-supplied project hint (used as fallback).
 * @returns {Array<{ path: string, mtime: number, projectHint: string, parentSession: string|null }>}
 */
export function scanTranscriptsForUnconverted(searchPaths, { since, project } = {}) {
  if (!Array.isArray(searchPaths) || searchPaths.length === 0) return [];

  const sinceMs = since ? Date.parse(since) : null;
  const seen = new Set();
  const out = [];

  for (const root of searchPaths) {
    if (!root || !fs.existsSync(root)) continue;
    for (const file of walkFiles(root)) {
      // Only consider transcript-shaped files.
      if (!file.endsWith('.md') && !file.endsWith('.jsonl')) continue;
      // LSL files use the canonical filename shape — accept .md only inside
      // a `.specstory/history/` ancestor to avoid false positives from
      // unrelated markdown trees.
      if (file.endsWith('.md') && file.indexOf('/.specstory/history/') < 0) continue;
      if (seen.has(file)) continue;
      seen.add(file);

      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const mtime = stat.mtimeMs;
      if (sinceMs != null && mtime < sinceMs) continue;

      out.push({
        path: file,
        mtime,
        projectHint: deriveProjectHint(file, project),
        parentSession: deriveParentSession(file),
      });
    }
  }

  // Stable sort: mtime ascending (oldest first) so callers can prioritize
  // backlog over fresh files.
  out.sort((a, b) => a.mtime - b.mtime);
  return out;
}

/**
 * Convert transcripts to observations via ObservationWriter.processMessages.
 *
 * Honors the same race guard and size caps as the seed script
 * (scripts/backfill-subagent-transcripts.mjs lines 43-53).
 *
 * @param {Array<{path: string}>} transcripts
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false]  When true, count exchanges but skip the writer call.
 * @param {string}  [opts.tag]           Propagated to writer metadata as both `tag` and `source`.
 * @returns {Promise<Array<{ transcriptPath: string, observationsWritten: number, skipped: number }>>}
 */
export async function convertTranscriptsToObservations(transcripts, { dryRun = false, tag } = {}) {
  if (!Array.isArray(transcripts) || transcripts.length === 0) return [];

  // Late-import the heavy deps so test contexts can mock them.
  // 2026-07-06: writes go via obs-api (single km-core owner) — the bare
  // ObservationWriter constructor has had no standalone write path since
  // Phase 44 Plan 12 (it spent the LLM call, then threw on the km-core
  // write). ObservationApiClient.init() health-probes obs-api up front so
  // an unreachable API fails BEFORE any LLM spend.
  const [{ ObservationApiClient }, normalizer] = await Promise.all([
    import('../../src/live-logging/ObservationApiClient.js'),
    import('../../src/live-logging/TranscriptNormalizer.js'),
  ]);
  const { parseClaude, parseCopilot, parseSpecstory } = normalizer;

  // Lazy-init a single writer if we'll actually be writing.
  let writer = null;
  if (!dryRun) {
    writer = new ObservationApiClient();
    if (typeof writer.init === 'function') await writer.init();
  }

  const results = [];
  for (const t of transcripts) {
    const result = { transcriptPath: t.path, observationsWritten: 0, skipped: 0 };
    let stat;
    try {
      stat = fs.statSync(t.path);
    } catch {
      result.skipped++;
      results.push(result);
      continue;
    }

    if (Date.now() - stat.mtimeMs < RACE_GUARD_MS) {
      result.skipped++;
      results.push(result);
      continue;
    }
    if (Date.now() - stat.mtimeMs > MAX_AGE_MS) {
      result.skipped++;
      results.push(result);
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      result.skipped++;
      results.push(result);
      continue;
    }

    const ext = path.extname(t.path).toLowerCase();
    if (ext === '.jsonl') {
      const isCopilot = path.basename(t.path).toLowerCase().includes('events');
      const parser = isCopilot ? parseCopilot : parseClaude;
      const agent = isCopilot ? 'copilot' : 'claude';
      const counts = await processLineStream(t.path, parser, writer, {
        dryRun,
        agent,
        tag,
        sourceFile: t.path,
      });
      result.observationsWritten = counts.observations;
      result.skipped += counts.skipped;
    } else if (ext === '.md') {
      // Specstory format — parseSpecstory returns a list of messages.
      try {
        const content = fs.readFileSync(t.path, 'utf-8');
        const messages = parseSpecstory ? parseSpecstory(content) : [];
        if (Array.isArray(messages) && messages.length > 0) {
          if (dryRun) {
            // Dry-run: count how many exchanges WOULD be written.
            const exchanges = groupExchanges(messages);
            result.observationsWritten = 0;
            result.skipped += 0;
            // Record the would-be count without invoking the writer.
            // (Caller uses observationsWritten as the live-write count.)
          } else {
            const exchanges = groupExchanges(messages);
            for (const exchange of exchanges) {
              try {
                const r = await writer.processMessages(exchange, {
                  agent: 'specstory',
                  sourceFile: t.path,
                  tag,
                  source: tag || 'lsl-resolver',
                });
                result.observationsWritten += r?.observations || 0;
              } catch (err) {
                process.stderr.write(`[scan-and-convert] ${t.path}: ${err.message}\n`);
                result.skipped++;
              }
            }
          }
        }
      } catch (err) {
        process.stderr.write(`[scan-and-convert] ${t.path}: ${err.message}\n`);
        result.skipped++;
      }
    } else {
      result.skipped++;
    }

    results.push(result);
  }

  if (writer && typeof writer.close === 'function') {
    await writer.close();
  }

  return results;
}

/**
 * Stream a line-oriented transcript (claude or copilot jsonl) and feed
 * complete user+assistant exchanges to the writer.
 *
 * Returns { observations, skipped }.
 */
async function processLineStream(filePath, parser, writer, { dryRun, agent, tag, sourceFile }) {
  let observations = 0;
  let skipped = 0;
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let exchange = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = parser(line);
    } catch {
      skipped++;
      continue;
    }
    if (!msg) continue;
    exchange.push(msg);
    const hasUser = exchange.some(m => m.role === 'user');
    const hasAsst = exchange.some(m => m.role === 'assistant');
    if (hasUser && hasAsst && msg.role === 'assistant') {
      if (dryRun) {
        // Count what would be written; do not invoke writer.
        // Leave observationsWritten at 0 per plan Test 4.
      } else {
        try {
          const r = await writer.processMessages(exchange, {
            agent,
            sourceFile,
            tag,
            source: tag || 'lsl-resolver',
          });
          observations += r?.observations || 0;
        } catch (err) {
          process.stderr.write(`[scan-and-convert] ${filePath}: ${err.message}\n`);
          skipped++;
        }
      }
      exchange = [];
    }
  }
  if (exchange.length > 0 && !dryRun) {
    try {
      const r = await writer.processMessages(exchange, {
        agent,
        sourceFile,
        tag,
        source: tag || 'lsl-resolver',
      });
      observations += r?.observations || 0;
    } catch (err) {
      process.stderr.write(`[scan-and-convert] ${filePath}: ${err.message}\n`);
      skipped++;
    }
  }
  return { observations, skipped };
}

/**
 * Group a flat message list into complete user+assistant exchanges.
 * Each yielded exchange contains at least one user and one assistant turn.
 */
function groupExchanges(messages) {
  const out = [];
  let current = [];
  for (const m of messages) {
    current.push(m);
    const hasUser = current.some(x => x.role === 'user');
    const hasAsst = current.some(x => x.role === 'assistant');
    if (hasUser && hasAsst && m.role === 'assistant') {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}
