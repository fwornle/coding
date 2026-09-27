# LegacyOntologyAdapter

**Type:** Detail

## What It Is

LegacyOntologyAdapter is a class defined in `LegacyOntologyAdapter.ts`, importing `EntityDefinition`, `OntologyType`, and `PropertyDefinition` from `ontology/types.ts`. Its implementation file was not among the retrieved sources, so this document is grounded primarily in its public contract as observed from its sole consumer, `src/ontology/index.ts`, rather than its internal logic. That consumer requires the adapter as a mandatory constructor argument to `createOntologySystem()`, failing fast with the message "createOntologySystem requires a LegacyOntologyAdapter (Phase 42-03)" if it is omitted.

## Architecture and Design

The dominant pattern is the **Adapter pattern**: LegacyOntologyAdapter wraps a newer km-core `OntologyRegistry` behind the legacy call surface expected by existing consumers, documented in `src/ontology/index.ts`'s `OntologySystem` interface as preserving compatibility for callers such as `persistence-agent.ts` (itself unverified in the retrieved set). This is paired with a **fail-fast dependency injection** style at the factory boundary — `createOntologySystem`, effectively the `OntologySystemFactory` sibling, throws explicit errors when either the adapter or the `UnifiedInferenceEngine` is missing, rather than defaulting to mocks. Config validation is handled as a distinct pre-flight step via `validateOntologyConfig`, separate from runtime configuration management, and encodes a two-tier (upper/lower) ontology split — mandatory `upperOntologyPath` when enabled, mandatory `lowerOntologyPath` once a team is set — that appears to anticipate the "VKB Ontology — Two-Tier Architecture" redesign described at the session level, suggesting implementation is proceeding ahead of or alongside that broader initiative.

## Implementation Details

Concretely verifiable mechanics are limited to import/usage evidence: the class consumes `EntityDefinition`, `OntologyType`, and `PropertyDefinition` types, and per the `OntologySystem` interface it is expected to expose methods like `hasEntityClass`, `getAllEntityClasses`, and `resolveEntityDefinition` — but these method bodies live in the unretrieved `LegacyOntologyAdapter.ts` and are not confirmed here. `src/ontology/index.ts` acts as the composition root, wiring the adapter alongside `OntologyValidator`, `OntologyClassifier`, and `createHeuristicClassifier`. Notably, a second, independent ontology-consumption pathway exists in the sibling `OntologyClassRepairScript` (`scripts/repair-writer-ontology-class.mjs`), which reads ancestor-chain data directly from `.data/ontologies/obs-api/*.json` via `loadParentMap()`/`chainOf()`, bypassing the adapter and km-core entirely. No shared code bridges these two paths.

## Integration Points

LegacyOntologyAdapter's primary integration point is `src/ontology/index.ts`, which depends on it as a required constructor input to `createOntologySystem` and documents it in the `OntologySystem` interface. Its parent grouping, Ontology, contains it alongside siblings `OntologySystemFactory` (the `createOntologySystem` factory itself) and `OntologyClassRepairScript` (the JSON-file-based parallel path). The adapter's stated purpose is to shield legacy consumers from km-core's `OntologyRegistry` API changes, though the consumer side of that contract (`persistence-agent.ts`) was not present in retrieved files and remains unverified.

## Usage Guidelines

Given its role as a fail-fast required dependency, callers must always supply a LegacyOntologyAdapter instance to `createOntologySystem`; omission is treated as a construction error, not a soft failure. Developers should be aware of the two parallel ontology-access pathways in this codebase — the adapter/registry route and the direct JSON-parsing route used by `repair-writer-ontology-class.mjs` — and avoid introducing further divergence between them without reconciling logic. Because this adapter is explicitly framed as a Phase 42-03 shim over km-core, and the "Agentic Ontology Cleanup" work indicates stale ontology files are actively being pruned, this class should be treated as a transitional component: a candidate for eventual removal once consumers migrate directly onto km-core's `OntologyRegistry`, rather than as a permanent architectural fixture.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- LegacyOntologyAdapter (class) in LegacyOntologyAdapter.ts

**Relationships:**
- Imports: ontology/types.ts, EntityDefinition, OntologyType, PropertyDefinition
- src/ontology/index.ts imports LegacyOntologyAdapter from './LegacyOntologyAdapter.js' and requires it as a mandatory constructor argument to createOntologySystem(), throwing 'createOntologySystem requires a LegacyOntologyAdapter (Phase 42-03)' if omitted — the actual class body, its hasEntityClass/getAllEntityClasses/resolveEntityDefinition methods, and its use of EntityDefinition/OntologyType/PropertyDefinition from ontology/types.ts are not present in any supplied file.

**Other:**
- LegacyOntologyAdapter.ts (module) in LegacyOntologyAdapter.ts
- The OntologySystem interface in src/ontology/index.ts documents the adapter as wrapping a km-core OntologyRegistry, exposing the legacy call surface so existing consumers (named as persistence-agent.ts in the docstring) don't have to change — but persistence-agent.ts itself is not among the retrieved files, so the consumer side of this contract is unverified here.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Ontology' work record on VKB Ontology — Two-Tier Architecture describes a planned redesign splitting a flat ontology into a generic upper tier and a project-scoped lower tier; src/ontology/index.ts's validateOntologyConfig() already encodes exactly this split (upperOntologyPath mandatory when enabled, lowerOntologyPath mandatory once a team is set), suggesting the two-tier model is partially implemented ahead of or alongside the VKB-side redesign.
- Agentic Ontology Cleanup documents verification/removal of stale ontology files no longer referenced anywhere in the codebase — relevant context for judging whether LegacyOntologyAdapter itself could be a future cleanup candidate once km-core's OntologyRegistry fully replaces the legacy call shape it currently shims.

## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- [CGR] ontology (variable) in events.test.ts

### Siblings
- [OntologySystemFactory](./OntologySystemFactory.md) -- [LLM+CGR] src/ontology/index.ts's createOntologySystem() is the actual OntologySystemFactory: it takes an OntologyConfig, a required UnifiedInferenceEngine, and a required LegacyOntologyAdapter, and throws explicit errors ('createOntologySystem requires an inferenceEngine...' / 'createOntologySystem requires a LegacyOntologyAdapter...') if either is missing, rather than silently substituting a mock. This is a hard DI contract enforced at construction time.
- [OntologyClassRepairScript](./OntologyClassRepairScript.md) -- [LLM+CGR] scripts/repair-writer-ontology-class.mjs is the actual OntologyClassRepairScript: it fetches entities and relations from obs-api via /api/v1/entities and /api/v1/relations, builds an ancestor chain per entityType using loadParentMap() sourced from .data/ontologies/obs-api/ (the same KG_ONTOLOGY_DIR referenced in observations-api-server.mjs per the parent context), and classifies each row as repairable, migratable, conflicting, foreign, or unknownClass.


---

*Generated from 12 observations*
