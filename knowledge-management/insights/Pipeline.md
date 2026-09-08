# Pipeline

**Type:** SubComponent

[CGR] Imports: graphify/analyze.py, god_nodes, surprising_connections, suggest_questions, graphify/build.py, build_from_json, graphify/cluster.py, cluster, score_all, detect.py (+10 more)

# Pipeline — Technical Insight Document

## What It Is

Pipeline is the SubComponent representing the ordered, staged execution model that underlies the semantic-analysis workflow, defined primarily through `AGENT_SUBSTEPS['semantic_analysis']` in `multi-agent-graph.tsx`. It is not a single class but a declarative structure describing four sequential sub-steps — parse, extract, relate, enrich — each carrying explicit metadata about inputs, outputs, and LLM usage tier. This same pattern of declaring a pipeline as an ordered list of typed sub-steps recurs elsewhere in the codebase, notably in `AGENT_SUBSTEPS['kg_operators']` (conv/aggr/embed/dedup/pred/merge) and `AGENT_SUBSTEPS['git_history']` (fetch/diff/extract), indicating "Pipeline" is a general architectural idiom rather than a one-off implementation. As a child of SemanticAnalysis, Pipeline realizes the multi-agent workflow's extraction phase described at the parent level, while its own child, RelationDiscovery, implements the 'relate' stage explicitly.

## Architecture and Design

The core design pattern is a declarative, metadata-driven staged pipeline: each sub-step is described with an explicit inputs/outputs contract and an `llmUsage` classification (`none`, `standard`, `fast`, or `premium` as seen in sibling Insights' 'patterns' step). This lets the system reason about cost and capability per stage without inspecting implementation code — a deliberate trade-off favoring inspectability and tunability over flexibility of ad hoc step definition.

![Pipeline — Architecture](images/pipeline-architecture.png)

Stages are strictly ordered and data-dependent: 'parse' produces parsed content consumed by 'extract', whose entities feed 'relate', whose relations feed 'enrich'. This mirrors the parent SemanticAnalysis's separation-of-concerns philosophy (extraction agent vs. classification agent), applied at finer granularity within a single agent's internal pipeline. The `git_history` sub-pipeline (fetch/diff/extract) acts as an upstream ingestion pipeline that feeds into this same semantic extraction stage, while `kg_operators` acts as a downstream parallel pipeline consuming semantic_analysis's outputs for embedding and deduplication — establishing Pipeline as a middle link in a larger multi-stage graph.

## Implementation Details

Each sub-step entry encodes a `techNote` describing its underlying mechanism: 'parse' is explicitly rule-based (`llmUsage:'none'`, "Rule-based parsing"), deliberately avoiding LLM cost for deterministic content parsing. 'extract' (Entity Extraction) is LLM-powered NER (`llmUsage:'standard'`) consuming 'Parsed content' and 'Domain context'. 'relate' (Relation Discovery) consumes 'Entities' and 'Context windows' to produce 'Entity relations' and 'Relation types' — this is the exact contract implemented by the child component RelationDiscovery. 'enrich' (Context Enrichment) uses a cheaper `llmUsage:'fast'` tier with "Fast context summarization" techNote, producing 'Enriched entities' and 'Observations', reflecting a cost-conscious design that reserves premium/standard LLM usage for stages that need it and downgrades enrichment to a fast tier.

Separately, at the operational/testing layer, concrete pipeline execution and validation appear via `run_pipeline` and `full_pipeline` (in `sample_calls.py`), and a battery of tests in `test_pipeline.py` (`test_pipeline_runs_end_to_end`, `test_pipeline_graph_has_edges`, `test_pipeline_all_nodes_have_community`, `test_pipeline_report_mentions_top_god_node`, `test_pipeline_detection_finds_code_and_docs`, `test_pipeline_incremental_update`). These tests imply the pipeline builds a graph (`build_from_json` from `graphify/build.py`), clusters it (`cluster`, `score_all` from `graphify/cluster.py`), analyzes it (`god_nodes`, `surprising_connections`, `suggest_questions` from `graphify/analyze.py`), and detects entities via `detect.py`, supporting incremental updates rather than only full rebuilds. `pollKnowledgePipeline` in `health-coordinator.js` suggests a separate health/monitoring hook into pipeline execution status.

## Integration Points

![Pipeline — Relationship](images/pipeline-relationship.png)

Pipeline integrates upstream with `git_history`'s fetch/diff/extract sub-pipeline, which supplies raw commit diffs into the semantic extraction stage. Downstream, `kg_operators` consumes semantic_analysis outputs for embedding and deduplication, forming a three-stage macro-pipeline (ingest → semantic analysis → knowledge-graph operations). Within SemanticAnalysis, Pipeline sits alongside sibling Ontology's `ontology_classification` sub-steps (match/validate/extend) and Insights' `insight_generation` sub-steps (e.g., 'patterns'), all following the same declarative sub-step convention, suggesting a shared schema/interface across agent pipelines in `multi-agent-graph.tsx`. Its child RelationDiscovery is a direct, named realization of the 'relate' entry's input/output contract. Operationally, `health-coordinator.js`'s `pollKnowledgePipeline` and calls like `noteObsApiBusy`/`obsApiBusyNow`/`evaluateObsApiAutoHeal` indicate integration with a health-monitoring/auto-heal subsystem tracking pipeline load.

## Usage Guidelines

Developers extending Pipeline should preserve the declared inputs/outputs contract per sub-step so downstream consumers (RelationDiscovery, kg_operators) remain compatible. LLM-usage tiers should be assigned deliberately: reserve 'none' for deterministic logic (as in 'parse'), 'fast' for lightweight summarization tasks (as in 'enrich'), and 'standard'/'premium' for tasks genuinely requiring stronger models. When adding new pipeline stages, follow the existing `AGENT_SUBSTEPS` declarative pattern used by `semantic_analysis`, `kg_operators`, `git_history`, and `ontology_classification` rather than introducing bespoke step definitions. New end-to-end behavior should be validated against the `test_pipeline.py` suite pattern (graph edges, community assignment, incremental updates) to ensure consistency with existing pipeline correctness guarantees.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- pollKnowledgePipeline (function) in health-coordinator.js
- full_pipeline (method) in sample_calls.py
- run_pipeline (function) in test_pipeline.py
- test_pipeline_runs_end_to_end (function) in test_pipeline.py
- test_pipeline_graph_has_edges (function) in test_pipeline.py
- test_pipeline_all_nodes_have_community (function) in test_pipeline.py
- test_pipeline_report_mentions_top_god_node (function) in test_pipeline.py
- test_pipeline_detection_finds_code_and_docs (function) in test_pipeline.py
- test_pipeline_incremental_update (function) in test_pipeline.py

**Relationships:**
- Calls: log, noteObsApiBusy, obsApiBusyNow, userActiveNow, evaluateObsApiAutoHeal, normalize, score, god_nodes, surprising_connections, suggest_questions (+10 more)
- Imports: graphify/analyze.py, god_nodes, surprising_connections, suggest_questions, graphify/build.py, build_from_json, graphify/cluster.py, cluster, score_all, detect.py (+10 more)

**Other:**
- test_pipeline.py (module) in test_pipeline.py


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The batch-analysis pipeline is organized as a multi-agent workflow where distinct responsibilities are separated into dedicated agent classes rather than a single monolithic analyzer. semantic-analysis-agent.ts is responsible for extracting structured knowledge entities from raw inputs (git history diffs/commits and LSL session logs), while ontology-classification-agent.ts takes those extracted entities and classifies them into a hierarchy (determining parent-child relationships and where a given entity fits within the broader ontology). This separation of extraction from classification allows each agent to have a narrower, more testable prompt/response contract with the underlying LLM, and lets the pipeline swap or tune one stage without affecting the other's logic.

### Children
- [RelationDiscovery](./RelationDiscovery.md) -- Defined as the 'relate' entry in AGENT_SUBSTEPS['semantic_analysis'] with inputs ['Entities', 'Context windows'] and outputs ['Entity relations', 'Relation types']

### Siblings
- [Ontology](./Ontology.md) -- AGENT_SUBSTEPS['ontology_classification'] in multi-agent-graph.tsx defines match, validate, and extend sub-steps for the classification agent
- [Insights](./Insights.md) -- AGENT_SUBSTEPS['insight_generation'] defines a 'patterns' sub-step (Pattern Discovery) tagged llmUsage:'premium', consuming 'Code entities' and 'Relations' to produce 'Pattern instances' and descriptions


---

*Generated from 19 observations*
