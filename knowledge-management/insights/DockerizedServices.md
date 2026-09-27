# DockerizedServices

**Type:** Component

## What It Is

DockerizedServices is the containerized runtime layer for the Coding project, implemented across `scripts/` (wrapper scripts like `api-service.js`, `dashboard-service.js`, `start-services-robust.js`), `lib/` (`lib/utils/service-probe.js`, `lib/service-starter.js`), `docker/entrypoint.sh`, and `config/health-verification-rules.json`. It exists to manage process lifecycle, health verification, and orchestration for services running inside Docker containers under supervisord, decoupling implementation entrypoints (e.g. `integrations/constraint-monitor/src/dashboard-server.js`, the constraint-monitor Next.js dashboard) from the container's process supervision layer.

![DockerizedServices — Architecture](images/dockerized-services-architecture.png)

## Architecture and Design

The core architectural pattern is indirection via thin wrapper scripts: supervisord never invokes implementation entrypoints directly, only wrapper scripts under `scripts/` (e.g. `api-service.js`, `dashboard-service.js`). Each wrapper resolves the actual server code via CODING_REPO-relative paths, spawns it as a child process with injected environment variables (ports, API base URLs), and registers with ProcessStateManager under a distinct name such as `constraint-api-child`. This centralizes lifecycle concerns — signal forwarding, PSM registration/unregistration — in one place instead of duplicating them per service, a pattern also visible in the ServiceWrapperScripts child, where `start-services-robust.js`'s SERVICE_CONFIGS map applies the same thin-wrapper approach to `transcriptMonitor` and `liveLoggingCoordinator`.

Health verification is deliberately layered into three tiers of increasing scope: `lib/utils/service-probe.js` for low-level HTTP/TCP primitives, `lib/service-starter.js` for retry-with-backoff startup logic, and `scripts/health-coordinator.js` for whole-stack orchestration against `config/health-verification-rules.json`. A key constraint (SPEC R6) bars the probe layer from ever reporting "healthy" — only "running", "stopped", or "unknown" — ensuring probe failures can't masquerade as confirmed health further up the stack, which reflects the fail-safe philosophy also seen in DockerEntrypoint's `wait_for_service()`, a fail-open readiness gate that warns but never blocks container startup on a slow Qdrant/Redis dependency.

## Implementation Details

`scripts/api-service.js` spawns `integrations/constraint-monitor/src/dashboard-server.js` on port 3031, while `scripts/dashboard-service.js` runs the constraint-monitor Next.js dashboard via `npm run dev`, wiring `NEXT_PUBLIC_API_BASE_URL=http://localhost:3031` — a hardcoded coupling point requiring coordinated updates if the port changes, since no service-discovery mechanism exists between them. `lib/service-starter.js`'s `withDeadline()` wraps `Promise.race` with a `finally`-guarded `clearTimeout`, fixing a Node-specific bug where a dangling `setTimeout` handle would keep the event loop alive after successful startup. StartServicesScripts (`start-services.sh`) is a dual-mode dispatcher defaulting to ROBUST_MODE, execing `start-services-robust.js`; its legacy bash path (docker-compose invocation, manual `docker run` fallbacks, `check_docker`/`check_port`/`kill_port`) remains live but deprecated for backward compatibility.

ServiceWrapperScripts' `transcriptMonitor.startFn` exemplifies the thin-wrapper pattern: it checks ProcessStateManager (`psm.isServiceRunning`) and a `pgrep`-based OS fallback before spawning `enhanced-transcript-monitor.js` detached, redirecting stdio to `.data/etm.log`, injecting `OBS_API_URL`, and calling `child.unref()` so the wrapper can exit independently of its child.

## Integration Points

![DockerizedServices — Relationship](images/dockerized-services-relationship.png)

DockerizedServices' children — ServiceStarter, ProcessStateManager, DockerEntrypoint, StartServicesScripts, ServiceWrapperScripts — each implement a distinct facet of the runtime: startup retry logic, process registry, container entry readiness, dispatch, and per-service wrappers, respectively. It integrates with SemanticAnalysis through `integrations/semantic-analysis/src/mock/llm-mock-service.ts`, which persists mock/local/public mode state to `.data/workflow-progress.json` and resolves paths via `CODING_ROOT` to remain valid whether run on host or in-container. Downstream consumers like wave-analysis (referenced under KnowledgeManagement/session workflows) depend on the health-confirmation gate before trusting pipeline results.

## Usage Guidelines

Per the Health Verification Workflow, any code or data change requires a docker-compose rebuild followed by explicit confirmation that all supervised processes and health endpoints are live — health confirmation is a hard gate, not an assumption, especially before downstream pipelines like wave-analysis. Before rerunning docker-compose, operators must check existing container/service state (the Docker Container Restart Verification Baseline) to avoid restarting atop orphaned or stale state from an incomplete prior shutdown. Developers modifying port bindings (e.g. api-service's 3031) must update dependent wrapper environment injections manually, and should preserve SPEC R6's constraint that probes never self-report "healthy."


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised processes/health endpoints must be confirmed live before relying on downstream pipelines like wave-analysis
- Coding-Services Docker Container — Health Verification Workflow establishes that Docker Container Restart Verification Baseline requires checking before running docker-compose to avoid orphaned or stale service state
- The Coding-Services Docker Container — Health Verification Workflow record establishes that after any code or data change (e.g. a KB Stage 1 fix), the standard operational procedure is to rebuild via docker-compose and then explicitly confirm that all supervised processes and their health endpoints are live before trusting downstream pipelines such as wave-analysis — health confirmation is treated as a hard gate, not an assumption.
- The same Coding-Services Docker Container — Health Verification Workflow record also establishes a 'Docker Container Restart Verification Baseline': operators are expected to check existing container/service state before invoking docker-compose again, specifically to avoid restarting on top of orphaned or stale service state left behind by a prior incomplete shutdown.

## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file; LLMAbstraction: [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copi; DockerizedServices: [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised ; KnowledgeManagement: [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, me; CodingPatterns: [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generat; ConstraintSystem: [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constra; SemanticAnalysis: [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource referenc.

### Children
- [ServiceStarter](./ServiceStarter.md) -- [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that after docker-compose rebuild, all supervised processes/health endpoints must be confirmed live before relying on downstream pipelines like wave-analysis
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js
- [DockerEntrypoint](./DockerEntrypoint.md) -- [LLM] docker/entrypoint.sh's `wait_for_service()` (lines ~13-31) is a deliberately fail-open readiness gate: it polls a TCP connection via bash's `/dev/tcp/$host/$port` pseudo-device wrapped in `timeout 2`, retries up to `max_attempts` (default 30) with a 2s sleep, but on exhaustion prints a WARNING and still `return 0` — the comment explicitly states 'Don't fail — let supervisord handle it'. This means the entrypoint never blocks container startup on Qdrant or Redis being slow; it only front-loads a wait so the first supervisord-managed process is less likely to race a cold dependency, while ultimate liveness is left to whatever the individual service's own retry logic does once supervisord starts it.
- [StartServicesScripts](./StartServicesScripts.md) -- [LLM] start-services.sh is a dual-mode dispatcher: with ROBUST_MODE (default true, overridable via env var) it simply execs `node scripts/start-services-robust.js` and exits immediately, deferring all real orchestration to that Node script; the remainder of the bash file (roughly 200+ lines of legacy port-killing, docker-compose invocation for Qdrant/Redis, and manual `docker run` fallbacks for constraint-monitor) only executes when ROBUST_MODE=false. This is a live-but-deprecated code path — it still constructs CONSTRAINT_MONITOR_STATUS/CONSTRAINT_MONITOR_WARNING strings and calls `check_docker`, `check_port`, `kill_port` — kept explicitly for backward compatibility rather than deleted.
- [ServiceWrapperScripts](./ServiceWrapperScripts.md) -- [LLM] scripts/start-services-robust.js defines SERVICE_CONFIGS as a map of per-service descriptors (transcriptMonitor, liveLoggingCoordinator, and others truncated below them) each carrying a `feature` id, `startFn`, `healthCheckFn`, `required`, and `maxRetries`/`timeout`. The `transcriptMonitor.startFn` is the clearest instance of the 'thin wrapper' pattern described for the parent DockerizedServices entity: before spawning anything it checks PSM (`psm.isServiceRunning('transcript-monitor', 'global')`) and an OS-level `pgrep` fallback (`isProcessRunningByScript`) to avoid double-starting an orphaned process, then spawns `enhanced-transcript-monitor.js` detached with stdio redirected to `.data/etm.log`, injects `OBS_API_URL` into the child's env, and calls `child.unref()` so the wrapper process itself can exit without keeping the child alive as a dependent.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copilot models, then Groq Llama-70B only as last resort — rather than demoting to lower tiers as primary
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, meaning the viewer's History sidebar (which filters strictly to entityType 'Insight') could never surface a Batch badge for that run's conclusions.
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generated diagram artifacts belong in version control versus being build outputs, enforcing consistent authoring and correct rendering across the docs pipeline.
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying HookManagementSystem's violation data to a click-driven UX surface
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced


---

*Generated from 9 observations*
