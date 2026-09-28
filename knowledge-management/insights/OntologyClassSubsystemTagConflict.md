# OntologyClassSubsystemTagConflict

**Type:** Detail

# OntologyClassSubsystemTagConflict

## What It Is

`OntologyClassSubsystemTagConflict` names a defect/conflict class in the knowledge-graph ontology pipeline: entities whose `ontologyClass` and `entityType` fields disagree, either because a non-artifact value (an L2 subsystem tag like `AgentIntegration`, an upper-ontology descriptor like `Process`/`File`, or an unregistered label like `TransferablePattern`) has leaked into `ontologyClass`, or because both fields name legitimate but conflicting artifact classes. Its concrete remediation lives in `scripts/repair-writer-ontology-class.mjs`, even though that file's name doesn't textually match the component — the script is the literal implementation of detecting and repairing this conflict class. As a child of `L2SubsystemClassifier`, it is tightly coupled to that parent's defect record: the unresolved `CodingLowerOntologySource` emission bug is the most direct symptom of this conflict class going unchecked, since the classifier is supposed to prevent that value from ever reaching `ontologyClass`.

## Architecture and Design

The design rests on two distinguishable resolution strategies, defined by which kind of conflict is present. The `migratable` case handles a tag-in-wrong-field problem: when `ontologyClass` holds a value outside the `ARTIFACT_CLASSES` set (`scripts/repair-writer-ontology-class.mjs:66-76`, covering System/Project/Component/SubComponent/Detail/Observation/Digest/Insight and their Online* variants) while `entityType` holds a valid class, the tag is relocated to `metadata.subsystem` and `entityType`'s value is promoted into `ontologyClass`. This is a "migration-not-loss" pattern — the offending value isn't discarded, just moved into an open metadata bag where it belongs.

The harder case, `conflicts`, is handled by `arbitrate(e, parentClasses)`, which uses **edge-derived arbitration**: instead of trusting either field or a metadata attribute, it inspects the structural relation by which the entity was reached. A `contains`/`parent-child` edge implies membership in the hierarchy family (`Project`/`Component`/`SubComponent`/`Detail`), and whichever field already holds a `HIERARCHY_SET` value wins; a `has_insight` edge implies a learning artifact and forces resolution toward `Insight`. This choice was empirically justified in the code comments: across 43 conflicting rows, `metadata.hierarchyLevel` disagreed with the attaching edge in 13 of 36 disagreements, disqualifying it as a reliable arbiter.

A third design decision is scoping: the script explicitly declines to repair every violation it can see. Its header comment names a known producer outside its ownership — "the consolidator stamping an L2 subsystem into entityType while ontologyClass stays 'Insight'" — and reports such cases only under `--all`, deferring to human judgment rather than guessing.

## Implementation Details

The core loop classifies entities into `migratable`, `conflicts`, or `repairable` buckets by comparing `ontologyClass` against `ARTIFACT_CLASSES`. `arbitrate()` is the decision function for genuine artifact-vs-artifact disagreements, keyed on relation type and detecting learning artifacts via `metadata` shape (`digest_ids`, `decayBreakdown`, `topic`) to distinguish `Insight` from `Detail`. The script is a **thin HTTP client**: it never touches LevelDB directly, operating solely through obs-api's `/api/v1/entities` and `/api/v1/relations` endpoints, keeping the datastore single-owner.

Upstream, `src/ontology/index.ts`'s `createOntologySystem()` assembles `OntologyValidator`, `OntologyClassifier`, and `LegacyOntologyAdapter`, with hard `throw`-on-missing-dependency preconditions and no mock fallback. This factory is the presumed origin of `ontologyClass`/`entityType` values but contains no conflict-detection or repair logic itself — it is strictly upstream wiring, architecturally separate from the repair script.

## Integration Points

This conflict class sits between two ownership layers of the same pipeline: class *assignment* (`src/ontology/index.ts`, in-process LLM+heuristic classification) and class *conflict repair* (`scripts/repair-writer-ontology-class.mjs`, out-of-process HTTP-based remediation). `ontologyClass` correctness is a cross-cutting invariant consumed by at least two named downstream systems: the viewer's `visibility-predicate.ts` class filter, and roll-up candidate selection in the Insight Roll-up Pipeline (parent's sibling work), which reasons over `ontologyClass` when clustering over-granular observations into synthesized parents — a row contaminated by a subsystem tag would be silently mis-included or excluded from that clustering. Retrieval noise around this component is notable: `batch-progress.tsx`, `health-coordinator.js`, and `health-coordinator-etm-expected.test.mjs` show no genuine connection despite filename proximity, confirming they are unrelated UI/daemon/test code.

## Usage Guidelines

Repairs should remain asymmetric by design: auto-fix only unambiguous cases (`WRITER_OWNED` classes, or one field clearly holding a non-artifact tag), and defer to human review via `--all` whenever two legitimate artifact classes conflict with no resolving structural edge. Do not use `metadata.hierarchyLevel` as an arbiter — it was empirically rejected. Any new producer that writes subsystem-derived values into `entityType` or `ontologyClass` (as the consolidator is known to do) should be brought into `WRITER_OWNED` scope deliberately, not silently patched over, since the script's correctness depends on precise ownership boundaries rather than blanket repair.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Pipeline CodingLowerOntologySource Emission Bug: the classifier is meant to prevent CodingLowerOntologySource from ever being emitted, tying this L2 component directly to the ontologyClass/entityType conflict class the repair script documents.
- The parent's work record on the Insight Roll-up Pipeline states it 'reduces knowledge-graph node count by clustering over-granular but individually-valid observations into synthesized parent summaries, archiving children reversibly rather than deleting them' — this is the consumer-side motivation for keeping `ontologyClass` trustworthy: roll-up candidate selection reasons over class, so a row whose `ontologyClass` is contaminated by a subsystem tag (the exact defect this component is named for) would be silently excluded from or wrongly included in clustering.

## Hierarchy Context

### Parent
- [L2SubsystemClassifier](./L2SubsystemClassifier.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug is the unresolved defect most directly attributable to this component's L2 refinement design, since the classifier is meant to prevent CodingLowerOntologySource from ever being emitted.


---

*Generated from 10 observations*
