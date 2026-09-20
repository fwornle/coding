# ClosedVocabularyRefinement

**Type:** Detail

[Architecture Notes] Classification universe is externalized to .data/ontologies/coding.lower.json, decoupling 'what L2 classes exist' from the classifier's own code, but the eligibility gate (REFINABLE_L1_PARENTS) remains hardcoded in ontology-classification-agent.ts, producing a split source of truth; Failure handling favors silent degradation (return L1 parent) over explicit error signaling, which trades debuggability/observability for pipeline robustness; No structured-output contract is enforced on the LLM response; correctness depends on a regex-based scan rather than a schema-validated payload; Test strategy is integration-first against fixture copies of the production ontology rather than mocks, trading test speed/isolation for fidelity to real malformed-data failure modes; The component under analysis (ClosedVocabularyRefinement / ontology-classification-agent.ts) is not represented in the supplied code files or code_graph, so architecture claims here rest on the parent entity's observations rather than on directly inspected source in this pass

# ClosedVocabularyRefinement: Technical Insight Document

## What It Is

ClosedVocabularyRefinement is implemented in `ontology-classification-agent.ts` as the L2 refinement mechanism of its parent, **L2SubsystemClassifier**. Its defining characteristic is that it never asks an LLM to invent a taxonomy — it asks the LLM to *select* from a pre-registered, closed set of candidates. That candidate set is derived by `loadL2Classes()`, which filters `registry.classCatalog` for entries whose `extends` field resolves to one of `REFINABLE_L1_PARENTS` (`'Component'`, `'SubComponent'`, `'Detail'`). The sole data source backing this filter is `.data/ontologies/coding.lower.json`, which currently defines roughly 10 concrete L2 classes such as `EtmDaemon`, `RapidLlmProxy`, and `ConstraintMonitor`. This makes ClosedVocabularyRefinement fundamentally a filter-then-lookup component, not a generative one — a design choice that caps hallucination risk at the structural level rather than through prompt engineering alone.

## Architecture and Design

The component embodies several distinct, deliberately chosen patterns. First is the **closed-vocabulary lookup pattern** itself: classification output space is declaratively registered rather than open-ended. Second is a **tolerant-parser / lenient-prompt pairing** — `buildL2RefinementPrompt()` renders candidates as multiple-choice-style natural language rather than a JSON schema or function-calling contract, and `extractL2FromLLMResponse()` decodes that free text using a boundary-anchored regex (`(^|[^A-Za-z0-9_])name([^A-Za-z0-9_]|$)`). This is a conscious rejection of structured-output APIs in favor of prose tolerance: it survives conversational hedging ("I'd classify this as...") while the boundary anchors prevent substring false positives (a hallucinated `EtmDaemonService` correctly fails to match `EtmDaemon`).

Third is a **graceful-degradation funnel** spanning three tiers: (1) a hard-root-guard bypass in `classifySingleObservation()` for `HIERARCHY_ROOTS`, (2) LLM-constrained L2 refinement (this component), and (3) silent fallback to the L1 class when `extractL2FromLLMResponse()` finds no match. This funnel encodes a precision/availability trade-off directly into control flow rather than via retries or exceptions.

Fourth is a **split source of truth**: ontology values live in JSON (`.data/ontologies/coding.lower.json`), sibling to **CodingLowerOntologySource**, while refinement *eligibility* rules live in the TypeScript constant `REFINABLE_L1_PARENTS`. This mirrors the parent L2SubsystemClassifier's own architecture description, reinforcing that the refinement logic and the data it consumes are intentionally decoupled but asymmetrically extensible.

## Implementation Details

Four functions form the operational core. `loadL2Classes()` performs candidate-set derivation, joining registry data against the hardcoded parent-eligibility list. `buildL2RefinementPrompt()` constructs the natural-language, multiple-choice-style prompt sent to the LLM. `extractL2FromLLMResponse()` is the decode half of this encode/decode pair — it scans the LLM's free-text response using the token-boundary regex and, critically, fails silently: a no-match result is not logged or flagged distinctly from a legitimate L1-level classification. This means observability into refinement failure rates requires specifically instrumenting the no-match branch of `extractL2FromLLMResponse()`, since no exception or error signal is otherwise generated. `classifySingleObservation()` orchestrates the outer funnel, applying the hard-root-guard before refinement is ever attempted.

## Integration Points

ClosedVocabularyRefinement sits beneath **L2SubsystemClassifier** in the hierarchy and depends directly on the ontology data supplied by its sibling **CodingLowerOntologySource** (`.data/ontologies/coding.lower.json`). The registry/classifier chain — `OntologyRegistry` and `OntologyClassifier` — is exercised in `ontology-classification-agent.test.ts` via integration-style tests against tmpdir-copied fixtures (`upper.json`, `coding-ontology.json`, `coding.lower.json`) rather than mocks, deliberately targeting failure modes like malformed `extends` chains and missing L2 entries that mocks would never surface. Notably, no code files or code_graph evidence in this pass (`config/agents/copilot.sh`, `opencode.sh`, `pi.sh`, `no-unbounded-fs-scan.ts`, `batch-provenance.mjs`) reference this component — they belong to unrelated agent-launcher and dashboard subsystems, so this document's grounding rests entirely on the parent entity's prior observations.

## Usage Guidelines

Adding new L2 candidates under an *already-refinable* L1 parent is a pure JSON edit to `.data/ontologies/coding.lower.json`. However, making a new L1 category eligible for refinement at all requires a TypeScript change to `REFINABLE_L1_PARENTS` and a redeploy — contributors extending the JSON alone can mistakenly believe they've made a class reachable when it remains dead data until its parent is added to the code-side constant. Because tier-3 fallback is silent, do not rely on error rates or exceptions to detect refinement degradation; instrument `extractL2FromLLMResponse()`'s no-match path explicitly. Finally, keep test fixtures in `ontology-classification-agent.test.ts` synchronized with production ontology schema changes (e.g., renaming `extends`) — since fixtures are point-in-time copies, schema drift between production and fixtures is a plausible, hard-to-detect regression vector.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- [LLM] The 'Code Files' and code_graph evidence supplied for this analysis (config/agents/copilot.sh, config/agents/opencode.sh, config/agents/pi.sh, config/agents/pi-extensions/no-unbounded-fs-scan.ts, integrations/system-health-dashboard/batch-provenance.mjs) do not reference ontology-classification-agent.ts, loadL2Classes(), buildL2RefinementPrompt(), extractL2FromLLMResponse(), or REFINABLE_L1_PARENTS anywhere in their contents — they belong to unrelated subsystems (agent launch wrappers and dashboard batch attribution). No [LLM+CGR] observations are included because the code_graph payload was empty and none of the supplied files ground the ClosedVocabularyRefinement component; every observation above is derived solely from the parent entity's prior observations rather than from newly inspected source.


## Hierarchy Context

### Parent
- [L2SubsystemClassifier](./L2SubsystemClassifier.md) -- [LLM] L2SubsystemClassifier's refinement step, as implemented via loadL2Classes() in ontology-classification-agent.ts, is architected as a closed-vocabulary lookup rather than an open classification task. It derives its candidate set by filtering registry.classCatalog to entries whose `extends` field resolves to one of REFINABLE_L1_PARENTS ('Component','SubComponent','Detail'), sourced from .data/ontologies/coding.lower.json. This means the classifier's entire universe of possible outputs (currently 10 L2 classes such as EtmDaemon, RapidLlmProxy, ConstraintMonitor) is defined declaratively in a JSON ontology file rather than being inferable or extensible by the LLM itself — a new SubComponent type cannot be classified into existence, it must first be registered in the ontology.

### Siblings
- [CodingLowerOntologySource](./CodingLowerOntologySource.md) -- [LLM] The parent context's observations describe a JSON-file-backed ontology (.data/ontologies/coding.lower.json) that governs L2 classification, but none of the provided code files actually implement or reference the OntologyRegistry/OntologyClassifier machinery described (ontology-classification-agent.ts, loadL2Classes(), buildL2RefinementPrompt(), extractL2FromLLMResponse()). The supplied files are unrelated agent-launcher shell scripts (copilot.sh, opencode.sh, pi.sh) and a batch-provenance module, suggesting this 'CodingLowerOntologySource' Detail node's actual implementation lives elsewhere in the repo and was not surfaced in this code slice.


---

*Generated from 9 observations*
