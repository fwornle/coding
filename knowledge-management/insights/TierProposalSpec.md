# TierProposalSpec

**Type:** Detail

`integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` (titled 'Tiered Model Selection Proposal') is the authoritative source for why specific tiers exist and what capability or cost tradeoff each tier is intended to represent, providing the design intent behind the tier identifiers used in `docs/puml/llm-tier-routing.puml`.

## What It Is  

**TierProposalSpec** is the formal *semantic contract* that describes the meaning of each LLM‑tier identifier used throughout the routing layer of the MCP server. The specification lives alongside the routing implementation inside the **TierRouter** component (see the `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` file for the full text).  

The spec predates the concrete routing diagram (`docs/puml/llm-tier-routing.puml`) and therefore defines *why* a tier exists—what capability, performance, or cost characteristic it represents—while the diagram shows *how* those tiers are mapped to concrete model providers. Because the spec is deliberately independent of any implementation detail, it is the single source of truth that all tier‑assignment logic, including entries in **TierModelMap**, must be validated against whenever a new model or provider is added.

> **Location** – the authoritative description is in  
> `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`  
> The mechanical mapping that consumes the spec is visualised in  
> `docs/puml/llm-tier-routing.puml`  

---

## Architecture and Design  

The architecture follows a **spec‑driven routing** pattern. The high‑level flow is:

1. **TierProposalSpec** (semantic contract) → defines tier identifiers and their intended trade‑offs.  
2. **TierRouter** reads the spec and, based on request characteristics, assigns a request to a tier.  
3. **TierModelMap** (sibling artifact) holds the concrete *tier‑to‑model* mapping that the router consults next.  
4. The selected model is then handed off to the broader **provider architecture** (`docs/puml/llm-provider-architecture.puml`).  

This separation isolates *business intent* (what a tier means) from *operational mechanics* (which model fulfills the tier). The diagram in `llm-tier-routing.puml` illustrates the mechanical mapping:

![Tier Routing Diagram](docs/puml/llm-tier-routing.puml)

The design deliberately places the **TierProposalSpec** inside **TierRouter**, making the router the sole consumer of the spec. Sibling **TierModelMap** does not embed the semantic definitions; instead it references tier identifiers defined by the spec. This clear boundary reduces coupling: changes to tier semantics require only updates to the spec and the routing logic, while the model map can be updated independently to reflect new providers or cost changes.

---

## Implementation Details  

Although no concrete code symbols were discovered, the documentation makes the following implementation expectations clear:

* **TierRouter** contains a field or property named `TierProposalSpec`. The router uses this object to look up the semantic description of a tier before performing any routing decision.  
* The router’s decision‑making algorithm must consult the spec to verify that a request’s required capability (e.g., latency, token limit, cost ceiling) aligns with the tier’s contract. Only after this validation does the router query **TierModelMap** for the concrete model(s) that satisfy the tier.  
* **TierModelMap** is a distinct artifact that stores a mapping such as `tier‑id → [model‑id, provider‑id]`. Because the map is diagrammed in `llm-tier-routing.puml`, its structure is expected to be a simple lookup table, not an embedded configuration inside the router.  
* The **Tiered Model Selection Proposal** (`TIERED-MODEL-PROPOSAL.md`) enumerates each tier (e.g., `fast`, `balanced`, `expensive`) and documents the intended capability/cost trade‑off. This file is the source for any enum or constant definitions that the router might expose to callers.

In practice, adding a new tier would involve:

1. Extending the **TierProposalSpec** document with a new entry that explains the tier’s semantics.  
2. Updating the router’s tier‑selection logic to recognise the new identifier and apply the appropriate capability checks.  
3. Adding a corresponding entry in **TierModelMap** to bind the new tier to one or more concrete models.

---

## Integration Points  

* **Parent – TierRouter**: The router is the entry point for any request that needs LLM service. It reads **TierProposalSpec** to understand the contract it must satisfy, then delegates to **TierModelMap** for concrete model resolution.  
* **Sibling – TierModelMap**: This map is the only artifact that directly consumes tier identifiers produced by the router. It does not contain semantic definitions; it merely provides the mechanical link to providers.  
* **Provider Architecture** (`docs/puml/llm-provider-architecture.puml`): Once a model is selected via **TierModelMap**, the request flows into the provider layer, which handles authentication, request formatting, and response handling for the chosen LLM vendor.  
* **External Callers**: Any component that wishes to request an LLM must be aware of the tier identifiers and their semantics as defined in the **Tiered Model Selection Proposal**. The spec therefore acts as a contract between callers and the routing subsystem.

The only explicit dependency shown is the *ordering* of operations: tier assignment (driven by the spec) happens **before** provider selection, ensuring that all downstream components can assume the tier’s capability guarantees.

---

## Usage Guidelines  

1. **Read the Spec First** – Before writing any code that references a tier, consult `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. The document explains the intended capability/cost trade‑off; using a tier without this context can lead to mismatched expectations.  

2. **Never Hard‑Code Tier Semantics** – The router must obtain tier meanings from `TierProposalSpec`. If you need to adjust a tier’s behavior, modify the spec and the router’s validation logic, not the static mapping in **TierModelMap**.  

3. **Update Both Spec and Map When Adding Models** – Introducing a new LLM provider requires two coordinated actions: (a) add a concrete model entry to **TierModelMap**; (b) verify that the tier(s) it populates are still accurately described in the spec.  

4. **Maintain Diagram Synchrony** – After any change to tier definitions or mappings, regenerate or edit `docs/puml/llm-tier-routing.puml` so that the visual representation stays consistent with the textual spec. This diagram is the go‑to reference for reviewers and future contributors.  

5. **Validate Against the Spec in Tests** – Unit or integration tests for the router should assert that a request assigned to a tier respects the semantic constraints listed in the proposal (e.g., latency ceiling, token budget). This guards against drift between the spec and the implementation.  

---

### Summary of Architectural Insights  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Pattern** | Spec‑driven routing: semantic contract (`TierProposalSpec`) → tier assignment → mechanical mapping (`TierModelMap`). |
| **Design Decision** | Separate *what* a tier means from *how* it is realized, enabling independent evolution of semantics and provider choices. |
| **System Structure** | `TierRouter` (parent) contains `TierProposalSpec`; sibling `TierModelMap` holds tier‑to‑model lookup; both feed into the provider architecture. |
| **Scalability** | Adding new tiers or providers requires only updates to the spec and the map, not wholesale redesign—supports linear growth. |
| **Maintainability** | Centralized documentation (spec + diagram) acts as the single source of truth; clear boundaries reduce coupling and simplify impact analysis. |

By treating **TierProposalSpec** as the definitive semantic contract and keeping the routing diagram as the authoritative mechanical map, the MCP server achieves a clean, maintainable separation of concerns that scales gracefully as new LLM providers and cost models are introduced.


## Hierarchy Context

### Parent
- [TierRouter](./TierRouter.md) -- `docs/puml/llm-tier-routing.puml` diagrams the tier-to-model mapping, indicating that tier assignment happens before provider selection and feeds into the broader provider architecture shown in `docs/puml/llm-provider-architecture.puml`

### Siblings
- [TierModelMap](./TierModelMap.md) -- The tier-to-model mapping is formally diagrammed in `docs/puml/llm-tier-routing.puml`, establishing it as a distinct routing artifact with its own documented structure rather than being embedded in general provider configuration.


---

*Generated from 3 observations*
