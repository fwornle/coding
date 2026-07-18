#!/usr/bin/env node
// scripts/auto-measure-foreground.mjs
//
// AUTOMATIC foreground measurement — no manual "measure" needed.
//
// PROBLEM (the attribution gap): opencode sessions running on a BYPASS provider
// (e.g. github-copilot) never route through the rapid-llm-proxy, so their tokens
// are invisible to the wire tap. measurement-start/stop only captures a single
// manually-opened span. This daemon closes that gap continuously: every opencode
// session becomes its OWN idempotent dashboard Run (keyed on task_id=<session_id>),
// self-healing on each pass as the session grows.
//
// DESIGN
//   • Source of truth: opencode's SQLite store (per-message tokens + per-turn parts).
//   • Double-count safe: reuses buildOpencodeTokenRows, which emits rows ONLY for
//     BYPASS providers — proxy-routed (anthropic) opencode turns are skipped, so we
//     never duplicate wire rows already in token_usage.
//   • Idempotent: insertTokenRowDeduped (dedupe on tool_call_id = <session>:<message>)
//     + writeRun keyed on task_id ⇒ re-running only UPDATES, never duplicates.
//   • Rolling: a session with activity in the last ACTIVE_WINDOW_MS is (re)written;
//     inactive sessions are left as-is (already final).
//
// USAGE
//   node scripts/auto-measure-foreground.mjs --once          # one pass (cron/supervisor)
//   node scripts/auto-measure-foreground.mjs --interval 120  # loop every 120s
//   node scripts/auto-measure-foreground.mjs --window 30     # "active" = seen in last 30 min
//
// Output via process.stderr.write only (no-console-log rule).

import { buildOpencodeTokenRows, DEFAULT_OPENCODE_DB } from '../lib/lsl/token/opencode-token-rows.mjs';
import { llmSessionTitle, llmSessionSummary } from '../lib/lsl/token/session-title-llm.mjs';
import { openTokenDb, insertTokenRowDeduped } from '../lib/lsl/token/token-db.mjs';
import { aggregateByTaskId, isForegroundGroup } from '../lib/experiments/token-aggregate.mjs';
import { openExperimentStore } from '../lib/experiments/store.mjs';
import { writeRun } from '../lib/experiments/run-write.mjs';
import { loadTaxonomy, deriveClassFromText } from '../lib/experiments/taxonomy.mjs';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

function log(msg) { process.stderr.write(`[auto-measure] ${msg}\n`); }

/** Same token DB the proxy owns and aggregateByTaskId reads (Plan 71-03). */
function tokenDbPath() {
  const dir = process.env.LLM_PROXY_DATA_DIR || '/Users/Q284340/Agentic/coding/.data';
  return path.join(dir, 'llm-proxy', 'token-usage.db');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const HAS = (name) => process.argv.includes(name);

const ACTIVE_WINDOW_MS = parseInt(arg('--window', '30'), 10) * 60_000;
const INTERVAL_S = parseInt(arg('--interval', '0'), 10);

// Strip noise that must never survive into a human-facing title: embedded
// absolute/home paths, [Image N] attachment markers, and inline URLs. Keeps the
// surrounding prose intact ("...in the repo /Users/x" -> "...in the repo").
function stripTitleNoise(s) {
  return String(s)
    .replace(/\[Image[^\]]*\]/gi, ' ')                // [Image 1] attachment markers
    .replace(/\((?:project|repo)[^)]*\)/gi, ' ')       // (project coding) tails
    .replace(/https?:\/\/\S+/g, ' ')                   // inline URLs
    .replace(/(?:~|\/)[\w.\-]+(?:\/[\w.\-]+)+\/?/g, ' ') // absolute/home paths
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

// Pull the first natural-language line out of a message, skipping shell prompts,
// command output, log lines, and paths so the title reads like a human request.
function firstProseLine(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (/^\S+@\S+.*[%$#]\s/.test(l)) continue;      // user@host dir % cmd
    if (/^[$#%>]\s/.test(l)) continue;               // $ cmd / > output
    if (/^\[?\d{4}-\d{2}-\d{2}/.test(l)) continue;    // 2026-.. timestamps
    if (/^\[(INFO|WARN|ERROR|DEBUG)\]/i.test(l)) continue; // log levels
    if (/^(https?:\/\/|\/|~\/|\.\/)/.test(l)) continue;    // urls / paths
    const letters = (l.match(/[a-zA-Z]/g) || []).length;
    if (letters < Math.max(6, l.length * 0.4)) continue;   // mostly symbols/output
    const cleaned = stripTitleNoise(l);
    if (cleaned && (cleaned.match(/[a-zA-Z]/g) || []).length >= 6) return cleaned;
  }
  return '';
}

// Truncate on a word boundary with an ellipsis, and capitalise the first letter.
function tidy(s, max = 72) {
  let clean = String(s).replace(/\s+/g, ' ').trim().replace(/[\s:;,.\-]+$/, '');
  if (!clean) return clean;
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

// A short, human-friendly title for a session: its first real USER request,
// cleaned of shell/log noise. Falls back to any prose, then the session id.
function sessionTitle(dbPath, sessionId) {
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    // Prefer text parts belonging to USER messages, in order.
    const userRows = db.prepare(
      `SELECT p.data AS pdata FROM part p
         JOIN message m ON m.id = p.message_id
        WHERE m.session_id = ?
          AND m.data LIKE '%"role":"user"%'
          AND p.data LIKE '%"type":"text"%'
        ORDER BY p.rowid ASC LIMIT 60`
    ).all(sessionId);
    for (const r of userRows) {
      try {
        const d = JSON.parse(r.pdata);
        if (d && d.type === 'text' && typeof d.text === 'string') {
          const prose = firstProseLine(d.text);
          if (prose) return tidy(prose);
        }
      } catch { /* skip malformed part */ }
    }
  } catch { /* fall through */ } finally { try { db?.close(); } catch { /* noop */ } }
  return `opencode session ${sessionId.slice(0, 12)}`;
}

async function onePass(dbPath) {
  const now = Date.now();
  // buildOpencodeTokenRows returns bypass-provider rows across recent sessions,
  // each tagged tool_call_id = `${session_id}:${message_id}` and an ISO timestamp.
  const rows = buildOpencodeTokenRows(dbPath);
  if (!rows.length) { log('no bypass-provider rows found — nothing to measure'); return; }

  // Group by session; an "active" session has a row within ACTIVE_WINDOW_MS.
  const bySession = new Map();
  for (const r of rows) {
    const sid = String(r.tool_call_id || '').split(':')[0];
    if (!sid) continue;
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(r);
  }

  const tokenDb = openTokenDb(tokenDbPath());
  const store = await openExperimentStore();
  // Closed-6 taxonomy for zero-LLM class derivation (D-11). Load once; if the
  // SoT YAML is missing/malformed every session honestly falls back to the
  // 'unclassified' quarantine sentinel rather than a meaningless constant.
  let taxonomy = null;
  try { taxonomy = loadTaxonomy(); } catch (err) { log(`taxonomy load failed → all sessions unclassified: ${err.message}`); }
  let written = 0;
  try {
    for (const [sid, srows] of bySession) {
      const lastMs = Math.max(...srows.map((r) => Date.parse(r.timestamp) || 0));
      // --backfill recomputes every session (canonical_model/summary) regardless
      // of recency; normal passes only (re)write sessions still active.
      if (!HAS('--backfill') && now - lastMs > ACTIVE_WINDOW_MS) continue;

      const taskId = sid; // one Run per opencode session
      for (const r of srows) insertTokenRowDeduped(tokenDb, { ...r, task_id: taskId });

      const agg = aggregateByTaskId(taskId);
      const totals = agg.totals;
      // Canonical chat model: the largest measured FOREGROUND group; background
      // models are every non-foreground group. writeRun reads these from `tags`
      // (NOT totals) — putting them anywhere else persists as "unmeasured" even
      // though the per-turn rows carry the model.
      const groups = agg.byAgentModel || [];
      const fgGroups = groups.filter(isForegroundGroup);
      const canonical = fgGroups[0] ?? null;
      const bgModels = [...new Set(
        groups.filter((g) => !isForegroundGroup(g)).map((g) => g.model).filter(Boolean),
      )];
      const started = new Date(Math.min(...srows.map((r) => Date.parse(r.timestamp) || now))).toISOString();
      const ended = new Date(lastMs).toISOString();
      // Intelligent LLM title + 1–2 sentence overview summary (both cached,
      // self-refreshing); fall back to the heuristic first-prose-line whenever
      // the proxy/LLM is unavailable.
      const title = (await llmSessionTitle(dbPath, sid, log)) || sessionTitle(dbPath, sid);
      const summary = await llmSessionSummary(dbPath, sid, log);
      const model = canonical?.model || srows[srows.length - 1]?.model || 'unknown';
      const taskHash = createHash('sha256').update(title).digest('hex').slice(0, 16);
      // Derive a real closed-6 class from the session's intent (title + summary)
      // instead of a hardcoded constant. Only a CONFIDENT keyword derivation
      // (D-11 threshold) is trusted; anything weaker is honestly 'unclassified'
      // (the quarantine sentinel) so the column reflects reality, not a label.
      const derived = taxonomy
        ? deriveClassFromText(`${title} ${summary ?? ''}`, taxonomy)
        : { taskClass: null, confident: false };
      const taskClass = derived.confident ? derived.taskClass : 'unclassified';

      await writeRun(store, {
        span: { task_id: taskId, started_at: started, ended_at: ended, goal_sentence: title },
        taskClass,
        pending: false,
        tags: {
          task_hash: taskHash, agent: 'opencode', model, framework: 'opencode', trace_id: taskId,
          canonical_model: canonical?.model ?? null,
          canonical_agent: canonical?.agent ?? 'opencode',
          background_models: bgModels,
          session_summary: summary ?? null,
        },
        totals,
      });
      written += 1;
      log(`session ${sid.slice(0, 12)} · ${srows.length} turns · ${totals.total_tokens} tok · "${title.slice(0, 48)}"`);
    }
  } finally {
    try { tokenDb.close?.(); } catch { /* noop */ }
    await store.close();
  }
  log(`pass complete — ${written} active session(s) written`);
}

async function main() {
  const dbPath = arg('--db', DEFAULT_OPENCODE_DB);
  if (INTERVAL_S > 0 && !HAS('--once')) {
    log(`daemon mode — every ${INTERVAL_S}s, active-window ${ACTIVE_WINDOW_MS / 60000}min`);
    // eslint-disable-next-line no-constant-condition
    for (let tick = 0; tick < Number.MAX_SAFE_INTEGER; tick++) {
      try { await onePass(dbPath); } catch (e) { log(`pass error: ${e.message}`); }
      await new Promise((res) => setTimeout(res, INTERVAL_S * 1000));
    }
  } else {
    await onePass(dbPath);
  }
}

main().catch((e) => { log(`fatal: ${e.stack || e.message}`); process.exit(1); });
