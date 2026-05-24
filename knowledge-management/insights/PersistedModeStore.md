# PersistedModeStore

**Type:** Detail

llm-mock-service.ts deliberately avoids in-memory state for LLM mode, instead treating workflow-progress.json as the single source of truth — a design choice that prioritizes durability over performance within the Docker environment.

# PersistedModeStore

## What It Is

PersistedModeStore is a conceptual storage component implemented within `llm-mock-service.ts`, where it manages LLM mode selection state by persisting it to `workflow-progress.json` rather than holding it in process memory. It is contained by `LLMMockService` (its parent component) and serves as the durable backing store for mode configuration decisions that need to survive process restarts within the Docker environment.

The store deliberately rejects the common pattern of caching mode state in an in-memory variable. Instead, `workflow-progress.json` is treated as the single source of truth for mode selection. Any read of the current mode involves consulting this file, and any mutation writes back to it, making the JSON file the authoritative record of LLM mode configuration across the system.

This design positions PersistedModeStore as a thin persistence abstraction whose primary responsibility is bridging the gap between transient process lifetimes and the durable mode state that must outlive them.

## Architecture and Design

The architectural pattern at work here is a **file-backed state store** acting as a **single source of truth**, with no in-memory cache layer. This is an explicit design choice documented in `llm-mock-service.ts`: durability is prioritized over the performance benefits that an in-memory cache would provide. The trade-off accepts the cost of file I/O on every read in exchange for guaranteed consistency after process restarts.

The component participates in a broader configuration architecture alongside its sibling `AgentOverrideResolver`. Both siblings read from the same `workflow-progress.json` file but operate on different conceptual slices of it: PersistedModeStore is concerned with mode selection state in general, while AgentOverrideResolver handles the two-tier configuration model (a global fallback mode plus a per-agent override map). When the effective mode for a specific agent must be determined, the parent `LLMMockService` orchestrates a merge between these tiers — meaning PersistedModeStore's data is one input into a resolution pipeline rather than the final answer.

Because the Docker environment may restart processes independently, the architectural emphasis on file persistence ensures mode selections behave consistently across the container's process boundaries. The file system itself acts as the shared communication channel between successive process incarnations, eliminating the need for an external state service.

## Implementation Details

The implementation in `llm-mock-service.ts` exposes two implicit code paths around PersistedModeStore. The **read path** is invoked on service initialization and on any mode query, opening `workflow-progress.json`, parsing it, and extracting the relevant mode field. The **write path** is invoked on every mode change, serializing the updated mode state back to the same file. These two paths form the entirety of the storage surface area.

Because there is no in-memory mirror of the mode state, every operation passes through the file system. This makes the file I/O surface within `llm-mock-service.ts` the critical coupling point for mode state management — any concurrency, locking, or atomicity concerns must be addressed at this layer rather than being hidden behind an in-memory abstraction.

When a process restarts inside the Docker container, the next invocation of the read path will naturally rehydrate the mode selection from `workflow-progress.json` without any explicit recovery logic. There is no "default fallback" path that activates on restart — the persisted file remains the authoritative input, and defaults only apply when the field is absent from the file entirely.

## Integration Points

PersistedModeStore is integrated through its parent `LLMMockService`, which owns the file I/O code paths in `llm-mock-service.ts`. The parent service exposes mode-related operations to the rest of the system while delegating actual persistence to this store conceptually. The integration is internal — PersistedModeStore is not exposed as a separate module but rather as a discipline within `LLMMockService` about where mode state lives.

The most significant external integration is with the `workflow-progress.json` file itself, which is shared with the sibling component `AgentOverrideResolver`. This shared file creates an implicit contract: both components must agree on the schema and key layout within the JSON document, since `AgentOverrideResolver` reads its per-agent override map and global fallback mode from the same physical file that PersistedModeStore writes to.

The Docker environment is another integration point. The persistence guarantees PersistedModeStore provides are scoped to the container's filesystem; mode state survives in-container process restarts but is bound to the container's volume lifecycle. Any system that orchestrates the container must ensure `workflow-progress.json` is on a path that aligns with the desired durability semantics.

## Usage Guidelines

Developers working with PersistedModeStore should treat `workflow-progress.json` as the canonical source of mode state and avoid introducing parallel in-memory caches that would defeat the durability guarantee. When adding new mode-related fields, write paths in `llm-mock-service.ts` must update the file atomically enough that partial writes do not corrupt the shared state read by `AgentOverrideResolver`.

Because every read touches the file system, callers should be aware that mode <USER_ID_REDACTED> are not free — but they should not attempt to optimize by caching results locally, since this would reintroduce the staleness problem that the design explicitly avoids. If performance becomes a concern, the correct response is to address it within the read path in `llm-mock-service.ts` itself, preserving the single-source-of-truth invariant.

When working alongside `AgentOverrideResolver`, remember that PersistedModeStore provides only one tier of the mode configuration. The effective mode for a given agent requires merging the global fallback with the per-agent override map, and this merge step is the parent `LLMMockService`'s responsibility — not PersistedModeStore's. Keep these concerns separated to maintain the clear division of responsibilities between the two siblings.

### Architectural Patterns Identified
- **File-backed single source of truth**: `workflow-progress.json` is the authoritative store, with no in-memory mirror.
- **Implicit read/write paths** rather than an explicit repository abstraction, embedded directly in `llm-mock-service.ts`.
- **Sibling collaboration through a shared file**: PersistedModeStore and `AgentOverrideResolver` coordinate via the JSON document rather than direct method calls.

### Design Decisions and Trade-offs
- Durability is explicitly prioritized over read/write performance.
- Process-restart resilience is achieved without external infrastructure by leveraging the container filesystem.
- The cost is file I/O on every mode operation and the need to manage concurrent access carefully at the file layer.

### System Structure Insights
- The parent `LLMMockService` acts as the coordination point, owning both PersistedModeStore's I/O and the merge logic that combines its output with `AgentOverrideResolver`'s per-agent overrides.
- The critical coupling point for the entire mode subsystem is the file I/O surface in `llm-mock-service.ts`.

### Scalability Considerations
- Scalability is bounded by file I/O throughput on `workflow-progress.json` and by any locking required to serialize concurrent writers.
- The design assumes a single Docker container context; multi-container scaling would require replacing the file with a shared storage mechanism while preserving the single-source-of-truth invariant.

### Maintainability Assessment
- Maintainability is supported by the clarity of the single-source-of-truth rule: there is one place to look for mode state, and one set of paths in `llm-mock-service.ts` to audit.
- Risk areas include schema drift between PersistedModeStore's writes and `AgentOverrideResolver`'s reads, and any future temptation to introduce caching that would silently break the durability contract.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts persists LLM mode state to workflow-progress.json rather than keeping it in memory, making mode selection survive process restarts within the Docker environment

### Siblings
- [AgentOverrideResolver](./AgentOverrideResolver.md) -- llm-mock-service.ts maintains at least two tiers of mode configuration in workflow-progress.json: a global fallback mode and a per-agent override map, requiring a merge step whenever the effective mode for a specific agent is needed.


---

*Generated from 3 observations*
