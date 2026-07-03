# Phase 78: Autonomous Cross-Agent Runner - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 6 (4 new, 1 new test, 1 additive-edit)
**Analogs found:** 6 / 6 (2 exact sibling analogs, the rest role-match)

> This phase is a thin orchestrator over shipped machinery. Almost every "new" file
> has a near-identical sibling already in `lib/experiments/` or `scripts/`. **Copy the
> sibling's shape first, then fill in the phase-78 logic.** The two golden analogs are
> `lib/experiments/experiment-restore.mjs` (for the runner module) and
> `scripts/experiment-restore.mjs` (for the operator CLI) — both are Phase-77 siblings
> that already encode the repo's ESM-module + injectable-seam + fixed-argv + stderr idioms.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/experiments/experiment-runner.mjs` (NEW) | service (orchestration engine) | batch + event-driven (sequential matrix loop + child `exit` events) | `lib/experiments/experiment-restore.mjs` | exact (sibling orchestrator, same injectable-seam idiom) |
| `scripts/experiment-run.mjs` (NEW) | operator CLI | request-response (invoke → exit code) | `scripts/experiment-restore.mjs` | exact (sibling CLI, same skeleton) |
| `lib/experiments/agent-headless.mjs` (NEW, optional) | utility / adapter table | transform (agent name → fixed argv) | `lib/agent-detector.js` `parseAgentConfig` (:23-39) | role-match (AGENT_COMMAND parse) |
| Copilot probe helper (NEW — inside runner or agent-headless) | utility / capability check | request-response (spawnSync → exit 0) | `lib/experiments/evidence-harness.mjs` `runTestCommand` (:278-298) | role-match (fixed-argv spawnSync child) |
| Terminal-state machine (NEW — inside runner) | utility / process supervisor | event-driven (spawn + timer → `complete`/`timeout`/`abort`) | `lib/vkb-server/server-manager.js` (:162-167) | role-match (SIGTERM→SIGKILL escalation) |
| `tests/experiments/experiment-runner.test.mjs` (NEW) | test | n/a | `tests/experiments/experiment-restore.test.mjs` | exact (same node:test + injected-seam idiom) |
| `lib/experiments/run-write.mjs` (MODIFIED — additive tags) | model / persistence write | CRUD (write) | itself (:94-129 tag allow-list) | in-place extend |

---

## Pattern Assignments

### `lib/experiments/experiment-runner.mjs` (service, batch + event-driven) — NEW

**Analog:** `lib/experiments/experiment-restore.mjs` (the Phase-77 sibling orchestrator)

**Module-header + imports pattern** (`experiment-restore.mjs:1-42`): every `lib/experiments/*.mjs`
opens with a block comment that states the phase/plan, the exported signatures, the decisions
(D-xx) it implements, a SECURITY note, and a "Diagnostics via process.stderr.write only
(no-console-log, CLAUDE.md)" line. Copy this header shape verbatim. Imports are `node:` builtins
first, then sibling modules:
```js
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';   // runner also needs `spawn` (async — see timer)
import { fileURLToPath } from 'node:url';

import { restoreSnapshot } from '../repro/restore-snapshot.mjs';
```

**Injectable-seam pattern (the repo's testability idiom)** (`experiment-restore.mjs:168-175`) —
export orchestration functions that take shipped calls as injectable defaults so unit tests run
without real agents/worktrees:
```js
export async function restoreForCell(snapshotId, opts = {}) {
  const { repoRoot, dataDir, ontologyDir, restore = restoreSnapshot } = opts;
  const restoreOpts = { inPlace: false, repoRoot, dataDir };
  if (ontologyDir) restoreOpts.ontologyDir = ontologyDir;
  const res = await restore(snapshotId, restoreOpts);
  ...
}
```
For the runner: `runMatrix(spec, { restore = restoreForCell, spawnAgent = realSpawn,
runMeasurementStop = realSubprocess, readDone = readRuns, probeCopilot = probeCopilotHeadless })`.
Same `X = realX` default-arg seam. (Also seen at `measurement-start.mjs:90` `resolveSpec =
resolveExperimentSpec`, and `judge.mjs:289` injecting `callProxy`.)

**Fixed-argv `spawnSync` (no shell string) pattern** (`experiment-restore.mjs:97-105`, `gitHead`):
```js
const res = spawnSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
  timeout: GIT_TIMEOUT_MS,
});
const ok = !!res && !res.error && res.status === 0;
```
The agent launch, the probe, and any test-command call MUST follow this — a binary + an array,
never a shell string. This is the CLAUDE.md fixed-argv constraint the whole phase rides on.

**Terminal-state machine (spawn + timer, D-04/D-06)** — analog `lib/vkb-server/server-manager.js:162-167`:
```js
// server-manager.js:161-171 (SIGTERM → wait → SIGKILL escalation)
process.kill(pid, 'SIGTERM');
await new Promise(resolve => setTimeout(resolve, 1000));
if (await this.isProcessRunning(pid)) {
  process.kill(pid, 'SIGKILL');
}
```
Apply to the driven agent child (MUST use async `spawn`, NOT `spawnSync` — a sync call blocks
the wall-clock timer and a hung agent stalls the matrix, Pitfall 2):
```js
import { spawn } from 'node:child_process';
const child = spawn(bin, argv, {                 // fixed argv (CLAUDE.md); never a shell string
  cwd: worktree,                                 // D-02 — restored sandbox worktree
  env: { ...process.env, LLM_PROXY_DATA_DIR: sandboxDataDir }, // D-02 — sandbox .data
});
let killedByTimer = false;
const t = setTimeout(() => {
  killedByTimer = true;
  child.kill('SIGTERM');
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5_000);
}, timeoutMs);                                    // D-06 default 20*60_000, spec/CLI-overridable
child.on('exit', (code) => {
  clearTimeout(t);
  const state = killedByTimer ? 'timeout' : (code === 0 ? 'complete' : 'abort'); // D-04
  ...
});
```
Ordering (Pitfall 4): close the span (run `measurement-stop.mjs`) in a `finally` REGARDLESS of
agent exit so every terminal state lands a Run — "none silently dropped" (D-04).

**Store + resume-ledger pattern (D-10)** — `openExperimentStore` is repo-global (NOT the sandbox),
so `readRuns` sees all cells. Analog `query.mjs:77-118` (`readRuns`) + `store.mjs:40-54`
(single-owner LevelDB → forces sequential, D-09). Build the done-set once, gate the skip on
`terminal_state === 'complete'`:
```js
const done = new Set((await readRuns(store, { includePending: true }))
  .filter(r => r.terminal_state === 'complete')     // only completed cells skip (retry timeout/abort)
  .map(r => r.task_id));
for (const cell of cells) for (let rep = 0; rep < repeats; rep++) {
  const taskId = cellTaskId(expId, cell, rep);       // e.g. `${expId}--${variantName}--r${rep}`
  if (done.has(taskId)) continue;                    // D-10 idempotent skip
  ...
}
```
Wrap store usage in `try { ... } finally { await store.close(); }` — the caller-owns-close contract
(`store.mjs:29-31`, `query.mjs:67-69`, `measurement-stop.mjs:471-501`).

**Diagnostics** — `process.stderr.write(...)` only, e.g. `experiment-restore.mjs` / `run-write.mjs:218`.
NEVER `console.*` (no-console-log, CLAUDE.md).

---

### `scripts/experiment-run.mjs` (operator CLI, request-response) — NEW

**Analog:** `scripts/experiment-restore.mjs` (near-perfect sibling — copy it wholesale, then swap
the body). It is itself documented as "CLI skeleton copied from scripts/repro-restore.mjs".

**Full skeleton to copy** (`scripts/experiment-restore.mjs:1-107`):
```js
#!/usr/bin/env node
/**
 * Operator CLI — <one-line purpose> (Phase 78; RUN-02/03/04).
 * ...decisions, env vars, test-seam...
 * Diagnostics via process.stderr.write only (no-console-log, CLAUDE.md). Exits non-zero on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { runMatrix } from '../lib/experiments/experiment-runner.mjs';

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

function usage() {
  process.stderr.write('usage: node scripts/experiment-run.mjs --spec <file> [--variant …] [--repeats N] [--timeout <sec>]\n' + ...);
}

async function main() {
  const args = process.argv.slice(2);
  const specPath = parseStrArg(args, '--spec');
  if (!specPath) { process.stderr.write('error: --spec <file> is required\n'); usage(); process.exit(2); }
  const repoRoot = process.env.CODING_REPO || process.cwd();
  const dataDir  = process.env.LLM_PROXY_DATA_DIR || path.join(repoRoot, '.data');
  ...
  await runMatrix(...);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.message}\n`);
  process.exit(1);
});
```
Notes carried from the analog:
- `parseStrArg` inline helper (identical to `measurement-start.mjs:56-60`) — do NOT add an arg-parse lib.
- `process.exit(2)` for usage errors, `main().catch → FATAL → exit(1)` for runtime failures.
- Env resolution: `CODING_REPO` → repoRoot, `LLM_PROXY_DATA_DIR` → dataDir (matches
  `measurement-start.mjs:233` and `experiment-restore.mjs:91-92`).
- **Test seam via env** (`experiment-restore.mjs:21-23,95-96` `EXPERIMENT_RESTORE_FAKE`): expose a
  parallel `EXPERIMENT_RUN_FAKE`-style seam (e.g. a stub agent binary `node -e "process.exit(0)"`)
  so the SC#4 integration test drives the CLI end-to-end without a live agent.

**CLI flag → span.meta bridge** (RUN-02, D-03) — the runner calls `measurement-start.mjs` per cell.
That CLI already accepts `--task-id --agent --model --framework --test-command --variant --goal`
(`measurement-start.mjs:90-165`). The runner sets `--task-id "<expId>--<variant>--r<rep>"` (the
composite key, R2) and `LLM_PROXY_DATA_DIR=<sandboxDataDir>` in the child env, then
`measurement-stop.mjs --headless --task-class <cls>` to close+score inline (D-11).

---

### `lib/experiments/agent-headless.mjs` (utility / adapter, transform) — NEW (optional)

**Analog:** `lib/agent-detector.js` `parseAgentConfig` (:23-39) — the AGENT_COMMAND parse is
**module-private** (only `AgentDetector` + default export are public), so re-expose the ~10-line
parse rather than importing it:
```js
// lib/agent-detector.js:26-29 — the regex to reuse for resolving AGENT_COMMAND from config/agents/<name>.sh
const get = (key) => {
  const match = content.match(new RegExp(`^${key}="?([^"\\n]+)"?`, 'm'));
  return match ? match[1].trim() : null;
};
// get('AGENT_COMMAND')  → e.g. claude → "$CODING_REPO/bin/claude-mcp"
```
**CRITICAL (Anti-pattern, Research Risk R1):** the `config/agents/*.sh` scripts are NOT headless —
`launch-agent-common.sh:592-595` runs them through `tmux_session_wrapper` (interactive). Reuse
`.sh` only as the agent→binary REGISTRY; then spawn the binary DIRECTLY with its documented
non-interactive flag. Do NOT use `AgentRegistry.getAdapter('claude'|'copilot')` either — those are
interactive MCP/HTTP shims (`agent-registry.js:63-64`), not headless drivers.

**Adapter table shape** (per Research Unknown 1 — fixed argv per agent):
| agent | fixed argv (`argvFor(goal, {model})`) | permission flag needed |
|-------|---------------------------------------|------------------------|
| claude | `['-p', goal, '--model', model, '--permission-mode', 'acceptEdits']` (bin `claude`, NOT `bin/claude-mcp`) | `--permission-mode acceptEdits` / `--dangerously-skip-permissions` (Pitfall 6) |
| opencode | `['run', goal, '-m', model]` (`--dir` sets cwd, or spawn `cwd`) | — |
| mastracode | `['--prompt', goal, '-m', model]` (cwd via spawn `cwd`; no `--dir`) | — |
| copilot | `['-p', goal, '--allow-all-tools', '--model', model]` | `--allow-all-tools` (required for non-interactive) |

Emit a fixed argv ARRAY; spawn with `{ cwd: worktree, env: { ...process.env, LLM_PROXY_DATA_DIR:
sandboxDataDir } }` (D-02). Never a shell string.

---

### Copilot capability probe (RUN-04, D-07/D-08) — NEW (inside runner or adapter)

**Analog:** `evidence-harness.mjs:278-298` `runTestCommand` (fixed-argv `spawnSync` child, bounded
timeout, fail-soft on `res.error`):
```js
const res = spawnSync(cmd, args, {
  cwd: repoRoot,
  encoding: 'utf8',
  timeout: resolveTestTimeoutMs(),
  maxBuffer: 16 * 1024 * 1024,
  env: childEnv,
});
if (res.error) return null; // spawn failed (ENOENT / timeout) → no signal
```
Probe shape (Research Unknown 2 — one-turn, assert exit 0):
```js
function probeCopilotHeadless() {
  const r = spawnSync('copilot',
    ['-p', 'Reply with the single word OK and nothing else.', '--allow-all-tools'],
    { encoding: 'utf8', timeout: 90_000 });
  return !r.error && r.status === 0;   // D-07: trivial one-turn, exit 0
}
```
Run ONCE per matrix, cache the boolean. On failure (D-08) write an explicit skip-Run with a
recorded `skip_reason` (see run-write edit below) — never silently absent.

**Open design decision the planner must resolve (Research Q1):** `validateCells`
(`experiment-spec.mjs:151-159`) hard-throws `copilot + env:headless` at resolve time. The probe is
a standalone check that must either strip the `UNSUPPORTED_COMBINATIONS` entry on pass, or drive
copilot under `env:default`. Pick one and document it.

---

### `tests/experiments/experiment-runner.test.mjs` (test) — NEW

**Analog:** `tests/experiments/experiment-restore.test.mjs` (:1-44) — `node:test` + `node:assert/strict`,
injected seam for unit logic, `spawnSync` of the CLI under an env-seam for the CLI contract:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// ... import runner exports; resolve CLI path via path.resolve(__dirname, '..','..','scripts','experiment-run.mjs')
```
- Unit: inject fake `spawnAgent`/`restore`/`runMeasurementStop`/`readRuns` to cover RUN-02 (argv +
  cwd/env), RUN-03 (exit0→complete, timer→timeout, nonzero→abort; measurement-stop in `finally`),
  RUN-04 (probe pass/fail), D-10 (completed composite `task_id` skipped).
- Integration (SC#4): stub agent `node -e "process.exit(0)"` → exactly one Run per variant×repeat.
- Run command: `node --test tests/experiments/experiment-runner.test.mjs` (NOT jest — the
  experiments module is `node:test`; top-level `npm test` is jest).

---

### `lib/experiments/run-write.mjs` (persistence write, CRUD) — MODIFIED (additive)

**Additive edit only** — extend the `Run.metadata` tag block (`run-write.mjs:100-128`) to persist the
four new fields (Gaps R2/R3/R4). Follow the EXACT existing idiom: `?? null` presence-default, one
tag per line, null preserved (never coerced). Add alongside the existing tags:
```js
    // existing (run-write.mjs:102-121) …
    task_hash:   t.task_hash ?? null,
    agent:       t.agent ?? null,
    // ── NEW (Phase 78) — additive, null-preserved (D-02 idiom) ──
    variant:        t.variant ?? null,          // R2 — Phase-79 CMP groups by this without parsing task_id
    repeat:         t.repeat ?? null,           // R2 — cell repeat index
    terminal_state: t.terminal_state ?? null,   // R3/R4 — 'complete' | 'timeout' | 'abort' (D-04)
    skip_reason:    t.skip_reason ?? null,      // R3 — e.g. 'copilot-headless-unsupported' (D-08)
```
These flow in via the `tags` object `writeRun(store, { span, taskClass, pending, tags, ... })`
(signature at `run-write.mjs:51`). The runner passes them; `task_id` (the idempotency key,
`run-write.mjs:64-72,88-100`) already carries the composite `<expId>--<variant>--r<rep>` for
uniqueness. **Do NOT change** the UUIDv7 mint / re-close lookup logic — those are load-bearing
(Pitfall 1). Planner alternative (Research Q2): a runner-side post-close metadata patch instead of
editing the allow-list — decide one.

---

## Shared Patterns

### Fixed-argv, no-shell exec (CLAUDE.md constraint — applies to launch, kill, probe, test_command)
**Source:** `evidence-harness.mjs:249-252` (SHELL_META_RE guard) + `experiment-restore.mjs:97-105`
(`spawnSync` array form).
**Apply to:** every child-process call in the runner + adapter + probe.
```js
// evidence-harness.mjs:249-252 — reject shell metacharacters, then split to argv
if (SHELL_META_RE.test(cmd)) return null;          // no |, $(), ;, &, newline
const argv = cmd.split(/\s+/).filter(Boolean);
```
`SHELL_META_RE` is exported from `lib/experiments/evidence-harness.mjs` and already reused by
`measurement-start.mjs:49,101`. Import it if the runner validates any string command.

### process.stderr.write diagnostics (no-console-log)
**Source:** `run-write.mjs:218-222`, `query.mjs:113-116`, every `lib/experiments/*.mjs`.
**Apply to:** all runner/adapter/CLI diagnostics. NEVER `console.*` (and do not dodge with a
different raw-write API — CLAUDE.md constraint-dodging-forbidden).

### openExperimentStore + caller-owns-close (repo-global, single-owner)
**Source:** `store.mjs:40-54` (factory) + `measurement-stop.mjs:471-501` (try/finally close).
**Apply to:** the runner's resume-ledger read and any direct skip-Run write.
```js
const store = await openExperimentStore();   // repo-global .data/experiments — NOT the sandbox (D-10)
try { /* readRuns / writeRun */ } finally { await store.close(); }
```
Single-owner LevelDB (`store.mjs:29-31`) independently forces D-09 sequential execution — never
open two stores concurrently (Pitfall 5).

### Sandbox env binding (D-02, security V4)
**Source:** `restoreForCell` return `{ worktree, sandboxDataDir }` (`experiment-restore.mjs:190-192`);
`restore-snapshot.mjs:248` sets `sandboxDataDir = <worktree>/.data`.
**Apply to:** the agent spawn — `cwd = worktree`, `env.LLM_PROXY_DATA_DIR = sandboxDataDir`. All
file edits AND proxy token/route rows land in the isolated cell. `--dangerously-skip-permissions`/
`--allow-all-tools` are acceptable ONLY because the worktree is a throwaway sandbox.

---

## No Analog Found

| Concern | Role | Data Flow | Reason / Fallback |
|---------|------|-----------|-------------------|
| Foreground driven-agent timed kill | process supervisor | event-driven | No existing timed-kill of a *foreground driven agent* exists; the SIGTERM→SIGKILL escalation (`server-manager.js:162-167`, `service-starter.js:193-196`, `health-coordinator.js:1768`) is the template but is applied to daemons, not a driven child. Assemble from those + the async-`spawn` requirement (Research Unknown 5). |
| copilot+headless gate resolution | orchestration policy | — | No precedent; the `UNSUPPORTED_COMBINATIONS` gate (`experiment-spec.mjs:65-71`) was seeded to be resolved HERE. Planner decision (Research Q1) — use RESEARCH.md Unknown 2 recommendation. |

---

## Metadata

**Analog search scope:** `lib/experiments/`, `scripts/`, `lib/` (agent-detector/registry, vkb-server, service-starter), `tests/experiments/`.
**Files scanned (read):** `experiment-restore.mjs`, `run-write.mjs`, `query.mjs`, `evidence-harness.mjs`, `store.mjs`, `agent-detector.js`, `agent-registry.js`, `measurement-start.mjs`, `measurement-stop.mjs` (tag block), `server-manager.js` (kill block), `scripts/experiment-restore.mjs`, `tests/experiments/experiment-restore.test.mjs`.
**Pattern extraction date:** 2026-07-03
</content>
</invoke>
