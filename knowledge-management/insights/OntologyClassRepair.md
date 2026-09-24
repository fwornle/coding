# OntologyClassRepair

**Type:** Detail

## What It Is

OntologyClassRepair is implemented in `scripts/repair-writer-ontology-class.mjs`, an offline, standalone Node script (not a class or runtime service) that enforces a single data invariant across already-persisted rows: `ontologyClass` must equal `entityType` or one of its ancestors as defined in the ontology registry. It sits conceptually under `Ontology` and near `SemanticAnalysisAgent` in the component hierarchy, but architecturally it is a post-hoc repair tool, sharply distinct from its sibling `OntologySystemFactory` (`src/ontology/index.ts`'s `createOntologySystem()`), which handles live, LLM-backed runtime classification.

## Architecture and Design

The script is built around registry-driven ancestor-chain (IS-A) validation. `loadParentMap()` reads every JSON file under `.data/ontologies/obs-api/` and extracts `body.extends ?? body.parent` to build a `Map<className, parentName>`. `chainOf(cls, parent)` then walks this map upward, cycle-safe via a `seen` set, and legality is simply `chainOf(entityType, parent).includes(ontologyClass)`.

A second key pattern is edge-attachment-as-tiebreaker arbitration: when both `entityType` and `ontologyClass` name valid `ARTIFACT_CLASSES` members (System/Project/.../Insight), `arbitrate()` resolves the conflict by consulting the graph edge attaching the row (`contains`/`parent-child` vs `has_insight`) rather than trusting `metadata.hierarchyLevel`. This decision is empirically justified in the file's own doc comment: an audit of 36 disagreeing cases found hierarchyLevel correct only 3 times versus 13 for ontologyClass-implied topology — hierarchyLevel is treated as "a claim," the graph edge as "a fact."

The remediation strategy is a bucketed, non-uniform response rather than a single repair rule: `repairable`, `migratable`, `conflicts`, and `foreign` are computed as disjoint buckets in the main scan loop, with `foreign` deliberately left unrepaired for human judgment.

## Implementation Details

`WRITER_OWNED = {Observation, Digest}` rows are unambiguously repairable by overwriting `ontologyClass := entityType`. `migratable` rows are those where `entityType` holds a non-artifact tag (an L2 subsystem name or `'TransferablePattern'`); these get their tag moved into `metadata.subsystem` before `entityType` is overwritten with the correct class. `conflicts` are two-artifact-class disagreements resolved via `arbitrate()`. `foreign` rows are reported (counted or enumerated depending on `--all`) but never auto-repaired, since per the header comment "those need their own decision about which field is wrong."

The script is explicitly a "THIN CLIENT": it never touches the underlying LevelDB store directly. All reads and writes go through `api()`, a thin `fetch` wrapper against `OBS_API_URL` (default `http://localhost:12436`), using `GET /api/v1/entities?limit=100000` and `GET /api/v1/relations?limit=1000000` to build the full working set in memory before making any repair decision.

Safety is enforced via CLI flags: dry-run is the default, and only `args.has('--apply')` permits writes; `--all` independently controls whether `foreign`/`unknownClass` buckets are reported in full or just counted — mirroring the dry-run-by-default convention documented elsewhere in the repo's CLAUDE.md for other repair/purge scripts.

## Integration Points

OntologyClassRepair's sole data dependency is obs-api (`:12436`), the single read/write gateway for entity and relation data — it never opens the underlying store directly. Its class-legality notion is kept in sync with the live validator because it loads the same `.data/ontologies/obs-api/*.json` directory that obs-api itself reads via `KG_ONTOLOGY_DIR`.

It coexists with, but is fully decoupled from, `src/ontology/index.ts`'s `createOntologySystem()` (mapped to sibling `OntologySystemFactory`), which wires a required `inferenceEngine`, `LegacyOntologyAdapter`, and `OntologyValidator`/`OntologyClassifier` for runtime classification, throwing hard errors if either dependency is missing ("NO MOCK FALLBACK"). OntologyClassRepair has no LLM or classifier dependency at all — it operates purely on persisted rows after the fact.

A related, unresolved defect is tracked in the "Pipeline CodingLowerOntologySource Emission Bug" session: the SemanticAnalysis pipeline emits a `CodingLowerOntologySource` reference that documentation says must never occur, with suspected fault near coding.lower.json consumption in OntologyClassificationAgent or its upstream producers. This is not part of OntologyClassRepair itself but is a live known-bad signal in the broader ontology space that should not be mistaken for correct behavior.

## Usage Guidelines

Always run without `--apply` first to review the `repairable`/`migratable`/`conflicts`/`foreign` bucket counts before committing writes; use `--all` when a full line-by-line audit of unresolved `foreign`/`unknownClass` rows is needed rather than just totals. Do not expect this script to resolve `foreign` conflicts — those require a manual decision about which field (entityType vs ontologyClass) is actually wrong. Because arbitration deliberately distrusts `metadata.hierarchyLevel`, any future changes to conflict resolution logic should preserve edge-topology as the source of truth unless a new audit contradicts the existing one embedded in the script's comments. Finally, this script should never be conflated with `createOntologySystem()`/`OntologySystemFactory` — they solve different problems (offline repair vs. live classification) and neither depends on the other.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Pipeline CodingLowerOntologySource Emission Bug' work record documents an unresolved, live defect where the SemanticAnalysis pipeline emits a `CodingLowerOntologySource` reference despite project documentation stating this source type must never be produced, with the likely fault zone identified near coding.lower.json consumption in OntologyClassificationAgent or its upstream producers — a discrepancy between documented invariants and observed behavior that a developer touching that path should treat as known-bad, not as evidence the current code is correct.

## Hierarchy Context

### Parent
- [SemanticAnalysisAgent](./SemanticAnalysisAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation validates that an intent-derived taxonomy produced from SemanticAnalysisAgent-adjacent processing is stable and reproducible by re-deriving it independently from disjoint data samples.

### Siblings
- [OntologySystemFactory](./OntologySystemFactory.md) -- [LLM] src/ontology/index.ts's createOntologySystem() is the factory function this component almost certainly maps to, despite the name mismatch with 'OntologySystemFactory': it takes a config, a required inferenceEngine, and a required LegacyOntologyAdapter, and explicitly throws two distinct errors ('createOntologySystem requires an inferenceEngine...' and 'createOntologySystem requires a LegacyOntologyAdapter...') rather than silently defaulting either dependency. The doc comment is explicit that there is 'NO MOCK FALLBACK' for the inference engine — callers must supply a real LLM engine from SemanticAnalyzer, making the factory a hard construction gate rather than a convenience wrapper.


---

*Generated from 10 observations*
