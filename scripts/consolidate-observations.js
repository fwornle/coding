#!/usr/bin/env node
/**
 * consolidate-observations.js — CLI for observation consolidation pipeline.
 *
 * Usage:
 *   node scripts/consolidate-observations.js              # consolidate all past days + insights
 *   node scripts/consolidate-observations.js --date 2026-04-21  # consolidate a specific day
 *   node scripts/consolidate-observations.js --status     # show consolidation status
 *   node scripts/consolidate-observations.js --insights   # run insight synthesis only
 *   node scripts/consolidate-observations.js --daemon      # run continuously, consolidating daily at 02:00
 */

import { ObservationConsolidator } from '../src/live-logging/ObservationConsolidator.js';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const dateFlag = args.indexOf('--date');
const statusFlag = args.includes('--status');
const insightsFlag = args.includes('--insights');
const daemonFlag = args.includes('--daemon');
// JSON mode prints the final result struct to stdout so callers
// (e.g. the dashboard spawning this as a child) can parse it without
// scraping the human-readable stderr log.
const jsonFlag = args.includes('--json');
// Manual triggers (dashboard's POST /api/consolidation/run with no body)
// historically included today's observations as well as past days.
const includeTodayFlag = args.includes('--include-today');

const dbPath = path.resolve('.observations/observations.db');

// Heartbeat file lives next to the database so the dashboard (which already
// knows .observations/) can read it without extra plumbing. Each line that
// the consolidator writes to stderr bumps the heartbeat — that's our
// "still alive" signal. Status endpoint reports the age; orphan sweep on
// dashboard startup kills runs whose heartbeat has gone stale.
const heartbeatPath = path.resolve('.observations/consolidation-heartbeat.json');
const HEARTBEAT_FLUSH_MS = 2000;

let lastStderrLine = 'starting…';
// lastStderrAt updates only when the worker actually emits a log line.
// lastHeartbeat below ticks every 2s regardless — that proves the process is
// alive but is useless for telling whether the worker is currently blocked
// (e.g. on a multi-minute LLM call). The dashboard uses lastStderrAt to drive
// its "last activity Xs ago" / amber-red staleness signal.
let lastStderrAt = new Date().toISOString();
function bumpHeartbeat(extras = {}) {
  try {
    fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
    fs.writeFileSync(heartbeatPath, JSON.stringify({
      pid: process.pid,
      startedAt: HEARTBEAT_STARTED_AT,
      lastHeartbeat: new Date().toISOString(),
      lastStderrAt,
      lastMessage: lastStderrLine,
      args,
      ...extras,
    }));
  } catch { /* heartbeat is best-effort */ }
}
const HEARTBEAT_STARTED_AT = new Date().toISOString();

// Wrap stderr so any consolidator log line refreshes the heartbeat.
const _origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  try {
    const s = typeof chunk === 'string' ? chunk : chunk?.toString?.('utf8');
    if (s) {
      const line = s.trim().split('\n').filter(Boolean).pop();
      if (line) {
        lastStderrLine = line.slice(0, 240);
        lastStderrAt = new Date().toISOString();
      }
    }
  } catch { /* ignore */ }
  bumpHeartbeat();
  return _origStderrWrite(chunk, ...rest);
};

bumpHeartbeat({ stage: 'init' });
const heartbeatTimer = setInterval(bumpHeartbeat, HEARTBEAT_FLUSH_MS);
heartbeatTimer.unref?.();

function clearHeartbeat() {
  clearInterval(heartbeatTimer);
  try { fs.unlinkSync(heartbeatPath); } catch { /* may not exist */ }
}
process.on('exit', clearHeartbeat);
process.on('SIGTERM', () => { clearHeartbeat(); process.exit(143); });
process.on('SIGINT', () => { clearHeartbeat(); process.exit(130); });

function emitJson(obj) {
  if (jsonFlag) process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main() {
  const consolidator = new ObservationConsolidator({ dbPath });
  await consolidator.init();

  try {
    if (statusFlag) {
      const status = consolidator.getStatus();
      process.stderr.write(`\nConsolidation Status:\n`);
      process.stderr.write(`  Observations: ${status.totalObs} total, ${status.undigested} undigested\n`);
      process.stderr.write(`  Digests:      ${status.totalDigests}\n`);
      process.stderr.write(`  Insights:     ${status.totalInsights}\n\n`);
      emitJson({ ok: true, ...status });
      return;
    }

    if (insightsFlag) {
      const result = await consolidator.synthesizeInsights();
      process.stderr.write(`\nInsight synthesis: ${result.created} created, ${result.updated} updated\n`);
      emitJson({ ok: true, ...result });
      return;
    }

    if (dateFlag >= 0 && args[dateFlag + 1]) {
      const date = args[dateFlag + 1];
      const result = await consolidator.consolidateDay(date);
      process.stderr.write(`\n${date}: ${result.digests} digests from ${result.observations} observations\n`);
      emitJson({ ok: true, ...result, created: 0, updated: 0 });
      return;
    }

    if (daemonFlag) {
      // Daemon mode: run immediately, then schedule daily at 02:00 local time
      process.stderr.write(`[consolidate-observations] Daemon mode — running initial consolidation\n`);
      await runPipeline(consolidator);

      const scheduleNext = () => {
        const now = new Date();
        const next = new Date(now);
        next.setHours(2, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        const delay = next.getTime() - now.getTime();
        process.stderr.write(`[consolidate-observations] Next run at ${next.toISOString()} (in ${Math.round(delay / 60000)} min)\n`);
        setTimeout(async () => {
          await runPipeline(consolidator);
          scheduleNext();
        }, delay);
      };
      scheduleNext();
      // Keep process alive
      return;
    }

    // Full pipeline (one-shot)
    const result = await runPipeline(consolidator, { includeToday: includeTodayFlag });
    emitJson({ ok: true, ...result });
  } finally {
    if (!daemonFlag) consolidator.close();
  }
}

async function runPipeline(consolidator, opts = {}) {
  const result = await consolidator.run(opts);
  process.stderr.write(`\nConsolidation complete:\n`);
  process.stderr.write(`  Days processed: ${result.days}\n`);
  process.stderr.write(`  Digests created: ${result.digests}\n`);
  process.stderr.write(`  Observations digested: ${result.observations}\n`);
  process.stderr.write(`  Insights created: ${result.created}\n`);
  process.stderr.write(`  Insights updated: ${result.updated}\n`);
  return result;
}

main().then(() => {
  // Force exit on the one-shot path. Even with consolidator.close() releasing
  // its known handles, third-party HTTP keep-alive agents (qdrant, embedding
  // service) can keep the event loop alive long enough that the dashboard
  // banner stays in "Wrapping up…" for minutes. process.on('exit') still
  // fires clearHeartbeat synchronously so the heartbeat file is unlinked.
  if (!daemonFlag) process.exit(0);
}).catch(err => {
  process.stderr.write(`[consolidate-observations] Fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
