# Insights

**Type:** SubComponent

The TIERED-MODEL-PROPOSAL.md in integrations/mcp-server-semantic-analysis/docs/ suggests insight generation agents are candidates for lower-cost model tiers, implying they operate on already-structured data requiring less LLM reasoning than raw classification

# Insights — Technical Insight Document

## What It Is

Insights is a SubComponent of the SemanticAnalysis system, documented architecturally in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`. It represents a post-persistence concern within the broader agent pipeline: rather than transforming data in flight, it consumes Knowledge Graph (KG) entities that have already been written and committed, then produces derived analytical artifacts on top of them. Its responsibilities span two distinct sub-activities — pattern catalog extraction (identifying recurring structural patterns across KG entities) and knowledge report authoring (producing formatted, human-readable output documents).

![Insights — Architecture](images/insights-architecture.png)

Architecturally, Insights sits at the boundary between machine-readable KG data and human-readable output. Where sibling subcomponents like Pipeline orchestrate mid-flight agent sequencing and Ontology / OntologySubsystem manage classification taxonomies, Insights operates strictly downstream of persistence. Its child component, PostPersistenceInsightTrigger, is the concrete mechanism that activates insight generation only after KG writes are committed — making Insights a deliberately decoupled, read-only consumer of the KG rather than a participant in the write path.

## Architecture and Design

The Insights subcomponent inherits the architectural rigor established by its parent SemanticAnalysis, namely the `BaseAgent<TInput, TOutput>` contract from `src/agents/base-agent.ts`. Every insight-generating agent must implement the same five-method lifecycle — `process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`, and `applyCorrections()` — even though its input is already-persisted KG data rather than raw upstream artifacts like git commits or classification batches. This means insight agents fill the same `AgentResponse` envelope with timestamps, model metadata, routing suggestions, and corrections lists as any other agent in the system.

A central design decision visible in the observations is the **post-persistence separation**. By deferring insight generation until after KG writes are committed (enforced by PostPersistenceInsightTrigger), the system avoids coupling derived analytics to the latency or failure modes of the primary write pipeline. This is in deliberate contrast to the sibling Pipeline subcomponent, which coordinates agents in a fixed DAG order defined in `batch-analysis.yaml` with explicit `depends_on` edges. Insights does not participate in that DAG — it activates afterwards, consuming the DAG's persisted output.

A second design decision, suggested by `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`, is that insight agents are candidates for **lower-cost LLM model tiers**. The rationale is that they operate on already-structured KG data, which requires substantially less reasoning effort than raw classification or entity extraction. This is a cost-optimization trade-off: insight <USER_ID_REDACTED> is bounded by the upstream classification done by agents like OntologyClassificationAgent, so spending top-tier model budget on insights yields diminishing returns.

## Implementation Details

Insights decomposes into two distinct sub-responsibilities that form a small internal pipeline. First, **pattern catalog extraction** scans the KG for recurring structural patterns across entities and emits a catalog artifact. This catalog is itself structured data — a list of identified patterns with associated entities and frequencies — and serves as the input to the second stage.

Second, **knowledge report authoring** consumes the pattern catalog and produces a formatted output document. Crucially, this output is not structured KG data; it is a human-readable artifact (likely Markdown or a similar narrative format). This is what places Insights at the KG/human boundary: the input is machine-readable, the output is not. Implementations of the report authoring agent must still conform to the `BaseAgent` contract, which means `generateRouting()` is non-trivial — the observations suggest routing likely directs the finished report to different delivery channels based on the report's confidence score computed by `calculateConfidence()`.

![Insights — Relationship](images/insights-relationship.png)

Because Insights agents must populate all five `BaseAgent` lifecycle methods, `detectIssues()` and `applyCorrections()` cannot be left as empty stubs without consequence — the orchestrating pipeline branches on those fields. For insight generation specifically, `detectIssues()` likely flags low-confidence patterns or malformed KG references encountered during extraction, while `applyCorrections()` provides the self-healing path for recoverable issues (e.g., skipping a malformed entity rather than failing the whole report).

## Integration Points

The primary integration boundary is the Knowledge Graph itself. Insights reads from the KG after writes are committed; it does not write back to it (at least not as a primary path). This read-only posture against persisted data is what justifies the "post-persistence concern" classification in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`.

The activation integration runs through the child component PostPersistenceInsightTrigger, which is the concrete event/hook mechanism that fires after KG commits. This trigger isolates Insights from needing to know about the write pipeline's internals — it simply responds to "writes have happened" signals.

Within Insights, pattern catalog extraction integrates with knowledge report authoring through the catalog artifact as a shared data contract. This is a classic producer/consumer split: changes to the catalog schema affect both sides, so the catalog format constitutes an internal API surface that should be versioned with care.

Externally, the routing output from `generateRouting()` integrates Insights with downstream delivery channels (likely file outputs, MCP responses, or notification systems), with the routing decision conditioned on the confidence score. This makes the confidence calculation a first-class concern, not an afterthought — it directly affects where the report ends up.

## Usage Guidelines

When implementing a new insight agent within this subcomponent, developers should treat the `BaseAgent` contract as non-negotiable. Even though the input is already-structured KG data and the LLM reasoning burden is lighter, all five methods (`process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`, `applyCorrections()`) must be meaningfully populated. Empty stubs will compile and run, but downstream branching — particularly the routing of completed reports — depends on these fields carrying real values.

Respect the post-persistence boundary. Insights agents should not attempt to intercept or transform data mid-pipeline; that is the responsibility of the sibling Pipeline subcomponent and the agents it orchestrates. If a new analytical need requires data that is not yet in the KG, the correct response is to enrich the upstream classification or extraction agents (potentially via OntologySubsystem's `OntologyConfigManager` under `src/ontology/`), not to embed extraction logic inside an insight agent.

When choosing model tiers for new insight agents, consult `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. The default assumption should be a lower-cost tier, with escalation justified only when the agent genuinely needs richer reasoning than what structured KG input affords.

Finally, treat the boundary between pattern catalog extraction and knowledge report authoring as a real internal API. The catalog is the contract between the two sub-stages, so schema changes should be coordinated and ideally backward-compatible.

---

### Summary of Key Insights

1. **Architectural patterns identified**: Post-persistence consumer pattern, producer/consumer split between catalog extraction and report authoring, uniform agent lifecycle via `BaseAgent<TInput, TOutput>`, and trigger-based activation through PostPersistenceInsightTrigger.

2. **Design decisions and trade-offs**: Deferring insight generation until after KG commits decouples analytics from write-path latency at the cost of eventual (not immediate) consistency for derived artifacts. Adopting lower-cost LLM tiers reduces operational expense but caps insight <USER_ID_REDACTED> at the <USER_ID_REDACTED> of upstream classification.

3. **System structure insights**: Insights sits as a leaf-style SubComponent under SemanticAnalysis, parallel to Pipeline, Ontology, and OntologySubsystem but distinct in that it operates downstream of persistence rather than within the DAG defined in `batch-analysis.yaml`. Its sole child, PostPersistenceInsightTrigger, mediates activation.

4. **Scalability considerations**: Because Insights reads only committed KG data and does not block the write pipeline, it can scale horizontally and asynchronously without back-pressure on upstream agents. Lower model tiers further reduce per-invocation cost, making it feasible to run insight generation frequently or across large KG slices.

5. **Maintainability assessment**: The rigid `BaseAgent` contract enforces structural consistency across all insight agents, making new additions predictable to implement. The internal catalog-to-report split provides a clean seam for evolving either stage independently. The main maintenance risk is implicit coupling to KG schema — since Insights reads persisted KG entities, schema changes upstream can silently degrade insight <USER_ID_REDACTED>, suggesting that integration tests across the persistence boundary are valuable.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The `BaseAgent<TInput, TOutput>` abstract class defined in `src/agents/base-agent.ts` establishes a rigid, five-method execution contract that every agent in the pipeline must implement: `process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`, and `applyCorrections()`. This is not a loose interface — each method is called sequentially within a standardized envelope, meaning an agent cannot skip confidence calculation or issue detection even if it has nothing meaningful to report for those phases. The resulting `AgentResponse` envelope carries not just the domain output but also metadata (timestamps, model usage), routing suggestions for downstream agents, and a corrections list for self-healing. For a new developer, this means that implementing a new agent is less about writing a single processing function and more about correctly filling all five lifecycle slots; an agent that returns empty stubs for `detectIssues()` or `generateRouting()` will still compile and run, but the orchestrating pipeline likely depends on those fields being populated to make branching decisions. The generic type parameters `<TInput, TOutput>` allow the base class to be reused across wildly different domains — from raw git commit arrays (SemanticAnalysisAgent) to ontology classification batches (OntologyClassificationAgent) — without sacrificing static type safety on the input/output contracts.

### Children
- [PostPersistenceInsightTrigger](./PostPersistenceInsightTrigger.md) -- As stated in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md, insight generation is explicitly classified as a post-persistence concern, meaning it does not intercept or transform data mid-pipeline but instead activates after KG writes are committed.

### Siblings
- [Pipeline](./Pipeline.md) -- The pipeline coordinator sequences agents in a fixed order defined in batch-analysis.yaml, with each step declaring explicit depends_on edges for DAG-based execution
- [Ontology](./Ontology.md) -- The upper ontology defines broad abstract categories while lower ontology definitions provide concrete entity types, creating a two-tier classification hierarchy referenced by OntologyClassificationAgent
- [OntologySubsystem](./OntologySubsystem.md) -- OntologyConfigManager centralizes all ontology configuration loading under src/ontology/, meaning changes to entity type hierarchies flow through a single managed entry point rather than being scattered across agents


---

*Generated from 5 observations*
