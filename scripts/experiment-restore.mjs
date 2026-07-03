#!/usr/bin/env node
/**
 * Operator CLI — prove one experiment variant restores byte-identically across N repeats
 * (Phase 77, Plan 77-03; RUN-01 / SC#4).
 *
 * Restores `--repeats` isolated sandbox cells from a single declare-time baseline snapshot
 * (D-09/D-10) and asserts every repeat produced a byte-identical digest over the restored
 * git tree + KB + routing config (D-11). On divergence the experiment ABORTS and BOTH
 * digests are printed (D-12). Sandbox-only by construction — no destructive-overwrite flag is
 * exposed; the live checkout/KB is never touched.
 *
 *   node scripts/experiment-restore.mjs --snapshot <id> [--repeats N] [--variant <name>]
 *
 * CLI skeleton copied from scripts/repro-restore.mjs (parseStrArg + main().catch → stderr
 * FATAL + exit 1). Diagnostics via process.stderr.write only (no-console-log constraint,
 * CLAUDE.md). Exits non-zero on any failure.
 *
 * Env:
 *   CODING_REPO             repo working-tree root (default: cwd)
 *   LLM_PROXY_DATA_DIR      live data dir (default: <repoRoot>/.data)
 *   EXPERIMENT_RESTORE_FAKE test-only seam ('match' | 'diverge') — injects a fake restore
 *                           that fabricates a tmp sandbox so the exit-code/digest contract is
 *                           testable without a real snapshot. Fail-soft; ignored in production.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { runVariantRepeats } from '../lib/experiments/experiment-restore.mjs';

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

function usage() {
  process.stderr.write(
    'usage: node scripts/experiment-restore.mjs --snapshot <id> [--repeats N] [--variant <name>]\n' +
    '  --snapshot <id>   (required) the declare-time baseline RunSnapshot id under .data/run-snapshots/\n' +
    '  --repeats N       number of repeats to restore + compare (default 2)\n' +
    '  --variant <name>  label for the variant in the divergence report\n' +
    '  (sandbox-only — the live checkout/KB is never touched; no destructive-overwrite flag)\n',
  );
}

/**
 * Test-only fake restore (EXPERIMENT_RESTORE_FAKE seam). Fabricates a throwaway sandbox `.data`
 * tree so runVariantRepeats can digest a controlled state without a real snapshot/worktree.
 * 'match'   → every call writes identical KB bytes → identical digest (exit 0 path).
 * 'diverge' → each call writes different KB bytes → divergent digests (abort path).
 */
function makeFakeRestore(mode) {
  let call = 0;
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-restore-fake-'));
    const sandboxDataDir = path.join(root, '.data');
    const kbDir = path.join(sandboxDataDir, 'knowledge-graph');
    fs.mkdirSync(kbDir, { recursive: true });
    const kbContent = mode === 'diverge' ? `divergent-${call}` : 'stable';
    fs.writeFileSync(path.join(kbDir, 'general.json'), kbContent);
    fs.writeFileSync(path.join(sandboxDataDir, 'llm-settings.json'), '{}');
    call += 1;
    // Not a git checkout → digestRestoredState resolves git_sha to '' fail-soft (deterministic).
    return { worktree: root, sandboxDataDir, replayArmed: false, inPlace: false, steps: {} };
  };
}

async function main() {
  const args = process.argv.slice(2);
  const snapshotId = parseStrArg(args, '--snapshot');
  const repeatsArg = parseStrArg(args, '--repeats');
  const variantName = parseStrArg(args, '--variant') || undefined;

  if (!snapshotId) {
    process.stderr.write('error: --snapshot <id> is required\n');
    usage();
    process.exit(2);
  }

  const repeats = repeatsArg ? Number.parseInt(repeatsArg, 10) : 2;
  if (!Number.isInteger(repeats) || repeats < 1) {
    process.stderr.write(`error: --repeats must be a positive integer (got '${repeatsArg}')\n`);
    process.exit(2);
  }

  const repoRoot = process.env.CODING_REPO || process.cwd();
  const dataDir = process.env.LLM_PROXY_DATA_DIR || path.join(repoRoot, '.data');

  const opts = { repoRoot, dataDir, variantName };
  const fake = process.env.EXPERIMENT_RESTORE_FAKE;
  if (fake) opts.restore = makeFakeRestore(fake);

  // runVariantRepeats throws on divergence (D-12) → routed through main().catch → exit 1.
  const { digest } = await runVariantRepeats(snapshotId, repeats, opts);
  process.stderr.write(`shared digest: ${digest}\n`);
  process.stderr.write(`${repeats} repeats byte-identical\n`);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.message}\n`);
  process.exit(1);
});
