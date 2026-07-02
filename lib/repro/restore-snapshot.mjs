// lib/repro/restore-snapshot.mjs
//
// Phase 67, Plan 67-05 (Wave 3) — REPRO-01 / SC-2: restore a RunSnapshot.
//
// DEFAULT PATH (D-04, safe to run casually): reconstruct the captured state into an
// ISOLATED git worktree + a sandbox `LLM_PROXY_DATA_DIR` and NEVER touch the live checkout
// or the live `.data/knowledge-graph/`. Ordered per RESEARCH §"Restore Safety Mechanics"
// (code → data → config, so a mid-restore failure leaves the sandbox obviously incomplete,
// never half-live):
//   1. `git worktree add <sandbox-worktree> <captured-sha>`   (worktree at the exact SHA)
//   2. `git -C <worktree> submodule update --init --recursive` (worktree does NOT auto-
//      populate submodules — the 5-submodule caveat, RESEARCH Assumption A2), then per-
//      submodule patch apply + SHA reset from submodules.json
//   3. `git -C <worktree> apply --binary dirty.patch`          (staged+unstaged, binary-safe)
//   4. restore untracked/ files by copy                        (the patch omits untracked)
//   5. hydrateSandbox(<snap>/kb/exports/general.json, <sandbox>/.data)  (compaction-
//      independent, ontologyDir-safe — NEVER opens a store on the live KB; Pitfall 5)
//   6. write env/config into the sandbox + arm replay (LLM_PROXY_DATA_DIR=<sandbox>/.data)
//
// `--in-place` PATH (D-05, rare + destructive): FIRST take an automatic backup of the live
// state via captureSnapshot('_backup-<ts>', …), THEN require `opts.confirm === true`. If
// confirm is falsy the call THROWS/ABORTS *before writing any live path* (the auto-backup is
// the only write, and it targets `.data/run-snapshots/`, not live code/KB). Only a strict-
// true confirm proceeds to overwrite the live checkout + hydrate the live KB.
//
// SECURITY:
//   • T-67-05-03: every git call is a FIXED-ARGV spawnSync (no shell string, no interpolated
//     flag) — mirrors lib/repro/git-state.mjs.
//   • T-67-05-01/02: default path writes ONLY the sandbox worktree + sandbox data dir; the
//     destructive in-place path is backup+confirm gated (abort-before-write when unconfirmed).
//   • T-67-05-04: KB restored via hydrateSandbox into the SANDBOX dir; the live single-owner
//     DB is never contested.
//   • T-67-04-01: sanitizeTaskId (reused) on every snapshot-path construction.
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { sanitizeTaskId, captureSnapshot } from './capture-snapshot.mjs';
import { hydrateSandbox } from './kb-capture.mjs';

const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024; // binary patches of large blobs can be big

/** Fixed spawnSync options for a git invocation. `input` (optional) feeds stdin (patch apply). */
function gitOpts(cwd, input) {
  const opts = { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER };
  if (typeof input === 'string') opts.input = input;
  return opts;
}

/**
 * Run a fixed-argv git command. Returns `{ ok, stdout, stderr }`; `ok` is true only on a
 * clean (status 0, no spawn error) exit. NEVER a shell string — every arg is a literal
 * array element (T-67-05-03).
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [input] stdin (used for `git apply` patch bodies)
 */
function git(args, cwd, input) {
  const res = spawnSync('git', args, gitOpts(cwd, input));
  const ok = !!res && !res.error && res.status === 0;
  return { ok, stdout: typeof res?.stdout === 'string' ? res.stdout : '', stderr: typeof res?.stderr === 'string' ? res.stderr : '' };
}

/** Best-effort read of a snapshot text artifact (trimmed). Returns '' when absent. */
function readTextIfExists(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

/** Best-effort parse of a snapshot JSON artifact. Returns `fallback` on any failure. */
function readJsonIfExists(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Reconstruct the git working tree of a snapshot INTO `worktree` (already `git worktree add`ed
 * at the captured SHA). Submodules → per-submodule patches + SHA reset → dirty patch →
 * untracked. Each step is best-effort with stderr logging; returns a per-step status map so a
 * partial failure is visible in the return value (never silently "done").
 */
function reconstructWorkingTree(snapDir, repoRoot, worktree) {
  const steps = { submodules: false, dirtyPatch: false, untracked: false };

  // 2) Submodules — a worktree does NOT auto-populate them (A2). Init+update, then reset each
  //    to its captured SHA and apply its captured dirty patch.
  try {
    const sub = git(['-C', worktree, 'submodule', 'update', '--init', '--recursive'], worktree);
    const submodules = readJsonIfExists(path.join(snapDir, 'submodules.json'), []);
    let allSubOk = sub.ok;
    for (const entry of Array.isArray(submodules) ? submodules : []) {
      if (!entry || typeof entry.path !== 'string') continue;
      const subDir = path.join(worktree, entry.path);
      if (entry.sha) {
        const co = git(['-C', subDir, 'checkout', '--quiet', entry.sha], subDir);
        if (!co.ok) {
          allSubOk = false;
          process.stderr.write(`[restore-snapshot] submodule ${entry.path} checkout ${entry.sha} failed: ${co.stderr.trim()}\n`);
        }
      }
      if (entry.dirtyPatch && entry.dirtyPatch.length > 0) {
        const ap = git(['-C', subDir, 'apply', '--binary'], subDir, entry.dirtyPatch);
        if (!ap.ok) {
          allSubOk = false;
          process.stderr.write(`[restore-snapshot] submodule ${entry.path} patch apply failed: ${ap.stderr.trim()}\n`);
        }
      }
    }
    steps.submodules = allSubOk;
  } catch (err) {
    process.stderr.write(`[restore-snapshot] submodule reconstruction failed: ${err?.message || err}\n`);
  }

  // 3) Tracked dirty patch (staged+unstaged, binary-safe). Empty patch → nothing to apply (ok).
  try {
    const patch = readTextIfExists(path.join(snapDir, 'dirty.patch'));
    if (patch && patch.trim().length > 0) {
      const ap = git(['-C', worktree, 'apply', '--binary'], worktree, patch);
      steps.dirtyPatch = ap.ok;
      if (!ap.ok) process.stderr.write(`[restore-snapshot] dirty.patch apply failed: ${ap.stderr.trim()}\n`);
    } else {
      steps.dirtyPatch = true; // clean snapshot — nothing to apply
    }
  } catch (err) {
    process.stderr.write(`[restore-snapshot] dirty.patch apply threw: ${err?.message || err}\n`);
  }

  // 4) Untracked files (the patch omits their content — copy each from untracked/<rel>).
  try {
    const untrackedDir = path.join(snapDir, 'untracked');
    const listFile = path.join(untrackedDir, 'list.txt');
    const rels = readTextIfExists(listFile)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    let allCopied = true;
    for (const rel of rels) {
      // Guard against a `../escape` path in the snapshot list (defense-in-depth).
      const dst = path.resolve(worktree, rel);
      if (!dst.startsWith(path.resolve(worktree) + path.sep)) {
        allCopied = false;
        process.stderr.write(`[restore-snapshot] untracked path escapes worktree, skipped: ${rel}\n`);
        continue;
      }
      try {
        const src = path.join(untrackedDir, rel);
        if (!fs.existsSync(src)) continue;
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      } catch (err) {
        allCopied = false;
        process.stderr.write(`[restore-snapshot] untracked copy ${rel} failed: ${err?.message || err}\n`);
      }
    }
    steps.untracked = allCopied;
  } catch (err) {
    process.stderr.write(`[restore-snapshot] untracked restore failed: ${err?.message || err}\n`);
  }

  return steps;
}

/**
 * Restore the RunSnapshot `snapshotId` into an isolated sandbox (default, D-04) or — gated by
 * an auto-backup + explicit confirm — over the live checkout (`inPlace`, D-05).
 *
 * @param {string} snapshotId run/task identifier (sanitized to the snapshot dir name)
 * @param {object} [opts]
 * @param {boolean} [opts.inPlace=false] overwrite the LIVE checkout + KB (D-05, destructive)
 * @param {boolean} [opts.confirm=false] MUST be strictly `true` to proceed with `inPlace`
 * @param {string}  [opts.repoRoot] repo working-tree root (default: cwd)
 * @param {string}  [opts.dataDir] live LLM_PROXY_DATA_DIR (default: `<repoRoot>/.data`)
 * @param {string}  [opts.restoreRoot] where sandbox worktrees live (default: `<repoRoot>/.data/run-restores`)
 * @param {string}  [opts.ontologyDir] ontology dir for the sandbox KB hydrate (kb-capture default applies)
 * @returns {Promise<{ worktree: string, sandboxDataDir: string, replayArmed: boolean, inPlace: boolean, steps: object }>}
 */
export async function restoreSnapshot(snapshotId, opts = {}) {
  const inPlace = opts.inPlace === true;
  const repoRoot = opts.repoRoot || process.cwd();
  const dataDir = opts.dataDir || path.join(repoRoot, '.data');
  const cleanId = sanitizeTaskId(snapshotId);
  const snapDir = path.join(repoRoot, '.data', 'run-snapshots', cleanId);

  // Snapshot must exist before we do anything (clear error, not an obscure ENOENT stack).
  if (!fs.existsSync(snapDir) || !fs.statSync(snapDir).isDirectory()) {
    throw new Error(`restore aborted: snapshot not found at ${snapDir}`);
  }

  // ── --in-place (D-05): auto-backup FIRST, then confirm gate, then (only if confirmed) write live ──
  if (inPlace) {
    // 1) Automatic backup of the CURRENT live state BEFORE any destructive write. This is the
    //    only write performed when unconfirmed, and it targets `.data/run-snapshots/`, not live.
    const backupId = `_backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    let backupDir = null;
    try {
      const backup = captureSnapshot(backupId, { repoRoot, dataDir });
      backupDir = backup.dir;
    } catch (err) {
      process.stderr.write(`[restore-snapshot] in-place auto-backup failed: ${err?.message || err}\n`);
      throw new Error(`restore aborted: could not take the mandatory pre-overwrite backup (${err?.message || err})`);
    }

    // 2) Confirm gate — MUST be strictly true. Abort BEFORE writing any live path.
    if (opts.confirm !== true) {
      throw new Error(
        `in-place restore aborted: explicit confirmation required (opts.confirm must be === true). ` +
        `No live path was written. A backup of the current live state was saved at ${backupDir}.`,
      );
    }

    // 3) Confirmed — overwrite the live checkout + hydrate the live KB in place.
    const steps = reconstructWorkingTree(snapDir, repoRoot, repoRoot);
    let kbHydrated = false;
    try {
      const exportPath = path.join(snapDir, 'kb', 'exports', 'general.json');
      if (fs.existsSync(exportPath)) {
        await hydrateSandbox(exportPath, dataDir, opts.ontologyDir ? { ontologyDir: opts.ontologyDir } : {});
        kbHydrated = true;
      }
    } catch (err) {
      process.stderr.write(`[restore-snapshot] in-place KB hydrate failed: ${err?.message || err}\n`);
    }
    return {
      worktree: repoRoot,
      sandboxDataDir: dataDir,
      replayArmed: fs.existsSync(path.join(snapDir, 'fixtures', 'llm')),
      inPlace: true,
      backupDir,
      steps: { ...steps, kb: kbHydrated },
    };
  }

  // ── Default (D-04): isolated sandbox worktree + sandbox LLM_PROXY_DATA_DIR ──
  const restoreRoot = opts.restoreRoot || path.join(repoRoot, '.data', 'run-restores');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const worktree = path.join(restoreRoot, `${cleanId}-${stamp}`);
  const sandboxDataDir = path.join(worktree, '.data');
  fs.mkdirSync(restoreRoot, { recursive: true });

  // 1) Worktree at the captured SHA — the ONE fatal step (no SHA → nothing to restore onto).
  const sha = readTextIfExists(path.join(snapDir, 'git-sha.txt')).trim();
  if (!sha) {
    throw new Error(`restore aborted: snapshot ${cleanId} has no captured git SHA (git-sha.txt missing/empty)`);
  }
  const wt = git(['worktree', 'add', '--detach', worktree, sha], repoRoot);
  if (!wt.ok) {
    throw new Error(`restore aborted: 'git worktree add ${worktree} ${sha}' failed: ${wt.stderr.trim()}`);
  }

  // 2-4) Submodules → dirty patch → untracked (best-effort, per-step status).
  const steps = reconstructWorkingTree(snapDir, repoRoot, worktree);

  // 5) KB → SANDBOX dir ONLY (hydrateSandbox opens the store under sandboxDataDir, never live).
  //    Best-effort: km-core may be absent (kb-capture lazy-imports it) — a hydrate failure
  //    leaves the sandbox obviously incomplete rather than crashing the whole restore.
  let kbHydrated = false;
  try {
    const exportPath = path.join(snapDir, 'kb', 'exports', 'general.json');
    if (fs.existsSync(exportPath)) {
      await hydrateSandbox(exportPath, sandboxDataDir, opts.ontologyDir ? { ontologyDir: opts.ontologyDir } : {});
      kbHydrated = true;
    } else {
      process.stderr.write(`[restore-snapshot] no KB export at ${exportPath}; sandbox KB left empty\n`);
    }
  } catch (err) {
    process.stderr.write(`[restore-snapshot] sandbox KB hydrate failed: ${err?.message || err}\n`);
  }

  // 6) Env/config into the sandbox + arm replay (LLM_PROXY_DATA_DIR=<sandbox>/.data).
  let configWritten = false;
  try {
    fs.mkdirSync(sandboxDataDir, { recursive: true });
    for (const name of ['env-allowlist.json', 'llm-settings.json']) {
      const src = path.join(snapDir, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(sandboxDataDir, name));
    }
    // Record/replay fixtures convention (Plan 06): <snap>/fixtures, replay reads <dir>/llm/.
    const fixturesDir = path.join(snapDir, 'fixtures');
    const replayArmed = fs.existsSync(path.join(fixturesDir, 'llm'));
    // Arm the sandbox: the replay run points LLM_PROXY_DATA_DIR at the sandbox and reads
    // fixtures from the snapshot. Written as a sidecar the operator/CLI can `source`/read.
    fs.writeFileSync(
      path.join(sandboxDataDir, 'repro-replay.json'),
      JSON.stringify(
        {
          snapshot_id: cleanId,
          LLM_PROXY_DATA_DIR: sandboxDataDir,
          replay_from: replayArmed ? path.join(fixturesDir, 'llm') : null,
          replay_armed: replayArmed,
        },
        null,
        2,
      ),
    );
    configWritten = true;

    return {
      worktree,
      sandboxDataDir,
      replayArmed,
      inPlace: false,
      steps: { worktree: true, ...steps, kb: kbHydrated, config: configWritten },
    };
  } catch (err) {
    process.stderr.write(`[restore-snapshot] env/config arm failed: ${err?.message || err}\n`);
    return {
      worktree,
      sandboxDataDir,
      replayArmed: false,
      inPlace: false,
      steps: { worktree: true, ...steps, kb: kbHydrated, config: configWritten },
    };
  }
}
