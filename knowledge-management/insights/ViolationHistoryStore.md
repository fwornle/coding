# ViolationHistoryStore

**Type:** Detail

Per parent context, .mcp-sync/violation-history.json serves as the cross-session persistence layer for violation data, placing it in the .mcp-sync directory which is referenced in docs/constraints/constraint-monitoring-system.md as part of the constraint monitoring infrastructure.

# ViolationHistoryStore — Technical Insight Document

## What It Is

ViolationHistoryStore is a persistence component contained within ConstraintDashboard, responsible for maintaining a durable record of constraint violations across Claude Code sessions. Its physical storage is `.mcp-sync/violation-history.json`, located in the `.mcp-sync` directory — a directory that serves as the broader constraint monitoring infrastructure's shared sync layer, as documented in `docs/constraints/constraint-monitoring-system.md`. The store is not an independent service or database; it is a file-backed structure whose existence and location are tightly coupled to the conventions established by the constraint monitoring system described in `docs/constraints/README.md`.

## Architecture and Design

**Pattern: Lightweight File-Based Persistence**

The central architectural decision here is the deliberate choice of a flat JSON file over a running database. This aligns explicitly with the lightweight constraint enforcement philosophy described in `docs/constraints/README.md`. The trade-off is clear: operational simplicity and zero infrastructure dependencies at the cost of the query expressiveness and transactional guarantees a database would provide.

By placing the persistence file in `.mcp-sync/`, the design co-locates violation history with other cross-session synchronization artifacts, creating a coherent "sync boundary" — a directory whose contents represent shared, durable state that survives individual Claude Code session lifecycles. This is a meaningful architectural boundary: anything inside `.mcp-sync/` is persistent and cross-session; anything outside it is assumed to be ephemeral.

The parent component, ConstraintDashboard, reads directly from `.mcp-sync/violation-history.json`, meaning the store functions as a **read/write shared file** rather than an encapsulated service with an API. This is a deliberate simplicity trade-off: no serialization protocol, no network layer, no process boundary — just a JSON file on disk.

**Design Decision: Session-Transcendent State**

The most significant design insight is that ViolationHistoryStore exists precisely to solve the statelessness problem inherent in Claude Code's session model. Without it, every session would start blind — no knowledge of prior violations, no ability to detect patterns or repeat offenders. The store makes the constraint enforcement system cumulative rather than reactive-per-session.

## Implementation Details

No code symbols were identified in the analysis, meaning the implementation details must be inferred from structural observations. The store's mechanics are file-based: violation records are written to and read from `.mcp-sync/violation-history.json` in JSON format. JSON was chosen for human readability and zero-dependency parsing — consistent with the lightweight architectural mandate.

The fact that ConstraintDashboard reads this file directly (rather than through an abstraction layer) suggests the store's schema — the shape of the JSON — is a de facto interface contract. Any consumer of violation history must understand and conform to whatever structure ViolationHistoryStore writes. This makes schema stability a silent but important concern.

The cross-session persistence model implies that the file is **append-oriented or accumulative** in nature — records are added over time rather than overwritten — since the stated purpose includes trend analysis and repeated-violation detection. A destructive-write approach would defeat the purpose of historical analysis.

## Integration Points

ViolationHistoryStore's primary integration is with its parent, ConstraintDashboard, which consumes the persisted data for display and analysis. The relationship is a direct file dependency: ConstraintDashboard reads `.mcp-sync/violation-history.json` without requiring ViolationHistoryStore to be "running" in any process sense.

The `.mcp-sync/` directory itself represents an integration point with the broader constraint monitoring infrastructure. As referenced in `docs/constraints/constraint-monitoring-system.md`, this directory is a recognized convention within the system — meaning other components in the constraint monitoring ecosystem may also read from or write to this directory, making ViolationHistoryStore a participant in a shared-file coordination model rather than an isolated store.

There are no observed dependencies on external services, databases, or network resources — the integration surface is intentionally minimal.

## Usage Guidelines

**Schema as Contract**: Because no abstraction layer exists between ConstraintDashboard and the raw JSON, the structure of records in `.mcp-sync/violation-history.json` must be treated as a stable interface. Changes to the JSON schema require coordinated updates to all readers, primarily ConstraintDashboard.

**File Location is Infrastructure**: The `.mcp-sync/` directory placement is not arbitrary — it is part of a documented convention. Do not relocate `violation-history.json` outside this directory without updating references in `docs/constraints/constraint-monitoring-system.md` and any tooling that reads from `.mcp-sync/`.

**Growth and Pruning**: Since the store accumulates violations across sessions for trend analysis, developers should be aware that `violation-history.json` will grow unboundedly without a pruning or rotation strategy. This is a scalability consideration the current lightweight design does not explicitly address — at sufficient scale, file I/O for a large JSON file could become a bottleneck for ConstraintDashboard reads.

**No Concurrency Guarantees**: A file-based store with no locking mechanism is vulnerable to race conditions if multiple processes attempt simultaneous writes. The current design implicitly assumes single-writer access. Developers extending the system to write violations from multiple concurrent processes should introduce a coordination mechanism (file locking or an intermediary writer).

---

**Architectural Patterns Identified**: File-based persistence, shared-directory sync convention, direct-file coupling (no abstraction layer).

**Key Trade-offs**: Simplicity and zero infrastructure vs. query capability, schema rigidity, and unbounded growth.

**Scalability Concern**: JSON file growth across sessions is unmanaged; acceptable at low violation volumes, potentially problematic at scale.

**Maintainability**: High for the current scope — minimal moving parts, human-readable storage. Risk increases if the schema evolves without a migration strategy.


## Hierarchy Context

### Parent
- [ConstraintDashboard](./ConstraintDashboard.md) -- ConstraintDashboard reads violation data from .mcp-sync/violation-history.json, a shared sync file that persists violations across Claude Code sessions for historical analysis


---

*Generated from 3 observations*
