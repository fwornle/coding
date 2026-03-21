# ViolationStorage

**Type:** Detail

The interaction with the ContentValidationModule suggests that the ViolationStorage mechanism must adhere to specific data formats and validation rules as outlined in the project's documentation, such as the constraint configuration guide found in integrations/mcp-constraint-monitor/docs/constraint-configuration.md.

## What It Is  

**ViolationStorage** is the concrete storage mechanism used by the **ViolationPersistenceService** to record constraint‑violation events that are discovered during content validation. The only concrete locations that mention this component are the high‑level design documents under the *integrations/mcp-constraint-monitor* folder, specifically  

* `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` – which defines the data format and configuration rules that any violation record must obey, and  
* `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` – which describes the semantic‑constraint detection process whose output is persisted by ViolationStorage.  

Although no source files are listed, the documentation makes it clear that **ViolationStorage** lives inside the *ConstraintSystem* boundary and is a child of **ViolationPersistenceService**. Its purpose is to provide a reliable, format‑compliant repository for violation payloads that the **ContentValidationModule** produces.

---

## Architecture and Design  

The observations point to a **layered architecture** in which the *ConstraintSystem* is split into distinct concerns:

1. **Validation Layer** – embodied by the **ContentValidationModule**, which applies rule sets to incoming content and emits violation objects.  
2. **Persistence Layer** – represented by **ViolationPersistenceService** and its child **ViolationStorage**, which accept those objects and write them to the chosen backing store.  

The design follows a **service‑repository style**: the *service* (`ViolationPersistenceService`) orchestrates the flow, while the *repository* (`ViolationStorage`) encapsulates all knowledge about how violations are serialized, validated against the constraint‑configuration schema, and ultimately persisted. The interaction is tight: the service “contains” the storage component, indicating composition rather than loose coupling, which is appropriate given the need for atomicity when recording a violation.

Because the only concrete guidance comes from the two markdown documents, the system is deliberately **configuration‑driven**. The constraint‑configuration guide defines the exact JSON/YAML schema that a violation record must match, and the semantic‑constraint detection guide dictates the logical shape of the data (e.g., hierarchical rule identifiers, timestamps, affected content identifiers). This suggests that **ViolationStorage** likely validates incoming payloads against those schemas before committing them, enforcing data integrity at the persistence boundary.

No explicit patterns such as “event‑driven” or “micro‑services” are mentioned, so the architecture should be understood as a **monolithic module** within the larger MCP constraint‑monitor integration, with clear internal boundaries rather than distributed components.

---

## Implementation Details  

Even though the source code is absent, the documentation allows us to infer the key implementation responsibilities of **ViolationStorage**:

* **Schema Validation** – Before any write, the storage component must parse the violation payload and validate it against the schema described in `constraint-configuration.md`. This likely involves a JSON‑schema validator or a custom deserializer that throws on mismatches.  
* **Semantic Mapping** – The detection guide (`semantic-constraint-detection.md`) describes how raw detection results are transformed into a normalized violation object. **ViolationStorage** therefore contains logic that maps detection identifiers, severity levels, and context information into the storage model.  
* **Persistence Mechanics** – While the exact backing store is not disclosed, the naming (“Storage”) and its placement under a *PersistenceService* imply a classic repository implementation: a class with `save`, `update`, and `query`‑style methods. The storage could be a relational database, a NoSQL document store, or a file‑based log, but the design abstracts that detail behind the service interface.  
* **Transactional Guarantees** – Because violations are part of the system’s audit trail, the storage component is expected to provide at least *once* durability. The service‑storage composition suggests that the `ViolationPersistenceService` may open a transaction, delegate the write to **ViolationStorage**, and commit only on successful validation, ensuring consistency.  

The hierarchy is simple: **ViolationPersistenceService** → **ViolationStorage**. No sibling components are mentioned, so the storage is the sole child responsible for persistence concerns.

---

## Integration Points  

1. **ContentValidationModule** – The primary producer of violation data. The module hands over a violation payload to **ViolationPersistenceService**, which then forwards it to **ViolationStorage**. The contract between them is dictated by the data formats in `constraint-configuration.md`.  
2. **Constraint Configuration** – The storage component reads the configuration files (or a compiled representation thereof) to know which fields are mandatory, the allowed value ranges, and any versioning rules. This coupling ensures that any change to the constraint schema automatically propagates to storage validation.  
3. **Semantic Detection Logic** – The detection guide informs how raw detection results are interpreted. **ViolationStorage** must understand the semantic mapping to store the right identifiers and relationships, which means it likely imports utility classes or parsers defined elsewhere in the *semantic‑constraint‑detection* module.  
4. **External Persistence Backend** – Though not named, the storage component will have a driver or client library for the underlying database or log system. That backend is an external dependency, but the design abstracts it behind the storage API, allowing the rest of the system to remain agnostic of the concrete store.

---

## Usage Guidelines  

* **Always pass validated objects** – Developers should let the **ContentValidationModule** produce the violation payload and rely on its internal validation before invoking the `ViolationPersistenceService`. Direct calls to **ViolationStorage** should be avoided unless the caller can guarantee schema compliance.  
* **Respect the constraint schema** – Any custom extensions to the violation record must first be reflected in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. Failing to keep the documentation and the storage implementation in sync will cause runtime validation errors.  
* **Handle persistence errors gracefully** – Because the storage component may reject malformed payloads or encounter backend failures, callers should catch the specific exceptions thrown by `ViolationPersistenceService.saveViolation` (or the equivalent method) and implement retry or fallback logic as appropriate.  
* **Do not bypass the service layer** – The composition relationship (`ViolationPersistenceService` contains `ViolationStorage`) is intentional; it centralizes transaction handling and logging. Direct access to the storage backend circumvents these concerns and is discouraged.  

---

### Architectural patterns identified  

* **Layered Architecture** – Validation → Service → Storage.  
* **Service‑Repository (or Service‑Storage) Pattern** – `ViolationPersistenceService` orchestrates, `ViolationStorage` encapsulates persistence.  
* **Configuration‑Driven Validation** – Schemas defined in external markdown files drive runtime validation.

### Design decisions and trade‑offs  

* **Tight coupling between service and storage** simplifies transaction management but reduces the ability to swap storage implementations without changing the service.  
* **Schema validation at the storage boundary** guarantees data integrity but adds processing overhead on every write.  
* **Configuration‑driven design** enables rapid rule changes without code modifications, at the cost of requiring disciplined documentation updates.

### System structure insights  

* **ViolationStorage** is a child component of **ViolationPersistenceService**, which itself sits within the *ConstraintSystem* core.  
* The only sibling relationships are implicit; the storage component is the sole persistence artifact for violations.  
* The component’s responsibilities are clearly bounded to format compliance and durable recording, leaving detection and business‑logic concerns to upstream modules.

### Scalability considerations  

* Because validation occurs on every write, scaling the storage layer will require efficient schema validators (e.g., compiled JSON‑schema).  
* If the underlying store is a relational DB, horizontal scaling may involve sharding by tenant or time‑bucket.  
* The service‑storage composition means that scaling the service (e.g., adding more instances) must be paired with a stateless storage client or connection pooling to avoid bottlenecks.

### Maintainability assessment  

* **High maintainability** – The clear separation of concerns and reliance on external, version‑controlled documentation make updates straightforward.  
* **Potential risk** – The lack of explicit code symbols means that any change to the schema must be reflected both in docs and in the (unseen) validation logic; missing a sync could lead to runtime failures.  
* **Extensibility** – Adding new violation fields only requires updates to the constraint‑configuration guide and, if needed, to the storage serializer, keeping the impact localized.  

Overall, **ViolationStorage** embodies a disciplined, configuration‑driven persistence strategy that aligns tightly with the constraint‑monitoring domain while preserving a clean architectural boundary between validation, service orchestration, and data durability.

## Hierarchy Context

### Parent
- [ViolationPersistenceService](./ViolationPersistenceService.md) -- The ViolationPersistenceService interacts with the ContentValidationModule to store violation records.

---

*Generated from 3 observations*
