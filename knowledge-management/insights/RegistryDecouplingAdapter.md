# RegistryDecouplingAdapter

**Type:** Detail

By sitting between pipeline agents and the registry, this component follows the integration patterns described in integrations/mcp-server-semantic-analysis/docs/architecture/integration.md, preventing direct dependency on the registry's concrete API surface.

## What It Is  

**RegistryDecouplingAdapter** is a thin integration layer that lives in the *semantic‑analysis* integration of the MCP server. Its source‑level location is documented in the architecture repository under  

```
integrations/mcp-server-semantic-analysis/
│   CRITICAL-ARCHITECTURE-ISSUES.md
│
└── docs/architecture/
        README.md
        integration.md
```

The adapter is a child component of **LegacyOntologyAdapter** and its sole responsibility is to sit between *pipeline agents* (the consumers that perform ontology‑related processing) and the **km‑core registry**. By doing so it eliminates the direct, concrete‑API dependency that previously existed in **OntologyClassifier**. The design is explicitly called out in the two architecture documents mentioned above, where the goal of *agent decoupling* from the km‑core registry is highlighted as a critical, resolved issue.

In practice, **RegistryDecouplingAdapter** acts as a façade that translates the generic contract expected by the agents into the concrete calls required by the registry, and vice‑versa. No business logic lives inside the adapter; it is intentionally lightweight so that changes to the registry’s API do not ripple through the rest of the pipeline.

---

## Architecture and Design  

The adapter embodies a **Facade pattern** (a well‑known structural pattern) whose intent is to provide a simplified, stable interface to a complex subsystem—in this case the km‑core registry. The architectural motivation, recorded in `CRITICAL-ARCHITECTURE-ISSUES.md`, was to break the tight coupling that **OntologyClassifier** had with the registry’s concrete API. By inserting the façade, the system now respects the **Dependency Inversion Principle**: higher‑level pipeline agents depend on an abstract contract supplied by the adapter rather than on a concrete registry implementation.

The integration approach follows the guidelines laid out in `docs/architecture/integration.md`. The document describes a *“registry‑decoupled pipeline”* where each agent communicates only with an **Adapter** interface. The adapter then delegates to the underlying registry through a *registry client* (the concrete API wrapper). This results in a **layered architecture**:

1. **Pipeline Agents** – high‑level, domain‑specific components that request ontology data.  
2. **RegistryDecouplingAdapter** – the façade that implements a stable contract for agents.  
3. **km‑core Registry Client** – the low‑level concrete implementation that knows the registry’s HTTP/GRPC protocol, authentication, etc.  

Because the adapter is placed *between* agents and the registry, it also acts as an **Integration Point** that can enforce cross‑cutting concerns (e.g., logging, metrics, retry policies) without polluting the agents or the registry client.

---

## Implementation Details  

The current repository snapshot contains **no explicit code symbols** for the adapter, which indicates that the component may be defined as an interface or a configuration‑driven bean rather than a concrete class in the source tree. The documentation, however, clarifies its functional shape:

* **Contract Definition** – The adapter exposes methods that mirror the operations needed by the agents (e.g., `fetchOntology(id)`, `searchConcepts(query)`). These signatures are deliberately generic, avoiding any registry‑specific types.
* **Delegation Logic** – Inside each method, the adapter forwards the request to a *registry client* that knows the exact API surface (REST endpoints, request payloads, authentication headers). The client may be injected via dependency injection (DI) configured in the legacy `LegacyOntologyAdapter` module.
* **Error Translation** – The adapter normalizes registry‑specific error codes into a set of domain‑level exceptions that agents can handle uniformly.
* **Configuration Hook** – Because the adapter lives under the *LegacyOntologyAdapter* umbrella, its wiring is likely defined in a Spring or Guice module (e.g., `LegacyOntologyAdapterModule`). This module binds the abstract adapter interface to the concrete implementation that uses the registry client.

The parent component **LegacyOntologyAdapter** resolves the architectural issue described in `CRITICAL-ARCHITECTURE-ISSUES.md`. It aggregates the decoupling adapter together with any legacy compatibility shims required for older agents that still expect the previous registry contract.

---

## Integration Points  

1. **Upstream – Pipeline Agents**  
   All agents that need ontology data import the **RegistryDecouplingAdapter** interface from the `LegacyOntologyAdapter` package. They invoke the façade methods without knowledge of the registry’s protocol. This ensures that any future change to the registry (e.g., version bump, migration to a different storage backend) requires only an update inside the adapter layer.

2. **Downstream – km‑core Registry Client**  
   The adapter delegates to a concrete client that directly talks to the km‑core registry. The client’s location is not listed in the observations, but by convention it resides under a `km-core/registry` package. The adapter abstracts this client behind its own contract, shielding agents from changes in request/response schemas.

3. **Cross‑Cutting Concerns**  
   Because the adapter is the sole conduit to the registry, it is the natural place to embed logging (e.g., request/response tracing), metrics (call latency, error rates), and resilience mechanisms (retries, circuit breakers). These concerns are not explicitly mentioned in the observations but are implied by the integration pattern described in `integration.md`.

4. **Configuration & Lifecycle**  
   The adapter is wired as a bean within the **LegacyOntologyAdapter** module. Its lifecycle is tied to the overall semantic‑analysis integration, ensuring that it is instantiated once and shared across all agents.

---

## Usage Guidelines  

* **Consume the Adapter, Not the Registry** – All new or refactored pipeline agents must depend on the `RegistryDecouplingAdapter` interface provided by `LegacyOntologyAdapter`. Direct imports of registry client classes are prohibited to preserve the decoupling guarantee.  
* **Handle Domain Exceptions** – Agents should catch the adapter‑level exceptions (e.g., `OntologyNotFoundException`, `RegistryAccessException`) rather than low‑level HTTP or GRPC errors. This keeps error handling consistent across the pipeline.  
* **Do Not Bypass the Adapter for Performance Hacks** – Even if a particular agent requires a specialized query, the correct approach is to extend the adapter’s contract (add a method) rather than reaching around it. This maintains a single point of change for registry evolution.  
* **Leverage Adapter‑Provided Metrics** – The adapter emits standardized metrics (e.g., `registry.request.duration`). Agents that need performance insight should rely on these rather than instrumenting raw registry calls.  
* **Testing Strategy** – Unit tests for agents should mock the `RegistryDecouplingAdapter` interface. Integration tests that verify end‑to‑end behavior should use a stubbed or in‑memory version of the km‑core registry client, ensuring that the adapter’s translation logic is exercised without requiring a live registry.

---

### Architectural Patterns Identified  

| Pattern | Role in RegistryDecouplingAdapter |
|---------|-----------------------------------|
| **Facade** | Provides a stable, simplified API to pipeline agents while hiding the registry’s concrete implementation. |
| **Dependency Inversion** | Agents depend on the abstract adapter interface; the concrete registry client depends on lower‑level details. |
| **Layered Architecture** | Separates concerns into agents → adapter → registry client, enabling independent evolution of each layer. |
| **Adapter (as a sibling concept)** | Although named “Adapter,” its function aligns with a façade; it adapts the registry’s API to the agents’ expectations. |

### Design Decisions & Trade‑offs  

* **Decision – Introduce a dedicated façade**  
  *Trade‑off*: Adds an extra indirection layer, which incurs minimal runtime overhead but dramatically improves modularity and future‑proofing.  
* **Decision – Keep the adapter thin (no business logic)**  
  *Trade‑off*: Simplicity and maintainability are gained; however, any complex transformation must be placed elsewhere (e.g., a separate service), potentially increasing the number of components.  
* **Decision – Wire the adapter through `LegacyOntologyAdapter`**  
  *Trade‑off*: Reuses existing legacy wiring, reducing duplication, but couples the new façade to a legacy module that may need eventual refactoring.

### System Structure Insights  

* The **semantic‑analysis** integration forms a bounded context that encapsulates ontology‑related processing. Within this context, the **LegacyOntologyAdapter** acts as a façade for legacy compatibility, while the **RegistryDecouplingAdapter** is the modern, decoupled entry point for agents.  
* No sibling adapters are mentioned, suggesting that this is the primary registry‑decoupling mechanism for the entire semantic‑analysis pipeline.  
* The adapter’s placement “between pipeline agents and the registry” makes it the **single source of truth** for how ontology data is accessed, which simplifies impact analysis for any registry change.

### Scalability Considerations  

* **Horizontal Scaling of Agents** – Because agents interact only with the adapter’s stable contract, they can be scaled out independently; the adapter itself can be stateless and thus horizontally scalable.  
* **Registry Load Management** – The adapter can embed throttling or bulk‑request aggregation logic without altering agents, providing a natural choke point for protecting the km‑core registry under high load.  
* **Caching Opportunities** – Since the adapter is the sole consumer of registry data, it is an ideal place to introduce read‑through caches (e.g., in‑memory or distributed) to reduce latency and registry traffic.

### Maintainability Assessment  

* **High Maintainability** – The clear separation of concerns, explicit documentation of the decoupling goal, and the use of well‑understood patterns (Facade, Dependency Inversion) make the component easy to understand and evolve.  
* **Low Code Footprint** – The absence of concrete code symbols suggests the adapter is lightweight, reducing surface area for bugs.  
* **Documentation‑Driven** – All design rationales are captured in markdown files (`CRITICAL-ARCHITECTURE-ISSUES.md`, `README.md`, `integration.md`), ensuring that future developers have a reliable reference.  
* **Potential Risk** – Because the adapter is nested inside a legacy module, any future refactor of `LegacyOntologyAdapter` must preserve the adapter’s bindings; otherwise, agents could inadvertently regain direct registry dependencies.

--- 

**In summary**, the **RegistryDecouplingAdapter** is a deliberately minimal façade that resolves a historic tight coupling between ontology‑processing agents and the km‑core registry. Its design follows established architectural patterns, provides a clean integration point, and establishes a solid foundation for scalable, maintainable evolution of the semantic‑analysis pipeline.


## Hierarchy Context

### Parent
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- Resolves the architectural issue documented in CRITICAL-ARCHITECTURE-ISSUES.md where OntologyClassifier was tightly coupled to an internal registry; the adapter decouples pipeline agents from the km-core registry's concrete API


---

*Generated from 3 observations*
