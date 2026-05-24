# BaseAgentConstructorContract

**Type:** Detail

As documented in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md, every BaseAgent subclass must accept exactly two constructor parameters — repoPath and team — establishing a uniform configuration-capture interface across all agent implementations.

# BaseAgentConstructorContract

## What It Is

The `BaseAgentConstructorContract` is an architectural contract documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` that governs how every `BaseAgent` subclass is constructed. It mandates a uniform constructor signature — `constructor(repoPath, team)` — accepting exactly two parameters and restricting constructor behavior to capturing these configuration values. The contract is not merely a coding convention; it is a named architectural guarantee that explicitly forbids the allocation of any LLM client during object construction.

As a `Detail` under the parent component `AgentLifecyclePatterns`, this contract defines the first stage of an agent's lifecycle: the lightweight, side-effect-free instantiation phase. It works in deliberate complement to its sibling component, `EnsureLLMInitializedGuard`, which handles the deferred LLM client allocation that this contract explicitly prohibits at construction time.

The contract applies systemically across the entire agent hierarchy. All `BaseAgent` subclasses documented in `agents.md` conform to the same `(repoPath, team)` signature, making this a foundational invariant of the agent system rather than an isolated design choice in any single class.

## Architecture and Design

The architectural approach embodied by `BaseAgentConstructorContract` reflects a clear separation between **configuration capture** and **resource initialization** — two responsibilities that are frequently conflated in less disciplined object-oriented designs. By restricting the constructor to capturing only `repoPath` and `team`, the design enforces a "pure construction" pattern: instantiating a `BaseAgent` subclass has no I/O cost, no network dependency, and no risk of construction-time failure tied to external systems.

This is a deliberate decoupling pattern. Object creation is decoupled from I/O-bound initialization, which means agents can be instantiated safely in contexts where LLM connectivity is not yet confirmed, not yet configured, or simply not needed. Common scenarios that benefit from this design include test setup, agent registration, dependency injection wiring, and lazy-loaded execution pipelines where an agent may be constructed but never invoked.

The contract operates in tight coordination with `EnsureLLMInitializedGuard`, its sibling under `AgentLifecyclePatterns`. Where `BaseAgentConstructorContract` defines what cannot happen at construction, `EnsureLLMInitializedGuard` defines the deferred initialization pathway — the `ensureLLMInitialized()` mechanism documented in `agents.md` — that supplies the LLM client when actually needed. Together, these two contracts form a two-phase lifecycle: cheap, deterministic construction followed by on-demand, idempotent resource initialization.

## Implementation Details

The implementation contract specifies exactly two constructor parameters: `repoPath` (a path to the repository the agent will operate against) and `team` (the team context identifying organizational or grouping metadata). The constructor's sole responsibility is to capture these values into instance state. No additional parameters are permitted, ensuring all subclasses present a uniform construction interface.

The prohibition against LLM client instantiation during construction is the contract's most consequential implementation rule. This means no synchronous or asynchronous calls to LLM SDK constructors, no credential resolution that might trigger network calls, and no eager resource allocation of any kind during the `constructor` body. The resulting object is in a "configured but not initialized" state — it knows what to operate against but has not yet established the runtime resources needed to operate.

Because the parent `AgentLifecyclePatterns` documents this constraint in `agents.md` as systemic, every subclass in the agent hierarchy must honor it. Subclasses are not free to extend the constructor signature or to relax the prohibition; doing so would break the uniform instantiation contract that downstream consumers rely upon. The actual LLM client allocation must occur later, via the pathway formalized by `EnsureLLMInitializedGuard`.

## Integration Points

The contract integrates primarily with two adjacent concerns. First, it integrates with `EnsureLLMInitializedGuard` (its sibling), which provides the corresponding deferred-initialization mechanism. The two are complementary halves of a single lifecycle: any consumer that constructs a `BaseAgent` subclass must subsequently invoke the guarded initialization path before performing LLM-dependent work.

Second, the contract integrates with any system or framework code that instantiates agents — including registries, factory functions, test harnesses, and dependency injection contexts. Because instantiation is guaranteed to be lightweight and side-effect-free, these integration points can construct agents freely without needing to manage LLM connectivity, credentials, or asynchronous setup at the construction boundary.

The reference documentation lives at `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, which serves as the canonical specification both for this contract and for the broader `AgentLifecyclePatterns` parent that contains it. Any new agent introduced to the system must be checked against this documentation to verify constructor signature conformance and the absence of LLM allocation in its constructor body.

## Usage Guidelines

When implementing a new `BaseAgent` subclass, the constructor must accept exactly `(repoPath, team)` and must do nothing beyond capturing these values into instance state. Developers should not add additional constructor parameters, should not invoke any LLM SDK constructors, and should not perform any I/O, network calls, or credential resolution at this stage. If additional configuration is needed, it should be exposed through methods or properties that are invoked after construction — never folded into the constructor itself.

Consumers of `BaseAgent` subclasses should treat construction as a cheap, safe operation. They should not wrap instantiation in try/catch blocks for LLM connectivity errors, because no such errors can occur at construction by contract. Before invoking any method that depends on LLM capabilities, however, consumers must engage the deferred initialization pathway documented under `EnsureLLMInitializedGuard` — typically `ensureLLMInitialized()` — to materialize the LLM client.

Maintainers reviewing pull requests that touch agent constructors should treat any new I/O, any LLM client allocation, or any deviation from the `(repoPath, team)` signature as a contract violation. Because the contract is systemic across the agent hierarchy, even a single deviation undermines the architectural guarantee and weakens the invariants that callers rely upon. Preserving the contract preserves the predictability of agent instantiation across the entire system, which in turn supports clean testing, safe registration, and reliable lazy evaluation patterns.

---

### Architectural Summary

1. **Architectural patterns identified**: Two-phase initialization (construction vs. resource allocation), uniform constructor interface across a class hierarchy, separation of configuration capture from I/O-bound setup, and contract-driven design specified in architectural documentation rather than enforced solely by code.

2. **Design decisions and trade-offs**: The decision to forbid LLM allocation during construction trades a small amount of caller convenience (callers must remember to initialize) for substantial gains in instantiation safety, testability, and lazy-evaluation support. The two-parameter rigidity trades flexibility for systemic uniformity, simplifying consumer code that must handle arbitrary agent types.

3. **System structure insights**: The contract is one of two complementary `Detail` entities under `AgentLifecyclePatterns`. It defines the construction half; `EnsureLLMInitializedGuard` defines the initialization half. Together they form a complete lifecycle specification for every agent in the system.

4. **Scalability considerations**: Lightweight, side-effect-free construction scales well to scenarios involving large numbers of agent instances, agent registries, or test suites that instantiate many agents. Because no LLM resources are allocated at construction, there is no per-instance network or connection overhead until an agent is actually used.

5. **Maintainability assessment**: The contract significantly aids maintainability by making agent instantiation predictable across the hierarchy. New developers can reason about any `BaseAgent` subclass's construction without inspecting subclass-specific logic. The clear documentation in `agents.md` provides a single authoritative reference, and the systemic application of the rule means deviations are immediately visible as anomalies during code review.


## Hierarchy Context

### Parent
- [AgentLifecyclePatterns](./AgentLifecyclePatterns.md) -- BaseAgent subclasses documented in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md all follow a constructor(repoPath, team) signature that captures only configuration context, explicitly forbidding any LLM client instantiation at this stage.

### Siblings
- [EnsureLLMInitializedGuard](./EnsureLLMInitializedGuard.md) -- Because agents.md mandates that constructors never instantiate LLM clients, the architecture requires a separate initialization pathway; the parent component analysis identifies ensureLLMInitialized() in agents.md as that deferred allocation point.


---

*Generated from 4 observations*
