# Ontology

**Type:** SubComponent

# Ontology — Technical Insight Document

## What It Is

Ontology, as a SubComponent within SemanticAnalysis, is the vocabulary and path-resolution layer that underlies the classification pipeline described in its parent context (the hard-root-guard → closed-vocabulary L2 classifier → regex-fallback sequence). It is not a single class but a distributed concern spanning multiple files: `ontologyPathResolver.ts` (resolution and caching of ontology definition files), `OntologyConfigManager.ts` (centralized configuration access sitting above the resolver), `types.ts` (the `Ontology` class), and `ApiClient.ts` (which exposes `OntologyClass` and `Entity` as typed, API-boundary-crossing entities via methods like `listOntologyClasses` and `listOntologyClassesNoDisplay`). On the server side, `observations-api-server.mjs` defines `KG_ONTOLOGY_DIR` and `collectByOntologyClass`, while `GraphKMStore.ts` exposes an `ontology` method, indicating the concept is threaded through storage as well as classification code. On the frontend, `OntologyFilter.tsx` consumes this same vocabulary for UI filtering.

![Ontology — Architecture](images/ontology-architecture.png)

## Architecture and Design

The dominant pattern is a **layered dependency chain**: `OntologyConfigManager.ts` sits above `ontologyPathResolver.ts`, which performs cached, testable filesystem resolution of the ontology definition JSON files (the same `upper.json` / `coding-ontology.json` / `coding.lower.json` files referenced by the sibling `L2SubsystemClassifier`). This mirrors the parent SemanticAnalysis philosophy of separating structural/deterministic concerns from probabilistic ones — here the separation is between *locating* ontology data (resolver) and *using* it for classification (agents like `OntologyClassificationAgent` and `L2SubsystemClassifier`).

A second architectural seam is the **dual consumption model**: the same class vocabulary is used on a write-side (classification, enforcing closed-vocabulary correctness so misclassification doesn't cascade through the hierarchy) and a read-side (presentation, via `OntologyFilter.tsx`, `ApiClient`'s `OntologyClass` type, and `VOKB_SCHEMA`-driven faceted filtering backed by `useViewerStore`). Notably, nothing in the observed code graph enforces that both sides share a single source of truth — a new L2 class added to `coding.lower.json` could be classifiable but invisible in the UI filter, a silent gap rather than a hard failure.

![Ontology — Relationship](images/ontology-relationship.png)

## Implementation Details

`ontologyPathResolver.ts` exports `resolveOntologyPath` alongside a distinctly typed `OntologyPathNotFoundError`, letting upstream callers (likely `OntologyConfigManager`) differentiate missing/misconfigured ontology files from other I/O failures rather than catching a generic `Error`. The module also exposes double-underscore test-seam functions — `__clearCache`, `__getProbeCount`, `__resetProbeCounter` — which together indicate the resolver memoizes filesystem lookups and that its test suite asserts on probe counts to catch cache-bypass regressions (repeated disk I/O where a single resolved-and-cached path is expected).

On the API boundary, `ApiClient.ts` exports `ApiClient`, `Entity`, and `OntologyClass` as first-class types, and provides `listOntologyClasses`/`listOntologyClassesNoDisplay` methods — the "NoDisplay" variant suggesting a distinction between classes intended for UI presentation versus the full internal set. Server-side, `observations-api-server.mjs` defines `KG_ONTOLOGY_DIR` and `collectByOntologyClass`, aggregating observations by ontology class, while `GraphKMStore.ts`'s `ontology` method suggests the graph store itself exposes ontology-aware queries.

On the frontend, `OntologyFilter.tsx` imports `VOKB_SCHEMA` and composes the shared `Checkbox` primitive from `unified-viewer/src/components/ui/checkbox.tsx`, rendering one checkbox per filterable class, with selection state persisted in `useViewerStore` (`viewer-store.ts`) rather than held locally — enabling filter state to survive across other viewer components.

## Integration Points

Ontology is a cross-cutting fixture: the plain `ontology` variable appears independently in `knowledge-management.json`, `events.test.ts`, and `graph-builder.test.ts`, showing that config, event-handling tests, and graph-construction tests all need to load or stub ontology data — it is not encapsulated solely within the classification agent's own tests. This is consistent with the parent SemanticAnalysis pattern of tmpdir-isolated fixture-copy integration testing over mocking.

Upstream, Ontology depends on `@fwornle/km-core`'s `HIERARCHY_ROOTS` (used by the sibling classification agents) and on the `coding.lower.json`/`upper.json` ontology definitions consumed by `L2SubsystemClassifier`. Downstream, it feeds `ApiClient` consumers (including `OntologyFilter.tsx`) and the `GraphKMStore`/`observations-api-server.mjs` storage and aggregation layer. As a SubComponent of SemanticAnalysis, it shares infrastructure conventions with siblings Pipeline, Insights, BaseAgent, and L2SubsystemClassifier, particularly the deterministic-first design ethos BaseAgent enforces via its template-method execute() pipeline.

## Usage Guidelines

Treat `__clearCache`, `__getProbeCount`, and `__resetProbeCounter` in `ontologyPathResolver.ts` strictly as test-only APIs — the naming convention signals intent, but nothing in the visible graph enforces it, so production code should avoid calling them. When adding new ontology classes to `coding.lower.json`, verify both the classification side and the `VOKB_SCHEMA`/`OntologyFilter.tsx` side are updated, since no shared-source validation currently guards against drift between classifiable and filterable vocabularies. Prefer catching `OntologyPathNotFoundError` specifically rather than generic errors when handling path resolution failures, to preserve differentiated upstream error handling. Finally, when writing tests touching ontology-classified entities (as in `events.test.ts` or `graph-builder.test.ts`), follow the established fixture-copy pattern rather than mocking, consistent with how the parent OntologyClassificationAgent's tests operate on real, tmpdir-isolated ontology JSON.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ontology (method) in GraphKMStore.ts
- Ontology (class) in types.ts
- OntologyClass (class) in ApiClient.ts
- listOntologyClasses (method) in ApiClient.ts
- listOntologyClassesNoDisplay (method) in ApiClient.ts
- KG_ONTOLOGY_DIR (class) in observations-api-server.mjs
- collectByOntologyClass (function) in observations-api-server.mjs

**Relationships:**
- Calls: apiPath, get, _tokenize, useViewerStore, classifyAvailable, getClass, getAllClassNames, getRegistry, resolveOverlaySystem, loadDisplayOverlay (+10 more)
- Imports: OntologyConfigManager.ts, OntologyConfigManager, ontologyPathResolver.ts, __clearCache, __getProbeCount, OntologyPathNotFoundError, __resetProbeCounter, resolveOntologyPath, ApiClient.ts, Entity (+10 more)
- OntologyFilter.tsx imports VOKB_SCHEMA and composes the shared Checkbox component from unified-viewer/src/components/ui/checkbox.tsx, while also depending on useViewerStore from viewer-store.ts. This chain — schema constant + shared UI primitive + centralized store — indicates the ontology is exposed in a viewer/dashboard UI as a faceted filter: VOKB_SCHEMA likely enumerates the filterable ontology dimensions (e.g. L1/L2 class names), OntologyFilter renders one Checkbox per class, and selections are persisted through useViewerStore so filter state survives across the viewer's other components rather than being local to the filter itself. This is architecturally distinct from the backend classification agent's closed-vocabulary enforcement described in the parent context — here the closed vocabulary (VOKB_SCHEMA) is used for filtering/display, not for constraining an LLM's output space.

**Other:**
- ontology (variable) in knowledge-management.json
- ontology (variable) in events.test.ts
- ontology (variable) in graph-builder.test.ts
- The code graph shows ontologyPathResolver.ts exporting not just resolveOntologyPath and OntologyPathNotFoundError but also test-only introspection hooks — __clearCache, __getProbeCount, and __resetProbeCounter. The presence of a probe counter alongside a cache-clearing function indicates the resolver memoizes filesystem lookups for ontology definition files (the same upper.json/coding-ontology.json/coding.lower.json files referenced in the parent OntologyClassificationAgent context) and that its test suite specifically asserts on how many times the underlying filesystem probe fires — i.e. tests exist to catch cache-bypass regressions where a code change accidentally causes repeated disk I/O for a path that should be resolved once and reused. This is a caching-correctness concern distinct from the classification-correctness concern the parent's hard-root-guard addresses.
- OntologyPathNotFoundError being a distinct exported error type (rather than a generic Error or a null return) suggests resolveOntologyPath() is designed to fail loudly and distinguishably when an ontology file is missing or misconfigured, which callers up the stack (likely OntologyConfigManager) can catch and handle differently from other I/O failures. Combined with the parent context's description of OntologyClassificationAgent depending on HIERARCHY_ROOTS imported from @fwornle/km-core, this points to a layered dependency: path resolution (ontologyPathResolver) is a lower-level concern that OntologyConfigManager.ts sits above, centralizing how the rest of the system locates and loads ontology JSON before classification logic ever runs.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The classification pipeline in OntologyClassificationAgent embodies a deliberate 'deterministic-first, LLM-as-fallback' philosophy that recurs throughout SemanticAnalysis. Before any LLM call is made, classifySingleObservation() checks the observation's name against the hard-root-guard set (CollectiveKnowledge, Coding, DynArch, Timeline, Normalisa) imported from @fwornle/km-core's HIERARCHY_ROOTS. If matched, the method immediately assigns classificationMethod='hard-root-guard' and returns without ever invoking classifier.classify() or touching the LLM. This is a defensive engineering decision: because these 5 names anchor the entire hierarchy, any LLM-driven misclassification of them would cascade corruption through the whole ontology tree, so the developers chose to hardcode an escape hatch rather than trust probabilistic classification for structurally critical nodes.

### Siblings
- [Pipeline](./Pipeline.md) -- [CGR] pollKnowledgePipeline (function) in health-coordinator.js
- [Insights](./Insights.md) -- [CGR] INSIGHTS (class) in kb-ab-sample-tasks.mjs
- [BaseAgent](./BaseAgent.md) -- [LLM] The parent observation describing BaseAgent's template-method execute() pipeline (process() → calculateConfidence() → detectIssues() → generateRouting() → applyCorrections() → buildMetadata()) is not directly visible in the provided code files, but the surrounding config/agents/*.sh scripts (copilot.sh, opencode.sh, pi.sh) reveal a parallel template-method philosophy at the shell layer: each agent definition file sources common hooks (agent_check_requirements, agent_pre_launch, agent_cleanup) that are called uniformly by launch-agent-common.sh, mirroring the same 'implement the hooks, let the orchestrator drive the sequence' pattern that BaseAgent enforces in TypeScript. This suggests the project applies the template-method pattern consistently across both its LLM-agent pipeline and its CLI-agent launch pipeline.
- [L2SubsystemClassifier](./L2SubsystemClassifier.md) -- [LLM] L2SubsystemClassifier's refinement step, as implemented via loadL2Classes() in ontology-classification-agent.ts, is architected as a closed-vocabulary lookup rather than an open classification task. It derives its candidate set by filtering registry.classCatalog to entries whose `extends` field resolves to one of REFINABLE_L1_PARENTS ('Component','SubComponent','Detail'), sourced from .data/ontologies/coding.lower.json. This means the classifier's entire universe of possible outputs (currently 10 L2 classes such as EtmDaemon, RapidLlmProxy, ConstraintMonitor) is defined declaratively in a JSON ontology file rather than being inferable or extensible by the LLM itself — a new SubComponent type cannot be classified into existence, it must first be registered in the ontology.


---

*Generated from 22 observations*
