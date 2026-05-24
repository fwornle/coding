# AgentModeOverrideStore

**Type:** Detail

setAgentLLMMode writes a keyed entry into .data/workflow-progress.json whose key identifies the agent and whose value is the chosen mode; getLLMState in llm-mock-service.ts looks up this key before consulting the global mode field, establishing agent entries as the highest-priority tier.

# AgentModeOverrideStore

## What It Is

`AgentModeOverrideStore` is the persistence-backed tier of LLM mode resolution implemented through entries written into `.data/workflow-progress.json`. It is not a class in the traditional object-oriented sense but rather a logical store materialized by the interaction between the `setAgentLLMMode` writer function and the `getLLMState` reader function in `llm-mock-service.ts`. Each entry in this store is keyed by an agent identifier, with the value representing that specific agent's chosen LLM mode.

Within the broader system, `AgentModeOverrideStore` sits inside `LLMStateManager` and serves as the highest-priority data source consulted during mode resolution. When `getLLMState()` is invoked, it first looks up the agent-specific key in this store before falling back to any global configuration, making per-agent overrides the authoritative answer when present.

## Architecture and Design

The architectural approach reflects a **file-backed key-value store** pattern layered beneath a **priority resolution chain**. By choosing `.data/workflow-progress.json` as the backing medium rather than in-process memory, the design deliberately externalizes state so it can persist across `getLLMState()` invocations and remain inspectable or mutable by entities outside the service code itself — including test harnesses and human operators. This trades the speed of memory-resident state for transparency, observability, and external controllability.

Within `LLMStateManager`, `AgentModeOverrideStore` cooperates with its sibling `ModeResolutionChain`, which defines the three-tier evaluation order: per-agent override (sourced from this store), the global mode field, and the literal fallback string `'public'`. The first matching tier short-circuits subsequent ones, so the presence of an agent entry in the store is sufficient to determine the final mode. This separation of concerns — where `AgentModeOverrideStore` owns the per-agent data plane and `ModeResolutionChain` owns the resolution logic — keeps both components individually testable and predictable.

A subtle design decision is the choice to encode override values using a three-value mode enum that supersedes an older `mockLLM` boolean representation. Rather than performing a destructive migration, `getLLMState` is designed to accommodate both representations when reading per-agent entries, treating the store as schema-tolerant. This reflects a pragmatic approach to backward compatibility in a system where the JSON file may have been written by earlier code paths.

## Implementation Details

The write path is governed by `setAgentLLMMode`, which inserts a keyed entry into `.data/workflow-progress.json`. The key identifies the agent and the value captures the chosen mode using the current three-value mode enum. Because the operation targets a flat JSON file, the write is effectively a serialization of the in-memory representation back to disk, ensuring durability for subsequent reads.

The read path runs through `getLLMState` in `llm-mock-service.ts`. At invocation time, this function reads `.data/workflow-progress.json` and consults agent-keyed entries first. If an entry exists for the relevant agent, its mode value is returned without further evaluation. The reader must handle both the modern three-value mode enum and the legacy `mockLLM` boolean format that earlier callers may have written, which requires conditional interpretation of the stored value before the result is returned to the caller.

Because `getLLMState()` reads `.data/workflow-progress.json` at the moment of invocation rather than caching its contents, mode changes take effect immediately on subsequent calls. This enables runtime mode switching without service restarts — a capability that depends entirely on the file-backed design choice for `AgentModeOverrideStore`.

## Integration Points

The most direct integration is with `LLMStateManager`, the parent component that orchestrates the read flow through `getLLMState()` in `llm-mock-service.ts`. `AgentModeOverrideStore` provides the data that `LLMStateManager` exposes to its consumers, but it does so indirectly through the JSON file rather than a programmatic interface.

The sibling `ModeResolutionChain` is the primary internal consumer. Because it evaluates the per-agent override tier first, every resolution operation effectively performs a lookup against `AgentModeOverrideStore`. The contract between these two components is the schema of the agent-keyed entries in `.data/workflow-progress.json` — including the tolerance for both the three-value mode enum and the legacy `mockLLM` boolean.

External integrators — including test harnesses and operators — interact with `AgentModeOverrideStore` directly through the file system. They can inspect the current state by reading `.data/workflow-progress.json` and modify overrides by editing the corresponding agent keys, all without invoking service code. This forms an implicit operational interface that complements the programmatic `setAgentLLMMode` path.

## Usage Guidelines

When writing per-agent overrides, prefer `setAgentLLMMode` over hand-editing `.data/workflow-progress.json`, as the function encapsulates the correct schema (three-value mode enum) and shields callers from the legacy `mockLLM` boolean concern. Direct file edits should be reserved for operational or testing scenarios where bypassing the service path is intentional.

Developers should be aware that any entry placed in `AgentModeOverrideStore` will take precedence over the global mode field consulted later in the `ModeResolutionChain`. This makes the store powerful for targeted scenarios — such as forcing a single agent into a specific mode during a test — but it also means stale or forgotten entries can silently override intended global behavior. Periodic auditing or cleanup of `.data/workflow-progress.json` is advisable in long-lived environments.

When reading values, do not assume the modern three-value mode enum is the only possible representation. The store is schema-tolerant by design, and any code that interprets entries outside `getLLMState` must replicate its accommodation of both the enum and the legacy `mockLLM` boolean. Failing to do so risks divergent interpretations of the same on-disk state.

Finally, because `getLLMState()` reads the file at invocation time, callers benefit from runtime mode switching without service restarts. This should be treated as an intentional capability of the design rather than an incidental side effect, and any future refactor that introduces caching must preserve this property or provide an explicit invalidation mechanism.

---

### Summary of Key Insights

1. **Architectural patterns identified**: File-backed key-value store; priority resolution chain (per-agent → global → literal default); schema-tolerant reader accommodating legacy and current value formats.
2. **Design decisions and trade-offs**: External JSON persistence chosen over in-memory state to gain inspectability and external controllability at the cost of file I/O on every read; non-destructive coexistence of the three-value enum with the legacy `mockLLM` boolean preserves backward compatibility.
3. **System structure insights**: Clean separation between the data tier (`AgentModeOverrideStore`) and the resolution logic (`ModeResolutionChain`), both encapsulated within `LLMStateManager`.
4. **Scalability considerations**: A flat JSON file is appropriate for the agent-count scale implied by the design; large-scale agent populations would eventually pressure read/write performance and motivate a more structured store.
5. **Maintainability assessment**: High transparency due to the human-readable backing file, and resilience through dual-format tolerance; however, the implicit operational interface (direct file edits) demands disciplined cleanup to avoid stale overrides masking global configuration.


## Hierarchy Context

### Parent
- [LLMStateManager](./LLMStateManager.md) -- getLLMState() in llm-mock-service.ts reads .data/workflow-progress.json at invocation time, enabling runtime mode switching without service restarts

### Siblings
- [ModeResolutionChain](./ModeResolutionChain.md) -- getLLMState() in llm-mock-service.ts evaluates three tiers in order — per-agent override, global mode, then the literal string 'public' — so the first matching tier short-circuits the rest, keeping the resolution path predictable and testable.


---

*Generated from 3 observations*
