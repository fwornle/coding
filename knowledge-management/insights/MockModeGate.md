# MockModeGate

**Type:** Detail

The gate evaluates a global mode flag read from workflow-progress.json and, according to the parent component description, also checks per-agent override fields before falling back to the global flag, giving fine-grained control over which agents use mocks during a workflow run.

# MockModeGate — Technical Insight Document

## What It Is

MockModeGate is a decision-point component implemented inside `llm-mock-service.ts`, the single entry point for all LLM invocations within the Dockerized service layer. Rather than existing as a standalone module, the gate is a logical guard embedded in the `LLMMockService` parent that intercepts every outbound LLM call and decides — based on configuration state — whether the request should be routed to a mock fixture or forwarded to a live backend.

Functionally, MockModeGate is the centralized policy enforcement point for mock-versus-live routing. Because `llm-mock-service.ts` is the only place where LLM invocations originate in the Dockerized service, the gate is guaranteed to evaluate every call, eliminating the risk of bypass that would arise if mock-mode logic were scattered across individual callers. This single-chokepoint design is the defining characteristic of the component.

The gate's primary operational purpose is to suppress network egress and avoid LLM API costs during development workflows and CI runs executing inside Docker. By short-circuiting calls to local fixtures when configured to do so, it allows deterministic, offline, and economically viable iteration on the broader system.

## Architecture and Design

The architecture follows a **Gateway / Guard pattern**: MockModeGate sits inline within the invocation path of `LLMMockService`, evaluating mode state before any downstream LLM client is contacted. This is a classic chokepoint enforcement pattern, deliberately chosen so that policy logic is co-located with the only legitimate invocation surface. There is no façade-bypass path — every caller transits through `llm-mock-service.ts`, and therefore through the gate.

The decision logic itself is **hierarchical**: the gate first consults per-agent override fields in `workflow-progress.json`, and only falls back to the global mode flag when no agent-specific override is present. This two-tier resolution gives operators fine-grained control — entire workflow runs can be mocked, or specific agents within a run can be selectively mocked while others continue to use live LLMs. This pattern mirrors typical feature-flag resolution strategies where local overrides trump global defaults.

The gate cooperates closely with its sibling component `WorkflowProgressReader`, which is responsible for materializing the contents of `workflow-progress.json` so the gate has state to evaluate. The parent `LLMMockService` orchestrates this by resolving the `workflow-progress.json` path via the `CODING_ROOT` environment variable, ensuring portability across Docker volume mount layouts. This separation of concerns — reader provides state, gate provides policy, parent provides path resolution and orchestration — yields a small but cleanly factored design.

## Implementation Details

Mechanically, MockModeGate executes during each LLM invocation handled by `LLMMockService`. The gate reads the global mode flag from `workflow-progress.json` (sourced through the sibling `WorkflowProgressReader` and a path resolved against the `CODING_ROOT` environment variable). It then layers per-agent override fields on top of this global flag: if an agent identifier accompanying the invocation has an explicit override entry, that override determines routing; otherwise the global flag is applied.

When the gate resolves to "mock," the invocation is satisfied from a fixture rather than dispatched to a live backend. When it resolves to "live," the invocation is allowed to proceed to the actual LLM provider. Because all of this happens inside `llm-mock-service.ts`, no caller needs awareness of mock state — the indirection is total.

The implementation relies on file-based state (`workflow-progress.json`) rather than process memory or remote configuration. This is intentional for a Dockerized environment: the JSON file lives on a mounted volume, can be edited externally without restarting the service, and survives across invocations. The `CODING_ROOT`-based path resolution inherited from the parent `LLMMockService` ensures the gate operates correctly regardless of how the host filesystem is mapped into the container.

## Integration Points

MockModeGate has three principal integration touchpoints. First, it depends on its sibling `WorkflowProgressReader` (or the equivalent JSON-reading logic resolved through `CODING_ROOT`) to obtain the configuration state it evaluates. Second, it depends on its parent `LLMMockService` to be the exclusive caller surface — the architectural guarantee that no other code path issues LLM invocations is what makes the gate effective. Third, downstream, the gate hands off either to local mock fixtures or to live LLM client code, both of which are dispatched from within `llm-mock-service.ts`.

The environmental dependency on `CODING_ROOT` is significant: this variable, set when the Docker container is launched, anchors the `workflow-progress.json` lookup. Any deployment or test harness that runs `LLMMockService` must ensure `CODING_ROOT` is set correctly, or the gate cannot read its mode flag.

Outside callers — agent runners, workflow orchestrators, and other components that need LLM output — integrate with the gate only indirectly, by invoking through `LLMMockService`. They do not import or reference MockModeGate directly. This keeps the dependency graph clean and the policy enforcement opaque to consumers.

## Usage Guidelines

Developers should treat `llm-mock-service.ts` as the sole legitimate path for LLM invocation inside the Dockerized service. Introducing a parallel invocation path — calling an LLM client directly from another module, for instance — would bypass MockModeGate and defeat its cost-control and determinism guarantees. Any new agent or workflow component that needs LLM output must route through `LLMMockService`.

To control mock behavior, edit `workflow-progress.json` rather than modifying code. Use the global mode flag for blanket policy (mock everything, or live-mode everything for a final validation run), and use per-agent override fields when you need a mixed configuration — for example, mocking expensive frontier models while letting cheaper agents run live. Because the gate consults overrides before falling back to the global flag, an explicit per-agent setting always wins.

When working in CI or local development, prefer mock mode as the default to avoid incurring API costs and to maintain deterministic test outcomes. Reserve live mode for explicit integration validation. Ensure `CODING_ROOT` is properly set in your Docker run configuration so that the gate (and the sibling `WorkflowProgressReader`) can locate `workflow-progress.json` regardless of host filesystem layout.

---

### Summary of Key Takeaways

1. **Architectural patterns identified:** Gateway/Guard chokepoint, hierarchical feature-flag resolution (per-agent override over global default), file-based configuration state, environment-variable-driven path resolution.
2. **Design decisions and trade-offs:** Centralizing the mock decision in a single entry point trades flexibility (callers cannot override) for safety (no path can bypass the gate). File-based configuration via `workflow-progress.json` trades runtime performance for external editability.
3. **System structure insights:** Clean separation between path resolution (parent `LLMMockService`), state acquisition (sibling `WorkflowProgressReader`), and policy evaluation (MockModeGate) — a small but well-factored decomposition.
4. **Scalability considerations:** The file-read-per-invocation approach is appropriate for development/CI scale but would warrant caching if invocation rates grew substantially. The single-entry-point design scales naturally as new agents are added — no per-agent integration work is needed.
5. **Maintainability assessment:** High. The chokepoint design means mock-related changes are localized to `llm-mock-service.ts`, configuration changes require no code edits, and `CODING_ROOT` portability avoids environment-specific code branches. The principal maintenance risk is discipline: future contributors must continue routing LLM calls through `LLMMockService` to preserve the guarantee.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts resolves the workflow-progress.json path using the CODING_ROOT environment variable, making it portable across Docker volume mount configurations without hardcoded paths

### Siblings
- [WorkflowProgressReader](./WorkflowProgressReader.md) -- llm-mock-service.ts constructs the workflow-progress.json path by joining the CODING_ROOT environment variable with the relative filename, making the service portable across any Docker volume mount layout without code changes.


---

*Generated from 3 observations*
