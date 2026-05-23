#!/usr/bin/env node
/**
 * One-shot backfill of sub-agent worktree transcripts that the per-project
 * ETM doesn't watch. Walks `<coding-project-dir>/<parent>/subagents/*.jsonl`,
 * converts each via TranscriptNormalizer + ObservationWriter, tagging the
 * resulting rows with `metadata.project = 'coding'` and
 * `metadata.source = 'sub-agent-backfill'` for later identification.
 *
 * Idempotent — ObservationWriter content_hash + semantic-dedup gates skip
 * already-captured rows.
 *
 * Files actively being written (mtime within the last 5 min) are skipped
 * to avoid racing live sub-agents; they'll be picked up on a later sweep.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseClaude } from '../src/live-logging/TranscriptNormalizer.js';
import { ObservationWriter } from '../src/live-logging/ObservationWriter.js';

const PROJECTS_DIR = '/Users/Q284340/.claude/projects/-Users-Q284340-Agentic-coding';
const RACE_GUARD_MS = 5 * 60_000;
const MAX_AGE_MS = 48 * 60 * 60_000;       // skip transcripts older than 2 days — focus on the at-risk window
const MAX_FILE_BYTES = 20 * 1024 * 1024;   // skip runaway logs (>20MB) — too big to summarize sanely
const PROJECT = 'coding';

const out = (s) => process.stderr.write(s + '\n');

function listSubagentTranscripts(root) {
  const out = [];
  for (const sessionDir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!sessionDir.isDirectory()) continue;
    const subagentsDir = path.join(root, sessionDir.name, 'subagents');
    if (!fs.existsSync(subagentsDir)) continue;
    for (const f of fs.readdirSync(subagentsDir)) {
      if (!f.endsWith('.jsonl')) continue;
      out.push(path.join(subagentsDir, f));
    }
  }
  return out;
}

async function convertFile(filePath, writer) {
  const stat = fs.statSync(filePath);
  if (Date.now() - stat.mtimeMs < RACE_GUARD_MS) {
    return { skipped: 'still-active', observations: 0, errors: 0, bytes: stat.size };
  }
  if (Date.now() - stat.mtimeMs > MAX_AGE_MS) {
    return { skipped: 'too-old', observations: 0, errors: 0, bytes: stat.size };
  }
  if (stat.size > MAX_FILE_BYTES) {
    return { skipped: `too-big (${(stat.size/1024/1024).toFixed(1)}MB)`, observations: 0, errors: 0, bytes: stat.size };
  }
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let exchange = [];
  let totalObs = 0, errors = 0, totalLines = 0;
  for await (const line of rl) {
    totalLines++;
    if (!line.trim()) continue;
    let msg;
    try { msg = parseClaude(line); } catch { errors++; continue; }
    if (!msg) continue;
    exchange.push(msg);
    const hasUser = exchange.some(m => m.role === 'user');
    const hasAsst = exchange.some(m => m.role === 'assistant');
    if (hasUser && hasAsst && msg.role === 'assistant') {
      try {
        const r = await writer.processMessages(exchange, {
          agent: 'claude',
          project: PROJECT,
          sourceFile: filePath,
          source: 'sub-agent-backfill',
        });
        totalObs += r.observations || 0;
        errors += r.errors || 0;
      } catch (err) {
        errors++;
        out(`  ! exchange write failed: ${err.message}`);
      }
      exchange = [];
    }
  }
  if (exchange.length > 0) {
    try {
      const r = await writer.processMessages(exchange, {
        agent: 'claude',
        project: PROJECT,
        sourceFile: filePath,
        source: 'sub-agent-backfill',
      });
      totalObs += r.observations || 0;
      errors += r.errors || 0;
    } catch (err) {
      errors++;
    }
  }
  return { observations: totalObs, errors, lines: totalLines, bytes: stat.size };
}

async function main() {
  const files = listSubagentTranscripts(PROJECTS_DIR);
  out(`[backfill] discovered ${files.length} sub-agent transcripts under ${PROJECTS_DIR}`);
  if (files.length === 0) { out('[backfill] nothing to do'); return; }

  // Sort largest-first so we get the most signal early in case we're killed.
  files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);

  const writer = new ObservationWriter();
  await writer.init();
  let totalObs = 0, totalErrors = 0, totalSkipped = 0;
  const t0 = Date.now();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const sz = fs.statSync(f).size;
    out(`[backfill] ${i + 1}/${files.length}  ${(sz/1024).toFixed(1)}KB  ${path.basename(f)}`);
    const r = await convertFile(f, writer);
    if (r.skipped) {
      out(`           SKIP (${r.skipped})`);
      totalSkipped++;
      continue;
    }
    out(`           -> ${r.observations} obs, ${r.errors} errors (${r.lines} lines)`);
    totalObs += r.observations;
    totalErrors += r.errors;
  }
  await writer.close?.();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  out(`\n[backfill] DONE in ${elapsed}s  files=${files.length} skipped=${totalSkipped} observations=${totalObs} errors=${totalErrors}`);
}

main().catch((err) => { process.stderr.write(`[backfill] fatal: ${err.stack || err.message}\n`); process.exit(1); });
