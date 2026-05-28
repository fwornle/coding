# Pipeline

**Type:** SubComponent

Serves as The batch processing pipeline agents: coordinator, observation generation, KG operators, deduplication, and persistence. within the SemanticAnalysis component at hierarchy path Coding/SemanticAnalysis/Pipeline

## What It Is

Pipeline is a sub-component of SemanticAnalysis, located at the hierarchy path `Coding/SemanticAnalysis/Pipeline`. It serves as the **batch processing pipeline** within the broader SemanticAnalysis system, responsible for coordinating the agents and operational stages that together extract, classify, and persist structured knowledge: coordinator logic, observation generation, Knowledge Graph (KG) operators, deduplication, and persistence. It is an L2 SubComponent entity, meaning it sits one level below SemanticAnalysis in the project knowledge hierarchy, alongside sibling sub-components Ontology, Insights, OntologyRegistry, and GitStalenessDetector.

---

## Architecture and Design

![Pipeline — Architecture](images/pipeline-architecture.png)

The Pipeline sub-component embodies a **staged batch processing** design philosophy within the SemanticAnalysis parent. Rather than handling individual, ad-hoc requests, Pipeline organizes work into discrete, ordered stages that each agent or operator in the system moves through sequentially. This maps directly to how SemanticAnalysis is described at the parent level: a multi-agent pipeline that ingests git history, LSL (vibe) sessions, and AST-parsed code graphs, then coordinates several specialized agents to produce structured output.

The five conceptual stages embedded in Pipeline's responsibility surface — coordination, observation generation, KG operations, deduplication, and persistence — reflect a deliberate separation of concerns. Coordination sits at the front, orchestrating which agents run and in what order. Observation generation is the LLM-driven or heuristic phase where raw data (git diffs, vibe session logs, AST code graphs) is transformed into semantic observations. KG operators handle the graph-layer manipulations against Memgraph. Deduplication ensures that repeated ingestion runs do not produce redundant entities. Persistence is the final write-through to durable storage.

This linear staged architecture is a deliberate trade-off favoring **correctness and traceability over latency**. Batch pipelines are easier to audit, replay, and debug than streaming or event-driven alternatives, which is important in a system whose primary product is structured knowledge that other components (like OntologyRegistry and Insights) will consume downstream.

![Pipeline — Relationship](images/pipeline-relationship.png)

---

## Implementation Details

No code symbols or key files are currently indexed under the Pipeline sub-component, which means the canonical implementation details are not yet surfaced in the knowledge graph. However, the functional description grounds a clear picture of internal mechanics.

The **coordinator** stage is the entry point. Based on the parent SemanticAnalysis description, this coordinator is responsible for dispatching work to the specialized agents: CodeGraphAgent (Tree-sitter/Memgraph indexing), SemanticAnalysisAgent (LLM-driven cross-correlation), OntologyClassificationAgent (ontology hierarchy classification), and ContentValidationAgent (staleness detection). The coordinator likely operates as an orchestration loop that sequences these agents, passes their outputs forward as inputs to subsequent stages, and collects a unified result envelope.

The **observation generation** stage is where semantic signal is extracted from raw inputs. This is the most computationally intensive stage, relying on LLM inference via SemanticAnalysisAgent to cross-correlate git history, vibe session data, and AST-parsed code graphs. Observations at this stage are likely structured records with confidence scores, as the BaseAgent abstract class is documented to provide a standard response envelope including confidence breakdown, issue detection, and routing suggestions.

The **KG operators** stage performs graph mutations — node upserts, edge creation, relationship classification — against the Memgraph backend, driven by the outputs of observation generation and OntologyClassificationAgent. **Deduplication** follows, comparing incoming entities against existing graph state to prevent duplicate nodes or edges across pipeline runs. **Persistence** finalizes the batch, committing all validated, deduplicated knowledge entities to durable storage.

---

## Integration Points

Pipeline is the operational backbone that connects every other sub-component of SemanticAnalysis into a coherent execution flow. Its relationship to sibling sub-components is functional, not merely organizational:

- **Ontology** and **OntologyRegistry** are upstream dependencies for the KG operators and observation classification stages. The pipeline must resolve entity types against the ontology hierarchy before persisting them.
- **Insights** is a downstream consumer: the structured knowledge entities that Pipeline produces and persists are what the Insights sub-component draws on to generate higher-level analytical outputs.
- **GitStalenessDetector** integrates into the pipeline's ContentValidationAgent stage, providing file-reference and git-commit correlation to flag entities that should be marked stale before persistence.

At the agent boundary, Pipeline interfaces with all four specialized agents documented under SemanticAnalysis (CodeGraphAgent, SemanticAnalysisAgent, OntologyClassificationAgent, ContentValidationAgent) through the BaseAgent standard response envelope, which provides a consistent contract for confidence scores, detected issues, and routing decisions across every pipeline stage.

---

## Usage Guidelines

Because Pipeline operates as a batch processor, developers working with or extending it should treat **idempotency as a first-class requirement**. The deduplication stage exists precisely because pipeline runs may be replayed (e.g., after a failed run or a re-index of a repository). Any new KG operator or persistence logic introduced into the pipeline must be safe to run multiple times against the same input without producing duplicate or inconsistent graph state.

The coordinator's sequencing of agents is significant: stages are ordered for a reason (observe → classify → validate → deduplicate → persist), and inserting new agents or operators out of sequence risks passing unclassified or unvalidated data into the graph. New pipeline stages should be integrated at the coordinator level with explicit input/output contracts defined via the BaseAgent response envelope pattern.

Since no code files are currently indexed under this sub-component, the immediate priority for maintainability is surfacing Pipeline's implementation files into the knowledge graph. Once indexed, the coordinator logic, KG operator implementations, and deduplication strategies will become navigable and referenceable — enabling the kind of targeted insight generation that sibling sub-components like OntologyRegistry and GitStalenessDetector benefit from.

---

## Architectural Patterns, Design Decisions, and Scalability

| Dimension | Assessment |
|---|---|
| **Pattern** | Staged batch pipeline with agent coordinator |
| **Key trade-off** | Correctness/replayability over low latency |
| **Scalability** | Batch design scales horizontally by parallelizing independent agent stages; deduplication is the likely bottleneck at scale |
| **Maintainability** | Currently limited by absence of indexed code symbols; coordinator-based design should support modular agent addition without full pipeline rewrites |
| **Risk** | Tight coupling between pipeline stage ordering and agent output schemas; schema changes in BaseAgent response envelope ripple through all stages |

The most significant architectural decision embedded in Pipeline's design is the choice to make deduplication an **explicit pipeline stage** rather than delegating it to the persistence layer or the graph database. This places deduplication logic under the control of the pipeline coordinator, where it can be tuned or bypassed for specific run modes (e.g., a full re-index vs. an incremental update), rather than being an implicit side effect of graph upsert semantics.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline within the mcp-server-semantic-analysis integration that processes git history, LSL (vibe) sessions, and AST-parsed code graphs to extract, classify, and persist structured knowledge entities. The system coordinates several specialized agents: CodeGraphAgent indexes repositories via Tree-sitter/Memgraph, SemanticAnalysisAgent performs LLM-driven cross-correlation of git/vibe/code data, OntologyClassificationAgent classifies observations against upper/lower ontology hierarchies, ContentValidationAgent detects stale entities via file-reference and git-commit correlation, and a BaseAgent abstract class provides the standard response envelope (confidence breakdown, issue detection, routing suggestions) used by all agents.

### Siblings
- [Ontology](./Ontology.md) -- Ontology is a sub-component of SemanticAnalysis
- [Insights](./Insights.md) -- Insights is a sub-component of SemanticAnalysis
- [OntologyRegistry](./OntologyRegistry.md) -- OntologyRegistry is a sub-component of SemanticAnalysis
- [GitStalenessDetector](./GitStalenessDetector.md) -- GitStalenessDetector is a sub-component of SemanticAnalysis


---

*Generated from 3 observations*
