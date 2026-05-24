# Ontology

**Type:** SubComponent

The ontology system is described in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md as a core agent architecture concern, indicating ontology contracts are baked into agent interfaces rather than being runtime-configurable

# Ontology — Deep Insight Document

## What It Is

The Ontology sub-component is the classification taxonomy layer of the broader SemanticAnalysis system, providing the structured vocabulary that downstream agents use to tag and reason about extracted entities. While the ontology system itself spans configuration and classification logic, its architectural contract is documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` as a first-class agent architecture concern, with companion tool integration described in `integrations/mcp-server-semantic-analysis/docs/architecture/tools.md`. The fact that ontology is treated as an architecture-level concern — rather than a runtime-configurable plugin — indicates that ontology contracts are baked directly into agent interfaces.

At its structural core, Ontology implements a two-tier classification hierarchy: an upper ontology that defines broad abstract categories, and a lower ontology that supplies concrete entity types. This dual-layer arrangement is materialized in the child component TwoTierClassificationHierarchy, which encodes the contract that OntologyClassificationAgent depends on for every entity-tagging decision it makes.

![Ontology — Architecture](images/ontology-architecture.png)

The component sits between the parent SemanticAnalysis container and the more granular TwoTierClassificationHierarchy child, while sharing the same level with Pipeline, Insights, and OntologySubsystem. Where OntologySubsystem (a sibling) owns configuration loading via `OntologyConfigManager` under `src/ontology/`, the Ontology component itself owns the *semantic model* — the shape and meaning of the classification hierarchy that those configurations populate.

## Architecture and Design

The architectural approach is a **layered classification model** built around sequential refinement. Entity type resolution consults the upper ontology first and then the lower ontology, with the lower ontology acting as a refinement pass over upper-level assignments. This is a deliberate design decision: abstract categorization happens before concrete type assignment, ensuring that an entity is always anchored to a high-level conceptual bucket even if the more specific resolution step fails or yields ambiguous results.

Classification and validation are intentionally separated into distinct pipeline phases. Validation rules are enforced as a discrete step from classification, which means an entity can be successfully classified but still flagged as invalid before pipeline continuation. This separation of concerns mirrors a broader pattern visible in the parent SemanticAnalysis system, where the `BaseAgent<TInput, TOutput>` contract (defined in `src/agents/base-agent.ts`) splits responsibilities across the five lifecycle slots (`process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`, `applyCorrections()`). The ontology architecture exhibits the same philosophy: each concern (classification, validation, refinement) is its own step with explicit inputs and outputs.

A third notable design choice is batch-oriented processing. `OntologyClassificationAgent` is parameterized as `BaseAgent<OntologyClassificationBatch, TOutput>`, meaning it consumes pre-batched entity collections rather than individual items. This batch contract is encoded into the generic input parameter of the base class, making batching a static type-level guarantee rather than a runtime convention. This is a trade-off favoring throughput and consistency over per-item interactivity — the agent cannot be invoked on a single entity without first wrapping it in a batch envelope.

## Implementation Details

The primary consumer of the ontology model is `OntologyClassificationAgent`, which extends the system's `BaseAgent` abstract class with `OntologyClassificationBatch` as its input type. By extending `BaseAgent`, this agent inherits the full five-method execution contract — `process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`, and `applyCorrections()` — which it must implement in service of classification logic. The agent's `process()` step is where the two-tier resolution happens: it walks the upper ontology to assign a broad category, then walks the lower ontology to refine that assignment into a concrete entity type.

The validation step lives outside the classification logic proper. Because validation is a discrete phase, it likely manifests through `detectIssues()` on the agent (flagging classified-but-invalid entities) rather than through hard failures in `process()`. This design lets the pipeline continue capturing classification results even when validity is questionable, and downstream consumers can decide whether to act on flagged entities.

![Ontology — Relationship](images/ontology-relationship.png)

Ontology contracts are not runtime-configurable. The observation that ontology is documented as a "core agent architecture concern" indicates that the type system, generic parameters, and method signatures of the agents themselves encode ontology assumptions. Changing the ontology shape (for instance, introducing a third tier) would require modifying agent contracts, not merely updating a configuration file. Configuration *content* — the actual category and type definitions — is managed by the sibling `OntologyConfigManager` under `src/ontology/`, providing a single managed entry point for entity hierarchy changes rather than scattering them across agents.

## Integration Points

Ontology integrates with the wider system at three principal seams. First, it is the contract on which `OntologyClassificationAgent` depends, making it directly consumed by the pipeline orchestration described in the sibling Pipeline component (which sequences agents according to `batch-analysis.yaml` with explicit `depends_on` DAG edges). The position of ontology classification within that DAG determines when ontology types become available to downstream agents.

Second, Ontology is integrated with external MCP tooling. The `tools.md` document references Tool Extensions that rely on ontology type resolution, which means external MCP tool calls flow through the same classification path used by internal agents. This is a significant integration insight: the ontology layer is not internal-only — it is the lingua franca for both pipeline-internal classification and external tool-driven type <USER_ID_REDACTED>, giving the system a single source of truth for entity typing.

Third, Ontology has a structural relationship with its child TwoTierClassificationHierarchy and a configuration-management relationship with its sibling OntologySubsystem. The child defines the structural contract (upper/lower tier shape); the sibling owns the loading and lifecycle of the configuration data that populates that shape. Insights (another sibling) operates downstream of persistence and consumes already-classified data, so ontology decisions made here propagate forward into the knowledge graph that Insights later reads.

## Usage Guidelines

Developers extending or interacting with the ontology system should treat the two-tier structure as a load-bearing contract. When adding new entity types, the addition must be expressible as a (upper-category, lower-type) pair; introducing a type that does not fit cleanly under an existing upper category implies either picking the closest fit or proposing a new upper category — and the latter has architectural ripple effects because the tier structure is encoded in agent contracts.

Because `OntologyClassificationAgent` operates on `OntologyClassificationBatch` inputs, never attempt to invoke it on a single entity. Batches are the unit of work, and the type system will reject ad-hoc single-item calls. If a single entity needs classification (for testing, debugging, or special-case invocation), wrap it in a one-element batch — but recognize that this still incurs the agent's full five-method lifecycle.

When introducing validation rules, keep them in the validation phase rather than collapsing them into classification logic. The deliberate separation between classification and validation allows the pipeline to distinguish "we couldn't classify this" from "we classified it but it failed our rules" — a distinction that downstream consumers may depend on for routing and corrections. Conflating these two will erode an architectural boundary that the broader BaseAgent pattern relies on.

Finally, route all ontology configuration changes through the sibling `OntologyConfigManager` at `src/ontology/`. Avoid embedding ontology knowledge directly into individual agents; the centralization of configuration loading is the maintainability lever that keeps entity-type evolution tractable. Scattering ontology references across agents would defeat the single managed entry point and reintroduce the coupling problem the current architecture is structured to prevent.

---

### Summary Notes

1. **Architectural patterns identified**: Two-tier layered classification with sequential refinement; separation of classification from validation; batch-oriented generic-typed agent contracts; centralized configuration management via a dedicated sibling.

2. **Design decisions and trade-offs**: Ontology contracts are baked into static type signatures (loss of runtime reconfigurability in exchange for compile-time safety); batch-only processing (throughput over per-item flexibility); validation as a distinct phase (richer pipeline signals at the cost of additional lifecycle complexity).

3. **System structure insights**: Ontology is both a semantic model (this component) and a configuration system (sibling OntologySubsystem), with a clean division between *shape* and *content*. The child TwoTierClassificationHierarchy holds the structural contract.

4. **Scalability considerations**: Batch processing is the primary throughput lever. Because classification flows through the same agent path for both internal pipeline use and external MCP tool calls, scaling the classification agent scales both consumers simultaneously.

5. **Maintainability assessment**: Strong — the centralized `OntologyConfigManager` entry point and the clear separation between classification, validation, and refinement keep evolution localized. Weakness: because ontology shape is encoded in agent generic parameters, structural changes (e.g., adding a third tier) are high-impact and require coordinated agent-contract updates rather than a configuration edit.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The `BaseAgent<TInput, TOutput>` abstract class defined in `src/agents/base-agent.ts` establishes a rigid, five-method execution contract that every agent in the pipeline must implement: `process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`, and `applyCorrections()`. This is not a loose interface — each method is called sequentially within a standardized envelope, meaning an agent cannot skip confidence calculation or issue detection even if it has nothing meaningful to report for those phases. The resulting `AgentResponse` envelope carries not just the domain output but also metadata (timestamps, model usage), routing suggestions for downstream agents, and a corrections list for self-healing. For a new developer, this means that implementing a new agent is less about writing a single processing function and more about correctly filling all five lifecycle slots; an agent that returns empty stubs for `detectIssues()` or `generateRouting()` will still compile and run, but the orchestrating pipeline likely depends on those fields being populated to make branching decisions. The generic type parameters `<TInput, TOutput>` allow the base class to be reused across wildly different domains — from raw git commit arrays (SemanticAnalysisAgent) to ontology classification batches (OntologyClassificationAgent) — without sacrificing static type safety on the input/output contracts.

### Children
- [TwoTierClassificationHierarchy](./TwoTierClassificationHierarchy.md) -- The L2 sub-component description explicitly defines the two tiers: 'upper ontology defines broad abstract categories while lower ontology definitions provide concrete entity types' — this is the core structural contract that OntologyClassificationAgent depends on for all entity tagging decisions.

### Siblings
- [Pipeline](./Pipeline.md) -- The pipeline coordinator sequences agents in a fixed order defined in batch-analysis.yaml, with each step declaring explicit depends_on edges for DAG-based execution
- [Insights](./Insights.md) -- Insight generation operates as a post-persistence concern, consuming already-written KG data rather than raw pipeline input, as described in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md
- [OntologySubsystem](./OntologySubsystem.md) -- OntologyConfigManager centralizes all ontology configuration loading under src/ontology/, meaning changes to entity type hierarchies flow through a single managed entry point rather than being scattered across agents


---

*Generated from 6 observations*
