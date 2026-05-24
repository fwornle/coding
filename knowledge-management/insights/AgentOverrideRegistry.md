# AgentOverrideRegistry

**Type:** Detail

Because `getLLMMode()` in `llm-mock-service.ts` reads `perAgentOverrides` before any other tier, entries written via `setAgentLLMMode` unconditionally shadow `globalMode` and the legacy `mockLLM` flag for the named agent, giving operators fine-grained control without touching system-wide settings.

# AgentOverrideRegistry — Technical Insight Document

## What It Is

The `AgentOverrideRegistry` is implemented as the `perAgentOverrides` field on the `llmState` structure, consumed by `getLLMMode()` in `llm-mock-service.ts` and persisted to `workflow-progress.json`. It is a keyed map data structure where each entry associates a named agent identifier with a specific LLM mode string. Functionally, it serves as the highest-priority configuration tier within the broader `LLMModeController`, enabling per-agent routing decisions that override any system-wide defaults.

The registry exists to solve a concrete operational problem: in workflows containing heterogeneous agent fleets, individual agents may need to target different LLM backends simultaneously. Rather than forcing a single global routing decision across all agents, `AgentOverrideRegistry` allows fine-grained, agent-by-agent selection of which LLM mode each named agent should use during execution.

As a sub-component of `LLMModeController`, it works in coordination with its sibling `ModeResolutionChain`, which is the resolution mechanism that actually reads from this registry first when determining which mode applies to any given request.

## Architecture and Design

The architectural approach is a **layered fallback resolution pattern** with `AgentOverrideRegistry` occupying the topmost layer. The design treats per-agent overrides as the most specific (and therefore highest-priority) form of configuration, falling through to broader tiers (such as `globalMode` and the legacy `mockLLM` flag) only when no agent-specific entry exists. This is a classic specificity-wins precedence model, mirrored in many configuration systems where local settings shadow global ones.

A second important pattern is **centralized mutation through a single sanctioned write path**. The `setAgentLLMMode` function is the sole entry point for writing into `perAgentOverrides`. This is a deliberate encapsulation decision: by routing all mutations through one function, the system ensures consistent validation, logging, and side-effect handling, and avoids the maintenance burden of scattered direct-write call sites mutating the map from arbitrary locations.

The registry is also designed for **state durability**. By embedding `perAgentOverrides` inside the serializable `llmState` structure that is persisted to `workflow-progress.json`, the design ensures that override decisions survive process restarts. This aligns with the broader workflow-resumption model in the system — agents resuming after an interruption see the same routing topology they had before, eliminating a class of subtle bugs where restarts silently revert agents to default backends.

The interaction with the sibling `ModeResolutionChain` is straightforward and unidirectional: `ModeResolutionChain` reads from `AgentOverrideRegistry` as its first step during resolution. The registry itself has no awareness of the chain — it is purely a data store, with semantics defined externally by the reader.

## Implementation Details

The core data structure is `llmState.perAgentOverrides`, a keyed map whose keys are agent identifiers (the named identity of an agent within a workflow) and whose values are LLM mode strings. The lookup pattern is direct key access: when `getLLMMode()` in `llm-mock-service.ts` needs to resolve a mode, it uses the requesting agent's identifier to probe `perAgentOverrides` first.

Writes are exclusively performed by `setAgentLLMMode`. This function accepts an agent identifier and a mode string and inserts or updates the corresponding entry in `perAgentOverrides`. Centralizing the write path means any future cross-cutting concerns (auditing, validation of mode values, broadcasting change events) can be added in one place without hunting through the codebase for direct mutations.

The read path is implemented inside `getLLMMode()` in `llm-mock-service.ts`. The function's opening logic inspects `perAgentOverrides` keyed on the requesting agent's identifier. If a value is present, that value is returned immediately and unconditionally — it shadows `globalMode` and the legacy `mockLLM` flag entirely. If no entry exists, control falls through to lower resolution tiers handled by the rest of `ModeResolutionChain`.

Persistence is achieved by virtue of `perAgentOverrides` being a field of the `llmState` object, which is itself serialized to `workflow-progress.json`. There is no separate persistence mechanism for the registry; it inherits durability from the enclosing state container. Restoration on workflow resume is similarly automatic — when `llmState` is deserialized, `perAgentOverrides` is reconstructed in full, and all subsequent `getLLMMode()` calls behave as they did before the restart.

## Integration Points

The primary integration is with `getLLMMode()` in `llm-mock-service.ts`, which is the consumer that gives the registry its semantic meaning. Without this reader's tier-first ordering, `perAgentOverrides` would simply be an inert map. The contract between the registry and `getLLMMode()` is the foundation on which per-agent routing rests.

The registry also integrates with the broader `LLMModeController` through its sibling `ModeResolutionChain`. While `AgentOverrideRegistry` stores the per-agent decisions, `ModeResolutionChain` defines the order in which override sources are consulted, placing `AgentOverrideRegistry` first, followed by global and legacy sources. The two siblings together form the complete resolution model for `LLMModeController`.

The persistence integration occurs through `workflow-progress.json`, the on-disk representation of workflow state. Because `perAgentOverrides` lives inside `llmState`, any workflow checkpoint or resume operation that touches `llmState` automatically picks up the registry. This makes the registry implicitly coupled to the workflow checkpoint schema — any breaking change to `llmState` serialization would affect override durability.

Finally, the write-side integration point is `setAgentLLMMode`, the public API through which operators (or higher-level orchestration code) inject per-agent decisions. Any subsystem wishing to direct a specific agent at a specific backend must call this function rather than manipulating the map directly.

## Usage Guidelines

Developers should treat `setAgentLLMMode` as the only legitimate way to modify `perAgentOverrides`. Direct mutation of the map bypasses the centralization invariant and risks introducing inconsistencies, missed audit hooks, or future regressions when validation logic is added to the sanctioned write path. If a need arises to perform a bulk or specialized update, the right approach is to extend `setAgentLLMMode` or add a sibling function with the same disciplined entry-point semantics — not to reach into `perAgentOverrides` directly.

Operators should understand the precedence implication: any entry placed in `AgentOverrideRegistry` for an agent will unconditionally shadow `globalMode` and the legacy `mockLLM` flag for that agent. This is powerful but means stale entries can silently override what looks like a correct global configuration. When troubleshooting unexpected routing behavior, the registry should be the first place to inspect, since it is the first tier `getLLMMode()` consults.

Because the registry persists into `workflow-progress.json`, overrides set during one process lifetime will reappear after a restart or resume. This is intentional — it preserves routing continuity across execution boundaries — but it means developers must be deliberate about cleanup. If a per-agent override was only intended to be temporary (for example, for a single debugging run), it should be explicitly cleared rather than relied upon to disappear when the process exits.

When designing new agents or workflow patterns, prefer to leave `perAgentOverrides` empty unless heterogeneous routing is genuinely required. Allowing the resolution to fall through to `globalMode` keeps configuration centralized and predictable. Reserve `AgentOverrideRegistry` for cases where the heterogeneity of agent fleets demands it, in line with the design intent of supporting "heterogeneous agent fleets within the same workflow."

---

### Summary Analysis

**Architectural patterns identified:** Layered fallback resolution with specificity-wins precedence; centralized mutation through a single sanctioned write path; durable state via embedded serialization; clear separation between data store (`AgentOverrideRegistry`) and resolution policy (`ModeResolutionChain`).

**Design decisions and trade-offs:** Choosing `perAgentOverrides` as the highest-priority tier trades configuration simplicity for operational flexibility — fine-grained control comes at the cost of stale-entry risk. Centralizing writes through `setAgentLLMMode` trades a small amount of indirection for strong maintainability guarantees. Persisting into `workflow-progress.json` trades ephemeral cleanliness for resume continuity.

**System structure insights:** The registry is a thin, data-centric sub-component within `LLMModeController`, deriving meaning from its consumer `getLLMMode()` and its sibling `ModeResolutionChain`. This separation keeps responsibilities crisp: storage, resolution policy, and consumption are distinct concerns.

**Scalability considerations:** As a keyed map, lookup scales as O(1) per agent. The size of `perAgentOverrides` grows linearly with the number of agents that need overrides, which in practice is bounded by workflow size. Serialization cost into `workflow-progress.json` likewise scales linearly with registry size.

**Maintainability assessment:** Strong. The single-write-path discipline, the colocation of the registry within `llmState`, and the clean read-time semantics in `getLLMMode()` make the component easy to reason about. The main maintenance risk is implicit coupling to the `workflow-progress.json` schema, which should be considered before any changes to `llmState` shape.


## Hierarchy Context

### Parent
- [LLMModeController](./LLMModeController.md) -- `getLLMMode()` in `llm-mock-service.ts` evaluates `llmState.perAgentOverrides` first, making per-agent configuration the highest-priority tier; only if no override exists for the requesting agent does it fall through to the lower tiers

### Siblings
- [ModeResolutionChain](./ModeResolutionChain.md) -- `getLLMMode()` in `llm-mock-service.ts` opens by inspecting `llmState.perAgentOverrides` keyed on the requesting agent's identifier, making per-agent configuration the highest-priority tier and ensuring agent-specific settings always win over any system-wide state.


---

*Generated from 4 observations*
