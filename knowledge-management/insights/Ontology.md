# Ontology

**Type:** SubComponent

## What It Is

Ontology is the composition module rooted at `src/ontology/index.ts`, which serves as a barrel/facade that assembles the ontology subsystem for its parent, SemanticAnalysis. It re-exports and wires together the type definitions (`Ontology` and `OntologyClass` classes in `types.ts`), the API surface for classes (`OntologyClass` and `listOntologyClasses`/`listOntologyClassesNoDisplay` in `ApiClient.ts`), and the runtime machinery — validator, classifier, config manager, path resolver, heuristics, and metrics — behind a single `createOntologySystem()` factory. It is not itself a classifier or a store; it is the integration point that turns several independently developed pieces (classification, validation, legacy compatibility, path resolution) into one coherent `OntologySystem`.

![Ontology — Architecture](images/ontology-architecture.png)

## Architecture and Design

The dominant pattern is a **Factory** (`createOntologySystem`) that assembles an `OntologyValidator`, an `OntologyClassifier`, a heuristic classifier (`createHeuristicClassifier` from `heuristics/index.ts`), and a `LegacyOntologyAdapter` into a single facade object described by the `OntologySystem` interface. Classification and validation are deliberately decoupled: `OntologyClassifier` does not own validation logic itself but depends on `OntologyValidator` plus an externally supplied inference engine, reflecting a preference for composition over inheritance and small single-responsibility units.

A second major pattern is the **Adapter**: `LegacyOntologyAdapter` (its own child component) wraps km-core's `OntologyRegistry` behind the call signature of a deleted bespoke ontology manager (`hasEntityClass`, `getAllEntityClasses`, `resolveEntityDefinition`). This is documented in code as a Phase 42-03 (D-53) shim, letting consumers such as `persistence-agent.ts` keep working unchanged while the underlying storage moved to km-core.

The factory enforces **fail-fast dependency injection**: `createOntologySystem` throws explicit errors if `inferenceEngine` or `adapter` are missing rather than silently falling back to mocks — a deliberate trade-off favoring loud failures over hidden test/prod divergence. Configuration validation encodes a **two-tier ontology model** directly: `validateOntologyConfig()` requires `upperOntologyPath` whenever `ontology.enabled` is true, and additionally requires `lowerOntologyPath` the moment a team is specified, mirroring an upper (domain-wide) / lower (team-specific) ontology split rather than deferring these checks to runtime failures inside `OntologyConfigManager.ts`.

## Implementation Details

Path resolution is treated as its own fragile subsystem: `ontologyPathResolver.ts` exposes not just `resolveOntologyPath` and `OntologyPathNotFoundError` but test-support instrumentation (`__clearCache`, `__getProbeCount`, `__resetProbeCounter`), indicating that file resolution failures have historically been a source of bugs requiring dedicated observability in tests. Metrics collection (`metrics.ts`) is imported alongside the classifier and validator, suggesting classification outcomes are tracked quantitatively rather than left to logs alone.

On the data side, `GraphKMStore.ts` exposes an `ontology` method, and ontology data appears in `knowledge-management.json`, while `observations-api-server.mjs` defines `KG_ONTOLOGY_DIR`, the on-disk root (`.data/ontologies/obs-api/`) that both the runtime system and its child `OntologyClassRepairScript` (`scripts/repair-writer-ontology-class.mjs`) rely on. The repair script builds ancestor chains via `loadParentMap()` against that same directory and classifies entity/relation rows as repairable, migratable, conflicting, foreign, or unknownClass — a concrete downstream consumer of the lower-ontology file structure that `lowerOntologyPath` config is designed to load.

## Integration Points

![Ontology — Relationship](images/ontology-relationship.png)

Ontology sits under SemanticAnalysis and is exercised alongside sibling Pipeline, which currently has an open, related defect: it emits a `CodingLowerOntologySource` reference tied to `coding.lower.json` even though documentation says this source type should never be produced — a live contract mismatch against the same lower-ontology file structure this component's `lowerOntologyPath` loads. Ontology's children — OntologySystemFactory (the `createOntologySystem` function itself), LegacyOntologyAdapter, and OntologyClassRepairScript — are not separate subsystems so much as the concrete implementations backing this module's exported facade. `ApiClient.ts` exposes `OntologyClass`, `listOntologyClasses`, and `listOntologyClassesNoDisplay` for external/API consumption, while `GraphKMStore.ts`'s `ontology` method suggests a persistence-layer touchpoint distinct from the km-core-backed adapter path.

## Usage Guidelines

Callers must supply a real `UnifiedInferenceEngine` and a real `LegacyOntologyAdapter` (itself backed by km-core's `OntologyRegistry`) when invoking `createOntologySystem` — there is no mock fallback, so tests and new integrations need working instances of both, not stubs. When `ontology.enabled` is true, configuration must always set `upperOntologyPath`, and any team-specific setup must additionally set `lowerOntologyPath`; skipping this invites the kind of downstream inconsistency currently seen in the Pipeline's `CodingLowerOntologySource` bug. Given the dedicated probe/cache-clearing instrumentation in `ontologyPathResolver.ts`, treat ontology file resolution as a known source of flakiness worth testing explicitly rather than an assumed-reliable file lookup. Finally, when modifying entity/relation classification, remember `OntologyClassRepairScript` independently reads the same `.data/ontologies/obs-api/` directory (`KG_ONTOLOGY_DIR`), so schema or path changes here should be checked against that repair tooling as well.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ontology (method) in GraphKMStore.ts
- Ontology (class) in types.ts
- OntologyClass (class) in ApiClient.ts
- listOntologyClasses (method) in ApiClient.ts
- listOntologyClassesNoDisplay (method) in ApiClient.ts
- OntologyClass (class) in types.ts
- KG_ONTOLOGY_DIR (class) in observations-api-server.mjs

**Relationships:**
- Calls: apiPath, get, _tokenize, e, useViewerStore, classifyAvailable, getClass, getAllClassNames, getRegistry, resolveOverlaySystem (+10 more)
- Imports: heuristics/index.ts, createHeuristicClassifier, LegacyOntologyAdapter.ts, LegacyOntologyAdapter, metrics.ts, OntologyClassifier.ts, OntologyClassifier, OntologyConfigManager.ts, ontologyPathResolver.ts, OntologyValidator.ts (+10 more)

**Other:**
- ontology (variable) in events.test.ts
- ontology (variable) in graph-builder.test.ts
- ontology (variable) in knowledge-management.json
- src/ontology/index.ts wires together LegacyOntologyAdapter, OntologyValidator, OntologyClassifier, and createHeuristicClassifier from heuristics/index.ts into a single createOntologySystem() factory. The factory explicitly refuses mock fallbacks: it throws if inferenceEngine or adapter is not supplied, forcing callers (per the module docstring, persistence-agent.ts) to construct a real km-core OntologyRegistry-backed adapter before the system can be assembled — this is a hard dependency-injection contract enforced at construction time rather than a soft default.
- The exported OntologySystem interface documents LegacyOntologyAdapter as a Phase 42-03 (D-53) shim: 'B's specific intelligence stays; the deleted legacy manager is replaced by this shim around km-core'. This indicates the Ontology subcomponent underwent a migration where a bespoke legacy ontology manager was retired in favor of km-core's OntologyRegistry, with LegacyOntologyAdapter preserving the old call signature (hasEntityClass/getAllEntityClasses/resolveEntityDefinition) so existing consumers didn't need to change.
- validateOntologyConfig() in src/ontology/index.ts enforces two structural rules independent of the classifier/validator wiring: upperOntologyPath is mandatory whenever ontology.enabled is true, and lowerOntologyPath becomes mandatory the moment a team is specified — encoding the two-tier (upper domain-level / lower team-specific) ontology model directly into config validation rather than deferring the check to runtime failures inside OntologyConfigManager.ts.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference despite documentation stating this source type should never be produced — this points at a live contract mismatch tied to coding.lower.json, the same lower-ontology file structure that src/ontology/index.ts's lowerOntologyPath config option is designed to load.
- KB Injection A/B Experiment — Task Design and Discrimination Validity establishes that a viewer-executable research script for KB data quality is planned to merge with batch processing so missing information is captured in one pass; this is recorded against SemanticAnalysis rather than Ontology directly, but signals that ontology/classification data quality gaps are currently handled sequentially, an architectural gap acknowledged but unaddressed as of this record.

## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced

### Children
- [OntologySystemFactory](./OntologySystemFactory.md) -- [LLM+CGR] src/ontology/index.ts's createOntologySystem() is the actual OntologySystemFactory: it takes an OntologyConfig, a required UnifiedInferenceEngine, and a required LegacyOntologyAdapter, and throws explicit errors ('createOntologySystem requires an inferenceEngine...' / 'createOntologySystem requires a LegacyOntologyAdapter...') if either is missing, rather than silently substituting a mock. This is a hard DI contract enforced at construction time.
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- [CGR] LegacyOntologyAdapter (class) in LegacyOntologyAdapter.ts
- [OntologyClassRepairScript](./OntologyClassRepairScript.md) -- [LLM+CGR] scripts/repair-writer-ontology-class.mjs is the actual OntologyClassRepairScript: it fetches entities and relations from obs-api via /api/v1/entities and /api/v1/relations, builds an ancestor chain per entityType using loadParentMap() sourced from .data/ontologies/obs-api/ (the same KG_ONTOLOGY_DIR referenced in observations-api-server.mjs per the parent context), and classifies each row as repairable, migratable, conflicting, foreign, or unknownClass.

### Siblings
- [Pipeline](./Pipeline.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug tracks an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced.
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js is the actual implementation of HealthCoordinator: a single-owner in-memory SoT (`currentState`) exposing HTTP endpoints (GET /health, GET /health/state, POST /signals, POST /health/refresh) and a 5s tick scheduler that iterates check registries from config/health-verification-rules.json. This is directly the component under analysis, not an inferred neighbor.
- [AgentLaunchers](./AgentLaunchers.md) -- [LLM] None of the five retrieved files reference an entity, class, or module named 'AgentLaunchers', nor any launching/factory/dispatch mechanism for the pipeline agents named in the parent context (BaseAgent, OntologyClassificationAgent, SemanticAnalysisAgent). The retrieved set is dashboard UI (batch-progress.tsx), a health-monitoring daemon (health-coordinator.js), an ontology-class repair script (repair-writer-ontology-class.mjs), an ontology-system factory (src/ontology/index.ts), and an ETM lifecycle test — none of these instantiate, register, or invoke concrete Agent subclasses.
- [PiExtensions](./PiExtensions.md) -- [LLM] None of the five supplied source files implement or reference anything named 'PiExtensions'. batch-progress.tsx renders the UKB batch-processing dashboard tile (fetchProgress/fetchHistory against http://localhost:3033/api/batch/*), health-coordinator.js is the Phase 33 single-owner health SoT (currentState, shouldInject, the 5s tick scheduler), repair-writer-ontology-class.mjs repairs ontologyClass/entityType mismatches via arbitrate(), src/ontology/index.ts wires createOntologySystem() around a km-core OntologyRegistry, and health-coordinator-etm-expected.test.mjs asserts ETM-expectation lifecycle invariants. None of these touch a pi-agent extension surface, a plugin/extension registry, or anything with 'Pi' in its name — the retrieval appears to have surfaced the parent SubComponent's general neighborhood (ontology/health/batch machinery) rather than PiExtensions' own implementation.


---

*Generated from 21 observations*
