# Ontology

**Type:** SubComponent

# Ontology — Technical Insight Document

## What It Is

Ontology is the SubComponent of SemanticAnalysis responsible for classifying entities against a registry of ontology classes, and for enforcing/repairing the integrity of those classifications. Its primary implementation lives in `src/ontology/index.ts`, which acts as the module's factory and re-export surface, and in `scripts/repair-writer-ontology-class.mjs`, a standalone maintenance script. The component has two child components that make this split explicit: `OntologySystemFactory` (the `createOntologySystem` factory in `src/ontology/index.ts`) and `OntologyClassRepair` (the invariant-enforcement logic in the repair script). Supporting configuration data lives in `knowledge-management.json`, referenced via `ontology`/`upperOntologyPath` variables, and structural/graph-facing code touches `GraphKMStore.ts`, `observations-api-server.mjs`, and `backfill-insight-mentions.mjs` through functions like `resolveOntologyDir`, `KG_ONTOLOGY_DIR`, and `collectByOntologyClass`.

![Ontology — Architecture](images/ontology-architecture.png)

## Architecture and Design

The design centers on a **fail-fast factory pattern**: `createOntologySystem()` in `src/ontology/index.ts` refuses to construct a system with mocked or missing dependencies, throwing explicitly when `inferenceEngine` is absent ("No mock fallback is provided... Pass a real LLM inference engine from SemanticAnalyzer") and when `adapter` is missing ("Caller must construct one around a km-core OntologyRegistry first"). This makes classification a hard precondition on LLM availability rather than something with silent degraded behavior — any "no LLM" handling is pushed to the caller.

A second major pattern is the **Adapter/Strangler pattern**: `LegacyOntologyAdapter` wraps km-core's `OntologyRegistry`, preserving the legacy `hasEntityClass`/`getAllEntityClasses`/`resolveEntityDefinition` surface so callers like `persistence-agent.ts` don't need to change, while actual class data now flows from km-core underneath. The returned `OntologySystem` interface even names this field `ontology`, documenting itself as a shim replacing a deleted legacy manager.

Classification itself follows a **Strategy/hybrid composition**: `OntologyClassifier` is composed from an injected heuristic classifier (`createHeuristicClassifier`) plus the injected LLM inference engine, rather than hardcoding either strategy.

Separately, integrity enforcement is handled **out-of-band**: rather than a write-time constraint, `scripts/repair-writer-ontology-class.mjs` audits live obs-api data after the fact, implying the writer path can currently produce contradictions that this script cleans up. Its `arbitrate()` function embodies a deliberate **edge-based arbitration** design decision — it rejects the seemingly simpler `metadata.hierarchyLevel` heuristic in favor of the attaching graph edge type (`contains`/`parent-child` vs. `has_insight`), based on measured evidence (13/16 vs. 3/16 agreement) that edge type is the more reliable signal.

![Ontology — Relationship](images/ontology-relationship.png)

## Implementation Details

`src/ontology/index.ts` re-exports its submodules wholesale (`export * from './types.js'`, etc.) covering `LegacyOntologyAdapter.ts`, `OntologyClassifier.ts`, `OntologyConfigManager.ts`, `ontologyPathResolver.ts`, `OntologyValidator.ts`, and `metrics.ts` — but the factory function only actively wires four of these (`OntologyValidator`, `createHeuristicClassifier`, `OntologyClassifier`, and the adapter), meaning the real contract is narrower than the export surface suggests. `validateOntologyConfig()` is a pure, filesystem-free check: disabled configs short-circuit to valid, enabled configs require `upperOntologyPath`, and `lowerOntologyPath` is required only when `team` is set — catching malformed team-scoped configs before they reach `createOntologySystem()` or km-core's upper→coding-ontology→lower.json resolution chain.

The repair script (child `OntologyClassRepair`) enforces exactly one invariant: `ontologyClass` must equal `entityType` or one of its registry ancestors. This is computed via `chainOf()` walking a `parent` Map built by `loadParentMap()`, which unions class definitions across every `*.json` file under `.data/ontologies/obs-api/`, reading `body.extends ?? body.parent ?? null` per class and silently skipping unparseable or non-registry files (documented as "display overlays"). Three violation types are handled distinctly: `WRITER_OWNED` classes (Observation, Digest) are repaired unambiguously as `ontologyClass := entityType`; non-artifact tags found in the class field (an L2 subsystem or upper-ontology descriptor) are migrated to `metadata.subsystem`; and conflicting artifact-class claims are routed to `arbitrate()`. The script is explicitly a thin HTTP client — it never opens the km-core LevelDB directly, since "the km-core LevelDB is single-owner (obs-api)."

## Integration Points

Ontology sits under `SemanticAnalysis` and is closely tied to sibling `OntologyClassificationAgent`, whose L1/L2 categorical output is exactly the kind of assignment that downstream KB "spine" derivations (see sibling `Insights`' Intent Spine Derivation Pipeline) depend on staying stable. The unresolved `CodingLowerOntologySource` emission bug — tracked at both the `SemanticAnalysis` parent level and sibling `Pipeline` — implicates lower-ontology consumption near `coding.lower.json`, likely in or upstream of `OntologyClassificationAgent`, making that path suspect for anyone modifying L2 lower-ontology emission. A separate, ontology-file-scoped effort explores adding a new `Intent` class to the coding ontology itself, distinct from the KB's derived Intent-First taxonomy work despite the shared name. Graph-facing integration runs through `GraphKMStore.ts`, `observations-api-server.mjs` (`KG_ONTOLOGY_DIR`, `collectByOntologyClass`), and maintenance scripts like `backfill-insight-mentions.mjs` and `repair-rollup-parent-class.mjs`, both of which use `resolveOntologyDir`.

## Usage Guidelines

Callers constructing an `OntologySystem` must supply a real inference engine (sourced from `SemanticAnalyzer`) and a pre-built `LegacyOntologyAdapter` around a km-core `OntologyRegistry` — there is no mock fallback, so tests and tooling must provide real or realistic doubles rather than relying on default construction. When validating configuration, use `validateOntologyConfig()` early, since it catches team-scoped configs missing `lowerOntologyPath` before deeper resolution logic runs. When resolving class-vs-metadata conflicts, prefer the attaching edge type over `metadata.hierarchyLevel` or parent-relative depth heuristics — the repair script's measured rejection of those heuristics (and its refusal to invent top-level components from `Project -contains-> Detail` edges) should guide any future conflict-resolution logic. Because integrity checking happens out-of-band via `OntologyClassRepair` rather than at write time, developers touching `ObservationWriter` or other writer paths should assume contradictions can still be introduced and must be cleaned up after the fact, and should treat the `CodingLowerOntologySource` emission path as an open, unresolved defect rather than spec-compliant.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ontology (method) in GraphKMStore.ts
- Ontology (class) in types.ts
- resolveOntologyDir (function) in backfill-insight-mentions.mjs
- KG_ONTOLOGY_DIR (class) in observations-api-server.mjs
- collectByOntologyClass (function) in observations-api-server.mjs
- resolveOntologyDir (function) in repair-rollup-parent-class.mjs

**Relationships:**
- Calls: e, _tokenize, apiPath, get, useViewerStore, classifyAvailable, getClass, getAllClassNames, getRegistry, resolveOverlaySystem (+10 more)
- Imports: heuristics/index.ts, createHeuristicClassifier, LegacyOntologyAdapter.ts, LegacyOntologyAdapter, metrics.ts, OntologyClassifier.ts, OntologyClassifier, OntologyConfigManager.ts, ontologyPathResolver.ts, OntologyValidator.ts (+10 more)

**Other:**
- ontology (variable) in knowledge-management.json
- ontology (variable) in events.test.ts
- ontology (variable) in graph-builder.test.ts
- upperOntologyPath (variable) in knowledge-management.json
- src/ontology/index.ts:createOntologySystem is a hard-failing factory, not a convenience wrapper: it throws if `inferenceEngine` is missing ('No mock fallback is provided. Pass a real LLM inference engine from SemanticAnalyzer') and throws separately if `adapter` is missing ('Caller must construct one around a km-core OntologyRegistry first'). This mirrors the code-graph import list — LegacyOntologyAdapter, OntologyValidator, OntologyClassifier, createHeuristicClassifier, UnifiedInferenceEngine all appear as constructor/parameter types in this one function — meaning the module's public surface is essentially this factory plus the four classes/functions it wires together, with everything else (`metrics.ts`, `ontologyPathResolver.ts`, `OntologyConfigManager.ts`) re-exported via `export *` rather than consumed directly here.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced, indicating a gap between the lower-ontology source contract and actual emission behavior.
- Coding Ontology — Intent Class Addition explores adding a new Intent class to the coding ontology so entities can be classified by session intent rather than only by code-change type, distinct from the separate KB intent-spine taxonomy work.
- The Pipeline CodingLowerOntologySource Emission Bug record documents a live, unresolved discrepancy between documented invariants and observed behavior: the pipeline emits a `CodingLowerOntologySource` reference in its output even though project documentation states this source type should never be produced. The record locates the known-bad state near coding.lower.json consumption in OntologyClassificationAgent or its upstream producers, meaning anyone touching L2 lower-ontology emission should treat that path as suspect rather than assume current spec-compliance.
- The Coding Ontology — Intent Class Addition record tracks a separate, ontology-file-scoped investigation into adding a new `Intent` class to the coding ontology itself (so entities can be classified by session intent rather than only code-change type), which the record explicitly distinguishes from the unrelated KB 'Intent-First Organization' taxonomy work — the two share the word 'Intent' but operate on different artifacts (an ontology class definition vs. a derived knowledge-graph taxonomy layer), a distinction worth preserving since they are easy to conflate by name alone.

## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced

### Children
- [OntologyClassRepair](./OntologyClassRepair.md) -- [LLM] scripts/repair-writer-ontology-class.mjs enforces exactly one invariant — ontologyClass must equal entityType or one of its registry ancestors — computed by chainOf() walking a parent Map built by loadParentMap() from every *.json file under .data/ontologies/obs-api/. loadParentMap() unions classes across files by reading each doc.classes object and recording body.extends ?? body.parent ?? null per class name, silently skipping files that don't parse as JSON or lack a `classes` key (the comment notes these are 'display overlays and non-registry files'). This means the registry the repair script trusts is assembled from an entire directory, not one canonical file, so a malformed or missing file in that directory silently shrinks the ancestor chain rather than failing loudly.
- [OntologySystemFactory](./OntologySystemFactory.md) -- [LLM+CGR] createOntologySystem in src/ontology/index.ts is the actual factory this component name refers to: it is a hard-failing constructor, not a convenience wrapper, throwing 'createOntologySystem requires an inferenceEngine. No mock fallback is provided. Pass a real LLM inference engine from SemanticAnalyzer' when inferenceEngine is falsy and a separate error demanding a pre-built LegacyOntologyAdapter ('Caller must construct one around a km-core OntologyRegistry first') when adapter is missing. Both checks run before any of the four wired classes (OntologyValidator, createHeuristicClassifier, OntologyClassifier) are instantiated, so a malformed call fails at the factory boundary rather than partway through construction.

### Siblings
- [Pipeline](./Pipeline.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug tracks an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in its output despite documentation stating this source type should never be produced, indicating a mismatch between the pipeline's source-tagging logic and its own contract.
- [Insights](./Insights.md) -- [SESSION] Intent Spine Derivation Pipeline describes deriving an 'intent spine' by clustering insights into Intent entities via aggregate edges, consolidating five prior ad-hoc scripts into one producer script.
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation establishes that intent-derived taxonomies produced by SemanticAnalysisAgent were validated for stability by re-deriving the taxonomy independently from disjoint data samples and measuring agreement between the two derivations, rather than by inspecting a single run's output. This methodology exists because the taxonomy serves as a fixed 'spine' for downstream KB stages — instability would propagate structural drift into every consumer that depends on the taxonomy being held fixed, so reproducibility across disjoint samples was treated as a precondition for freezing the spine rather than an optional sanity check. This bears on OntologyClassificationAgent because its L1/L2 output is exactly the kind of categorical assignment such a spine depends on staying stable run-to-run.
- [SemanticAnalysisAgent](./SemanticAnalysisAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation validates that an intent-derived taxonomy produced from SemanticAnalysisAgent-adjacent processing is stable and reproducible by re-deriving it independently from disjoint data samples.
- [BaseAgentFramework](./BaseAgentFramework.md) -- [LLM] None of the five files retrieved for this request — scripts/health-coordinator.js, scripts/repair-writer-ontology-class.mjs, src/ontology/index.ts, tests/integration/health-coordinator-etm-expected.test.mjs, and config/agents/copilot.sh — define, import, or reference a class named BaseAgent, BaseAgentFramework, or any of the five lifecycle methods (process(), calculateConfidence(), detectIssues(), generateRouting(), applyCorrections(), buildMetadata()) that the parent context attributes to base-agent.ts. The <code_graph> block supplied for this request is also empty, so there is no structural (call-graph) evidence tying these files to the framework either. This is a retrieval mismatch, not a finding about the framework's design.
- [L2RefinementClassifier](./L2RefinementClassifier.md) -- [LLM] None of the supplied code files (scripts/health-coordinator.js, scripts/repair-writer-ontology-class.mjs, src/ontology/index.ts, tests/integration/health-coordinator-etm-expected.test.mjs, config/agents/copilot.sh) implement or reference loadL2Classes(), buildL2RefinementPrompt(), or extractL2FromLLMResponse() — the three functions the parent context attributes to L2RefinementClassifier's implementation in ontology-classification-agent.ts. That file is absent from the supplied evidence.
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js implements the actual HealthCoordinator daemon: a single-owner in-memory state object (currentState) exposed over HTTP (GET /health, GET /health/state, POST /signals, POST /health/refresh) and refreshed on a 5s tick that iterates a check registry loaded from config/health-verification-rules.json. This is the concrete component behind the 'HealthCoordinator' label in the parent context, though the parent's observations (SemanticAnalysisAgent, OntologyClassificationAgent, BaseAgent lifecycle) describe an entirely different subsystem.
- [AgentLauncherConfigs](./AgentLauncherConfigs.md) -- [LLM] The supplied code files (health-coordinator.js, repair-writer-ontology-class.mjs, src/ontology/index.ts, health-coordinator-etm-expected.test.mjs, config/agents/copilot.sh) contain no reference to an 'AgentLauncherConfigs' class, module, or file. config/agents/copilot.sh is an agent definition sourced by launch-agent-common.sh, which is thematically adjacent to an 'agent launcher' concept but is not itself a config aggregation component named AgentLauncherConfigs.
- [NoUnboundedFsScanGuard](./NoUnboundedFsScanGuard.md) -- [LLM] None of the supplied code files implement or reference anything resembling a filesystem-scan bound or guard. `scripts/health-coordinator.js` owns health-state polling and Docker/service/LSL checks; `scripts/repair-writer-ontology-class.mjs` repairs `ontologyClass` vs `entityType` mismatches over HTTP against obs-api; `src/ontology/index.ts` wires `LegacyOntologyAdapter`/`OntologyValidator`/`OntologyClassifier`; the test file asserts ETM-expectation lifecycle invariants; `config/agents/copilot.sh` configures the CoPilot agent launch. None of these touch directory traversal, `fs.readdir`/`fs.walk` recursion, or any depth/size/count ceiling that a name like 'NoUnboundedFsScanGuard' would imply.


---

*Generated from 24 observations*
