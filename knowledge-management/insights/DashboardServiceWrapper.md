# DashboardServiceWrapper

**Type:** Detail

[Architecture Notes] Tight, undirectional coupling: dashboard-service.js's hardcoded API base URL silently breaks if api-service.js's CONSTRAINT_API_PORT is overridden; Asymmetric configuration flow between the two wrappers: API→dashboard port passed via env var (CONSTRAINT_DASHBOARD_PORT), dashboard→API port hardcoded; dashboard-service.js's child process is npm, introducing an extra process hop versus api-service.js's direct node spawn; NODE_ENV handling diverges: env-overridable in api-service.js vs hardcoded 'development' in dashboard-service.js; PSM registration/unregistration key strings are manually duplicated literals with no shared constant, risking metadata drift on rename

# DashboardServiceWrapper — Technical Insight Document

## What It Is

DashboardServiceWrapper is implemented in `scripts/dashboard-service.js`, specifically the spawn logic at lines 27-36 and the PSM unregistration logic at lines 44-53. It is a thin supervisor process whose sole responsibility is to launch, monitor, and tear down a dashboard child process (started via `npm run dev` rather than a direct `node` invocation). As a sibling of ApiServiceWrapper under the parent ServiceWrapperScripts grouping, it mirrors that wrapper's lifecycle scaffolding almost exactly, differing mainly in target artifact, port, and spawn command. Notably, the parent-level relationship is inverted from what the naming might suggest: api-service.js is documented as spawning `node src/dashboard-server.js` inside `integrations/constraint-monitor` with `stdio:'inherit'`, propagating `PORT` and `DASHBOARD_PORT` into that child — meaning dashboard-service.js and this integration-spawned dashboard-server.js are related but distinct code paths worth disambiguating during future work.

## Architecture and Design

The dominant pattern is spawn-register-unregister: the wrapper performs a fail-fast existence guard (`fs.existsSync`) before invoking `child_process.spawn`, then registers with PSM (Process Service Manager) as a best-effort, non-critical dependency wrapped in try/catch. The parent process itself has no independent lifecycle — it is a signal-forwarding thin supervisor, relaying SIGTERM/SIGINT/exit/error straight through to the child. Configuration is largely environment-variable-driven, with one conspicuous exception: `NEXT_PUBLIC_API_BASE_URL` is hardcoded in dashboard-service.js:27-36, alongside a hardcoded `NODE_ENV` of `'development'`. This creates a tight, unidirectional coupling problem: if api-service.js's `CONSTRAINT_API_PORT` is overridden, dashboard-service.js's hardcoded API base URL silently breaks, since there is no corresponding env var flowing from API to dashboard the way `CONSTRAINT_DASHBOARD_PORT` flows in the opposite direction.

## Implementation Details

The child process is launched via `npm run dev` — an extra process hop compared to api-service.js's direct `node` spawn — which has implications for signal handling latency and process-tree cleanup. PSM lifecycle hooks are structurally symmetric with ApiServiceWrapper's PsmLifecycleRegistration pattern: registration occurs in a fire-and-forget async IIFE after `console.log(`Started (PID: ${child.pid})`)`, while unregistration is synchronously awaited inside the `child.on('exit', async (code) => {...})` handler (dashboard-service.js:44-53) before `process.exit(code || 0)`. Because the registration IIFE is never awaited, there is a real race window in which a fast-crashing child fires 'exit' and triggers `unregisterService` before `psm.initialize()` has completed registration — meaning unregistration can run against a service that was never registered. The PSM key used for this — the literal `'constraint-dashboard-child'` — is manually duplicated with no shared constant, risking metadata drift if the service is ever renamed.

## Integration Points

DashboardServiceWrapper depends on PSM as a soft dependency (registration failures are swallowed via try/catch and treated as non-critical). It shares its `CODING_REPO` resolution strategy (`process.env.CODING_REPO || join(__dirname, '..')`) and existence-guard pattern with ApiServiceWrapper, per the ServiceWrapperScripts sibling relationship, but there is no shared base module — no `service-wrapper.js` factory — despite `lib/service-starter.js` already existing in the codebase as a shared utility (albeit for retry/health-check orchestration, a different concern). Configuration integration with ApiServiceWrapper is asymmetric: dashboard-service.js receives `CONSTRAINT_DASHBOARD_PORT` from api-service.js:29-36's spawn call, but has no equivalent mechanism to receive API port changes, relying instead on the hardcoded URL.

## Usage Guidelines

Any change to lifecycle behavior (graceful shutdown timeouts, PSM registration race fixes) must currently be applied by hand to both dashboard-service.js and api-service.js, since they duplicate rather than share logic. Developers modifying `CONSTRAINT_API_PORT` in api-service.js must remember to manually update the hardcoded `NEXT_PUBLIC_API_BASE_URL` in dashboard-service.js — this is not enforced anywhere. The PSM key literal `'constraint-dashboard-child'` should be treated as fragile; renaming the service requires grepping for this string across both the registration IIFE (analogous to api-service.js:75-92) and the exit handler. Given the unawaited registration IIFE, engineers debugging PSM state inconsistencies should be aware that unregister-without-register is a structural possibility, not a bug isolated to one script.


## Hierarchy Context

### Parent
- [ServiceWrapperScripts](./ServiceWrapperScripts.md) -- api-service.js spawns `node src/dashboard-server.js` inside integrations/constraint-monitor with stdio:'inherit', propagating PORT and DASHBOARD_PORT env vars into the child

### Siblings
- [ApiServiceWrapper](./ApiServiceWrapper.md) -- [LLM] scripts/api-service.js and scripts/dashboard-service.js implement identical lifecycle scaffolding with only the target artifact, port, and spawn command differing. Both resolve CODING_REPO via `process.env.CODING_REPO || join(__dirname, '..')` (api-service.js:14, dashboard-service.js:14), both guard with `fs.existsSync` before spawning (api-service.js:24-27, dashboard-service.js:24-27), and both wire identical SIGTERM/SIGINT/exit/error handlers. This duplication means any lifecycle fix (e.g., adding a graceful-shutdown timeout, or fixing a PSM registration race) must be applied twice by hand — there is no shared base module like a `service-wrapper.js` factory, even though `lib/service-starter.js` already exists as a shared utility in the same codebase for a different concern (retry/health-check orchestration, not spawn/PSM/signal wiring).
- [PsmLifecycleRegistration](./PsmLifecycleRegistration.md) -- [LLM] scripts/api-service.js and scripts/dashboard-service.js implement PSM registration/unregistration as two structurally symmetric but temporally asymmetric operations: registration happens in a fire-and-forget async IIFE at the bottom of the file that runs after console.log(`Started (PID: ${child.pid})`), while unregistration happens synchronously-awaited inside the child.on('exit', async (code) => {...}) handler before process.exit(code || 0) is called. Because the IIFE is not awaited by anything, there is a real (if narrow) race window where a child process could crash and fire 'exit' — running unregisterService and then process.exit — before the registration IIFE's await psm.initialize() chain has completed, meaning unregisterService is called for a service that was never actually registered. Both files share this exact ordering, so the race is a structural property of the wrapper pattern, not a one-off bug in either script.


---

*Generated from 9 observations*
