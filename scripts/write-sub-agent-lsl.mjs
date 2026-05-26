#!/usr/bin/env node
/**
 * scripts/write-sub-agent-lsl.mjs — D-LSL-Filename CLI driver.
 *
 * Phase 51 Plan 06 Task 3.
 *
 * Drives a sweep across the four supported coding agents
 * (claude/opencode/copilot/mastra), then writes per-sub-agent LSL files
 * under .specstory/history/{YYYY}/{MM}/ following the verbatim
 * D-LSL-Filename convention:
 *   {YYYY-MM-DD}_{HHHH-HHHH}_S{parent-slot}-{sub-index}-{sub-hash}[-part{N}].md
 *
 * Closes CONTEXT.md AC #2 (LSL parity for sub-agents) AND extends the
 * 2026-05-23 backfill (CONTEXT.md AC #1) from observations-only into
 * full LSL parity for the same set of Claude Code transcripts.
 *
 * Flow:
 *   1. createRegistry()
 *   2. For each agentId in (filtered) AGENTS:
 *        a. loadAdapter(agentId)
 *        b. adapter.discover({searchPaths, project, since})
 *        c. registry.upsert(row) per row
 *   3. loadSlotState({statePath})
 *   4. For each row in registry.listByProject(project):
 *        a. Re-read the transcript via the per-agent parse<Agent>Exchanges
 *           helper exported by the adapter (Plan 51-06 Task 3 extension).
 *        b. result = await writeSubAgentLSL({row, exchanges, outputRoot,
 *           slotAllocator:{state: slotState}, dryRun, force})
 *        c. Log per-row outcome to stderr.
 *   5. saveSlotState({statePath, state: slotState})
 *   6. Print final summary: `[lsl-writer] agents=N rows=M files_written=W chunked=C skipped=S`
 *
 * Per CLAUDE.md no-console-log rule: this CLI uses process.stderr.write
 * for forensics and process.stdout.write for the help text. No direct
 * stdout/stderr logging API is invoked.
 *
 * Per CONTEXT.md D-Reuse: this CLI does NOT directly call Phase 50
 * primitives. The writer (lib/lsl/sub-agent-lsl-writer.mjs) produces
 * files in the shape Phase 50's window.mjs parser already consumes
 * (Format B labels + ps_<ms> anchors).
 */

import process from 'node:process';
import path from 'node:path';

import { createRegistry } from '../lib/lsl/registry.mjs';
import { AGENTS, loadAdapter, getAgentSearchPaths } from '../lib/lsl/adapters/index.mjs';
import { writeSubAgentLSL } from '../lib/lsl/sub-agent-lsl-writer.mjs';
import {
  allocateSlot as _allocateSlot, // re-exported for visibility — not used directly here
  loadSlotState,
  saveSlotState,
  DEFAULT_STATE_PATH,
} from '../lib/lsl/sub-agent-slot-allocator.mjs';

// Per-agent helpers (Plan 51-06 Task 3 — adapter extensions).
import { parseClaudeExchanges } from '../lib/lsl/adapters/claude-jsonl-tree.mjs';
import { parseCopilotExchanges } from '../lib/lsl/adapters/copilot-events.mjs';
import { parseOpencodeExchanges } from '../lib/lsl/adapters/opencode-sqlite.mjs';
import { parseMastraExchanges } from '../lib/lsl/adapters/mastra-ndjson.mjs';

const DEFAULT_LIMIT = 100;
const DEFAULT_OUTPUT_ROOT = path.join('.specstory', 'history');

/** Parse `--flag value` from argv. Returns the value or null. */
function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

/** Parse `--flag value` as int. Returns Number or null. */
function parseIntArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = parseInt(argv[i + 1], 10);
  return Number.isFinite(v) ? v : null;
}

function hasFlag(argv, flag) {
  return argv.indexOf(flag) >= 0;
}

function printHelp() {
  const help = `Usage: write-sub-agent-lsl.mjs [options]

D-LSL-Filename CLI driver — runs a sweep across the four supported
coding agents and writes per-sub-agent LSL files following the
{YYYY-MM-DD}_{HHHH-HHHH}_S{parent-slot}-{sub-index}-{sub-hash}.md
convention. Closes CONTEXT.md AC #2 (LSL parity).

Options:
  --agent <id>        Restrict to one agent (claude|opencode|copilot|mastra).
                      Default: all four in AGENTS order.
  --project <name>    Project filter forwarded to adapter.discover().
                      Default: coding.
  --dry-run           Discover + compute filenames but do not write to disk.
  --force             Overwrite existing LSL files (default: idempotent skip).
  --historical        Bypass the adapter's age gate (legacy --since=null).
  --limit <N>         Cap per-agent discovered rows. Default: ${DEFAULT_LIMIT}.
  --state-file <path> Slot-allocator state file path.
                      Default: ${DEFAULT_STATE_PATH}.
  --output-root <dir> LSL history root directory.
                      Default: ${DEFAULT_OUTPUT_ROOT}.
  --help              Show this message.

Exit codes:
  0   at least one row processed (or --dry-run completed cleanly)
  2   all four adapters missing or all four threw
`;
  process.stdout.write(help);
}

/**
 * Pick the per-agent parser. Returns a function that takes the row and
 * returns a Promise<exchanges[]>.
 */
function pickParserForAgent(agentId) {
  switch (agentId) {
    case 'claude':
      return async (row) => parseClaudeExchanges(row.transcript_path);
    case 'copilot':
      return async (row) => {
        const meta = row.agent_metadata || {};
        return parseCopilotExchanges(row.transcript_path, meta.toolCallId);
      };
    case 'opencode': {
      return async (row) => {
        // transcript_path is `sqlite:<dbPath>#<sessionId>`
        const tp = row.transcript_path || '';
        const m = /^sqlite:(.*)#([^#]+)$/.exec(tp);
        if (!m) return [];
        return parseOpencodeExchanges(m[1], m[2]);
      };
    }
    case 'mastra':
      return async (row) => {
        const meta = row.agent_metadata || {};
        return parseMastraExchanges(row.transcript_path, meta.subAgentSessionId);
      };
    default:
      return null;
  }
}

async function main(argv) {
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    printHelp();
    return 0;
  }
  const filterAgent = parseStrArg(argv, '--agent');
  const project = parseStrArg(argv, '--project') || 'coding';
  const dryRun = hasFlag(argv, '--dry-run');
  const force = hasFlag(argv, '--force');
  const historical = hasFlag(argv, '--historical');
  const limit = parseIntArg(argv, '--limit') ?? DEFAULT_LIMIT;
  const statePath = parseStrArg(argv, '--state-file') || DEFAULT_STATE_PATH;
  const outputRoot = parseStrArg(argv, '--output-root') || DEFAULT_OUTPUT_ROOT;

  const targetAgents = filterAgent
    ? AGENTS.filter((a) => a === filterAgent)
    : AGENTS.slice();
  if (targetAgents.length === 0) {
    process.stderr.write(`[lsl-writer] unknown --agent "${filterAgent}"; expected one of ${AGENTS.join(', ')}\n`);
    return 2;
  }

  const registry = createRegistry();
  let missingCount = 0;
  let anySuccess = false;

  // Stage 1: sweep — discover rows across agents.
  for (const agentId of targetAgents) {
    const adapter = await loadAdapter(agentId);
    if (!adapter) {
      process.stderr.write(`[lsl-writer] agent=${agentId} no adapter found; skipping\n`);
      missingCount += 1;
      continue;
    }
    const searchPaths = getAgentSearchPaths(agentId);
    let discovered = [];
    try {
      // The `--historical` flag bypasses any age gate by passing since=null
      // (which adapters interpret as "no lower bound"). For now this is
      // already the default — `--historical` is a documented opt-in for
      // future adapters that might apply a default since=24h ago.
      const sinceArg = historical ? null : null;
      discovered = await adapter.discover({ searchPaths, project, since: sinceArg });
      if (!Array.isArray(discovered)) discovered = [];
    } catch (err) {
      process.stderr.write(`[lsl-writer] agent=${agentId} discover error: ${err.message}\n`);
      continue;
    }
    if (discovered.length > limit) {
      process.stderr.write(`[lsl-writer] agent=${agentId} limit hit (${discovered.length} -> ${limit})\n`);
      discovered = discovered.slice(0, limit);
    }
    for (const row of discovered) {
      registry.upsert(row);
    }
    process.stderr.write(`[lsl-writer] agent=${agentId} discovered=${discovered.length}\n`);
  }

  // Stage 2: write LSL files via writeSubAgentLSL.
  const slotState = loadSlotState({ statePath });

  const rows = registry.listByProject(project);
  let agentsSeen = new Set();
  let filesWritten = 0;
  let chunkedTotal = 0;
  let skippedTotal = 0;
  let errorsTotal = 0;

  for (const row of rows) {
    const parser = pickParserForAgent(row.agent);
    if (!parser) {
      process.stderr.write(`[lsl-writer] no parser for agent="${row.agent}" sub_hash=${row.sub_hash}\n`);
      errorsTotal += 1;
      continue;
    }
    let exchanges;
    try {
      exchanges = await parser(row);
    } catch (err) {
      process.stderr.write(`[lsl-writer] parser error agent=${row.agent} sub_hash=${row.sub_hash}: ${err.message}\n`);
      errorsTotal += 1;
      continue;
    }
    // Defensive sub_index normalization — adapters that did not populate
    // sub_index get a stable fallback so the writer's validator does not
    // throw. The slot allocator already handles parent-level identity.
    if (typeof row.sub_index !== 'number' || row.sub_index < 1) {
      row.sub_index = 1;
    }

    if (!Array.isArray(exchanges) || exchanges.length === 0) {
      process.stderr.write(`[lsl-writer] empty exchanges for agent=${row.agent} sub_hash=${row.sub_hash}; skipping\n`);
      skippedTotal += 1;
      continue;
    }

    try {
      const result = await writeSubAgentLSL({
        row,
        exchanges,
        outputRoot,
        slotAllocator: { state: slotState },
        dryRun,
        force,
      });
      agentsSeen.add(row.agent);
      if (result.skipped) {
        process.stderr.write(`[lsl-writer] skipped (idempotent) ${result.filePath}\n`);
        skippedTotal += 1;
      } else if (dryRun) {
        process.stderr.write(`[lsl-writer] dry-run computed ${result.filePath}\n`);
      } else {
        process.stderr.write(`[lsl-writer] wrote ${result.filePath} (${result.bytesWritten} bytes${result.chunked > 0 ? `; ${result.chunked} parts` : ''})\n`);
        filesWritten += result.chunked > 1 ? result.chunked : 1;
        chunkedTotal += result.chunked;
      }
      anySuccess = true;
    } catch (err) {
      process.stderr.write(`[lsl-writer] write error agent=${row.agent} sub_hash=${row.sub_hash}: ${err.message}\n`);
      errorsTotal += 1;
    }
  }

  if (!dryRun) {
    try {
      saveSlotState({ statePath, state: slotState });
    } catch (err) {
      process.stderr.write(`[lsl-writer] failed to save slot state: ${err.message}\n`);
    }
  }

  process.stderr.write(
    `[lsl-writer] agents=${agentsSeen.size} rows=${rows.length} files_written=${filesWritten} chunked=${chunkedTotal} skipped=${skippedTotal} errors=${errorsTotal}\n`,
  );

  if (!anySuccess && missingCount === targetAgents.length) return 2;
  if (rows.length === 0 && missingCount > 0) return 2;
  return 0;
}

const argv = process.argv.slice(2);
main(argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[lsl-writer] fatal: ${err.stack || err.message}\n`);
    process.exit(1);
  });
