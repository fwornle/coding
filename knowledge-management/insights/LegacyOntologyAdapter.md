# LegacyOntologyAdapter

**Type:** Detail

The adapter pattern implies the km-core OntologyRegistry predates the current interface design, and LegacyOntologyAdapter exists to avoid rewriting registry logic while conforming to the newer interface contracts.

## What It Is  

**LegacyOntologyAdapter** lives at the intersection of the **Ontology** and **SemanticAnalysis** subsystems.  The adapter is referenced from the documentation file `docs/architecture/agents.md`, where the two high‑level contracts **OntologyClassifier** and **OntologyValidator** are described.  Both contracts are currently satisfied by a single implementation – the **LegacyOntologyAdapter** – which sits on top of the historic `km‑core` **OntologyRegistry**.  The adapter itself is composed of a child component, **RegistryDecouplingAdapter**, whose purpose is documented in `integrations/mcp‑server‑semantic‑analysis/CRITICAL‑ARCHITECTURE‑ISSUES.md`.  

In short, LegacyOntologyAdapter is a façade‑style wrapper that presents the modern `OntologyClassifier` and `OntologyValidator` interfaces while delegating all substantive work to the pre‑existing OntologyRegistry.  Its presence allows newer code to depend on clean, purpose‑specific interfaces without having to rewrite the legacy registry logic.

---

## Architecture and Design  

The architecture around LegacyOntologyAdapter is driven by **adapter** and **facade** patterns.  The older `km‑core` OntologyRegistry predates the newer interface definitions, so the system introduces a façade (LegacyOntologyAdapter) that implements the two distinct contracts – **OntologyClassifier** and **OntologyValidator** – and forwards calls to the registry.  This façade isolates the rest of the codebase from the registry’s concrete API, enabling a clean separation of concerns: classification logic lives behind `OntologyClassifier`, validation logic behind `OntologyValidator`, yet both share a single underlying implementation.

Inside the façade, the **RegistryDecouplingAdapter** acts as a secondary adapter whose explicit goal is to break the tight coupling that the original OntologyClassifier had with the internal registry (see `CRITICAL‑ARCHITECTURE‑ISSUES.md`).  By inserting this decoupling layer, the design reduces direct dependencies on registry internals, making it easier to replace or extend the registry in the future.

The component hierarchy is therefore:

```
Ontology (parent)
│
└─ LegacyOntologyAdapter  ← implements OntologyClassifier & OntologyValidator
   │
   └─ RegistryDecouplingAdapter  ← shields OntologyClassifier from registry specifics
```

The **SemanticAnalysis** subsystem also references LegacyOntologyAdapter, indicating that downstream analysis pipelines consume the unified façade rather than the raw registry.

---

## Implementation Details  

Although no concrete code symbols are listed, the documentation clarifies the structural relationships:

* **LegacyOntologyAdapter** is the concrete class that implements the two interfaces defined in `docs/architecture/agents.md`.  Its methods are thin wrappers that translate the `OntologyClassifier` and `OntologyValidator` contracts into calls against the `km‑core` **OntologyRegistry**.  
* The **RegistryDecouplingAdapter** sits inside LegacyOntologyAdapter.  Its responsibility is to encapsulate any registry‑specific quirks—such as specific lookup signatures, caching strategies, or mutation semantics—so that the outer façade can remain agnostic of those details.  This decoupling is explicitly highlighted as a “critical resolved issue” in `integrations/mcp‑server‑semantic‑analysis/CRITICAL‑ARCHITECTURE‑ISSUES.md`.

Because the adapter pattern is used, the implementation likely follows a straightforward delegation model:

1. An incoming request to `OntologyClassifier.classify(term)` is received by LegacyOntologyAdapter.  
2. LegacyOntologyAdapter forwards the request to RegistryDecouplingAdapter, which translates the request into the appropriate `OntologyRegistry` call (e.g., `registry.lookup(term)`).  
3. The registry returns raw ontology data; RegistryDecouplingAdapter may post‑process it (e.g., map legacy identifiers to the new model).  
4. LegacyOntologyAdapter returns the processed result to the caller.

The same flow applies for validation, with the adapter exposing `OntologyValidator.validate(term, schema)` while internally delegating to the registry via the decoupling layer.

---

## Integration Points  

LegacyOntologyAdapter is a central integration node:

* **Parent – Ontology**: The Ontology component defines the high‑level contracts (`OntologyClassifier`, `OntologyValidator`).  LegacyOntologyAdapter fulfills those contracts, making it the concrete bridge between the abstract ontology services and the legacy registry implementation.
* **Sibling – SemanticAnalysis**: The SemanticAnalysis subsystem consumes the façade.  Any semantic pipelines that need classification or validation of terms will call the adapter rather than interacting directly with the registry.
* **Child – RegistryDecouplingAdapter**: This internal adapter isolates the façade from registry implementation details.  It is the only place where changes to the underlying `km‑core` OntologyRegistry need to be reflected, keeping the rest of the system stable.
* **External Dependency – km‑core OntologyRegistry**: The legacy registry remains the ultimate source of truth for ontology data.  All persistence, lookup, and mutation operations are delegated to it, meaning that any performance or reliability characteristics of the registry directly affect the adapter’s behaviour.

The documentation in `CRITICAL‑ARCHITECTURE‑ISSUES.md` emphasizes that the decoupling was introduced to resolve a tight coupling issue, indicating that the adapter now serves as the primary integration surface for any component that requires ontology services.

---

## Usage Guidelines  

1. **Prefer the façade interfaces** – All new code should depend on `OntologyClassifier` and `OntologyValidator` rather than accessing the `km‑core` OntologyRegistry directly.  This ensures that the decoupling layer remains effective and future registry replacements will be transparent to callers.  
2. **Do not bypass RegistryDecouplingAdapter** – Internal modifications to LegacyOntologyAdapter must go through the decoupling adapter.  Direct registry calls re‑introduce the coupling that the architecture deliberately avoided.  
3. **Treat LegacyOntologyAdapter as a singleton service** – Because it wraps a shared registry, creating multiple instances can lead to redundant lookups and inconsistent caching.  The typical usage pattern is a single, application‑wide instance injected where needed.  
4. **Handle classification and validation errors uniformly** – Both interfaces funnel errors through the same underlying registry; therefore, error handling logic should be consistent (e.g., catching registry‑specific exceptions and translating them into domain‑level `ClassificationException` or `ValidationException`).  
5. **Monitor registry performance** – Since the adapter is a thin wrapper, any latency or throughput bottlenecks in the `km‑core` OntologyRegistry will surface directly.  Performance metrics should be collected at the adapter boundary to detect issues early.

---

### Summary of Key Insights  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Architectural patterns** | Facade (LegacyOntologyAdapter) + Adapter (RegistryDecouplingAdapter) |
| **Design decisions** | Reuse existing `km‑core` OntologyRegistry; introduce a single adapter to satisfy two distinct contracts; add a decoupling layer to resolve tight coupling (documented in `CRITICAL‑ARCHITECTURE‑ISSUES.md`). |
| **System structure** | Ontology (parent) → LegacyOntologyAdapter (implements two interfaces) → RegistryDecouplingAdapter (child) → km‑core OntologyRegistry (legacy implementation). |
| **Scalability considerations** | The adapter introduces minimal overhead; scalability hinges on the underlying registry.  Adding caching or read‑through strategies inside RegistryDecouplingAdapter could improve throughput without altering callers. |
| **Maintainability assessment** | High maintainability for new features because callers interact only with stable interfaces.  The primary maintenance burden lies in keeping RegistryDecouplingAdapter in sync with any changes to the legacy registry API.  The façade isolates most of the codebase from those changes, reducing ripple effects. |

These insights provide a concrete reference for anyone extending, testing, or refactoring the ontology‑related parts of the system.


## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- docs/architecture/agents.md describes OntologyClassifier and OntologyValidator as distinct interfaces, both now backed by LegacyOntologyAdapter wrapping km-core OntologyRegistry

### Children
- [RegistryDecouplingAdapter](./RegistryDecouplingAdapter.md) -- The architectural motivation is explicitly documented in integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md, which records that OntologyClassifier was tightly coupled to an internal registry as a critical resolved issue.


---

*Generated from 3 observations*
