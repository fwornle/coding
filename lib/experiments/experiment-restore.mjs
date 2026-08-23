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
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { restoreSnapshot } from '../repro/restore-snapshot.mjs';

// eslint-disable-next-line no-unused-vars -- kept for parity with sibling repro/experiments modules (repo-root two-up anchor)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where cell sandboxes are materialized. Deliberately OUTSIDE the repo tree.
 *
 * Two independent reasons, both measured 2026-08-23:
 *  1. Agent rules files are discovered by walking UP from the cwd. `/Users/<user>/CLAUDE.md`
 *     exists, so a sandbox under `<repoRoot>/.data/run-restores` (or anywhere under $HOME)
 *     inherits real project instructions no in-sandbox strip can remove — and this repo's own
 *     CLAUDE.md carries all three graded A/B facts verbatim.
 *  2. It keeps a cell's writes off the repo tree entirely, so a sandbox escape shows up as an
 *     absolute path into `<repoRoot>` rather than blending into `.data/`.
 * `os.tmpdir()` has no CLAUDE.md ancestor (verified: /, /private, /private/tmp, /var all clean).
 * Overridable so an operator can point cells at a larger volume without editing code.
 */
export const CELL_SANDBOX_ROOT = (() => {
  const configured = process.env.CODING_EXPERIMENT_SANDBOX_ROOT;
  if (configured) return canonicalize(configured);
  // NOT `os.tmpdir()`. Two independent ways that path breaks transcript location on macOS, both
  // hit on the 2026-08-23 isolated run — and both fail SILENTLY, closing the cell `complete`
  // with a null step count rather than erroring:
  //   1. `/var` is a symlink to `/private/var`, so the agent's cwd resolves one way and the
  //      recorded span cwd the other.
  //   2. `os.tmpdir()` is `/var/folders/p_/…` — and Claude encodes `_` to `-` when naming
  //      `~/.claude/projects/<encoded-cwd>`, while the harness locator only rewrites `/` and `.`
  //      (`cwd.replace(/[/.]/g,'-')`). `-p_-` never meets `-p--`.
  // `/tmp` exists on macOS and Linux, canonicalizes cleanly, and contains no `_`.
  const base = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
  return canonicalize(path.join(base, 'coding-experiment-sandboxes'));
})();

/**
 * Characters on which the harness's transcript encoder and Claude's own project-dir encoder are
 * known to AGREE. Claude rewrites more than `[/.]`, so any other punctuation in a sandbox path
 * silently desynchronises the two and produces traceless cells.
 */
const ENCODER_SAFE_PATH_RE = /^[A-Za-z0-9/.-]+$/;

/**
 * Resolve symlinks in `p` without requiring `p` itself to exist yet: realpath the deepest
 * ancestor that does exist, then re-append the missing tail.
 */
function canonicalize(p) {
  const abs = path.resolve(p);
  let head = abs;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...tail);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs; // hit the root with nothing resolvable
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

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
 * @param {boolean} [opts.avenueMode] restore onto a NAMED `branchName` avenue worktree (Phase 87,
 *                  AVN-05) instead of the detached default — forwarded straight to the rig.
 * @param {string} [opts.branchName] the `avenue/<task_id>` branch ref (avenueMode only).
 * @param {Function} [opts.restore=restoreSnapshot] restore seam (test injection point).
 * @returns {Promise<{ worktree: string, sandboxDataDir: string, digest: string }>}
 */
export async function restoreForCell(snapshotId, opts = {}) {
  const { repoRoot, dataDir, ontologyDir, avenueMode, branchName, restore = restoreSnapshot } = opts;

  // D-10: sandbox default — the in-place rig path is never selected here. There is no code
  //       path from this module to the destructive overwrite; a bad cell has zero blast radius.
  const restoreOpts = { inPlace: false, repoRoot, dataDir };
  if (ontologyDir) restoreOpts.ontologyDir = ontologyDir;
  // Project-identity isolation (2026-08-23). A linked worktree keeps `--git-common-dir` on the
  // ORIGIN `.git`, and Claude Code resolves a session's project — hence its injected memory
  // index — from that; measured, cells were handed the real project's MEMORY.md and read the
  // graded fact straight out of it as their FIRST tool call, in BOTH arms. Scrubbing env and
  // relocating the worktree were both measured NOT to close it. An avenue keeps the worktree
  // (its branch must live in the origin) and is not a measurement cell, so it is unaffected.
  if (!avenueMode) {
    restoreOpts.independentRepo = true;
    restoreOpts.restoreRoot = CELL_SANDBOX_ROOT;
  }
  // Phase 87 (AVN-05): an avenue cell requests restoreForCell(id, { avenueMode:true,
  // branchName:'avenue/<task_id>' }); thread both through so the rig creates the named branch.
  if (avenueMode && branchName) {
    restoreOpts.avenueMode = true;
    restoreOpts.branchName = branchName;
  }
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

  // The sandbox path is recorded as the span's cwd and later ENCODED to locate the agent's
  // transcript. If any symlink survives in it, the agent resolves its cwd one way and the
  // locator encodes it the other, no transcript is found, and the cell scores as a trivial run
  // while still closing `complete` — a silent mis-measurement, not an error. Assert the path is
  // already canonical so a future change of sandbox root cannot reintroduce that quietly.
  // Only police the PRODUCTION restore seam. Unit tests inject a stub that returns an
  // `fs.mkdtemp` path in os.tmpdir() — which on macOS is exactly the `/var/folders/p_/…` shape
  // these checks reject. Those paths are synthetic and never transcript-located, so enforcing
  // there would fail honest tests while protecting nothing.
  const isProductionRestore = restore === restoreSnapshot;
  if (isProductionRestore && !ENCODER_SAFE_PATH_RE.test(res.worktree)) {
    throw new Error(
      `restoreForCell: sandbox path '${res.worktree}' contains a character the transcript ` +
        'encoders disagree on (safe set: letters, digits, / . -). Claude rewrites e.g. "_" to "-" ' +
        'when naming ~/.claude/projects/<encoded-cwd> but the locator only rewrites "/" and "."; ' +
        'the cell would then be scored trivial with no trace. Choose a different CELL_SANDBOX_ROOT.',
    );
  }
  try {
    const real = isProductionRestore ? fs.realpathSync(res.worktree) : res.worktree;
    if (real !== res.worktree) {
      throw new Error(
        `restoreForCell: sandbox path is not canonical ('${res.worktree}' resolves to '${real}'). ` +
          'Same failure mode as above: the locator encodes the RECORDED cwd, so a symlinked root ' +
          'silently yields traceless, fake-trivial cells. Point CELL_SANDBOX_ROOT at a real path.',
      );
    }
  } catch (err) {
    if (/not canonical/.test(err?.message || '')) throw err;
    // realpath failed for an unrelated reason (races, permissions) — not worth failing a cell.
  }

  return { worktree: res.worktree, sandboxDataDir: res.sandboxDataDir, digest };
}

/**
 * Agent project-rules files that some CLIs auto-ingest from the working directory as instructions.
 * A restored snapshot materializes the REAL project's CLAUDE.md into the sandbox — and that file
 * hardcodes the LIVE repo's absolute path (`Primary working directory: /Users/.../coding`, plus dozens
 * of absolute paths). opencode reads CLAUDE.md as its rules file, so when the goal says "write at the
 * repository root" the model uses the HARDCODED real path and escapes the sandbox (confirmed leak,
 * 2026-07-23: opencode wrote `fizzbuzz.mjs` to the real repo root; copilot, which reads
 * `.github/copilot-instructions.md` — absent from the sandbox — stayed contained via its cwd).
 */
const SANDBOX_RULES_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  path.join('.github', 'copilot-instructions.md'),
  '.cursorrules',
  '.windsurfrules',
];

/**
 * Remove agent project-rules files from a restored sandbox worktree so no restored rule can steer an
 * agent out of its sandbox (e.g. via a hardcoded absolute path). Runs ALWAYS — it is a sandbox-integrity
 * measure, independent of the CODING_KNOWLEDGE_INJECTION context axis (the cells already suppress KB
 * *injection*; this closes the restored-rules-*file* vector the same intent left open). The worktree is
 * a throwaway detached git worktree, so removal is safe and never touches the live checkout.
 *
 * Fail-soft: a missing file is a no-op; a file that cannot be unlinked is logged and skipped, never
 * aborting a cell. Returns the worktree-relative paths actually removed.
 *
 * @param {string} worktree the sandbox worktree root.
 * @returns {string[]} the rules files removed (empty if none were present).
 */
export function neutralizeSandboxRules(worktree) {
  if (!worktree) return [];
  const removed = [];
  for (const rel of SANDBOX_RULES_FILES) {
    const file = path.join(worktree, rel);
    try {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        removed.push(rel);
      }
    } catch (err) {
      process.stderr.write(
        `[experiments] neutralizeSandboxRules: could not remove ${rel}: ${err.message}\n`,
      );
    }
  }
  return removed;
}

/**
 * Knowledge-bearing paths a restored snapshot materializes into the sandbox. These are the
 * `kb-off` leak channels: the arm sets CODING_KNOWLEDGE_INJECTION=0, which suppresses the
 * *injection seam* — but the restored tree still ships the very corpus that seam would have
 * injected, so a kb-off agent simply greps for it instead of being handed it. Measured on the
 * 2026-08-22 A/B (all 18 cells audited from their own transcripts):
 *
 *   • `.claude/settings.local.json` — a 591-entry allow-list that literally spells out
 *     `/Users/<u>/.claude/projects/-Users-<u>-Agentic-coding/memory/<file>.md`. This is the
 *     POINTER: 13 of 18 cells read the project memory dir, and for leveldb kb-off r2 it was the
 *     FIRST tool call — `reference_kmcore_read_path_write_amplification.md`, which states the
 *     graded answer outright. Without the pointer the cell's own memory dir is a different,
 *     empty one (keyed by its sandbox cwd), so removing this closes the channel at the source.
 *   • `.data/knowledge-graph/` — the 45 MB graph export, i.e. the same corpus kb-on injects.
 *   • `knowledge-management/` — 989 insight markdown files: that corpus again, in prose.
 *   • `.planning/`, `.specstory/`, `.data/observation-export/` — notes, session history and
 *     observation dumps that restate project causal knowledge and absolute host paths.
 *
 * SAFE FOR THE TREATMENT ARM. kb-on retrieval does NOT read these: cell-injection.mjs fetches
 * from the LIVE obs-api (`localhost:${OBS_API_PORT||12436}/api/retrieve`). The sandbox copy is
 * inert for kb-on and grep-able only for kb-off, so stripping it removes leak surface without
 * touching the treatment. Verified before this landed.
 *
 * ORDERING. Runs AFTER restoreForCell has digested the restore (D-11), so the byte-identical
 * proof still describes what the rig produced; stripping is deterministic, so repeats stay
 * identical to each other either way.
 */
const SANDBOX_KNOWLEDGE_PATHS = [
  path.join('.claude', 'settings.local.json'),
  path.join('.data', 'knowledge-graph'),
  path.join('.data', 'observation-export'),
  'knowledge-management',
  '.planning',
  '.specstory',
];

/**
 * Remove the knowledge-bearing paths above from a restored sandbox worktree, so `kb-off` means
 * "no project knowledge" rather than merely "no injection". Like neutralizeSandboxRules this runs
 * ALWAYS and on BOTH arms — an isolation measure applied asymmetrically would itself become the
 * confound it is meant to remove.
 *
 * A directory is removed and then RECREATED EMPTY, so anything that expects the path to exist
 * (a km-core open against `.data/knowledge-graph`) finds a dir rather than an ENOENT. Files are
 * removed outright.
 *
 * Fail-soft, mirroring neutralizeSandboxRules: an absent path is a no-op; one that cannot be
 * removed is logged and skipped, never aborting a cell.
 *
 * @param {string} worktree the sandbox worktree root.
 * @returns {string[]} the worktree-relative paths actually removed (empty if none were present).
 */
export function neutralizeSandboxKnowledge(worktree) {
  if (!worktree) return [];
  const removed = [];
  for (const rel of SANDBOX_KNOWLEDGE_PATHS) {
    const target = path.join(worktree, rel);
    try {
      if (!fs.existsSync(target)) continue;
      const wasDir = fs.statSync(target).isDirectory();
      fs.rmSync(target, { recursive: true, force: true });
      // Recreate directories empty: absence and emptiness are different failure modes for a
      // consumer, and an ENOENT here would surface as a cell crash rather than a clean no-KB run.
      if (wasDir) fs.mkdirSync(target, { recursive: true });
      removed.push(rel);
    } catch (err) {
      process.stderr.write(
        `[experiments] neutralizeSandboxKnowledge: could not remove ${rel}: ${err.message}\n`,
      );
    }
  }
  return removed;
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
