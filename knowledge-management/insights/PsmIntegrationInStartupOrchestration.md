# PsmIntegrationInStartupOrchestration

**Type:** Detail

[Architecture Notes] PSM registration in scripts/api-service.js and scripts/dashboard-service.js is architecturally disconnected from lib/service-starter.js's health-check-driven startServiceWithRetry() — the two coexist as parallel, non-communicating bookkeeping systems for the same class of child processes; docker/entrypoint.sh's feature-gating decision (which supervisord programs autostart) happens upstream of and independently from PSM registration, so PSM cannot distinguish a disabled service from an unregistered/failed one; No shared abstraction exists between the container-level fail-open policy (entrypoint.sh) and the process-level fail-open policy (PSM try/catch in the wrapper scripts), despite both encoding the same underlying design philosophy; withDeadline()'s timeout-safety fix in lib/service-starter.js is not propagated to the PSM calls in api-service.js/dashboard-service.js, leaving an inconsistency in timeout protection across the startup/shutdown orchestration surface; MCP tool surface reduction (scripts/generate-docker-mcp-config.sh) and PSM's passive-registry role both reflect a project-wide tendency to treat auxiliary visibility/tooling as optional overhead rather than mandatory infrastructure

# PsmIntegrationInStartupOrchestration

## What It Is

PsmIntegrationInStartupOrchestration describes the point of contact — and the surprising lack thereof — between ProcessStateManager (PSM) and two independent startup/orchestration mechanisms in this codebase: lib/service-starter.js's Node-based retry-and-health-check lifecycle (startServiceWithRetry(), withDeadline()) and docker/entrypoint.sh's shell-based supervisord feature-gating (PROGRAM_FEATURES, FEATURES_SNAPSHOT, disabled.conf). PSM registration itself lives in the wrapper scripts scripts/api-service.js and scripts/dashboard-service.js, where each dynamically imports ./process-state-manager.js, instantiates `new ProcessStateManager()`, and calls `await psm.initialize()` followed by registerService()/unregisterService(). As the sibling entity ServiceRegistration suggests, this registration behavior is a distinct concern from the parent ProcessStateManager class itself — PSM provides the registry API, but the *integration* of that API into startup orchestration is a separate, loosely-coupled layer bolted onto each wrapper script independently.

## Architecture and Design

The defining architectural fact is disconnection: three systems — the Node coordinator's health-check loop, entrypoint.sh's supervisord gating, and PSM's registry — describe overlapping facts about the same child processes without any reconciliation path. startServiceWithRetry() in lib/service-starter.js:120-170 drives retries and health checks using a `healthCheckFn` supplied directly by the coordinator, never sourced from PSM. Separately, docker/entrypoint.sh:90-140 decides, entirely before scripts/api-service.js or scripts/dashboard-service.js ever execute, whether constraint-dashboard/constraint-dashboard-api even start under supervisord — a decision PSM has zero visibility into. The result is two disjoint bookkeeping systems (supervisord's process table and PSM's registry) and a third, the coordinator's health-check state, none of which talk to each other.

This is reinforced by a project-wide fail-open philosophy applied independently at each layer: entrypoint.sh treats a missing features.json as "run everything" rather than "run nothing," and the wrapper scripts' PSM try/catch blocks ("Continue anyway - not critical", "Ignore cleanup errors") apply the same logic to registry failures. Neither layer records this fail-open decision as durable, queryable data — entrypoint.sh only echoes to stdout, wrappers only console.error or swallow — so the philosophy is architecturally consistent but operationally invisible.

## Implementation Details

The registration/unregistration code in api-service.js and dashboard-service.js (both roughly lines 29-50) is near byte-for-byte identical: dynamic import, `new ProcessStateManager()`, `await psm.initialize()`, then a try/catch-wrapped registerService() or unregisterService() call. The only differences are literal strings ('constraint-api-child' vs 'constraint-dashboard-child'), the script label, and metadata.service. The exit handler unregisters via a bare service name with swallowed errors, and registerService calls pass a hardcoded `parentWrapper: process.pid`.

Notably, lib/service-starter.js's withDeadline() (lines 70-92) is explicitly documented as fixing a real hang bug — Promise.race() leaving a losing setTimeout armed, holding the event loop open — yet this fix is never reused by the PSM calls in the wrapper scripts. This leaves an unbounded-async-call risk in initialize()/registerService()/unregisterService() during child.on('exit') that could stall `process.exit(code || 0)` indefinitely, despite the wrapper's apparent intent to exit promptly.

## Integration Points

PSM's registration in the wrappers is orthogonal to both surrounding systems: it doesn't feed startServiceWithRetry()'s health check, and it isn't referenced anywhere in entrypoint.sh's PROGRAM_FEATURES gating logic. When a feature is disabled via disabled.conf, PSM simply never receives a registerService() call — there's no corresponding "disabled" state written to the registry, so a consumer querying PSM cannot distinguish "failed to register" from "deliberately gated off." Beyond the two current wrappers, entrypoint.sh's PROGRAM_FEATURES already enumerates five more gated programs (semantic-analysis, vkb-server, embedding-listener, graphify, health-dashboard, health-dashboard-frontend) that could adopt this same convention, multiplying the duplication. A loosely analogous trade-off appears in scripts/generate-docker-mcp-config.sh, which strips semantic-analysis/constraint-monitor MCP schemas to save tokens — another case of treating auxiliary visibility as degradable rather than mandatory, consistent with PSM's passive-registry role.

## Usage Guidelines

Developers should not assume PSM state reflects actual process liveness or feature-gating decisions — it only reflects whether a wrapper script successfully executed its register/unregister calls. Anyone debugging "why isn't PSM showing this service" needs to correlate container logs, wrapper stdout, and the PSM registry manually, since none of the three independently records the fail-open decision as data. Before adding PSM registration to additional wrapper scripts (per the five other gated programs), consider consolidating the duplicated boilerplate and applying withDeadline()-style timeout protection to the PSM calls, closing the inconsistency between the coordinator's already-fixed hang bug and the still-vulnerable wrapper scripts.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js

### Siblings
- [ServiceRegistration](./ServiceRegistration.md) -- [LLM] [object Object]


---

*Generated from 9 observations*
