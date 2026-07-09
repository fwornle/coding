---
phase: 85-experiment-control-center
reviewed: 2026-07-09T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - config/experiments/compare-fizzbuzz.yaml
  - docker/docker-compose.yml
  - integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx
  - integrations/system-health-dashboard/src/components/performance/run-monitor.tsx
  - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
  - integrations/system-health-dashboard/src/components/performance/timeline.tsx
  - integrations/system-health-dashboard/src/pages/performance.tsx
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
  - lib/experiments/agent-headless.mjs
  - lib/experiments/experiment-executor.mjs
  - lib/experiments/experiment-runner.mjs
  - lib/experiments/run-launch.mjs
  - lib/experiments/run-progress.mjs
  - lib/experiments/run-write.mjs
  - lib/vkb-server/api-routes.js
  - scripts/experiment-run.mjs
  - scripts/health-coordinator.js
  - scripts/health-remediation-actions.js
  - scripts/measurement-start.mjs
  - scripts/measurement-stop.mjs
  - tests/e2e/performance/experiment-control.spec.ts
  - tests/experiments/experiment-executor.test.mjs
  - tests/experiments/measurement-start-variant.test.mjs
  - tests/experiments/measurement-stop-tags.test.mjs
  - tests/experiments/run-endpoint.test.mjs
  - tests/experiments/run-launch.test.mjs
  - tests/experiments/run-progress.test.mjs
  - tests/experiments/run-status-endpoint.test.mjs
  - tests/experiments/run-write.test.mjs
  - tests/experiments/spec-list-endpoint.test.mjs
  - tests/experiments/variant-override.test.mjs
findings:
  critical: 3
  warning: 6
  info: 4
  total: 13
status: issues_found
---

# Phase 85: Code Review Report

**Reviewed:** 2026-07-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

Phase 85 wires an Experiment Control Center: a dashboard launcher/monitor/cancel, a
container-side vkb-server API layer, and a host-side coordinator (:3034) that performs the
actual detached spawn / process-group cancel. The container-side API layer (`api-routes.js`)
is carefully hardened — run_id/spec/override validation, path-traversal guards, the D-02
dual-source 409 slot guard. The problem is that **none of that validation is re-applied at
the coordinator, which is the real trust boundary.** The coordinator binds `0.0.0.0`, gates
only on a broad RFC1918 origin check, and forwards `run_id` / `run_dir` / `pid` straight into
filesystem and `process.kill` sinks with no sanitization. Any process on the Docker private
network — not just the one intended vkb container — can reach it and drive an arbitrary
process-group kill and out-of-tree file writes/deletes.

Beyond the security seam, two dashboard→runner contract mismatches silently break advertised
features: the `timeout` override is sent in the wrong unit (ms vs seconds, a 1000× error), and
`rerun_of` is dropped entirely between the launcher and the runner argv, so D-05 re-run
provenance never lands.

## Critical Issues

### CR-01: Coordinator experiment endpoints do not validate `run_id`/`run_dir` — path traversal + out-of-tree write/delete on the host

**File:** `scripts/health-coordinator.js:2652-2700`, `lib/experiments/experiment-executor.mjs:56-63,129,255,293`

**Issue:** The container `handleExperimentRun`/`handleRunCancel` mint a charset-safe `run_id`
(`_validRunId`, ≤12 `[A-Za-z0-9._-]`) and build a fixed `.data/experiments/runs/<run_id>` seam
path. But the coordinator's `POST /experiments/run` and `POST /experiments/cancel` accept
`run_id` and `run_dir` from the request body with **no validation at all** and pass them to
`runExperiment`/`cancelExperiment`. The executor's `resolveRunDir` does
`path.resolve(REPO_ROOT, run_dir)` with no containment check, so a `run_dir` of
`../../../../tmp/pwn` (or any absolute path) resolves outside the repo. `launchRun` then
`fs.mkdir(runDir, {recursive:true})` and writes `run.json`/`runner.log` there; `cancelExperiment`
writes the terminal `progress.json` patch there. On cancel, `dataDir` defaults to
`path.resolve(hostRunDir, '..','..','..')` (executor line 293), so a crafted `run_dir` also
steers the OQ3 `active-measurement.json` `unlink` to an attacker-chosen directory. The origin
gate (`isExperimentOriginAllowed`) accepts *any* 10/8, 172.16-31/12, or 192.168/16 address —
every container on the Docker bridge, not just the vkb-server — so this is reachable by any
co-resident container.

**Fix:** Validate on the coordinator side before touching the filesystem — mirror the
container's `_validRunId`, and require `run_dir` to be a repo-relative path that stays under
`.data/experiments/runs/` after resolution:

```js
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,12}$/;
function resolveRunDirSafe(runDir) {
  const abs = path.resolve(REPO_ROOT, runDir);
  const root = path.resolve(REPO_ROOT, '.data', 'experiments', 'runs');
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`run_dir escapes ${root}: ${runDir}`);
  }
  return abs;
}
// in /experiments/run + /experiments/cancel handlers:
if (!RUN_ID_RE.test(run_id ?? '')) return res.status(400).json({ ok:false, error:'invalid run_id' });
```

Apply the same guard inside `experiment-executor.resolveRunDir` (defense-in-depth) since it is
also invoked from `health-remediation-actions.experimentRun/experimentCancel` via `/health/remediate`.

### CR-02: Coordinator `/experiments/cancel` group-kills an attacker-supplied `pid` with no ownership check — arbitrary process-group termination

**File:** `scripts/health-coordinator.js:2683-2700`, `lib/experiments/experiment-executor.mjs:238-265`, `lib/experiments/run-launch.mjs:246-286`

**Issue:** `cancelExperiment` forwards the request-body `pid` directly into `cancelRun({pid})`,
which does `process.kill(-pid, 'SIGTERM')` then `SIGKILL` — a **process-group** kill of the
negated pid. `cancelRun` accepts an optional `pidLooksLikeRunner` reuse guard, but
`cancelExperiment` never supplies one, so the only gate is `isRunAlive(pid)` (a bare signal-0
liveness probe). Combined with the broad RFC1918 origin gate (CR-01), any container on the
Docker network can POST `{ run_dir: '.data/experiments/runs/x', pid: <any> }` and the host
coordinator will `kill(-pid, SIGKILL)` an arbitrary process group running as the coordinator's
uid — e.g. `pid: 1`'s group, or the group of any daemon. This is a denial-of-service / privilege
boundary break: the container is not supposed to be able to kill host processes.

**Fix:** Before killing, verify the pid actually belongs to the run being cancelled: read
`<runDir>/run.json`, confirm `runJson.pid === pid`, and pass a `pidLooksLikeRunner` hook to
`cancelRun` that compares the process start-time against `run.json.started_at`. Reject the
cancel (400/409) when the pid does not match the run's recorded pid. Do not signal a pid that
was never recorded by this run.

### CR-03: `timeout` override unit mismatch — dashboard sends milliseconds, runner interprets seconds (1000× wall-clock cap)

**File:** `integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx:276-282`, `scripts/experiment-run.mjs:208-217`, `lib/vkb-server/api-routes.js:1210-1214`

**Issue:** The launcher input is labelled `placeholder="timeout ms (override)"` and stores the
raw number as `o.timeout` (launcher line 145). The value is forwarded verbatim through the API
(`_validateOverrides` only checks positive-int, line 1210-1214) and `buildRunArgv` emits it as
`--timeout <value>`. But `scripts/experiment-run.mjs` treats `--timeout` as **seconds**:
`timeoutMs = secs * 1000` (line 216). So an operator entering a millisecond value (e.g. `600000`
for "10 minutes") yields a 600,000-second (~7-day) per-cell wall-clock cap; conversely someone
entering `1200` intending 1.2s of ms actually gets 20 minutes. Every timeout override is off by
3 orders of magnitude, defeating the D-06 override entirely. `previewCellCount` and the matrix
preview are unaffected (timeout isn't a factor), so the UI gives no hint of the error.

**Fix:** Pick one unit and make it consistent end-to-end. Either relabel the input to
`"timeout seconds (override)"` (the runner's contract), or convert in the launcher/API before
forwarding (`o.timeout = Math.round(Number(timeout) / 1000)`). Given the runner CLI is a public
contract documented as seconds, changing the UI label + placeholder to seconds is the smaller,
safer fix.

## Warnings

### WR-01: `rerun_of` is dropped between the launcher and the runner — D-05 re-run provenance never persists

**File:** `lib/vkb-server/api-routes.js:944-1053`, `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts:808-828`

**Issue:** `launchExperiment` POSTs `{ spec, overrides, rerun_of }` with `rerun_of` at the top
level (slice line 819). But `handleExperimentRun` destructures only `{ spec, overrides }`
(line 946) and forwards `overrides: ov` whole; it never reads `rerun_of` nor folds it into
`overrides`. The runner's `buildRunArgv` emits `--rerun-of` only from `overrides.rerun_of`
(run-launch.mjs:73-74), which is never populated. Net effect: a dashboard-initiated re-run runs
with NO `--rerun-of`, so `Run.metadata.rerun_of` is always null and the re-run pairing (D-05) the
runs-table Re-run button advertises is silently lost. The `variant-override.test.mjs` proves the
runner threads `rerunOf` correctly when given it — the break is purely at the API seam.

**Fix:** In `handleExperimentRun`, fold `rerun_of` into the forwarded overrides when present and
valid:

```js
const { spec, overrides, rerun_of } = req.body || {};
const ov = overrides && typeof overrides === 'object' ? { ...overrides } : {};
if (typeof rerun_of === 'string' && rerun_of.trim()) ov.rerun_of = rerun_of.trim();
```

Add a test asserting the coordinator body carries `overrides.rerun_of` when the request supplies
a top-level `rerun_of`.

### WR-02: `variantOverrides` values (model/agent) are never validated — an invalid agent silently aborts the cell

**File:** `lib/vkb-server/api-routes.js:1225-1234`, `lib/experiments/agent-headless.mjs:86-106,141-150`

**Issue:** `_validateOverrides` validates that every `variantOverrides` KEY is a resolved variant
name, but never validates the override VALUES. An `agent` override that is not one of
`claude|opencode|mastracode|copilot` flows through `applyVariantOverride` → `resolveAgentBinary` /
`argvForAgent`, both of which `throw new Error('unknown agent …')`. That throw is caught by the
D-12 best-effort wrapper in `runMatrix` (experiment-runner.mjs:724-731) and recorded as a cell
`abort` with the error message — so the whole cell is silently wasted (restore + span) on a typo,
with the failure only visible in progress.json's per-cell reason. The operator gets no launch-time
rejection.

**Fix:** In `_validateOverrides`, validate each override value: `agent` must be in the known-agent
set; `model` must be a non-empty string. Reject with 400 at launch time so the operator corrects
it before a cell is burned.

### WR-03: `argvForAgent` pushes `undefined` into the fixed argv when `model` is missing

**File:** `lib/experiments/agent-headless.mjs:86-106`

**Issue:** `argvForAgent` unconditionally emits `'--model', model` (and `-m`, `--model`) even when
`model` is `undefined`. `child_process.spawn` requires every argv element to be a string and
throws `TypeError [ERR_INVALID_ARG_TYPE]` on an `undefined` element. Today every resolved cell
carries a `model` (the spec resolver requires it), so this is latent — but a future direct caller
of `argvForAgent(agent, goal)` with no `opts.model`, or a variantOverride that clears model, would
crash the spawn rather than fail gracefully. There is no guard.

**Fix:** Validate `model` at the top of `argvForAgent`
(`if (!model) throw new Error(\`argvForAgent: model required for ${agentName}\`)`), or omit the
`--model`/`-m` pair when model is absent. A thrown error at least routes through the D-12 record
path; an `undefined` argv element throws a raw TypeError outside that contract.

### WR-04: Coordinator origin gate trusts `req.socket.remoteAddress` and accepts the entire RFC1918 space

**File:** `scripts/health-coordinator.js:2620-2637`

**Issue:** `isExperimentOriginAllowed` allows loopback plus *all* of 10/8, 172.16-31/12,
192.168/16. The stated assumption ("port not published beyond localhost, so a private-range origin
is the container proxy, never a public caller") holds only for the intended single-container
topology. Any additional container on the Docker bridge network, any host with a route onto that
bridge, or a future compose change that publishes :3034 more widely, satisfies the gate. There is
no authentication token and no allow-list of the specific expected source. This is the enabling
condition for CR-01/CR-02 to be reachable by an unintended caller.

**Fix:** Tighten to a shared-secret header (a token set in docker-compose env on both sides) OR an
explicit allow-list of the container's gateway IP, in addition to the RFC1918 check. At minimum,
combine the origin gate with the input validation in CR-01/CR-02 so a mis-scoped caller cannot
reach the dangerous sinks.

### WR-05: `_pidAlive` (container) and `isRunAlive` (host) disagree on EPERM, so the D-02 slot guard can diverge

**File:** `lib/vkb-server/api-routes.js:1184-1192`, `lib/experiments/run-launch.mjs:208-215`

**Issue:** The container's `_pidAlive` treats `EPERM` as alive (`return e.code === 'EPERM'`), but
the host `isRunAlive` treats *any* thrown error (including EPERM) as dead (`catch { return false }`).
These probe the same D-02 "is a run live" decision on two sides of the seam. In the container's own
PID namespace EPERM is unlikely, but the inconsistency means the two authorities can classify the
same pid differently, so the "authoritative host-side" guard and the container-side guard can
disagree about whether the slot is busy. That undermines the single-slot invariant the whole D-02
design rests on.

**Fix:** Make the two probes agree. Since the host probe is documented as authoritative, either
have `isRunAlive` also treat EPERM as alive (matching `_pidAlive`), or have `_pidAlive` treat only
ESRCH as dead. Pick one liveness semantic and use it on both sides.

### WR-06: Container-side `_pidAlive` cannot see host pids, so the container D-02 live-run 409 is effectively dead code that can produce false 409s

**File:** `lib/vkb-server/api-routes.js:974-996,1184-1192`

**Issue:** `handleExperimentRun`'s "409 source #2" scans `.data/experiments/runs/*/progress.json`
and calls `this._pidAlive(prog.pid)` inside the container. The runner pids are HOST pids in a
separate PID namespace — the comment at coordinator line 2667-2668 and executor line 66-77 openly
acknowledges the container "cannot see host runner pids." So `process.kill(hostPid, 0)` in the
container either returns ESRCH (host pid not present in container namespace → treated dead) or, by
coincidence, matches an unrelated *container* pid that happens to equal the host pid number → a
FALSE 409 blocking a legitimate launch. The real guard is the host-side `findLiveRunHolder`; the
container-side scan is at best redundant and at worst a source of spurious 409s.

**Fix:** Remove the container-side pid-liveness branch (rely on the host `slot_busy` path that
line 1058 already maps to a 409), or replace it with a pid-independent staleness signal
(e.g. progress.json mtime). Do not `process.kill` a host pid from inside the container.

## Info

### IN-01: `_coordinatorPost` has no timeout — a hung coordinator hangs the launch/cancel request

**File:** `lib/vkb-server/api-routes.js:907-917`

**Issue:** `_coordinatorPost` `await`s `fetch` with no `AbortSignal.timeout`. If the host
coordinator is unreachable-but-accepting (or slow), `handleExperimentRun`/`handleRunCancel` hang
until the platform default. Every other proxy probe in this codebase (health-coordinator's own
probes, measurement-stop's obs fetches) uses `AbortSignal.timeout`. 

**Fix:** Add `signal: AbortSignal.timeout(10_000)` to the fetch and map the abort to a 502.

### IN-02: `handleExperimentRun` ignores `overrides.timeout`/`variants`/etc. shape errors beyond the validated few — silent forward of unknown keys

**File:** `lib/vkb-server/api-routes.js:1029-1033,1204-1236`

**Issue:** `_validateOverrides` only inspects `repeats`, `timeout`, `variants`, `variantOverrides`.
Any other key in `overrides` (e.g. a typo'd `varients`, or `rerun_of` if a caller put it there) is
forwarded whole to the coordinator and ignored downstream with no feedback. Combined with WR-01,
this makes silent no-ops easy.

**Fix:** Consider rejecting unknown override keys, or at least logging them, so a client typo does
not silently degrade to "spec as authored."

### IN-03: `_mintRunId` is time-based and can collide on rapid sequential launches

**File:** `lib/vkb-server/api-routes.js:1195-1197`

**Issue:** `_mintRunId` returns `r${Date.now().toString(36)}`. Two launches within the same
millisecond mint the same run_id and therefore the same run_dir. The D-02 single-slot guard makes
back-to-back launches rare, but the ID carries no randomness; a future concurrent-launch relaxation
would collide and one run would overwrite the other's `run.json`/`progress.json`.

**Fix:** Append a short random suffix (`+ Math.random().toString(36).slice(2,5)`) within the ≤12
charset budget, or seed from a counter.

### IN-04: Dashboard `RunMonitor` treats `cancelled`/`failed` as terminal but the runner never emits `failed`

**File:** `integrations/system-health-dashboard/src/components/performance/run-monitor.tsx:27`

**Issue:** The `TERMINAL` set includes `'failed'`, but the runner's overall states are
`running|complete|cancelled` (experiment-runner.mjs) and the executor writes `cancelled`. No path
emits `failed`, so that entry is dead. Harmless, but it suggests an intended overall state that was
never wired — worth confirming a genuinely-failed matrix (e.g. an unhandled throw in runMatrix)
surfaces a terminal overall the monitor recognizes rather than spinning on the last non-terminal
state forever.

**Fix:** Either wire a `failed`/`abort` overall on a top-level runMatrix throw, or drop the unused
`failed` entry to avoid implying a state that never arrives.

---

_Reviewed: 2026-07-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
