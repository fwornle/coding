# OntologyClassRepairScript

**Type:** Detail

## What It Is

OntologyClassRepairScript is implemented at `scripts/repair-writer-ontology-class.mjs`. It is an operator-run CLI auditing tool that fetches entities and relations from obs-api via `/api/v1/entities` and `/api/v1/relations`, builds an ancestor chain per `entityType` using `loadParentMap()` (sourced from `.data/ontologies/obs-api/`), and classifies each row as repairable, migratable, conflicting, foreign, or unknownClass. It exists specifically to clean up rows written during a documented historical bug window where ObservationWriter forcibly overwrote `ontologyClass` to `'Detail'` on every Observation and Digest row.

## Architecture and Design

The script is a thin HTTP client, explicitly never opening the km-core LevelDB store directly — "this process never opens the store" — reinforcing a single-writer architecture where obs-api is the sole reader/writer of the ontology-backed entity store. This mirrors patterns seen elsewhere (e.g., `scripts/health-coordinator.js`'s currentState pattern) and reflects the broader Architecture Notes principle that ontology-class correctness is validated post-hoc rather than enforced at write time (the putEntity IS-A guard is noted as "not yet landed").

Its arbitration design is notable: `arbitrate()` resolves conflicting artifact-class claims not by trusting `metadata.hierarchyLevel` (empirically wrong 13/36 times) but by consulting the attaching relation type — 'contains'/'parent-child' edges imply hierarchy membership (resolved via HIERARCHY_SET), while 'has_insight' edges imply learning artifacts, classified as 'Insight' when carrying digest_ids/decayBreakdown/topic fields. This is arbitration via graph edge type rather than field-value trust — a deliberate rejection of a metadata field known to be unreliable.

The script is dry-run-by-default, gated by an `APPLY` flag, with `tally()`/`arbitrate()` producing reports rather than silent fixes — consistent with the broader system convergence (also seen in Agentic Ontology Cleanup) on reporting ambiguous ontology drift for human decision rather than auto-fixing it.

## Implementation Details

Key constructs include `WRITER_OWNED` (`{'Observation','Digest'}`), which encodes the entity types affected by the historical overwrite bug (active 2026-06-11 to 2026-09-20, tied to `visibility-predicate.ts:144` checking both `ontologyClass` and `entityType`). `loadParentMap()` builds the ancestor chain for IS-A validation against the curated obs-api ontology directory — a flattened registry-driven structure. `arbitrate()` implements the edge-type-based conflict resolution described above. The CLI supports three invocation modes: dry run, `--all` (report all violations including "foreign"/other-producer classes), and `--apply` (write).

## Integration Points

As a child of Ontology, it operates against the same ontology directory referenced by the parent context (`KG_ONTOLOGY_DIR`, also used in observations-api-server.mjs). It depends entirely on obs-api's HTTP surface rather than sharing code with sibling components like OntologySystemFactory (`src/ontology/index.ts`'s `createOntologySystem()`, with its hard DI contract) or LegacyOntologyAdapter. Notably, the script currently operates against a flattened ontology view, not yet reflecting the two-tier upper/lower model that `validateOntologyConfig()` enforces structurally and that VKB Ontology's Two-Tier Architecture design describes — a known architectural gap.

## Usage Guidelines

Always run in dry-run mode first; use `--all` to surface foreign/unknown-class violations for human review rather than assuming automatic repair is safe. Only use `--apply` once arbitration output has been manually verified, since edge-type-based classification is heuristic. Because the script is a thin HTTP client, it must never be modified to open LevelDB directly — that would violate the single-owner invariant. When the two-tier ontology work lands, `loadParentMap()` will need updating to consume upper/lower tiers rather than the flat obs-api directory.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- The script is explicitly a thin HTTP client — 'the km-core LevelDB is single-owner (obs-api); this process never opens the store' — meaning it never touches ontology (method) in GraphKMStore.ts directly, reinforcing the single-writer architecture also seen in scripts/health-coordinator.js's currentState pattern.

**Other:**
- scripts/repair-writer-ontology-class.mjs is the actual OntologyClassRepairScript: it fetches entities and relations from obs-api via /api/v1/entities and /api/v1/relations, builds an ancestor chain per entityType using loadParentMap() sourced from .data/ontologies/obs-api/ (the same KG_ONTOLOGY_DIR referenced in observations-api-server.mjs per the parent context), and classifies each row as repairable, migratable, conflicting, foreign, or unknownClass.
- The script's WRITER_OWNED set ({'Observation','Digest'}) encodes a historical bug: ObservationWriter forcibly overwrote ontologyClass to 'Detail' on every Observation and Digest row starting 2026-06-11 until that rewrite was removed 2026-09-20, once the viewer's predicate began checking both ontologyClass and entityType (visibility-predicate.ts:144, cited in the script's own docstring) — the script exists specifically to clean up rows written during that window.
- arbitrate() resolves conflicts between two artifact-class claims not by trusting metadata.hierarchyLevel (empirically wrong 13/36 times per the comment) but by consulting the attaching relation type: rows connected via 'contains'/'parent-child' are hierarchy members and take whichever field names a HIERARCHY_SET class, while rows attached only by 'has_insight' are learning artifacts and get 'Insight' if they carry digest_ids/decayBreakdown/topic signature fields.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Agentic Ontology Cleanup documents verification/removal of stale ontology files no longer referenced in the codebase, which aligns with this repair script's --all flag reporting 'other producers' (foreign) violations from the consolidator and wave path rather than silently guessing at them — both processes converge on the same principle of reporting ambiguous ontology drift for human decision rather than auto-fixing it.
- VKB Ontology — Two-Tier Architecture's planned split of a flat ontology into upper (generic) and lower (project-scoped) tiers is the same two-tier model that src/ontology/index.ts's validateOntologyConfig() enforces structurally (upperOntologyPath required when enabled, lowerOntologyPath required once a team is set) — the repair script's loadParentMap() only reads the curated obs-api ontology directory, so it currently operates against a flattened view rather than the two-tier model under design.

## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- [CGR] ontology (variable) in events.test.ts

### Siblings
- [OntologySystemFactory](./OntologySystemFactory.md) -- [LLM+CGR] src/ontology/index.ts's createOntologySystem() is the actual OntologySystemFactory: it takes an OntologyConfig, a required UnifiedInferenceEngine, and a required LegacyOntologyAdapter, and throws explicit errors ('createOntologySystem requires an inferenceEngine...' / 'createOntologySystem requires a LegacyOntologyAdapter...') if either is missing, rather than silently substituting a mock. This is a hard DI contract enforced at construction time.
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- [CGR] LegacyOntologyAdapter (class) in LegacyOntologyAdapter.ts


---

*Generated from 10 observations*
