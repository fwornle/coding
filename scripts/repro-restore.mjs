#!/usr/bin/env node
/**
 * Operator CLI — restore a RunSnapshot (Phase 67, Plan 67-05; REPRO-01 / SC-2).
 *
 * DEFAULT (safe, casual — D-04): reconstruct the captured state into an ISOLATED git
 * worktree + a sandbox LLM_PROXY_DATA_DIR. The live checkout and live KB are never touched.
 *
 *   node scripts/repro-restore.mjs --snapshot <id>
 *
 * --in-place (rare, DESTRUCTIVE — D-05): overwrite the LIVE checkout + hydrate the LIVE KB.
 * restoreSnapshot() first captures an automatic safety snapshot of the current live state,
 * then this CLI requires the operator to TYPE a confirmation token (`yes-overwrite-live`)
 * before the destructive write proceeds. Any other answer aborts before any live path is
 * written.
 *
 *   node scripts/repro-restore.mjs --snapshot <id> --in-place
 *
 * CLI skeleton copied from scripts/measurement-start.mjs (parseStrArg + prompt readline
 * helper + main().catch wrapper). Logging via process.stderr.write only (no console.* —
 * no-console-log, CLAUDE.md). Exits non-zero on any failure.
 *
 * Env:
 *   CODING_REPO         repo working-tree root (default: cwd)
 *   LLM_PROXY_DATA_DIR  live data dir (default: <repoRoot>/.data)
 */

import process from 'node:process';
import path from 'node:path';
import readline from 'node:readline';

import { restoreSnapshot } from '../lib/repro/restore-snapshot.mjs';

const CONFIRM_TOKEN = 'yes-overwrite-live';

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

/** Ask one question on the TTY and resolve the trimmed answer (mirrors measurement-start.mjs:47). */
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer).trim());
    });
  });
}

function usage() {
  process.stderr.write(
    'usage: node scripts/repro-restore.mjs --snapshot <id> [--in-place]\n' +
    '  --snapshot <id>  (required) the RunSnapshot id under .data/run-snapshots/\n' +
    '  --in-place       overwrite the LIVE checkout + KB (auto safety snapshot + typed confirmation)\n',
  );
}

async function main() {
  const args = process.argv.slice(2);
  const snapshotId = parseStrArg(args, '--snapshot');
  const inPlace = args.includes('--in-place');

  if (!snapshotId) {
    process.stderr.write('error: --snapshot <id> is required\n');
    usage();
    process.exit(2);
  }

  const repoRoot = process.env.CODING_REPO || process.cwd();
  const dataDir = process.env.LLM_PROXY_DATA_DIR || path.join(repoRoot, '.data');

  if (!inPlace) {
    // ── Default sandbox restore (D-04) ──
    const res = await restoreSnapshot(snapshotId, { inPlace: false, repoRoot, dataDir });
    process.stdout.write(`restored snapshot '${snapshotId}' into an isolated sandbox\n`);
    process.stdout.write(`  worktree:       ${res.worktree}\n`);
    process.stdout.write(`  sandboxDataDir: ${res.sandboxDataDir}\n`);
    process.stdout.write(`  replayArmed:    ${res.replayArmed}\n`);
    process.stdout.write(`  run with: LLM_PROXY_DATA_DIR=${res.sandboxDataDir}\n`);
    return;
  }

  // ── --in-place (D-05): loud warning + typed confirmation token ──
  process.stderr.write(
    '\n*** WARNING: --in-place will OVERWRITE the LIVE checkout and hydrate the LIVE KB ***\n' +
    'An automatic safety snapshot of the current live state is captured first, but this is destructive.\n' +
    `To proceed, type exactly: ${CONFIRM_TOKEN}\n`,
  );
  const answer = await prompt(`confirm in-place restore of '${snapshotId}' [${CONFIRM_TOKEN}]: `);
  const confirm = answer === CONFIRM_TOKEN;
  if (!confirm) {
    process.stderr.write('aborted: confirmation token did not match; no live path was written.\n');
  }

  const res = await restoreSnapshot(snapshotId, { inPlace: true, confirm, repoRoot, dataDir });
  process.stdout.write(`in-place restore of '${snapshotId}' complete\n`);
  process.stdout.write(`  safetySnapshot: ${res.backupDir}\n`);
  process.stdout.write(`  liveDataDir:    ${res.sandboxDataDir}\n`);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
