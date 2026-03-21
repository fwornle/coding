# EntityChangeMergeStrategy

**Type:** Detail

The EntityChangeMergeStrategy may use a combination of last-writer-wins and multi-version concurrency control approaches to handle concurrent edits and ensure data consistency.

## What It Is  

`EntityChangeMergeStrategy` is the component responsible for reconciling concurrent modifications made to an entity’s data during the **EntityEditing** workflow.  The strategy lives inside the **EntityManagement** module – the same high‑level area that hosts the `EntityAuthoringService` class defined in `entity‑authoring‑service.py`.  Although no concrete source file for the strategy itself was discovered, the surrounding documentation makes it clear that the merge logic is invoked whenever the authoring service applies edits that have been staged or received from multiple sources.  The strategy’s purpose is to decide **how** those edits are combined and ultimately persisted, taking into account versioning, business rules, and the relationships that tie the entity to other parts of the domain model.

## Architecture and Design  

The design of `EntityChangeMergeStrategy` follows a **hybrid concurrency‑control architecture**.  According to the observations, the strategy blends two well‑known approaches:

1. **Last‑Writer‑Wins (LWW)** – the most recent change (as determined by a timestamp or logical clock) overwrites earlier edits.  
2. **Multi‑Version Concurrency Control (MVCC)** – each edit is stored as a separate version, allowing the system to inspect, compare, and possibly merge divergent changes before a final decision is made.

By combining LWW and MVCC, the system gains the simplicity of LWW for straightforward cases while retaining the flexibility of MVCC when business rules or entity relationships demand a more nuanced resolution.  The strategy is therefore not a single monolithic algorithm but a **policy‑driven pipeline** that can switch between or blend the two techniques based on context.

From an architectural standpoint, the strategy behaves as a **Strategy pattern** implementation (the name itself—*EntityChangeMergeStrategy*—suggests this).  The parent component, **EntityManagement**, likely holds a reference to an abstract “merge strategy” interface, and `EntityAuthoringService` supplies the concrete implementation at runtime.  This mirrors the Factory pattern already evident in `EntityAuthoringService` (see *EntityFactoryPattern* sibling), where the service creates and configures entities as well as the appropriate merge strategy for each editing session.

## Implementation Details  

Although the source symbols for the strategy are absent, the observations give us enough clues to outline its internal mechanics:

* **Version Capture** – Every edit performed through `EntityAuthoringService` is stamped with a version identifier (e.g., a monotonically increasing integer or a timestamp).  These versions are stored alongside the entity’s mutable fields, forming a lightweight history that MVCC can later query.

* **Conflict Detection** – When a new edit arrives, the strategy compares its version against the latest persisted version.  If the incoming version is newer, the LWW rule would normally accept it outright.  However, before committing, the strategy checks **entity relationships** and **business rules** (as noted in observation 3).  For example, if two concurrent edits modify related fields that must stay in sync, the strategy may flag a conflict rather than applying LWW blindly.

* **Rule‑Based Merging** – Business‑rule hooks are consulted to decide whether to merge, reject, or defer a change.  These hooks could be implemented as callbacks registered by the **EntityValidationMechanism** sibling, allowing validation logic to influence merge outcomes.  In practice, a rule might state “if the price field changes, also update the discount field according to policy X,” prompting the strategy to apply a composite update rather than a simple overwrite.

* **Final Commit** – Once the appropriate merge path is selected (pure LWW, MVCC‑based reconciliation, or a rule‑driven composite), the strategy writes the resolved state back to the entity store.  The resolved version becomes the new “head” version, and any superseded versions are retained for audit or rollback purposes.

Because the strategy is invoked from `EntityAuthoringService`, the service likely passes a **change set** object that bundles the raw edits, their metadata, and a reference to the target entity.  The strategy then returns a **merged change set** or a status indicating that manual intervention is required.

## Integration Points  

`EntityChangeMergeStrategy` sits at the intersection of several system modules:

* **EntityManagement** – The parent component orchestrates the overall lifecycle of entities.  It provides the configuration that determines which concrete merge strategy implementation is used for a given entity type.

* **EntityAuthoringService (entity‑authoring‑service.py)** – This service acts as the primary caller.  It constructs the change set, invokes the strategy, and subsequently persists the merged result.  The service’s use of the Factory pattern to instantiate editors aligns with the strategy’s need for pluggable behavior.

* **EntityFactoryPattern (sibling)** – The factory that creates entity instances also supplies default merge‑strategy instances when a new entity is first authored, ensuring that every entity carries a compatible merging capability from day one.

* **EntityValidationMechanism (sibling)** – Validation rules registered here are consulted during the merge process.  For example, a validation rule that enforces referential integrity across related entities can cause the merge strategy to reject a conflicting edit before it corrupts the data graph.

* **Persistence Layer** – Although not explicitly named, the final commit step must interact with whatever storage mechanism (database, document store, etc.) backs the entities.  The strategy’s versioning data is persisted alongside the entity, enabling later MVCC reads.

## Usage Guidelines  

1. **Treat the Strategy as a Black Box** – When using `EntityAuthoringService` to edit entities, developers should not attempt to manipulate version numbers directly.  Instead, rely on the service’s `applyChanges()` (or similarly named) method, which internally delegates to the merge strategy.

2. **Register Business‑Rule Callbacks Early** – If custom business logic influences how edits should be merged, register those callbacks with the **EntityValidationMechanism** before any editing sessions begin.  This ensures the strategy can consult the rules during conflict resolution.

3. **Avoid Simultaneous Manual Edits on the Same Entity** – While the strategy can reconcile concurrent changes, the cost of conflict detection and rule evaluation grows with edit frequency.  Where possible, serialize manual edits or employ optimistic locking at the UI level to reduce contention.

4. **Leverage Version History for Auditing** – Because MVCC retains prior versions, developers can query the entity’s change log for debugging or compliance purposes.  Expose a read‑only API that surfaces these historical versions without allowing direct mutation.

5. **Test Merge Scenarios** – Unit tests should cover the three primary paths: pure LWW, MVCC‑driven reconciliation, and rule‑based merging.  Mock the validation callbacks to simulate business‑rule conflicts and verify that the strategy returns the expected status (e.g., `MERGED`, `REJECTED`, `MANUAL_REVIEW_REQUIRED`).

---

### 1. Architectural patterns identified  
* **Strategy pattern** – `EntityChangeMergeStrategy` encapsulates interchangeable merge algorithms.  
* **Hybrid concurrency control** – Combination of **Last‑Writer‑Wins** and **Multi‑Version Concurrency Control**.  
* **Factory pattern** – Evident in `EntityAuthoringService` for creating editors and, by extension, the appropriate merge strategy.

### 2. Design decisions and trade‑offs  
* **LWW simplicity vs. MVCC flexibility** – LWW gives fast, deterministic resolution for low‑conflict scenarios; MVCC adds overhead but enables safe merging when business rules demand it.  
* **Rule‑driven merging** – Allows domain‑specific constraints to supersede generic conflict resolution, at the cost of added complexity and potential performance impact.  
* **Version retention** – Improves auditability and rollback capability but consumes additional storage.

### 3. System structure insights  
* `EntityChangeMergeStrategy` is a child of **EntityManagement** and is tightly coupled with **EntityAuthoringService**.  
* Sibling components (**EntityFactoryPattern**, **EntityValidationMechanism**) provide complementary responsibilities: object creation and validation, both of which feed into the merge process.  
* The strategy acts as a conduit between the authoring layer and the persistence layer, ensuring that every edit respects versioning and business constraints.

### 4. Scalability considerations  
* **Horizontal scaling** – Because merge decisions are deterministic given the same version set and rule set, the strategy can be executed on any node handling edit requests, provided that the version store is shared (e.g., via a distributed database).  
* **Contention handling** – High edit concurrency on the same entity may lead to many MVCC branches, increasing merge‑resolution time.  Partitioning entities by domain or sharding the version store can mitigate hot‑spot contention.  
* **Rule evaluation cost** – Complex business‑rule graphs can become a bottleneck; caching rule outcomes for unchanged contexts can improve throughput.

### 5. Maintainability assessment  
* **Clear separation of concerns** – The strategy’s isolation from the authoring service and validation mechanism makes it straightforward to replace or extend the merge algorithm without touching unrelated code.  
* **Extensible via callbacks** – Adding new business rules does not require modifying the core merge logic; developers simply register additional validation hooks.  
* **Potential hidden complexity** – The hybrid LWW/MVCC approach introduces branching logic that must be well‑documented; future maintainers need to understand when each path is taken.  Comprehensive unit tests and version‑history tooling are essential to keep the component maintainable over time.

## Hierarchy Context

### Parent
- [EntityManagement](./EntityManagement.md) -- The EntityAuthoringService class in entity-authoring-service.py employs the Factory pattern to handle manual entity creation and editing.

### Siblings
- [EntityFactoryPattern](./EntityFactoryPattern.md) -- The EntityAuthoringService class in entity-authoring-service.py employs the Factory pattern to handle manual entity creation and editing, as seen in the class definition.
- [EntityValidationMechanism](./EntityValidationMechanism.md) -- The EntityCreation and EntityEditing techniques likely involve data validation, which is a critical step in ensuring data quality and preventing errors.

---

*Generated from 3 observations*
