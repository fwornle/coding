# CodingLowerOntologySource

**Type:** Detail

[LLM] The parent context's observations describe a JSON-file-backed ontology (.data/ontologies/coding.lower.json) that governs L2 classification, but none of the provided code files actually implement or reference the OntologyRegistry/OntologyClassifier machinery described (ontology-classification-agent.ts, loadL2Classes(), buildL2RefinementPrompt(), extractL2FromLLMResponse()). The supplied files are unrelated agent-launcher shell scripts (copilot.sh, opencode.sh, pi.sh) and a batch-provenance module, suggesting this 'CodingLowerOntologySource' Detail node's actual implementation lives elsewhere in the repo and was not surfaced in this code slice.

# CodingLowerOntologySource — Technical Insight Document

## What It Is

CodingLowerOntologySource refers to the declarative data source — the `.data/ontologies/coding.lower.json` file — that backs the L2 classification vocabulary used by its parent, **L2SubsystemClassifier**. This is a Detail-level component in the architecture, meaning it represents a granular implementation artifact rather than a full subsystem. Notably, none of the code files examined in this analysis pass (copilot.sh, opencode.sh, pi.sh, and integrations/system-health-dashboard/batch-provenance.mjs) directly implement or reference this file, nor do they touch the associated machinery (`ontology-classification-agent.ts`, `loadL2Classes()`, `buildL2RefinementPrompt()`, `extractL2FromLLMResponse()`). This is an important and explicitly flagged gap: the actual implementation of CodingLowerOntologySource lives elsewhere in the repository and was not surfaced in this code slice. Everything below is therefore inferential, drawn from the parent/sibling descriptions and from thematically parallel code found in unrelated files.

## Architecture and Design

Based on the parent component description, CodingLowerOntologySource embodies a **closed-vocabulary, declarative-config-as-source-of-truth** pattern. The JSON file defines the entire universe of valid L2 classes (currently ~10, including EtmDaemon, RapidLlmProxy, and ConstraintMonitor), while `loadL2Classes()` filters `registry.classCatalog` entries whose `extends` field resolves to one of `REFINABLE_L1_PARENTS` ('Component', 'SubComponent', 'Detail') — with that eligibility gate hardcoded in TypeScript. This produces a clean separation: **what values are valid** lives in data (coding.lower.json), while **when the mechanism applies** lives in code. This exact split recurs elsewhere in the codebase — config/agents/opencode.sh and config/agents/pi.sh apply the same pattern to LLM routing decisions via llm-routing.yaml-driven model selection and `thinkingLevelMap`, respectively, suggesting this is a house architectural idiom rather than something unique to the ontology subsystem.

The sibling entity **ClosedVocabularyRefinement** describes the same underlying mechanism from a complementary angle: a "filter-then-lookup" pattern rather than a generative one. Together, CodingLowerOntologySource (the data) and ClosedVocabularyRefinement (the filtering behavior) form two halves of the same design: the LLM is only ever asked to *select* from a pre-registered taxonomy, never to invent one.

## Implementation Details

Per the parent's description, the mechanics center on `loadL2Classes()` in `ontology-classification-agent.ts`, which reads `coding.lower.json` and filters its `classCatalog` by `extends` matching `REFINABLE_L1_PARENTS`. Downstream, `buildL2RefinementPrompt()` presumably constructs the LLM prompt from this filtered candidate set, and `extractL2FromLLMResponse()` parses the model's output back into a valid L2 class — with a documented fallback-to-L1 behavior when extraction is ambiguous.

This fallback design has a direct structural analog in code that *was* available: `batch-provenance.mjs`'s `selectBatchesForReport()` and `toEpoch()` functions use defensive, conservative parsing (`typeof value === 'string'`, `Number.isFinite`) and explicitly comment that "under-reporting is the safe direction" — silently returning empty results rather than throwing on missing `startTime` or `completedAt` fields. This is functionally identical in spirit to `extractL2FromLLMResponse()`'s graceful degradation to L1, even though the two live in unrelated subsystems.

## Integration Points

CodingLowerOntologySource's primary integration is upward into **L2SubsystemClassifier**, which consumes it via `loadL2Classes()` to construct its classification candidate set, and laterally into **ClosedVocabularyRefinement**, which characterizes the resulting filter-then-lookup behavior. No other code in this analysis pass references it directly — the connection is entirely inferential, established through the parent/sibling documentation rather than observed call sites. Thematically, it shares an architectural family with config/agents/opencode.sh's `_oc_splice_config` (JSON config splicing) and config/agents/pi.sh's `_pi_write_models_json` (band-mapping tables), both of which externalize valid-value vocabularies into config while keeping applicability logic in code.

## Usage Guidelines

Because the ontology is closed-vocabulary, **new L2/SubComponent types cannot be classified into existence by the LLM** — they must first be registered in `coding.lower.json` before `loadL2Classes()` will surface them as candidates. This caps hallucination risk but introduces a manual authoring step as a prerequisite for extending classification coverage. Maintainers should also be aware of the **asymmetric extension cost** pattern flagged across this codebase: editing the JSON ontology is cheap, but the eligibility gate (`REFINABLE_L1_PARENTS`) is TypeScript and requires a code change — mirroring the same tension noted in pi.sh's `thinkingLevelMap`, where maintaining two independent mapping tables risks drift. Finally, given the confirmed indexing gap (Observation 6), anyone extending or auditing this component should locate and incorporate the actual `ontology-classification-agent.ts` and `coding.lower.json` source files directly rather than relying solely on this document's inferential analysis.


## Hierarchy Context

### Parent
- [L2SubsystemClassifier](./L2SubsystemClassifier.md) -- [LLM] L2SubsystemClassifier's refinement step, as implemented via loadL2Classes() in ontology-classification-agent.ts, is architected as a closed-vocabulary lookup rather than an open classification task. It derives its candidate set by filtering registry.classCatalog to entries whose `extends` field resolves to one of REFINABLE_L1_PARENTS ('Component','SubComponent','Detail'), sourced from .data/ontologies/coding.lower.json. This means the classifier's entire universe of possible outputs (currently 10 L2 classes such as EtmDaemon, RapidLlmProxy, ConstraintMonitor) is defined declaratively in a JSON ontology file rather than being inferable or extensible by the LLM itself — a new SubComponent type cannot be classified into existence, it must first be registered in the ontology.

### Siblings
- [ClosedVocabularyRefinement](./ClosedVocabularyRefinement.md) -- [LLM] The parent context's description of loadL2Classes() establishes ClosedVocabularyRefinement as a filter-then-lookup pattern rather than a generative one: it derives its candidate set from registry.classCatalog by matching `extends` against REFINABLE_L1_PARENTS ('Component','SubComponent','Detail') in ontology-classification-agent.ts, with .data/ontologies/coding.lower.json as the sole data source for the ~10 concrete L2 classes (e.g. EtmDaemon, RapidLlmProxy, ConstraintMonitor). This design choice means the LLM is never asked to invent a taxonomy — only to select from one — which caps hallucination risk at the cost of requiring a human/ontology-authoring step before any new SubComponent type can ever appear in classification output.


---

*Generated from 9 observations*
