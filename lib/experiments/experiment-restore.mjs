// lib/experiments/experiment-restore.mjs
//
// Phase 77, Plan 77-03 (Wave 2) — RUN-01 / SC#4: the per-cell restore orchestrator.
//
// This module does NOT rebuild the Phase-67 reproducibility rig — it WIRES it. Every
// variant × repeat of an experiment must provably begin from the identical starting
// conditions, so a cross-agent comparison is trustworthy:
//
//   restoreForCell(snapshotId, opts)      → { worktree, sandboxDataDir, digest }   (D-10 sandbox)
//   digestRestoredState({ gitSha, kbDir, settingsPath, worktree }) → 64-char hex   (D-11 hash)
//   assertRepeatsIdentical(results, opts) → shared digest | throws                 (D-11/D-12)
//   runVariantRepeats(snapshotId, n, opts)→ { digest, sandboxes }                  (convenience)
//
// D-09: one declare-time baseline snapshot (captureSnapshot) is captured elsewhere and
//       reused by every cell — this module only RESTORES from it.
// D-10: each cell restores via restoreSnapshot(id, { inPlace:false, ... }) into a FRESH
//       isolated git worktree + sandbox `.data/`; the live checkout/KB is NEVER touched.
// D-11: after each restore, a deterministic sha256 digest is computed over the restored
//       git_sha + sandbox `.data/knowledge-graph/` (canonical exports/*.json only — the
//       regenerated leveldb/ subtree is excluded, CR-01) + `.data/llm-settings.json` routing.
// D-12: two repeats of one variant must digest byte-identically or the experiment ABORTS,
//       with both divergent digests printed (warn-and-continue was explicitly rejected).
//
// SECURITY:
//   • T-77-08 (blast radius): restoreForCell/runVariantRepeats call the rig with
//     `inPlace:false` ONLY — there is no in-place path here and no `--in-place` CLI flag.
//   • T-77-09 (path): snapshot_id is passed straight through to the Phase-67 rig, whose
//     sanitizeTaskId() scopes it — this module never builds a snapshot path from a raw id.
//   • git reads are FIXED-ARGV spawnSync (no shell string) — mirrors restore-snapshot.mjs.
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { restoreSnapshot } from '../repro/restore-snapshot.mjs';

// eslint-disable-next-line no-unused-vars -- kept for parity with sibling repro/experiments modules (repo-root two-up anchor)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GIT_TIMEOUT_MS = 60_000;
// Deterministic sentinel for a source that is absent on disk. Distinct from any real
// file hash so "absent" and "empty file" never silently collide into the same digest.
const ABSENT_SENTINEL = 'absent';

/** sha256 hex of a Buffer/string. Mirrors measurement-stop.mjs:441. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * sha256 of a file's bytes, or the ABSENT_SENTINEL when the path does not exist.
 * NEVER throws on absence (deterministic sentinel); only throws when a present file is
 * genuinely unreadable — a corrupt sandbox must be loud, not silently "identical".
 */
function hashFileOrAbsent(file) {
  if (!file || !fs.existsSync(file)) return ABSENT_SENTINEL;
  try {
    return sha256(fs.readFileSync(file));
  } catch (err) {
    throw new Error(`digestRestoredState: unreadable file ${file}: ${err?.message || err}`);
  }
}

/**
 * Recursively list every file under `dir` as repo-relative POSIX paths (stable across
 * platforms). Returns [] when the dir is absent. Throws only on an unreadable dir.
 */
function listFilesRecursive(dir, rel = '') {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch (err) {
    throw new Error(`digestRestoredState: unreadable dir ${path.join(dir, rel)}: ${err?.message || err}`);
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...listFilesRecursive(dir, childRel));
    } else if (e.isFile()) {
      out.push(childRel);
    }
  }
  return out;
}

/**
 * Read the restored worktree HEAD via a FIXED-ARGV `git rev-parse HEAD` (no shell string;
 * reuses the restore-snapshot.mjs:62-66 shape). Returns '' fail-soft when `worktree` is not
 * a git checkout — a missing SHA is captured deterministically as the empty string, not a throw.
 */
function gitHead(worktree) {
  if (!worktree) return '';
  const res = spawnSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  });
  const ok = !!res && !res.error && res.status === 0;
  return ok && typeof res.stdout === 'string' ? res.stdout.trim() : '';
}

/**
 * Compute a deterministic sha256 digest over the three restored byte-sources (D-11):
 *   • git_sha  — the restored worktree HEAD (passed in, or read from `worktree` when absent).
 *   • KB       — every file under `kbDir` (the SANDBOX knowledge-graph, never the live KB)
 *                EXCEPT the `leveldb/` subtree, which hydrateSandbox regenerates with
 *                non-deterministic bytes (see CR-01 note in the loop below); only the atomic
 *                `exports/*.json` are canonical and byte-stable across identical restores.
 *   • routing  — the bytes of `settingsPath` (the processOverrides-only llm-settings.json).
 *
 * The digest is built from a SORTED manifest of `relpath\0<sha256>` KB entries plus a
 * `git_sha:<sha>` entry and a `routing:<sha>` entry, so on-disk read order is irrelevant and
 * a one-byte change in ANY source flips the digest. Absent kbDir/settingsPath hash to a
 * deterministic sentinel (never a throw); an unreadable present file throws.
 *
 * @param {object} args
 * @param {string} [args.gitSha]      restored git SHA; when falsy, read from `worktree`.
 * @param {string} [args.kbDir]       sandbox `.data/knowledge-graph/` dir.
 * @param {string} [args.settingsPath] sandbox `.data/llm-settings.json` path.
 * @param {string} [args.worktree]    restored worktree (used to resolve gitSha when omitted).
 * @returns {string} 64-char lowercase hex sha256.
 */
export function digestRestoredState({ gitSha, kbDir, settingsPath, worktree } = {}) {
  const resolvedSha = gitSha || gitHead(worktree) || '';

  const manifest = [];
  for (const rel of listFilesRecursive(kbDir)) {
    // CR-01 (Phase 77 review): the sandbox knowledge-graph/leveldb/ store is REGENERATED
    // by hydrateSandbox's GraphKMStore.close() (repro/kb-capture.mjs) — its bytes carry
    // wall-clock timestamps + unstable LevelDB sequence numbers and are NOT byte-exact
    // across two identical restores (the module header there is explicit: only the atomic
    // exports/general.json is canonical). Hashing leveldb/ would make TWO correct repeats
    // digest DIFFERENTLY, so assertRepeatsIdentical would abort a valid restore. Exclude the
    // leveldb/ subtree so the determinism proof reflects the canonical exports, not churn.
    if (rel === 'leveldb' || rel.startsWith('leveldb/')) continue;
    manifest.push(`kb:${rel}\0${hashFileOrAbsent(path.join(kbDir, rel))}`);
  }
  manifest.push(`git_sha:${resolvedSha}`);
  manifest.push(`routing:${hashFileOrAbsent(settingsPath)}`);

  // Sort the WHOLE manifest so neither KB read order nor entry-append order can affect
  // the digest — the assertion is over the SET of restored bytes, not their sequence.
  manifest.sort();
  return sha256(manifest.join('\n'));
}

/**
 * Restore ONE cell (variant × repeat) from `snapshotId` into a fresh isolated sandbox and
 * digest the restored state (D-10 + D-11). Always calls the rig with `inPlace:false` — the
 * live checkout/KB is never touched, so a bad cell has zero blast radius (T-77-08).
 *
 * `restore` is an injectable seam: the real Phase-67 `restoreSnapshot` in production, a stub
 * in unit tests (so the digest logic is exercised without a real git worktree).
 *
 * @param {string} snapshotId the declare-time baseline snapshot id (D-09).
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]   repo working-tree root (forwarded to the rig).
 * @param {string} [opts.dataDir]    live LLM_PROXY_DATA_DIR (forwarded to the rig).
 * @param {string} [opts.ontologyDir] ontology dir for the sandbox KB hydrate (forwarded).
 * @param {Function} [opts.restore=restoreSnapshot] restore seam (test injection point).
 * @returns {Promise<{ worktree: string, sandboxDataDir: string, digest: string }>}
 */
export async function restoreForCell(snapshotId, opts = {}) {
  const { repoRoot, dataDir, ontologyDir, restore = restoreSnapshot } = opts;

  // D-10: sandbox default — the in-place rig path is never selected here. There is no code
  //       path from this module to the destructive overwrite; a bad cell has zero blast radius.
  const restoreOpts = { inPlace: false, repoRoot, dataDir };
  if (ontologyDir) restoreOpts.ontologyDir = ontologyDir;
  const res = await restore(snapshotId, restoreOpts);

  const kbDir = path.join(res.sandboxDataDir, 'knowledge-graph');
  const settingsPath = path.join(res.sandboxDataDir, 'llm-settings.json');
  const gitSha = gitHead(res.worktree);
  // WR-04 (Phase 77 review): a '' fail-soft SHA is correct for the unit stub (a non-git tmp
  // dir), but a REAL restored cell is a git worktree. If it carries a .git entry yet HEAD is
  // unreadable, two identically-FAILED reads could masquerade as "identical" — fail loudly
  // rather than digest a blank git_sha that would mask a broken restore.
  if (!gitSha && res.worktree && fs.existsSync(path.join(res.worktree, '.git'))) {
    throw new Error(
      `restoreForCell: worktree '${res.worktree}' has a .git entry but HEAD is unreadable — ` +
        `refusing to digest a blank git_sha that could mask a failed restore (WR-04)`,
    );
  }
  const digest = digestRestoredState({ gitSha, kbDir, settingsPath, worktree: res.worktree });

  return { worktree: res.worktree, sandboxDataDir: res.sandboxDataDir, digest };
}

/**
 * Assert every repeat of ONE variant restored to a BYTE-IDENTICAL digest (D-11), or THROW
 * with every digest listed — including the two that differ (D-12). This is the hard-fail:
 * a comparison that did not start from identical conditions is not trustworthy, so the run
 * must abort rather than warn-and-continue (warn-only was explicitly rejected).
 *
 * @param {Array<{ digest: string }>} results one entry per repeat of a single variant.
 * @param {object} [opts]
 * @param {string} [opts.variantName] label used in the divergence message.
 * @returns {string} the shared digest when all repeats match.
 * @throws {Error} when any repeat diverges, or when `results` is empty.
 */
export function assertRepeatsIdentical(results, { variantName } = {}) {
  const label = variantName || '(unnamed)';
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`assertRepeatsIdentical: variant '${label}' has no restore results to compare`);
  }
  const first = results[0].digest;
  const diverged = results.some((r) => r.digest !== first);
  if (diverged) {
    // List ALL digests (index-tagged) so BOTH — in fact every — divergent digest is printed.
    const listing = results.map((r, i) => `  repeat #${i}: ${r.digest}`).join('\n');
    throw new Error(
      `experiment aborted: repeats of variant '${label}' did NOT start from identical ` +
        `conditions (digests diverged, D-12):\n${listing}`,
    );
  }
  return first;
}

/**
 * Convenience: restore `repeats` isolated cells of ONE variant from the same baseline
 * snapshot (D-09/D-10) and prove them byte-identical via assertRepeatsIdentical (D-11/D-12).
 *
 * @param {string} snapshotId declare-time baseline snapshot id.
 * @param {number} [repeats=2] number of repeats to restore + compare.
 * @param {object} [opts] forwarded to restoreForCell (repoRoot, dataDir, ontologyDir, restore),
 *                        plus `variantName` for the divergence message.
 * @returns {Promise<{ digest: string, sandboxes: string[] }>}
 */
export async function runVariantRepeats(snapshotId, repeats = 2, opts = {}) {
  const { variantName, ...cellOpts } = opts;
  // WR-03 / IN-01 (Phase 77 review): a determinism PROOF needs at least TWO restores to
  // compare. `repeats: 1` would trivially match itself and report a vacuous byte-identical
  // success; a non-integer/<=0 was previously coerced silently to 2. Reject loudly instead.
  if (!Number.isInteger(repeats) || repeats < 2) {
    throw new Error(
      `runVariantRepeats: repeats must be an integer >= 2 (a determinism proof compares at ` +
        `least two restores); got ${JSON.stringify(repeats)}`,
    );
  }
  const n = repeats;
  const results = [];
  for (let i = 0; i < n; i += 1) {
    results.push(await restoreForCell(snapshotId, cellOpts));
  }
  const digest = assertRepeatsIdentical(results, { variantName });
  return { digest, sandboxes: results.map((r) => r.sandboxDataDir) };
}
