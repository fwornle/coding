# LLMMockService

**Type:** SubComponent

LLMMockService is architecturally separate from the PSM/wrapper pattern used by the other DockerizedServices sub-components, acting as a configuration provider rather than a process lifecycle manager

# LLMMockService — Technical Insight Document

## What It Is

`LLMMockService` is a SubComponent implemented in `llm-mock-service.ts`, residing under the `DockerizedServices` umbrella alongside siblings like `ConstraintAPIWrapper`, `DashboardWrapper`, `ProcessStateManager`, `ServiceStarter`, `ServiceProbe`, and `HealthCoordinator`. Unlike those siblings — which orchestrate child processes and lifecycle signals — `LLMMockService` is a **configuration provider** for LLM mode selection across the `mcp-server-semantic-analysis` agent ecosystem. It governs which backend an agent talks to when it needs language-model capabilities, mediating between fully synthetic outputs, a local model, and a production LLM endpoint.

The service supports three distinct operating modes — `mock`, `local`, and `public` — which can be switched without code changes. Mode state is not held in memory: it is persisted to `workflow-progress.json`, allowing mode selection to survive process restarts within the Docker environment. The service is also Docker-aware, meaning it accounts for containerized path resolution and environment-variable differences when locating the persisted state file.

![LLMMockService — Architecture](images/llmmock-service-architecture.png)

## Architecture and Design

The most defining architectural choice of `LLMMockService` is its **deliberate departure from the PSM/wrapper pattern** that characterizes its sibling sub-components. Where `ConstraintAPIWrapper` (in `scripts/api-service.js`) and `DashboardWrapper` (in `scripts/dashboard-service.js`) spawn child processes, register with `ProcessStateManager`, and forward `SIGTERM`/`SIGINT` signals, `LLMMockService` owns no process lifecycle at all. It is a pure configuration surface. This asymmetry within `DockerizedServices` is intentional: not every dockerized concern is a process, and forcing `LLMMockService` into the wrapper boilerplate would conflate "service identity" with "policy/configuration."

Internally, `LLMMockService` decomposes into two child responsibilities: `PersistedModeStore` and `AgentOverrideResolver`. The first treats `workflow-progress.json` as the single source of truth for mode state — explicitly choosing durability over performance. The second handles the layered configuration model: there is a global fallback mode plus a per-agent override map, and resolving the effective mode for any given agent requires a merge step that consults both tiers.

This two-child split reflects a classic separation between **storage** and **resolution policy**. `PersistedModeStore` knows nothing about agents or overrides; `AgentOverrideResolver` knows nothing about how state is persisted. The composition gives `LLMMockService` a clean internal seam while keeping the public surface to a single configuration-provider role.

## Implementation Details

The core implementation file is `llm-mock-service.ts`. Rather than caching mode state in a process-local variable, the module reads and writes to `workflow-progress.json` directly. The practical effect is that any process — whether a long-running agent, a one-shot CLI invocation, or a restarted container — sees identical state. This is critical inside Docker, where container restarts would otherwise wipe in-memory configuration and force redundant re-bootstrapping.

The three supported modes — `mock`, `local`, and `public` — are not implemented as separate code paths within `LLMMockService` itself; the service merely advertises which mode is active. Downstream consumers in `mcp-server-semantic-analysis` are responsible for routing requests appropriately. The `mock` mode yields fully synthetic responses (useful for deterministic testing), `local` targets a locally hosted model (useful for offline development), and `public` points at a production LLM (the default for real workloads).

The `AgentOverrideResolver` child component implements the merge semantics. Conceptually, when an agent asks "what mode am I in?", the resolver looks up the agent's identifier in the per-agent override map stored in `workflow-progress.json`; if no entry exists, it falls back to the global mode. This per-agent override capability means individual agents within `mcp-server-semantic-analysis` can operate in different modes simultaneously — for instance, one agent could run against `mock` for reproducible test fixtures while another targets `public` for live inference, all reading from the same JSON file.

The Docker-awareness manifests in path resolution logic: locating `workflow-progress.json` inside a container requires accounting for mounted volume paths and environment variables that differ from a host-level invocation. The module encapsulates this concern so that consumers do not need to know whether they are running inside or outside a container.

## Integration Points

![LLMMockService — Relationship](images/llmmock-service-relationship.png)

`LLMMockService` is contained by `DockerizedServices`, but unlike its siblings it does not interact with `ProcessStateManager`. There is no `psm.registerService()` call, no signal forwarding, no child process. This is a structural distinction worth understanding: `ProcessStateManager`'s registry, which is shared as a singleton with `ConstraintAPIWrapper`, `DashboardWrapper`, and `HealthCoordinator`, simply has no representation of `LLMMockService` because there is no PID to track.

The primary external integration is with `mcp-server-semantic-analysis`, whose agents consume mode information from `LLMMockService` to decide how to dispatch LLM requests. The integration medium is the `workflow-progress.json` file itself — a file-based contract rather than an in-process API. This loose coupling means agents do not need to import or link against `LLMMockService`; they need only know the file location and schema.

Within the service, `PersistedModeStore` is the file I/O boundary, while `AgentOverrideResolver` is the read-time consumer that interprets the layered schema. The relationship to `ServiceStarter` (`lib/service-starter.js`) and `HealthCoordinator` is essentially nil — those orchestrators concern themselves with process lifecycle, while `LLMMockService` is policy data at rest.

## Usage Guidelines

Developers extending or consuming `LLMMockService` should internalize that **`workflow-progress.json` is the single source of truth**. Do not cache mode values in long-lived variables across operations where mode changes are expected; the persisted state was explicitly designed to survive restarts, and reading it on demand is the intended pattern. The trade-off — file I/O on each resolution — was accepted to prioritize durability inside Docker.

When configuring per-agent overrides, remember that the resolution model is a two-tier merge: a global fallback plus a per-agent map. To make an agent behave differently, write an entry to the per-agent map; to change the system-wide default, update the global mode. This explicit layering allows targeted experiments (one agent in `mock` mode for reproducibility) without disturbing the rest of the system.

Because `LLMMockService` does **not** follow the wrapper/PSM pattern used by `ConstraintAPIWrapper` and `DashboardWrapper`, do not attempt to model it as a process or expect it to appear in the `ProcessStateManager` registry. If you find yourself adding wrapper-style boilerplate to it, you are almost certainly misclassifying it — it is a configuration provider, not a service lifecycle participant.

Finally, when working in mixed host/container scenarios, rely on the module's Docker-aware path resolution rather than hard-coding paths to `workflow-progress.json`. The whole point of encapsulating that logic inside `LLMMockService` is to keep callers oblivious to environment differences.

---

### Architectural Summary

1. **Patterns identified**: Persisted configuration store; two-tier (global + per-agent) override resolution; file-based inter-process contract; deliberate non-conformance to the surrounding PSM/wrapper pattern.
2. **Design decisions and trade-offs**: Durability chosen over performance via JSON persistence; loose coupling via shared file rather than in-process API; explicit separation of `PersistedModeStore` (I/O) from `AgentOverrideResolver` (policy).
3. **System structure insights**: `LLMMockService` is the structural outlier within `DockerizedServices`, demonstrating that the container does not impose a single architectural pattern on its members — process wrappers and configuration providers coexist.
4. **Scalability considerations**: File-based state is adequate for the current agent population but would become a contention point under high-frequency mode reads/writes; the design implicitly assumes mode changes are rare relative to LLM calls themselves.
5. **Maintainability assessment**: Clean internal decomposition into two named children improves comprehensibility; the lack of wrapper boilerplate keeps the module small; the chief risk is schema drift in `workflow-progress.json`, which is a shared contract with `mcp-server-semantic-analysis` agents and has no compile-time enforcement.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The ProcessStateManager (PSM) singleton implements a deliberate decoupling between service identity and process identity across both `scripts/api-service.js` and `scripts/dashboard-service.js`. Each script follows an identical structural pattern: spawn a child process via Node's `child_process` module, register the resulting process handle with the PSM via `psm.registerService()`, wire up `SIGTERM`/`SIGINT` forwarding so that signals delivered to the wrapper propagate to the child, and call `psm.unregisterService()` in the exit handler. This indirection means that the rest of the system (including `scripts/health-coordinator.js`) can query the PSM registry without holding direct references to OS-level process IDs. The practical consequence for developers is that a service restart — where a new child process replaces the old one — does not require the health coordinator or any consumer of PSM state to be aware of the PID change; only the wrapper scripts update the registry. This pattern also cleanly isolates the restart/retry logic in `lib/service-starter.js` from signal-handling responsibilities, since the wrapper owns the process lifecycle signals while the starter owns the retry policy. A new developer should note that adding a new containerized service almost certainly means creating a new wrapper script that replicates this boilerplate rather than centralizing it, which is a potential maintenance concern as the number of services grows.

### Children
- [PersistedModeStore](./PersistedModeStore.md) -- llm-mock-service.ts deliberately avoids in-memory state for LLM mode, instead treating workflow-progress.json as the single source of truth — a design choice that prioritizes durability over performance within the Docker environment.
- [AgentOverrideResolver](./AgentOverrideResolver.md) -- llm-mock-service.ts maintains at least two tiers of mode configuration in workflow-progress.json: a global fallback mode and a per-agent override map, requiring a merge step whenever the effective mode for a specific agent is needed.

### Siblings
- [ServiceProbe](./ServiceProbe.md) -- ServiceProbe lives at lib/utils/service-probe.js and is consumed by scripts/health-coordinator.js, establishing a clear utility-to-orchestrator dependency direction
- [ConstraintAPIWrapper](./ConstraintAPIWrapper.md) -- scripts/api-service.js uses Node's child_process module to spawn the constraint monitor Express API, decoupling the OS-level PID from the service identity tracked by PSM
- [DashboardWrapper](./DashboardWrapper.md) -- scripts/dashboard-service.js mirrors the structural pattern of api-service.js exactly: spawn via child_process, registerService, wire signals, unregisterService on exit
- [ProcessStateManager](./ProcessStateManager.md) -- PSM is a singleton, meaning all wrapper scripts (api-service.js, dashboard-service.js) and health-coordinator.js share a single registry instance without passing references explicitly
- [ServiceStarter](./ServiceStarter.md) -- lib/service-starter.js is explicitly isolated from SIGTERM/SIGINT handling — signal propagation is owned by the wrapper scripts (api-service.js, dashboard-service.js), not by the starter
- [HealthCoordinator](./HealthCoordinator.md) -- health-coordinator.js consumes PSM state by name rather than PID, so service restarts are transparent — it never needs to be notified of PID changes in api-service.js or dashboard-service.js


---

*Generated from 5 observations*
