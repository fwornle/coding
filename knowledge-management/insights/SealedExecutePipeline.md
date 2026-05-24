# SealedExecutePipeline

**Type:** Detail

The pipeline unconditionally sequences `process()` → `calculateConfidence()` → `detectIssues()` → `generateRouting()` → `applyCorrections()` with no conditional branching between stages, guaranteeing that every agent invocation always produces a confidence score, issue list, routing metadata, and corrections output.

# SealedExecutePipeline

## What It Is

`SealedExecutePipeline` refers to the sealed `execute()` method defined on `BaseAgent<TInput, TOutput>` in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`. It is the top-level, immutable control flow that governs every agent invocation within the semantic analysis subsystem. By being sealed, `execute()` cannot be overridden, extended, or bypassed by any concrete subclass of `BaseAgent`, ensuring that the orchestration of agent stages remains consistent across every implementation.

The pipeline unconditionally sequences five abstract operations in a fixed order: `process()` → `calculateConfidence()` → `detectIssues()` → `generateRouting()` → `applyCorrections()`. There is no conditional branching, no early termination, and no reordering between these stages. This guarantees that every agent invocation always emits a complete result envelope consisting of processed output, a confidence score, an issue list, routing metadata, and a corrections payload — regardless of the input or the specific agent subclass involved.

This component is documented under Agent Architecture in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, which describes the sealed design as the mechanism for centralizing cross-cutting concerns while delegating domain logic to subclasses.

## Architecture and Design

`SealedExecutePipeline` is the runtime manifestation of the classic **Template Method** design pattern. Its parent entity, `AgentBase` (i.e., `BaseAgent<TInput, TOutput>`), defines the algorithmic skeleton in `execute()` and defers the implementation of each step to abstract methods. The sealing of `execute()` is the enforcement mechanism that prevents subclasses from breaking the template contract — a deliberate inversion of the typical "open for extension" rule, traded here for predictability and uniformity.

The design tightly couples `SealedExecutePipeline` to its sibling `FiveStageAbstractContract`, which declares the five abstract methods (`process`, `calculateConfidence`, `detectIssues`, `generateRouting`, `applyCorrections`) that the pipeline drives. Together, these two components form a complete template-method dyad: the contract specifies *what* must be implemented, and the pipeline specifies *when and in what order* those implementations are invoked. Neither makes sense without the other, and their separation cleanly distinguishes the orchestration concern from the semantic decomposition concern.

A key architectural decision is the **unconditional invocation** of every stage. There is no `if (issues.length > 0) applyCorrections()` guard, no skip logic for low-confidence outputs, and no branching based on `detectIssues()` results. This eliminates an entire class of subtle bugs caused by inconsistent pipeline execution paths, at the cost of forcing every concrete agent to treat empty or trivial inputs as first-class cases. The pipeline thus enforces a uniform shape on agent behavior: confidence is always computed, issues are always inspected, routing is always generated, and corrections are always considered.

The sealed design also centralizes **cross-cutting concerns** — error handling and observability hooks — inside `execute()` itself. This means logging, tracing, exception capture, and metrics collection can be implemented once at the orchestration layer and applied uniformly to every agent. Subclasses focus exclusively on domain logic via the abstract methods exposed by `FiveStageAbstractContract`, with no responsibility for telemetry plumbing.

## Implementation Details

The mechanics are concentrated in `BaseAgent<TInput, TOutput>` within `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`. The generic type parameters `TInput` and `TOutput` allow each concrete agent to specialize the pipeline for its own input and output shapes while preserving the sealed orchestration. The `execute()` method is the entry point that consumers call; it is not meant to be replaced.

Internally, `execute()` calls the five abstract methods in strict sequence. The first call, `process(input)`, performs the agent's primary data transformation. The result feeds into `calculateConfidence()`, which produces a <USER_ID_REDACTED> score. Next, `detectIssues()` runs fault detection on the processed output. Then `generateRouting()` produces dispatch metadata indicating where the result should flow next. Finally, `applyCorrections()` runs self-healing logic — and critically, it runs even when `detectIssues()` returns an empty list. This means concrete implementations of `applyCorrections()` must be written defensively to handle the no-issue case as a valid, safe no-op rather than as an error or an unexpected state.

Cross-cutting concerns surrounding the five stages — such as wrapping exceptions, emitting structured logs, and exposing observability hooks — are implemented once inside the sealed `execute()` body. Because subclasses cannot override `execute()`, these concerns are guaranteed to apply uniformly across every agent in the system. The `FiveStageAbstractContract` sibling enforces that subclasses cannot omit any of the five stages either; the abstract declarations force concrete implementations to provide all five methods, even if some are trivial.

## Integration Points

`SealedExecutePipeline` integrates with the rest of the system through its parent `AgentBase` and its sibling `FiveStageAbstractContract`. Every concrete agent in `integrations/mcp-server-semantic-analysis/src/agents/` that extends `BaseAgent<TInput, TOutput>` is automatically subject to this pipeline. Consumers of agents — orchestrators, dispatchers, and higher-level workflow components — interact only with the public `execute()` method, never with the individual stages directly.

The architectural rationale and the contract between `SealedExecutePipeline` and `FiveStageAbstractContract` are documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` under the Agent Architecture section. This document is the canonical reference for understanding how the sealed control flow interacts with the abstract stage contract.

Because `generateRouting()` produces dispatch metadata as part of every execution, `SealedExecutePipeline` is implicitly an integration point with whatever downstream routing or workflow system consumes that metadata. Similarly, the always-present confidence score and issue list create a uniform integration surface for any monitoring, <USER_ID_REDACTED>-gating, or feedback mechanism that wraps agent execution.

## Usage Guidelines

Developers writing new agents must **not** attempt to override `execute()` — it is sealed by design, and any such attempt undermines the guarantees the pipeline provides. Instead, focus exclusively on implementing the five abstract methods declared by `FiveStageAbstractContract`: `process`, `calculateConfidence`, `detectIssues`, `generateRouting`, and `applyCorrections`.

Because every stage runs unconditionally on every invocation, `applyCorrections()` implementations must explicitly handle the case where `detectIssues()` returned an empty list. The correct pattern is to treat a no-issue input as a valid, safe no-op — returning the unmodified output or an explicit "no corrections needed" payload — rather than raising an error or assuming issues are always present. Similarly, `calculateConfidence()` must always return a meaningful score, and `generateRouting()` must always produce valid routing metadata, even for trivial inputs.

Cross-cutting concerns such as logging, exception handling, and observability should **not** be reimplemented inside the abstract methods. These are handled centrally inside the sealed `execute()` and reimplementing them at the subclass level both duplicates effort and risks inconsistency. If new cross-cutting behavior is needed, it should be added to `execute()` in `BaseAgent` itself so that it applies uniformly to every agent.

From a maintainability standpoint, the sealed pipeline makes agent behavior highly predictable: any developer reading a concrete agent's source knows exactly the order in which its methods will be called and that every method will be called exactly once per invocation. This significantly reduces the cognitive load of reasoning about agent execution and makes the system more scalable to a growing number of concrete agent implementations, since the orchestration logic does not need to be re-verified or re-tested per subclass. The trade-off is reduced flexibility — agents that genuinely need to skip a stage cannot do so — but this trade-off is intentional and aligns with the system's emphasis on uniform, well-shaped agent outputs.


## Hierarchy Context

### Parent
- [AgentBase](./AgentBase.md) -- BaseAgent<TInput, TOutput> in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts uses a template-method pattern where execute() is sealed and unconditionally calls all five abstract methods: process(), calculateConfidence(), detectIssues(), generateRouting(), and applyCorrections()

### Siblings
- [FiveStageAbstractContract](./FiveStageAbstractContract.md) -- Declared in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`, the five abstract methods partition agent behavior into typed semantic stages: data transformation (`process`), <USER_ID_REDACTED> scoring (`calculateConfidence`), fault detection (`detectIssues`), dispatch logic (`generateRouting`), and self-healing (`applyCorrections`).


---

*Generated from 4 observations*
