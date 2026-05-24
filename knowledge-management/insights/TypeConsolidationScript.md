# TypeConsolidationScript

**Type:** Detail

The script supports two distinct consolidation operations on the Graphology+LevelDB store: rename (one old label → one new label) and merge (multiple old labels → one canonical label), as stated in the EntityMigrationScripts L2 context.

# TypeConsolidationScript

## What It Is

The `TypeConsolidationScript` is implemented in **`migrate-graph-db-entity-types.js`**, a focused migration utility scoped narrowly to entity-type label mutations within the project's persistent graph store. Rather than serving as a general-purpose graph restructuring tool, it operates as a targeted instrument for vocabulary maintenance—specifically, the controlled evolution of the entity type taxonomy used across the knowledge graph.

The script lives under the `EntityMigrationScripts` parent component, where it shares the broader concern of safely transforming persisted graph data over time. Its mandate is intentionally constrained: it manipulates only the labels that classify entities (their "type" property), leaving node payloads, edge structures, and overall graph topology untouched. This narrow scope is what enables its core promise of operating "without full data reconstruction."

Two distinct consolidation operations are supported: **rename** (a one-to-one mapping where a single old label is replaced by a single new label) and **merge** (a many-to-one mapping where multiple old labels are collapsed into a single canonical label). Both operations execute against the Graphology+LevelDB store that underlies the application's graph persistence layer.

## Architecture and Design

The architectural approach centers on **in-place mutation** rather than rebuild-and-replace. By treating entity type labels as a lightweight, isolated dimension of graph state, the script avoids the cost and risk of serializing, transforming, and rehydrating the entire graph. This design choice yields minimal write amplification—only the type field of affected nodes is touched, while edges, payloads, and structural relationships remain pristine on disk.

A defining architectural tension the script must manage is the **dual-state nature of the persistence layer**: Graphology maintains an in-memory representation of the graph, while LevelDB provides the durable backing store. Every type relabeling pass must reconcile these two views, ensuring that mutations applied to the in-memory Graphology graph propagate correctly to the LevelDB representation. This makes the script not merely a data transformer but a coordinator between volatile and persistent state.

The two-operation design (rename vs. merge) reflects a deliberate separation of cardinality concerns. Rename preserves the bijection between old and new type names—a safe, reversible operation. Merge collapses cardinality and is inherently destructive in the sense that the original distinctions between source labels cannot be recovered from the post-migration state alone. This distinction shapes how operators must approach planning and backup before invocation.

## Implementation Details

The implementation file `migrate-graph-db-entity-types.js` is responsible for orchestrating the relabeling passes over the graph. During execution, the script iterates over nodes in the Graphology graph, identifies those whose current type label matches a configured source label, and updates their type attribute to the configured target label. For **rename** operations, this is a direct substitution with a single source-target pair. For **merge** operations, multiple source labels map to one shared target, and the script applies the mapping uniformly across all matched nodes.

Because the script operates directly on the LevelDB store through Graphology, each mutation must traverse the abstraction boundary between the graph library and the key-value store. This implies that the script either relies on Graphology's persistence hooks to flush changes to LevelDB, or explicitly invokes the persistence layer after batches of in-memory mutations. The reconciliation requirement means consistency between the two stores is a first-class implementation concern—partial failures during a pass could leave the in-memory and on-disk views diverged.

The "without full data reconstruction" property is realized by surgically touching only the type attribute. Node identity, adjacency lists, edge data, and all other node properties remain unmodified. This contrasts sharply with migration strategies that would dump the graph, transform it externally, and reload it—an approach that would multiply I/O cost and risk corruption of unrelated data.

## Integration Points

The script's primary integration is with the **Graphology+LevelDB store**, which it both reads from and writes to. Graphology provides the graph API surface used to enumerate nodes and mutate their attributes, while LevelDB provides the durable persistence that survives across application restarts. The script is thus tightly coupled to the specific persistence wiring used by the broader application's graph layer.

Within the `EntityMigrationScripts` family, `TypeConsolidationScript` is one of several utilities that share the responsibility for evolving persisted graph state safely. Siblings in this family likely address other dimensions of migration (such as edge transformations, schema upgrades, or payload mutations), but `TypeConsolidationScript` is the designated tool whenever the concern is purely about entity type vocabulary.

There are no external service integrations evident from the observations—this is a local data maintenance script that operates on the application's own persistent store. Its inputs are the mappings (rename pairs or merge groups) provided by the operator, and its outputs are mutations applied to the existing LevelDB-backed graph.

## Usage Guidelines

Use `TypeConsolidationScript` when the goal is exclusively to **rename or merge entity type labels**. If the migration requires changes to node payloads, edge structure, or graph topology, this script is the wrong tool—reach for a different member of `EntityMigrationScripts` or design a more comprehensive migration. The script's value proposition (in-place updates without full reconstruction) only holds when its scope assumptions are respected.

Before running a **merge** operation, ensure that collapsing the source labels into a single canonical label is semantically intended and reversible only through backup restoration. Merge is destructive in the sense that the distinctions between the original labels are erased from the post-migration store. Rename operations are comparatively safer, but still warrant a backup of the LevelDB directory before invocation.

Because the script bridges the in-memory Graphology graph and the persistent LevelDB representation, operators should ensure that no other process is concurrently mutating the graph during a relabeling pass. Concurrent writers could cause the in-memory and on-disk views to diverge in ways the script cannot reconcile. Running the script while the main application is offline is the safest convention.

---

### Architectural Patterns Identified
- **In-place mutation migration**: Surgical updates to a single attribute dimension, avoiding rebuild-and-replace.
- **Dual-store reconciliation**: Coordinated mutation across an in-memory graph (Graphology) and a persistent key-value store (LevelDB).
- **Operation-typed migration API**: Distinct rename (1:1) and merge (N:1) operations modeling cardinality explicitly.

### Design Decisions and Trade-offs
- **Narrow scope (type labels only)** trades generality for safety and performance—data reconstruction is avoided, but the script cannot address structural migrations.
- **Direct LevelDB coupling via Graphology** trades portability for simplicity—the script is tightly bound to the chosen persistence stack but avoids an additional abstraction layer.
- **Merge as a supported primitive** trades reversibility for ergonomic vocabulary consolidation—operators gain a single-command consolidation tool but lose the ability to undo without backups.

### System Structure Insights
- The script sits within `EntityMigrationScripts`, a family that compartmentalizes graph-evolution concerns by mutation type.
- Reconciliation between in-memory Graphology state and on-disk LevelDB state is a recurring concern that any sibling script in this family likely also faces.

### Scalability Considerations
- Write amplification is minimized by touching only the type attribute, making the script viable even on large graphs where full reconstruction would be costly.
- The pass-based iteration over nodes is inherently O(N) in node count; performance scales linearly with graph size.
- LevelDB write throughput becomes the dominant cost factor for large consolidations, particularly batch-flush strategy will materially affect runtime.

### Maintainability Assessment
- The narrow scope (a single file, a single concern—type labels) yields high maintainability; the script does one thing and is easy to reason about.
- The dual-state reconciliation requirement is the principal source of complexity and the most likely site of future bugs—any change to how Graphology persists to LevelDB will require corresponding updates here.
- The absence of code symbols in the structural index suggests the script may be procedural rather than class-based, which is appropriate for a one-shot migration utility but limits unit testability.


## Hierarchy Context

### Parent
- [EntityMigrationScripts](./EntityMigrationScripts.md) -- migrate-graph-db-entity-types.js handles type consolidation—renaming or merging entity type labels in the Graphology+LevelDB store without full data reconstruction.


---

*Generated from 4 observations*
