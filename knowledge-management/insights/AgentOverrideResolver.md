# AgentOverrideResolver

**Type:** Detail

llm-mock-service.ts maintains at least two tiers of mode configuration in workflow-progress.json: a global fallback mode and a per-agent override map, requiring a merge step whenever the effective mode for a specific agent is needed.

# AgentOverrideResolver

## What It Is

`AgentOverrideResolver` is a resolution component implemented within `llm-mock-service.ts` as part of the `LLMMockService` parent. Its purpose is to determine the effective LLM mock mode for any given agent by reconciling two tiers of configuration persisted in `workflow-progress.json`: a global fallback mode that applies system-wide, and a per-agent override map that allows individual agents to opt into a different mode.

The resolver does not own the storage layer itself — that responsibility belongs to its sibling `PersistedModeStore`, which treats `workflow-progress.json` as the single source of truth. Instead, `AgentOverrideResolver` operates as a pure resolution function: given an agent identifier, it consults the persisted configuration and returns the mode that should govern that agent's behavior. This separation means the resolver is concerned with *merge semantics* rather than *durability mechanics*.

Because it is embedded in `LLMMockService`, the resolver participates in the broader mock-mode subsystem that allows LLM behaviors to be deterministically swapped during testing or development within the Docker environment, where process restarts must not disrupt the configured mode.

## Architecture and Design

The architectural approach is a **two-tier configuration merge pattern** with explicit precedence: per-agent overrides take priority over the global fallback. This is a classic specificity-based resolution scheme, where the most specific applicable rule wins. The resolver's contract is straightforward — for any agent lookup, it first checks the per-agent section of `workflow-progress.json` for an entry matching the agent's identifier; if absent, it falls back to the global mode.

A defining architectural choice is the **persistence-first, no-cache design** inherited from the parent `LLMMockService`. The resolver consults `workflow-progress.json` on every lookup rather than maintaining an in-memory cache. This is a deliberate trade-off that aligns with the sibling `PersistedModeStore`'s philosophy of durability over performance: by re-reading the source of truth each time, the resolver guarantees that overrides written by previous process instances — or by concurrent processes — are always honoured.

This design forms a clean separation of concerns between the three components within `llm-mock-service.ts`:
- `PersistedModeStore` handles the read/write boundary against `workflow-progress.json`.
- `AgentOverrideResolver` handles the merge logic between global and per-agent tiers.
- `LLMMockService` orchestrates these resolver/store interactions for consumers.

The pattern resembles a **chain-of-responsibility lookup** restricted to two links (per-agent → global), but with no in-memory state to invalidate, making the resolver fundamentally stateless and idempotent.

## Implementation Details

Within `llm-mock-service.ts`, the resolver implements its lookup as a sequenced check against the two distinct sections of `workflow-progress.json`. The per-agent override map is keyed by agent identifier, and the resolver performs a presence check on that map first. If the agent's identifier is found, the corresponding mode value is returned directly. If not, the resolver retrieves the global fallback mode from the top-level configuration and returns that.

The merge step is invoked **on every effective-mode query** — there is no batched resolution, no precomputed table, and no observer-style invalidation. This is a direct consequence of the parent `LLMMockService`'s persistence-first design: since state lives entirely in `workflow-progress.json`, every resolution must touch that file (typically via the sibling `PersistedModeStore`). The cost of repeated file access is accepted in exchange for guaranteed freshness across process boundaries within the Docker environment.

Because the resolver holds no per-instance state, multiple `LLMMockService` instances (across process restarts or parallel processes) all see the same effective mode for any given agent. The merge logic itself is deterministic: given the same `workflow-progress.json` contents, the resolver will always return the same mode for the same agent identifier.

## Integration Points

The primary integration is with the parent `LLMMockService`, which owns `AgentOverrideResolver` and invokes it whenever an agent-scoped mode decision is required. Through `LLMMockService`, the resolver indirectly serves all consumers of the mock-mode subsystem — any code path that asks "what mode should this agent run in?" ultimately reaches this resolver.

The resolver's most important data dependency is `workflow-progress.json`, accessed through (or in coordination with) the sibling `PersistedModeStore`. This file is the contract boundary: any external process or tooling that writes well-formed global or per-agent entries into `workflow-progress.json` will have those values respected by the resolver on the next lookup, without requiring restart or signaling. This makes the resolver naturally compatible with out-of-band configuration changes — a useful property in the Docker environment where workflow state may be manipulated by sibling services.

There are no direct integration points with networked services, event buses, or message brokers evident from the observations. The integration surface is intentionally narrow: parent service → resolver → persisted JSON file.

## Usage Guidelines

Developers adding a new agent to the system should expect the resolver to return the **global mode by default**. To give an agent a distinct mode, an explicit entry keyed by that agent's identifier must be added to the per-agent override section of `workflow-progress.json`. There is no registration step beyond writing this entry — the resolver will pick it up on the next lookup.

Do not introduce an in-memory cache around `AgentOverrideResolver` without revisiting the parent `LLMMockService`'s persistence-first contract. The current design intentionally re-reads `workflow-progress.json` on each lookup so that mode changes written by previous or concurrent process instances are immediately visible. Caching would silently break this guarantee and reintroduce the cross-process inconsistency that the design was built to avoid.

When debugging unexpected mode behavior for a specific agent, inspect `workflow-progress.json` directly — first check the per-agent override map for that agent's identifier, then fall back to checking the global mode field. The resolver's output is fully determined by these two values, so any divergence between expected and actual mode can be traced to the file's contents.

Finally, treat `workflow-progress.json` as the canonical configuration surface. Because the sibling `PersistedModeStore` and `AgentOverrideResolver` both anchor on this file, ad-hoc state injected elsewhere will not be honoured. All mode configuration — global or per-agent — must flow through this single source of truth.

---

### Summary of Insights

1. **Architectural patterns identified**: Two-tier configuration merge with specificity-based precedence (per-agent overrides → global fallback); stateless resolver paired with a persistence-first store; clean separation between merge logic (`AgentOverrideResolver`) and storage (`PersistedModeStore`) within a single service facade (`LLMMockService`).

2. **Design decisions and trade-offs**: Durability is prioritized over performance — every lookup hits `workflow-progress.json` to guarantee cross-process consistency in the Docker environment, accepting repeated I/O as the cost of correctness.

3. **System structure insights**: The mock-mode subsystem in `llm-mock-service.ts` is a tightly cohesive trio: `LLMMockService` (facade), `PersistedModeStore` (durability), `AgentOverrideResolver` (resolution semantics). Each has a single, non-overlapping responsibility.

4. **Scalability considerations**: The no-cache, file-read-per-lookup design will not scale to high-frequency resolution under heavy load. It is well-suited to the current workflow context where mode decisions are infrequent relative to actual LLM operations, but would require redesign if invoked in a hot path.

5. **Maintainability assessment**: High — the resolver's responsibility is narrow, its dependencies are explicit (one JSON file, two sections), and its behavior is fully deterministic from the file contents. New agents require no code changes, only configuration entries. The main maintenance risk is accidental introduction of caching that would violate the cross-process freshness guarantee.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts persists LLM mode state to workflow-progress.json rather than keeping it in memory, making mode selection survive process restarts within the Docker environment

### Siblings
- [PersistedModeStore](./PersistedModeStore.md) -- llm-mock-service.ts deliberately avoids in-memory state for LLM mode, instead treating workflow-progress.json as the single source of truth — a design choice that prioritizes durability over performance within the Docker environment.


---

*Generated from 3 observations*
