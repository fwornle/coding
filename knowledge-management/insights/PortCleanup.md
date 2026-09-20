# PortCleanup

**Type:** Detail

[Architecture Notes] Two structurally divergent startup paths coexist: start-services.sh's ROBUST_MODE=true execs scripts/start-services-robust.js (graduated, verified port cleanup); ROBUST_MODE=false falls back to legacy bash kill_port (unconditional kill -9, no verification); Port-cleanup logic (killProcessOnPortAndWait, waitForPortBindable) is decoupled from the PSM-based already-running detection used in SERVICE_CONFIGS startFn implementations — it appears to be a fallback safety net rather than the primary duplicate-instance guard; checkPortInUse() and isProcessRunningByScript() both shell out via child_process exec/execSync rather than using a Node-native port/process API, coupling correctness to `lsof`/`pgrep` availability on the host; No automated test coverage exists for the PortCleanup functions themselves, in contrast to the thorough structural/behavioral tests in service-gating.test.mjs for the feature-gating layer

# PortCleanup — Technical Insight Document

## What It Is

PortCleanup is the last-resort port-reclamation layer implemented in `scripts/start-services-robust.js`, centered on three functions: `killProcessOnPortAndWait()`, `waitForPortBindable()`, and the supporting diagnostic `checkPortInUse()` and `isProcessRunningByScript()`. It exists as a fallback safety net within the parent component HostServiceStarter, distinct from and decoupled from the primary duplicate-instance guard (the PSM-based checks in `SERVICE_CONFIGS`). A structurally divergent legacy implementation also exists in `start-services.sh` via a crude `check_port`/`kill_port` pair, active only when `ROBUST_MODE=false`.

## Architecture and Design

The core pattern is graduated escalation: `killProcessOnPortAndWait()` sends SIGTERM to all PIDs from `lsof -ti:<port>`, then polls `checkPortInUse()` on an interval, escalating to SIGKILL once `Date.now() - startTime > maxWaitMs / 2`. Notably, this escalation isn't a one-shot event — SIGKILL is re-issued on every subsequent poll tick, which is harmless against already-dead processes (the `process.kill` throw is silently caught) but reflects a deliberate design choice favoring "no later than half the timeout" over precise timing.

A second pattern, empirical probing over inference, governs `waitForPortBindable()`. Rather than reusing `isPortListening()` from `lib/service-starter.js` (imported but unused here), it spins up a throwaway `net.createServer()`, attempts `.listen(port, host)`, and resolves based on the 'listening' vs 'error' events. This exists because a kernel can hold a socket in TIME_WAIT or half-closed state post-crash without responding to HTTP probes — `isPortListening()` would give a false negative.

A third pattern is layered duplicate-instance detection sitting above PortCleanup: `SERVICE_CONFIGS.transcriptMonitor.startFn` checks PSM global status, PSM per-project status, then falls back to OS-level `pgrep` via `isProcessRunningByScript()`, self-healing by re-registering orphans with `psm.registerService()`. PortCleanup only engages when all three of these checks fail to find a live process yet the port remains occupied.

## Implementation Details

`checkPortInUse()` wraps `lsof -ti:${port} 2>/dev/null || true` and returns `stdout.trim().length > 0`; its catch block returns `false`, meaning lsof failures are treated as "port free" — a fail-open behavior. `isProcessRunningByScript()` mirrors this philosophy, catching errors into an explicit `{running: false}` fail-open result. `waitForPortBindable()`'s inner probe resolves `false` on error rather than rejecting the outer promise. This is a consistent, deliberate defensive-startup philosophy: cleanup diagnostics degrade to "proceed, let health checks or retries catch it" rather than aborting startup.

The legacy bash path in `start-services.sh` implements none of this nuance — `kill_port` runs `lsof -t -i :$port` and unconditionally `kill -9`, with no SIGTERM grace period and no wait/verify loop, applied only to ports 8080 and 8001.

## Integration Points

PortCleanup's call sites are not visible within the truncated `SERVICE_CONFIGS.transcriptMonitor` or `liveLoggingCoordinator` `startFn` excerpts, implying invocation happens elsewhere in the file. It depends on shelling out to `lsof` and `pgrep` via `child_process exec/execSync` rather than Node-native APIs, coupling correctness to host tool availability. It sits below the PSM-based checks described in sibling entity RequiredVsOptionalStartup logic and is gated at the process level by the `ROBUST_MODE` flag versus the legacy bash path.

## Usage Guidelines

Developers should treat `killProcessOnPortAndWait`/`waitForPortBindable` as a safety net, not the primary running-instance guard — that role belongs to the PSM checks. Since `tests/features/service-gating.test.mjs` covers only `startOneService()`, `SERVICE_ORDER`/`SERVICE_CONFIGS` symmetry (per sibling ServiceOrderTable), and feature-gating (per sibling RequiredVsOptionalStartup), PortCleanup's escalation timing and bind-probing behavior are currently unverified by automated tests — any changes to timing logic (e.g., the half-`maxWaitMs` escalation) should be treated cautiously and ideally accompanied by new tests. Developers should also be aware that behavior differs entirely depending on `ROBUST_MODE`: the JS path is graduated and verified, the bash path is not, so consistency guarantees do not hold across both startup paths.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- The parent context's note that killProcessOnPortAndWait 'escalates from SIGTERM to SIGKILL after half of maxWaitMs elapsed, polling checkPortInUse() via lsof -ti:<port>' is directly confirmed in the code: checkPortInUse() (start-services-robust.js) wraps `lsof -ti:${port} 2>/dev/null || true` and returns `stdout.trim().length > 0`, matching the parent's description exactly, including the fail-open behavior on lsof errors (the catch block returns false, i.e., treats an lsof failure as 'port free').


## Hierarchy Context

### Parent
- [HostServiceStarter](./HostServiceStarter.md) -- start-services-robust.js defines SERVICE_CONFIGS and SERVICE_ORDER, asserted in tests/features/service-gating.test.mjs to cover each other exactly so no service is configured but never started

### Siblings
- [ServiceOrderTable](./ServiceOrderTable.md) -- [LLM] The gating contract in scripts/start-services-robust.js is enforced structurally, not just behaviorally: tests/features/service-gating.test.mjs asserts that `SERVICE_ORDER.map(o => o.key).sort()` exactly equals `Object.keys(SERVICE_CONFIGS).sort()`, and separately that every `SERVICE_CONFIGS` entry declares a `feature` field that exists in `FEATURE_IDS` (imported from `lib/features/catalogue.cjs`). This closes a specific failure mode called out in the test file's own docstring — 'ten hand-written start blocks were ten chances to forget a gate' — by making an un-gated or orphaned service a test failure rather than a runtime surprise. The mirrored idea appears in docker/entrypoint.sh's `PROGRAM_FEATURES` string, which `tests/features/container-gating.test.mjs` (referenced in the shell script's comments) checks against the `[program:...]` sections of supervisord.conf — the same exactly-covers-each-other invariant applied to the container's process list instead of the host's service list.
- [RequiredVsOptionalStartup](./RequiredVsOptionalStartup.md) -- [LLM] scripts/start-services-robust.js defines two classes of services via the `required` boolean in SERVICE_CONFIGS — transcriptMonitor and liveLoggingCoordinator are `required: true` with `maxRetries: 3` and `timeout: 20000`, while services like observationsApi and llmCliProxy are optional and degrade gracefully. The service-gating test in tests/features/service-gating.test.mjs ('a required failure blocks, so downstream services do not start') proves this isn't just a config label — startOneService() actually sets `out.blocked = true` on exhausted retries for a required service, and the test harness deliberately overrides `maxRetries` to 1 before testing this to avoid paying the real 3-attempt exponential backoff cost (documented inline as 'the real value costs six seconds of exponential waiting').


---

*Generated from 10 observations*
