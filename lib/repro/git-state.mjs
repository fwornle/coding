// lib/repro/git-state.mjs
//
// Phase 67, Plan 67-03 (Wave 1) — REPRO-01 internal-state capture, primitive #1:
// D-03 git workspace state. Captures the exact SHA, a re-applyable BINARY dirty
// patch (staged+unstaged, binary-safe), the untracked-file list (the patch does
// NOT include untracked content), and per-submodule dirty state — everything Plan
// 04's snapshot assembler needs to restore the working tree byte-for-byte.
//
// SECURITY (T-67-03-03): every git call uses a FIXED argv array via spawnSync —
// never a shell string, never untrusted-flag interpolation. Copies the sole in-repo
// injection-safe idiom, lib/experiments/evidence-harness.mjs:153-166 (readDiffStat).
// Capture is BEST-EFFORT: each call is guarded (res.error / res.status / typeof
// stdout) and degrades to null / [] rather than throwing — a partially-broken repo
// must still yield a usable partial snapshot, never crash the assembler.
//
// PURE stdlib (child_process only), no km-core, no network. Diagnostics would go via
// process.stderr.write only (no console.* — no-console-log, CLAUDE.md); this module
// stays silent by design (fail-soft).
import { spawnSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024; // binary patches of large blobs can be big

/**
 * Guard a spawnSync git result: return trimmed (or raw) stdout, or null on any spawn
 * error / non-zero exit / non-string stdout. Shared post-processing only — the actual
 * `spawnSync('git', [...])` calls are inlined per-command below so each is a literal,
 * auditable, fixed-argv invocation (no shell string, no dynamic command).
 * @param {import('node:child_process').SpawnSyncReturns<string>} res
 * @param {boolean} trim
 * @returns {string|null}
 */
function guard(res, trim) {
  if (!res || res.error || res.status !== 0 || typeof res.stdout !== 'string') return null;
  return trim ? res.stdout.trim() : res.stdout;
}

/** Fixed spawnSync options for a git invocation rooted at `cwd`. */
function gitOpts(cwd) {
  return { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER };
}

/**
 * Parse `git submodule status` output into submodule paths. Each line looks like:
 *   " 1a2b3c… path/to/sub (heads/main)"  (leading char: ' ', '+', '-', 'U').
 * Best-effort — an unparseable line is skipped, never fatal.
 * @param {string|null} statusOut
 * @returns {string[]} submodule paths
 */
function parseSubmodulePaths(statusOut) {
  if (!statusOut) return [];
  const paths = [];
  for (const rawLine of statusOut.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Strip the leading status marker + SHA, then take the path token:
    // "<40hex> <path> (<ref>)" possibly with a leading +/-/U.
    const m = line.match(/^[+\-U ]?[0-9a-f]{40}\s+(\S+)/i);
    if (m) paths.push(m[1]);
  }
  return paths;
}

/**
 * Capture the full D-03 workspace state of the git repo at `repoRoot`, injection-safe.
 *
 * @param {string} repoRoot absolute path to the repository working tree
 * @returns {{
 *   sha: string|null,
 *   dirtyPatch: string|null,
 *   untracked: string[],
 *   submodules: { path: string, sha: string|null, dirtyPatch: string|null }[],
 * }}
 *   sha         = `git rev-parse HEAD` (40-hex) or null.
 *   dirtyPatch  = `git diff HEAD --binary` (re-applyable, staged+unstaged, binary-safe)
 *                 or null when clean/unavailable.
 *   untracked   = `git ls-files --others --exclude-standard` split to an array.
 *   submodules  = one entry per `git submodule status` path, each with its own SHA
 *                 and `git -C <path> diff --binary` dirty patch. Empty when none.
 */
export function captureGitState(repoRoot) {
  let sha = null;
  let dirtyPatch = null;
  let untracked = [];
  let submodules = [];

  try {
    // 1) Exact commit id.
    sha = guard(spawnSync('git', ['rev-parse', 'HEAD'], gitOpts(repoRoot)), true);

    // 2) Re-applyable binary dirty patch. --binary works across binary blobs; HEAD
    //    covers staged+unstaged in one patch. Preserve whitespace (patch body is
    //    significant); normalize empty → null.
    const rawPatch = guard(spawnSync('git', ['diff', 'HEAD', '--binary'], gitOpts(repoRoot)), false);
    dirtyPatch = rawPatch && rawPatch.length > 0 ? rawPatch : null;

    // 3) Untracked files (the patch does NOT include these).
    const untrackedOut = guard(
      spawnSync('git', ['ls-files', '--others', '--exclude-standard'], gitOpts(repoRoot)),
      true,
    );
    untracked = untrackedOut
      ? untrackedOut.split('\n').map((s) => s.trim()).filter(Boolean)
      : [];

    // 4) Per-submodule dirty state.
    const submodulePaths = parseSubmodulePaths(
      guard(spawnSync('git', ['submodule', 'status'], gitOpts(repoRoot)), true),
    );
    submodules = submodulePaths.map((subPath) => {
      // `git -C <path> …` runs as if from inside the submodule work-tree — still a
      // fixed argv array (no shell string).
      const subSha = guard(
        spawnSync('git', ['-C', subPath, 'rev-parse', 'HEAD'], gitOpts(repoRoot)),
        true,
      );
      const subRawPatch = guard(
        spawnSync('git', ['-C', subPath, 'diff', '--binary'], gitOpts(repoRoot)),
        false,
      );
      const subDirtyPatch = subRawPatch && subRawPatch.length > 0 ? subRawPatch : null;
      return { path: subPath, sha: subSha, dirtyPatch: subDirtyPatch };
    });
  } catch {
    // Best-effort: return whatever was captured before the throw (fail-soft, D-03).
  }

  return { sha, dirtyPatch, untracked, submodules };
}
