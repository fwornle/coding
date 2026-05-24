# TierModelMap

**Type:** Detail

Per the SubComponent description, tier assignment is sequenced before provider selection, meaning TierModelMap is evaluated upstream of the broader provider architecture shown in `docs/puml/llm-provider-architecture.puml` — the map output feeds into that downstream pipeline.

## What It Is  

**TierModelMap** is the concrete artifact that translates a *tier identifier* (e.g., `tier‑basic`, `tier‑premium`) into a concrete **provider‑model pair** (such as `OpenAI‑gpt‑4‑turbo`, `Anthropic‑claude‑v2`). The mapping lives in the **LLM tier‑routing** diagram located at  

```
docs/puml/llm-tier-routing.puml
```  

and is referenced by the **TierRouter** component (the parent of TierModelMap). The map is **not** scattered across generic provider configuration; instead it is a dedicated routing table that sits upstream of the broader provider selection logic shown in  

```
docs/puml/llm-provider-architecture.puml
```  

The design intent behind each tier – what capability, latency, or cost envelope it represents – is documented in the sibling specification  

```
integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md
```  

Together, these artifacts define a clear separation: callers request a tier, TierModelMap resolves it to a concrete model, and the resolved model is then handed to the downstream provider pipeline.

> **Diagram – Tier‑to‑Model Mapping**  
> ![llm‑tier‑routing](docs/puml/llm-tier-routing.puml)  

---

## Architecture and Design  

The architecture treats **tier routing** as a *first‑class concern* that precedes provider selection. This ordering is explicit in the tier‑routing diagram: the **TierRouter** evaluates the tier, looks up the corresponding entry in **TierModelMap**, and emits a *provider‑model tuple* that is subsequently consumed by the provider subsystem (see the provider‑architecture diagram).  

### Design Patterns Evident  

| Pattern | Evidence |
|---------|----------|
| **Routing Table / Map** | TierModelMap is a static (or configurable) map that directly associates tier keys with provider/model values. |
| **Separation of Concerns** | Tier semantics are isolated from provider implementation; callers need only know the tier, not the underlying model. |
| **Pipeline / Staged Processing** | Tier resolution is the first stage, provider selection and request execution are later stages, as shown by the upstream/downstream relationship in the diagrams. |
| **Specification‑Driven Design** | The sibling `TierProposalSpec` document defines *why* each tier exists, guiding the construction of the map. |

The **TierRouter** composes TierModelMap, meaning the router’s responsibility is limited to *lookup* and *validation* rather than embedding provider logic. This compositional relationship keeps the routing artifact reusable: any component that needs tier‑based model resolution can instantiate the same map without duplicating provider knowledge.

---

## Implementation Details  

Although no source files contain executable symbols for TierModelMap, the **formal definition** resides in the PlantUML diagram `docs/puml/llm-tier-routing.puml`. The diagram enumerates rows such as:

```
tier‑basic   ->  OpenAI‑gpt‑3.5‑turbo
tier‑standard->  Anthropic‑claude‑v1
tier‑premium ->  OpenAI‑gpt‑4‑turbo
```

These rows represent the **key‑value pairs** that the runtime implementation (likely a configuration loader or a static dictionary) will consume. The map is **owned** by the **TierRouter** component, implying that the router contains a reference or injection point like:

```pseudo
class TierRouter {
    TierModelMap tierModelMap;
    // ... routing logic
}
```

The **execution flow** is:

1. **Tier Assignment** – An upstream component (e.g., a request handler) determines the appropriate tier based on business rules, user subscription, or cost constraints.  
2. **TierModelMap Lookup** – TierRouter receives the tier identifier and <USER_ID_REDACTED> TierModelMap for the corresponding provider/model pair.  
3. **Downstream Provider Dispatch** – The resolved pair is handed to the provider subsystem (as illustrated in `llm-provider-architecture.puml`), which then constructs the actual LLM request.

Because the map is defined **outside** the generic provider configuration, changes to tier‑to‑model relationships (e.g., swapping a model for a cheaper alternative) can be made by editing the diagram or its generated configuration artifact without touching provider code. This design also enables **environment‑specific overrides** (e.g., staging vs. production) by providing alternative map definitions that the router can load at startup.

---

## Integration Points  

1. **Parent – TierRouter**  
   - TierRouter is the only direct consumer of TierModelMap. It orchestrates the lookup and validates that the returned provider/model pair conforms to expected interfaces (e.g., implements the `LLMProvider` contract).  

2. **Sibling – TierProposalSpec**  
   - The specification document (`TIERED-MODEL-PROPOSAL.md`) supplies the *semantic rationale* for each tier. Developers updating TierModelMap should consult this spec to ensure that any new mapping aligns with the intended capability/cost trade‑offs.  

3. **Downstream – Provider Architecture**  
   - The output of TierModelMap feeds the provider pipeline described in `docs/puml/llm-provider-architecture.puml`. This includes components such as `ProviderFactory`, `ModelClient`, and any request‑handling middleware that expects a concrete provider/model identifier.  

4. **Configuration / Build System**  
   - Since the map is captured in a PlantUML diagram, a build step likely converts the diagram into a machine‑readable artifact (JSON, YAML, or a language‑specific map). The integration point is the **configuration loader** that reads this artifact at application start‑up and injects it into TierRouter.  

5. **Testing Harnesses**  
   - Unit tests for TierRouter can mock TierModelMap by providing a minimal map (e.g., `{ "tier‑test": "MockProvider‑mock‑model" }`) to verify routing logic without invoking real LLM providers.

---

## Usage Guidelines  

1. **Never hard‑code provider/model strings in business logic.** Always request a tier and rely on TierRouter/TierModelMap to perform the resolution. This preserves the decoupling that the architecture intends.  

2. **Update the map through the diagram or its generated config, not by editing code.** When a new model becomes available or a cost target changes, modify `llm-tier-routing.puml` (or the derived config) and run the generation step.  

3. **Validate against TierProposalSpec.** Before adding or removing a tier entry, confirm that the change aligns with the capability and cost rationale documented in `TIERED-MODEL-PROPOSAL.md`. This prevents drift between design intent and implementation.  

4. **Prefer immutable map instances.** Since TierModelMap is effectively a read‑only routing table, instantiate it once at start‑up and share the instance across all TierRouter usages. This avoids accidental mutation and improves thread‑safety.  

5. **Leverage environment overrides for testing.** Create a test‑specific version of the map (e.g., `llm-tier-routing-test.puml`) that points to mock providers. Load this version only in test environments to keep production routing untouched.  

6. **Document any custom tier additions.** When a new tier is introduced, extend both the diagram and the proposal spec so future developers understand the purpose and the chosen model.  

---

### Architectural Patterns Identified  

* Routing Table (TierModelMap)  
* Separation of Concerns (tier semantics vs. provider implementation)  
* Staged Pipeline (tier resolution → provider selection → request execution)  
* Specification‑Driven Design (TierProposalSpec informs mapping)  

### Design Decisions & Trade‑offs  

* **Explicit upstream routing** ensures that tier decisions are made early, simplifying downstream provider logic but requiring a reliable map source.  
* **Decoupling callers from providers** improves flexibility (models can be swapped without code changes) at the cost of an extra indirection layer.  
* **Diagram‑driven configuration** makes the mapping human‑readable and versionable, though it introduces a build‑time conversion step.  

### System Structure Insights  

* TierModelMap sits at the *boundary* between the **TierRouter** (decision layer) and the **Provider Architecture** (execution layer).  
* Sibling **TierProposalSpec** provides the *why* behind the *what* expressed in the map, forming a design‑documentation loop.  

### Scalability Considerations  

* Adding new tiers or providers is a matter of extending the map; the router’s lookup cost remains O(1) (hash‑map or dictionary).  
* The architecture can scale horizontally because the map is immutable and can be shared read‑only across instances.  

### Maintainability Assessment  

* High maintainability: the mapping is centralized, version‑controlled, and documented both visually (PlantUML) and textually (proposal spec).  
* Low risk of regression: changes to provider details do not ripple into business logic; only the map and its spec need updating.  
* The only maintenance overhead is the generation step that converts the diagram to runtime configuration, which should be automated as part of the CI pipeline.


## Hierarchy Context

### Parent
- [TierRouter](./TierRouter.md) -- `docs/puml/llm-tier-routing.puml` diagrams the tier-to-model mapping, indicating that tier assignment happens before provider selection and feeds into the broader provider architecture shown in `docs/puml/llm-provider-architecture.puml`

### Siblings
- [TierProposalSpec](./TierProposalSpec.md) -- `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` (titled 'Tiered Model Selection Proposal') is the authoritative source for why specific tiers exist and what capability or cost tradeoff each tier is intended to represent, providing the design intent behind the tier identifiers used in `docs/puml/llm-tier-routing.puml`.


---

*Generated from 3 observations*
