# IsDirtyFlagMutation

**Type:** Detail

This design creates a data-loss risk window: if the process exits before an explicit flush, all manual edits since the last persist are lost, making flush coordination a critical responsibility of the caller.

## IsDirtyFlagMutation — Technical Insight Document

---

## What It Is

`IsDirtyFlagMutation` describes the behavioral contract governing how manual graph mutations are tracked within the `ManualLearning` subsystem. It is implemented through `GraphDatabaseService.js`, which serves as the central routing point for all manual write operations against the in-memory Graphology graph. The core mechanic is simple: any write operation — node addition, edge addition, or similar mutation — causes `GraphDatabaseService.js` to set an `isDirty` flag to `true`, signaling that the in-memory state has diverged from what is persisted in LevelDB.

This is not a standalone class or module but rather a design principle embedded in the mutation pathway of `ManualLearning`. Every manual edit flows through `GraphDatabaseService.js`, making it the single authoritative point where dirty state is declared.

---

## Architecture and Design

The central architectural decision here is the **decoupling of mutation from persistence**. Rather than writing through to LevelDB on every graph change, `GraphDatabaseService.js` accumulates mutations in the Graphology in-memory graph and defers the actual persistence step to an explicit call to `_persistGraphToLevel()`. The `isDirty` flag is the bridge between these two states — it is a lightweight signal that communicates "the in-memory graph contains work that has not been flushed."

This is a classic **write-buffer** or **dirty-page** pattern, familiar from database buffer pool management and file system design. The trade-off is deliberate: batching mutations before flushing is more efficient than round-tripping to LevelDB on every individual write, particularly when a caller may be performing a sequence of related graph edits. The cost of this trade-off is the introduction of a **data-loss risk window** — the period between the last mutation and the next explicit `_persistGraphToLevel()` call.

Within the broader `ManualLearning` parent context, this design means that manual edits (which are likely less frequent and more intentional than automated learning operations) are treated as accumulate-then-commit operations rather than auto-committed writes. This aligns with the expectation that a human or calling process has explicit control over when work is considered durable.

---

## Implementation Details

`GraphDatabaseService.js` is the implementation locus. On any write operation routed through it, the service sets `isDirty = true`. This flag persists until `_persistGraphToLevel()` is invoked, at which point the in-memory Graphology graph state is serialized and written to LevelDB, and the dirty flag is presumably cleared.

The mechanics hinge on two operations:

1. **Mutation path**: Any manual node or edge write → `GraphDatabaseService.js` → Graphology in-memory graph updated → `isDirty = true`.
2. **Persistence path**: Caller explicitly invokes `_persistGraphToLevel()` → LevelDB is updated → dirty state resolved.

Critically, there is no automatic trigger connecting the dirty flag to a flush. The flag is purely informational from the system's perspective — it does not schedule a background flush, does not set a timer, and does not hook into process lifecycle events. This makes `_persistGraphToLevel()` entirely the caller's responsibility, which is a sharp edge in the design.

---

## Integration Points

`IsDirtyFlagMutation` is tightly coupled to the `ManualLearning` parent component, which owns the lifecycle of manual graph edits. `GraphDatabaseService.js` is the shared service dependency through which `ManualLearning` writes, meaning any sibling components that also use `GraphDatabaseService.js` for writes would similarly participate in the dirty flag lifecycle.

The downstream dependency is LevelDB, accessed via `_persistGraphToLevel()`. The upstream dependency is whatever caller (human-driven or programmatic) initiates manual graph mutations through `ManualLearning`. There is no evidence of an event bus, observer, or automatic flush hook — the integration is entirely synchronous and call-driven.

---

## Usage Guidelines

**Flush coordination is the caller's critical responsibility.** Because `_persistGraphToLevel()` is never called automatically, any code path that performs manual mutations via `GraphDatabaseService.js` must explicitly schedule or invoke the flush before the process can safely exit or before the work can be considered durable. Failure to do so results in silent data loss — the in-memory graph will reflect the edits, but LevelDB will not.

Developers working within `ManualLearning` should treat the `isDirty` flag as a pre-flight check before any operation that might terminate the process or hand off control. A pattern worth enforcing: **check `isDirty`, then flush before exit**.

The data-loss risk window should be understood as proportional to the volume and criticality of accumulated edits. For low-frequency manual edits this may be acceptable, but for any workflow where manual graph edits are consequential, explicit flush calls should bookend the mutation sequence — flush after every logical unit of work, not just at process termination.

Finally, because `GraphDatabaseService.js` is the single mutation gateway, any future enhancement to this system (such as adding automatic flush-on-idle, process signal handlers, or transactional rollback) should be implemented there, preserving the single point of control this design already establishes.

---

**Architectural Patterns**: Write-buffer / dirty-page pattern with explicit flush semantics.  
**Key Trade-off**: Mutation efficiency vs. durability guarantee — the caller pays the cost of flush coordination in exchange for batched write performance.  
**Scalability Note**: The in-memory accumulation model does not scale to unbounded mutation volumes without flush checkpoints; callers should flush periodically for long-running mutation sessions.  
**Maintainability**: The design is maintainable precisely because `GraphDatabaseService.js` centralizes all mutation routing — there is one place to instrument, audit, or enhance persistence behavior.


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- Manual edits write directly to the Graphology in-memory graph via GraphDatabaseService.js, setting the isDirty flag but not automatically triggering _persistGraphToLevel(), meaning unsaved manual edits are at risk of loss if flush is not explicitly called


---

*Generated from 3 observations*
