# SemanticAnalysis

**Type:** Component

## What It Is

SemanticAnalysis is the classification and analysis component of the Coding project's development pipeline, implemented across `base-agent.ts`, `ontology-classification-agent.ts`, and `semantic-analysis-agent.ts`. It is a sibling of LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, and ConstraintSystem under the Coding root, and it owns five child components: Pipeline, Ontology, HealthCoordinator, AgentLaunchers, and PiExtensions. Its core responsibility is to take git/vibe/code-graph input and produce classified, confidence-scored, routed output via an agent-based pipeline.

Note that two of its named children — AgentLaunchers and PiExtensions — have no corroborating implementation evidence in the observations gathered so far; retrieval surfaced only neighboring ontology/health/batch machinery for those, not their actual code. This document therefore focuses on what is directly evidenced: the BaseAgent contract and its two concrete agents.

![SemanticAnalysis — Architecture](images/semantic-analysis-architecture.png)

## Architecture and Design

The component follows a template-method pattern rooted in `base-agent.ts`: `execute(input, context)` is the sole public entry point for every concrete agent, internally sequencing `process()` (agent-specific, abstract), `calculateConfidence()`, `detectIssues()`, `generateRouting()`, and `applyCorrections()` into a uniform `AgentResponse`. This is a deliberate architectural constraint — no agent can skip confidence scoring or issue detection, since the envelope assembly lives in the base class rather than being opt-in per agent.

`OntologyClassificationAgent` (child component Ontology's likely home, per the `ontology (variable)` reference in events.test.ts) layers a two-tier strategy atop this contract: a deterministic hard-root guard checks input against `HIERARCHY_ROOTS` (CollectiveKnowledge, Coding, DynArch, Timeline, Normalisa, imported from `@fwornle/km-core`) before ever invoking the LLM classifier, and only falls through to `classifier.classify()` plus an optional L2 refinement pass for everything else. This design treats the five hierarchy roots as load-bearing anchors that must never drift due to LLM nondeterminism — validated by a dedicated hierarchy-roots test suite, indicating this is a contractual guarantee, not a shortcut.

`SemanticAnalysisAgent` wraps `@rapid/llm-proxy`'s LLMService behind lazy initialization (`ensureLLMInitialized()`), reflecting cost-consciousness at the per-agent level rather than only at pipeline aggregate scale, reinforced by `attachTokenLogger()` usage tracking per invocation.

![SemanticAnalysis — Relationship](images/semantic-analysis-relationship.png)

## Implementation Details

The L2 refinement pass in `ontology-classification-agent.ts` is the most intricate mechanism observed. `loadL2Classes()` filters `registry.classCatalog` to classes whose `extends` field matches `REFINABLE_L1_PARENTS`; `buildL2RefinementPrompt()` scopes an LLM prompt to just those candidates (declared in `coding.lower.json`); and `extractL2FromLLMResponse()` parses the answer into a specific subclass. Critically, this refinement degrades gracefully — if `coding.lower.json` is missing or the response can't be matched, classification falls back to the L1 parent rather than failing outright, making L2 refinement optional rather than load-bearing.

`SemanticAnalysisAgent` also writes a full debug trace JSON to `logs/semantic-analysis-trace-*.json` before analysis begins, capturing raw git/vibe/code-graph input for after-the-fact replay — a deliberate debuggability investment beyond ordinary logging. Its `analyzeGitAndVibeData()` function exposes an `options.analysisDepth` knob: `'surface'` caps analysis at 5 files and skips cross-analysis, while deeper settings presumably process the full file set with cross-analysis enabled, letting upstream callers trade thoroughness for latency per invocation.

The child Pipeline component, however, currently has an unresolved defect: it emits a `CodingLowerOntologySource` reference in output despite documentation stating this source type should never be produced — a live contract mismatch likely tied to the same `coding.lower.json` backing L2 refinement, currently unfixed.

## Integration Points

SemanticAnalysis depends on `@fwornle/km-core` for `HIERARCHY_ROOTS` and on `@rapid/llm-proxy`'s LLMService for classification and analysis calls. It reads `coding.lower.json` for both L2 refinement candidates and (apparently) ontology-source contracts referenced in the Pipeline bug. Its child HealthCoordinator is concretely implemented in `scripts/health-coordinator.js`, a single-owner in-memory state store exposing `/health`, `/health/state`, `/signals`, `/health/refresh` endpoints with a 5s tick scheduler — this supervises the health of pipeline processes rather than participating directly in classification logic. Separately, a planned (unimplemented) integration would merge a viewer-executable KB-data-quality research script with batch processing, letting missing information be captured in a single pass instead of sequentially as done today — a recognized architectural gap tied to KnowledgeManagement sibling concerns.

## Usage Guidelines

New agents must extend BaseAgent and implement only `process()`; the base class guarantees confidence scoring, issue detection, routing, and corrections are applied uniformly, so developers should not attempt to bypass or duplicate this envelope logic. When adding ontology classification behavior, respect the hard-root guard as a contract (backed by its own test suite) rather than routing hierarchy roots through the LLM path. L2 refinement should be treated as best-effort enhancement — code depending on it must tolerate silent fallback to L1 classification. Callers tuning throughput should be aware that `analysisDepth: 'surface'` sacrifices completeness (5-file cap, no cross-analysis) for speed. Finally, the outstanding `CodingLowerOntologySource` emission bug in Pipeline should be treated as a known contract violation until resolved — don't assume documented ontology-source guarantees currently hold in runtime output.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced
- KB Injection A/B Experiment — Task Design and Discrimination Validity establishes a planned merge of a viewer-executable research script for KB data quality with batch processing so missing information is captured in a single pass rather than sequentially
- Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect in which the pipeline emits a CodingLowerOntologySource reference in its output despite project documentation explicitly stating this source type should never be produced — indicating a live mismatch between the documented ontology-source contract (likely tied to coding.lower.json, the same file backing L2 refinement) and actual runtime emission behavior, currently unfixed.
- KB Injection A/B Experiment — Task Design and Discrimination Validity establishes that a planned (not yet implemented) piece of future work will merge two currently separate workstreams: a viewer-executable research script intended to improve knowledge-base data quality, and a batch-processing capability so that missing information is captured in a single pass instead of being gathered sequentially. This signals that the current SemanticAnalysis pipeline processes missing/incomplete data sequentially today, and that batch consolidation is a recognized but unaddressed architectural gap.

## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file; LLMAbstraction: [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copi; DockerizedServices: [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised ; KnowledgeManagement: [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, me; CodingPatterns: [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generat; ConstraintSystem: [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constra; SemanticAnalysis: [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource referenc.

### Children
- [Pipeline](./Pipeline.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug tracks an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced.
- [Ontology](./Ontology.md) -- [CGR] ontology (variable) in events.test.ts
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js is the actual implementation of HealthCoordinator: a single-owner in-memory SoT (`currentState`) exposing HTTP endpoints (GET /health, GET /health/state, POST /signals, POST /health/refresh) and a 5s tick scheduler that iterates check registries from config/health-verification-rules.json. This is directly the component under analysis, not an inferred neighbor.
- [AgentLaunchers](./AgentLaunchers.md) -- [LLM] None of the five retrieved files reference an entity, class, or module named 'AgentLaunchers', nor any launching/factory/dispatch mechanism for the pipeline agents named in the parent context (BaseAgent, OntologyClassificationAgent, SemanticAnalysisAgent). The retrieved set is dashboard UI (batch-progress.tsx), a health-monitoring daemon (health-coordinator.js), an ontology-class repair script (repair-writer-ontology-class.mjs), an ontology-system factory (src/ontology/index.ts), and an ETM lifecycle test — none of these instantiate, register, or invoke concrete Agent subclasses.
- [PiExtensions](./PiExtensions.md) -- [LLM] None of the five supplied source files implement or reference anything named 'PiExtensions'. batch-progress.tsx renders the UKB batch-processing dashboard tile (fetchProgress/fetchHistory against http://localhost:3033/api/batch/*), health-coordinator.js is the Phase 33 single-owner health SoT (currentState, shouldInject, the 5s tick scheduler), repair-writer-ontology-class.mjs repairs ontologyClass/entityType mismatches via arbitrate(), src/ontology/index.ts wires createOntologySystem() around a km-core OntologyRegistry, and health-coordinator-etm-expected.test.mjs asserts ETM-expectation lifecycle invariants. None of these touch a pi-agent extension surface, a plugin/extension registry, or anything with 'Pi' in its name — the retrieval appears to have surfaced the parent SubComponent's general neighborhood (ontology/health/batch machinery) rather than PiExtensions' own implementation.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [SESSION] Opencode Daemon — Session Tracking and Temp File Lifecycle establishes that health-coordinator.js computes PID staleness from heartbeat file age to surface accurate Healthy/Degraded status without false alarms for coding sub-agents
- [LLMAbstraction](./LLMAbstraction.md) -- [SESSION] 'LLM Routing Tier Priority' establishes that LLM requests must follow fallback tier order — max-subscription models first, then work/GH Copilot models, then Groq Llama-70B only as last resort — rather than demoting to lower tiers as primary
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Coding-Services Docker Container — Health Verification Workflow establishes that rebuild is performed via docker-compose and all supervised processes/health endpoints must be confirmed live before relying on downstream pipelines like wave-analysis
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero corresponding Insight graph nodes, meaning the viewer's History sidebar (which filters strictly to entityType 'Insight') could never surface a Batch badge for that run's conclusions.
- [CodingPatterns](./CodingPatterns.md) -- [SESSION] Documentation Style Guide for Diagrams and Markdown establishes that .puml source files must live in docs/puml/, and clarifies which generated diagram artifacts belong in version control versus being build outputs, enforcing consistent authoring and correct rendering across the docs pipeline.
- [ConstraintSystem](./ConstraintSystem.md) -- [SESSION] Statusline Click-Report Feature record establishes that clicking the 'constraints' field in the tmux statusline opens or focuses the constraint-monitor dashboard tab, tying HookManagementSystem's violation data to a click-driven UX surface


---

*Generated from 9 observations*
