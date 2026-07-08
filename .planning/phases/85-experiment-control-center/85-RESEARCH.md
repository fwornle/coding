# Phase 85: Experiment Control Center - Research

**Researched:** 2026-07-08
**Domain:** Detached process orchestration (host-side agent runner) + progress-file monitoring + dashboard control UI (Node.js / Express / React-Redux)
**Confidence:** HIGH (all claims verified against live code in this session; one external-knowledge area — Node detached spawn/kill — verified via WebSearch + official docs)

## Summary

Phase 85 wraps the already-shipped Phase-78 matrix runner (`lib/experiments/experiment-runner.mjs` `runMatrix` + `scripts/experiment-run.mjs` CLI) with three trigger APIs (`run` / `run-status` / `run-cancel`), a spec-list endpoint, a native `progress.json` emitter, and a launcher/monitor UI on the performance tab. Nearly every backend building block exists and is reused verbatim: the 409-guard pattern (`handleMeasurementStart`), the thin verbatim-serve read-API pattern (`handleReconciliation` / `handleContextTurns`), the transient open→operate→close store idiom, the SIGTERM→SIGKILL kill machinery, and `resolveExperimentSpec` for the matrix preview. The UI reuses the `measurement-control.tsx` polling-card pattern and the `performanceSlice.ts` thunk/selector conventions.

**The single most important finding — and it contradicts CONTEXT.md D-01's premise:** vkb-server on `:8080` runs **inside the coding-services Docker container** (supervisor-managed, published `8080:8080`, mounted at `/coding/lib/vkb-server`), **NOT host-side.** The container has only `node` — no `claude`/`opencode`/`copilot` CLIs. A detached `node scripts/experiment-run.mjs` spawned from the in-container vkb-server would make `resolveAgentBinary()` throw ENOENT and every cell would land `abort`. The runner MUST execute on the host, where the agent CLIs and the live proxy live. The established host-side execution seam reachable from the dashboard is the **health-coordinator (`:3034`)** with its `POST /health/remediate` dispatcher (host launchd daemon `com.coding.health-coordinator`), which the dashboard already proxies to for exactly this reason ("the coordinator runs natively on the host and can spawn host processes… that this container cannot reach"). This is a locked-decision-level architecture question the planner MUST resolve with the user before writing tasks (see Open Question 1 + Assumptions Log A1).

**Primary recommendation:** Land the three trigger endpoints + progress emitter as designed, but route the actual **detached spawn through a host-side executor** (extend the health-coordinator's remediation dispatcher with an experiment-run action, OR add a small host-side experiment-run endpoint to an existing host daemon), NOT through the containerized vkb-server. Keep `run-status` / spec-list / matrix-preview as thin reads on vkb-server (they only touch bind-mounted files + `resolveExperimentSpec`, which work fine in-container). Confirm the split with the user first.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Detached-run architecture**
- **D-01: vkb-server detached spawn.** `POST /api/experiments/run` makes vkb-server (host-side :8080 — the dashboard container already proxies `/api/experiments` to `host.docker.internal:8080`) spawn `node scripts/experiment-run.mjs` with `detached: true` + `unref()`, fixed-argv (no shell strings). Each run gets a run-dir holding pid + launch metadata. A vkb-server restart does NOT kill the run (orphan keeps running); status is recovered from the progress file + pid liveness. No new daemon, no launchd job queue.
  > ⚠️ **RESEARCH FLAG:** the "host-side :8080" premise is factually wrong — vkb-server is container-only (see Summary + Open Question 1). The *intent* (detached spawn, orphan-survives-restart, run-dir with pid, pid-liveness recovery, no queue) is sound and preserved; only the *host* of the spawn must change. Planner: confirm with user.
- **D-02: Strict 409 concurrency guard.** Launch refuses with 409 when the single measurement-span slot is contended — an interactive span is active (`active-measurement.json` exists) OR another experiment run is live. Response names the holder (task_id / running run_id). No force flag, no queueing. Mirrors the existing `handleMeasurementStart` 409 pattern.

**Progress contract**
- **D-03: Native progress emitter in runMatrix.** `lib/experiments/experiment-runner.mjs` gains a best-effort, never-throw progress writer that updates `progress.json` at every cell state transition (restoring → launching → running → scoring → terminal). Honors the never-block contract (Phase-84 D-02 lineage): progress write failure → stderr, never aborts a cell.
- **D-04: Full per-cell matrix granularity.** `progress.json` carries one entry per variant×repeat cell — state (`pending/restoring/running/scoring/complete/timeout/abort/skipped`), started/ended timestamps, composite task_id, skip/abort reason — plus a run-level header: spec name, `snapshot_id`, pid, done/total counts, overall state. `run-status` serves the file verbatim (house thin-read-API pattern, graceful-empty on ENOENT). No live agent-output tail.

**Re-run semantics**
- **D-05: New run identity — all cells re-execute.** A re-run mints a new `run_id` that salts the composite task_id (`task_hash` unchanged for comparability), so every cell executes fresh from the same `snapshot_id`. New Run records carry `rerun_of: <original run_id>`. D-10 idempotent resume (Phase 78) operates WITHIN a run identity — rerun ≠ resume.
- **D-06: Overridable params = CLI-narrowing set + per-variant model/agent.** Re-run accepts repeats, timeout, variant subset AND per-variant model/agent overrides.
- **D-07: Mutated variants get a derived, auto-suffixed name.** When a re-run overrides a variant's model/agent, the new Run's variant name records the change (e.g. `A` → `A@opus-4.8`), with the original preserved as `base_variant`.

**Cancel semantics**
- **D-08: Hard kill, abort recorded, resumable.** `run-cancel` SIGTERM→SIGKILLs the runner process group, reusing the Phase-78 D-04 timeout-kill machinery. The in-flight cell lands `abort`; remaining cells stay `pending`; overall state becomes `cancelled`. A cancelled run is resumable later via D-10 resume. No graceful finish-current-cell mode.

**Launcher UI scope**
- **D-09: Spec picker + overrides — the dashboard launches, never edits.** Lists existing `config/experiments/*.yaml` specs (small list API), shows the resolved matrix (variants × repeats = N cells) BEFORE launch, offers override fields (repeats, timeout, variant subset). No in-dashboard spec builder / YAML editor.
- **D-10: Monitoring panel = cell grid + header, 5s polling.** Straight render of progress.json: run header (spec, snapshot, overall state, done/total, elapsed, Cancel button) + a variant×repeat grid with per-cell state chips and abort/skip reasons. Completed cells link to the existing Runs table / timeline views. Follows the `measurement-control.tsx` 5s-polling pattern and `performanceSlice.ts` thunk+selector shape. No live log-tail streaming.
- **D-11: Re-run entry point lives on the finished run.** A Re-run button on a completed experiment's run header / runs-table row opens the launcher pre-filled (same spec + `snapshot_id`, `rerun_of` set) with the D-06 override fields. No base-run dropdown inside the launcher.

### Claude's Discretion
- run_id format, run-dir location/naming (suggested: under `.data/experiments/runs/<run_id>/`), and the exact salting scheme for the composite task_id (must not break `safeSanitizeTaskId` / slug length limits — Pitfall-1 truncation in `experiment-runner.mjs`).
- Exact progress.json field names, the API response envelope, and pid-liveness detection details (stale-pid → state `orphaned`/`unknown`).
- The spec-list endpoint shape and how resolved-matrix preview is computed (reuse `resolveExperimentSpec` server-side).
- How the derived variant suffix is rendered (`@model` vs another convention) as long as `base_variant` is preserved.
- Redux slice layout for launcher/monitor state (extend `performanceSlice` vs a new slice).

### Deferred Ideas (OUT OF SCOPE)
- **Difference viewer** (divergence-point trajectory diff) → Phase 86. Phase 85 only lays the data foundation (`rerun_of` pairing, `base_variant`, same-`task_hash` comparability).
- **Queueing launches when the span slot is busy** — rejected for D-02.
- **Live agent-output tail in the monitor** — rejected for D-04/D-10.
- **Graceful cancel-after-cell mode** — rejected for D-08.
- **In-dashboard spec builder/editor** — rejected for D-09.
- Variant-column comparison display + `experiment run` skill packaging → Phase 80.
- Success-gate / variance aggregation / ranked report → Phase 79.
- Avenue re-runs forked from interactive spans → Phase 87.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were mapped to this phase (Requirements: TBD in ROADMAP). The CONTEXT.md decisions D-01..D-11 are the authoritative acceptance surface. The planner should treat each D-0x as a testable behavior and derive REQ-equivalents from them.
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detached spawn of `experiment-run.mjs` | **Host process (launchd daemon)** | — | Runner launches real claude/opencode CLIs + reads live proxy span dir; the container has only `node` (VERIFIED). |
| `POST /api/experiments/run` trigger | Container API (vkb-server) → **host executor** | Health-coordinator `:3034` | The endpoint lands on vkb-server for URL consistency, but the actual spawn must be delegated host-side (like the dashboard→coordinator `/health/remediate` precedent). |
| 409 concurrency guard | Container API (vkb-server) | — | Reads bind-mounted `.data/active-measurement.json` + run-dir — works in-container. |
| `run-status` (progress.json read) | Container API (vkb-server) | — | Pure bind-mounted-file read (`.data/experiments/runs/<id>/progress.json`); thin verbatim serve. |
| Spec-list + matrix preview | Container API (vkb-server) | — | Reads `config/experiments/*.yaml` (bind-mounted) + `resolveExperimentSpec` (pure). |
| `run-cancel` (process-group kill) | **Host executor** | — | `process.kill(-pid)` must target a host pid; the container can't signal host processes. |
| progress.json emitter | Host process (runner) | — | Best-effort write inside `runMatrix` cell loop; source-of-truth is the running host process. |
| `rerun_of` / `base_variant` metadata | Host process (measurement-stop → run-write) | Container API (read via `readRuns`) | Written where Runs are written; read by the existing runs endpoint. |
| Launcher + monitor UI | Dashboard container (React/Redux) | — | Same-origin `/api/experiments/*` proxy; no host reach needed from the browser. |
| Dashboard→host reverse proxy | Dashboard `server.js` | — | Already proxies `/api/experiments` to `host.docker.internal:8080` (which is the container's own vkb). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `node:child_process` `spawn` | Node v25.8.1 (host) [VERIFIED: `node --version`] | Detached spawn (`detached: true` + `unref()`) of the runner; process-group kill via `process.kill(-pid, sig)` | Built-in; already the exact mechanism in `lib/vkb-server/server-manager.js:128-138` and `scripts/health-coordinator.js:1596` |
| Express (via `lib/vkb-server/api-routes.js`) | existing | Register the 3 trigger routes + spec-list | The `/api/experiments/*` routes all live here already |
| `@reduxjs/toolkit` `createAsyncThunk`/`createSlice`/`createSelector` | existing (`performanceSlice.ts`) | Launcher/monitor thunks + polling selectors | Every performance surface uses this; `measurement-control.tsx` is the exact polling template |
| React 18 + shadcn `Card`/`Button`/`Input`/`Badge` | existing | Launcher card + monitor grid | `measurement-control.tsx` / `runs-table.tsx` are the component templates |
| `js-yaml` | existing (used in `experiment-run.mjs`, `experiment-spec.mjs`) | Load specs for the list endpoint | Already the spec parser (`resolveExperimentSpec` uses `DEFAULT_SCHEMA`) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs` atomic write (write-tmp + `fs.rename`) | built-in | `progress.json` crash-safe updates | Every progress emit — avoids a reader seeing a half-written JSON (see Pitfall 3) |
| `resolveExperimentSpec` (`lib/experiments/experiment-spec.mjs`) | existing | Server-side matrix preview (`variants × repeats = N cells`) for D-09 | The spec-list + preview endpoint (reuse; do NOT re-parse axes by hand) |
| `readRuns` (`lib/experiments/query.mjs`) | existing | Detect a live run's Runs + resume done-set; surface `rerun_of` pairs | The 409 "another run is live" check + the D-11 re-run entry data |
| `process.kill(pid, 0)` liveness probe | built-in | pid-liveness for stale-pid detection (D-04 `orphaned`/`unknown`) | `run-status` when progress.json says "running" but the pid is gone — mirrors `server-manager.js:54` `isProcessRunning` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Delegate spawn to health-coordinator `:3034` | Add a brand-new host-side "experiment-run daemon" (launchd) | New daemon = more launchd surface + lifecycle; coordinator already has the remediation dispatcher + dashboard proxy path. But coordinator is health-focused — an experiment-run action is a domain stretch. **User decision needed (OQ1).** |
| `process.kill(-pid, 'SIGTERM')` process-group kill | `child.kill()` on a retained ChildProcess handle | The runner is detached + orphan-survives-restart (D-01), so after a vkb/coordinator restart there is NO live child handle — only a pid on disk. Must signal by pid (group). |
| Poll `progress.json` at 5s (D-10) | SSE stream from runner | D-10 explicitly rejects streaming; 5s poll matches `measurement-control.tsx`. |
| Extend `performanceSlice` | New `experimentRunSlice` | Discretion (D-slice). Launcher/monitor state is cohesive with runs; extending keeps `rerun_of` wiring local. Recommend **extend** to reuse `selectRuns` for the re-run pre-fill. |

**Installation:** No new packages. All mechanisms are Node built-ins or already-present project modules.

**Version verification:** Host Node is **v25.8.1** [VERIFIED: `node --version` on host]. `process.kill(-pid, signal)` process-group signalling is POSIX (macOS/Linux) and stable across all supported Node versions [CITED: nodejs.org/api/child_process.html]. No registry package to slop-check.

## Package Legitimacy Audit

> Not applicable — this phase installs **zero** external packages. All code uses Node.js built-ins (`node:child_process`, `node:fs`, `node:process`) and already-vendored project modules (`@reduxjs/toolkit`, `js-yaml`, `@fwornle/km-core` — all already in `package.json` / the dashboard). slopcheck run skipped: no install step.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌──────────────────────────────────────────────┐
  Browser           │  Dashboard container (React/Redux :3032)      │
  (Performance tab) │  ExperimentLauncher card + RunMonitor grid    │
        │           │  performanceSlice thunks (same-origin fetch)  │
        │  fetch    └───────────────┬──────────────────────────────┘
        ▼                           │ /api/experiments/*  (reverse proxy, server.js:346)
                                    ▼  host.docker.internal:8080
  ┌─────────────────────────────────────────────────────────────────┐
  │  coding-services CONTAINER  (supervisor)                          │
  │  ┌──────────────── vkb-server :8080 (api-routes.js) ───────────┐ │
  │  │ POST /api/experiments/run        ── 409 guard (D-02) ───────┐│ │
  │  │ GET  /api/experiments/run-status ── verbatim progress.json  ││ │
  │  │ POST /api/experiments/run-cancel                            ││ │
  │  │ GET  /api/experiments/specs      ── resolveExperimentSpec   ││ │
  │  └──────────────────────────┬─────────────────────────────────┘│ │
  │   reads bind-mounted .data/ + config/experiments/  (OK)         │ │
  │   ✗ CANNOT spawn host agent CLIs (only `node` present)          │ │
  └──────────────────────────────┼──────────────────────────────────┘
                                 │  delegate spawn/cancel  (HTTP)
                                 ▼  host.docker.internal:3034 (or new seam)
  ┌─────────────────────────────────────────────────────────────────┐
  │  HOST  (macOS, launchd)                                           │
  │  health-coordinator :3034  POST /health/remediate  (spawn seam)   │
  │        │ spawn('node',['scripts/experiment-run.mjs',...],          │
  │        ▼        { detached:true, cwd:repo }).unref()               │
  │  experiment-run.mjs ──► runMatrix (sequential cell loop)          │
  │        │  restoreForCell → span → launchCell(claude/opencode CLI) │
  │        │  progress emitter → .data/experiments/runs/<id>/progress.json (atomic)
  │        │  writeRun(rerun_of, base_variant) → experiment LevelDB    │
  │        ▼  run-dir: pid, launch-meta, progress.json                 │
  │  live rapid-llm-proxy :12435  (token attribution via span)        │
  └─────────────────────────────────────────────────────────────────┘
```

Data flow for the primary use case (launch): browser → dashboard proxy → vkb 409-guard → (delegate) host executor → detached `experiment-run.mjs` → progress.json on disk → vkb `run-status` verbatim read → 5s-poll monitor grid.

### Recommended Project Structure
```
lib/experiments/
├── experiment-runner.mjs      # ADD: progress emitter option threaded through runMatrix/runCell
├── run-progress.mjs           # NEW: atomic writeProgress(runDir, patch) + readProgress(runDir) (never-throw)
├── run-launch.mjs             # NEW (host): buildRunArgv + detached spawn + run-dir write (pid/meta)
├── run-write.mjs              # EDIT: thread rerun_of + base_variant tags into Run.metadata
└── experiment-spec.mjs        # REUSE: resolveExperimentSpec for the preview (no change)
scripts/
└── experiment-run.mjs         # EDIT: accept --run-id / --run-dir / --rerun-of / per-variant overrides; init progress.json
lib/vkb-server/
└── api-routes.js              # ADD: handleExperimentRun / handleRunStatus / handleRunCancel / handleSpecList
integrations/system-health-dashboard/
├── server.js                  # VERIFY: /api/experiments proxy already forwards new subpaths (it does — path passthrough)
└── src/
    ├── store/slices/performanceSlice.ts    # EXTEND: launcher/monitor thunks + selectors
    └── components/performance/
        ├── experiment-launcher.tsx         # NEW: spec picker + matrix preview + override fields (D-09)
        └── run-monitor.tsx                 # NEW: header + variant×repeat grid, 5s poll, Cancel (D-10)
```

### Pattern 1: 409 concurrency guard (copy from `handleMeasurementStart`)
**What:** Refuse launch when the single span slot is contended.
**When to use:** Top of `handleExperimentRun`, before any spawn.
**Example:**
```javascript
// Source: lib/vkb-server/api-routes.js:887-913 (handleMeasurementStart) — the exact template
async handleExperimentRun(req, res) {
  const activePath = path.join(this._dataDir(), 'active-measurement.json');
  try {
    await fs.access(activePath);
    const existing = JSON.parse(await fs.readFile(activePath, 'utf8'));
    return res.status(409).json({
      error: 'Measurement slot busy',
      message: `An interactive span is active (task_id=${existing.task_id}). Stop it first.`,
      holder: { kind: 'interactive', task_id: existing.task_id },
    });
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // ALSO: scan run-dirs for a live experiment run (progress.json overall==='running' && pid alive)
  //       → 409 { holder: { kind:'experiment', run_id, pid } }  (D-02 second contention source)
  // ... then delegate the detached spawn host-side.
}
```

### Pattern 2: Thin verbatim-serve read API (copy from `handleReconciliation` / `handleContextTurns`)
**What:** Serve `progress.json` byte-for-byte, graceful-empty on ENOENT.
**When to use:** `handleRunStatus`.
**Example:**
```javascript
// Source: lib/vkb-server/api-routes.js:610-638 (handleReconciliation) — verbatim-serve + graceful ENOENT
async handleRunStatus(req, res) {
  const { runId } = req.params;
  if (!this._validRunId(runId)) return res.status(400).json({ error: 'Invalid runId' });
  const filePath = path.join(this._dataDir(), 'experiments', 'runs', runId, 'progress.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return res.status(200).json(JSON.parse(raw));   // verbatim — no re-shaping (D-04)
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(200).json({ runId, overall: 'unknown', cells: [] });
    throw e;
  }
}
```
> Reuse the `_validTaskId` charset guard idiom (`api-routes.js:855` — `[A-Za-z0-9._-]`, ≤80, reject `.`/`..`) as `_validRunId` so a `../` in `:runId` can never escape `.data/experiments/runs/` (path-traversal defence — see Security Domain).

### Pattern 3: Detached spawn + orphan-survives-restart (copy from `server-manager.js` / `health-coordinator.js`)
**What:** Spawn the runner as a process-group leader that keeps running after the launcher restarts.
**When to use:** The host-side executor.
**Example:**
```javascript
// Source: lib/vkb-server/server-manager.js:128-138 + scripts/health-coordinator.js:1596-1600
//         + VERIFIED nodejs.org/api/child_process.html (detached → new process group; unref → parent independence)
const child = spawn(process.execPath,
  [path.join(repoRoot, 'scripts', 'experiment-run.mjs'),
   '--spec', specPath, '--run-id', runId, '--run-dir', runDir, ...overrideArgv],
  { cwd: repoRoot, detached: true, stdio: 'ignore', env: hostEnv });  // NEVER shell:true (fixed argv)
child.unref();
await fs.writeFile(path.join(runDir, 'run.json'),
  JSON.stringify({ run_id: runId, pid: child.pid, spec: specPath, started_at: new Date().toISOString() }, null, 2));
```

### Pattern 4: Process-group kill for cancel (D-08, reuse Phase-78 grace machinery)
**What:** SIGTERM→SIGKILL the whole runner tree by negated pid.
**Example:**
```javascript
// Source: launchCell SIGTERM→SIGKILL grace, experiment-runner.mjs:252-261 (5s grace)
//         + VERIFIED: detached child is its own group leader (pid == pgid), so process.kill(-pid) signals the group.
//         Killing by -pid (not pid) is REQUIRED — the runner's agent CLI children share the pgid and would
//         otherwise survive (nodejs #2098: "kill by pgid works, by pid works not" for detached trees).
function cancelRun(pid, graceMs = 5000) {
  try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, graceMs);
}
```
> The runner must catch SIGTERM and mark overall `cancelled` + the in-flight cell `abort` in progress.json BEFORE exiting (D-08), OR the canceller writes that terminal patch to progress.json after the kill (more robust — a hard SIGKILL leaves the runner no chance to write). Recommend: **canceller writes the `cancelled` patch** so the state is correct even on SIGKILL.

### Pattern 5: Progress emitter threaded through `runMatrix` (D-03, never-throw)
**What:** A best-effort `emitProgress(runDir, cellKey, state, extra)` called at each transition.
**Where:** Inside the `runMatrix` `for cell / for rep` loop (lines 522-557) and inside `runCell` at restore/span/launch/score boundaries.
**Example:**
```javascript
// Source: never-throw contract, experiment-runner.mjs progress emitter (Phase-84 D-02 lineage);
//         write pattern from run-write.mjs stderr-on-failure idiom.
async function emitProgress(runDir, patch) {
  if (!runDir) return;                       // no-op when not a controlled run (manual CLI still works)
  try { await writeProgress(runDir, patch); }  // atomic tmp+rename (Pitfall 3)
  catch (err) { process.stderr.write(`[experiment-runner] progress emit failed (non-fatal): ${err.message}\n`); }
}
```
> Thread an optional `runDir` (or `onProgress` callback) through `runMatrix(spec, opts)` and `runCell(...)`. Manual CLI runs pass none → emitter is a no-op → **zero behavior change for existing tests** (the fake-seam integration test must still pass unchanged).

### Anti-Patterns to Avoid
- **Spawning the runner from the containerized vkb-server.** It will `abort` every cell (no agent CLIs). This is the whole reason for the host-executor split.
- **`shell: true` / template-string argv.** Forbidden by CLAUDE.md + T-78-03-01. Use fixed-argv arrays for both the spawn and the kill path.
- **Killing by `pid` instead of `-pid`.** The agent CLI children survive; the "cancel" leaves zombies burning tokens (nodejs #2098).
- **Non-atomic progress.json writes.** A 5s poller can read a truncated file mid-write → `JSON.parse` throw. Always tmp+rename.
- **Salting the composite task_id in a way that breaks slug length.** `composeTaskId` slugifies `/`→`-`; a long `run_id` prefix can push the persisted filesystem key past limits and re-break D-10 resume (Pitfall-1). Keep the salt short + path-safe.
- **Coercing `rerun_of`/`base_variant` to `''`.** Follow the null-not-zero house idiom (`?? null`); a non-rerun Run carries `rerun_of: null`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Matrix orchestration | A new run loop | `runMatrix` (`experiment-runner.mjs`) + a `runDir`/progress option | The sequential idempotent resumable loop, kill machinery, terminal states all exist |
| Matrix preview (N cells) | Manual axes cartesian in the endpoint | `resolveExperimentSpec(specObj)` → `.cells.length × .repeats` | Same resolver the runner uses; guarantees preview == actual run |
| 409 guard | New contention logic | Copy `handleMeasurementStart` | Same `active-measurement.json` check + holder response shape |
| progress.json read API | New serializer | Copy `handleReconciliation` verbatim-serve | Thin file read + graceful ENOENT already proven |
| SIGTERM→SIGKILL grace | New timer dance | Reuse `launchCell` 5s-grace pattern with `process.kill(-pid, …)` | Identical escalation; only the target changes to a pid group |
| pid liveness | New probe | `process.kill(pid, 0)` (from `server-manager.js:54`) | Standard POSIX liveness; throws ESRCH when dead |
| Run store access from endpoints | Inline `new GraphKMStore` | `openExperimentStore()` + transient open→op→close-in-finally | CLAUDE.md km-core ontologyDir rule; single-owner LevelDB |
| Dashboard→host reach | Container-side spawn | Existing host-daemon HTTP seam (coordinator `/health/remediate` precedent) | The container physically cannot spawn host agents |
| Redux polling card | New polling infra | `measurement-control.tsx` `useEffect` + `setInterval(5000)` template | Exact D-10 pattern already shipped |

**Key insight:** This phase is ~90% wiring existing, battle-tested parts. The only genuinely net-new mechanisms are (a) the host-executor delegation seam, (b) the atomic progress.json emitter, and (c) `rerun_of`/`base_variant` metadata plumbing. Everything else is copy-a-template.

## Runtime State Inventory

> This phase is additive (new endpoints, new progress files, new Run metadata) — not a rename/refactor. But it introduces new persistent runtime state, inventoried here for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | NEW: `.data/experiments/runs/<run_id>/{run.json,progress.json}` per run. NEW Run.metadata keys `rerun_of` / `base_variant` in the experiment LevelDB (`.data/experiments/leveldb` + debounced export `.data/experiments/exports/experiment.json`). | Add run-dir writer; extend `run-write.mjs` metadata (null-preserved). No migration of existing Runs (they get `rerun_of: null` on next read via `?? null`). |
| Live service config | vkb-server routes (in-container, bind-mounted `lib/vkb-server` — NO docker rebuild, but VirtioFS cache: a **full `docker-compose restart coding-services`** is required for `server.js` proxy edits; supervisor-only restart re-reads stale cache — CLAUDE.md). Host-executor endpoint on whichever host daemon is chosen. | Restart coding-services after `server.js` change; restart the host daemon after its code change. |
| OS-registered state | If a NEW host daemon is chosen for the executor: a new `com.coding.*` launchd plist. If the coordinator is extended: none (already `com.coding.health-coordinator`). | Prefer extending an existing daemon → **no new launchd job** (aligns with D-01 "no new daemon"). |
| Secrets/env vars | Runner needs host env `CODING_REPO`, `LLM_PROXY_DATA_DIR`, `LLM_PROXY_PORT`, `CODING_PROXY_ROUTE` (contract in `experiment-run.mjs:26-37`). The host executor must pass these through to the detached child. | Executor builds `hostEnv` from the daemon's own environment (which already has them). |
| Build artifacts | Dashboard UI bundle (`integrations/system-health-dashboard/dist/`) must be rebuilt after the new components (`npm run build` + restart frontend — CLAUDE.md dashboard recipe). | Rebuild + `supervisorctl restart web-services:health-dashboard-frontend`. |

**Nothing found for a rename category** — verified: no string is being renamed; this is net-new surface only.

## Common Pitfalls

### Pitfall 1: Composite task_id slug truncation (inherited from Phase-78)
**What goes wrong:** `composeTaskId(expId, cell, rep)` builds a filesystem key (`${expId}--${slug}--r${rep}`); the `run_id` salt (D-05) lengthens `expId`. opencode models carry `provider/model` slashes already slugified to `-`. A long salted prefix can exceed path-key limits and re-break D-10 idempotent resume (the persisted key truncates, the done-set never matches).
**Why it happens:** The task_id doubles as `measurements/<task_id>/` dir name and the resume ledger key.
**How to avoid:** Keep the salt short + path-safe (e.g. a 6-8 char run suffix). Add an acceptance test asserting `composeTaskId` output stays ≤ the archive-path limit and round-trips through the resume done-set. `task_hash` stays constant across the salt (comparability — D-05).
**Warning signs:** A re-run re-executes cells that "should" resume, OR two different runs collide on one `measurements/` dir.

### Pitfall 2: Cancel kills only the wrapper, agent CLI survives
**What goes wrong:** `process.kill(pid, 'SIGKILL')` (positive pid) kills `experiment-run.mjs` but the spawned claude/opencode child keeps running (burning tokens, holding the span).
**Why it happens:** The agent is a grandchild in the same process group; only the group-leader pid is signalled.
**How to avoid:** Kill the **group**: `process.kill(-pid, sig)` (negated). The runner is `detached: true` → group leader → `pid == pgid` [VERIFIED: nodejs.org docs + nodejs #2098].
**Warning signs:** `active-measurement.json` never clears after cancel; a zombie agent still logs to the proxy.

### Pitfall 3: Torn progress.json read under the 5s poll
**What goes wrong:** The monitor polls every 5s; if the emitter writes in place, a poll can hit a half-flushed file → `JSON.parse` error → monitor blanks.
**Why it happens:** `fs.writeFile` is not atomic across a reader.
**How to avoid:** Write to `progress.json.tmp` then `fs.rename` (atomic on same filesystem). The verbatim-serve reader also gets graceful-ENOENT for free.
**Warning signs:** Intermittent monitor errors that self-heal on the next poll.

### Pitfall 4: The container-spawn dead end (the big one)
**What goes wrong:** Implementing D-01 literally — spawning from the in-container vkb-server — every cell `abort`s because `resolveAgentBinary('claude', …)` throws ENOENT (no CLI in the container).
**Why it happens:** CONTEXT.md D-01 states "host-side :8080" but vkb-server is container-only [VERIFIED: `8080:8080` publish + supervisor `web-services:vkb-server` + container has only `node`].
**How to avoid:** Delegate the spawn to a host-side executor (coordinator precedent). Resolve the seam with the user (OQ1) BEFORE writing spawn tasks.
**Warning signs:** Every experiment run completes "instantly" with all-abort Runs; runner stderr shows `spawn claude ENOENT`.

### Pitfall 5: VirtioFS stale-cache on server.js proxy edits
**What goes wrong:** Editing the dashboard `server.js` `/api/experiments` proxy (if a passthrough tweak is needed) and doing only `supervisorctl restart` → the container serves the STALE cached file; new subpaths 404.
**Why it happens:** Docker Desktop VirtioFS caches bind-mounted files; supervisor restart re-reads the cache.
**How to avoid:** Full `cd docker && docker-compose restart coding-services` after any `server.js` edit (CLAUDE.md). NOTE: the existing proxy at `server.js:346` uses `req.path` passthrough for ALL `/api/experiments/*` subpaths, so `run`/`run-status`/`run-cancel`/`specs` likely ride it **for free** — verify, don't assume an edit is needed.
**Warning signs:** Dashboard 502/404 on the new endpoints while `curl host:8080/api/experiments/...` works.

### Pitfall 6: Single-owner LevelDB contention during a live run
**What goes wrong:** The 409 "another run is live" check or `run-status` opens the experiment store while the runner's per-cell `measurement-stop` also opens it → single-owner LevelDB lock contention.
**Why it happens:** `openExperimentStore` is single-owner; `runMatrix` opens it only briefly (build done-set, then closes before launching — lines 501-510), but per-cell `measurement-stop` reopens it.
**How to avoid:** Do the 409 "live run" check from **progress.json + pid liveness** (file reads), NOT by opening the store. Keep `run-status` a pure file read (D-04 already mandates verbatim progress.json). Only `readRuns`-based reads (the runs table, re-run pre-fill) touch the store, and those are transient.
**Warning signs:** `LevelDB … lock` errors during an active run; a hung `run-status`.

## Code Examples

### Reuse resolveExperimentSpec for the matrix preview (D-09)
```javascript
// Source: lib/experiments/experiment-spec.mjs:211-267 (resolveExperimentSpec) + experiment-run.mjs:132-147
// Spec-list + preview endpoint: list config/experiments/*.yaml, resolve each for N.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { resolveExperimentSpec } from '../experiments/experiment-spec.mjs';

async function handleSpecList(req, res) {
  const dir = path.join(this._repoRoot(), 'config', 'experiments');
  const files = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.yaml'));
  const specs = [];
  for (const f of files) {
    try {
      const obj = yaml.load(await fs.promises.readFile(path.join(dir, f), 'utf8'));
      const { cells, repeats, goal_sentence } = resolveExperimentSpec(obj);
      specs.push({
        file: f, goal_sentence, repeats,
        variantCount: cells.length, cellCount: cells.length * repeats,
        snapshot_id: obj.snapshot_id ?? null,
        variants: cells.map((c) => `${c.agent}-${c.model}-${c.framework}-${c.env}`),
      });
    } catch (e) {
      specs.push({ file: f, error: e.message });   // a malformed spec is listed, not fatal
    }
  }
  return res.status(200).json({ specs });
}
```

### Redux monitor thunk + 5s poll (D-10, mirror fetchActiveMeasurement)
```typescript
// Source: performanceSlice.ts:608-622 (fetchActiveMeasurement) + measurement-control.tsx:35-39 (5s poll)
export const fetchRunStatus = createAsyncThunk<RunProgress | null, string, { rejectValue: string }>(
  'performance/fetchRunStatus',
  async (runId, { rejectWithValue }) => {
    try {
      const r = await fetch(`/api/experiments/run-status/${encodeURIComponent(runId)}`)
      if (!r.ok) throw new Error(`API returned ${r.status}`)
      return (await r.json()) as RunProgress
    } catch (e) { return rejectWithValue(e instanceof Error ? e.message : 'Unknown error') }
  }
)
// In run-monitor.tsx:
useEffect(() => {
  if (!activeRunId) return
  dispatch(fetchRunStatus(activeRunId))
  const t = setInterval(() => dispatch(fetchRunStatus(activeRunId)), 5000)
  return () => clearInterval(t)
}, [dispatch, activeRunId])
```

### rerun_of / base_variant on the Run (D-05/D-07, null-preserved)
```javascript
// Source: run-write.mjs:122-129 (variant/repeat/terminal_state/skip_reason tags, null-preserved idiom)
// Extend the tags object threaded into writeRun's metadata:
metadata: {
  // ... existing 8 tags + variant/repeat/terminal_state ...
  rerun_of:     t.rerun_of ?? null,      // <original run_id> or null for a first run
  base_variant: t.base_variant ?? null,  // original variant name when model/agent overridden (D-07)
}
// The composeTaskId salt carries run_id; task_hash stays constant (comparability, D-05).
// measurement-start.mjs must accept + thread --rerun-of / --base-variant like it does --variant/--repeat.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dashboard MVP measurement was CLI-triggered; `handleMeasurementStop` returns a *command string* for the human to run host-side (no spawn) | This phase adds the FIRST dashboard-triggered host **spawn** for experiments | Phase 85 | D-01 deliberately breaks the "no-spawn" precedent — but must do it host-side, not in-container |
| Container reaches host services only for **reads/proxies** (`:12435` proxy, `:8080` vkb, `:12436` obs-api) | Container must trigger a host **process spawn** — the coordinator `/health/remediate` precedent (`server.js:884-914`) is the only existing pattern | Phase 85 | Reuse the coordinator delegation shape, don't invent a raw exec-in-container |

**Deprecated/outdated:**
- The CONTEXT.md D-01 phrase "vkb-server (host-side :8080)" — **factually stale**; vkb-server is container-only. The decision's intent survives; its host attribution does not.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The host-side executor should be the **health-coordinator** (`:3034` `/health/remediate`), extended with an experiment-run action, rather than a new launchd daemon. | Architecture / OQ1 | HIGH — wrong seam means either a domain-inappropriate coordinator overload or an unplanned new daemon. **User must decide.** |
| A2 | The existing dashboard `/api/experiments` proxy (`server.js:346`) forwards new subpaths (`run`, `run-status`, `run-cancel`, `specs`) with no edit, via `req.path` passthrough. | Pitfall 5 | LOW — if a body/method tweak is needed, it's a small `server.js` edit + full container restart. Verify with a curl before assuming. |
| A3 | `process.kill(-pid, 'SIGKILL')` on the detached runner group reliably reaps the agent CLI grandchildren on macOS. | Pattern 4 / Pitfall 2 | MEDIUM — VERIFIED for standard detached trees, but an agent CLI that re-`setsid`s or double-forks could escape the group. Live-cancel test required. |
| A4 | Re-run with per-variant model/agent overrides (D-06) produces a **new snapshot-identical** run — i.e. the same `snapshot_id` restore path still applies when the model changes. | Re-run semantics | LOW — snapshot is code/data state, independent of model; `restoreForCell(snapshotId)` doesn't care about the cell's model. Confirmed by reading `runCell` (model only affects agent launch, not restore). |
| A5 | No requirement IDs exist for this phase, so D-01..D-11 are the acceptance surface. | phase_requirements | LOW — if REQUIREMENTS.md gains v-block IDs later, map them then. |

## Open Questions (RESOLVED)

1. **Where does the detached runner actually spawn?** (BLOCKING for planning the spawn tasks)
   **RESOLVED 2026-07-08:** User locked option (a) — extend health-coordinator :3034 (CONTEXT.md D-01 AMENDED); implemented in Plan 85-03.
   - What we know: vkb-server is container-only; the container has no agent CLIs; the runner needs host CLIs + live proxy. The dashboard→coordinator `/health/remediate` is the sole existing dashboard-triggered host-spawn pattern.
   - What's unclear: (a) extend health-coordinator with an `experiment_run` remediation action, (b) add a tiny experiment-run HTTP endpoint to another host daemon (obs-api :12436?), or (c) a new `com.coding.experiment-runner` launchd daemon (contradicts D-01 "no new daemon").
   - Recommendation: **(a) extend the coordinator** — reuses the proxy path, honors "no new daemon", minimal surface. Flag to the user in discuss/plan; do not lock without confirmation (A1).

2. **run-cancel target when the launcher daemon has restarted.** After a coordinator/vkb restart, there is no live child handle — only the pid in `run.json`. `run-cancel` must read `run.json.pid` and `process.kill(-pid, …)`. Confirm the pid is the group leader's pid (it is, given `detached:true`) and that a reused-pid guard exists (check the pid's process still looks like the runner before killing — e.g. compare start time, or accept the small reuse risk as the Phase-78/coordinator patterns do).
   **RESOLVED:** pid-reuse sanity guard specified in Plan 85-02 Task 2 (`run-launch.mjs` cancel + liveness cases).

3. **Does `active-measurement.json` reliably clear on cancel?** A hard SIGKILL bypasses the runner's per-cell `measurement-stop finally`. The canceller (or a `run-status` reconciler) may need to clear a stale `active-measurement.json` whose task_id belongs to the cancelled run, so the 409 slot frees. Recommend the canceller writes both the progress `cancelled` patch AND clears the span file it owns.
   **RESOLVED:** canceller writes the `cancelled` progress patch AND clears the stale span file — Plan 85-03 Tasks 1/2.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Host `node` | Detached runner + host executor | ✓ | v25.8.1 | — |
| Host `claude` CLI | claude cells (D-12 required agent) | ✓ (host) | — | run subset / opencode-only |
| Host `opencode` CLI | opencode cells (D-12 required agent) | ✓ (host, `com.coding.sub-agent-live-opencode`) | — | — |
| `copilot` CLI | copilot cells (probe-gated, D-08) | ✓ (host, `com.coding.sub-agent-live-copilot`) | — | recorded skip-Run (existing) |
| rapid-llm-proxy `:12435` | token attribution (span task_id) | ✓ (host, `com.coding.llm-cli-proxy`) | — | fail-soft: cell runs unrouted (unmeasured) — existing behavior |
| health-coordinator `:3034` | proposed host-executor seam (A1) | ✓ (host, `com.coding.health-coordinator`) | — | new daemon (contradicts D-01) |
| vkb-server `:8080` | trigger + read endpoints | ✓ (**container**, supervisor `web-services:vkb-server`) | — | — |
| container agent CLIs | — | ✗ (only `node`) | — | **THIS is why spawn must be host-side** |

**Missing dependencies with no fallback:** None — but the **container cannot spawn host agents**, which is an architecture constraint, not a missing tool. Resolve via OQ1.

**Missing dependencies with fallback:** copilot headless (recorded skip-Run, existing D-08 path); proxy down (unrouted/unmeasured cell, existing fail-soft).

## Validation Architecture

> nyquist_validation is not set to false in config.json (key absent → enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in test runner (`node:test` + `node:assert/strict`) for `tests/experiments/*.test.mjs`; Jest for the broader `package.json` `test` script |
| Config file | none for experiment tests (they run via `node --test tests/experiments/`) |
| Quick run command | `node --test tests/experiments/experiment-runner.test.mjs` |
| Full suite command | `node --test tests/experiments/` |

> Existing experiment tests use `node:test` + `Object.create(ApiRoutes.prototype)` handler-isolation with an injected `experimentRepoRoot` (see `tests/experiments/runs-endpoint.test.mjs:29-31`). The seed fixture is `tests/experiments/_fixtures/seed-experiment-store.mjs`. New endpoint tests MUST follow this idiom.

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| D-02 | Launch returns 409 when a span is active OR a run is live; names holder | unit | `node --test tests/experiments/run-endpoint.test.mjs` | ❌ Wave 0 |
| D-03/D-04 | progress.json written at each transition; full per-cell granularity; verbatim served | unit | `node --test tests/experiments/run-progress.test.mjs` | ❌ Wave 0 |
| D-04 | run-status graceful-empty on ENOENT; path-traversal rejected | unit | `node --test tests/experiments/run-status-endpoint.test.mjs` | ❌ Wave 0 |
| D-05/D-07 | rerun_of + base_variant land on Run.metadata; task_hash constant; salted task_id path-safe | unit | `node --test tests/experiments/run-write.test.mjs` (extend) | ⚠️ extend existing |
| D-08 | cancel SIGTERM→SIGKILLs the **group**; in-flight cell `abort`, rest `pending`, overall `cancelled` | integration | `node --test tests/experiments/run-cancel.test.mjs` (inject `spawn`/`kill` seams) | ❌ Wave 0 |
| D-09 | spec-list resolves N cells via resolveExperimentSpec; malformed spec listed not fatal | unit | `node --test tests/experiments/spec-list-endpoint.test.mjs` | ❌ Wave 0 |
| progress emitter | manual CLI run (no runDir) → emitter no-ops, existing integration test unchanged | integration | `node --test tests/experiments/experiment-runner.integration.test.mjs` | ✅ (must stay green) |
| D-09/D-10/D-11 | launcher preview, monitor grid, Re-run pre-fill render | e2e | `npx playwright test tests/e2e/performance/experiment-control.spec.ts` (gsd-browser :3032) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test <the touched experiment test file>`
- **Per wave merge:** `node --test tests/experiments/`
- **Phase gate:** full experiment suite green + a live `gsd-browser` :3032 launch→monitor→cancel click-through (CLAUDE.md: never claim UI works from DB queries — feedback_e2e_verify).

### Wave 0 Gaps
- [ ] `tests/experiments/run-endpoint.test.mjs` — 409 guard + delegate-spawn (mock the host-executor fetch/spawn seam)
- [ ] `tests/experiments/run-progress.test.mjs` — atomic write + never-throw emitter
- [ ] `tests/experiments/run-status-endpoint.test.mjs` — verbatim serve + ENOENT + traversal guard
- [ ] `tests/experiments/run-cancel.test.mjs` — `process.kill(-pid)` group kill, injected seam
- [ ] `tests/experiments/spec-list-endpoint.test.mjs` — resolveExperimentSpec preview
- [ ] extend `tests/experiments/run-write.test.mjs` — rerun_of / base_variant tags
- [ ] `tests/e2e/performance/experiment-control.spec.ts` — launcher + monitor + Re-run (Playwright, `tests/e2e/<area>/` per CLAUDE.md)

## Security Domain

> security_enforcement not set to false in config (absent → enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Localhost dashboard/vkb; no auth layer in scope (accepted, matches existing endpoints) |
| V3 Session Management | no | Stateless file/HTTP triggers |
| V4 Access Control | partial | Host-executor endpoint should be loopback-gated (the coordinator already gates `/test/*` to loopback; `/health/remediate` is reachable from the container via host-gateway — a NON-loopback caller — so an experiment-run action must accept the container origin but reject arbitrary external callers) |
| V5 Input Validation | **yes** | `runId`/`taskId` charset guard (`_validTaskId` idiom, `[A-Za-z0-9._-]`, ≤80, reject `.`/`..`); spec file name restricted to `config/experiments/*.yaml` (no path from client); override fields validated (repeats positive int, timeout positive int, variant ∈ resolved names) exactly like `experiment-run.mjs:107-125` |
| V6 Cryptography | no | No crypto beyond the existing `run_id`/task_id hashing (`createHash` already used) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via spec path / overrides | Tampering | **Fixed-argv spawn only** (no `shell:true`, no string interpolation) — T-78-03-01; spec path resolved from the server-listed `config/experiments/` set, never a raw client path |
| Path traversal in `run-status/:runId` or spec name | Tampering / Info disclosure | `_validRunId` charset+`..` guard BEFORE path build (copy `_validTaskId`, `api-routes.js:855`); read confined to `.data/experiments/runs/` |
| Signal to a reused pid (cancel wrong process) | DoS | Verify the pid still looks like the runner (start-time / cmdline compare) before `kill`; accept residual small reuse risk (same as server-manager/coordinator) |
| Unbounded concurrent runs exhausting the host | DoS | D-02 strict 409 single-slot guard — only one run/span ever live |
| Detached agent escapes cancel (double-fork) | DoS | Process-**group** kill (`-pid`); live-cancel verification (A3) |
| Non-loopback caller triggers arbitrary runs | Elevation of Privilege | Host-executor endpoint accepts only the container/host-gateway origin, mirrors coordinator loopback gate; no external exposure (port not published beyond localhost) |

## Sources

### Primary (HIGH confidence)
- Live codebase (this session, all VERIFIED):
  - `scripts/experiment-run.mjs` — CLI flags, env contract, EXPERIMENT_RUN_FAKE seam, UNATTENDED caveat
  - `lib/experiments/experiment-runner.mjs` — `runMatrix`/`runCell`/`launchCell`, `composeTaskId` slug truncation, SIGTERM→SIGKILL grace (252-261), terminal states, D-10 done-set
  - `lib/experiments/experiment-spec.mjs` — `resolveExperimentSpec`/`validateCells`/`expandAxes`
  - `lib/experiments/run-write.mjs` — Run.metadata shape + null-preserved tag idiom (write site for rerun_of/base_variant)
  - `lib/experiments/query.mjs` — `readRuns` join + D-06 pending filter
  - `lib/experiments/store.mjs` — `openExperimentStore` single-owner + dbPath `.data/experiments/leveldb`
  - `lib/vkb-server/api-routes.js` — 409 guard (887-913), verbatim-serve (610-706), `_validTaskId` (855), transient store idiom
  - `lib/vkb-server/server-manager.js` — detached spawn (128-138), `isProcessRunning` (54)
  - `scripts/health-coordinator.js` — `/health/remediate` host-spawn dispatcher (2577-2592), detached ETM spawn (1596)
  - `integrations/system-health-dashboard/server.js` — `/api/experiments` proxy (346-363), coordinator delegation (884-914), CGR detached spawn (3472-3477), `existsSync('/.dockerenv')` container detection (919)
  - `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — thunk/selector/polling conventions
  - `integrations/system-health-dashboard/src/components/performance/measurement-control.tsx` — 5s-poll card template
  - `docker/docker-compose.yml` — `8080:8080` publish, `supervisorctl web-services:vkb-server`, `host.docker.internal` wiring (container-only vkb proof)
  - `launchctl list` (host) — `com.coding.{health-coordinator,llm-cli-proxy,sub-agent-live-*}`, NO `com.coding.vkb-server`
  - `docker exec coding-services which claude opencode node` → only `node` (container has no agent CLIs)
  - `.planning/phases/78-experiment-.../78-CONTEXT.md` (D-04/D-06/D-09/D-10/D-12), `.../77-.../77-CONTEXT.md` (restore/snapshot)
- [nodejs.org/api/child_process.html](https://nodejs.org/api/child_process.html) — `detached` → new process group, `unref()` → parent independence, `kill`/`killSignal` semantics [CITED]

### Secondary (MEDIUM confidence)
- [Medium — Killing process families with node](https://medium.com/@almenon214/killing-processes-with-node-772ffdd19aad) — `process.kill(-child.pid)` group-kill technique (cross-checked against official docs)
- [nodejs/node#2098](https://github.com/nodejs/node/issues/2098) — detached child: kill by pgid works, by pid does not (confirms Pitfall 2)

### Tertiary (LOW confidence)
- None — all critical claims cross-verified against live code or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all mechanisms are Node built-ins / already-present modules, versions verified on host
- Architecture: HIGH — container-vs-host boundary directly verified (`docker exec`, `launchctl`, docker-compose); the one open decision (executor seam) is flagged, not guessed
- Pitfalls: HIGH — each pitfall traced to a specific verified code line or an official-docs/issue-confirmed behavior
- Re-run/progress/cancel semantics: HIGH for the write sites (read from source); MEDIUM for live cancel group-reap on macOS (A3 — needs a live test)

**Research date:** 2026-07-08
**Valid until:** 2026-08-07 (30 days — stable internal codebase; re-verify only if the container/host topology or vkb-server hosting changes)
