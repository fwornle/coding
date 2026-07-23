// lib/experiments/experiment-runner.mjs
//
// Phase 78, Plan 78-03 (Wave 2) — RUN-02 / RUN-03 / RUN-04: the net-new orchestration
// engine. This is the sequential, idempotent, resumable matrix loop that WIRES the
// already-shipped parts into "one scored Run per variant×repeat cell." It builds nothing
// that Waves 0/1 already ship — it drives them:
//
//   restoreForCell (77-03)      → isolated sandbox worktree + sandbox .data per cell (D-02)
//   measurement-start/stop CLIs → open a measured span, then inline-score in a finally (D-11)
//   argvForAgent/resolveAgentBinary (78-02) → per-agent headless launch
//   preflightAgent (88-02)      → per-cell bounded /api/complete pre-flight gate (run-or-clean-skip)
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
import { spawn as realSpawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { restoreForCell, neutralizeSandboxRules } from './experiment-restore.mjs';
// Phase 87-03 (AVN-05 / D-04): the avenue branch lifecycle. An avenue cell restores onto its
// NAMED `avenue/<task_id>` branch and, at cell close, commits the worktree diff onto that branch
// so the branch HOLDS the avenue's real code. sanitizeTaskId derives the ref safely (T-87-03-01).
import { commitAvenueWorktree } from './avenue-branch.mjs';
import { sanitizeTaskId } from '../repro/capture-snapshot.mjs';
import { argvForAgent, resolveAgentBinary, preflightAgent } from './agent-headless.mjs';
// Phase 88-01 (ALIGN-01): the SINGLE source of truth for per-agent launch-model resolution +
// the canonical proxy-routing env map. configureProxyRoutingEnv delegates its per-agent switch to
// buildAgentRoutingEnv; runCell resolves the launch model once via resolveCellModel.
import { resolveCellModel, buildAgentRoutingEnv } from './agent-routing.mjs';
import { readRuns } from './query.mjs';
import { openExperimentStore } from './store.mjs';
import { resolveExperimentSpec } from './experiment-spec.mjs';
import { probeHttpHealth } from '../utils/service-probe.js';
import { writeProgress } from './run-progress.mjs';

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

/**
 * Compose the per-cell task_id (Pitfall 1 — task_hash is constant across the matrix).
 *
 * The task_id is used downstream as a FILESYSTEM key (measurement archive paths,
 * snapshot dirs), so it MUST be path-safe. opencode models are always `provider/model`
 * (e.g. `rapid-proxy/claude-haiku-4-5`); the raw `/` otherwise became a path separator
 * and truncated the persisted key, breaking D-10 idempotent resume. Slugify path
 * separators here — the `variant` tag (cellName) stays human-readable with the slash.
 */
export function composeTaskId(expId, cell, rep) {
  const slug = cellName(cell).replace(/[/\\]+/g, '-');
  return `${expId}--${slug}--r${rep}`;
}

/**
 * Emit a progress patch to <runDir>/progress.json (D-03). A NO-OP when `runDir` is falsy —
 * this short-circuit is what keeps every EXISTING runMatrix caller (manual CLI runs, the
 * fake-seam integration test) byte-identical: no runDir ⇒ zero progress writes. writeProgress
 * is itself atomic + never-throw, but wrap it defensively so a progress emit can NEVER abort a
 * cell (Pattern 5 — the emitter is best-effort; the run is the source of truth).
 */
async function emitProgress(runDir, patch) {
  if (!runDir) return; // no-op guard — existing callers pass no runDir (zero behavior change)
  try {
    await writeProgress(runDir, patch);
  } catch (err) {
    process.stderr.write(`[experiment-runner] progress emit failed (non-fatal): ${err.message}\n`);
  }
}

/**
 * Derive the recorded variant name for a cell under a per-variant override (D-07). Deterministic,
 * `@`-joined, STABLE agent-then-model ordering so the same override always yields the same name:
 *   • no/empty override               → cellName(cell) unchanged
 *   • model overridden                → `<orig>@<model>`
 *   • agent overridden                → `<orig>@<agent>`
 *   • both                            → `<orig>@<agent>@<model>`
 * The suffix uses the OVERRIDE value (the changed dimension), never the cell's original value.
 * @param {object} cell     the ORIGINAL resolved cell (its cellName is the base).
 * @param {?object} override { model?, agent? } — the override for this variant (may be null/empty).
 * @returns {string} the derived variant name.
 */
export function deriveVariantName(cell, override) {
  const base = cellName(cell);
  if (!override) return base;
  const parts = [];
  if (override.agent) parts.push(override.agent); // agent FIRST (stable ordering)
  if (override.model) parts.push(override.model);
  return parts.length ? `${base}@${parts.join('@')}` : base;
}

/**
 * Apply a per-variant override map (keyed by ORIGINAL cellName) to a cell (D-06/D-07).
 * Returns `{ effectiveCell, derivedVariant, baseVariant }`:
 *   • matched override → effectiveCell = { ...cell, model/agent mutated }, derivedVariant =
 *     the suffixed name, baseVariant = the ORIGINAL cellName.
 *   • no match (or empty/undefined map) → effectiveCell === cell (same fields), derivedVariant =
 *     the original name, baseVariant = null (no --base-variant emitted — byte-identical behavior).
 * CRITICAL: this mutates only the EFFECTIVE launch cell (model/agent) + the recorded NAME — it
 * NEVER touches composeTaskId's inputs, so task_hash stays constant for comparability (D-05).
 * @param {object} cell
 * @param {?object} variantOverrides map { [originalVariantName]: { model?, agent? } }.
 * @returns {{ effectiveCell: object, derivedVariant: string, baseVariant: string|null }}
 */
export function applyVariantOverride(cell, variantOverrides) {
  const original = cellName(cell);
  const ov = variantOverrides ? variantOverrides[original] : null;
  if (!ov || (!ov.model && !ov.agent)) {
    return { effectiveCell: cell, derivedVariant: original, baseVariant: null };
  }
  const effectiveCell = {
    ...cell,
    model: ov.model ?? cell.model,
    agent: ov.agent ?? cell.agent,
  };
  return {
    effectiveCell,
    derivedVariant: deriveVariantName(cell, ov),
    baseVariant: original, // the ORIGINAL variant name (D-07)
  };
}

/**
 * Build the agent-launch env that routes an agent's LLM calls THROUGH the shared host
 * rapid-llm-proxy so the proxy stamps `token_usage.task_id` from the open measurement span
 * (the JS mirror of `configure_proxy_routing()` in scripts/launch-agent-common.sh:387-441).
 *
 * WHY this exists (the token-attribution bug it fixes): the proxy resolves a captured call's
 * task_id by reading `active-measurement.json` from ITS OWN LLM_PROXY_DATA_DIR (the MAIN .data).
 * An OPENCODE launch WITHOUT ANTHROPIC_BASE_URL talks direct to Anthropic and is never seen by
 * the proxy → its tokens land with an EMPTY task_id → the cell's outcome sums to 0 tokens and
 * quarantines empty. Routing opencode through the proxy is what makes its cell measurable.
 *
 * Capture model (Phase 82/83; see [[reference_uniform_token_capture_agents]] / STOP_ADAPTERS):
 * ALL agents route through the proxy here — claude via ANTHROPIC_BASE_URL + x-task-id header,
 * opencode via ANTHROPIC_BASE_URL + OPENCODE_CONFIG_CONTENT provider splice (Phase 84: x-task-id/
 * x-agent headers on the anthropic wire + task-scoped /v1/opencode/t/<taskId> path on the openai
 * wire), mastra via ANTHROPIC_BASE_URL, copilot via the BYOK /v1/copilot/t/<taskId> base-URL
 * seam — so wire rows are the PRIMARY token source for every cell. The cladpt/copadt transcript
 * adapters no longer capture here; at span close they run in RECONCILE mode (verify wire rows +
 * fill gaps: reasoning_tokens, cache split when wire=0), never double-inserting. Only
 * CODING_PROXY_ROUTE ∈ {0,false,no,off} or a down proxy leaves a cell unrouted (unmeasured).
 *
 * Contract:
 *   • CODING_PROXY_ROUTE ∈ {0,false,no,off} → return baseEnv unchanged (opt-out, unmeasured).
 *   • proxy unreachable at http://127.0.0.1:<port>/health → stderr warn + baseEnv unchanged
 *     (fail-soft: a down proxy NEVER blocks a run; the cell just runs unrouted).
 *   • opencode  → set ANTHROPIC_BASE_URL + KEEP the key, and (Phase 84, when taskId given) splice
 *                 OPENCODE_CONFIG_CONTENT provider options to bind BOTH wires per-request: anthropic
 *                 provider → /v1 + x-task-id/x-agent headers [seam A]; openai/copilot providers →
 *                 task-scoped path /v1/opencode/t/<taskId> [seam B]. Kills the ambient-span capture leak.
 *   • claude    → set ANTHROPIC_BASE_URL + ANTHROPIC_CUSTOM_HEADERS 'x-task-id: <taskId>' (Phase 82
 *                 re-route; the tap now keeps cache accounting (Plan 02) + merges the cladpt row
 *                 (Plan 04), so routing claude cells is safe — the header binds them per-request).
 *   • copilot   → BYOK env (COPILOT_PROVIDER_BASE_URL=/v1/copilot/t/<taskId>, type openai, placeholder
 *                 key, COPILOT_MODEL) — its task-scoped base-URL path is the only per-request binding seam.
 *   • mastracode → NO change; self-routed with no launcher base-URL seam → ambient-bound this phase.
 * Returns a COPY of baseEnv; NEVER mutates LLM_PROXY_DATA_DIR (the caller owns sandbox isolation).
 *
 * @param {string} agent                       cell.agent ('claude'|'opencode'|'copilot'|'mastracode').
 * @param {object} baseEnv                      the agent's base env (already carries sandbox LLM_PROXY_DATA_DIR).
 * @param {object} [opts]
 * @param {number} [opts.port]                  proxy port (default LLM_PROXY_PORT ?? 12435).
 * @param {Function} [opts.probe=probeHttpHealth] injectable health probe (tests).
 * @param {string} [opts.route]                 CODING_PROXY_ROUTE override (tests).
 * @param {string} [opts.taskId]               the cell's composite task_id → x-task-id header / copilot path.
 * @param {string} [opts.model]                the cell model → COPILOT_MODEL for the BYOK seam.
 * @returns {Promise<object>} a new env object.
 */
export async function configureProxyRoutingEnv(agent, baseEnv, {
  port = Number(process.env.LLM_PROXY_PORT) || 12435,
  probe = probeHttpHealth,
  route = process.env.CODING_PROXY_ROUTE,
  taskId,
  model,
} = {}) {
  const env = { ...baseEnv };

  // Opt-out safety valve (mirrors the bash launcher) — launch direct, unmeasured.
  if (['0', 'false', 'no', 'off'].includes(String(route ?? '').toLowerCase())) {
    process.stderr.write(`[experiment-runner] CODING_PROXY_ROUTE=${route} — proxy routing disabled for ${agent} (unmeasured)\n`);
    return env;
  }

  const base = `http://127.0.0.1:${port}`;
  // Health gate: proxy down → launch unrouted (never blocked). service-probe is fail-soft.
  const health = await probe(`${base}/health`, 2000);
  if (health.status !== 'running') {
    process.stderr.write(`[experiment-runner] LLM proxy unreachable at ${base} (${health.error || health.status}) — ${agent} launched unrouted\n`);
    return env;
  }

  // Phase 88-01 (ALIGN-01): the per-agent env map is the SINGLE definition in agent-routing.mjs
  //   (buildAgentRoutingEnv) — the former inline switch (opencode both-wire splice, claude
  //   x-task-id header, copilot BYOK) moved there VERBATIM so the cell path + the shell launcher
  //   share one source of truth. This function keeps ONLY the opt-out + /health gating above;
  //   the routed case delegates. The caller passes the ALREADY-RESOLVED model (runCell resolves it
  //   once via resolveCellModel), so buildAgentRoutingEnv does not resolve it.
  return buildAgentRoutingEnv(agent, env, { taskId, model, port });
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
 * RESOLUTION SHAPE (85-06 A1): resolves an OBJECT `{ state, code, signal, reason? }` — NOT a
 * bare string — so the caller can persist WHY a cell aborted (`agent exited with code N` /
 * `killed by SIGKILL`). The bare-string callers of prior phases are preserved by the
 * `terminalStateOf()` helper + backward-compatible destructuring in runCell.
 *
 * @param {object} opts
 * @param {string} opts.bin                 resolved agent launch binary.
 * @param {string[]} opts.argv              FIXED-ARGV array (never a shell string).
 * @param {string} opts.worktree            sandbox worktree → spawn cwd.
 * @param {string} opts.sandboxDataDir      sandbox .data → env.LLM_PROXY_DATA_DIR.
 * @param {number} [opts.timeoutMs=20min]   wall-clock cap (D-06 overridable).
 * @param {number} [opts.graceMs=5000]      SIGTERM→SIGKILL grace.
 * @param {string} [opts.stdio='inherit']   child stdio disposition.
 * @param {object} [opts.env]                pre-built agent env (proxy routing + sandbox
 *                                           LLM_PROXY_DATA_DIR). Falls back to a bare sandbox
 *                                           env when omitted (preserves the pre-routing contract).
 * @param {Function} [opts.spawn=realSpawn] injectable spawn seam (tests).
 * @returns {Promise<{ state: 'complete'|'timeout'|'abort', code: number|null, signal: string|null, reason?: string }>}
 */
export function launchCell({
  bin,
  argv,
  worktree,
  sandboxDataDir,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  graceMs = DEFAULT_GRACE_MS,
  stdio = 'inherit',
  env,
  spawn = realSpawn,
}) {
  return new Promise((resolve, reject) => {
    let killedByTimer = false;
    let graceTimer = null;

    // NEVER shell:true — fixed argv only (T-78-03-01). cwd + LLM_PROXY_DATA_DIR pin the
    // agent inside the throwaway sandbox (T-78-03-02). `env` (built by runCell via
    // configureProxyRoutingEnv) additionally routes claude/opencode through the proxy so
    // their tokens attribute to the open span; the fallback preserves the sandbox-only env.
    const child = spawn(bin, argv, {
      cwd: worktree,
      env: env || { ...process.env, LLM_PROXY_DATA_DIR: sandboxDataDir },
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

    child.on('exit', (code, signal) => {
      clearTimers();
      // D-04 closed enum: timer kill → timeout; clean exit → complete; else → abort.
      const state = killedByTimer ? 'timeout' : (code === 0 ? 'complete' : 'abort');
      // A1: attach a human-readable reason for the non-complete states so the monitor can
      // display WHY (a bare "abort" badge is undiagnosable). Complete carries no reason.
      let reason;
      if (state === 'timeout') {
        reason = `wall-clock timeout (${timeoutMs}ms) — killed by ${signal || 'SIGKILL'}`;
      } else if (state === 'abort') {
        reason = signal
          ? `agent killed by ${signal}`
          : `agent exited with code ${code}`;
      }
      resolve({ state, code: code ?? null, signal: signal ?? null, ...(reason ? { reason } : {}) });
    });
  });
}

/**
 * Normalize a spawnAgent result to `{ state, reason? }` (85-06 A1). launchCell now resolves an
 * object, but the injectable `spawnAgent` seam (fakes, prior-phase callers, tests) may still
 * resolve a bare terminal-state STRING. Accept both so no existing caller breaks: a string
 * becomes `{ state }`; an object passes through (defaulting an absent state to 'abort').
 * @param {string|{state?:string, reason?:string}} result
 * @returns {{ state: string, reason?: string }}
 */
export function normalizeCellResult(result) {
  if (typeof result === 'string') return { state: result };
  if (result && typeof result === 'object') {
    return { state: result.state ?? 'abort', ...(result.reason ? { reason: result.reason } : {}) };
  }
  // Defensive: a nullish/odd result is an abort with an explanatory reason.
  return { state: 'abort', reason: 'agent produced no terminal result' };
}

/**
 * Default measurement-CLI seam: shell scripts/measurement-{start,stop}.mjs as a FIXED-ARGV
 * child process (never a shell string — T-78-03-01) under the sandbox env. Resolves with the
 * child exit code; a non-zero exit is a WARNING (stderr) not a throw, so a stop failure in
 * runCell's finally can never mask the cell's real terminal state (best-effort, D-12).
 * @param {'start'|'stop'} phase
 * @param {string[]} argv fixed argv (no shell metacharacters interpreted).
 * @param {{ env?: object, cwd?: string, spawn?: Function }} [opts]
 * @returns {Promise<number>}
 */
export function runMeasurementCli(phase, argv, { env, cwd, spawn = realSpawn } = {}) {
  const script = phase === 'start' ? 'measurement-start.mjs' : 'measurement-stop.mjs';
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, script), ...argv], {
      cwd: cwd || REPO_ROOT,
      env: env || process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        process.stderr.write(`[experiment-runner] measurement-${phase} exited ${code} (non-fatal)\n`);
      }
      resolve(code ?? 0);
    });
  });
}

/**
 * Run ONE variant×repeat cell end-to-end (D-11 inline scoring):
 *   (1) restore an ISOLATED sandbox (restoreForCell inPlace:false → worktree + sandbox .data);
 *   (2) open a MEASURED span via measurement-start (composite --task-id, --variant, --repeat,
 *       cell --agent/--model/--framework/--test-command, --goal) under env
 *       LLM_PROXY_DATA_DIR=sandbox .data;
 *   (3) resolve + launch the agent under the terminal-state timer (launchCell);
 *   (4) in a `finally`, close + INLINE-SCORE the span via measurement-stop --headless
 *       --terminal-state <state> (same sandbox env) so exactly one scored Run lands on EVERY
 *       terminal state — no cell is ever silently dropped (D-04 / Pitfall 4).
 *
 * NOTE (D-05): `test_command` is threaded to measurement-start for the span, but it runs at
 * SCORE time only (inside measurement-stop's judge) — it is NEVER the completion gate. The
 * completion signal is purely the agent exit code / the wall-clock timer (launchCell).
 *
 * All side-effecting collaborators are injectable seams (restore / spawnAgent / runMeasurement)
 * so this is unit-testable without a real git worktree, agent, or span.
 *
 * @param {object} params
 * @param {object} params.cell        resolved cell { agent, model, framework, env, test_command? }.
 * @param {number} params.rep         0-based repeat index (→ --repeat, composite task_id).
 * @param {string} params.expId       stable experiment id (composite task_id prefix).
 * @param {string} params.goal        the spec goal_sentence (agent prompt + --goal).
 * @param {string} params.snapshotId  declare-time baseline snapshot to restore from (D-09).
 * @param {string} [params.taskClass] optional closed-6 task_class for scoring (--task-class).
 * @param {number} [params.timeoutMs] wall-clock cap (D-06 overridable).
 * @param {string} [params.agentsDir] config/agents dir for resolveAgentBinary.
 * @param {string} [params.repoRoot]  repo root (restore).
 * @param {string} [params.dataDir]   live LLM_PROXY_DATA_DIR (restore).
 * @param {string} [params.ontologyDir] ontology dir (restore).
 * @param {number} [params.port]      proxy port for agent routing (default LLM_PROXY_PORT ?? 12435).
 * @param {boolean} [params.captureRawBodies] D-12: forward --capture-raw-bodies to measurement-start
 *                                  so the proxy writes raw-bodies.jsonl for this cell (default OFF).
 * @param {boolean} [params.avenue] AVN-05: restore onto the `avenue/<task_id>` branch (avenueMode),
 *                                  thread the kb-off injection env, and commit the worktree diff at
 *                                  close. Default false → a non-avenue cell is byte-unchanged.
 * @param {string} [params.originSpanId] AVN-01: the forked origin span's task_id (avenue cells only)
 *                                  — forwarded to measurement-start as --origin-span-id.
 * @param {Function} [params.commitAvenue=commitAvenueWorktree] avenue branch-commit seam (Plan 01).
 * @param {Function} [params.restore=restoreForCell]         restore seam.
 * @param {Function} [params.spawnAgent=launchCell]          agent-launch seam.
 * @param {Function} [params.runMeasurement=runMeasurementCli] measurement-CLI seam.
 * @param {Function} [params.configureRouting=configureProxyRoutingEnv] proxy-routing env seam.
 * @returns {Promise<{ taskId: string, variant: string, rep: number, terminalState: string }>}
 */
/**
 * Capture the real repo's dirty-file set (untracked + modified porcelain lines) as a Set — the
 * baseline for the post-cell sandbox-escape guard. `.data/run-restores/` is gitignored, so the
 * sandbox worktree never appears here (the query stays fast and sandbox-free). Fail-soft: returns
 * null on any git error, and the guard then skips (never breaks a cell over a backstop).
 *
 * @param {string} repoRoot the REAL repo working-tree root.
 * @returns {Set<string>|null}
 */
export function captureRepoDirtySet(repoRoot) {
  try {
    const r = spawnSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8', timeout: 30_000 });
    if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
    return new Set(r.stdout.split('\n').filter(Boolean));
  } catch {
    return null;
  }
}

/**
 * Diff the after-set against the baseline and return NEW dirty paths that ESCAPED the sandbox — a
 * file the agent created or modified at the REAL repo root, outside `.data/`. The live store rewrites
 * `.data/` exports constantly, so those are excluded as unrelated noise. Each porcelain line is
 * `XY <path>` (status in cols 0-1, path from col 3); we key on the path. Null on either side → [].
 *
 * @param {Set<string>|null} baseline pre-launch dirty set.
 * @param {Set<string>|null} after post-cell dirty set.
 * @returns {string[]} escaped repo-relative paths (empty when contained).
 */
export function detectSandboxEscape(baseline, after) {
  if (!baseline || !after) return [];
  const escaped = [];
  for (const line of after) {
    if (baseline.has(line)) continue;
    const p = line.slice(3).trim();
    if (!p || p.startsWith('.data/')) continue; // sandbox lives under gitignored .data/ — excluded
    escaped.push(p);
  }
  return escaped;
}

export async function runCell({
  cell,
  rep,
  expId,
  goal,
  snapshotId,
  taskClass,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  agentsDir = path.join(REPO_ROOT, 'config', 'agents'),
  repoRoot,
  dataDir,
  ontologyDir,
  port,
  runDir,
  variantName,
  baseVariant,
  rerunOf,
  origCell,
  captureRawBodies = false,
  // Phase 87-03 (AVN-05/AVN-01/AVN-04): avenue-mode wiring. `avenue` gates ALL avenue behavior
  // so a non-avenue cell is byte-unchanged. `originSpanId` links the avenue Run back to the
  // forked origin span (threaded to measurement-start as --origin-span-id). `commitAvenue` is
  // the injectable branch-commit seam (default commitAvenueWorktree — Plan 01).
  avenue = false,
  originSpanId,
  commitAvenue = commitAvenueWorktree,
  restore = restoreForCell,
  spawnAgent = launchCell,
  runMeasurement = runMeasurementCli,
  configureRouting = configureProxyRoutingEnv,
  // Sandbox-escape backstop seam (injectable for tests). Called once before launch and once in the
  // finally; the delta of NEW dirty paths outside `.data/` is a leak the agent wrote to the real repo.
  captureRepoState = captureRepoDirtySet,
}) {
  // The RECORDED variant name is the derived name when overridden (D-07), else the effective
  // cell's own name. composeTaskId keys off the ORIGINAL cell (origCell) when supplied so an
  // override NEVER changes task_hash (D-05); a non-override call falls back to the effective cell.
  const variant = variantName ?? cellName(cell);
  const taskId = composeTaskId(expId, origCell ?? cell, rep);

  // (1) Restore into a FRESH isolated sandbox (D-02 / T-78-03-02 zero blast radius).
  //     Emit `restoring` BEFORE the (potentially slow) restore so the poller reflects it.
  await emitProgress(runDir, { cells: [{ variant, rep, task_id: taskId, state: 'restoring', started_at: new Date().toISOString() }] });
  // AVN-05: an avenue cell restores onto its NAMED `avenue/<task_id>` branch (Plan 01 seam) so the
  // worktree lands under `.data/avenues/<task_id>/` and the avenue's edits accumulate as commits on
  // a real ref. The branch name is derived ONCE via sanitizeTaskId (T-87-03-01 — provably matches
  // `avenue/[A-Za-z0-9._-]+`). Non-avenue cells pass NO avenueMode → the detached restore is unchanged.
  const branchName = avenue ? `avenue/${sanitizeTaskId(taskId)}` : undefined;
  const restoreOpts = { repoRoot, dataDir, ontologyDir };
  if (avenue) {
    restoreOpts.avenueMode = true;
    restoreOpts.branchName = branchName;
  }
  const { worktree, sandboxDataDir } = await restore(snapshotId, restoreOpts);

  // (1a) Sandbox integrity: strip restored project-rules files (CLAUDE.md/AGENTS.md/…) from the
  //      throwaway worktree. The restored CLAUDE.md hardcodes the LIVE repo's absolute path; opencode
  //      ingests it as its rules file and, told to write "at the repository root", escapes the sandbox
  //      (2026-07-23 leak). Removing them pins every agent's writes to its sandbox cwd. Runs ALWAYS,
  //      independent of the injection axis. Fail-soft (missing file = no-op).
  const strippedRules = neutralizeSandboxRules(worktree);
  if (strippedRules.length) {
    process.stderr.write(`[experiments] sandbox rules neutralized (${taskId}): ${strippedRules.join(', ')}\n`);
  }
  // (1b) Escape-guard baseline: the real repo's dirty set BEFORE launch. Compared post-cell to catch
  //      any residual escape (a file the agent wrote at the real root outside .data/). Fail-soft.
  const realRepoRoot = repoRoot || REPO_ROOT;
  const escapeBaseline = captureRepoState(realRepoRoot);
  let sandboxEscape;

  // (1c) Baseline commit — fold the restore's working-tree RECONSTRUCTION (tens of thousands of lines
  //      it rewrites over the detached SHA) into the sandbox HEAD, so the judge's diffstat
  //      (evidence-harness readDiffStat, at score time) reflects ONLY the agent's edits — not restore
  //      noise that otherwise drowns a small deliverable and craters the code_quality churn heuristic
  //      (observed: a 2-file/6-line fizzbuzz change buried under 18 files / 35k lines → code_quality
  //      0.06). Combined with the harness's intent-to-add, the agent's NEW files then show as a clean
  //      small diff. Fixed-argv, fail-soft: a non-git worktree or commit failure just leaves the prior
  //      (noisier) HEAD-diff behavior — never aborts the cell. `.data/` stays gitignored (not committed).
  try {
    const gitOpts = { cwd: worktree, timeout: 20_000, encoding: 'utf8' };
    spawnSync('git', ['add', '-A'], gitOpts);
    spawnSync('git', [
      '-c', 'user.email=experiment@local', '-c', 'user.name=experiment',
      'commit', '-q', '--no-verify', '--allow-empty', '-m', 'baseline: post-restore, pre-agent (scoring)',
    ], gitOpts);
  } catch { /* fail-soft — evidence falls back to the noisier HEAD diff */ }

  // The measured span MUST live in the MAIN data dir — the dir the shared host proxy reads
  // active-measurement.json from. Writing it into the sandbox .data (the pre-fix bug) hid the
  // task_id from the proxy → every captured row landed with an empty task_id → 0-token cells.
  // measurement-stop's aggregateByTaskId ALSO reads the MAIN token-usage.db, so start+stop both
  // use spanEnv. (Agent file/KB isolation is preserved separately via cwd=worktree, below.)
  const mainDataDir = dataDir || process.env.LLM_PROXY_DATA_DIR || path.join(repoRoot || REPO_ROOT, '.data');
  const spanEnv = { ...process.env, LLM_PROXY_DATA_DIR: mainDataDir };

  // (2) Open the measured span — fixed argv, MAIN-dir span env. `--repeat` is presence-checked
  //     downstream so index 0 survives (measurement-start.mjs R2).
  const startArgv = [
    '--task-id', taskId,
    '--variant', variant,
    // D-07: the ORIGINAL variant name, ONLY when an override derived a suffixed --variant.
    ...(baseVariant ? ['--base-variant', baseVariant] : []),
    // D-05: the ORIGINAL run_id, ONLY when this is a re-run.
    ...(rerunOf ? ['--rerun-of', rerunOf] : []),
    // AVN-01: the FORKED origin span's task_id, ONLY for an avenue cell — so run-write
    // stamps origin_span_id and the avenue Run groups by its origin. Span env stays MAIN
    // (spanEnv, Pitfall 1) — this arg never repoints the span at the sandbox.
    ...(originSpanId ? ['--origin-span-id', originSpanId] : []),
    '--repeat', String(rep),
    // The MUTATED effective agent/model/framework (the override is applied on `cell` upstream).
    '--agent', cell.agent,
    '--model', cell.model,
    '--framework', cell.framework,
    // The agent runs in the sandbox worktree; record it so the claude transcript locator
    // finds ~/.claude/projects/<worktree>/*.jsonl (else it uses the main-repo cwd and misses it).
    '--cwd', worktree,
    ...(cell.test_command ? ['--test-command', cell.test_command] : []),
    // D-12 (85-06): forward the raw-body capture opt-in to measurement-start so it arms
    // span.meta.capture_raw_bodies=true → the proxy writes raw-bodies.jsonl for this cell.
    // Pure PRESENCE flag, OFF by default; absent → byte-identical to the pre-fix argv.
    ...(captureRawBodies ? ['--capture-raw-bodies'] : []),
    '--goal', goal,
  ];
  await runMeasurement('start', startArgv, { env: spanEnv });

  // (3) Launch the agent under the terminal-state timer. `terminalState` defaults to 'abort'
  //     so that even a spawn REJECT (ENOENT) still records a terminal Run via the finally.
  //     The agent env keeps its sandbox LLM_PROXY_DATA_DIR (isolation, T-78-03-02) AND gets
  //     proxy routing (ANTHROPIC_BASE_URL) so its tokens attribute to the open span.
  const agentBaseEnv = { ...process.env, LLM_PROXY_DATA_DIR: sandboxDataDir };
  // Align the inherited PWD with the sandbox cwd: child_process.spawn({cwd}) changes the process cwd
  // but leaves PWD/OLDPWD pointing at the runner's cwd (the real repo). An agent that reads $PWD for its
  // root would otherwise see the live repo — pin it to the sandbox and drop the stale OLDPWD.
  agentBaseEnv.PWD = worktree;
  delete agentBaseEnv.OLDPWD;
  // AVN-04 (Plan 02 seam) + injection-derailment fix (2026-07-23): the env axis carries the
  // knowledge-injection toggle. CODING_KNOWLEDGE_INJECTION=0 threads into the AGENT child env only
  // (NOT spanEnv — the span must stay on MAIN, Pitfall 1); both injection seams (the Claude
  // UserPromptSubmit hook and the bash injector for opencode/copilot/mastra) early-return when it
  // is '0'.
  //
  // DEFAULT FLIPPED: injection is now ON *only* for an explicit `env: kb-on`. A cross-agent
  // experiment measures how well an agent does THE TASK — the `## Working Memory`/KB context
  // injection is noise that derails weaker models: verified that opencode + copilot, given the
  // fizzbuzz goal WITH injection, answered the injected working-memory block ("I see you're sharing
  // context about the Coding project…") and never wrote the files (0 tool calls), while claude
  // ignored it. So `default`/`kb-off`/unspecified → clean prompt (injection OFF); only a deliberate
  // `kb-on` cell (the AVN-04 with-vs-without comparison) re-enables it.
  if (cell.env !== 'kb-on') {
    agentBaseEnv.CODING_KNOWLEDGE_INJECTION = '0';
  }
  // Phase 88-01 (ALIGN-01): resolve the catalog-valid LAUNCH model ONCE from the single source of
  //   truth, BEFORE launch. This is the ONLY model the actual agent CLI + COPILOT_MODEL see —
  //   opencode `rapid-proxy/claude-haiku-4-5`→`…4.5` (dash-typo fix), copilot `auto`→the measured
  //   default. CRITICAL: composeTaskId, cellName, the recorded --variant, and the measurement-start
  //   --model above all stay keyed off the ORIGINAL cell.model so task_hash + the variant identity
  //   are byte-unchanged (D-05 comparability). Only the launch argv + COPILOT_MODEL use launchModel.
  const launchModel = resolveCellModel(cell.agent, cell.model);
  const agentEnv = await configureRouting(cell.agent, agentBaseEnv, { port, taskId, model: launchModel });
  let terminalState = 'abort';
  // A1: the abort/timeout reason (from launchCell's exit code/signal) so the terminal progress
  // patch records WHY, surfaced by the monitor's per-cell reason line. Undefined for 'complete'.
  let terminalReason;
  try {
    await emitProgress(runDir, { cells: [{ variant, rep, task_id: taskId, state: 'running' }] });
    const bin = resolveAgentBinary(cell.agent, agentsDir);
    const argv = argvForAgent(cell.agent, goal, { model: launchModel });
    const result = await spawnAgent({ bin, argv, worktree, sandboxDataDir, env: agentEnv, timeoutMs });
    // launchCell resolves { state, reason? }; a fake/legacy seam may resolve a bare string.
    const norm = normalizeCellResult(result);
    terminalState = norm.state;
    terminalReason = norm.reason;
  } finally {
    // (4) Close + INLINE-SCORE on EVERY terminal state (D-11 / Pitfall 4 — no dropped cell).
    await emitProgress(runDir, { cells: [{ variant, rep, task_id: taskId, state: 'scoring' }] });
    const stopArgv = [
      '--headless',
      ...(taskClass ? ['--task-class', taskClass] : []),
      '--terminal-state', terminalState,
    ];
    await runMeasurement('stop', stopArgv, { env: spanEnv });
    // (4a) Sandbox-escape backstop: diff the real repo's dirty set against the pre-launch baseline.
    //      Any NEW path outside `.data/` is a file the agent wrote to the real repo — surface it LOUDLY
    //      (stderr + the returned summary) so a silent leak becomes a visible failure. Detection only:
    //      auto-deleting from the real repo is unsafe (could hit legitimate concurrent edits).
    const escaped = detectSandboxEscape(escapeBaseline, captureRepoState(realRepoRoot));
    if (escaped.length) {
      sandboxEscape = escaped;
      process.stderr.write(
        `[experiment-runner] SANDBOX ESCAPE (${taskId}): agent wrote OUTSIDE its sandbox to the real ` +
          `repo root — ${escaped.join(', ')}. Rules-file neutralization should prevent this; investigate ` +
          `and clean these files manually (they were NOT auto-removed).\n`,
      );
    }
    // (5) AVN-05 / D-04: an avenue cell commits its worktree diff onto the `avenue/<task_id>` branch
    //     at close so the branch HOLDS the avenue's real code (RESEARCH Q4 — the runner commits the
    //     diff deterministically). Best-effort: a commit failure NEVER aborts the close/score path
    //     (the measurement already landed on MAIN). A clean tree is a no-op (commitAvenueWorktree
    //     returns { committed:false } — no empty commit). Non-avenue cells skip this entirely.
    if (avenue) {
      try {
        commitAvenue({ worktree, message: `avenue: ${variant} ${taskId}` });
      } catch (err) {
        process.stderr.write(`[experiments] avenue commit-on-close failed (non-fatal) for ${taskId}: ${err.message}\n`);
      }
    }
    // Terminal cell state = the closed enum (complete | timeout | abort). Attach the reason
    // (A1) so an aborted/timed-out cell surfaces WHY in the monitor instead of a bare badge.
    await emitProgress(runDir, {
      cells: [{
        variant, rep, task_id: taskId, state: terminalState,
        ...(terminalReason ? { reason: terminalReason } : {}),
        ended_at: new Date().toISOString(),
      }],
    });
  }

  return {
    taskId, variant, rep, terminalState,
    ...(terminalReason ? { reason: terminalReason } : {}),
    ...(sandboxEscape ? { sandboxEscape } : {}),
  };
}

/** Stable short experiment id derived from the goal when none is supplied (composite prefix). */
function deriveExpId(goal) {
  return `exp-${createHash('sha256').update(String(goal)).digest('hex').slice(0, 12)}`;
}

/**
 * Write a recorded SKIP-Run for a cell that will NOT launch an agent (D-08). Opens + closes a
 * span with the composite --task-id / --variant / --repeat / cell fields and a --skip-reason,
 * so the cell is NEVER silently absent (RUN-04). No agent-launch seam is called here.
 */
async function writeSkipRun({ cell, rep, expId, goal, taskClass, skipReason, runMeasurement = runMeasurementCli }) {
  const variant = cellName(cell);
  const taskId = composeTaskId(expId, cell, rep);
  const startArgv = [
    '--task-id', taskId,
    '--variant', variant,
    '--repeat', String(rep),
    '--agent', cell.agent,
    '--model', cell.model,
    '--framework', cell.framework,
    ...(cell.test_command ? ['--test-command', cell.test_command] : []),
    '--goal', goal,
  ];
  await runMeasurement('start', startArgv, {});
  const stopArgv = [
    '--headless',
    ...(taskClass ? ['--task-class', taskClass] : []),
    '--skip-reason', skipReason,
  ];
  await runMeasurement('stop', stopArgv, {});
}

/**
 * Drive the FULL variant×repeat matrix — the sequential, idempotent, resumable engine
 * (RUN-02/03/04). Steps:
 *   (a) resolve the spec (goal_sentence, repeats, cells) — already Phase-77 validated;
 *   (b) open the repo-global single-owner store ONCE, build the resume done-set from
 *       readRuns filtered to terminal_state==='complete' (Q3), then CLOSE it before
 *       launching any cell (single-owner LevelDB — measurement-stop reopens per cell);
 *   (c) `for (cell) for (rep)` STRICTLY sequentially (`await` each — D-09; never Promise.all):
 *         • composite task_id already complete → SKIP (D-10 idempotent resume);
 *         • PRE-FLIGHT the cell (88-02) — a bounded, fail-soft /api/complete round-trip on the
 *           RESOLVED model validates proxy reachability + model round-trip against the agent's
 *           target provider (NO taskId → no span collision). !ok → recorded skip-Run via the SAME
 *           RUN-04 writeSkipRun path (never a mid-run abort, never a hard required-agent failure);
 *         • otherwise runCell (restore → measured span → launch → inline score in a finally).
 *       Each cell is wrapped in try/catch so a spawn/agent failure is recorded best-effort and
 *       the matrix never throws/stalls (D-12).
 * Returns one summary entry per attempted cell (status: 'ran' | 'skipped').
 *
 * @param {string|object} spec  spec file path or object (resolved via resolveExperimentSpec).
 * @param {object} [opts]
 * @param {string} [opts.repoRoot] @param {string} [opts.dataDir] @param {string} [opts.ontologyDir]
 * @param {number} [opts.timeoutMs] @param {string} [opts.agentsDir] @param {string} [opts.taskClass]
 * @param {string} [opts.expId]     stable composite prefix (default: spec.experiment_id or goal hash).
 * @param {string} [opts.snapshotId] declare-time baseline snapshot (default: spec.snapshot_id).
 * @param {Function} [opts.restore] @param {Function} [opts.spawnAgent] @param {Function} [opts.runMeasurement]
 * @param {Function} [opts.readDone=readRuns] @param {Function} [opts.preflight=preflightAgent]
 * @param {Function} [opts.openStore=openExperimentStore] @param {Function} [opts.resolveSpec=resolveExperimentSpec]
 * @returns {Promise<Array<object>>} per-cell summary.
 */
export async function runMatrix(spec, opts = {}) {
  const {
    repoRoot, dataDir, ontologyDir, timeoutMs, agentsDir, taskClass, port, runDir,
    expId: expIdOpt, snapshotId: snapshotOpt,
    variantOverrides = {}, runId, rerunOf, captureRawBodies = false,
    // Phase 87-07 (CR-01): thread avenue-mode from the matrix opts into runCell so the
    // already-correct avenue seam (runCell :461/:484-486) is REACHABLE via the only
    // production caller. `avenue` defaults false → non-avenue cells stay byte-identical;
    // `originSpanId` links each avenue Run to the forked origin span; `commitAvenue` stays
    // undefined when absent so runCell keeps its own commitAvenueWorktree default.
    avenue = false, originSpanId, commitAvenue,
    restore, spawnAgent, runMeasurement, configureRouting,
    readDone = readRuns,
    // Phase 88-02: the per-cell pre-flight seam (tests stub it). Replaces the leaky once-per-matrix
    // copilot -p drivability probe — preflightAgent is a session-free /api/complete round-trip.
    preflight = preflightAgent,
    openStore = openExperimentStore,
    resolveSpec = resolveExperimentSpec,
  } = opts;

  // (a) resolve — the spec was already whole-run validated by Phase-77 resolveExperimentSpec.
  const { goal_sentence: goal, repeats, cells } = resolveSpec(spec);
  const rawExpId = spec && typeof spec === 'object' ? spec.experiment_id : null;
  const rawSnapshot = spec && typeof spec === 'object' ? spec.snapshot_id : null;
  const baseExpId = expIdOpt ?? rawExpId ?? deriveExpId(goal);
  // D-05: the run_id salts the composite task_id PREFIX (expId) so a re-run's cells get DISTINCT
  // task_ids from the original — while task_hash (the cellName slug, keyed off the ORIGINAL cell)
  // stays CONSTANT, preserving comparability. runId is already length-bounded upstream (Pitfall 1).
  const expId = runId ? `${baseExpId}-${runId}` : baseExpId;
  const snapshotId = snapshotOpt ?? rawSnapshot ?? null;

  // (b) build the resume done-set from the single-owner store, then CLOSE it BEFORE launching
  //     any cell (measurement-stop reopens the store per cell — two owners must never overlap).
  const store = await openStore({ repoRoot });
  let doneSet;
  try {
    const rows = await readDone(store, { includePending: true });
    // Q3: ONLY a Run with terminal_state==='complete' counts as done; timeout/abort/unscored
    // cells are retried on resume. Keyed off the composite task_id (Pitfall 1).
    doneSet = new Set(rows.filter((r) => r.terminal_state === 'complete').map((r) => r.task_id));
  } finally {
    await store.close();
  }

  // (c) STRICTLY sequential loop — `await` each cell (D-09); never Promise.all.
  //     When a runDir is supplied, emit per-transition progress + maintain the run-level
  //     header done/total/overall (D-03/D-04). NO-OP when runDir is absent (existing callers).
  const total = cells.length * repeats;
  let done = 0;
  await emitProgress(runDir, { done, total, overall: 'running' });
  const summary = [];
  for (const cell of cells) {
    const variant = cellName(cell);
    for (let rep = 0; rep < repeats; rep += 1) {
      const taskId = composeTaskId(expId, cell, rep);

      // D-10 idempotent resume: skip a cell whose composite task_id already completed.
      if (doneSet.has(taskId)) {
        process.stderr.write(`[experiment-runner] resume: skipping completed ${taskId}\n`);
        summary.push({ task_id: taskId, variant, rep, status: 'skipped', reason: 'already-complete' });
        done += 1;
        await emitProgress(runDir, {
          done,
          cells: [{ variant, rep, task_id: taskId, state: 'complete', reason: 'already-complete' }],
        });
        continue;
      }

      // Phase 88-02 (PREFLIGHT-01 / SUPPRESS-01): PRE-FLIGHT the cell BEFORE it burns a run. A
      // bounded, fail-soft /api/complete round-trip on the RESOLVED launch model validates the proxy
      // is reachable AND the model round-trips one token against the agent's target provider. NO
      // taskId is passed — the round-trip is a plain proxy liveness/model check, so there is no
      // composite-taskId span collision and no dependency on measurement-start ordering. Because it
      // is a session-free proxy call (row lands task_id='' / process='experiment-preflight'), it
      // creates NO experiment Run and NO ambient pass by construction. On failure → a clean recorded
      // skip-Run via the SAME RUN-04 writeSkipRun path (never a mid-run abort, never a hard
      // required-agent failure). This REPLACES the leaky once-per-matrix `copilot -p` probe (which
      // created a ~/.copilot session-state dir → an ambient Runs-view row); copilot CLI *presence* is
      // still covered at launch by resolveAgentBinary (a missing binary surfaces as a recorded abort).
      const launchModel = resolveCellModel(cell.agent, cell.model);
      const pf = await preflight(cell.agent, { model: launchModel, port });
      if (pf && pf.ok === false) {
        const skipReason = pf.reason || `preflight:${cell.agent}-failed`;
        try {
          await writeSkipRun({ cell, rep, expId, goal, taskClass, skipReason, runMeasurement });
        } catch (err) {
          process.stderr.write(`[experiment-runner] preflight skip-Run write failed for ${taskId} (non-fatal): ${err.message}\n`);
        }
        summary.push({ task_id: taskId, variant, rep, status: 'skipped', reason: skipReason });
        done += 1;
        await emitProgress(runDir, {
          done,
          cells: [{ variant, rep, task_id: taskId, state: 'skipped', reason: skipReason }],
        });
        continue;
      }

      // D-06/D-07: apply the per-variant override (keyed by the ORIGINAL variant name). The
      // effective cell carries the mutated model/agent for launch; the derived name is recorded
      // as --variant and the ORIGINAL name as --base-variant. composeTaskId keys off the ORIGINAL
      // cell (origCell) so task_hash stays CONSTANT (D-05). Empty map ⇒ effectiveCell===cell,
      // baseVariant null, no --base-variant (byte-identical existing behavior).
      const { effectiveCell, derivedVariant, baseVariant } = applyVariantOverride(cell, variantOverrides);

      // Otherwise: restore → measured span → launch → inline score. D-12: a spawn/agent
      // failure is recorded best-effort (terminal_state 'abort') — the matrix never stalls.
      try {
        const res = await runCell({
          cell: effectiveCell, origCell: cell, variantName: derivedVariant, baseVariant, rerunOf,
          rep, expId, goal, snapshotId, taskClass, timeoutMs, agentsDir,
          repoRoot, dataDir, ontologyDir, port, runDir, captureRawBodies,
          // Phase 87-07 (CR-01): forward avenue-mode so runCell restores onto the named
          // avenue/<task_id> branch, threads --origin-span-id into measurement-start, and
          // commits the worktree on close. `commitAvenue` is omitted (undefined) when not
          // injected so runCell keeps its own commitAvenueWorktree default (D-04 seam).
          avenue, originSpanId, commitAvenue,
          restore, spawnAgent, runMeasurement, configureRouting,
        });
        summary.push({ task_id: taskId, variant, rep, status: 'ran', terminal_state: res.terminalState });
      } catch (err) {
        process.stderr.write(`[experiment-runner] cell ${taskId} failed (best-effort, D-12): ${err.message}\n`);
        summary.push({ task_id: taskId, variant, rep, status: 'ran', terminal_state: 'abort', error: err.message });
        // runCell threw before its finally could emit the terminal state — record 'abort' here.
        await emitProgress(runDir, {
          cells: [{ variant, rep, task_id: taskId, state: 'abort', reason: err.message, ended_at: new Date().toISOString() }],
        });
      }
      done += 1;
      await emitProgress(runDir, { done });
    }
  }

  await emitProgress(runDir, { done, total, overall: 'complete' });
  process.stderr.write(`[experiment-runner] matrix complete: ${summary.length} cells attempted\n`);
  return summary;
}
