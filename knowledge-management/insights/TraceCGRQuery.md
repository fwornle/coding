# TraceCGRQuery

**Type:** Detail

[LLM+CGR] TraceCGRQuery is defined as a TypeScript interface in integrations/system-health-dashboard/src/store/slices/ukbSlice.ts (not a class, despite the code graph's classification), with an explicit comment marking it 'Phase 13 - mirrors backend TraceCGRQuery'. This is a deliberate frontend/backend type duplication rather than a shared package import: the interface fields (id, queryType, entityName, cypherQuery?, resultCount, durationMs, cacheHit, status, error?) are hand-copied to avoid a cross-package import, following the same pattern already used for TraceLLMCall, TraceAgentInstance, TraceEntityFlow, and TraceQAResult in the same file. The second occurrence the code graph reports in types.ts is presumably the backend source-of-truth this comment refers to, meaning any change to the backend's TraceCGRQuery shape (e.g. adding a new queryType variant) requires a manual, uncompiler-enforced sync into ukbSlice.ts or the trace UI silently drops or misrenders new fields.

# TraceCGRQuery — Technical Insight Document

## What It Is

`TraceCGRQuery` is a TypeScript interface defined in `integrations/system-health-dashboard/src/store/slices/ukbSlice.ts`, explicitly commented as "Phase 13 - mirrors backend TraceCGRQuery." The code graph also reports an occurrence in `types.ts`, which is understood to be the backend source-of-truth this comment refers to. Despite being classified as a "class" by the code graph tooling, it is a plain interface with the shape: `id`, `queryType`, `entityName`, `cypherQuery?`, `resultCount`, `durationMs`, `cacheHit`, `status`, and `error?`.

Functionally, it is a telemetry/trace contract for Code Graph RAG (CGR) queries — structural code queries such as component-to-entity resolution, entity detail lookups, call-graph traversal, and index refresh — rather than a data model for the graph itself. It sits under the CodeGraphAgent parent entity, which notably has no direct AST-indexing or call-graph implementation present in the supplied sources; `TraceCGRQuery` is effectively the only visible artifact of that subsystem's existence in this codebase slice, serving as an observability surface for a query engine that lives elsewhere (likely a Memgraph-backed indexer).

## Architecture and Design

The dominant architectural pattern is **frontend/backend type mirroring by hand-copy** rather than a shared types package. `TraceCGRQuery` in `ukbSlice.ts` is deliberately duplicated from its backend counterpart in `types.ts`, following the same convention already applied to sibling interfaces `TraceLLMCall`, `TraceAgentInstance`, `TraceEntityFlow`, and `TraceQAResult` in the same file. There is no shared package, schema validation, or codegen enforcing this synchronization — drift risk is documented only in a code comment, meaning a backend change (e.g., a new `queryType` variant) requires a manual, uncompiler-enforced update to the frontend or the trace UI will silently drop or misrender new fields.

A second pattern is **per-step event-log aggregation**: `StepInfo.cgrQueryEvents?: TraceCGRQuery[]` allows each workflow step to carry zero or more CGR query traces, co-located with `llmCallEvents`, `tokensUsed`, and `llmProvider`. This positions CGR queries as a first-class, per-step event stream analogous to LLM call tracing, intended for a trace inspector (plausibly `TraceModal`, imported in `ukb-workflow-modal.tsx` from `./workflow`).

Notably, `TraceCGRQuery` and its sibling Trace* interfaces do **not** share a common base interface despite structural overlap (status, error, duration-like fields). This is a missed-opportunity pattern — a `TraceEventBase<TStatus>` generic could reduce duplication — but each interface was evidently authored independently to match its subsystem's real failure modes.

## Implementation Details

The `queryType` field is a closed union — `'component_entities' | 'entity_details' | 'call_graph' | 'index_refresh'` — encoding the CGR query taxonomy directly into the Redux slice's type layer. This is architecturally distinct from the generic Entity/Relation graph model consumed by `D3GraphCanvas.tsx`, whose `D3Node` interface uses generic `entityType`/`ontologyClass` fields rather than code-structure-specific ones. This contrast reinforces that CGR query tracing is a separate concern from ontology-driven graph visualization.

The `status` field is a three-state discriminated union — `'success' | 'failed' | 'timeout'` — stricter than the two-state patterns seen elsewhere and distinct from `TraceLLMCall`'s `'success' | 'failed' | 'retried'`. This asymmetry reflects genuine differences in failure semantics: timeout is meaningful for a Cypher-backed lookup, while retry is meaningful for LLM calls. The optional `cypherQuery` field, combined with the `code_graph` agent's "query" substep in `multi-agent-graph.tsx` (`AGENT_SUBSTEPS.code_graph[1]`, techNote: "Cypher queries on Memgraph"), implies the CGR backend executes against a Cypher-compatible graph database, most likely Memgraph — though this link is inferential, based on shared domain vocabulary rather than a direct import or call relationship.

The optional `error` field alongside `status` follows the same soft-typing convention used throughout `ukbSlice.ts` (e.g., `StepInfo.error`, `TraceQAResult.errors`): errors are optional strings/arrays rather than typed unions, so the type system cannot guarantee `error` is present when `status !== 'success'`. Consumers must always null-check regardless of status, a trade-off likely rooted in mirroring a backend's JSON serialization where such guarantees can't be enforced at compile time.

## Integration Points

`TraceCGRQuery` integrates into the system primarily through `StepInfo.cgrQueryEvents`, making it a consumable field within the broader workflow trace model in `ukbSlice.ts`. It shares this file with sibling trace interfaces (`TraceLLMCall`, `TraceAgentInstance`, `TraceEntityFlow`, `TraceQAResult`), all likely surfaced together in a trace inspector UI. Its only cross-file connection is the implicit domain link to `multi-agent-graph.tsx`'s `code_graph` agent substep description ("Cypher queries on Memgraph") — no direct import or function call ties the two together in the supplied evidence.

Within its hierarchy, `TraceCGRQuery` is a child concern of the **CodeGraphAgent** parent entity, which itself has no visible implementation in these sources — meaning this interface stands in as the primary observable evidence of that agent's behavior at the type level. It has no relationship to sibling entities **HierarchyParentDerivation** (which governs color/shape inheritance in `color-fallback.ts` for the generic graph visualization layer) or **LearningSourceClassifier** (`isOnlineLearned` in `learning-source.ts`), both of which serve the ontology-driven rendering pipeline in `D3GraphCanvas.tsx` — a pipeline explicitly noted as architecturally separate from CGR's code-structure-specific tracing concern.

## Usage Guidelines

Developers extending the backend `TraceCGRQuery` type (in `types.ts`) must manually propagate any field or `queryType` union changes into `ukbSlice.ts`'s mirrored interface; there is no compiler or schema check to catch drift, so new query types or fields will silently fail to render in the trace UI until updated. When consuming `TraceCGRQuery` instances, always null-check `error` even when `status` indicates `'failed'` or `'timeout'`, since the type system offers no guarantee of its presence. When adding new trace types alongside `TraceCGRQuery`, consider whether the existing lack of a shared base interface across `TraceLLMCall`, `TraceAgentInstance`, `TraceEntityFlow`, `TraceQAResult`, and `TraceCGRQuery` should be revisited, since consolidating common fields (status-like, error, duration) into a shared generic would reduce future duplication risk. Finally, treat `TraceCGRQuery` strictly as a tracing/telemetry contract, not a data model — it should not be conflated with the generic Entity/Relation types used in `D3GraphCanvas.tsx`, which serve the unrelated ontology visualization concern.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- TraceCGRQuery (class) in ukbSlice.ts
- TraceCGRQuery (class) in types.ts

**Other:**
- TraceCGRQuery is defined as a TypeScript interface in integrations/system-health-dashboard/src/store/slices/ukbSlice.ts (not a class, despite the code graph's classification), with an explicit comment marking it 'Phase 13 - mirrors backend TraceCGRQuery'. This is a deliberate frontend/backend type duplication rather than a shared package import: the interface fields (id, queryType, entityName, cypherQuery?, resultCount, durationMs, cacheHit, status, error?) are hand-copied to avoid a cross-package import, following the same pattern already used for TraceLLMCall, TraceAgentInstance, TraceEntityFlow, and TraceQAResult in the same file. The second occurrence the code graph reports in types.ts is presumably the backend source-of-truth this comment refers to, meaning any change to the backend's TraceCGRQuery shape (e.g. adding a new queryType variant) requires a manual, uncompiler-enforced sync into ukbSlice.ts or the trace UI silently drops or misrenders new fields.
- The queryType field is a closed union ('component_entities' | 'entity_details' | 'call_graph' | 'index_refresh') that encodes the Code Graph RAG (CGR) query taxonomy directly into the Redux slice's type layer. This hints at a CGR subsystem that services structural code queries (component→entity resolution, entity detail lookups, call-graph traversal, and index maintenance) as a distinct concern from the generic Entity/Relation graph model used in D3GraphCanvas.tsx — corroborating the parent entity's observation that entity/relation consumption in the viewer is generic while TraceCGRQuery is code-structure-specific. No AST-indexing or call-graph implementation code was present in the supplied files, so this interface is effectively a telemetry/observability contract for a call-graph query engine whose implementation lives elsewhere (likely graphify or a Memgraph-backed indexer, per repository conventions).


## Hierarchy Context

### Parent
- [CodeGraphAgent](./CodeGraphAgent.md) -- No direct AST-indexing or call-graph code was present in the provided source files; entity/relation consumption in D3GraphCanvas.tsx treats entities generically via the Entity/Relation types rather than code-structure-specific fields.

### Siblings
- [HierarchyParentDerivation](./HierarchyParentDerivation.md) -- [LLM] The `nodeFillColor` and `nodeShapeFor` functions in integrations/unified-viewer/src/graph/color-fallback.ts implement the actual 'hierarchy parent derivation' logic referenced by this component: each walks `registry.get(cur)?.parent` in a `while` loop (guarded by a `seen` Set to prevent infinite loops on cyclic registries) until it finds a `display.color`/`display.shape` override, a hit in the static `BATCH_PALETTE`/`SHAPE_PALETTE` tables, or exhausts the ancestor chain and falls back to `DEFAULT_BATCH`/`'circle'`. This is the mechanism that lets an L2 ontology class like `LiveLoggingSystem` inherit `Component`'s blue fill without an explicit palette entry, which is exactly the kind of code-derived-vs-canonical resolution the parent entity's observations describe.
- [LearningSourceClassifier](./LearningSourceClassifier.md) -- [LLM] The component under analysis — 'LearningSourceClassifier' — is not a class in these files but the exported function `isOnlineLearned` from `integrations/unified-viewer/src/graph/learning-source.ts` (a file referenced by import but not included in the provided sources). Its call sites are visible: `color-fallback.ts` imports it at the top and calls it inside `classColor()` as `isOnlineLearned({ metadata: { source } })`, and `D3GraphCanvas.tsx` imports it directly (`import { isOnlineLearned } from './learning-source'`) alongside `nodeFillColor`/`ONLINE_RING_COLOR` from `color-fallback.ts`. The classifier's actual decision logic is opaque here — only its consumers and their comments describe its contract.


---

*Generated from 11 observations*
