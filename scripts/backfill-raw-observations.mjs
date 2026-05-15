#!/usr/bin/env node
/**
 * Backfill broken "[Raw]" observations by re-summarizing through the LLM proxy.
 *
 * Targets rows where the writer hit `_fallbackSummary()` (proxy unreachable
 * or returned non-OK during the original write) and stored:
 *   summary: "[Raw] N messages (...). LLM summary unavailable."
 *   quality: "low"
 *   metadata.llmModel / llmProvider: null
 *
 * The full original messages are still in the `messages` column, so we just
 * rebuild the same prompt ObservationWriter uses and ask the proxy again.
 *
 * Usage:
 *   node scripts/backfill-raw-observations.mjs                # process all broken rows
 *   node scripts/backfill-raw-observations.mjs --dry-run      # show what would change, write nothing
 *   node scripts/backfill-raw-observations.mjs --limit 3      # process up to N rows (sanity check first)
 *   node scripts/backfill-raw-observations.mjs --id <uuid>    # process exactly one row by id
 *
 * Env:
 *   LLM_CLI_PROXY_PORT  default 12435
 *   OBSERVATIONS_DB     default ./.observations/observations.db
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseIntArg(args, '--limit');
const ONLY_ID = parseStrArg(args, '--id');

const DB_PATH = process.env.OBSERVATIONS_DB
  || path.resolve('.observations/observations.db');
const PROXY_PORT = process.env.LLM_CLI_PROXY_PORT || '12435';
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
const REQUEST_TIMEOUT_MS = 60_000;

function parseIntArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = parseInt(argv[i + 1], 10);
  return Number.isFinite(v) ? v : null;
}

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

function buildSummaryRequest(messages, projectName) {
  const exchangeBlock = messages
    .map(m => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join('\n');

  return {
    process: 'backfill',
    messages: [
      {
        role: 'system',
        content: `You produce structured observation summaries from coding exchanges.\n` +
          `CRITICAL CONTEXT: The developer is working in the "${projectName}" project. ` +
          `The exchange below happened in that project. System prompts, CLAUDE.md content, ` +
          `and file paths from OTHER projects appearing in the exchange are background context ` +
          `or cross-project investigations — they are NOT what the developer asked about. ` +
          `Only describe what the developer actually requested in their message.\n\n` +
          'Respond using ONLY this template — nothing else:\n\n' +
          'Intent: [what the developer actually asked or requested — base this ONLY on the <user> message content]\n' +
          'Approach: [architectural decisions, solution strategy, and key technical insights — 1-4 sentences]\n' +
          'Artifacts: [list each file modified/created/deleted with verb, e.g. "edited src/foo.ts, created lib/bar.js". Write "none" if no files were touched]\n' +
          'Result: [the concrete solution or outcome — what was built, fixed, configured, or decided. Include key details a future reader needs. 1-4 sentences]\n\n' +
          'Constraints:\n' +
          '- Your ENTIRE response must be these 4 labeled lines. Nothing before, nothing after.\n' +
          '- Never reproduce code, commands, file contents, or the assistant\'s words.\n' +
          '- Intent MUST reflect the user\'s actual question/request, not inferred topics from system context.\n' +
          '- Approach should capture WHY this solution was chosen, not just WHAT was done.\n' +
          '- Result should be specific enough that someone can understand the change without reading the code.\n' +
          '- If the exchange has no real work (greetings, "yes", "proceed"), respond with only: "No actionable content."',
      },
      {
        role: 'user',
        content: `<project>${projectName}</project>\n<exchange>\n${exchangeBlock}\n</exchange>\n\nProduce the observation summary.`,
      },
    ],
  };
}

async function callProxy(body) {
  const resp = await fetch(`${PROXY_URL}/api/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

function looksUnusable(content) {
  if (!content || typeof content !== 'string') return true;
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (/no actionable content/i.test(trimmed)) return true;
  if (trimmed.startsWith('[Raw]')) return true;
  return false;
}

function projectFromMetadata(metaJson) {
  try {
    const m = JSON.parse(metaJson || '{}');
    return m.project || m.projectName || m.projectPath?.split('/').pop() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function mergeMetadata(existingJson, llm) {
  let existing = {};
  try { existing = JSON.parse(existingJson || '{}'); } catch { /* ignore */ }
  return JSON.stringify({
    ...existing,
    llmModel: llm?.model ?? existing.llmModel ?? null,
    llmProvider: llm?.provider ?? existing.llmProvider ?? null,
    llmTokens: llm?.tokens ?? existing.llmTokens ?? null,
    llmLatencyMs: llm?.latencyMs ?? existing.llmLatencyMs ?? null,
    backfilled: true,
    backfilledAt: new Date().toISOString(),
  });
}

async function main() {
  process.stderr.write(`[backfill] DB: ${DB_PATH}\n`);
  process.stderr.write(`[backfill] Proxy: ${PROXY_URL}\n`);
  process.stderr.write(`[backfill] Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE (will UPDATE rows)'}\n`);
  if (LIMIT) process.stderr.write(`[backfill] Limit: ${LIMIT}\n`);
  if (ONLY_ID) process.stderr.write(`[backfill] Only id: ${ONLY_ID}\n`);

  const db = new Database(DB_PATH, { readonly: false });

  let query = `SELECT id, summary, messages, agent, source_file, created_at, metadata
               FROM observations
               WHERE summary LIKE '[Raw]%' AND quality = 'low'`;
  const params = [];
  if (ONLY_ID) {
    query = `SELECT id, summary, messages, agent, source_file, created_at, metadata
             FROM observations
             WHERE id = ?`;
    params.push(ONLY_ID);
  } else {
    query += ` ORDER BY created_at ASC`;
    if (LIMIT) query += ` LIMIT ${parseInt(LIMIT, 10)}`;
  }

  const rows = db.prepare(query).all(...params);
  process.stderr.write(`[backfill] ${rows.length} candidate row(s)\n\n`);

  const update = db.prepare(
    'UPDATE observations SET summary = ?, metadata = ?, quality = ? WHERE id = ?',
  );

  let ok = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    let messages;
    try {
      messages = JSON.parse(row.messages);
    } catch (err) {
      process.stderr.write(`[backfill] ${row.id.slice(0, 8)}: messages JSON unparseable — skip (${err.message})\n`);
      skipped++;
      continue;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      process.stderr.write(`[backfill] ${row.id.slice(0, 8)}: no messages — skip\n`);
      skipped++;
      continue;
    }

    const project = projectFromMetadata(row.metadata);
    const reqBody = buildSummaryRequest(messages, project);

    process.stderr.write(`[backfill] ${row.id.slice(0, 8)} | ${row.agent} | ${row.created_at} | project=${project} | calling proxy...\n`);

    try {
      const result = await callProxy(reqBody);
      const newSummary = (result.content || '').trim();
      if (looksUnusable(newSummary)) {
        process.stderr.write(`  → proxy returned unusable content (${newSummary.slice(0, 60)}…), skipping\n`);
        skipped++;
        continue;
      }
      const llm = (result.model && result.provider)
        ? { model: result.model, provider: result.provider, tokens: result.tokens || null, latencyMs: result.latencyMs || null }
        : null;
      const newMeta = mergeMetadata(row.metadata, llm);
      const newQuality = 'normal';

      process.stderr.write(`  → ${newSummary.length} chars via ${llm ? `${llm.model}@${llm.provider}` : 'proxy(unknown llm)'}\n`);
      process.stderr.write(`  → preview: ${newSummary.slice(0, 120).replace(/\n/g, ' ⏎ ')}\n`);

      if (!DRY_RUN) {
        update.run(newSummary, newMeta, newQuality, row.id);
        process.stderr.write(`  ✓ row updated\n`);
      } else {
        process.stderr.write(`  ◆ dry-run: NOT writing\n`);
      }
      ok++;
    } catch (err) {
      process.stderr.write(`  ✗ ${err.message}\n`);
      failed++;
    }
  }

  db.close();
  process.stderr.write(`\n[backfill] Done. backfilled=${ok} skipped=${skipped} failed=${failed} total=${rows.length}\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  process.stderr.write(`[backfill] FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
