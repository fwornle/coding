# ApiServiceWrapper

**Type:** Detail

[Code References] scripts/api-service.js:14-15 - CODING_REPO/PORT resolution via env vars with fallback; scripts/api-service.js:24-27 - fs.existsSync fail-fast guard before spawn; scripts/api-service.js:29-38 - spawn('node', [API_SERVER_PATH]) with NODE_ENV honoring process.env; scripts/api-service.js:62-77 - dynamic import and PSM registerService call wrapped in try/catch; scripts/dashboard-service.js:14-15 - CODING_REPO/PORT resolution mirrors api-service.js; scripts/dashboard-service.js:22-30 - spawn('npm', ['run', 'dev']) with NODE_ENV hardcoded to 'development'; scripts/dashboard-service.js:26 - NEXT_PUBLIC_API_BASE_URL hardcoded to http://localhost:3031; docker/entrypoint.sh PROGRAM_FEATURES block - flat container-side mirror mapping constraint-dashboard/constraint-dashboard-api to the 'constraints' feature; docker/entrypoint.sh wait_for_service() - always returns 0 after exhausting attempts, deferring failure to supervisord; lib/service-starter.js withDeadline() - clears setTimeout in finally to avoid dangling event-loop handles; lib/service-starter.js startServiceWithRetry() - SIGTERM-then-SIGKILL escalation for unhealthy child processes; scripts/generate-docker-mcp-config.sh CODEGRAPH_ENABLED block - conditional empty-output pattern for disabled features

# ApiServiceWrapper — Technical Insight Document

## What It Is

ApiServiceWrapper is implemented in `scripts/api-service.js`, a thin lifecycle-management wrapper responsible for spawning and supervising the constraint API server process (`src/dashboard-server.js`) as a child process. It resolves its working directory via `process.env.CODING_REPO || join(__dirname, '..')` (api-service.js:14), determines its listen port via `process.env.CONSTRAINT_API_PORT || 3031` (api-service.js:15), and performs a fail-fast existence check on the target artifact before spawning (api-service.js:24-27). Once launched — via `spawn('node', [API_SERVER_PATH], { cwd: CONSTRAINT_DIR, ... })` (api-service.js:29-38) — it forwards OS signals to the child and registers itself with the ProcessStateManager (PSM) for cluster-wide process telemetry, as detailed in the sibling entity PsmLifecycleRegistration. It is one of two nearly identical scripts under the parent ServiceWrapperScripts component, the other being DashboardServiceWrapper (`scripts/dashboard-service.js`).

## Architecture and Design

The dominant pattern is a **thin lifecycle proxy / signal-forwarding wrapper around a child_process**, paired with a **fail-fast pre-flight guard** (`fs.existsSync` before spawn, api-service.js:24-27) and a **best-effort telemetry registration** pattern where PSM registration is wrapped in try/catch and treated as non-critical to the service's actual operation. Unlike its sibling `dashboard-service.js`, which spawns `npm run dev` and hardcodes `NODE_ENV: 'development'`, api-service.js honors `process.env.NODE_ENV || 'production'` when spawning `node` directly against the built server file — a meaningful asymmetry, since the dashboard wrapper is thereby permanently pinned to Next.js dev-server overhead regardless of deployment context, while the API wrapper behaves correctly in production.

Architecturally, api-service.js and dashboard-service.js duplicate identical scaffolding (env resolution, existence guard, signal handlers) with no shared base module, even though `lib/service-starter.js` exists in the same codebase as shared infrastructure — but for a different concern (retry/backoff/health-check orchestration rather than spawn/PSM/signal wiring). This reflects two coexisting failure-handling philosophies in the same directory: the wrapper scripts fail fast and defer recovery to external supervision (supervisord, PSM), while `lib/service-starter.js` implements its own retry-with-backoff and unhealthy-process termination logic internally.

Feature gating is layered *above* the wrapper entirely: `docker/entrypoint.sh`'s PROGRAM_FEATURES block gates supervisord programs (`constraint-dashboard-api`, presumably the parent of this wrapper) rather than referencing PSM-registered names like `constraint-api-child` directly. This means api-service.js has no awareness of the `features.json` snapshot — if the `constraints` feature is disabled, supervisord simply never invokes the script, so its own `fs.existsSync` guard and PSM registration never execute. Two independent failure-prevention layers are stacked, addressing different failure modes: intentional disablement (entrypoint.sh) versus accidental missing artifact (the wrapper's own guard).

## Implementation Details

At startup, api-service.js resolves configuration from environment variables with sensible fallbacks, then guards against a missing target artifact before calling `spawn`. The spawned child's stdio is inherited (per the parent ServiceWrapperScripts description), and env vars like `PORT`/`DASHBOARD_PORT` are propagated into the child. After logging `Started (PID: ${child.pid})`, the script enters a fire-and-forget async IIFE that dynamically imports `./process-state-manager.js`, constructs a `new ProcessStateManager()`, calls `.initialize()`, and invokes `registerService` (api-service.js:62-77) — all wrapped in try/catch to keep telemetry non-critical.

Signal handling wires SIGTERM/SIGINT/exit/error listeners (api-service.js:52-59) that forward termination to the child via `child.kill('SIGTERM')`, but — notably — there is no SIGKILL escalation if the child fails to terminate within a bounded time, unlike `lib/service-starter.js`'s `startServiceWithRetry()`, which explicitly escalates from SIGTERM to SIGKILL after a 1-second wait. This means api-service.js relies entirely on the child (Express/Node process) honoring SIGTERM gracefully.

The child's `exit` handler performs PSM unregistration using a hardcoded string literal (`'constraint-api-child'`, `'global'`) rather than deriving the key from the `name` field used at registration — a latent drift risk shared structurally with `dashboard-service.js`. As documented under PsmLifecycleRegistration, this creates a race: because the registration IIFE is never awaited, a child crash could trigger `unregisterService` before `psm.initialize()` in the registration path completes, calling unregister on a service that was never actually registered. Each of the four call sites across both wrapper files independently constructs its own `ProcessStateManager` instance rather than sharing a singleton within the file.

## Integration Points

api-service.js depends on `./process-state-manager.js` (dynamically imported) for PSM registration/unregistration, and on the filesystem existence of its target artifact before spawning. It is invoked as a child of a supervisord-managed program (per `docker/entrypoint.sh` PROGRAM_FEATURES, likely `constraint-dashboard-api`), placing feature-gating logic entirely outside the script's own control flow. Its sibling, DashboardServiceWrapper, depends on api-service.js's port configuration indirectly and problematically: `dashboard-service.js:26` hardcodes `NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3031'` with no corresponding read of `process.env.CONSTRAINT_API_PORT`, meaning changes to api-service.js's configurable `PORT` silently break the dashboard's ability to reach it — a cross-script coupling via hardcoded literal rather than shared configuration.

## Usage Guidelines

Developers modifying lifecycle behavior (graceful-shutdown timeouts, PSM registration fixes, signal handling) must apply changes to both api-service.js and dashboard-service.js by hand, since there is no shared `service-wrapper.js` factory — this is the primary maintainability risk. Any change to `CONSTRAINT_API_PORT` must be manually propagated into dashboard-service.js's `NEXT_PUBLIC_API_BASE_URL`, since Next.js inlines `NEXT_PUBLIC_*` vars at build/dev-start time. Because there's no SIGKILL escalation, developers should verify the child process (dashboard-server.js) itself handles SIGTERM gracefully, or consider borrowing the escalation logic from `lib/service-starter.js`. When reasoning about failures, distinguish between entrypoint.sh's feature-disablement layer (script never runs) and the wrapper's own existence-guard layer (script runs but exits early) — these are separate failure domains and should be debugged differently.


## Hierarchy Context

### Parent
- [ServiceWrapperScripts](./ServiceWrapperScripts.md) -- api-service.js spawns `node src/dashboard-server.js` inside integrations/constraint-monitor with stdio:'inherit', propagating PORT and DASHBOARD_PORT env vars into the child

### Siblings
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- [LLM] [object Object]
- [PsmLifecycleRegistration](./PsmLifecycleRegistration.md) -- [LLM] scripts/api-service.js and scripts/dashboard-service.js implement PSM registration/unregistration as two structurally symmetric but temporally asymmetric operations: registration happens in a fire-and-forget async IIFE at the bottom of the file that runs after console.log(`Started (PID: ${child.pid})`), while unregistration happens synchronously-awaited inside the child.on('exit', async (code) => {...}) handler before process.exit(code || 0) is called. Because the IIFE is not awaited by anything, there is a real (if narrow) race window where a child process could crash and fire 'exit' — running unregisterService and then process.exit — before the registration IIFE's await psm.initialize() chain has completed, meaning unregisterService is called for a service that was never actually registered. Both files share this exact ordering, so the race is a structural property of the wrapper pattern, not a one-off bug in either script.


---

*Generated from 10 observations*
