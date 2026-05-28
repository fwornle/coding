# OntologyRegistry

**Type:** SubComponent

The adapter is the sole consumer-facing entry point for ontology loading, meaning both ContentValidationAgent and OntologyClassificationAgent load class hierarchies through this facade rather than directly from km-core

## What It Is

OntologyRegistry is a SubComponent within the SemanticAnalysis pipeline responsible for owning and serving canonical class hierarchy data used during ontology classification. It lives inside the `km-core` layer and serves as the authoritative source of entity type hierarchies consumed by the broader semantic pipeline. Its consumer-facing surface is not exposed directly; instead, access is mediated entirely through its child component, StranglerFacadeAdapter — implemented as `LegacyOntologyAdapter` — which wraps the registry's interface behind a compatibility facade. No specific source file paths were surfaced in the code structure scan, but the observations consistently point to `km-core` as the module boundary within which OntologyRegistry is defined.

## Architecture and Design

The dominant architectural pattern here is the **strangler facade**, applied to isolate legacy consumer agents from the evolving `km-core` API. OntologyRegistry sits at the center of this arrangement as the canonical owner of class hierarchy data, while `LegacyOntologyAdapter` (StranglerFacadeAdapter) interposes between it and any upstream callers.

![OntologyRegistry — Architecture](images/ontology-registry-architecture.png)

The design makes a deliberate trade-off: backward compatibility is treated as a hard constraint, not a convenience. `ContentValidationAgent` and `OntologyClassificationAgent` — both of which extend `BaseAgent<TInput,TOutput>` as defined in `src/agents/base-agent.ts` — load class hierarchies exclusively through the facade rather than through OntologyRegistry directly. This means the registry's internal representation and API can evolve freely as `km-core` matures, provided the adapter correctly translates between old and new schemas. The cost is an additional indirection layer and the ongoing maintenance burden of keeping the schema translation logic in `LegacyOntologyAdapter` current as both sides evolve.

OntologyRegistry is a sibling to KmCoreAdapter (canonically implemented in `storage/km-core-adapter.ts`), and together these two components constitute the full strangler-facade migration layer. Where KmCoreAdapter centralizes all entity *write* paths previously scattered across `GraphDatabaseAdapter` and `PersistenceAgent`, OntologyRegistry centralizes all class hierarchy *read* paths. The symmetry is intentional: both components represent `km-core`'s ownership of a distinct concern, and both are shielded from legacy callers by their respective adapter facades.

![OntologyRegistry — Relationship](images/ontology-registry-relationship.png)

## Implementation Details

The registry itself owns the canonical representation of class hierarchy data in `km-core`'s native schema. `LegacyOntologyAdapter` — the sole StranglerFacadeAdapter child of this component — is responsible for any schema translation required when the legacy format expected by `ContentValidationAgent` and `OntologyClassificationAgent` diverges from `km-core`'s representation. This translation is a one-way concern: the adapter converts outbound data from registry format to legacy format; there is no implication that legacy data is written back through this path.

The facade preserves old method signatures and call conventions exactly as the consuming agents expect them. Because `OntologyClassificationAgent` and `ContentValidationAgent` implement their domain-specific logic inside the `process()` step of `BaseAgent`'s template-method `execute()` sequence, they depend on class hierarchy data being available synchronously and in a predictable shape at process time. Any interface drift in the adapter would propagate directly into failures at the `process()` step, making the compatibility contract both critical and brittle.

No code symbols were surfaced in the structure scan, so the precise method names, class constructors, and internal data structures of OntologyRegistry itself remain opaque from this analysis. The observations confirm its existence within `km-core` and its role as the canonical data owner, but the implementation mechanics below the `LegacyOntologyAdapter` boundary are not directly documented here.

## Integration Points

OntologyRegistry integrates upward into the SemanticAnalysis pipeline through a strict single-entry-point rule: `LegacyOntologyAdapter` is the **sole consumer-facing entry point** for ontology loading. This is not a convention but an enforced structural constraint — both `ContentValidationAgent` and `OntologyClassificationAgent` are prohibited (by design, if not by technical enforcement) from reaching into `km-core` OntologyRegistry directly.

The downstream dependency chain is meaningful: `OntologyClassificationAgent` produces `AgentResponse` envelopes with populated `entityType` and `ontologyClass` fields, which the Insights component then consumes for insight generation. This means errors or inconsistencies in class hierarchy data served by OntologyRegistry propagate forward through classification and into the insight layer. The registry's data <USER_ID_REDACTED> is therefore a root dependency for at least two downstream pipeline stages.

The relationship to KmCoreAdapter as a sibling reinforces that `km-core` is being incrementally promoted as the single source of truth for both entity persistence and ontology classification support. OntologyRegistry's integration role is to make that promotion transparent to legacy consumers.

## Usage Guidelines

Developers working with the SemanticAnalysis pipeline should never instantiate or call into `km-core` OntologyRegistry directly from agent code. All class hierarchy lookups must go through `LegacyOntologyAdapter`. This rule exists not as bureaucratic overhead but as the mechanism that makes zero-downtime migration of the `km-core` API possible — circumventing the adapter breaks the migration invariant for the entire strangler-facade layer.

When modifying the `km-core` OntologyRegistry's internal schema or API, the corresponding schema translation logic inside `LegacyOntologyAdapter` must be updated atomically. Because the adapter is the only place where format conversion occurs, any gap between a registry change and an adapter update will manifest as malformed class hierarchy data reaching `OntologyClassificationAgent`'s `process()` step — a failure that will surface as a classification error rather than an obvious schema mismatch.

Additions to the set of agents that require ontology class data should route through `LegacyOntologyAdapter` following the same pattern established by `ContentValidationAgent` and `OntologyClassificationAgent`. If a new agent is introduced that requires `km-core`'s native schema directly (rather than the legacy format), the appropriate path is to extend the adapter's interface or introduce a parallel facade rather than bypassing the layer entirely. The sibling pattern established by KmCoreAdapter provides a reference model for how `km-core` concerns can be exposed cleanly without breaking the migration layer.

---

### Architectural Patterns Identified
- **Strangler Facade**: `LegacyOntologyAdapter` wraps OntologyRegistry to allow API evolution without breaking existing consumers.
- **Single Entry Point**: All class hierarchy access is funneled through one adapter, reducing surface area for compatibility failures.
- **Separation of Ownership**: OntologyRegistry owns data; the adapter owns translation — these concerns are deliberately isolated.

### Design Decisions and Trade-offs
| Decision | Rationale | Trade-off |
|---|---|---|
| Sole consumer access via adapter | Preserves backward compatibility during `km-core` migration | Extra indirection; translation logic can drift |
| Registry owns canonical schema | Single source of truth for class hierarchies | Consumers cannot optimize by accessing raw data |
| Sibling adapter pair (OntologyRegistry + KmCoreAdapter) | Symmetric migration layer for reads and writes | Both adapters must be maintained in parallel |

### Scalability Considerations
The observations do not surface caching, lazy-loading, or concurrency strategies within OntologyRegistry. Given that class hierarchies are read-heavy and relatively stable, a caching layer inside `LegacyOntologyAdapter` would be a natural extension point — but nothing in the current design mandates or precludes it.

### Maintainability Assessment
The strangler-facade pattern makes OntologyRegistry's internals independently maintainable, which is its primary strength. The main maintainability risk is schema translation drift: as `km-core` evolves, the translation layer in `LegacyOntologyAdapter` becomes increasingly complex. The absence of direct code symbol data limits the ability to assess test coverage or translation complexity at this time.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis pipeline is structured around a coordinator pattern where specialized agents each extend BaseAgent<TInput,TOutput> defined in src/agents/base-agent.ts. This base class implements a strict template-method execute() that sequences six steps in order: process(), calculateConfidence(), detectIssues(), generateRouting(), applyCorrections(), and buildMetadata(). Every agent—CodeGraphAgent, SemanticAnalysisAgent, OntologyClassificationAgent, ContentValidationAgent—inherits this contract and returns a uniform AgentResponse envelope. This design means a new developer adding an agent only needs to implement the domain-specific process() logic; confidence scoring, issue detection, and metadata construction are guaranteed to run in a consistent order regardless of which agent is invoked. The tradeoff is that the template method imposes overhead steps even when an agent's output is trivially simple, and agents cannot short-circuit the sequence without throwing exceptions.

### Children
- [StranglerFacadeAdapter](./StranglerFacadeAdapter.md) -- Based on the parent context, LegacyOntologyAdapter exposes the legacy ontology-loading interface as a facade, meaning it preserves the old method signatures and call conventions expected by existing consumers.

### Siblings
- [Pipeline](./Pipeline.md) -- BaseAgent<TInput,TOutput> in src/agents/base-agent.ts enforces a six-step template-method execute() sequence (process, calculateConfidence, detectIssues, generateRouting, applyCorrections, buildMetadata) that all pipeline agents must follow without short-circuiting
- [Ontology](./Ontology.md) -- OntologyClassificationAgent extends BaseAgent and implements domain-specific process() logic for entity type resolution while relying on the base class for confidence scoring and metadata construction
- [Insights](./Insights.md) -- Insight generation runs after ontology classification, consuming AgentResponse envelopes with populated entityType and ontologyClass fields produced by OntologyClassificationAgent
- [KmCoreAdapter](./KmCoreAdapter.md) -- storage/km-core-adapter.ts is the canonical file for this component, centralizing all entity write paths that were previously split across GraphDatabaseAdapter and PersistenceAgent


---

*Generated from 5 observations*
