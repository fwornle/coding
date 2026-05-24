# OntologyRegistryBridge

**Type:** Detail

The SubComponent description explicitly states the OntologyClassificationEngine 'wraps @fwornle/km-core's OntologyRegistry', establishing that OntologyRegistry is the authoritative external classification source and a translation layer is required between PersistenceAgent's internal entity model and the OntologyRegistry API boundary.

## What It Is  

The **OntologyRegistryBridge** is the concrete translation layer that lives inside the **PersistenceAgent**‑based **OntologyClassificationEngine**. Its sole responsibility is to mediate between the internal entity model used by the PersistenceAgent and the external classification contract exposed by **@fwornle/km‑core’s OntologyRegistry**. Because the bridge is nested within the `OntologyClassificationEngine`, it is not part of the extraction pipeline; instead, it operates at *persistence‑time*, i.e., when data is being written to the store. No source files or concrete class names are enumerated in the current observations, but the design intent is clear: the bridge is the only component that must understand the shape of the OntologyRegistry API and perform the necessary data‑shape transformations before a classification can be attached to a persisted entity.

## Architecture and Design  

The architecture follows a **boundary‑translation** pattern. The external **OntologyRegistry** is treated as a bounded context whose schema may evolve independently of the rest of the system. The **OntologyClassificationEngine** (the parent component) owns a child component, **OntologyRegistryBridge**, which isolates that evolution. By placing the bridge inside the **PersistenceAgent**’s lifecycle, the system adopts a **persistence‑time concern** model: classification look‑<COMPANY_NAME_REDACTED> and assignments are performed within the same transaction that writes the entity, guaranteeing atomicity between the data write and its ontology label.

Interaction flow can be visualized as:

```
[Extraction Pipeline] → (entity model) → [PersistenceAgent] → OntologyClassificationEngine
                               ↳ OntologyRegistryBridge ↔ @fwornle/km-core OntologyRegistry
```

The bridge therefore acts as a **adapter** that converts the internal entity representation into the request format expected by the OntologyRegistry, invokes the registry’s API, and maps the response back onto the internal model. Because the bridge is the sole consumer of the OntologyRegistry contract, the rest of the system remains insulated from any schema changes in that external service.

## Implementation Details  

While the observations do not list concrete class or function names, the implementation can be inferred from the described responsibilities:

* **Bridge Interface** – Exposes methods such as `lookupClassification(entity)` or `assignClassification(entity, classification)`. These methods accept the PersistenceAgent’s native entity objects.
* **Transformation Layer** – Inside each bridge method, the entity’s fields are marshalled into the payload structure required by **@fwornle/km‑core’s OntologyRegistry** (e.g., converting internal IDs to the registry’s identifier format, flattening nested attributes, etc.).
* **Registry Client** – A thin wrapper around the OntologyRegistry HTTP/GRPC client provided by **@fwornle/km‑core**. It handles authentication, request serialization, and error handling.
* **Result Mapping** – The registry’s response (typically a classification identifier or metadata) is translated back into the internal classification model used by PersistenceAgent, then attached to the entity before the transaction commits.

Because the bridge inherits the **PersistenceAgent**’s transaction context, any failure in the registry call can trigger a rollback of the write operation, preserving data consistency. The bridge therefore does not need its own transaction manager; it relies on the surrounding PersistenceAgent infrastructure.

## Integration Points  

* **Parent – OntologyClassificationEngine** – The engine owns the bridge and orchestrates when classification should be performed (e.g., after an entity is persisted but before the transaction finalizes). It may expose higher‑level services to other components, abstracting away the bridge details.
* **Sibling Components** – Any other classification‑related bridges (e.g., a possible `TaxonomyRegistryBridge`) would share the same placement inside the PersistenceAgent, leveraging the same transaction semantics and error‑handling strategy.
* **External Dependency – @fwornle/km‑core OntologyRegistry** – The bridge is the only consumer of this library’s public API. All version upgrades or contract changes are absorbed here, keeping the rest of the codebase stable.
* **PersistenceAgent** – Provides the entity model, transaction lifecycle, and persistence APIs that the bridge consumes. The bridge’s lifecycle is bound to the agent’s, meaning it is instantiated once per agent instance and reused for every classification request.

## Usage Guidelines  

1. **Invoke through the OntologyClassificationEngine** – Direct calls to the bridge should be avoided; instead, use the engine’s public methods. This preserves the abstraction barrier and ensures future changes to the bridge’s internal API do not ripple outward.
2. **Treat classification as part of the write transaction** – Because the bridge runs inside the PersistenceAgent’s transaction, callers should not commit the transaction before the classification step completes. Any exception thrown by the bridge should be allowed to propagate so the transaction can be rolled back.
3. **Do not embed registry‑specific logic elsewhere** – All transformations, error handling, and response mapping must remain inside the bridge. This keeps the extraction pipeline and other business logic free from ontology‑registry coupling.
4. **Handle registry downtime gracefully** – Although not explicitly described, the bridge should translate registry connectivity issues into domain‑specific exceptions that the PersistenceAgent can interpret (e.g., retry, fallback, or abort). Centralizing this logic in the bridge prevents scattered retry code.
5. **Version pinning** – When upgrading **@fwornle/km‑core**, only the bridge needs to be updated. Verify that the bridge’s transformation layer aligns with the new contract before promoting changes to production.

---

### Architectural Patterns Identified  

* **Adapter / Translator** – OntologyRegistryBridge adapts internal entity structures to the external OntologyRegistry API.  
* **Boundary Context Isolation** – By encapsulating the external registry behind the bridge, the system isolates the bounded context of ontology classification.  
* **Transaction‑Scoped Concern** – Classification is performed within the PersistenceAgent’s transaction, ensuring atomicity.

### Design Decisions and Trade‑offs  

* **Placement at Persistence Time** – Guarantees that classification always reflects the final persisted state, but introduces a coupling between write latency and registry responsiveness.  
* **Single‑point of Registry Integration** – Simplifies maintenance (only the bridge must change on registry updates) but creates a potential bottleneck if many writes require classification simultaneously.  
* **Decoupling Extraction Pipeline** – Extraction code remains stable across ontology schema changes, at the cost of deferring classification errors to write time.

### System Structure Insights  

* **Parent‑Child Relationship** – `OntologyClassificationEngine` owns `OntologyRegistryBridge`; the bridge is the only child that directly talks to the external ontology service.  
* **Sibling Symmetry** – Any additional registry bridges would follow the same pattern, sharing lifecycle and transaction semantics.  
* **Cross‑Component Boundary** – The bridge is the sole crossing point between the internal persistence domain and the external ontology domain.

### Scalability Considerations  

* Because classification calls are executed synchronously within write transactions, scaling write throughput may require caching of frequent classification results or asynchronous pre‑fetching strategies.  
* The bridge can be horizontally scaled alongside the PersistenceAgent instances; each instance maintains its own lightweight client to the OntologyRegistry, avoiding a single point of failure.

### Maintainability Assessment  

* **High Maintainability** – The clear separation of concerns means that ontology‑registry contract changes affect only the bridge.  
* **Low Cognitive Overhead** – Developers working on extraction or other business logic do not need to understand registry details.  
* **Potential Technical Debt** – If the bridge accumulates many special‑case transformations for legacy registry versions, the adapter logic could become complex; regular refactoring is advisable.  

---  

*Diagram (conceptual)*  

```
+-------------------+        +-------------------+        +---------------------------+
| Extraction Pipeline| ----> | PersistenceAgent  | ----> | OntologyClassificationEngine |
+-------------------+        +-------------------+        +---------------------------+
                                                          |
                                                          v
                                                +-----------------------+
                                                | OntologyRegistryBridge|
                                                +-----------------------+
                                                          |
                                                          v
                                         +-----------------------------------+
                                         | @fwornle/km-core OntologyRegistry |
                                         +-----------------------------------+
```  

The diagram illustrates the flow of an entity from extraction through persistence, where the **OntologyRegistryBridge** mediates classification against the external registry.


## Hierarchy Context

### Parent
- [OntologyClassificationEngine](./OntologyClassificationEngine.md) -- The engine lives inside PersistenceAgent and wraps @fwornle/km-core's OntologyRegistry, meaning ontology classification is a persistence-time concern rather than an extraction-time concern


---

*Generated from 4 observations*
