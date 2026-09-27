# TranscriptMonitorStartFn

**Type:** Detail

# TranscriptMonitorStartFn — Technical Insight Document

## What It Is

`TranscriptMonitorStartFn` is the `startFn` implementation attached to `SERVICE_CONFIGS.transcriptMonitor` in `scripts/start-services-robust.js`. It is one of the per-service descriptors defined by its parent, ServiceWrapperScripts, alongside a `healthCheckFn`, `required` flag, `maxRetries`, and `timeout`. Its job is to safely bring up the `enhanced-transcript-monitor.js` process — but "safely" here specifically means never spawning a duplicate instance when one is already running, whether tracked or orphaned.

## Architecture and Design

The defining architectural trait is a three-layer orphan-detection cascade executed before any `spawn` call: a global ProcessStateManager (PSM) check (`psm.isServiceRunning('transcript-monitor', 'global')`), a per-project PSM check keyed on `TARGET_PROJECT_PATH`, and finally an OS-level `pgrep`-based fallback via `isProcessRunningByScript('enhanced-transcript-monitor.js')`. This is the idempotent-start / orphan-adoption pattern: all three paths converge on an identical return shape (`{ pid, service: 'transcript-monitor', skipRegistration: true }`), meaning `startOneService` cannot distinguish "found existing" from "just started" — a deliberate contract unification.

This mirrors, at the code level, the human-facing "Docker Container Restart Verification Baseline" established on the parent DockerizedServices record, which asks operators to check existing state before re-invoking docker-compose. `TranscriptMonitorStartFn` automates that same discipline programmatically.

Health-check short-circuiting is the second major pattern: `healthCheckFn` checks `result.skipRegistration` first and returns `true` immediately, only falling through to `createPidHealthCheck()` for a genuinely fresh spawn. Combined with `required: true` and `maxRetries: 3`, this ensures the retry budget is reserved solely for true cold starts — the same "don't burn retries on a false negative" philosophy applied elsewhere to `waitForPortBindable`.

## Implementation Details

When the OS-level fallback discovers an orphan, the function opportunistically calls `psm.registerService(...)` to backfill PSM's bookkeeping, wrapped in its own try/catch — a failure here only logs a warning and does not block the "already running" verdict, treating registration as best-effort telemetry rather than a precondition. This is an explicit design trade-off: it accepts possible drift between PSM state and reality in exchange for never blocking startup on a non-critical write.

For the actual spawn path, the function opens `.data/etm.log` via `fs.openSync`, passes the raw fd into `stdio` for both stdout/stderr, and calls `fs.closeSync` on the parent's fd immediately after `spawn()` returns. This works only because the child duplicates the fd into its own table before `spawn()` returns, combined with `detached: true` and `child.unref()` — three details that must be read together to understand why the wrapper process can exit without truncating the child's log writes.

Environment injection is another key mechanic: `OBS_API_URL` is spread into the child's environment (defaulting to `http://localhost:${PORTS.OBSERVATIONS_API}`), with an inline comment establishing single-writer discipline — the spawned monitor writes through the host Observations API rather than opening `observations.db` directly.

## Integration Points

`TranscriptMonitorStartFn` is tightly coupled to `psm` (ProcessStateManager) and `isProcessRunningByScript`, both invoked synchronously before any spawn decision. It is consumed uniformly by `startOneService`/`SERVICE_ORDER`, meaning its retry/health/required semantics are governed by sibling declarative fields rather than internal logic — consistent with how the ServiceStarterRetryPolicy sibling supplies the actual backoff/attempt-counting mechanism imported from `../lib/service-starter.js` (`startServiceWithRetry`), while this file only supplies per-service parameters.

Feature-gating is tested directly in `tests/features/service-gating.test.mjs`, which calls `startOneService('transcriptMonitor', results, featureSet({ lsl: false }))` and asserts `blocked === false`, confirming that `required: true` only blocks startup when the associated feature (`lsl`) is enabled — required-ness is resolved downstream of feature gating, not hardcoded into `startFn`.

## Usage Guidelines

Developers modifying this function must preserve the shared return contract between orphan-detection and fresh-spawn paths, since `healthCheckFn` and retry logic depend on `skipRegistration` semantics rather than re-probing. Any change to the fd-close/detach/unref sequence around logging must keep all three elements together — closing the fd early is only safe due to the child's own fd duplication. Registration failures during orphan adoption are intentionally non-fatal; do not upgrade them to hard failures without considering the retry-budget implications. Finally, respect the single-writer discipline around `OBS_API_URL` — the observations database should remain owned exclusively by the host API, not opened directly by spawned monitors.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- When the OS-level `pgrep` fallback finds an orphaned process, `transcriptMonitor.startFn` calls `psm.registerService({ name: 'transcript-monitor', pid: osCheck.pid, type: 'global', script: 'scripts/enhanced-transcript-monitor.js' })` to backfill the ProcessStateManager's bookkeeping, wrapped in its own try/catch that only logs a warning on failure — registration is treated as best-effort telemetry, not a precondition for treating the orphan as healthy. This means a PSM write failure at this point is silently absorbed and the function still returns `skipRegistration: true`, so the wrapper's own state can drift from PSM's without surfacing an error anywhere in this path.
- The actual spawn path opens `.data/etm.log` with `fs.openSync(etmLogFile, 'a')`, passes the raw fd into `stdio: ['ignore', etmLogFd, etmLogFd]` for both stdout and stderr, then calls `fs.closeSync(etmLogFd)` in the parent immediately after `spawn()` returns. This is safe only because the child process duplicates the fd into its own table before the parent's spawn call returns, and depends on `detached: true` plus the subsequent `child.unref()` to let the wrapper process exit without the OS treating the log-writing child as a keep-alive handle — three lines that must be read together to see why closing the parent's fd doesn't truncate the child's writes.

**Other:**
- The `transcriptMonitor.startFn` in scripts/start-services-robust.js implements a three-layer orphan check before ever calling `spawn`: first `psm.isServiceRunning('transcript-monitor', 'global')`, then a per-project PSM check keyed on `TARGET_PROJECT_PATH`, and only if both return false does it fall through to `isProcessRunningByScript('enhanced-transcript-monitor.js')`, an OS-level `pgrep -lf` fallback. Each of the three early-return paths produces a `{ pid, service: 'transcript-monitor', skipRegistration: true }` result rather than a fresh spawn, so `startOneService`'s retry/health-check machinery treats 'found an existing instance' identically to 'started successfully' — the orphan-detection logic and the happy-path spawn share one return contract.
- `SERVICE_CONFIGS.transcriptMonitor.healthCheckFn` special-cases the `skipRegistration` result: `if (result.skipRegistration) return true;` short-circuits the health check for any of the three 'already running' branches, and only a genuinely fresh spawn falls through to `createPidHealthCheck()(result)`. Combined with `required: true` and `maxRetries: 3`, this means the retry budget in `startOneService` is reserved entirely for the case where no existing process was found at all — an orphan or a PSM-known instance never consumes a retry, which is the same 'don't burn maxRetries on a false negative' philosophy `waitForPortBindable` applies to port races.
- tests/features/service-gating.test.mjs directly exercises this function's feature-gating behavior via `startOneService('transcriptMonitor', results, featureSet({ lsl: false }))`, asserting `out.blocked === false` specifically to prove that `required: true` only blocks startup when the `lsl` feature is actually enabled — the test's own comment states 'required-ness applies only when the feature is on', confirming that `transcriptMonitor`'s `required` flag is evaluated downstream of feature resolution rather than being an unconditional gate baked into `startFn` itself.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The parent record 'DockerizedServices' establishes a 'Docker Container Restart Verification Baseline' requiring operators to check existing container/service state before invoking docker-compose again specifically to avoid restarting on top of orphaned or stale service state — this is the operational, human-facing counterpart to the code-level orphan detection this function performs automatically via PSM and `isProcessRunningByScript` before every spawn attempt.

## Hierarchy Context

### Parent
- [ServiceWrapperScripts](./ServiceWrapperScripts.md) -- [LLM] scripts/start-services-robust.js defines SERVICE_CONFIGS as a map of per-service descriptors (transcriptMonitor, liveLoggingCoordinator, and others truncated below them) each carrying a `feature` id, `startFn`, `healthCheckFn`, `required`, and `maxRetries`/`timeout`. The `transcriptMonitor.startFn` is the clearest instance of the 'thin wrapper' pattern described for the parent DockerizedServices entity: before spawning anything it checks PSM (`psm.isServiceRunning('transcript-monitor', 'global')`) and an OS-level `pgrep` fallback (`isProcessRunningByScript`) to avoid double-starting an orphaned process, then spawns `enhanced-transcript-monitor.js` detached with stdio redirected to `.data/etm.log`, injects `OBS_API_URL` into the child's env, and calls `child.unref()` so the wrapper process itself can exit without keeping the child alive as a dependent.

### Siblings
- [ApiServiceWrapper](./ApiServiceWrapper.md) -- [LLM] None of the supplied files define, export, or even name a class, module, or function called "ApiServiceWrapper." The closest thematic material is the per-service descriptor pattern in scripts/start-services-robust.js (the SERVICE_CONFIGS map with <AWS_SECRET_REDACTED> entries), which the parent DockerizedServices context already describes as a 'thin wrapper' pattern — but that is a generic object-literal shape (feature/startFn/healthCheckFn/required/maxRetries/timeout), not a wrapper class over an API client, and nothing here shows it wrapping an HTTP/API surface specifically.
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- [LLM] None of the supplied files define a class, module, or function named `DashboardServiceWrapper`. The closest dashboard-related material is in docker/entrypoint.sh, where `health-dashboard` and `health-dashboard-frontend` appear only as entries in the `PROGRAM_FEATURES` string (mapped to the `health` feature id) that the script uses to decide whether to write an `autostart=false` override into `/etc/supervisor/features.d/disabled.conf`. This is container-side feature gating of an already-defined supervisord program, not a wrapper component that starts, health-checks, or retries the dashboard process itself.
- [ServiceStarterRetryPolicy](./ServiceStarterRetryPolicy.md) -- [LLM] start-services-robust.js does not itself define the retry-with-timeout mechanism; it imports `startServiceWithRetry` from `../lib/service-starter.js` and composes it with per-service `startFn`/`healthCheckFn`/`maxRetries`/`timeout` fields declared in `SERVICE_CONFIGS`. This means the actual retry policy logic (backoff schedule, attempt counting) lives outside the files retrieved here, while this file supplies only the per-service parameters the policy consumes.


---

*Generated from 10 observations*
