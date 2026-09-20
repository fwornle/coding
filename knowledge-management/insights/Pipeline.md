# Pipeline

**Type:** SubComponent

[LLM+CGR] The code graph's import list (graphify/analyze.py's god_nodes/surprising_connections/suggest_questions, build.py's build_from_json, cluster.py's cluster/score_all, detect.py's detect, export.py's to_json/to_obsidian, extract.py's extract/collect_files, report.py's generate) sketches a multi-stage batch pipeline architecture: extraction → graph building → clustering/scoring → pattern/anomaly detection → export → reporting. This staged pipeline is structurally similar to BaseAgent's execute() sequence (process → calculateConfidence → detectIssues → generateRouting → applyCorrections → buildMetadata) described in the parent context, suggesting a recurring 'linear staged pipeline with discrete named phases' pattern across the codebase's different subsystems.

# Pipeline — Technical Insight Document

## What It Is

Pipeline, as a SubComponent of SemanticAnalysis, is not a single monolithic module but a recurring architectural motif that manifests across two distinct domains within the codebase: agent launch orchestration (`config/agents/*.sh`, `config/agents/pi-extensions/*.ts`) and code/knowledge graph batch processing (`graphify/analyze.py`, `build.py`, `cluster.py`, `detect.py`, `export.py`, `extract.py`, `report.py`). Concrete orchestration entry points appear directly in the code graph — `pollKnowledgePipeline` in `health-coordinator.js` and `full_pipeline` in `sample_calls.py` — each acting as a single named function that callers invoke rather than manually sequencing individual stages. `test_pipeline.py` further formalizes expectations for this behavior through tests like `test_pipeline_runs_end_to_end`, `test_pipeline_graph_has_edges`, `test_pipeline_all_nodes_have_community`, and `test_pipeline_incremental_update`.

![Pipeline — Architecture](images/pipeline-architecture.png)

## Architecture and Design

The dominant pattern is a **staged, multi-phase pipeline**: extraction (`extract.py`'s `extract`/`collect_files`) → graph building (`build.py`'s `build_from_json`) → clustering/scoring (`cluster.py`'s `cluster`/`score_all`) → detection (`detect.py`'s `detect`) → export (`export.py`'s `to_json`/`to_obsidian`) → reporting (`report.py`'s `generate`). This mirrors the template-method sequence used by sibling **BaseAgent** (`process → calculateConfidence → detectIssues → generateRouting → applyCorrections → buildMetadata`), suggesting the codebase applies a consistent "linear staged pipeline with discrete named phases" pattern regardless of language or domain.

A second recurring pattern is **deterministic-first, escape-hatch-for-flexibility**, inherited conceptually from parent SemanticAnalysis's hard-root-guard philosophy. In the agent-launch half of Pipeline, `config/agents/opencode.sh` and `copilot.sh` hardcode explicit provider/model routing tables and defensively unset environment variables rather than trusting inheritance — the same instinct that leads sibling L2SubsystemClassifier to enforce a closed-vocabulary lookup over `coding.lower.json` rather than open LLM classification.

A third pattern is the **fail-safe guard**, appearing in two opposite but principled forms: `no-unbounded-fs-scan.ts` fails *open* on internal errors (permitting the command) because the risk is a slow scan, not corruption, whereas `batch-provenance.mjs`'s `selectBatchesForReport()` fails *closed*, under-reporting ambiguous batches to avoid crediting unearned work. Both mirror the "never fail outright, degrade safely" ethos of the parent's classification fallback logic.

## Implementation Details

On the graph-processing side, the pipeline's phases are cleanly separated by module: `analyze.py` supplies analytical primitives (`god_nodes`, `surprising_connections`, `suggest_questions`); `build.py` assembles the graph via `build_from_json`; `cluster.py` performs `cluster` and `score_all`; `detect.py` runs anomaly/pattern `detect`; `export.py` serializes results (`to_json`, `to_obsidian`); `report.py` produces human-readable output via `generate`. `test_pipeline.py` validates this chain end-to-end (`run_pipeline`, `test_pipeline_runs_end_to_end`), checks structural invariants (edges exist, all nodes have community assignments), verifies detection quality (`test_pipeline_detection_finds_code_and_docs`), confirms reporting surfaces meaningful content (`test_pipeline_report_mentions_top_god_node`), and exercises incremental behavior (`test_pipeline_incremental_update`).

On the agent-launch side, `pi.sh`'s `_pi_write_models_json` and its `thinkingLevelMap` translate pi's `reasoning_effort` vocabulary into the proxy's routing bands, letting heterogeneous agents (pi, opencode, copilot) be orchestrated uniformly by one `llm-routing.yaml` consumer — functionally the shell-script analog of BaseAgent.execute()'s uniform treatment of otherwise-heterogeneous agents. `opencode.sh` builds its model catalogue via an explicit `for _m in claude-sonnet-5 claude-haiku-4.5 gpt-4o gpt-4o-mini` enumeration, with an explicit comment that new models must be added there or get discarded downstream — a closed-vocabulary discipline paralleling L2SubsystemClassifier's registration requirement.

Child component **LslSessionDurationCache** illustrates a related but narrower defensive pattern: `copilot.sh`'s `agent_pre_launch()` deliberately avoids exporting `COPILOT_PROVIDER_*` itself, instead clearing inherited state and deferring actual BYOK wiring to `scripts/launch-agent-common.sh`'s `configure_proxy_routing()`, which runs later behind a health-check gate — a "clear-then-let-a-later-stage-decide" approach that trades immediacy for safety, consistent with Pipeline's broader staged-execution philosophy.

![Pipeline — Relationship](images/pipeline-relationship.png)

## Integration Points

Pipeline sits beneath **SemanticAnalysis** and alongside siblings **Ontology**, **Insights**, **BaseAgent**, and **L2SubsystemClassifier**, sharing SemanticAnalysis's deterministic-first design ethos even though its concrete implementations (shell scripts, Python graph modules, TypeScript extensions) are technically distant from the TypeScript classification agent that anchors the parent. It depends on `@fwornle/km-core`-adjacent conventions for routing (`llm-routing.yaml`) and ontology-driven vocabularies (`coding.lower.json`), reflecting the same declarative-registration discipline as L2SubsystemClassifier. Its `pi-extensions/no-unbounded-fs-scan.ts` gate operates as a PreToolUse hook supplementing rather than replacing prompt-level instruction, indicating an integration surface with whatever agent runtime invokes tool calls. Downstream, `health-coordinator.js` and `sample_calls.py` integrate Pipeline as callable orchestration units, and `batch-provenance.mjs` integrates with reporting/dashboard infrastructure via window/provenance-based batch attribution rather than fragile substring matching.

## Usage Guidelines

Developers extending Pipeline's graph-processing stages should preserve the strict phase ordering (extract → build → cluster → detect → export → report) validated by `test_pipeline.py`; new stages should ship with corresponding graph-invariant tests (edges present, all nodes clustered) rather than relying solely on end-to-end checks. When adding new LLM providers or models to agent-launch configs, they must be explicitly enumerated (as in `opencode.sh`'s model loop) — nothing is inferred or auto-discovered, matching the ontology's closed-vocabulary requirement. Guard-style extensions should choose fail-open vs. fail-closed deliberately based on risk profile, following the precedent set by `no-unbounded-fs-scan.ts` versus `batch-provenance.mjs`. Finally, new orchestration entry points should follow the single-function convention (`pollKnowledgePipeline`, `full_pipeline`) so callers never need to sequence internal stages manually, preserving encapsulation and testability across the pipeline's growing set of domains.


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
- Calls: log, noteObsApiBusy, obsApiBusyNow, obsApiBusyExhausted, clearObsApiBusyEpisode, userActiveNow, evaluateObsApiAutoHeal, normalize, score, god_nodes (+10 more)
- Imports: graphify/analyze.py, god_nodes, surprising_connections, suggest_questions, graphify/build.py, build_from_json, graphify/cluster.py, cluster, score_all, detect.py (+10 more)

**Other:**
- test_pipeline.py (module) in test_pipeline.py
- The code graph's import list (graphify/analyze.py's god_nodes/surprising_connections/suggest_questions, build.py's build_from_json, cluster.py's cluster/score_all, detect.py's detect, export.py's to_json/to_obsidian, extract.py's extract/collect_files, report.py's generate) sketches a multi-stage batch pipeline architecture: extraction → graph building → clustering/scoring → pattern/anomaly detection → export → reporting. This staged pipeline is structurally similar to BaseAgent's execute() sequence (process → calculateConfidence → detectIssues → generateRouting → applyCorrections → buildMetadata) described in the parent context, suggesting a recurring 'linear staged pipeline with discrete named phases' pattern across the codebase's different subsystems.
- pollKnowledgePipeline (health-coordinator.js) and full_pipeline (sample_calls.py) both appear as top-level orchestration entry points in the code graph, implying a convention where each subsystem (health monitoring, sample/test invocation) exposes a single named pipeline-orchestrating function rather than requiring callers to sequence individual stage functions themselves — consistent with the encapsulation goal behind BaseAgent.execute() in the parent SemanticAnalysis pipeline.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The classification pipeline in OntologyClassificationAgent embodies a deliberate 'deterministic-first, LLM-as-fallback' philosophy that recurs throughout SemanticAnalysis. Before any LLM call is made, classifySingleObservation() checks the observation's name against the hard-root-guard set (CollectiveKnowledge, Coding, DynArch, Timeline, Normalisa) imported from @fwornle/km-core's HIERARCHY_ROOTS. If matched, the method immediately assigns classificationMethod='hard-root-guard' and returns without ever invoking classifier.classify() or touching the LLM. This is a defensive engineering decision: because these 5 names anchor the entire hierarchy, any LLM-driven misclassification of them would cascade corruption through the whole ontology tree, so the developers chose to hardcode an escape hatch rather than trust probabilistic classification for structurally critical nodes.

### Children
- [LslSessionDurationCache](./LslSessionDurationCache.md) -- [LLM] config/agents/copilot.sh's agent_pre_launch() deliberately does NOT export COPILOT_PROVIDER_* itself, instead unsetting any inherited values and logging a comment that explains why: unconditional export previously caused double-writing of token usage (proxy wire + copadt transcript, referenced as WR-02) and broke fail-soft behavior when the proxy URL was dead (WR-05). The actual BYOK wiring is deferred to scripts/launch-agent-common.sh's configure_proxy_routing(), which runs later behind a curl health gate. This is a defensive 'clear-then-let-a-later-stage-decide' pattern that trades immediacy for safety — the hook exists mainly to guarantee a clean starting state rather than to configure anything itself.

### Siblings
- [Ontology](./Ontology.md) -- [CGR] ontology (variable) in knowledge-management.json
- [Insights](./Insights.md) -- [CGR] INSIGHTS (class) in kb-ab-sample-tasks.mjs
- [BaseAgent](./BaseAgent.md) -- [LLM] The parent observation describing BaseAgent's template-method execute() pipeline (process() → calculateConfidence() → detectIssues() → generateRouting() → applyCorrections() → buildMetadata()) is not directly visible in the provided code files, but the surrounding config/agents/*.sh scripts (copilot.sh, opencode.sh, pi.sh) reveal a parallel template-method philosophy at the shell layer: each agent definition file sources common hooks (agent_check_requirements, agent_pre_launch, agent_cleanup) that are called uniformly by launch-agent-common.sh, mirroring the same 'implement the hooks, let the orchestrator drive the sequence' pattern that BaseAgent enforces in TypeScript. This suggests the project applies the template-method pattern consistently across both its LLM-agent pipeline and its CLI-agent launch pipeline.
- [L2SubsystemClassifier](./L2SubsystemClassifier.md) -- [LLM] L2SubsystemClassifier's refinement step, as implemented via loadL2Classes() in ontology-classification-agent.ts, is architected as a closed-vocabulary lookup rather than an open classification task. It derives its candidate set by filtering registry.classCatalog to entries whose `extends` field resolves to one of REFINABLE_L1_PARENTS ('Component','SubComponent','Detail'), sourced from .data/ontologies/coding.lower.json. This means the classifier's entire universe of possible outputs (currently 10 L2 classes such as EtmDaemon, RapidLlmProxy, ConstraintMonitor) is defined declaratively in a JSON ontology file rather than being inferable or extensible by the LLM itself — a new SubComponent type cannot be classified into existence, it must first be registered in the ontology.


---

*Generated from 22 observations*
