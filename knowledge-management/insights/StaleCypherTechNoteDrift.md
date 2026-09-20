# StaleCypherTechNoteDrift

**Type:** Detail

# StaleCypherTechNoteDrift — Technical Insight Document

## What It Is

StaleCypherTechNoteDrift is a documentation-accuracy defect located precisely at `AGENT_SUBSTEPS['code_graph']` in `integrations/system-health-dashboard/src/components/workflow/multi-agent-graph.tsx`. Within that entry, the `query` sub-step object (`id: 'query', name: 'Graph Querying'`) carries `techNote: 'Cypher queries on Memgraph'` — a static, hand-authored string describing a backend that no longer exists. Its parent entity, CodeGraphAgent, has already migrated to GraphifyGraph's static `graph.json` reader, so this label is a factual contradiction baked directly into the UI layer rather than into any runtime-derived data. Notably, the drift is partial: the sibling `index` sub-step's techNote ('AST parsing via tree-sitter') remains accurate, meaning two of three descriptions in the same array are trustworthy while the middle one silently misleads.

## Architecture and Design

The root cause is structural: `AGENT_SUBSTEPS` is a single monolithic `Record<string, SubStep[]>` spanning ten unrelated agents — kg_operators, semantic_analysis, ontology_classification, observation_generation, git_history, quality_assurance, batch_scheduler, insight_generation, vibe_history, code_graph, persistence — each with inline `techNote` strings hand-describing implementation technology. This is a "static metadata table as UI copy" pattern: there is no lint rule, test, or code-graph cross-reference tying any techNote to the source it purports to describe, so code_graph/query is simply the instance that happened to get caught because the Memgraph→GraphifyGraph migration was recent and well-documented elsewhere.

Interestingly, the same file demonstrates that the authors *are* capable of eliminating drift risk when motivated: a comment block directly above `AGENT_SUBSTEPS` explains that node/edge/substep colors now flow from the centralized, theme-aware `useWorkflowColors()`/`src/lib/colors.ts`, replacing what were presumably once-duplicated per-hue CSS overrides. This is an asymmetric maintenance investment — color logic was centralized and stayed in sync through the backend migration, while textual metadata (descriptions, techNotes, llmUsage) remained inline literals with no equivalent single source of truth.

A structurally analogous pattern exists in a sibling area of the codebase: `integrations/unified-viewer/src/graph/color-fallback.ts`'s `nodeFillColor()`/`nodeShapeFor()` walk a `ClassRegistryEntry` parent chain against hardcoded `BATCH_PALETTE`/`SHAPE_PALETTE` tables (Project/Component/SubComponent/Detail/System) instead of consistently preferring live registry display data. Both cases are small, static, colocated lookup tables trusted implicitly after initial authorship — the difference being that color-fallback's drift risk is cosmetic, whereas AGENT_SUBSTEPS's is informational and diagnostic.

## Implementation Details

`SubStep` is defined via `export interface SubStep` in `multi-agent-graph.tsx`, where `techNote` is an optional `string` field used purely for display. This type has no counterpart in the Redux-facing `StepInfo` interface (`ukbSlice.ts`) or in `WorkflowExecutionState.stepStatuses`, meaning there is no live-data path — no dispatch, selector, or runtime update — that could ever overwrite or validate the string. It is compiled into the JS bundle as a literal and will read 'Cypher queries on Memgraph' until a developer manually edits it.

Because `techNote` is read only for rendering and nothing else in the provided files branches on its content, the fix is architecturally trivial: a one-line literal change (e.g., referencing GraphifyGraph's static `graph.json` read and `graphify-graph.ts`'s mtime-based lazy caching) carries zero downstream type or logic implications. This stands in sharp contrast to the `checkMemgraphConnection` preserved-method-name trap noted in CodeGraphAgent's backend shim, where the drift sits on load-bearing API surface rather than decorative text — a useful distinction when triaging which "Memgraph residue" issues are cosmetic versus functionally risky.

## Integration Points

The stale value is not merely stored — it is actively rendered. `ukb-workflow-modal.tsx` imports `AGENT_SUBSTEPS` directly from `./workflow` and passes it through `MultiAgentGraph` (aliased as `UKBWorkflowGraph`), which is what paints the workflow visualization inside the modal (`UKBWorkflowModalProps` wires `processes`/`apiBaseUrl` into that component). This means the stale label is directly operator-visible whenever someone inspects the live or historical workflow graph for CodeGraphAgent, making the drift a diagnostic-UI concern rather than an inert dead string.

The absence of any cross-reference mechanism between AGENT_SUBSTEPS entries and the real implementations of any of the ten agents (kg_operators, semantic_analysis, ontology_classification, observation_generation, git_history, quality_assurance, batch_scheduler, insight_generation, vibe_history, persistence) means code_graph/query should be treated as a sentinel instance of a broader latent-drift class, not an isolated bug.

## Usage Guidelines

When editing CodeGraphAgent-related backend logic, developers should treat `AGENT_SUBSTEPS['code_graph']` as documentation debt requiring a manual sync check, since no automated system will flag inconsistency. Given the safety of `techNote`'s decorative, display-only role, corrections here are low-risk and should be made proactively during any backend migration, ideally alongside a broader audit of the other nine agents' techNote strings for the same class of drift. Longer-term, the asymmetry between the centralized color system and the inline textual metadata suggests an opportunity: applying the same centralization discipline used for `useWorkflowColors()`/`lib/colors.ts` to techNote/description strings — perhaps by deriving them from actual agent implementation metadata — would close this entire class of drift rather than requiring one-off literal edits each time a backend like CodeGraphAgent's is swapped.


## Hierarchy Context

### Parent
- [CodeGraphAgent](./CodeGraphAgent.md) -- [LLM] There is a concrete documentation-drift artifact visible in integrations/system-health-dashboard/src/components/workflow/multi-agent-graph.tsx: the `AGENT_SUBSTEPS['code_graph']` array still describes its `query` sub-step with `techNote: 'Cypher queries on Memgraph'` (multi-agent-graph.tsx, code_graph entry, 'query' id). This directly contradicts the parent-context claim that CodeGraphAgent now delegates every call to GraphifyGraph's static graph.json reader and no longer speaks Cypher to a live Memgraph instance. Because this dashboard copy is what renders in the UKB workflow visualization modal (ukb-workflow-modal.tsx via MultiAgentGraph), any operator inspecting the live workflow graph is shown stale technology labels for a component whose backend was already migrated — exactly the kind of subtle trap the parent observation warned about with `checkMemgraphConnection` being a preserved-but-stubbed method name.


---

*Generated from 9 observations*
