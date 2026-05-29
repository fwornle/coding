# ValidityWindowEnforcer

**Type:** Detail

Based on the KnowledgeDecayTracker sub-component description, each entity in the GraphKMStore carries validFrom and validUntil fields that this enforcer checks at query time rather than at write time.

# ValidityWindowEnforcer — Technical Insight Document

## What It Is

`ValidityWindowEnforcer` is a query-time filtering component that lives inside the `KnowledgeDecayTracker` sub-system, which itself is part of the Graph-Based Knowledge Storage Architecture documented in `docs/architecture/memory-systems.md`. Its singular responsibility is to evaluate the `validFrom` and `validUntil` fields attached to every entity in the `GraphKMStore` and determine whether a given entity falls within an acceptable temporal window at the moment a query is executed.

Rather than acting as a write-time gatekeeper or a background cleanup process, `ValidityWindowEnforcer` operates exclusively at read/query time. This placement in the data lifecycle is a deliberate architectural choice: knowledge is never physically removed from the underlying Graphology graph solely because it has expired. Instead, the enforcer acts as a logical filter that interposes itself between the raw graph state and any consumer of that knowledge.

## Architecture and Design

The central design decision governing `ValidityWindowEnforcer` is the **separation of storage truth from query truth**. The Graphology graph at the storage layer is treated as an append-friendly, non-destructive record — a complete historical ledger. The `ValidityWindowEnforcer` then projects a temporally scoped view of that ledger for normal query consumers, without mutating the underlying data. This is a classic **logical deletion / soft-expiry** pattern applied to a graph knowledge store.

This design stands in direct contrast to an eager-eviction model, where expired nodes or edges would be pruned from the graph as soon as their `validUntil` timestamp passes. The eager-eviction approach would simplify query-time logic but permanently destroy historical state, foreclosing audit and rollback use cases. By delegating expiry enforcement to `ValidityWindowEnforcer` at query time, the system retains both paths: normal consumers get a clean, temporally coherent view, while privileged or audit-mode consumers can bypass the enforcer and query the raw graph state directly.

The relationship with its parent, `KnowledgeDecayTracker`, is foundational. `KnowledgeDecayTracker` is responsible for *attaching* `validFrom` and `validUntil` fields to entities as they are written into `GraphKMStore`. `ValidityWindowEnforcer` is the complementary read-side mechanism — it *consumes* those fields to enforce the window. The two components together form a complete temporal lifecycle contract: one component stamps knowledge with its valid lifetime; the other ensures that lifetime is respected at retrieval.

**Key design trade-offs:**

| Decision | Benefit | Cost |
|---|---|---|
| Query-time enforcement (not write-time) | Enables audit/rollback via enforcer bypass | Every query bears the cost of window evaluation |
| No physical deletion | Full historical fidelity preserved | Graph grows monotonically; storage pressure increases over time |
| Fields live on entities (`validFrom`/`validUntil`) | Self-describing records; enforcer logic is stateless per entity | Schema coupling — all entities must carry temporal metadata |

## Implementation Details

Each entity in `GraphKMStore` carries two temporal boundary fields — `validFrom` and `validUntil` — that encode the entity's intended active lifespan. At query time, `ValidityWindowEnforcer` checks the current timestamp (or a caller-supplied reference time, depending on implementation convention) against these two fields and passes or filters each entity accordingly. An entity is considered valid if `validFrom ≤ now < validUntil` (or equivalent boundary semantics as defined by the system).

Because the enforcer operates at query time rather than in a background sweep, it is inherently **stateless with respect to scheduling** — there is no timer, no cron job, and no side-effectful mutation of the graph triggered by expiry events. This means the enforcer's behavior is deterministic and reproducible: given the same graph state and the same reference time, it will always produce the same filtered result. This property is especially valuable for testing and for the audit use case, where replaying a query at a historical timestamp should yield a consistent answer.

The fact that no code symbols were found in the current scan suggests `ValidityWindowEnforcer` may be defined inline within `KnowledgeDecayTracker`'s implementation, or its symbol has not yet been indexed. The architectural behavior, however, is clearly specified in `docs/architecture/memory-systems.md`.

## Integration Points

`ValidityWindowEnforcer` sits at the boundary between raw `GraphKMStore` graph data and any consumer that expects temporally coherent knowledge. Its primary dependency is on the `validFrom` / `validUntil` field contract established by `KnowledgeDecayTracker` — if those fields are absent or malformed on an entity, the enforcer's behavior is undefined and warrants defensive handling.

Consumers that need to **bypass** the enforcer for audit or rollback purposes interact directly with the underlying Graphology graph, circumventing the enforcer entirely. This means the enforcer is not a mandatory chokepoint at the storage layer — it is a voluntary filtering layer. Any system integrating with `GraphKMStore` should be explicitly documented as either "enforcer-aware" (normal query path) or "raw graph access" (audit path) to prevent accidental consumption of expired knowledge in production flows.

Time-range <USER_ID_REDACTED> are described as a first-class concern in the architecture, implying that the enforcer may also support <USER_ID_REDACTED> scoped to a *specific historical window* (e.g., "what was valid between T1 and T2?") rather than only point-in-time "is this valid now?" checks. This positions `ValidityWindowEnforcer` as a general temporal query filter, not merely an expiry gate.

## Usage Guidelines

Developers querying `GraphKMStore` for operational purposes should always route through `ValidityWindowEnforcer` to avoid inadvertently surfacing expired knowledge. The soft-expiry model means the graph will silently contain stale entities — there is no schema-level enforcement preventing a raw graph traversal from returning them. The enforcer must be treated as a required layer, not an optional optimization.

When writing new entities into `GraphKMStore`, the `validFrom` and `validUntil` fields must be populated before the entity reaches the graph — this is `KnowledgeDecayTracker`'s responsibility. Do not write entities with missing temporal fields and expect `ValidityWindowEnforcer` to handle the gap gracefully; undefined temporal boundaries will produce unpredictable filtering behavior.

For audit or rollback scenarios, direct graph access (bypassing the enforcer) is the supported pattern. However, this access should be explicitly scoped and logged — the architectural intent is that bypassing `ValidityWindowEnforcer` is an *intentional, privileged operation*, not a default behavior. Any tooling or service that <USER_ID_REDACTED> the raw Graphology graph should carry clear documentation of this bypass to avoid confusion with normal operational <USER_ID_REDACTED>.

Finally, because the graph grows monotonically (no physical deletion), long-running deployments should account for increasing graph size when reasoning about query performance. The `ValidityWindowEnforcer`'s filtering cost scales with the number of expired-but-retained entities, making periodic archival or snapshotting strategies worth evaluating as the knowledge base matures.


## Hierarchy Context

### Parent
- [KnowledgeDecayTracker](./KnowledgeDecayTracker.md) -- KnowledgeDecayTracker attaches validFrom and validUntil fields to each entity, enabling time-range <USER_ID_REDACTED> that exclude expired knowledge without physically deleting records from the Graphology graph


---

*Generated from 3 observations*
