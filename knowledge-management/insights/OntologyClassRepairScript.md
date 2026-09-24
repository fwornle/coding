# OntologyClassRepairScript

**Type:** Detail

## What It Is

OntologyClassRepairScript is implemented at `scripts/repair-writer-ontology-class.mjs` as a standalone Node CLI tool within the km-core knowledge graph ecosystem. It repairs rows in the graph whose `ontologyClass` field contradicts their `entityType` field — a data-integrity defect traced to a historical bug in `ObservationWriter`. It sits under the Pipeline component hierarchically, and is thematically adjacent to a related but distinct defect documented in the "Pipeline CodingLowerOntologySource Emission Bug" work record, which describes an upstream, still-live tagging-logic mismatch in the SemanticAnalysis pipeline. Where that bug concerns what the pipeline emits going forward, OntologyClassRepairScript concerns cleaning up what has already been persisted.

## Architecture and Design

The script embodies several deliberate architectural choices. First, it is a thin HTTP client rather than a storage-layer tool: its header comment explicitly states the km-core LevelDB is single-owner (obs-api), so "this process never opens the store." All reads and writes go through `api(pathname, init)`, a fetch wrapper hitting `OBS_API` (default `http://localhost:12436`), pulling entities and relations via `/api/v1/entities` and `/api/v1/relations` before any repair and writing changes back through the same surface.

Second, it uses rule-based arbitration keyed off structural graph edges rather than self-reported metadata. `arbitrate(e, parentClasses)` prefers `hierarchyParents` — derived strictly from `contains`/`parent-child` relations, excluding `has_insight` — over `metadata.hierarchyLevel`, because the code's own analysis found hierarchyLevel disagreed with true class in 13 of 36 rows versus 3 for structural edges.

Third, it classifies violations into four disjoint buckets, each with a narrowly scoped fix: `repairable` (WRITER_OWNED classes Observation/Digest, fixed by `ontologyClass := entityType`), `migratable` (non-artifact tags moved into `metadata.subsystem`), `conflicts` (resolved via `arbitrate()`), and `foreign` (reported only, never auto-fixed). This reflects a scope-discipline pattern: fix only what one identified bug produced, and refuse to guess about anything else.

## Implementation Details

`loadParentMap()` reads every JSON file under `.data/ontologies/obs-api/` and builds a flat class-to-parent map from each class's `extends`/`parent` field. `chainOf(cls, parent)` walks this map to build a cycle-safe ancestor chain, guarded by a `seen` Set. A row is treated as a legal IS-A relationship — and thus skipped — only when both fields are registered classes AND `chainOf(entityType, parent)` includes `ontologyClass`.

Classification constants `ARTIFACT_CLASSES` (System/Project/Component/SubComponent/Detail/Observation/Digest/Insight and Online* variants), `WRITER_OWNED`, and `HIERARCHY_CLASSES`/`HIERARCHY_SET` drive the bucket split. `tally()` groups violations by `entityType → ontologyClass` pairs and sorts by count for reporting.

Safety is enforced via `process.argv` parsed into a `Set`: `APPLY = args.has('--apply')` gates all writes (default is dry-run/report-only), and `ALL = args.has('--all')` additionally surfaces `foreign` and `unknownClass` violations that are otherwise suppressed.

## Integration Points

The sole integration point is obs-api's HTTP surface — no direct dependency on km-core's persistence internals. This mirrors the pattern seen in sibling component OntologySystemFactory (`src/ontology/index.ts`'s `createOntologySystem()`), though that factory operates as a composition root wiring `OntologyValidator`/`OntologyClassifier` in-process rather than over HTTP; both share reliance on the same underlying ontology concepts (registry, classes, hierarchy) but at different architectural layers. The script's correctness also depends on the ontology registry under `.data/ontologies/obs-api/` being stable ground truth — a stability claim substantiated separately by the "Taxonomy Stability Validation via Disjoint Sample Re-derivation" work, which validated taxonomy reproducibility via disjoint-sample re-derivation before such tooling could safely trust it.

## Usage Guidelines

Run without `--apply` first — the default dry-run mode only prints tallies and exits 0, performing no writes. Use `--all` to surface `foreign` and `unknownClass` violations for manual triage; these are intentionally never auto-repaired since determining which field is wrong requires separate judgment. Only `Observation`/`Digest` rows are auto-repaired by default, reflecting narrow, bug-scoped remediation rather than general-purpose ontology cleanup. If upstream defects like the CodingLowerOntologySource emission bug remain unresolved, expect continued `foreign`/`unknownClass` residue that this script will report but deliberately not fix.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Pipeline CodingLowerOntologySource Emission Bug tracks an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced, indicating the pipeline's source-tagging logic disagrees with its own contract — the same class of documentation-vs-emission mismatch this repair script targets for ontologyClass/entityType.
- The work record 'Pipeline CodingLowerOntologySource Emission Bug' documents an unresolved, separate defect: the SemanticAnalysis pipeline emits a `CodingLowerOntologySource` reference near `coding.lower.json` consumption despite documentation stating that source type should never be produced. This is adjacent to, but distinct from, OntologyClassRepairScript's concern — the repair script arbitrates `ontologyClass`/`entityType` conflicts on already-persisted rows, while this record describes a live tagging-logic bug upstream in the pipeline that writes those rows in the first place; the repair script's `foreign`/`unknownClass` buckets are the kind of residue such an upstream bug could still be producing.
- The work record 'Taxonomy Stability Validation via Disjoint Sample Re-derivation' establishes that intent-derived taxonomies were validated by independently re-deriving them from disjoint data samples and measuring agreement, treating reproducibility as a precondition for freezing the taxonomy as a fixed downstream spine. This bears on OntologyClassRepairScript's correctness assumption: `loadParentMap()`/`chainOf()` treat the curated registry under `.data/ontologies/obs-api/` as a stable ground truth for legality checks, and that stability claim is exactly what the disjoint-sample validation was meant to establish before any repair tooling could safely trust it.

## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug tracks an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in its output despite documentation stating this source type should never be produced, indicating a mismatch between the pipeline's source-tagging logic and its own contract.

### Siblings
- [OntologySystemFactory](./OntologySystemFactory.md) -- [LLM] src/ontology/index.ts contains createOntologySystem(), an async factory that wires OntologyValidator, OntologyClassifier, createHeuristicClassifier(), and a caller-supplied LegacyOntologyAdapter around a km-core OntologyRegistry. This is the actual 'OntologySystemFactory' implementation in the retrieved code, but it is a composition-root utility, not part of any Pipeline five-stage lifecycle (process/calculateConfidence/detectIssues/generateRouting/applyCorrections) attributed to the parent component.


---

*Generated from 11 observations*
