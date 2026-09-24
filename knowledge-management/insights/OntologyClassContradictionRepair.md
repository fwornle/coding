# OntologyClassContradictionRepair

**Type:** Detail

## What It Is

OntologyClassContradictionRepair is implemented in `scripts/repair-writer-ontology-class.mjs`, a standalone batch script that audits and repairs already-persisted entities whose `entityType` and `ontologyClass` fields disagree about what artifact class an entity belongs to. It sits conceptually under the parent OntologyClassificationAgent — it deals with the same categorical-assignment invariant the agent's L1/L2 output depends on — but functions as a corrective, backward-looking tool rather than a forward-looking classifier. It is distinct from its sibling OntologyClassifierComposition (`src/ontology/index.ts`'s `createOntologySystem()`), which builds the live validation/classification path; this script instead cleans up rows that path could not prevent from becoming contradictory.

## Architecture and Design

The script encodes a decision-tree/strategy pattern with five distinct classifications of contradiction: `repairable`, `migratable`, `conflicts`, `foreign`, and `unknownClass`, each carrying its own resolution rule rather than one generic "fix the field" operation. This reflects a deliberate stance that a contradiction can have multiple distinct root causes, and conflating them risks incorrect repairs.

For the `conflicts` bucket, `arbitrate()` (around line ~150) rejects the tempting-but-wrong signal of `metadata.hierarchyLevel` — a self-reported field shown to be wrong on 33 of 36 sampled cases — in favor of a structural signal: `parentClassesOf(e.id)` derived strictly from `contains`/`parent-child` relations, explicitly excluding `has_insight` edges. A further refinement (deriving "one level below the parent") was tried and rejected because it would have mispromoted 385 legitimate Project→Detail edges into synthetic Components — a concrete documented trade-off favoring conservatism over cleverness.

Safety is enforced through a dry-run-by-default execution model, gated by an explicit `--apply` flag, and a separate `--all` flag that only widens *reporting* scope (to include `foreign`/`unknownClass` rows) without ever widening the *write* scope, which remains fixed at `repairable + migratable + conflicts`. This split between "what I show you" and "what I change" is itself a design reaction to the original incident this script targets.

## Implementation Details

`WRITER_OWNED = {'Observation','Digest'}` scopes the `repairable` path to the exact blast radius of a known historical bug: ObservationWriter overwrote `ontologyClass` to `'Detail'` on every Observation (from 2026-06-11) and every Digest, until the rewrite was removed on 2026-09-20. This constant is not an arbitrary default but a precise fingerprint of that incident, and the script's non-`--all` mode intentionally avoids touching classification drift from other producers (L2 consolidator, wave path) without human review.

The `migratable` path handles cases where `ontologyClass` names a real artifact class but `entityType` holds a non-class tag (an L2 subsystem name, an upper-ontology descriptor, or an unregistered label like `'TransferablePattern'`) — the tag is preserved into `metadata.subsystem` rather than discarded, then `entityType` is set to match `ontologyClass`.

Ontology authority comes from `loadParentMap()`, which reads the curated `.data/ontologies/obs-api/*.json` registry chain (upper.json → coding-ontology.json → coding.lower.json), and `chainOf()`, which walks `parent.get(cls)` via `body?.extends ?? body?.parent` to perform IS-A ancestor checks. A contradiction is defined strictly as "entityType is not `oc` and `oc` is not an ancestor of entityType in this registry" — a precise, registry-grounded definition rather than a fuzzy heuristic.

All entity/relation access goes through a thin `api()` fetch wrapper against `OBS_API` (`process.env.OBS_API_URL || 'http://localhost:12436'`), using `GET /api/v1/entities?limit=100000` and `GET /api/v1/relations?limit=1000000`, with writes presumably issued via PUT/PATCH on the same API.

## Integration Points

The script never opens km-core's LevelDB directly, respecting the system-wide rule that obs-api is the single-owner writer/reader of that store — avoiding write-amplification or corruption risk that direct access from auxiliary tools would introduce. Its ontology authority is shared with the classification pipeline: `loadParentMap()` consumes the same three-file registry chain that `OntologyRegistry` resolves for the classification agent, meaning repair and classification agree on what counts as a legal ancestor relationship even though the code paths never call each other directly.

Structurally, it complements `src/ontology/index.ts`'s `createOntologySystem()`, which assembles `OntologyValidator(adapter)` and a hybrid heuristic/LLM `OntologyClassifier` with no mock fallback. That validator is the forward gate meant to prevent contradictions from entering the store; this script exists because that gate either post-dates the ObservationWriter incident or was bypassed by its direct overwrite, leaving a population of already-bad rows the validator can no longer reach. The two subsystems address the same invariant at different pipeline stages and do not interact in code.

## Usage Guidelines

Run the script in its default dry-run mode first; only pass `--apply` once the reported repair set has been reviewed. Use `--all` purely to surface `foreign`/`unknownClass` rows for human triage — it will never cause those rows to be written. Do not expand `WRITER_OWNED` casually; it is a historical fingerprint, not a general allowlist, and broadening it reintroduces the risk of unscoped rewrites that caused the original incident. When contradictions can't be confidently resolved (the `foreign`/`unknownClass` buckets), the script's philosophy is to report and refuse to guess rather than silently overwrite — this convention should be preserved in any future extension of the repair logic.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per the parent record 'Pipeline CodingLowerOntologySource Emission Bug' and the sibling record on ObservationWriter, the specific historical defect this script exists to clean up is: ObservationWriter overwrote ontologyClass to 'Detail' on every Observation (from 2026-06-11) and every Digest, a rewrite removed on 2026-09-20. `WRITER_OWNED`'s scoping to exactly `{'Observation','Digest'}` is therefore not an arbitrary safety default but a precise fingerprint of that one incident — the script's default (non `--all`) mode repairs only the blast radius of that specific known bug and explicitly declines to touch classification drift from other producers (the L2 consolidator, the wave path) without a human decision.

## Hierarchy Context

### Parent
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation establishes that intent-derived taxonomies produced by SemanticAnalysisAgent were validated for stability by re-deriving the taxonomy independently from disjoint data samples and measuring agreement between the two derivations, rather than by inspecting a single run's output. This methodology exists because the taxonomy serves as a fixed 'spine' for downstream KB stages — instability would propagate structural drift into every consumer that depends on the taxonomy being held fixed, so reproducibility across disjoint samples was treated as a precondition for freezing the spine rather than an optional sanity check. This bears on OntologyClassificationAgent because its L1/L2 output is exactly the kind of categorical assignment such a spine depends on staying stable run-to-run.

### Siblings
- [OntologyClassifierComposition](./OntologyClassifierComposition.md) -- [LLM] The retrieved files do not contain an entity named OntologyClassifierComposition; the closest match is src/ontology/index.ts's createOntologySystem() factory, which composes OntologyValidator, OntologyClassifier, a heuristic classifier, and an inferenceEngine into an OntologySystem object. This is a general-purpose assembly module for the ontology subsystem, not the specific 'composition' entity being analyzed, and no ontology-classification-agent.ts, base-agent.ts, or L1/L2 refinement functions appear anywhere in the supplied code.


---

*Generated from 10 observations*
