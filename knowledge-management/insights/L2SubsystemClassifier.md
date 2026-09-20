# L2SubsystemClassifier

**Type:** SubComponent

[LLM] Failure handling in the L2 refinement path is graceful-degradation-by-design rather than fail-fast: when extractL2FromLLMResponse() cannot find any registered L2 name in the LLM's response, it does not raise an error or leave the observation unclassified — it silently returns the original L1 parent class. Combined with the upstream hard-root-guard in classifySingleObservation() (which bypasses the LLM entirely for the five HIERARCHY_ROOTS names), this creates a three-tier classification funnel: (1) exact structural match on known roots — no LLM call, (2) LLM-assisted refinement constrained to a closed L2 vocabulary, (3) fallback to the coarser L1 classification when the LLM's answer can't be matched. Each tier trades precision for reliability, ensuring the pipeline never outright fails at the cost of sometimes under-classifying.

# L2SubsystemClassifier: Technical Insight Document

## What It Is

L2SubsystemClassifier is implemented in `ontology-classification-agent.ts`, where it performs the second-tier refinement step of the broader classification pipeline owned by its parent component, SemanticAnalysis. Rather than acting as an open-ended LLM classification task, it is architected as a **closed-vocabulary lookup**: the entire universe of possible L2 outputs (currently 10 classes such as `EtmDaemon`, `RapidLlmProxy`, `ConstraintMonitor`) is declared in `.data/ontologies/coding.lower.json`, not inferred or invented by the model. Its two children — `ClosedVocabularyRefinement` and `CodingLowerOntologySource` — directly reflect this split between mechanism (the filter-and-lookup logic) and data (the ontology file that defines valid outputs).

![L2SubsystemClassifier — Architecture](images/l2-subsystem-classifier-architecture.png)

## Architecture and Design

The core architectural pattern is **enumerate-then-match** classification: `loadL2Classes()` filters `registry.classCatalog` to entries whose `extends` field resolves to one of `REFINABLE_L1_PARENTS` (`'Component'`, `'SubComponent'`, `'Detail'`). This candidate set is then rendered into a multiple-choice-style prompt via `buildL2RefinementPrompt()`. The design deliberately caps hallucination risk by never asking the LLM to generate a taxonomy — only to select from one, a philosophy inherited by its child `ClosedVocabularyRefinement`.

This component also participates in a three-tier classification funnel that mirrors SemanticAnalysis's deterministic-first, LLM-as-fallback philosophy: (1) `classifySingleObservation()`'s hard-root-guard bypasses the LLM entirely for the five `HIERARCHY_ROOTS`, (2) LLM-assisted refinement constrained to the closed L2 vocabulary, and (3) fallback to the coarser L1 classification when no match is found. Each tier trades precision for reliability — a graceful-degradation-by-design approach rather than fail-fast.

## Implementation Details

Parsing is deliberately tolerant of prose. `extractL2FromLLMResponse()` uses a token-boundary regex — `(^|[^A-Za-z0-9_])name([^A-Za-z0-9_]|$)` — to scan free-text LLM output for an exact, non-substring occurrence of a registered L2 class name (preventing false positives like `EtmDaemonService` matching `EtmDaemon`). This avoids brittle JSON-strict parsing while still enforcing precision at the match boundary.

When no registered name is found, `extractL2FromLLMResponse()` silently returns the original L1 parent class rather than raising an error — the graceful-degradation mechanism underpinning tier 3 of the funnel. This behavior is data-dependent on `CodingLowerOntologySource`, whose `.data/ontologies/coding.lower.json` is the sole authority on which L2 names exist to be matched, even though the code for that data source was not surfaced directly in this slice.

![L2SubsystemClassifier — Relationship](images/l2-subsystem-classifier-relationship.png)

## Integration Points

L2SubsystemClassifier sits beneath SemanticAnalysis alongside siblings Ontology, Pipeline, Insights, and BaseAgent, consuming SemanticAnalysis's hard-root-guard logic upstream before its own refinement executes. Its correctness depends on a data/code coupling: the ontology JSON is the source of truth for *what* L2 classes exist, while the eligibility rule for *which* L1 parents are refinable is hardcoded in `REFINABLE_L1_PARENTS` within the TypeScript file — an asymmetric extension cost where adding a new L2 subtype is a JSON edit, but adding a new refinable L1 category requires a code change.

Test coverage in `ontology-classification-agent.test.ts` exercises the real `OntologyRegistry`/`OntologyClassifier` chain against tmpdir-copied fixtures of `upper.json`, `coding-ontology.json`, and `coding.lower.json`, favoring integration-style realism over mocks.

## Usage Guidelines

New SubComponent types must be registered in `.data/ontologies/coding.lower.json` before they can ever be classified — the LLM cannot classify into existence. When extending refinement eligibility to new L1 parent types, developers must update `REFINABLE_L1_PARENTS` in code, not just the ontology JSON. Because test fixtures are point-in-time copies, any schema change to `extends` conventions or `REFINABLE_L1_PARENTS` must be manually propagated to fixtures to avoid undetected drift. Finally, classification here never hard-fails — under-classification (falling back to L1) is the expected degraded outcome, not an error condition, and downstream consumers should treat L1-fallback results accordingly.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The classification pipeline in OntologyClassificationAgent embodies a deliberate 'deterministic-first, LLM-as-fallback' philosophy that recurs throughout SemanticAnalysis. Before any LLM call is made, classifySingleObservation() checks the observation's name against the hard-root-guard set (CollectiveKnowledge, Coding, DynArch, Timeline, Normalisa) imported from @fwornle/km-core's HIERARCHY_ROOTS. If matched, the method immediately assigns classificationMethod='hard-root-guard' and returns without ever invoking classifier.classify() or touching the LLM. This is a defensive engineering decision: because these 5 names anchor the entire hierarchy, any LLM-driven misclassification of them would cascade corruption through the whole ontology tree, so the developers chose to hardcode an escape hatch rather than trust probabilistic classification for structurally critical nodes.

### Children
- [ClosedVocabularyRefinement](./ClosedVocabularyRefinement.md) -- [LLM] The parent context's description of loadL2Classes() establishes ClosedVocabularyRefinement as a filter-then-lookup pattern rather than a generative one: it derives its candidate set from registry.classCatalog by matching `extends` against REFINABLE_L1_PARENTS ('Component','SubComponent','Detail') in ontology-classification-agent.ts, with .data/ontologies/coding.lower.json as the sole data source for the ~10 concrete L2 classes (e.g. EtmDaemon, RapidLlmProxy, ConstraintMonitor). This design choice means the LLM is never asked to invent a taxonomy — only to select from one — which caps hallucination risk at the cost of requiring a human/ontology-authoring step before any new SubComponent type can ever appear in classification output.
- [CodingLowerOntologySource](./CodingLowerOntologySource.md) -- [LLM] The parent context's observations describe a JSON-file-backed ontology (.data/ontologies/coding.lower.json) that governs L2 classification, but none of the provided code files actually implement or reference the OntologyRegistry/OntologyClassifier machinery described (ontology-classification-agent.ts, loadL2Classes(), buildL2RefinementPrompt(), extractL2FromLLMResponse()). The supplied files are unrelated agent-launcher shell scripts (copilot.sh, opencode.sh, pi.sh) and a batch-provenance module, suggesting this 'CodingLowerOntologySource' Detail node's actual implementation lives elsewhere in the repo and was not surfaced in this code slice.

### Siblings
- [Ontology](./Ontology.md) -- [CGR] ontology (variable) in knowledge-management.json
- [Pipeline](./Pipeline.md) -- [CGR] pollKnowledgePipeline (function) in health-coordinator.js
- [Insights](./Insights.md) -- [CGR] INSIGHTS (class) in kb-ab-sample-tasks.mjs
- [BaseAgent](./BaseAgent.md) -- [LLM] The parent observation describing BaseAgent's template-method execute() pipeline (process() → calculateConfidence() → detectIssues() → generateRouting() → applyCorrections() → buildMetadata()) is not directly visible in the provided code files, but the surrounding config/agents/*.sh scripts (copilot.sh, opencode.sh, pi.sh) reveal a parallel template-method philosophy at the shell layer: each agent definition file sources common hooks (agent_check_requirements, agent_pre_launch, agent_cleanup) that are called uniformly by launch-agent-common.sh, mirroring the same 'implement the hooks, let the orchestrator drive the sequence' pattern that BaseAgent enforces in TypeScript. This suggests the project applies the template-method pattern consistently across both its LLM-agent pipeline and its CLI-agent launch pipeline.


---

*Generated from 8 observations*
