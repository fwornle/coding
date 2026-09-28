# OntologyClassRepairScript

**Type:** Detail

## What It Is

OntologyClassRepairScript is implemented at `scripts/repair-writer-ontology-class.mjs`. It is a standalone CLI utility that detects and corrects disagreements between an entity's `ontologyClass` and `entityType` fields as persisted through obs-api. It does not open the km-core LevelDB store directly; the header comment states explicitly that "the km-core LevelDB is single-owner (obs-api). Every read and write goes over HTTP; this process never opens the store." All access flows through obs-api's `/api/v1/entities` and `/api/v1/relations` endpoints via an internal `api()` helper wrapping `fetch()`.

Within the hierarchy, it sits under both Pipeline and Ontology, and is a child of OntologyClassificationAgent — a relationship that is organizational rather than code-coupled, since the script corrects data after the fact rather than participating in live classification. Its sibling, OntologySystemFactory (`src/ontology/index.ts`'s `createOntologySystem()`), wires together the live classification stack (LegacyOntologyAdapter, OntologyValidator, OntologyClassifier, heuristic classifier); OntologyClassRepairScript instead operates externally and after the fact on whatever that stack (or its predecessor) has already written.

## Architecture and Design

The script's central architectural decision is the single-writer boundary: obs-api owns the LevelDB store, and this script is a thin HTTP client over it, never bypassing that ownership. This mirrors the same boundary that the parent's LegacyOntologyAdapter/OntologyRegistry references presuppose.

A second pattern is registry-as-<COMPANY_NAME_REDACTED>: rather than hardcoding a class hierarchy, `loadParentMap()` (lines 78-92) reads every `.json` file under `.data/ontologies/obs-api/`, building a `Map<className, parentOrNull>` from `body?.extends ?? body?.parent`. `chainOf()` (lines 96-105) then walks ancestors self-first with cycle protection via a `seen` Set. Legality checks defer to this loaded chain — `if (known && chainOf(et, parent).includes(oc)) continue;` — rather than encoding hierarchy assumptions in the script itself, echoing the parent's REFINABLE_L1_PARENTS/`extends` discussion.

Third, `arbitrate()` (lines 165-195) demonstrates topology-driven arbitration: when two fields both name a legitimate artifact class (e.g., 'Insight' vs 'Detail'), the script inspects `contains`/`parent-child` relation edges (deliberately excluding `has_insight`) to determine whether the row is a structural hierarchy member or a free-hanging artifact, then classifies using `HIERARCHY_SET` membership or the 'Insight signature' (`digest_ids`/`topic`/`decayBreakdown`). Notably, the authors rejected a simpler alternative — inferring class as one level below the parent — after empirical validation surfaced 385 legitimate `Project -contains-> Detail` edges that would have caused false promotions.

Fourth is scoped auto-repair: `WRITER_OWNED = new Set(['Observation', 'Digest'])` (line 63) limits automatic correction to exactly the two classes known to have been corrupted by a since-removed ObservationWriter rewrite. Everything else discovered (`migratable`, `conflicts`, `foreign`, `unknownClass`) is either transformed under an explicitly justified separate rule or reported-only when `--all` is passed — a deliberate refusal to guess.

Finally, dry-run-by-default control flow: `APPLY = args.has('--apply')` (lines 37-39) gates all mutation, defaulting to a tally-and-report path via `tally()`/`out()`/`die()`. The `--all` flag independently widens reporting scope without affecting what gets written, keeping "see everything" and "change something" orthogonal — consistent with the fail-fast posture attributed to `createOntologySystem()` in `src/ontology/index.ts:86-107`.

## Implementation Details

The script's core data structures are: the `WRITER_OWNED` allowlist, the `parentMap`/`chainOf` ancestor-walking pair, and `arbitrate()`'s relation-driven decision function. `loadParentMap()` builds its map from raw JSON ontology definition files rather than importing any shared registry module, meaning the hierarchy is reconstructed fresh on every run instead of cached or shared with the live classification stack. `chainOf()`'s self-first walk with cycle protection allows legality checks to treat any row whose `ontologyClass` is a genuine ancestor of its `entityType` as already correct.

`arbitrate()` is the most complex function, resolving artifact-vs-artifact conflicts by querying `hierarchyParents` computed from `contains`/`parent-child` edges while explicitly excluding `has_insight` edges, since those don't represent structural containment. The inline comment documents the empirical counter-evidence (385 `Project -contains-> Detail` edges) that ruled out a simpler depth-based heuristic.

Control flow is governed by two flags read near the top of the script (lines 37-39): `APPLY` and `ALL`. The write path (truncated in supplied excerpts) tracks `ok`/`failures` counters, while the default reporting path uses `tally()` and console helpers `out()`/`die()`.

## Integration Points

The script's only external dependency is obs-api's HTTP surface (`OBS_API`, defaulting to `http://localhost:12436`), consumed through entities and relations endpoints. It also reads ontology definition files directly from `.data/ontologies/obs-api/*.json`, coupling it to that file layout rather than to any shared TypeScript module — this is a deliberate decoupling from `src/ontology/index.ts`'s `createOntologySystem()` and its wired components (LegacyOntologyAdapter, OntologyValidator, OntologyClassifier).

Because `arbitrate()` depends on relation data (contains/parent-child edges), the script is coupled to the graph's relation store in addition to its entity store — an integration surface beyond simple entity CRUD.

It is explicitly documented as distinct from the parent's "Pipeline CodingLowerOntologySource Emission Bug" work: that concern is about what the pipeline produces going forward (coding.lower.json → OntologyRegistry path), whereas this script corrects already-persisted disagreements after the fact. Nothing in `repair-writer-ontology-class.mjs` references `CodingLowerOntologySource`, and the two should not be conflated.

## Usage Guidelines

Run without `--apply` first — the default mode only tallies and reports, never mutates. Use `--all` independently to widen the *report* surface to non-writer-owned classes (`migratable`, `conflicts`, `foreign`, `unknownClass`) without risking wider writes, since `--all` never affects what gets applied. Only classes in `WRITER_OWNED` (`Observation`, `Digest`) are auto-repaired; anything else surfaced by the scan requires manual judgment or a separately justified rule — do not extend `WRITER_OWNED` casually, since its scope is tied to a specific, documented historical corruption source (the removed ObservationWriter rewrite), not general applicability. When extending `arbitrate()`'s logic, validate any new heuristic against real relation data first, following the precedent that ruled out the parent-depth-minus-one shortcut.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The parent's 'Pipeline CodingLowerOntologySource Emission Bug' work record describes an unresolved contradiction in the L2 source contract, and this repair script is a complementary but distinct concern: it corrects already-persisted `ontologyClass`/`entityType` disagreements after the fact, whereas the emission bug concerns what the pipeline produces going forward. Nothing in repair-writer-ontology-class.mjs references CodingLowerOntologySource or the coding.lower.json → OntologyRegistry path, so the two should not be conflated even though both touch ontology-class correctness.

## Hierarchy Context

### Parent
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- [SESSION] Coding Ontology — Intent Class Addition is scoped as a distinct ontology-file investigation, separate from classification agent logic but affects what classes this agent can assign.

### Siblings
- [OntologySystemFactory](./OntologySystemFactory.md) -- [LLM] src/ontology/index.ts is the actual OntologySystemFactory: the exported async function createOntologySystem(config, inferenceEngine, adapter) constructs and wires together LegacyOntologyAdapter, OntologyValidator, OntologyClassifier, and a heuristic classifier (via createHeuristicClassifier() from ./heuristics/index.js) into a single OntologySystem object with fields { ontology, validator, classifier, config }. This is a plain constructor function, not a class — 'Factory' in this codebase means 'exported async function that returns a fully-wired interface', matching the naming convention implied by the parent's own description of the factory.


---

*Generated from 9 observations*
