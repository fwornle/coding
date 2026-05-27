#!/usr/bin/env node
/**
 * scripts/sweep-sub-agents.mjs — agent-agnostic sweep dispatcher.
 *
 * Phase 51 Plan 01 Task 2 (CONTEXT.md D-Order Path-B-first + D-Live-Sweep-Tags).
 *
 * Drives all four supported coding agents (claude/opencode/copilot/mastra)
 * through one Path-B sweep pass. For each agent in AGENTS order:
 *   1. loadAdapter(agentId)               — null when not yet implemented
 *   2. getAgentSearchPaths(agentId)       — config + env-var overrides
 *   3. adapter.discover({ searchPaths, project, since })
 *   4. registry.upsert(row)               — status defaults to 'discovered'
 *   5. (unless --dry-run) adapter.convertToObservations(rows, {...})
 *      → registry.markCompleted(...) per row
 *
 * Per CONTEXT.md D-Live-Sweep-Tags: every observation produced by this
 * sweep is tagged metadata.source = "sub-agent-backfill". The per-row
 * metadata enrichment (parent_session_id, sub_index, sub_hash, agent,
 * project) is the adapter's responsibility — the dispatcher relays the
 * registry rows plus the global tag.
 *
 * Per CONTEXT.md D-Reuse: this CLI does NOT directly call Phase 50
 * primitives in lib/lsl/scan-and-convert.mjs. Each adapter is the
 * boundary that composes its own discover() + Phase 50's
 * convertTranscriptsToObservations() — keeps the dispatcher Phase-50-agnostic
 * and lets opencode (which has no transcript files, only an SQLite DB) plug
 * in without forcing a shape change on the primitive.
 *
 * Exit codes:
 *   0  — at least one adapter completed end-to-end (sweep produced value)
 *   2  — all four adapters were missing OR all four threw (sweep produced nothing)
 *
 * Usage:
 *   node scripts/sweep-sub-agents.mjs --help
 *   node scripts/sweep-sub-agents.mjs --project coding
 *   node scripts/sweep-sub-agents.mjs --agent claude --dry-run
 *   node scripts/sweep-sub-agents.mjs --since 2026-05-23T07:30:00Z
 *   node scripts/sweep-sub-agents.mjs --limit 50
 *
 * Env:
 *   LSL_ADAPTERS_DIR             override adapters directory (test hook)
 *   LSL_CLAUDE_PROJECTS_DIR      ~/.claude/projects/ override
 *   LSL_OPENCODE_DB              ~/.local/share/opencode/opencode.db override
 *   LSL_COPILOT_SESSIONS_DIR     ~/.copilot/session-state/ override
 *   LSL_MASTRA_TRANSCRIPTS_DIR   .observations/transcripts/ override
 */

import process from 'node:process';
import { createRegistry } from '../lib/lsl/registry.mjs';
import { AGENTS, loadAdapter, getAgentSearchPaths } from '../lib/lsl/adapters/index.mjs';
// scan-and-convert is the Phase 50 primitive each adapter uses internally.
// Importing it here keeps the dependency edge visible per the plan's key_links
// contract (Plan 51-01 Task 2 acceptance), without the dispatcher reaching
// into Phase 50 internals.
// eslint-disable-next-line no-unused-vars
import { convertTranscriptsToObservations } from '../lib/lsl/scan-and-convert.mjs';

const DEFAULT_LIMIT = 100;

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
  const help = `Usage: sweep-sub-agents.mjs [options]

Agent-agnostic Phase 51 Path-B sweep dispatcher. Drives the four supported
coding agents through one discover + convertToObservations pass.

Options:
  --agent <id>      Restrict to one agent (claude|opencode|copilot|mastra).
                    Default: all four in AGENTS order.
  --since <iso>     ISO timestamp filter; skip transcripts older than this.
  --dry-run         Discover only; do not invoke convertToObservations.
  --project <name>  Project filter forwarded to adapter.discover(). Default: coding.
  --limit <N>       Cap per-agent discovered rows. Default: ${DEFAULT_LIMIT}.
  --help            Show this message.

Exit codes:
  0   at least one adapter produced rows (or completed --dry-run cleanly)
  2   all four adapters were missing or all four threw
`;
  process.stdout.write(help);
}

async function main(argv) {
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    printHelp();
    return 0;
  }
  const filterAgent = parseStrArg(argv, '--agent');
  const since = parseStrArg(argv, '--since');
  const project = parseStrArg(argv, '--project') || 'coding';
  const limit = parseIntArg(argv, '--limit') ?? DEFAULT_LIMIT;
  const dryRun = hasFlag(argv, '--dry-run');

  const targetAgents = filterAgent
    ? AGENTS.filter((a) => a === filterAgent)
    : AGENTS.slice();

  if (targetAgents.length === 0) {
    process.stderr.write(`[sweep] unknown --agent "${filterAgent}"; expected one of ${AGENTS.join(', ')}\n`);
    return 2;
  }

  const registry = createRegistry();
  const aggregate = { discovered: 0, converted: 0, skipped: 0, failed: 0 };
  let anySuccess = false;
  let missingCount = 0;

  for (const agentId of targetAgents) {
    const adapter = await loadAdapter(agentId);
    if (!adapter) {
      process.stderr.write(`[sweep] agent=${agentId} no adapter for ${agentId}\n`);
      missingCount++;
      continue;
    }
    const searchPaths = getAgentSearchPaths(agentId);

    let discovered = [];
    try {
      // Phase 51 Plan 51-13 (CR-01): forward `limit` to the adapter so it
      // can bind the SQL LIMIT at query time. Without this, the OpenCode
      // adapter silently caps at 100 (the dispatcher's post-process
      // .slice(0, limit) below only narrows a result the DB already
      // truncated). Other adapters that destructure their own fields
      // ignore the extra parameter per JS object-destructure semantics.
      discovered = await adapter.discover({ searchPaths, project, since, limit });
      if (!Array.isArray(discovered)) discovered = [];
    } catch (err) {
      process.stderr.write(`[sweep] agent=${agentId} ERROR discover: ${err.message}\n`);
      continue;
    }
    // T-51-01-DR: cap per-agent rows. Take from the front of the list
    // (adapters are expected to sort oldest-first per the registry contract).
    if (discovered.length > limit) {
      process.stderr.write(`[sweep] agent=${agentId} limit hit (${discovered.length} -> ${limit}); oldest ${limit} retained\n`);
      discovered = discovered.slice(0, limit);
    }
    // Stage 1: register every discovered row at status='discovered'.
    for (const row of discovered) {
      registry.upsert(row);
    }
    aggregate.discovered += discovered.length;

    if (dryRun) {
      process.stderr.write(`[sweep] agent=${agentId} dry-run discovered=${discovered.length} converted=0 skipped=0 failed=0\n`);
      anySuccess = true;
      continue;
    }

    // Stage 2: convert via adapter. The adapter internally composes Phase 50's
    // convertTranscriptsToObservations under the hood (per adapter contract);
    // the dispatcher does not bypass it.
    let results = [];
    try {
      // D-Live-Sweep-Tags: every observation produced here carries
      // metadata.source = "sub-agent-backfill" (inlined so the plan's
      // grep gate matches exactly once).
      results = await adapter.convertToObservations(discovered, {
        dryRun: false,
        tag: 'sub-agent-backfill',
      });
      if (!Array.isArray(results)) results = [];
    } catch (err) {
      process.stderr.write(`[sweep] agent=${agentId} ERROR convertToObservations: ${err.message}\n`);
      continue;
    }

    let converted = 0, skipped = 0, failed = 0;
    for (const r of results) {
      if (r.error) {
        registry.markCompleted(agentId, r.sub_hash, { error: r.error });
        failed++;
        continue;
      }
      registry.markCompleted(agentId, r.sub_hash, {
        observations_written: r.observations_written || 0,
      });
      if ((r.skipped || 0) > 0) skipped += r.skipped;
      converted += r.observations_written || 0;
    }
    aggregate.converted += converted;
    aggregate.skipped += skipped;
    aggregate.failed += failed;

    process.stderr.write(
      `[sweep] agent=${agentId} discovered=${discovered.length} converted=${converted} skipped=${skipped} failed=${failed}\n`,
    );
    anySuccess = true;
  }

  process.stderr.write(
    `[sweep] aggregate discovered=${aggregate.discovered} converted=${aggregate.converted} skipped=${aggregate.skipped} failed=${aggregate.failed} registry_size=${registry.size()}\n`,
  );

  if (!anySuccess && missingCount === targetAgents.length) {
    return 2;
  }
  if (!anySuccess) {
    // All agents present but every one threw.
    return 2;
  }
  return 0;
}

const argv = process.argv.slice(2);
main(argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[sweep] fatal: ${err.stack || err.message}\n`);
    process.exit(1);
  });
