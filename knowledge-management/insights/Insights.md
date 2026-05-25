# Insights

**Type:** SubComponent

docs/TIERED-MODEL-PROPOSAL.md proposes routing insight generation to higher-capability LLM tiers for complex pattern synthesis while using cheaper models for straightforward extraction, reflecting cost-<USER_ID_REDACTED> tradeoffs

# Insights — Technical Insight Document

## What It Is

`Insights` is a SubComponent of the `SemanticAnalysis` multi-agent pipeline (implemented in `integrations/mcp-server-semantic-analysis/`) that encapsulates the semantic insight generation stage of the knowledge extraction workflow. As documented in `docs/architecture/agents.md`, it centers on a dedicated insight-generation agent responsible for authoring structured knowledge reports from aggregated code and history signals. The component sits between upstream code-graph and git-history ingestion stages and downstream ontology classification, acting as the synthesis layer where raw signals are transformed into named, structured observations.

The primary purpose of `Insights` is pattern catalog extraction over AST-parsed code graphs. It identifies recurring structural motifs — for example, repeated `DEFINES_METHOD` clusters — and surfaces them as named patterns in the knowledge report. These reports are not free-form text but structured documents that conform to the `BaseAgent` response envelope shared by all agents in the pipeline. The single concrete child of this SubComponent is the `InsightGenerationAgent`, which performs the actual authoring work.

![Insights — Architecture](images/insights-architecture.png)

## Architecture and Design

The architecture of `Insights` follows the same pattern that governs all stages of the parent `SemanticAnalysis` pipeline: a specialized agent extending the common `BaseAgent<TInput, TOutput>` abstract class. By emitting outputs conforming to the BaseAgent response envelope, each insight carries a confidence score that downstream <USER_ID_REDACTED>-gating uses to accept or discard the observation. This design decision unifies the heterogeneous agent pipeline behind a single contract — issue detection, routing suggestions, and corrections all flow through the same envelope structure used by sibling components such as `Pipeline`, `Ontology`, and `OntologyConfigManager`.

A key architectural decision documented in `docs/TIERED-MODEL-PROPOSAL.md` is the tiered routing of LLM workloads. Insight generation is proposed to be routed to higher-capability LLM tiers for complex pattern synthesis, while cheaper models handle straightforward extraction. This reflects an explicit cost-<USER_ID_REDACTED> tradeoff: pattern synthesis — recognizing that several `DEFINES_METHOD` relations cluster into a meaningful structural motif — demands richer reasoning, whereas mechanical extraction does not. The tiering mechanism is external to the agent itself; the agent declares its work type, and the routing layer chooses an appropriate model.

The component participates in a producer-consumer relationship within the pipeline DAG defined by `batch-analysis.yaml` (managed by the sibling `Pipeline` component). Knowledge reports produced by insight agents are consumed by KG operator agents, which use them to generate ontology-typed entity triples in coordination with the sibling `Ontology` component. This makes `Insights` a synthesis node that depends on prior code-graph construction and feeds the classification/persistence stages with structured, confidence-scored payloads.

## Implementation Details

The concrete implementation work resides in the child entity `InsightGenerationAgent`, identified in `docs/architecture/agents.md` as the agent responsible for authoring structured knowledge reports. Its inputs are aggregated signals — AST-parsed code graphs and historical signals from git ingestion — and its outputs are structured knowledge reports containing named patterns discovered through the catalog extraction process. Because the agent extends `BaseAgent<TInput, TOutput>`, its output type is automatically wrapped in the standard response envelope, ensuring that consumers receive a uniform shape regardless of which agent produced it.

Pattern catalog extraction is the central technical mechanic. The agent walks the AST-parsed graph looking for recurring structural motifs — clusters of repeated relationships (such as `DEFINES_METHOD`) that indicate a higher-order pattern worth naming. Each surfaced pattern becomes a named entry in the knowledge report. Because pattern significance is inherently probabilistic, every entry is associated with a confidence score so that downstream stages can apply <USER_ID_REDACTED> gates without re-deriving certainty themselves.

![Insights — Relationship](images/insights-relationship.png)

The confidence scoring mechanism is the contract that ties this component into the larger retry-and-validation machinery of the pipeline. Sibling components such as `BaseAgent` provide the abstract foundation that enforces this envelope; siblings like `Pipeline` enforce DAG ordering; and `OntologyConfigManager` (a singleton per `docs/configuration.md`) provides shared classification thresholds that downstream stages apply to insight outputs. The `LegacyOntologyAdapter` sibling further isolates the agent from concrete km-core registry APIs, so an insight's path to becoming an ontology-typed entity remains decoupled.

## Integration Points

`Insights` integrates with its parent `SemanticAnalysis` pipeline through the `BaseAgent<TInput, TOutput>` contract — the same contract that unifies all sibling agents covering git history ingestion, code graph construction, ontology classification, content validation, and persistence. Inputs arrive from upstream code-graph construction stages and git-history ingestion stages; outputs are picked up by KG operator agents responsible for triple generation. The depends_on edges declared in `batch-analysis.yaml` (administered by the `Pipeline` sibling) make this producer-consumer dependency explicit and enforceable through topological execution order.

The connection to ontology infrastructure is indirect but critical. While `Insights` does not classify entities itself, the structured reports it produces are the raw material that the `Ontology` sibling (backed by `OntologyClassifier` and `OntologyValidator`, both wrapping km-core `OntologyRegistry` through `LegacyOntologyAdapter`) operates on. Classification thresholds are managed by the `OntologyConfigManager` singleton, ensuring all pipeline agents share a single authoritative view of ontology paths.

On the model-routing side, `Insights` integrates with the tiered model strategy proposed in `docs/TIERED-MODEL-PROPOSAL.md`. The agent signals the complexity of its current task — pattern synthesis vs. straightforward extraction — and the routing layer selects an appropriate LLM tier. This is an integration point that affects cost and latency characteristics of the whole pipeline rather than its functional outputs.

## Usage Guidelines

When working with `Insights`, the foremost rule is to respect the `BaseAgent` response envelope. Any extension of `InsightGenerationAgent` must produce outputs that include a confidence score, issue list, routing suggestions, and corrections as appropriate — because downstream consumers (KG operator agents, ontology classifiers, persistence) all rely on this envelope to decide whether to accept, retry, or discard each observation. Bypassing the envelope breaks the pipeline's <USER_ID_REDACTED>-gating guarantees.

Pattern catalog extraction should operate over AST-parsed code graphs rather than raw source text. The observed convention is to look for recurring structural motifs (such as repeated `DEFINES_METHOD` clusters) and to name them as discrete patterns in the report. New extraction logic should follow this same principle: identify a cluster, give it a name, attach a confidence score, and let downstream stages decide whether the named pattern is significant enough to materialize as an ontology entity.

When tuning cost and <USER_ID_REDACTED>, route work according to the proposal in `docs/TIERED-MODEL-PROPOSAL.md`: use higher-capability LLM tiers for complex pattern synthesis and reserve cheaper models for straightforward extraction. Avoid hard-coding model choices inside the agent; instead, declare the nature of the task so the tiering layer can select appropriately. Finally, remember that `Insights` is a producer in the pipeline DAG — changes to the report schema have downstream impact on KG operator agents, so any structural modification must be coordinated with consumers and reflected in the depends_on edges declared in `batch-analysis.yaml`.

---

### Summary of Key Findings

1. **Architectural patterns identified**: Specialized-agent-over-common-abstract-base (`BaseAgent<TInput, TOutput>`); producer-consumer staging in a DAG-orchestrated pipeline; structured response envelope with confidence-based <USER_ID_REDACTED> gating; tiered LLM routing for cost-<USER_ID_REDACTED> balance.

2. **Design decisions and trade-offs**: Uniform envelope across heterogeneous agents (simplicity vs. expressiveness); confidence-score-driven gating (probabilistic acceptance vs. deterministic rules); tiered model routing (cost vs. synthesis <USER_ID_REDACTED>); structured reports as the producer interface (schema rigidity vs. consumer reliability).

3. **System structure insights**: `Insights` is a synthesis stage sandwiched between ingestion/graph-construction and ontology/persistence; its single child `InsightGenerationAgent` is the operational unit; integration is mediated entirely through the `BaseAgent` envelope and the DAG declared in `batch-analysis.yaml`.

4. **Scalability considerations**: Tiered model routing enables horizontal cost scaling by directing simple extraction to cheaper models. The DAG structure permits parallelism along independent edges. Confidence-score gating allows lossy fast paths where low-confidence insights are discarded without expensive downstream processing.

5. **Maintainability assessment**: Strong — the `BaseAgent` contract isolates `Insights` from sibling concerns, `LegacyOntologyAdapter` decouples it from the concrete km-core registry, and `OntologyConfigManager` centralizes configuration. The chief maintenance risk is schema drift in knowledge reports affecting downstream KG operator agents; this should be controlled through explicit versioning of the report structure.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.

### Children
- [InsightGenerationAgent](./InsightGenerationAgent.md) -- docs/architecture/agents.md identifies a dedicated insight-generation agent responsible for authoring structured knowledge reports from aggregated code and history signals

### Siblings
- [Pipeline](./Pipeline.md) -- batch-analysis.yaml defines the pipeline as a DAG of steps with explicit depends_on edges, enabling topological execution order across coordinator, observation, KG, dedup, and persistence agents
- [Ontology](./Ontology.md) -- docs/architecture/agents.md describes OntologyClassifier and OntologyValidator as distinct interfaces, both now backed by LegacyOntologyAdapter wrapping km-core OntologyRegistry
- [OntologyConfigManager](./OntologyConfigManager.md) -- Implemented as a singleton (per docs/configuration.md patterns) to ensure all pipeline agents share a single authoritative view of ontology paths and classification thresholds
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- Resolves the architectural issue documented in CRITICAL-ARCHITECTURE-ISSUES.md where OntologyClassifier was tightly coupled to an internal registry; the adapter decouples pipeline agents from the km-core registry's concrete API
- [BaseAgent](./BaseAgent.md) -- BaseAgent<TInput, TOutput> is a generic abstract class (documented in docs/architecture/agents.md) parameterized on input and output types, enforcing type safety across the heterogeneous agent pipeline


---

*Generated from 5 observations*
