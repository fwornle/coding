// lib/experiments/experiment-runner.mjs
//
// Phase 78, Plan 78-03 (Wave 2) — RUN-02 / RUN-03 / RUN-04: the net-new orchestration
// engine. This is the sequential, idempotent, resumable matrix loop that WIRES the
// already-shipped parts into "one scored Run per variant×repeat cell." It builds nothing
// that Waves 0/1 already ship — it drives them:
//
//   restoreForCell (77-03)      → isolated sandbox worktree + sandbox .data per cell (D-02)
//   measurement-start/stop CLIs → open a measured span, then inline-score in a finally (D-11)
//   argvForAgent/resolveAgentBinary/probeCopilotHeadless (78-02) → per-agent headless launch
//   readRuns (74-02)            → the resume ledger (done-set filtered on terminal_state)
//   openExperimentStore (71)   → the single-owner repo-global Run store (forces sequential)
//
//   launchCell(opts)  → 'complete' | 'timeout' | 'abort'   the terminal-state machine (D-04)
//   runCell(opts)     → { terminalState, ... }             one restored, measured, scored cell
//   runMatrix(spec, opts) → summary[]                       the full sequential idempotent loop
//
// DECISIONS realized here:
//   D-02: each agent is spawned with cwd = a THROWAWAY sandbox worktree and env
//         LLM_PROXY_DATA_DIR = that sandbox's .data, so an autonomous agent
//         (--permission-mode acceptEdits / --allow-all-tools) has ZERO blast radius on the
//         live checkout/KB (T-78-03-02).
//   D-04: the terminal-state machine is a CLOSED enum — complete | timeout | abort. Agent
//         exit(0)→complete; a wall-clock-timer SIGTERM→SIGKILL kill→timeout; any other
//         non-zero/killed exit→abort. All three are RECORDED (measurement-stop in a finally).
//   D-05: `test_command` runs at SCORE time only (inside measurement-stop's judge) — it is
//         NEVER the completion gate. The completion signal is purely the agent's exit code /
//         the wall-clock timer, never the test result.
//   D-06: the wall-clock timeout is 20 min by default and is OVERRIDABLE (timeoutMs).
//   D-08: a copilot cell whose once-per-matrix probe fails lands an EXPLICIT skip-Run
//         (skip_reason='copilot-headless-unsupported') — never silently absent (RUN-04).
//   D-09: cells execute STRICTLY sequentially (`await` each) — the experiment Run store is a
//         single-owner LevelDB, so two cells must never open it concurrently.
//   D-10: RESUME is idempotent — a cell whose composite task_id already has a Run with
//         terminal_state==='complete' is SKIPPED; timeout/abort/unscored cells are RE-RUN.
//   D-11: scoring is INLINE per cell (measurement-stop --headless), so exactly one scored
//         Run lands per attempted cell on EVERY terminal state.
//   D-12: an agent/spawn failure is recorded best-effort — the matrix does not throw/stall.
//
// RESEARCH open questions resolved:
//   Q1 (copilot gate): the copilot drivability probe runs STANDALONE once before the loop
//        and the boolean is CACHED. Copilot variants are authored under `env: default` so
//        they pass Phase-77 validateCells (the frozen copilot+headless gate is NOT mutated
//        at runtime); the cached probe alone decides run-vs-skip-Run for copilot cells.
//   Q3 (retry policy): the resume done-set skips ONLY cells whose composite task_id has a
//        Run with terminal_state==='complete'. A prior 'timeout'/'abort'/unscored Run does
//        NOT count as done — that cell is retried on resume.
//
// SECURITY:
//   • T-78-03-01 (command injection): agents AND the measurement-start/stop CLIs are shelled
//     as FIXED-ARGV arrays (never a shell string); the child_process `shell` option is never
//     set anywhere in this module. argvForAgent (78-02) supplies the agent argv.
//   • T-78-03-02 (sandbox escape): every launch asserts cwd=sandbox worktree +
//     env.LLM_PROXY_DATA_DIR=sandbox .data (restoreForCell inPlace:false) — never the repo root.
//   • T-78-03-03 (DoS): async spawn + a bounded SIGTERM→SIGKILL wall-clock timer; sequential
//     execution bounds concurrent damage to one cell.
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import path from 'node:path';
import process from 'node:process';
import { spawn as realSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { restoreForCell } from './experiment-restore.mjs';
import { argvForAgent, resolveAgentBinary, probeCopilotHeadless } from './agent-headless.mjs';
import { readRuns } from './query.mjs';
import { openExperimentStore } from './store.mjs';
import { resolveExperimentSpec } from './experiment-spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root two-up anchor (lib/experiments → repo root). Overridable via opts.repoRoot.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

// D-06: the default wall-clock cap per cell — 20 minutes, overridable via timeoutMs.
const DEFAULT_TIMEOUT_MS = 20 * 60_000;
// Grace between SIGTERM and the escalated SIGKILL (server-manager.js:162-167 template).
const DEFAULT_GRACE_MS = 5_000;

/** Derive the stable per-cell variant name (mirrors scripts/measurement-start.mjs cellName). */
export function cellName(cell) {
  return `${cell.agent}-${cell.model}-${cell.framework}-${cell.env}`;
}

/** Compose the per-cell task_id (Pitfall 1 — task_hash is constant across the matrix). */
export function composeTaskId(expId, cell, rep) {
  return `${expId}--${cellName(cell)}--r${rep}`;
}

/**
 * The terminal-state machine (D-04). Spawn `bin argv` ASYNCHRONOUSLY (never spawnSync — a
 * sync call would block the wall-clock timer, Pitfall 2) into the isolated sandbox
 * (cwd=worktree, env.LLM_PROXY_DATA_DIR=sandboxDataDir, D-02), arm a SIGTERM→SIGKILL
 * wall-clock timer, and resolve the closed terminal enum:
 *   • killed by the timer            → 'timeout'
 *   • natural exit code 0            → 'complete'
 *   • any other non-zero/killed exit → 'abort'
 * A spawn 'error' (ENOENT / EACCES) rejects — the caller records it best-effort (D-12).
 *
 * @param {object} opts
 * @param {string} opts.bin                 resolved agent launch binary.
 * @param {string[]} opts.argv              FIXED-ARGV array (never a shell string).
 * @param {string} opts.worktree            sandbox worktree → spawn cwd.
 * @param {string} opts.sandboxDataDir      sandbox .data → env.LLM_PROXY_DATA_DIR.
 * @param {number} [opts.timeoutMs=20min]   wall-clock cap (D-06 overridable).
 * @param {number} [opts.graceMs=5000]      SIGTERM→SIGKILL grace.
 * @param {string} [opts.stdio='inherit']   child stdio disposition.
 * @param {Function} [opts.spawn=realSpawn] injectable spawn seam (tests).
 * @returns {Promise<'complete'|'timeout'|'abort'>}
 */
export function launchCell({
  bin,
  argv,
  worktree,
  sandboxDataDir,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  graceMs = DEFAULT_GRACE_MS,
  stdio = 'inherit',
  spawn = realSpawn,
}) {
  return new Promise((resolve, reject) => {
    let killedByTimer = false;
    let graceTimer = null;

    // NEVER shell:true — fixed argv only (T-78-03-01). cwd + LLM_PROXY_DATA_DIR pin the
    // agent inside the throwaway sandbox (T-78-03-02).
    const child = spawn(bin, argv, {
      cwd: worktree,
      env: { ...process.env, LLM_PROXY_DATA_DIR: sandboxDataDir },
      stdio,
    });

    const timer = setTimeout(() => {
      killedByTimer = true;
      process.stderr.write(
        `[experiment-runner] wall-clock timeout (${timeoutMs}ms) — SIGTERM → SIGKILL in ${graceMs}ms\n`,
      );
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      graceTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, graceMs);
    }, timeoutMs);

    const clearTimers = () => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
    };

    child.on('error', (err) => {
      clearTimers();
      reject(err); // spawn failure — recorded best-effort by the caller (D-12)
    });

    child.on('exit', (code) => {
      clearTimers();
      // D-04 closed enum: timer kill → timeout; clean exit → complete; else → abort.
      resolve(killedByTimer ? 'timeout' : (code === 0 ? 'complete' : 'abort'));
    });
  });
}

// Task 2 (per-cell wiring) and Task 3 (matrix loop) implement these; the placeholders keep
// the module's export surface stable so the test file links before those tasks land.
export async function runCell() {
  throw new Error('runCell: not implemented yet (Task 2)');
}
export async function runMatrix() {
  throw new Error('runMatrix: not implemented yet (Task 3)');
}
