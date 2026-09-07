# Ontology

**Type:** SubComponent

Decoupling classification (ontology-classification-agent.ts) from extraction (semantic-analysis-agent.ts) allows the ontology schema to evolve independently of extraction heuristics

# Ontology — Technical Insight Document

## What It Is

Ontology is the classification subsystem implemented in `ontology-classification-agent.ts`, operating as the second stage of the SemanticAnalysis pipeline. It consumes entities produced upstream by `semantic-analysis-agent.ts` and assigns each entity a position within a hierarchical ontology schema. This schema is explicitly two-tiered: an **upper ontology** capturing broad, domain-independent categories, and a **lower ontology** capturing domain-specific entity types. The purpose of this component is not to identify *what* something is in raw terms (that is extraction's job) but to determine *where* it fits within a structured knowledge hierarchy.

![Ontology — Architecture](images/ontology-architecture.png)

## Architecture and Design

The architecture follows a clear separation-of-concerns pattern: extraction and classification are implemented as distinct agents rather than a monolithic process. `semantic-analysis-agent.ts` handles raw entity/relationship extraction from git history and LSL session data, while `ontology-classification-agent.ts` performs the downstream mapping into the hierarchical ontology structure. This decoupling is a deliberate design decision — it allows the ontology schema (categories, hierarchy rules, class definitions) to evolve independently of the heuristics used for extraction, meaning changes to how entities are categorized don't require touching extraction logic, and vice versa.

Within the classification stage itself, there is a further internal separation: entity type resolution logic (determining the most specific applicable ontology class) is kept distinct from validation logic (ensuring classified entities conform to the hierarchical structure). This layered internal design mirrors the broader pipeline's staged approach and supports independent testing and tuning of each concern.

As a child of SemanticAnalysis, Ontology inherits its position in the larger multi-stage pipeline described at the parent level, where a coordinator agent (part of the sibling **Pipeline** component) sequences execution across the extraction and classification agents. This confirms that Ontology is not invoked ad hoc but is orchestrated as a fixed stage in a sequenced workflow.

## Implementation Details

The core mechanics center on two functional units within `ontology-classification-agent.ts`:

1. **Entity type resolution logic** — given an extracted entity, this logic determines the most specific ontology class applicable, effectively performing a most-specific-match lookup against the upper/lower ontology hierarchy. This is kept separate from the extraction logic that originally produced the entity, reinforcing the boundary between "finding" and "categorizing."

2. **Validation routines** — these check that classified entities conform to the hierarchical ontology structure before they are allowed to proceed downstream. This acts as a gating mechanism, ensuring malformed or inconsistent classifications do not propagate into persistence.

Only entities that pass validation are forwarded to the Pipeline's persistence stage, making validation a hard checkpoint in the data flow rather than an optional or advisory check.

## Integration Points

Ontology sits directly between two well-defined neighbors in the data flow. Upstream, it depends entirely on entities produced by `semantic-analysis-agent.ts` (part of the SemanticAnalysis parent) — it does not perform its own extraction from git history or LSL data. Downstream, validated, classified entities feed into the Pipeline's persistence stage, and separately into **Insights**, which explicitly consumes ontology-classified entities (rather than raw extraction output) to derive higher-order patterns. This makes Ontology a required intermediary: Insights' pattern derivation is only possible because entities have already been placed into the hierarchical schema.

![Ontology — Relationship](images/ontology-relationship.png)

The sibling **Pipeline** component's coordinator agent is responsible for sequencing calls to `semantic-analysis-agent.ts` and `ontology-classification-agent.ts`, meaning Ontology's execution is externally orchestrated rather than self-triggered.

## Usage Guidelines

Developers extending or modifying the ontology schema should treat the upper/lower ontology distinction as foundational — new entity types should be classified with attention to whether they represent domain-independent (upper) or domain-specific (lower) concepts. Because entity type resolution and validation are separate concerns, changes to classification heuristics should not require modifying validation rules, and vice versa; maintain this separation to preserve independent testability. Since downstream consumers like Insights and the Pipeline's persistence stage rely on validated, hierarchy-conformant entities, any schema changes must ensure validation routines are updated in lockstep to avoid silently passing malformed classifications downstream. Finally, because classification is intentionally decoupled from extraction, schema evolution (e.g., adding new ontology classes) should be assessed only against classification logic and validation, without needing to coordinate changes with `semantic-analysis-agent.ts`.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The batch-analysis workflow is structured as a multi-stage pipeline where semantic-analysis-agent.ts is responsible for extracting raw entities and relationships from git history and LSL (likely 'Language/Session Log') session data, while ontology-classification-agent.ts takes those extracted entities and maps them into a hierarchical ontology structure. This separation of concerns means the extraction logic (identifying what something is—a function, a decision, a bug fix) is decoupled from the classification logic (determining where that entity fits in a broader knowledge hierarchy), allowing each agent to be independently tuned, tested, and potentially swapped out without affecting the other stage's implementation.

### Siblings
- [Pipeline](./Pipeline.md) -- Pipeline stages include a coordinator agent that sequences execution across semantic-analysis-agent.ts and ontology-classification-agent.ts, matching the two-stage extraction/classification split described for SemanticAnalysis
- [Insights](./Insights.md) -- Insight generation consumes ontology-classified entities to derive higher-order patterns, rather than operating directly on raw git/LSL extraction output


---

*Generated from 5 observations*
