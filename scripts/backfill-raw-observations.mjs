#!/usr/bin/env node
/**
 * Re-summarise "[Raw]" observations through the LLM proxy.
 *
 * A `[Raw]` row is what ObservationWriter stores when the proxy is unreachable:
 * a placeholder summary with the full original messages preserved in
 * `metadata.messages`. It is a receipt that a turn happened, not a record of
 * what happened. This script turns the receipt back into a record by rebuilding
 * the same prompt the writer uses and asking the proxy again.
 *
 * ── WHY THIS TALKS TO obs-api AND NOT TO A DATABASE ───────────────────────
 *
 * It used to open `.observations/observations.db` with better-sqlite3. Phase 44
 * cut that store; the file is now a 4,096-byte shell with the real data archived
 * at `.observations/observations.db.archived.2026-06-05`. So the repair tool for
 * these rows silently found zero of them for months — including through the
 * 2026-09-23 incident where 26 [Raw] rows were the only record of their turns.
 *
 * It does NOT open the km-core LevelDB directly either. obs-api holds that store
 * open for the life of the daemon, LevelDB is single-writer, and `close()`
 * persists the WHOLE graph under one key — a second writer would either fail on
 * the lock or clobber the daemon's in-memory graph on flush. Going through
 * obs-api's HTTP surface keeps exactly one writer.
 *
 * Usage:
 *   node scripts/backfill-raw-observations.mjs --dry-run     # show what would change
 *   node scripts/backfill-raw-observations.mjs               # repair all candidates
 *   node scripts/backfill-raw-observations.mjs --limit 3     # sanity-check a few first
 *   node scripts/backfill-raw-observations.mjs --id <uuid>   # exactly one row
 *   node scripts/backfill-raw-observations.mjs --since 2026-09-01
 *
 * Env:
 *   LLM_CLI_PROXY_PORT  default 12435  (the proxy's /api/complete)
 *   OBS_API_URL         default http://localhost:12436
 */

import process from 'node:process';

import { isRawFallbackSummary } from '../src/live-logging/raw-fallback.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseIntArg(args, '--limit');
const ONLY_ID = parseStrArg(args, '--id');
const SINCE = parseStrArg(args, '--since');

const PROXY_PORT = process.env.LLM_CLI_PROXY_PORT || '12435';
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
const OBS_API = (process.env.OBS_API_URL || 'http://localhost:12436').replace(/\/$/, '');
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

function log(s) {
  process.stderr.write(s);
}

/**
 * Rebuild the summary prompt ObservationWriter.summarize() sends.
 *
 * Kept deliberately in sync with the writer's template: a backfilled row should
 * be indistinguishable from one summarised on the live path, or the corpus ends
 * up with two dialects of observation.
 */
function buildSummaryRequest(messages, projectName) {
  const exchangeBlock = messages
    .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join('\n');

  return {
    process: 'backfill',
    messages: [
      {
        role: 'system',
        content:
          'You produce structured observation summaries from coding exchanges.\n' +
          `CRITICAL CONTEXT: The developer is working in the "${projectName}" project. ` +
          'The exchange below happened in that project. System prompts, CLAUDE.md content, ' +
          'and file paths from OTHER projects appearing in the exchange are background context ' +
          'or cross-project investigations — they are NOT what the developer asked about. ' +
          'Only describe what the developer actually requested in their message.\n\n' +
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

/** Fetch every Observation entity from obs-api's km-core surface. */
async function fetchObservations() {
  const resp = await fetch(
    `${OBS_API}/api/v1/entities?ontologyClass=Observation&limit=100000`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  if (!resp.ok) {
    throw new Error(
      `obs-api ${resp.status} ${resp.statusText} — is it running? (${OBS_API})`,
    );
  }
  const body = await resp.json();
  if (!body || body.success !== true || !Array.isArray(body.data)) {
    throw new Error('obs-api returned an unexpected shape for /api/v1/entities');
  }
  return body.data;
}

/**
 * Apply the repaired summary.
 *
 * PUT /api/v1/entities/:id merges via graphology's `mergeNodeAttributes`, which
 * is a TOP-LEVEL merge — sending `metadata` replaces the whole bag. So the full
 * merged metadata goes on the wire, not a patch, or the row loses `messages`,
 * `content_hash` and everything else the writer put there.
 *
 * `provenance` is stripped before sending. It is NOT a stored field on these
 * rows: `entityToWire` synthesises `metadata.provenance` from the top-level
 * `createdBy` when the bag has none, and all 28 candidates are in that state
 * (measured 2026-09-23). Echoing it back would persist a phantom copy that then
 * shadows the live `createdBy` on every subsequent read.
 */
async function applyRepair(id, entity, newSummary, llm) {
  const meta = { ...(entity.metadata || {}) };
  delete meta.provenance;

  const updated = {
    ...meta,
    summary: newSummary,
    quality: qualityFor(newSummary),
    llmModel: llm?.model ?? meta.llmModel ?? null,
    llmProvider: llm?.provider ?? meta.llmProvider ?? null,
    llmTokens: llm?.tokens ?? meta.llmTokens ?? null,
    llmLatencyMs: llm?.latencyMs ?? meta.llmLatencyMs ?? null,
    backfilled: true,
    backfilledAt: new Date().toISOString(),
  };

  const resp = await fetch(`${OBS_API}/api/v1/entities/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // name AND description: the exporter reads `description || name`, the graph
    // viewer labels nodes by `name`. Leaving name at "[Raw] 2 messages…" would
    // repair the row everywhere except the place a human looks at it.
    body: JSON.stringify({
      name: newSummary.slice(0, 80),
      description: newSummary,
      metadata: updated,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`PUT ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`);
  }
  const body = await resp.json();
  if (!body || body.success !== true || body.data === null) {
    throw new Error('obs-api accepted the PUT but reported no entity (id vanished?)');
  }
  return body.data;
}

/**
 * Ask obs-api to refresh the observation cold store.
 *
 * The repairs above went in through `/api/v1/entities/:id`, which mutates the
 * graph but does not trigger `scheduleExport()` — that fires on observation
 * writes, deletes and boot, and an entity PUT is none of them. Skipping this
 * would leave every repaired row correct in the graph and invisible to
 * /api/coding/observations until some unrelated write happened to flush it,
 * which is the failure this whole script exists to undo.
 */
async function requestExport() {
  const resp = await fetch(`${OBS_API}/api/observations/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`POST /api/observations/export -> ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * Quality for a repaired row.
 *
 * "No actionable content." is a real verdict and stays 'low' — the turn is now
 * KNOWN to be empty rather than unsummarised, which is the one case where the
 * dud filter is right to drop it. Anything else becomes 'normal'.
 *
 * This is load-bearing in one direction people get wrong: leaving a repaired row
 * at 'low' would make it INVISIBLE. `ObservationExporter.keepInExport()` admits
 * a low-quality row only while it still looks like a [Raw] receipt; once the
 * summary is real, 'low' means dud and the row drops out of the export again.
 */
function qualityFor(summary) {
  return /no actionable content/i.test(summary.trim()) ? 'low' : 'normal';
}

/** A proxy answer we must not store. */
function looksUnusable(content) {
  if (!content || typeof content !== 'string') return true;
  if (!content.trim()) return true;
  // The proxy handing back a [Raw] placeholder means the repair failed; storing
  // it would just rewrite the row with the same problem and clear the marker.
  if (isRawFallbackSummary(content)) return true;
  return false;
}

function messagesOf(entity) {
  const m = (entity.metadata || {}).messages;
  if (Array.isArray(m)) return m;
  if (typeof m === 'string') {
    try {
      const parsed = JSON.parse(m);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function createdAtOf(entity) {
  return (entity.metadata || {}).createdAt || entity.createdAt || '';
}

function selectCandidates(all) {
  if (ONLY_ID) return all.filter((e) => e.id === ONLY_ID);

  let rows = all.filter((e) => isRawFallbackSummary(e.description || e.name));
  if (SINCE) rows = rows.filter((e) => createdAtOf(e) >= SINCE);
  rows.sort((a, b) => String(createdAtOf(a)).localeCompare(String(createdAtOf(b))));
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

async function main() {
  log(`[backfill] obs-api: ${OBS_API}\n`);
  log(`[backfill] proxy:   ${PROXY_URL}\n`);
  log(`[backfill] mode:    ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE (will update rows)'}\n`);
  if (LIMIT) log(`[backfill] limit:   ${LIMIT}\n`);
  if (ONLY_ID) log(`[backfill] only id: ${ONLY_ID}\n`);
  if (SINCE) log(`[backfill] since:   ${SINCE}\n`);

  const all = await fetchObservations();
  const rows = selectCandidates(all);
  log(`[backfill] ${rows.length} candidate row(s) of ${all.length} observation(s)\n\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const entity of rows) {
    const short = String(entity.id).slice(0, 8);
    const meta = entity.metadata || {};
    const project = meta.project || 'unknown';
    const messages = messagesOf(entity);

    if (!messages || messages.length === 0) {
      // Unrepairable, and worth saying loudly: without the messages the turn is
      // genuinely gone, which is the outcome this whole path exists to prevent.
      log(`[backfill] ${short}: no messages preserved — UNREPAIRABLE, skipping\n`);
      skipped++;
      continue;
    }

    log(`[backfill] ${short} | ${meta.agent || '?'} | ${createdAtOf(entity)} | project=${project} | calling proxy...\n`);

    try {
      const result = await callProxy(buildSummaryRequest(messages, project));
      const newSummary = (result.content || '').trim();
      if (looksUnusable(newSummary)) {
        log(`  → unusable proxy answer (${newSummary.slice(0, 60)}…), skipping\n`);
        skipped++;
        continue;
      }
      const llm = result.model && result.provider
        ? {
          model: result.model,
          provider: result.provider,
          tokens: result.tokens || null,
          latencyMs: result.latencyMs || null,
        }
        : null;

      log(`  → ${newSummary.length} chars via ${llm ? `${llm.model}@${llm.provider}` : 'proxy(unknown llm)'} → quality=${qualityFor(newSummary)}\n`);
      log(`  → ${newSummary.slice(0, 120).replace(/\n/g, ' ⏎ ')}\n`);

      if (DRY_RUN) {
        log('  ◆ dry-run: NOT writing\n');
      } else {
        await applyRepair(entity.id, entity, newSummary, llm);
        log('  ✓ row updated\n');
      }
      ok++;
    } catch (err) {
      log(`  ✗ ${err.message}\n`);
      failed++;
    }
  }

  log(`\n[backfill] Done. repaired=${ok} skipped=${skipped} failed=${failed} total=${rows.length}\n`);

  if (!DRY_RUN && ok > 0) {
    // A repair nothing can read is not a repair. Failing to schedule the
    // re-export is therefore a FAILURE of this run, not a footnote: the rows
    // are correct in the graph and absent from the file the dashboard reads.
    try {
      const { debounceMs } = await requestExport();
      log(`[backfill] cold-store re-export scheduled (~${Math.round((debounceMs || 30000) / 1000)}s)\n`);
    } catch (err) {
      log(`[backfill] WARNING: repairs are in the graph but the cold store was NOT refreshed: ${err.message}\n`);
      log('[backfill] They stay invisible to /api/coding/observations until the next\n');
      log('[backfill] observation write. Re-run, or restart obs-api, to flush them.\n');
      process.exit(1);
    }
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  log(`[backfill] FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
