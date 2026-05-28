# SingleKeyPersistenceStrategy

**Type:** Detail

Based on the parent context description, the LevelDB key 'graph' is the sole storage key, meaning every persist operation serializes the complete in-memory graph and overwrites the previous value entirely.

## SingleKeyPersistenceStrategy

### What It Is

`SingleKeyPersistenceStrategy` describes the persistence approach implemented within `GraphDatabaseService.js`, where the entire Graphology graph is serialized as a single JSON blob and stored under the sole LevelDB key `'graph'`. Rather than distributing graph data across multiple keys (one per node, one per edge, etc.), every persist operation writes the complete in-memory graph state atomically to this one location. This is not a separate class but a named architectural strategy embedded in the behavior of `GraphDatabaseService`.

---

### Architecture and Design

The central architectural decision here is **whole-graph serialization over a single key**. LevelDB is a key-value store capable of fine-grained keying, but `GraphDatabaseService.js` deliberately ignores that capability in favor of a single `'graph'` key. This collapses what could be a distributed key-space into one entry, making reads and writes conceptually simple: to load the graph, read one key; to save the graph, write one key.

This design reflects a deliberate trade-off: **implementation simplicity over partial-read/write capability**. There are no per-node or per-edge keys, which means the storage layer has no awareness of graph topology. A consequence is that atomic partial updates — updating a single node's properties without touching the rest of the graph — are architecturally impossible at the storage layer. Every mutation, regardless of scope, must eventually result in a full blob write if persistence is desired.

The strategy is consistent with a single-user or low-concurrency embedded database model. LevelDB itself is an embedded store without native multi-process concurrent access, so the absence of partial-write granularity is less costly than it would be in a distributed or multi-writer environment.

---

### Implementation Details

Two mechanisms within `GraphDatabaseService` exist specifically to make this whole-blob strategy viable under normal graph mutation workloads: the **`isDirty` flag** and the **`_persistGraphToLevel()` function**.

The `isDirty` flag acts as a mutation sentinel. When any graph mutation occurs (node addition, edge removal, property update, etc.), the flag is set, signaling that the in-memory state has diverged from the persisted state. This prevents `_persistGraphToLevel()` from being called on every individual mutation, which would otherwise serialize and overwrite the full blob on every small change — an expensive operation for any non-trivial graph.

`_persistGraphToLevel()` performs the actual serialization: it converts the current Graphology in-memory graph to JSON and writes it under the `'graph'` key, then clears `isDirty`. This batching mechanism means multiple mutations can accumulate in memory before a single write flushes them all, amortizing the cost of full-blob serialization across many operations. Developers should understand that the persistence is therefore **eventually consistent with the in-memory state**, not synchronous with each mutation.

---

### Integration Points

`SingleKeyPersistenceStrategy` is fully encapsulated within `GraphDatabaseService`. External consumers of `GraphDatabaseService` interact with the graph through its public API and are insulated from the persistence mechanics. The strategy's only external dependency is LevelDB itself, accessed through whatever LevelDB client `GraphDatabaseService.js` wraps.

The Graphology graph object serves as the authoritative in-memory representation; the LevelDB `'graph'` key is its durable mirror. On startup, `GraphDatabaseService` presumably reads the `'graph'` key and deserializes it to reconstruct the in-memory Graphology instance, making the single-key design symmetric for both read and write paths.

---

### Usage Guidelines

**Mutation batching is essential.** Because every persist is a full-blob write, developers extending or modifying `GraphDatabaseService` should ensure that `_persistGraphToLevel()` is never called in a tight loop per-mutation. The `isDirty` pattern should be respected: mark dirty on mutation, flush on an appropriate boundary (idle tick, explicit commit, shutdown).

**No partial recovery is possible from storage alone.** If the graph is partially corrupted in memory before a flush, the entire persisted state will be overwritten with the corrupted data. There is no per-node rollback capability at the storage layer. Any integrity guarantees must be enforced at the in-memory Graphology layer before `_persistGraphToLevel()` is invoked.

**Scalability ceiling is inherent to the design.** As the graph grows, serialization time and blob size grow proportionally. For graphs with thousands of nodes and edges, write latency will increase, and LevelDB value size limits may eventually become relevant. This strategy is well-suited to small-to-medium embedded graphs; applications anticipating large-scale graphs should treat this as a known architectural constraint and plan for a migration to a keyed or segmented persistence strategy if needed.

**Reads are equally coarse-grained.** Loading the graph requires deserializing the entire blob, meaning startup time and memory pressure both scale with graph size. There is no lazy-loading of subgraphs from storage.


## Hierarchy Context

### Parent
- [GraphDatabaseService](./GraphDatabaseService.md) -- GraphDatabaseService.js implements a single-key LevelDB strategy storing the entire Graphology graph as one JSON blob under key 'graph', trading partial-read capability for simplicity


---

*Generated from 3 observations*
