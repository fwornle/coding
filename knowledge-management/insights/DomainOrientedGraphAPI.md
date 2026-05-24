# DomainOrientedGraphAPI

**Type:** Detail

Project documentation references relationship types such as CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, CONTAINS_MODULE, DEFINES, DEFINES_METHOD, and DEPENDS_ON_EXTERNAL (listed as key documented components), which are the kinds of domain concepts the adapter API is expected to model rather than generic graph edges.

# DomainOrientedGraphAPI

## What It Is

The `DomainOrientedGraphAPI` is a design concept realized within the `GraphDatabaseAdapter`, which is the implementation surface described by its parent component `AdapterAndWrapperPatterns`. Rather than being a standalone file or class, it represents the *shape* and *vocabulary* of the public interface that `GraphDatabaseAdapter` exposes to the rest of the system. The observations explicitly state that this adapter "exposes a domain-oriented API rather than the raw Graphology or LevelDB interfaces directly," meaning the API's method naming, parameters, and granularity are driven by the application's domain semantics rather than by the capabilities of the underlying graph or persistence libraries.

Concretely, the API is modeled around the project's own conceptual vocabulary: code structure relationships such as `CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`, `DEFINES_METHOD`, and `DEPENDS_ON_EXTERNAL`. These named relationship types — not generic primitives like `addEdge(source, target, label)` — are what the domain-oriented API surfaces. This makes the API self-documenting in the language of the problem domain (code analysis and structural relationships) rather than the language of graph theory.

Because `DomainOrientedGraphAPI` lives behind the `GraphDatabaseAdapter` boundary, it is the contract that all upstream domain-layer consumers depend upon. Its design intent is to make the underlying choice of Graphology (for in-memory graph operations) and LevelDB (for persistence) an implementation detail that callers never need to be aware of.

## Architecture and Design

The architectural pattern at work here is a classic **Adapter** combined with a **Domain-Specific Facade**. The parent entity `AdapterAndWrapperPatterns` establishes the broader pattern: wrapping third-party libraries behind a boundary that speaks the application's language. `DomainOrientedGraphAPI` is the *outward-facing* expression of that pattern — the methods, names, and semantics that consumers actually see and call. Its sibling, `GraphologyLevelDBBinding`, represents the *inward-facing* counterpart: the wiring that co-wraps Graphology and LevelDB together as a single cohesive substrate beneath the same adapter.

A key design decision is the deliberate refusal to leak the abstractions of the underlying libraries. Even though Graphology offers a rich, general-purpose graph API and LevelDB offers a key-value persistence API, none of those primitives are propagated upward. Instead, the API is shaped around higher-level operations that align with the documented relationship types (`CONTAINS_PACKAGE`, `DEFINES_METHOD`, `DEPENDS_ON_EXTERNAL`, etc.). This trades a degree of flexibility — callers cannot perform arbitrary low-level graph manipulations — for clarity, safety, and architectural discipline.

The design also enforces a strict dependency-isolation rule: "all Graphology and LevelDB import dependencies [are isolated] behind the adapter boundary." This means imports of those libraries are physically constrained to the adapter module, creating a single chokepoint through which all graph and persistence concerns flow. The architecture is therefore a layered one, with the `DomainOrientedGraphAPI` as the contract layer, the adapter implementation as the translation layer, and Graphology+LevelDB (managed via `GraphologyLevelDBBinding`) as the substrate layer.

## Implementation Details

Although the observations do not enumerate specific code symbols (the code structure context reports 0 symbols), the implementation mechanics can be reasoned about from the documented design. The API methods correspond to the documented relationship vocabulary: operations to create, traverse, and query `CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`, `DEFINES_METHOD`, and `DEPENDS_ON_EXTERNAL` relationships. Each domain-level method internally translates to one or more Graphology graph operations (for in-memory structure) and LevelDB writes or reads (for persistence), but those translations are encapsulated entirely within `GraphDatabaseAdapter`.

The granularity of the API is itself a design statement. Rather than offering generic `addNode` / `addEdge` calls, the API is expected to provide methods whose names and signatures reflect the relationship types directly — for example, methods that create a `CONTAINS_FILE` relationship know what kinds of entities can participate, what metadata must accompany the link, and how to persist it. This domain-aware granularity reduces the cognitive load on consumers and prevents misuse of the underlying graph (such as creating semantically meaningless edges).

The two underlying substrates — Graphology and LevelDB — are coupled through the sibling component `GraphologyLevelDBBinding`, which the observations describe as an "intentional architectural pairing." `DomainOrientedGraphAPI` therefore does not directly orchestrate persistence and in-memory operations as separate concerns to its callers; instead, those concerns are unified at the binding layer, and the API simply exposes the unified result.

## Integration Points

The primary integration point for `DomainOrientedGraphAPI` is the boundary between the adapter and all domain-layer consumers. Because the API speaks in domain terms, any module that needs to record or query code-structural relationships — package containment, file containment, method definitions, external dependencies — interacts exclusively through this surface. There is no direct path from domain consumers to Graphology or LevelDB; the observations make this explicit by noting that "swapping out either underlying library would only require changes inside `GraphDatabaseAdapter` without modifying any domain-layer consumers."

Downward, `DomainOrientedGraphAPI` integrates with the substrate via `GraphologyLevelDBBinding`, its sibling under `AdapterAndWrapperPatterns`. The binding handles the dual-library coordination (in-memory graph plus on-disk persistence) so that the API itself can present a single coherent interface. This separation — domain-facing API on top, binding underneath — means the API does not need to encode persistence-versus-memory distinctions in its method signatures.

Upward, the API integrates with whatever components produce or consume the documented relationship types. Any code that builds the graph model of a codebase (discovering packages, folders, files, modules, methods, and external dependencies) calls into the domain-oriented methods to record those facts.

## Usage Guidelines

Developers working with this system should treat `DomainOrientedGraphAPI` as the *only* legitimate way to interact with graph state. Direct imports of Graphology or LevelDB from outside `GraphDatabaseAdapter` should be considered an architectural violation: they would defeat the encapsulation that makes library substitution possible and would scatter low-level graph concerns throughout the codebase. The rule is that all such imports live behind the adapter boundary, and consumers should depend only on the domain-oriented methods.

When extending the system with new relationship semantics, new domain-oriented methods should be added to the API rather than exposing generic edge-creation utilities. The existing vocabulary (`CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`, `DEFINES_METHOD`, `DEPENDS_ON_EXTERNAL`) sets the precedent: each relationship type gets first-class representation in the API, with method names and parameters that reflect domain meaning. This keeps the API consistent and self-documenting.

Finally, when reasoning about behavior or debugging, developers should remember that operations through this API are simultaneously affecting in-memory Graphology state and LevelDB-persisted state (via the `GraphologyLevelDBBinding` pairing). The API hides this duality intentionally, but understanding it is useful when investigating consistency, performance, or recovery scenarios.

---

## Summary of Requested Analysis

**1. Architectural patterns identified:** Adapter pattern and Domain-Specific Facade, with strict dependency isolation. The pattern is formalized at the parent level by `AdapterAndWrapperPatterns` and complemented by the sibling `GraphologyLevelDBBinding` that handles dual-library co-wrapping.

**2. Design decisions and trade-offs:** The decision to expose only domain-oriented methods (named after relationship types like `CONTAINS_PACKAGE` and `DEFINES_METHOD`) trades raw flexibility for semantic clarity and substitutability. Callers cannot perform arbitrary Graphology operations, but the codebase gains a clean library-swap boundary and a self-documenting API.

**3. System structure insights:** The system is layered — domain consumers on top, `DomainOrientedGraphAPI` as the contract, `GraphDatabaseAdapter` as the translator, `GraphologyLevelDBBinding` as the substrate orchestrator, and Graphology+LevelDB as the underlying libraries. All third-party imports are concentrated at the adapter boundary.

**4. Scalability considerations:** Scalability is delegated to the underlying substrates: Graphology bounds in-memory scale, and LevelDB bounds persistent scale. Because the API is domain-oriented, it could in principle be re-implemented over a different graph store or persistence engine if scaling requirements change, without disturbing consumers.

**5. Maintainability assessment:** Maintainability is high by design. The single-chokepoint rule (all Graphology and LevelDB imports inside `GraphDatabaseAdapter`) means library upgrades, replacements, or behavioral changes have a bounded blast radius. The domain-aligned vocabulary makes the API readable and reduces the risk of semantically incorrect graph manipulations by consumers.


## Hierarchy Context

### Parent
- [AdapterAndWrapperPatterns](./AdapterAndWrapperPatterns.md) -- GraphDatabaseAdapter wraps the Graphology graph library combined with LevelDB persistence, exposing a domain-oriented API rather than the raw Graphology or LevelDB interfaces directly.

### Siblings
- [GraphologyLevelDBBinding](./GraphologyLevelDBBinding.md) -- GraphDatabaseAdapter (described in AdapterAndWrapperPatterns) explicitly co-wraps two distinct third-party systems — Graphology for in-memory graph operations and LevelDB for on-disk persistence — rather than using either library in isolation, which is an intentional architectural pairing.


---

*Generated from 3 observations*
