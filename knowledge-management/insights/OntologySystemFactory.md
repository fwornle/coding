# OntologySystemFactory

**Type:** Detail

## What It Is

OntologySystemFactory is implemented as `createOntologySystem()` in `src/ontology/index.ts`. It is the factory function that assembles the ontology system used by the Pipeline (its parent component), producing an `OntologySystem` object composed of an `ontology`, `validator`, `classifier`, and `config`. The same file also hosts a related but distinct function, `validateOntologyConfig()`, and acts as a barrel module re-exporting the full ontology submodule surface (types, `LegacyOntologyAdapter`, `OntologyValidator`, `OntologyClassifier`, etc.) via `export *`.

## Architecture and Design

The core pattern is a **factory function** that composes an **Adapter** (`LegacyOntologyAdapter`) with a **Validator** and **Classifier**, following a fixed internal dependency chain: `OntologyValidator` is constructed from the adapter, and `OntologyClassifier` is then constructed from the adapter, validator, a heuristic classifier, and the inference engine. This ordering is deliberate and preserved from the pre-refactor design, per the Phase 42-03 D-53 comment trail, specifically to avoid altering existing persistence-agent.ts call sites — a conscious narrowing of API surface rather than a redesign.

A second defining pattern is **fail-fast precondition checking**: `createOntologySystem()` refuses to construct default dependencies, requiring a caller-supplied `inferenceEngine` and a caller-constructed `LegacyOntologyAdapter`, throwing explicit errors otherwise. This pushes composition responsibility outward to callers such as persistence-agent.ts, rather than the factory silently falling back to mocks or defaults.

Notably, `validateOntologyConfig()` embodies an opposite failure-handling philosophy: it returns a soft `{valid, errors}` result object and treats a disabled config as automatically valid. The coexistence of hard-throw construction and soft accumulate-and-report validation within a single module reflects two different concerns — system wiring correctness versus configuration acceptability — rather than an inconsistency to be resolved.

## Implementation Details

`createOntologySystem()` enforces its two hard preconditions before doing any composition work, throwing explicit `Error`s when `inferenceEngine` or the adapter are missing. Once preconditions pass, it wires `OntologyValidator` from the adapter, then `OntologyClassifier` from adapter + validator + heuristicClassifier + inferenceEngine, producing the `OntologySystem` interface (`ontology`, `validator`, `classifier`, `config`). `validateOntologyConfig()` is implemented separately as a pure check function returning an errors array, used for configuration-time validation distinct from runtime construction. The module's `export *` behavior means it doubles as a barrel file, so consumers importing from `src/ontology/index.ts` get both the factory and the full type/class surface in one place.

## Integration Points

The factory sits within Ontology and under Pipeline, and its main documented caller is persistence-agent.ts, whose existing call sites shaped the preserved construction order. It depends on an externally supplied `inferenceEngine` and `LegacyOntologyAdapter` — the adapter notably preserves a legacy interface shape over a newer km-core `OntologyRegistry`, indicating a migration-in-progress underneath the factory. Three retrieved files often surfaced alongside this component — health-coordinator.js, repair-writer-ontology-class.mjs, and batch-progress.tsx — do not actually reference `createOntologySystem`, `OntologyValidator`, or `OntologyClassifier`; they are monitoring/repair/dashboard code adjacent to the pipeline's output, not real dependents. The sibling OntologyClassRepairScript (repair-writer-ontology-class.mjs) operates on ontology class arbitration independently, via its own two-path `arbitrate()` logic, with no direct coupling to this factory. Separately, an unresolved defect tracked at the Pipeline level (CodingLowerOntologySource emission bug) touches coding.lower.json, which also backs L2 refinement in ontology-classification-agent.ts — a file adjacent to, but not part of, this factory's own code.

## Usage Guidelines

Callers must construct and supply a real `inferenceEngine` and a `LegacyOntologyAdapter` before invoking `createOntologySystem()`; there is no default/mock fallback, so omitting either results in a thrown error by design. The fixed construction order (validator before classifier) should not be reordered casually, since it was intentionally preserved to keep existing persistence-agent.ts integrations working. Developers should not conflate `validateOntologyConfig()` with the factory's own precondition checks — the former is a soft, accumulate-and-report configuration check (where disabled configs are valid), while the latter is a strict, fail-fast construction gate. Because `src/ontology/index.ts` is also a barrel export, changes to internal ontology types/classes propagate directly through this file's public surface, so modifications here warrant checking downstream consumers broadly, not just the factory function itself.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Pipeline CodingLowerOntologySource Emission Bug work record documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference despite documentation saying this source type should never be produced, and ties this architecturally to coding.lower.json — the same file backing L2 refinement in ontology-classification-agent.ts, a file adjacent to but not present in this factory's retrieved code.
- The KB Injection A/B Experiment — Task Design and Discrimination Validity record establishes a planned but unimplemented merge of a viewer-executable research script with batch processing so that missing information is captured in one pass instead of sequentially, flagging that SemanticAnalysis (which the ontology system feeds) currently processes gaps sequentially — a gap not visible anywhere in the OntologySystemFactory code itself.

## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug tracks an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced.

### Siblings
- [OntologyClassRepairScript](./OntologyClassRepairScript.md) -- [LLM] scripts/repair-writer-ontology-class.mjs implements the arbitrate() function which decides ontologyClass conflicts based on graph attachment: rows reachable via 'contains'/'parent-child' relations are treated as hierarchy members whose class is taken directly from whichever of entityType/ontologyClass names a hierarchy class, while rows attached only via 'has_insight' are treated as learning artifacts and resolved to 'Insight' if they carry digest_ids/topic/decayBreakdown fields. This is a deliberate two-path arbitration rather than a single rule.


---

*Generated from 9 observations*
