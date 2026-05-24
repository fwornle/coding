# WorkflowProgressReader

**Type:** Detail

Because path resolution is driven by CODING_ROOT at runtime, the same Docker image can be pointed at different project roots simply by changing the environment variable, which is the portability guarantee described in the sub-component summary.

# WorkflowProgressReader — Technical Insight Document

## What It Is

WorkflowProgressReader is a sub-component implemented within `llm-mock-service.ts`, responsible for locating and parsing the `workflow-progress.json` file that drives downstream mock/live routing decisions in the LLM service. Rather than existing as a standalone module, it is a logical concern embedded inside the larger `LLMMockService` entry point, where path resolution and JSON parsing happen before any LLM invocation proceeds.

The reader's defining characteristic is its dependence on the `CODING_ROOT` environment variable for path construction. By joining `CODING_ROOT` with the relative `workflow-progress.json` filename at runtime, it produces an absolute path that is fully decoupled from the container's physical filesystem layout. This makes the entire service portable: the same Docker image can be redeployed against different project roots simply by changing an environment variable, with no code modifications required.

Because it sits at the very start of every LLM call path inside `llm-mock-service.ts`, WorkflowProgressReader functions as a precondition gate — its output is consumed before the sibling `MockModeGate` makes any routing decision between mock and live LLM execution.

## Architecture and Design

The architectural approach reflects a deliberate separation between **configuration** (where to find data) and **behavior** (what to do with that data). By externalizing path resolution to the `CODING_ROOT` environment variable, the design follows the Twelve-Factor App principle of storing config in the environment, eliminating hardcoded filesystem assumptions that would otherwise couple the Docker image to a specific deployment topology.

Within the hierarchy, WorkflowProgressReader is a child of `LLMMockService` and a peer of `MockModeGate`. The two siblings form a clear pipeline: the reader resolves and loads `workflow-progress.json`, and the gate then consumes the parsed state to enforce the mock-vs-live decision. Because `llm-mock-service.ts` is the single entry point for LLM invocations within the Dockerized service, this pipeline executes uniformly for every call — there is no bypass path, and no caller-side duplication of the decision logic.

The design leans on **runtime path composition** rather than build-time configuration. This is a conscious trade-off: it adds a small amount of runtime work (environment lookup plus path join) in exchange for image reusability across project roots and Docker volume mount layouts. The pattern is "image once, mount anywhere," and the reader is the linchpin that makes it work.

## Implementation Details

The core mechanics are concentrated in `llm-mock-service.ts`. The reader constructs its target path by joining the `CODING_ROOT` environment variable with the relative filename `workflow-progress.json`. This composition happens at runtime on each invocation path, ensuring that changes to the environment variable take effect without requiring a rebuild of the Docker image.

Once the path is resolved, the reader parses the JSON contents — either synchronously or asynchronously — before any mock/live routing logic executes. This sequencing is significant: the parsed workflow progress state is a hard dependency of the `MockModeGate` decision, so the reader must complete successfully before the gate can run. In practice, this means WorkflowProgressReader is positioned at the very top of every LLM call path inside the service.

No standalone code symbols are exported for this sub-component; it is an inline responsibility within `llm-mock-service.ts` rather than a separately testable class or function. This reflects its tight coupling to the service's single-entry-point design — the reader exists to feed `LLMMockService`'s routing logic, and it is not intended for reuse outside that context.

## Integration Points

The primary integration is with the `CODING_ROOT` environment variable, which serves as the sole external input controlling path resolution. This single point of configuration is what enables the portability guarantee: any Docker volume mount layout can be supported by setting `CODING_ROOT` appropriately at container startup.

Downstream, the reader integrates directly with `MockModeGate`, its sibling sub-component. The parsed `workflow-progress.json` payload is the input that `MockModeGate` uses to determine whether a given LLM call should be served by the mock backend or forwarded to a live LLM. Because `llm-mock-service.ts` is the single entry point for LLM invocations, this reader-to-gate handoff is the canonical decision pipeline for the entire service.

Upstream, the reader is invoked by `LLMMockService` itself — the parent component that contains both this reader and the `MockModeGate`. There are no other consumers; the reader's lifecycle is entirely scoped to the service's call path.

## Usage Guidelines

Developers working with WorkflowProgressReader should treat `CODING_ROOT` as a required runtime environment variable for the Dockerized LLM mock service. Failing to set it, or pointing it at a directory that does not contain `workflow-progress.json`, will break every LLM call path because the reader executes before any routing decision can be made. When deploying the same image against a new project root, the correct action is to update the environment variable and remount the appropriate volume — never to patch the image or hardcode a path.

Do not attempt to bypass the reader or duplicate its logic in upstream callers. The design intentionally places it at the single entry point in `llm-mock-service.ts` so that the mock/live routing decision is consistent for all invocations. Adding parallel path-resolution logic elsewhere would undermine the portability guarantee and could lead to divergent behavior between code paths.

When extending the service, preserve the ordering invariant: the reader must complete before `MockModeGate` runs. Any new logic that depends on workflow progress state should consume the already-parsed output rather than re-reading the file, both for performance and to ensure a single consistent view of state within a given call.

---

**Architectural patterns identified:** Environment-driven configuration (Twelve-Factor config), single entry-point gating, precondition-loader pipeline (reader → gate), and embedded sub-component composition within a parent service module.

**Design decisions and trade-offs:** Runtime path composition via `CODING_ROOT` trades a tiny per-call cost for full image portability across Docker volume mounts. Embedding the reader inline in `llm-mock-service.ts` (rather than extracting it as a reusable module) trades general-purpose reusability for tight cohesion with the service's single-entry-point architecture.

**System structure insights:** WorkflowProgressReader and `MockModeGate` form a two-stage pipeline under `LLMMockService`, with the reader supplying state that the gate consumes. The structure is linear and centralized — there is exactly one place where workflow progress is read and exactly one place where the mock/live decision is made.

**Scalability considerations:** The reader executes on every LLM call path, so its synchronous or asynchronous parsing of `workflow-progress.json` is on the hot path. For high-throughput scenarios, caching the parsed contents (with appropriate invalidation when the file changes) would reduce repeated filesystem and JSON-parse overhead, though this is not described in the current observations.

**Maintainability assessment:** Maintainability is strong on the portability axis — the `CODING_ROOT` indirection means deployment changes never require code changes. It is weaker on the testability axis, since the reader is not exposed as an independent symbol and is coupled to `llm-mock-service.ts`. Future refactors that need to unit-test path resolution or JSON parsing in isolation may benefit from extracting the reader into a discrete function while preserving its position at the start of the call path.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts resolves the workflow-progress.json path using the CODING_ROOT environment variable, making it portable across Docker volume mount configurations without hardcoded paths

### Siblings
- [MockModeGate](./MockModeGate.md) -- llm-mock-service.ts acts as the single entry point for LLM invocations within the Dockerized service, so the gate is the only place where the mock/live decision is enforced rather than scattered across callers.


---

*Generated from 3 observations*
