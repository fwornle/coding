# EntityTypeConsolidation

**Type:** Detail

scripts/migrate-graph-db-entity-types.js enforces a closed, six-member canonical type set (Project, Component, SubComponent, Pattern, Detail, System), meaning any node whose legacy type label does not map to one of these six values must either be remapped or flagged — the finite set is a deliberate ontology constraint, not a convention.

## What It Is  

**EntityTypeConsolidation** is the logical unit that normalises every node’s `entity‑type` attribute inside the **Graphology** in‑memory graph used by the project. The consolidation logic lives in a single migration script:

```
scripts/migrate-graph-db-entity-types.js
```

When this script runs it inspects each node’s legacy type label, maps it onto one of a **closed, six‑member canonical set** – **Project**, **Component**, **SubComponent**, **Pattern**, **Detail**, **System** – and overwrites the node’s `entity‑type` field accordingly. Nodes whose legacy label cannot be mapped are left untouched and flagged for manual review. The operation is **in‑place**: edges and adjacency lists are preserved; only the metadata field that drives type‑based <USER_ID_REDACTED> is rewritten.  

EntityTypeConsolidation sits under the broader **EntityTypeMigration** component, which also contains other migration artefacts (e.g., the LevelDB‑to‑KMCore script). The consolidation is scoped **exclusively** to the Graphology layer; any persistence‑layer reshaping (LevelDB) is handled elsewhere and must not be conflated with this logic.

---

## Architecture and Design  

The migration follows a **targeted, non‑destructive transformation** pattern. Rather than reconstructing the whole graph, the script walks the existing Graphology instance, mutating node attributes in‑place. This design yields two important architectural outcomes:

1. **Preservation of Topology** – because edges are never recreated, the graph’s connectivity, weightings, and any auxiliary adjacency metadata remain intact. Downstream components that rely on stable identifiers or edge‑based calculations see no disruption.

2. **Idempotent Normalisation** – the script can be re‑executed safely. If a node already carries a canonical type, the mapping step becomes a no‑op. This aligns with a “run‑once‑or‑run‑any‑time” migration philosophy, simplifying deployment pipelines.

The **closed ontology** (the six canonical types) is an explicit **domain constraint** baked into the migration. It acts as a contract for all graph‑querying code: every node is guaranteed to expose one of the six discriminants, eliminating the need for defensive checks against legacy strings scattered throughout the codebase.

From an architectural perspective, EntityTypeConsolidation is a **stand‑alone migration script** that operates at the *application‑startup* or *maintenance‑window* phase. It does not expose a public API, nor does it participate in the runtime request‑handling path. Its only external interaction is with the **Graphology** library, which supplies the mutable graph data structure.

Below is a simplified flow diagram that captures the interaction between the script and the graph:

```
+-----------------------------+
| scripts/migrate-graph-db-   |
| entity-types.js             |
+------------+----------------+
             |
   (load existing Graphology instance)
             |
   +---------v----------+
   | Iterate over nodes |
   +---------+----------+
             |
   +---------v----------+   map legacy → canonical
   |  If legacy type    |-------------------+
   |  recognised?      |                   |
   +---------+----------+                   |
             | Yes                         | No
   +---------v----------+                   |
   | Overwrite node     |   flag / log      |
   | .entityType = ...  |<------------------+
   +--------------------+
```

---

## Implementation Details  

*File:* `scripts/migrate-graph-db-entity-types.js`  

The script performs three core steps:

1. **Graph Loading** – It obtains a reference to the in‑memory Graphology instance that the rest of the application uses. Because Graphology stores nodes as plain JavaScript objects, the script can access and mutate them directly.

2. **Legacy‑to‑Canonical Mapping** – A deterministic mapping table (hard‑coded in the script) enumerates every legacy type string observed in the code history and associates it with one of the six canonical types. For example, legacy labels such as `"proj"`, `"application"` → `Project`; `"module"`, `"sub‑module"` → `Component`; etc. The mapping is exhaustive for known legacy values; any unmapped value triggers a warning flag.

3. **In‑Place Attribute Mutation** – For each node, the script reads `node.type` (or the legacy field name used in the source graph), looks it up in the mapping table, and writes the result back to `node.entityType`. The mutation is performed directly on the node object, which automatically updates the underlying Graphology store because Graphology keeps node objects by reference.

Because the script never creates or deletes nodes/edges, the **graph topology**—including adjacency lists, edge attributes, and any graph‑level indexes—remains untouched. This approach reduces memory churn and avoids the need for a full graph reconstruction pass, which would be costly for large datasets.

The script is deliberately **self‑contained**: it does not import any other migration utilities (e.g., `migrate-leveldb-to-kmcore.mjs`). This isolation reinforces the design decision that EntityTypeConsolidation applies only to the Graphology layer.

---

## Integration Points  

| Integration Aspect | Touchpoint | Description |
|--------------------|------------|-------------|
| **Parent Component** | `EntityTypeMigration` | EntityTypeConsolidation is a child migration within the broader EntityTypeMigration suite. The parent coordinates the order of migrations (e.g., LevelDB migration may run before or after this script depending on deployment scripts). |
| **Graphology Library** | Direct node mutation | The script depends on Graphology’s mutable node objects. No Graphology‑specific APIs beyond the node map are required, making the script portable across Graphology versions that preserve reference semantics. |
| **Downstream Query Code** | Assumes canonical `entityType` | After migration, all graph‑query modules can safely filter on `node.entityType === 'Component'` (or any of the six values) without guarding against legacy strings. |
| **Logging / Flagging** | Console or custom logger | Nodes with unmapped legacy types are flagged. Downstream processes (e.g., CI validation, data‑<USER_ID_REDACTED> dashboards) can consume these logs to guide manual clean‑up. |
| **LevelDB Migration** | Separate script (`migrate-leveldb-to-kmcore.mjs`) | No direct coupling; the LevelDB migration reshapes persisted storage, while EntityTypeConsolidation only touches the in‑memory representation. Coordination is achieved at the orchestration level (e.g., npm scripts, CI pipelines). |

Because EntityTypeConsolidation does not expose a module interface, integration is limited to **execution ordering** and **shared data structures** (the Graphology graph). Any component that imports or runs the migration script must ensure the graph instance is fully initialised beforehand.

---

## Usage Guidelines  

1. **Run as a One‑Time Normalisation Pass** – Execute the script after the Graphology graph is loaded but before any business logic that relies on `entityType` runs. Because the migration is idempotent, re‑execution is safe, but unnecessary runs add CPU overhead.

2. **Do Not Modify the Mapping Table Lightly** – The closed six‑type ontology is a contract. Adding a new canonical type or changing an existing mapping requires a coordinated change across all query code and possibly UI components. Treat the mapping table as a *single source of truth* for type semantics.

3. **Handle Unmapped Legacy Types** – The script flags nodes whose legacy label cannot be resolved. Developers should monitor the logs, investigate the flagged nodes, and either extend the mapping table or correct the source data. Ignoring these flags can lead to type‑unsafe <USER_ID_REDACTED> downstream.

4. **Preserve Graph Topology** – Since the migration mutates node attributes in‑place, any code that holds references to node objects before the migration will see the updated `entityType` automatically. However, avoid caching the legacy type value elsewhere; always read from `node.entityType` after migration.

5. **Coordinate with LevelDB Migration** – If the deployment pipeline also runs `migrate-leveldb-to-kmcore.mjs`, ensure the order respects data consistency. Typically, the LevelDB reshaping should happen **before** the Graphology consolidation, so that the in‑memory graph reflects the persisted state that will be normalised.

---

### Architectural patterns identified
* Targeted in‑place transformation (non‑destructive migration)  
* Idempotent normalisation pass  
* Closed ontology enforcement (domain constraint)

### Design decisions and trade‑offs
* **In‑place mutation** preserves topology and reduces memory/CPU cost but ties the script to Graphology’s mutable node model.  
* **Closed six‑type set** simplifies downstream type checks at the expense of flexibility; adding new types requires coordinated changes.  
* **Isolation from LevelDB migration** keeps responsibilities clear but introduces orchestration complexity in deployment scripts.

### System structure insights
* EntityTypeConsolidation is a leaf migration under the **EntityTypeMigration** umbrella.  
* It interacts directly with the Graphology graph, while sibling migrations (e.g., LevelDB reshaping) operate on persistence layers.  
* Downstream components rely on the canonical `entityType` field, making this migration a critical data‑integrity gate.

### Scalability considerations
* Because the migration walks every node once and mutates a single field, its time complexity is **O(N)** where *N* is the node count.  
* No additional memory allocations beyond the mapping table are required, allowing the script to scale to large graphs limited only by the host’s RAM.  
* The design avoids recomputing edges or rebuilding indexes, which would be far more costly at scale.

### Maintainability assessment
* The script is compact, self‑contained, and free of external dependencies, which eases maintenance.  
* The hard‑coded mapping table is the primary locus of change; documenting the legacy‑to‑canonical relationships is essential.  
* Clear separation from LevelDB migration reduces the risk of accidental side‑effects, but the deployment orchestration must be kept up‑to‑date to ensure correct execution order.


## Hierarchy Context

### Parent
- [EntityTypeMigration](./EntityTypeMigration.md) -- scripts/migrate-graph-db-entity-types.js consolidates legacy entity type names into the canonical six-type set (Project, Component, SubComponent, Pattern, Detail, System), rewriting node attributes in the Graphology graph


---

*Generated from 4 observations*
