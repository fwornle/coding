# DockerizedServices

**Type:** Component

# DockerizedServices

## What It Is

DockerizedServices is the containerized service-runtime layer of the Coding project, comprising a set of wrapper scripts, health-check primitives, and operational procedures that manage how supervised processes start, register, verify, and restart inside Docker. Its concrete implementations live in `scripts/api-service.js`, `scripts/dashboard-service.js`, `lib/service-starter.js`, `lib/utils/service-probe.js`, `scripts/start-services-robust.js`, and `integrations/semantic-analysis/src/mock/llm-mock-service.ts`. Rather than a single service, it is best understood as an orchestration and health-verification harness sitting between raw processes (constraint-monitor dashboard/API, semantic-analysis mocks) and the supervisord-driven container runtime.

![DockerizedServices — Architecture](images/dockerized-services-architecture.png)

## Architecture and Design

The dominant pattern is the **wrapper-process** approach: thin Node scripts spawn the real service logic as child processes rather than embedding it. `scripts/api-service.js` spawns `integrations/constraint-monitor/src/dashboard-server.js` and registers its PID with a global ProcessStateManager (PSM) under type `global`, name `constraint-api-child`; `scripts/dashboard-service.js` similarly wraps `npm run dev` for the constraint-monitor dashboard. This keeps lifecycle concerns (spawn, signal forwarding, PSM registration) separate from business/API logic, but it means debugging must target the correct layer — wrapper for startup/shutdown/PSM visibility, wrapped process for actual behavior.

Orchestration is declarative: the child component ServiceStarter (`scripts/start-services-robust.js`) wraps `lib/service-starter.js` primitives (`startServiceWithRetry`, `createHttpHealthCheck`, `createPidHealthCheck`) into a `SERVICE_CONFIGS` map of `{name, feature, psmPath, required, maxRetries, timeout, startFn, healthCheckFn}` tuples — the StartServicesOrchestrator role referenced in the hierarchy. `start-services.sh` execs this robust path by default (`ROBUST_MODE=true`), retaining a legacy bash docker-compose/lsof/kill path only as dead-code fallback.

Health semantics are deliberately constrained: `lib/utils/service-probe.js` enforces a three-state contract (SPEC R6) — `running`, `stopped`, `unknown` — never a binary or "healthy" state, forcing downstream consumers (SupervisordRuntime, Global Service Coordinator) to distinguish real outages from probe/config errors.

![DockerizedServices — Relationship](images/dockerized-services-relationship.png)

## Implementation Details

`lib/service-starter.js` includes a `withDeadline()` helper that races a promise against a timeout, wrapping the timeout's `setTimeout` in try/finally to guarantee `clearTimeout()` fires regardless of race outcome — a fix for a previously observed bug where uncanceled timers kept short-lived CLI invocations alive past logical completion.

`lib/utils/service-probe.js` exposes `probeHttpHealth()` and `probeTcpPort()`, both bound to the same three-state contract, with `unknown` reserved strictly for probe/config errors (malformed URL, DNS failure) and `stopped` reserved for network-level failures (connection refused, timeout) — conflating the two masks configuration bugs as outages.

`scripts/dashboard-service.js` hardcodes `NEXT_PUBLIC_API_BASE_URL` to `http://localhost:3031`, creating an implicit, unenforced coupling to `api-service.js`'s port/host — a manual single point of failure if Docker network aliasing changes the API's location.

MockLLMService (`integrations/semantic-analysis/src/mock/llm-mock-service.ts`) checks `process.env.CODING_ROOT` and silently overrides any passed-in `repositoryPath`, reconciling host-mounted vs. container-internal path views — a source of confusion for callers who assume their argument is authoritative.

## Integration Points

DockerizedServices sits under the Coding root alongside sibling components like ConstraintSystem (whose dashboard is spawned by APIServiceWrapper/DashboardServiceWrapper) and SemanticAnalysis (whose mock service is MockLLMService). Its children — ServiceStarter, APIServiceWrapper, DashboardServiceWrapper, MockLLMService, SupervisordRuntime, StartServicesOrchestrator — depend on shared primitives (`lib/service-starter.js`, `lib/utils/service-probe.js`) and on PSM for process visibility. SupervisordRuntime's unresolved "Feature Snapshot Forensics" investigation (runtime config silently drifting to "logging-only") indicates fragile coupling between supervisord state and the health-check contract this component defines.

## Usage Guidelines

Before running `docker-compose up -d`, capture a baseline of supervisor process list/container state to catch regressions like stale naming or misconfigured mounts — this is a manual discipline, not code-enforced, implying prior silent drift. After any code/data change, rebuild via docker-compose and explicitly confirm all supervised processes and health endpoints are live (per the running/stopped/unknown contract) before trusting downstream pipelines like wave-analysis, since services have previously appeared restarted while actually degraded. Developers changing API ports must manually update `scripts/dashboard-service.js`'s hardcoded URL, and anyone debugging unexpected `repositoryPath` behavior in MockLLMService should check `CODING_ROOT` first.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and container state should be captured as a baseline to compare against post-restart state and catch regressions like stale naming or misconfigured mounts
- Coding-Services Docker Container — Health Verification Workflow defines the standard procedure for rebuilding coding-services via docker-compose after code/data changes, requiring confirmation that all supervised processes and health endpoints are live before relying on downstream pipelines like wave-analysis
- Docker Container Restart Verification Baseline establishes an operational discipline around routine docker-compose up -d restarts: before restarting, the current supervisor process list and container state must be captured as a baseline snapshot, explicitly to catch regressions such as stale container naming or misconfigured volume mounts that would otherwise only surface as downstream failures. This practice is not encoded in any script referenced in the initial analysis — it is a manual/procedural safeguard layered on top of the docker-compose workflow, implying the container/supervisor configuration has previously drifted silently across restarts.

## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observa; LLMAbstraction: [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which AP; DockerizedServices: [SESSION] Docker Container Restart Verification Baseline establishes that before running docker-compose up -d, the current supervisor process list and; KnowledgeManagement: [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History ; CodingPatterns: [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rend; ConstraintSystem: [SESSION] The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the con; SemanticAnalysis: [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource referenc.

### Children
- [ServiceStarter](./ServiceStarter.md) -- [LLM] scripts/start-services-robust.js is the actual ServiceStarter implementation — a Node orchestrator that wraps lib/service-starter.js's startServiceWithRetry/createHttpHealthCheck/createPidHealthCheck primitives into a declarative SERVICE_CONFIGS map, each entry a {name, feature, psmPath, required, maxRetries, timeout, startFn, healthCheckFn} tuple. start-services.sh is a thin bash shim that execs this script when ROBUST_MODE=true (the default) and only falls back to an inline legacy bash startup path (manual docker-compose/lsof/kill logic) when ROBUST_MODE=false, meaning the legacy code in start-services.sh below the exec is dead in normal operation but kept for backward compatibility.
- [APIServiceWrapper](./APIServiceWrapper.md) -- [LLM] The supplied code files do not contain scripts/api-service.js, which the parent-entity context describes as the actual implementation of the wrapper-process pattern (spawning integrations/constraint-monitor/src/dashboard-server.js as a child process and registering its PID with ProcessStateManager under type 'global', name 'constraint-api-child'). Everything in this analysis about APIServiceWrapper's specific spawn/registration logic is inherited from the parent's prior observation rather than verified against source shown here, so it should be treated as a summary of prior findings, not a fresh code read.
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- [LLM] None of the supplied files define, import, or instantiate a `DashboardServiceWrapper` class or module. The parent entity's own [LLM] observation names the actual wrapper scripts — `scripts/api-service.js` (spawns `integrations/constraint-monitor/src/dashboard-server.js`) and `scripts/dashboard-service.js` (wraps `npm run dev` for the constraint-monitor dashboard) — but neither file's source was retrieved here; only `docker/entrypoint.sh`, `scripts/prompt-classifier-service.mjs`, `scripts/start-services-robust.js`, `start-services.sh`, and `tests/features/service-gating.test.mjs` were provided, none of which contain a class or script named DashboardServiceWrapper.
- [MockLLMService](./MockLLMService.md) -- [LLM] None of the retrieved code files (docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, tests/features/service-gating.test.mjs) implement, import, or reference a MockLLMService. The parent entity's own observations name the actual implementation as integrations/semantic-analysis/src/mock/llm-mock-service.ts, which checks process.env.CODING_ROOT and overrides the repositoryPath argument to reconcile host-mounted paths against container-internal paths — but that file's contents were not supplied to this analysis, so nothing about its internal structure, its mock response strategy, or how it is wired into the semantic-analysis service can be verified here.
- [SupervisordRuntime](./SupervisordRuntime.md) -- [SESSION] Feature Snapshot Forensics — Runtime Config Drift Investigation documents an ongoing, unresolved effort to find what rewrites the runtime feature snapshot into an overly restrictive state (e.g. 'logging-only'), causing silent service outages.
- [StartServicesOrchestrator](./StartServicesOrchestrator.md) -- [SESSION] Docker Container Restart Verification Baseline establishes capturing supervisor process list and container state as a baseline before docker-compose up -d, to compare against post-restart state and catch regressions like stale naming or misconfigured mounts.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] ObservationWriter.js (per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record) mediates all observation persistence between ETM and the database, applying turn-aware semantic dedup and snapshot promotion, but [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Model Catalogue — Endpoint-Gated Access Rules' establishes that the model catalogue must track which models are accessible via which API surface (Responses API vs /chat/completions), since some models are gated per-endpoint and mismatched combinations must be rejected rather than silently allowed
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History UI (which filters to entityType='Insight') could never show batch results — fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes mandatory formatting/placement rules: .puml sources live in docs/puml/, rendered .png files live in docs/images/, distinct from the MkDocs-served docs-content/images/ tree.
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] The Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying ConstraintSystem violation state directly into the click-driven statusline UX
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 9 observations*
