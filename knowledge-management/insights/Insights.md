# Insights

**Type:** SubComponent

Knowledge report authoring produces structured documents summarizing batch analysis findings, consistent with the cross-project knowledge sharing patterns described in docs/architecture/cross-project-knowledge.md

# Insights

## What It Is

Insights is a SubComponent of SemanticAnalysis — the multi-agent MCP server hosted in `integrations/mcp-server-semantic-analysis` — responsible for LLM-driven analysis of already-classified knowledge entities. It operates as a downstream stage in the semantic analysis pipeline, receiving entities that have passed through ontology classification and producing structured analytical artifacts: pattern catalogs and knowledge reports. Its behavior is directly governed by token budget constraints managed by OntologyConfigManager, making its operational depth a configurable, budget-aware property of each batch run rather than a fixed capability.

![Insights — Architecture](images/insights-architecture.png)

## Architecture and Design

The central architectural decision in Insights is that it operates **downstream of ontology classification**, meaning every entity it processes already carries `ontologyClass` metadata. This is not incidental — it is a deliberate sequencing choice that allows insight prompts to be class-aware and targeted rather than generic. Rather than asking an LLM "what is this?", the Insights layer can ask "given that this is a `[ontologyClass]`, what structural patterns or relationships are notable?" This improves both the precision and token-efficiency of LLM calls, since the classification work has already narrowed the semantic space.

The budget-aware design is encapsulated in the child component TokenBudgetConstrainedInsightDepth, which directly reflects how OntologyConfigManager's token budget configuration throttles insight generation. The singleton nature of OntologyConfigManager — shared across all pipeline agents in a batch run — means that the token ceiling imposed on Insights is consistent and cannot drift mid-run. This is a meaningful reliability guarantee: insight depth is bounded deterministically per batch, not subject to race conditions or per-agent configuration divergence.

![Insights — Relationship](images/insights-relationship.png)

Structurally, Insights produces two distinct output types: a **pattern catalog** (recurring structural patterns identified across entities in a batch) and **knowledge reports** (structured summary documents of batch findings). These serve different consumers — the pattern catalog is reusable across future classification and deduplication decisions, while knowledge reports are oriented toward cross-project knowledge sharing as described in `docs/architecture/cross-project-knowledge.md`. This separation suggests a deliberate distinction between machine-consumable analytical artifacts and human- or pipeline-readable summaries.

## Implementation Details

No code symbols or key files were identified in the current observations, so implementation mechanics must be inferred from behavioral descriptions. The Insights agents consume entities in batch, leveraging the `ontologyClass` metadata already attached by upstream classifiers (OntologyClassifier, OntologyValidator) to construct class-aware prompts. The LLM interaction is budget-constrained via TokenBudgetConstrainedInsightDepth: as the token budget configured in OntologyConfigManager increases or decreases, the depth of analysis — likely the number of entities processed, the complexity of prompts, or the length of generated outputs — scales accordingly.

The **pattern catalog extraction** sub-process identifies recurring structures across the batch. This implies some form of cross-entity comparison or aggregation logic within the Insights stage, though the specific implementation mechanism is not surfaced in the current observations. The catalog's stated purpose — informing future classification and deduplication — positions it as a persistent artifact that outlives the batch run and feeds back into the broader pipeline over time.

**Knowledge report authoring** produces structured documents aligned with the conventions in `docs/architecture/cross-project-knowledge.md`. The consistency requirement here implies that report generation follows a defined schema or template rather than free-form LLM output, ensuring reports are interoperable with cross-project knowledge sharing infrastructure.

Token usage is tracked and surfaced via the Token Usage Dashboard documented in `docs/architecture/token-usage.md`, enabling per-batch cost monitoring for the Insights stage specifically. This observability mechanism is important given that LLM costs are the primary operational variable in Insights' execution profile.

## Integration Points

Insights is embedded within SemanticAnalysis and sits downstream of the Ontology family of components — OntologyClassifier and OntologyValidator having already enriched entities before Insights receives them. The sibling relationship with OntologyConfigManager is particularly tight: OntologyConfigManager's singleton token budget configuration is the primary external control surface for Insights' behavior. Developers adjusting batch token budgets in OntologyConfigManager are directly tuning Insights' analytical depth.

The LegacyOntologyAdapter sibling is relevant insofar as it ensures OntologyClassifier and OntologyValidator continue to produce valid `ontologyClass` metadata during the Phase 42-03 migration period — metadata that Insights depends on for class-aware prompting. Any degradation in ontology metadata <USER_ID_REDACTED> upstream would directly reduce the targeting precision of Insights' LLM calls.

Outbound integration points include the Token Usage Dashboard (`docs/architecture/token-usage.md`) for cost observability and the cross-project knowledge sharing infrastructure (`docs/architecture/cross-project-knowledge.md`) that consumes knowledge reports. The pattern catalog's integration point — future classification and deduplication decisions — implies it is written to a shared store accessible to pipeline agents in subsequent runs, though the specific persistence mechanism is not detailed in current observations.

## Usage Guidelines

**Token budget configuration is the primary tuning lever for Insights.** Developers should treat OntologyConfigManager's token budget settings as the dial that controls insight <USER_ID_REDACTED> vs. cost. Because TokenBudgetConstrainedInsightDepth directly throttles LLM consumption, under-budgeted runs will produce shallower insights; over-budgeted runs risk cost overruns. The Token Usage Dashboard should be consulted after initial batch runs to calibrate budget settings against actual cost profiles.

**Ontology metadata <USER_ID_REDACTED> is a prerequisite.** Since Insights prompts are class-aware, the value of insight generation is contingent on accurate `ontologyClass` assignments from upstream. Batches run with misconfigured or degraded ontology definitions (e.g., during ontology migrations handled by LegacyOntologyAdapter) should be evaluated carefully — insights generated against incorrect classifications may be misleading.

**Pattern catalogs are batch-spanning artifacts.** Because the pattern catalog is designed to inform future classification and deduplication, developers should treat it as a persistent knowledge artifact requiring versioning or management discipline, not a transient batch output. Overwriting or discarding catalogs between runs would forfeit the cross-batch learning value the sub-process is designed to provide.

**Knowledge reports must conform to cross-project conventions.** Reports should be validated against the schema described in `docs/architecture/cross-project-knowledge.md` before being shared across projects. Structural deviations reduce interoperability with the broader knowledge sharing infrastructure that downstream consumers depend on.

---

### Architectural Patterns and Design Trade-offs: Summary

| Concern | Decision | Trade-off |
|---|---|---|
| Sequencing | Downstream of classification | Higher prompt precision; requires reliable upstream metadata |
| Budget governance | Centralized via OntologyConfigManager singleton | Consistent depth; inflexible per-entity granularity |
| Output types | Catalog (machine) vs. report (human/pipeline) | Dual-purpose artifacts; separate maintenance concerns |
| Observability | Token Usage Dashboard integration | Cost transparency; adds instrumentation overhead |
| Cross-run learning | Persistent pattern catalog | Accumulates value over time; requires artifact lifecycle management |


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized agents to extract, classify, validate, and persist structured knowledge from git history and LSL (Live Session Log) sessions. It combines AST-based code graph construction, LLM-powered semantic insight generation, ontology classification, and content validation into a coordinated batch-analysis workflow. The pipeline produces structured knowledge entities enriched with ontology metadata before persisting them to a graph-based knowledge store.

### Children
- [TokenBudgetConstrainedInsightDepth](./TokenBudgetConstrainedInsightDepth.md) -- Per parent context, OntologyConfigManager governs token budget allocation per batch run, directly throttling how many tokens the Insights sub-component can consume during LLM-driven analysis.

### Siblings
- [Pipeline](./Pipeline.md) -- Pipeline is hosted within the `integrations/mcp-server-semantic-analysis` directory, establishing it as an MCP server that exposes pipeline control as tool endpoints to orchestrating agents
- [Ontology](./Ontology.md) -- The system maintains a two-level ontology hierarchy (upper/lower) with separate definition files, paths to which are managed by OntologyConfigManager, allowing the classification tier to be reconfigured without code changes
- [OntologyConfigManager](./OntologyConfigManager.md) -- Implemented as a singleton to ensure all pipeline agents share identical ontology configuration throughout a batch run, preventing mid-run config drift between classifier and validator instances
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- Wraps km-core's OntologyRegistry behind a legacy-compatible interface, isolating the migration boundary so that OntologyValidator and OntologyClassifier continue to function without modification during Phase 42-03


---

*Generated from 5 observations*
