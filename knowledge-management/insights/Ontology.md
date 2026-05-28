# Ontology

**Type:** SubComponent

The architecture document at integrations/mcp-server-semantic-analysis/docs/architecture/agents.md describes the agent's classification contract, distinguishing upper-ontology (broad categories) from lower-ontology (specific types)

## What It Is

The Ontology subcomponent lives within the SemanticAnalysis pipeline and serves as the definitional backbone for entity classification across the system. While no explicit source file paths are surfaced in the code structure, the authoritative contract for its behavior is documented at `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, which defines the classification contract distinguishing upper-ontology (broad categories) from lower-ontology (specific types). The subcomponent is realized primarily through `OntologyClassificationAgent` and its child responsibility, EntityTypeResolver, which together resolve raw entities into typed, hierarchically-placed ontology classes.

Ontology is not merely a classification utility — it is a **shared definition layer** that drives both classification logic and validation rules across the SemanticAnalysis pipeline. Its outputs propagate downstream to persistence, sibling validation agents, and the OntologyRegistry, making it a load-bearing structural element rather than an isolated concern.

---

## Architecture and Design

![Ontology — Architecture](images/ontology-architecture.png)

The Ontology subcomponent follows the same template-method pattern enforced by `BaseAgent<TInput,TOutput>` in `src/agents/base-agent.ts`, which governs all agents in the SemanticAnalysis parent pipeline. `OntologyClassificationAgent` extends `BaseAgent` and narrows its responsibility to implementing the domain-specific `process()` step — entity type resolution — while inheriting confidence scoring (`calculateConfidence()`), issue surfacing (`detectIssues()`), routing, corrections, and metadata construction from the base class. This design means the classification contract is always executed in a guaranteed six-step sequence regardless of classification complexity, a consistency guarantee that comes at the cost of being unable to short-circuit trivial resolutions.

A key architectural decision is that **ontology definitions function as executable rules**, not passive reference data. The sibling component ContentValidationAgent consumes the same ontology definitions as validation constraints, meaning a single definition file governs both what an entity *is* (classification) and whether an entity *is correct* (validation). This dual-use makes the definition files a shared dependency with high coupling: any change to an ontology class definition simultaneously affects classification behavior and validation gating.

The two-tier ontology model — upper-ontology for broad categories, lower-ontology for specific types — is a deliberate design choice documented in the agents architecture file. This hierarchy allows coarse-grained routing decisions to be made on upper-ontology classes while fine-grained downstream consumers (such as Insights generation) operate on the more precise lower-ontology types.

![Ontology — Relationship](images/ontology-relationship.png)

---

## Implementation Details

The core classification work is delegated to the EntityTypeResolver child component, which represents the primary domain logic encapsulated within this subcomponent. `OntologyClassificationAgent.process()` invokes EntityTypeResolver to map an input entity to a resolved ontology class, producing `ontologyClass` metadata fields in the `AgentResponse` envelope. These fields are the canonical output of the Ontology subcomponent and are consumed by multiple downstream consumers.

Validation behavior is wired through `detectIssues()` in `BaseAgent`. When EntityTypeResolver cannot resolve a type, or when a resolved type conflicts with validation expectations, `detectIssues()` surfaces these as **structured issues in the AgentResponse envelope** rather than thrown exceptions. This is an intentional design choice: the pipeline receives a degraded-but-valid response it can inspect and route, rather than an unhandled failure. This pattern means ontology mismatches are observable and actionable at the pipeline coordination layer without crashing the sequence.

The sibling OntologyRegistry component, through its `LegacyOntologyAdapter`, depends on the same ontology definition files to load class hierarchies. This makes the definition layer a shared dependency between runtime classification (Ontology subcomponent) and registry loading (OntologyRegistry). The `LegacyOntologyAdapter` implements a strangler-facade pattern over this layer, preserving backward compatibility with the old ontology-loading interface while internally delegating to the km-core OntologyRegistry.

---

## Integration Points

The Ontology subcomponent has four significant integration surfaces:

**ContentValidationAgent (sibling):** Consumes ontology definitions as validation rules. The ontology layer is upstream of validation — classification must produce a valid `ontologyClass` before ContentValidationAgent can assess correctness. This creates a strict ordering dependency within the pipeline.

**PersistenceAgent / KmCoreAdapter:** `PersistenceAgent.mapEntityToSharedMemory()` reads the `ontologyClass` field from the AgentResponse envelope to avoid redundant downstream classification. The KmCoreAdapter sibling centralizes all entity write paths, meaning ontology-typed entities flow through `storage/km-core-adapter.ts` on their way to persistent storage.

**OntologyRegistry (sibling):** `LegacyOntologyAdapter` within OntologyRegistry loads its class hierarchies from the same definition files that Ontology classification depends on. Changes to ontology definitions must be validated against both the classification logic and the registry loading behavior.

**Insights (sibling):** Insight generation runs *after* ontology classification and requires populated `entityType` and `ontologyClass` fields in the AgentResponse envelope. Ontology is therefore a hard prerequisite for the Insights pipeline stage — incomplete or missing classification blocks insight derivation.

---

## Usage Guidelines

**Treat ontology definition files as a contract, not configuration.** Because they are consumed by both OntologyClassificationAgent and ContentValidationAgent, and loaded by LegacyOntologyAdapter in OntologyRegistry, modifying a definition has multi-site effects. Any addition or change to a class definition should be validated against classification tests, validation rule behavior, and registry loading in concert.

**Implement only `process()` for new classification variants.** The BaseAgent template method guarantees that confidence scoring, issue detection, and metadata construction will run. A developer extending OntologyClassificationAgent or adding a new classification agent should resist duplicating these concerns inside `process()`, as that would produce inconsistent behavior relative to the pipeline contract.

**Rely on structured issues, not exceptions, for type mismatches.** The `detectIssues()` mechanism exists precisely to surface ontology mismatches as observable `AgentResponse` fields. Callers should inspect the issues array in the response envelope rather than treating ontology failures as unrecoverable errors, enabling the pipeline coordinator to make informed routing decisions.

**Respect the upper/lower ontology boundary.** The architecture document at `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` formally distinguishes upper-ontology from lower-ontology. Components that need only broad routing (e.g., pipeline branching) should consume upper-ontology class fields; components requiring precise type semantics (e.g., Insights, persistence mapping) should consume lower-ontology fields. Conflating the two tiers risks either over-constraining routing logic or under-specifying type-sensitive downstream behavior.

---

### Key Architectural Patterns and Trade-offs Summary

| Pattern | Where Applied | Trade-off |
|---|---|---|
| Template Method | BaseAgent six-step execute() | Consistency vs. inability to short-circuit |
| Dual-use definitions | Ontology files as classification + validation rules | Single source of truth vs. high coupling |
| Two-tier hierarchy | Upper / lower ontology | Routing flexibility vs. added resolution complexity |
| Strangler Facade | LegacyOntologyAdapter in OntologyRegistry | Backward compatibility vs. indirection overhead |
| Structured error surfacing | detectIssues() in AgentResponse | Observable failures vs. silent degradation risk |


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis pipeline is structured around a coordinator pattern where specialized agents each extend BaseAgent<TInput,TOutput> defined in src/agents/base-agent.ts. This base class implements a strict template-method execute() that sequences six steps in order: process(), calculateConfidence(), detectIssues(), generateRouting(), applyCorrections(), and buildMetadata(). Every agent—CodeGraphAgent, SemanticAnalysisAgent, OntologyClassificationAgent, ContentValidationAgent—inherits this contract and returns a uniform AgentResponse envelope. This design means a new developer adding an agent only needs to implement the domain-specific process() logic; confidence scoring, issue detection, and metadata construction are guaranteed to run in a consistent order regardless of which agent is invoked. The tradeoff is that the template method imposes overhead steps even when an agent's output is trivially simple, and agents cannot short-circuit the sequence without throwing exceptions.

### Children
- [EntityTypeResolver](./EntityTypeResolver.md) -- Based on parent context, OntologyClassificationAgent extends BaseAgent and implements domain-specific process() logic specifically for entity type resolution, indicating EntityTypeResolver is the core responsibility of this sub-component.

### Siblings
- [Pipeline](./Pipeline.md) -- BaseAgent<TInput,TOutput> in src/agents/base-agent.ts enforces a six-step template-method execute() sequence (process, calculateConfidence, detectIssues, generateRouting, applyCorrections, buildMetadata) that all pipeline agents must follow without short-circuiting
- [Insights](./Insights.md) -- Insight generation runs after ontology classification, consuming AgentResponse envelopes with populated entityType and ontologyClass fields produced by OntologyClassificationAgent
- [OntologyRegistry](./OntologyRegistry.md) -- LegacyOntologyAdapter implements the strangler-facade pattern, exposing the old ontology-loading interface while delegating internally to km-core OntologyRegistry
- [KmCoreAdapter](./KmCoreAdapter.md) -- storage/km-core-adapter.ts is the canonical file for this component, centralizing all entity write paths that were previously split across GraphDatabaseAdapter and PersistenceAgent


---

*Generated from 6 observations*
