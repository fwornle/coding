# AntiPatterns

**Type:** SubComponent

The AntiPatterns sub-component relies on the GraphDatabaseAdapter's retrievePatterns method to retrieve all anti-patterns from the database

## What It Is  

The **AntiPatterns** sub‑component lives inside the **CodingPatterns** domain and is responsible for persisting and retrieving anti‑pattern definitions in the project’s graph database. All interactions with the database are funneled through the **GraphDatabaseAdapter** located at `storage/graph-database-adapter.ts`. When a new anti‑pattern is created, the component calls `GraphDatabaseAdapter.storePattern`; when the full catalogue is needed it invokes `GraphDatabaseAdapter.retrievePatterns`. In short, AntiPatterns is the concrete consumer of the generic graph‑storage service, providing a focused API for “bad‑pattern” data while shielding the rest of the system from storage details.

## Architecture and Design  

The architecture around AntiPatterns is deliberately layered. At the bottom sits the **GraphDatabaseAdapter**, a reusable data‑access layer shared by all sibling sub‑components (DesignPatterns, CodingConventions, BestPractices, CodeAnalysis). AntiPatterns builds on this adapter through three classic structural patterns:

1. **Adapter pattern** – AntiPatterns converts the generic `storePattern`/`retrievePatterns` signatures into a domain‑specific contract (e.g., `addAntiPattern`, `listAntiPatterns`). This isolates the rest of the codebase from the exact method names and parameter shapes expected by the graph adapter.

2. **Facade pattern** – The sub‑component exposes a single, simplified façade (often a class or module named `AntiPatternService`) that aggregates the adapter calls, validation logic, and any transformation required before persisting an anti‑pattern. Clients of CodingPatterns need only interact with this façade, not the underlying graph operations.

3. **Bridge pattern** – The abstraction of “pattern storage” is decoupled from its implementation (the graph database). AntiPatterns holds a reference to an abstract `PatternRepository` interface, while the concrete implementation is the GraphDatabaseAdapter. This separation makes it possible to swap the storage mechanism (e.g., to a relational DB) without touching the higher‑level business logic.

Beyond structural patterns, the component adheres to **the Law of Demeter (LoD)** by never reaching through the façade to the adapter’s internals; it communicates only with its immediate collaborator (`PatternRepository`). It also follows the **DRY principle**, reusing the same adapter methods for all pattern‑type sub‑components, thereby eliminating duplicated data‑access code across the sibling modules.

## Implementation Details  

The core of AntiPatterns is a service class (conceptually `AntiPatternService`) that internally holds a reference to the adapter:

```ts
import { GraphDatabaseAdapter } from '../storage/graph-database-adapter';

export class AntiPatternService {
  private readonly repository: PatternRepository;

  constructor(adapter: GraphDatabaseAdapter) {
    // Bridge: treat the adapter as a repository implementation
    this.repository = adapter;
  }

  async addAntiPattern(ap: AntiPatternDto): Promise<void> {
    // Adapter: translate DTO to the generic shape expected by storePattern
    const generic = this.toGenericPattern(ap);
    await this.repository.storePattern(generic);
  }

  async listAntiPatterns(): Promise<AntiPatternDto[]> {
    const raw = await this.repository.retrievePatterns();
    return raw
      .filter(p => p.type === 'anti-pattern')
      .map(this.fromGenericPattern);
  }

  // Helper methods keep the code DRY and respect LoD
  private toGenericPattern(ap: AntiPatternDto): GenericPattern { … }
  private fromGenericPattern(gp: GenericPattern): AntiPatternDto { … }
}
```

* **Adapter conversion** happens in `toGenericPattern`/`fromGenericPattern`, ensuring the façade never leaks graph‑specific fields.  
* **Facade simplicity** is achieved because callers only need `addAntiPattern` and `listAntiPatterns`; all error handling, logging, and validation are encapsulated.  
* **Bridge decoupling** is evident in the constructor injection of `GraphDatabaseAdapter` as a `PatternRepository`. Should a future requirement demand a different storage backend, only the concrete repository implementation changes while the service remains untouched.

The same `storePattern` and `retrievePatterns` methods are reused by sibling components, demonstrating the DRY‑driven reuse of the adapter across the **CodingPatterns** parent.

## Integration Points  

AntiPatterns sits directly under the **CodingPatterns** parent component. Its primary external dependency is the **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`). The adapter itself is a shared service used by all sibling sub‑components (DesignPatterns, CodingConventions, BestPractices, CodeAnalysis), meaning any change to the adapter’s contract propagates throughout the entire pattern ecosystem.  

From the perspective of consumers, the only integration surface is the AntiPatterns façade (e.g., `AntiPatternService`). Higher‑level modules—such as UI layers, reporting tools, or analysis pipelines—request anti‑pattern data via this façade, never contacting the adapter directly. This clear separation enforces LoD and keeps the dependency graph shallow: **CodingPatterns → AntiPatterns façade → GraphDatabaseAdapter**.

## Usage Guidelines  

1. **Interact through the façade only** – Call `addAntiPattern` and `listAntiPatterns` (or similarly named methods) on the AntiPatterns service. Do not invoke `storePattern` or `retrievePatterns` directly; doing so would bypass the Bridge and Facade abstractions and increase coupling.  

2. **Respect the DTO contract** – Provide anti‑pattern data in the shape expected by the service’s DTO. The internal adapter conversion will handle mapping to the generic graph schema, preserving DRY and preventing duplicated mapping logic elsewhere.  

3. **Do not chain calls** – Follow the Law of Demidor by avoiding patterns like `service.repository.storePattern(...)`. Keep all repository interactions encapsulated within the service methods.  

4. **Leverage shared adapter behavior** – When adding new pattern‑type sub‑components, reuse the existing `GraphDatabaseAdapter` methods rather than creating bespoke storage code. This maintains consistency and reduces maintenance overhead.  

5. **Future‑proofing** – If a new storage backend is required, implement a new class that satisfies the `PatternRepository` interface and inject it into `AntiPatternService`. Because the service already abstracts the storage via the Bridge pattern, no changes to the façade’s public API are needed.

---

### Architectural patterns identified  
* Adapter – converts generic graph‑adapter methods to domain‑specific anti‑pattern operations.  
* Facade – provides a simplified, unified interface (`AntiPatternService`) to the rest of the system.  
* Bridge – separates the abstraction of pattern storage from its concrete graph‑database implementation.  

### Design decisions and trade‑offs  
* **Centralised adapter** reduces code duplication (DRY) but creates a single point of failure; any breaking change to `storePattern` or `retrievePatterns` impacts all siblings.  
* **Facade + Bridge** increase indirection, adding a small runtime overhead, yet they dramatically improve modularity and testability.  
* **Strict LoD adherence** limits the ability of callers to perform advanced queries directly; however, it protects the internal data model from accidental misuse.  

### System structure insights  
The system is organized as a hierarchy: **CodingPatterns** (parent) aggregates several pattern‑type sub‑components, each of which is a thin façade over the shared **GraphDatabaseAdapter**. This yields a clean vertical slice where storage concerns are isolated at the bottom, while business‑level concerns (e.g., “what is an anti‑pattern?”) reside in the upper layers.  

### Scalability considerations  
Because all pattern types funnel through a single graph database, scaling the storage layer (e.g., sharding, read‑replicas) will benefit the entire family of components uniformly. The façade design permits asynchronous batching or bulk‑write extensions without altering consumer code, supporting higher write throughput as the catalogue of anti‑patterns grows.  

### Maintainability assessment  
The combination of Adapter, Facade, and Bridge patterns, together with LoD and DRY adherence, yields high maintainability: changes to storage mechanics stay confined to `graph-database-adapter.ts`; changes to anti‑pattern business rules stay within the AntiPatterns façade. The only maintenance risk lies in the shared adapter—any regression there propagates across all siblings—so comprehensive integration tests around `storePattern`/`retrievePatterns` are essential.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for graph database interactions, which enables flexible data storage and retrieval. This adapter is crucial for the component's functioning, as it allows for the storage and retrieval of complex relationships between coding patterns and practices. For instance, the `storePattern` method in the GraphDatabaseAdapter class (storage/graph-database-adapter.ts) is used to store a new pattern in the graph database, while the `retrievePatterns` method is used to retrieve all patterns from the database. The use of this adapter simplifies the process of managing complex data relationships, making it easier to analyze and understand the coding patterns and practices employed throughout the project.

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- DesignPatterns uses the GraphDatabaseAdapter's storePattern method to store new design patterns in the graph database
- [CodingConventions](./CodingConventions.md) -- CodingConventions uses the GraphDatabaseAdapter's storePattern method to store new coding conventions in the graph database
- [BestPractices](./BestPractices.md) -- BestPractices uses the GraphDatabaseAdapter's storePattern method to store new best practices in the graph database
- [CodeAnalysis](./CodeAnalysis.md) -- CodeAnalysis uses the GraphDatabaseAdapter's storePattern method to store new code analysis results in the graph database


---

*Generated from 7 observations*
