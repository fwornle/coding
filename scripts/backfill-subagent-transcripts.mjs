#!/usr/bin/env node
/**
 * scripts/backfill-subagent-transcripts.mjs — Phase 51 thin wrapper.
 *
 * DEPRECATED — this script is preserved for backward-compatibility with the
 * pre-Phase-51 invocation surface (`node scripts/backfill-subagent-transcripts.mjs`).
 * The real work lives in scripts/sweep-sub-agents.mjs (Plan 51-01 dispatcher).
 *
 * Per Phase 51 Plan 02 Task 2: this file is a ≤30-line wrapper that delegates
 * to `scripts/sweep-sub-agents.mjs --agent claude --project coding`. The
 * `--historical` flag forwards through the dispatcher to the adapter's
 * `convertToObservations` so the 2026-05-23 transcripts (now older than the
 * Phase 50 48h MAX_AGE_MS gate) can still be backfilled.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

process.stderr.write('[backfill] deprecated; delegating to scripts/sweep-sub-agents.mjs --agent claude --project coding\n');

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatcher = path.join(here, 'sweep-sub-agents.mjs');
const forwarded = process.argv.slice(2);
const args = [dispatcher, '--agent', 'claude', '--project', 'coding', '--limit', '100', ...forwarded];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
