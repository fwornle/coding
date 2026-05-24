# ModeResolutionChain

**Type:** Detail

The third and final tier reads the legacy `mockLLM` boolean field, which activates only when neither `perAgentOverrides` nor `globalMode` is populated; this makes it a pure backward-compatibility shim that cannot override the newer fields, preserving function for pre-`llmState` callers.

# ModeResolutionChain

## What It Is

The `ModeResolutionChain` is the resolution algorithm implemented inside `getLLMMode()` in `llm-mock-service.ts` that determines which LLM mode applies to a given agent at the moment of invocation. It is not a standalone class but rather a tiered lookup sequence executed sequentially against the `llmState` object, walking through three configuration sources in strict priority order: `llmState.perAgentOverrides`, `llmState.globalMode`, and the legacy `mockLLM` boolean field.

As a `Detail`-level component contained within `LLMModeController`, the chain represents the controller's core decision logic. Where `LLMModeController` exposes the public surface for mode resolution, the `ModeResolutionChain` encodes the specific precedence rules that translate raw state into a concrete mode answer. Its sibling component `AgentOverrideRegistry` supplies the highest-priority data source the chain consults — the keyed map of agent identifiers to LLM mode strings stored at `llmState.perAgentOverrides`.

The chain's purpose is to reconcile three distinct configuration tiers — fine-grained per-agent overrides, a workflow-wide global mode, and a legacy boolean — into a single, deterministic answer for every `getLLMMode()` call, while preserving backward compatibility with pre-`llmState` callers.

## Architecture and Design

The architectural pattern at work is a classic **Chain of Responsibility** with strict prioritization, also recognizable as a **fallback/cascading configuration lookup**. Each tier is evaluated in fixed order, and the first tier that yields a non-empty answer terminates the chain. This pattern is well-suited to configuration systems where specificity should beat generality: an explicit per-agent setting overrides a system-wide default, which in turn overrides a deprecated legacy flag.

The design decision to evaluate the chain **at call time** rather than caching the resolved mode at startup is significant. Because `getLLMMode()` re-inspects `llmState` on every invocation, mutations to `llmState.perAgentOverrides` or `llmState.globalMode` mid-workflow propagate immediately to the next agent invocation. This trades a small amount of repeated lookup work for runtime reconfigurability — a service restart is never required to change LLM routing behavior. This pairs naturally with `AgentOverrideRegistry`'s role as a mutable keyed map, since registry changes become observable without coordination.

The three-tier ordering — per-agent override → global mode → legacy boolean — encodes a deliberate hierarchy of intent. The most specific signal (an explicit override for *this* agent) is honored first; the most general modern signal (the global dial) comes second; and the legacy `mockLLM` boolean is treated as a pure compatibility shim that can never override either of the newer fields. This ordering ensures that new code paths using `llmState` always take precedence over old code paths, which is the safer migration direction.

A subtle but important architectural trade-off is that the chain is encoded inline within `getLLMMode()` rather than as a pluggable list of resolver objects. This keeps the implementation small, readable, and free of indirection, but it also means adding a new tier requires editing `llm-mock-service.ts` directly. For a system with exactly three well-understood tiers, this is the right balance.

## Implementation Details

The chain is implemented entirely within `getLLMMode()` in `llm-mock-service.ts`. The function receives the identifier of the requesting agent and uses it to perform the first-tier lookup: `llmState.perAgentOverrides` is indexed by that agent identifier. Because `perAgentOverrides` is a keyed map (as documented for the sibling `AgentOverrideRegistry`, where each entry associates a named agent identifier with a specific LLM mode string), the lookup is a direct key access. A hit at this tier returns the override's mode string and short-circuits the rest of the chain — this is what makes per-agent configuration the "highest-priority tier" and guarantees agent-specific settings always win over any system-wide state.

If the per-agent lookup yields no entry, the chain falls through to the second tier and reads `llmState.globalMode`. This field acts as a single-point dial: setting it changes the LLM backend for every agent that has not been individually overridden via `AgentOverrideRegistry`. The check is a simple presence test on the field; a populated `globalMode` returns immediately as the resolved answer.

The third and final tier reads the legacy `mockLLM` boolean. Crucially, this tier is only consulted when **both** `perAgentOverrides` (for this agent) and `globalMode` are unpopulated. This precedence ordering — placing `mockLLM` strictly last — converts the legacy field into a pure backward-compatibility shim. Pre-`llmState` callers that still set `mockLLM` continue to function correctly, but they can never silently override callers that have moved to the newer `llmState`-based API.

Because the entire chain executes synchronously inside `getLLMMode()` on every call, there is no caching layer, no memoization, and no startup snapshot. State mutations to `llmState` are visible on the very next invocation. This makes the resolution behavior fully driven by the current state of the `llmState` object at the moment of the call.

## Integration Points

The chain's primary dependency is the `llmState` object itself, which it reads three distinct fields from: `perAgentOverrides`, `globalMode`, and `mockLLM`. The `perAgentOverrides` field is the data structure described by the sibling component `AgentOverrideRegistry`, so any code that mutates the registry — adding, removing, or changing per-agent entries — directly influences the chain's first-tier outcome. There is an implicit contract here: the registry is responsible for maintaining `perAgentOverrides` as a well-formed keyed map indexed by agent identifier.

The chain is consumed by the parent `LLMModeController`, which exposes `getLLMMode()` as its primary operation. Any caller asking the controller "what mode should this agent use?" is ultimately exercising the chain. This positions the chain as the single source of truth for mode resolution decisions within the `llm-mock-service.ts` module.

Backward compatibility with the legacy `mockLLM` boolean is the chain's third integration surface. Callers that predate `llmState` and still toggle `mockLLM` directly will still see correct behavior, provided no newer caller has populated `perAgentOverrides` or `globalMode`. This makes the chain a migration bridge between two generations of the configuration API.

## Usage Guidelines

Developers should treat the precedence order as a contract: **per-agent overrides always win, global mode is the universal fallback, and `mockLLM` is legacy-only**. When introducing new code, prefer setting `llmState.globalMode` for workflow-wide changes and registering entries through `AgentOverrideRegistry` (i.e., populating `llmState.perAgentOverrides`) for agent-specific routing. Avoid setting `mockLLM` in new code; it exists solely to keep older callers functioning.

Because the chain re-evaluates `llmState` on every call to `getLLMMode()`, runtime reconfiguration is supported and expected. There is no need to flush caches or restart services when changing modes — simply mutate `llmState` and the next agent invocation will observe the change. This is especially useful for heterogeneous agent fleets within the same workflow, where different agents may need to target different backends simultaneously via per-agent overrides.

Be aware that a per-agent override silently masks the global mode for that agent. When debugging unexpected mode behavior, always check `llmState.perAgentOverrides` for the specific agent identifier *first*, before assuming `globalMode` is in effect. Conversely, when you want a global setting to apply universally, ensure no stale per-agent entries remain in the registry.

Finally, because the chain lives inline inside `getLLMMode()` in `llm-mock-service.ts`, modifications to the precedence order or the addition of new tiers require editing that function directly. Any such change should preserve the invariant that newer configuration mechanisms take precedence over older ones, so that migration paths remain safe and backward-compatible.

---

## Summary of Key Insights

1. **Architectural patterns identified**: Chain of Responsibility with strict prioritization; cascading configuration fallback; call-time (uncached) resolution.

2. **Design decisions and trade-offs**: Inline tiered logic chosen over pluggable resolvers (simplicity vs. extensibility); call-time evaluation chosen over startup caching (runtime reconfigurability vs. per-call cost); legacy `mockLLM` placed last (backward compatibility without risk of overriding modern fields).

3. **System structure insights**: The chain is the decision core of `LLMModeController`, consuming the keyed map maintained by its sibling `AgentOverrideRegistry`, and bridging two generations of configuration API (`llmState` vs. legacy `mockLLM`).

4. **Scalability considerations**: Per-call evaluation scales with the number of agent invocations, but each evaluation is a small fixed-cost sequence of field accesses and a single map lookup — negligible overhead. Heterogeneous fleets are natively supported through per-agent entries.

5. **Maintainability assessment**: The implementation is concentrated in a single function in `llm-mock-service.ts`, making the precedence logic easy to read and audit. The strict tier ordering provides a clear mental model for debugging. The main maintainability caveat is that adding a new configuration tier requires editing the function inline rather than registering a new resolver, but for the current three-tier design this is appropriate.


## Hierarchy Context

### Parent
- [LLMModeController](./LLMModeController.md) -- `getLLMMode()` in `llm-mock-service.ts` evaluates `llmState.perAgentOverrides` first, making per-agent configuration the highest-priority tier; only if no override exists for the requesting agent does it fall through to the lower tiers

### Siblings
- [AgentOverrideRegistry](./AgentOverrideRegistry.md) -- `llmState.perAgentOverrides` is a keyed map where each entry associates a named agent identifier with a specific LLM mode string, allowing heterogeneous agent fleets within the same workflow to target different backends simultaneously.


---

*Generated from 4 observations*
