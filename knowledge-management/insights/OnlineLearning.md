# OnlineLearning

**Type:** SubComponent

[Code References] integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx - calculateDynamicEta(): batch-aware online-learning ETA with sanity-check clamp (linearEtaMs * 0.3 to 2.0); integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx - calculateStepAwareEta(): legacy delegator to calculateDynamicEta, kept for existing call sites; integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx - HISTORY_PAGE_SIZE = 500: raised from 50 after batch-analysis run at position ~51 became unreachable; integrations/system-health-dashboard/src/components/workflow/multi-agent-graph.tsx - AGENT_SUBSTEPS: static per-agent substep/LLM-tier map for kg_operators, semantic_analysis, ontology_classification, observation_generation, persistence, insight_generation, etc.; integrations/system-health-dashboard/src/components/workflow/multi-agent-graph.tsx - WAVE_AGENTS: hardcoded fallback agent list used by getNodeStatus and shouldShowEdge for historical/completed workflow views; lib/ukb-database/cli.js - initializeDatabase(): wires DatabaseManager (SQLite + Qdrant + graphDbPath) into UKBDatabaseWriter; lib/ukb-unified/cli.js - UKBCli.defaultCommand(): checkpoint-driven incremental workflow via TeamCheckpointManager, GapAnalyzer, WorkflowOrchestrator, writing .data/ukb-last-run.json; lib/ukb-unified/core/VkbApiClient.js - isServerAvailable(): checks response.ok only, explicitly ignoring graph health flag to avoid false negatives

# OnlineLearning — Technical Insight Document

## What It Is

OnlineLearning, as a SubComponent of KnowledgeManagement, is concretely implemented in `integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx`. Despite its name, it is not a machine-learning model or weight-updating system — it is an operator-facing ETA/progress predictor for the wave-analysis workflow that "learns" the throughput characteristics of the *current run* and self-corrects as more data arrives. The central mechanism is `calculateDynamicEta()`, whose child entity **DynamicEtaCalculator** encapsulates the actual estimator logic. A legacy wrapper, `calculateStepAwareEta()`, and a companion visualization file, `multi-agent-graph.tsx`, round out the component's surface area within the system-health-dashboard integration.

![OnlineLearning — Architecture](images/online-learning-architecture.png)

## Architecture and Design

The defining pattern is an **adaptive online-learning estimator with sanity-check clamping**. `calculateDynamicEta()` computes `learnedAvgBatchMs` from batches completed within the current run, falling back to historical `workflowStats.avgBatchDurationMs` only when no batches have finished yet. This live estimate is blended with a `linearEtaMs` sanity bound, clamping results to `[linearEtaMs * 0.3, linearEtaMs * 2.0]` — preventing a noisy early sample from producing a wildly inaccurate ETA. A special case for `completedBatchCount === 1` applies a 1.2x conservative multiplier, explicitly guarding against overfitting to a single data point.

A second pattern is **legacy delegation (strangler pattern)**: `calculateStepAwareEta()` is explicitly documented as superseded, now delegating to `calculateDynamicEta()` while being "kept for compatibility with existing call sites." This reflects in-place evolution rather than atomic migration — a pragmatic but noted risk for future consolidation, especially since UI code lacks the migration-test rigor seen elsewhere in KnowledgeManagement (e.g., KMCore's migration suite for its storage backend swap).

The DynamicEtaCalculator child component itself reveals a **two-regime, hand-rolled piecewise model**: a BATCH PHASE (using `learnedAvgBatchMs` plus finalization overhead) and a FINALIZATION PHASE (using `getStepMedianDuration()` per pending/running step with a flat 50% completion assumption). These two branches share no abstraction, meaning units or accuracy could silently diverge between phases.

## Implementation Details

`calculateDynamicEta()` operates on `process.batchProgress`, comparing `currentBatch` against `totalBatches` to select its regime. In BATCH PHASE, it computes `remainingBatches * learnedAvgBatchMs` plus `workflowStats?.avgFinalizationDurationMs` (default 60000ms), then refines using the fraction of completed steps in the last `batchIterations` entry. In FINALIZATION PHASE, it sums per-step medians from `process.steps`. `HISTORY_PAGE_SIZE`, raised from 50 to 500, is a directly related implementation detail documenting a real incident: `/api/ukb/history` parses every historical report regardless of limit, so the 50-item UI cap silently hid a batch-analysis run at position ~51. The fix was purely a client-side constant, with the 500 ceiling framed in code comments as buying "several years at current rate," paired with a designed failure mode (N-of-M count plus logged warning) rather than a silent cutoff.

Adjacent but architecturally coupled is `multi-agent-graph.tsx`, which maintains two independently-authored static structures — `AGENT_SUBSTEPS` (per-agent substep/LLM-cost-tier map) and `WAVE_AGENTS` (a hardcoded fallback list of the seven pipeline stages) — used purely for visualization. `WAVE_AGENTS` specifically patches a state-derivation gap: in historical/completed view mode, `agentsInWorkflow` derived from live `effectiveSteps` is empty, so the hardcoded list prevents nodes/edges from vanishing.

![OnlineLearning — Relationship](images/online-learning-relationship.png)

## Integration Points

OnlineLearning sits within KnowledgeManagement alongside siblings ManualLearning, VkbServer, and UkbUnifiedCli, all of which converge on the same underlying knowledge substrate but via different paths. ManualLearning and UkbUnifiedCli both surface the same triple-path write architecture also noted here: `lib/ukb-database/cli.js` (direct `DatabaseManager`/`UKBDatabaseWriter` writes to SQLite + Qdrant), `lib/ukb-unified/cli.js`'s `UKBCli` (checkpoint-driven incremental workflow via `TeamCheckpointManager`, `GapAnalyzer`, `WorkflowOrchestrator`, persisting `.data/ukb-last-run.json`), and `VkbApiClient.js` (HTTP against the VkbServer on port 8080). None of these paths import each other, and only the VKB HTTP path enforces server-side query/decay logic per KnowledgeManagement's stated architecture — meaning OnlineLearning's dashboard visualizations are downstream consumers that must stay manually in sync with backend agent implementations (code-graph-agent.ts, graphify-graph.ts), with no code-graph edges enforcing that contract.

`VkbApiClient.isServerAvailable()` and the analogous `isVKBRunning()` in `lib/ukb-database/cli.js` both check `response.ok` rather than internal graph-health flags, explicitly favoring false positives over false negatives — a defensive choice that could let downstream commands proceed against a degraded VKB server.

## Usage Guidelines

Developers should treat `calculateDynamicEta()` as the canonical ETA implementation and avoid adding new call sites to the deprecated `calculateStepAwareEta()`; a future consolidation should retire the delegator once all call sites are confirmed migrated. Because `AGENT_SUBSTEPS` and `WAVE_AGENTS` duplicate pipeline knowledge with no code-level link back to actual backend agents, any change to the wave-analysis agent list or execution stages must be manually mirrored in `multi-agent-graph.tsx` — this is a documentation-only contract, not an enforced one, and is a prime candidate for future automated sync or shared type definitions. When modifying `/api/ukb/history` or similar endpoints, remember that pagination limits here function as UI truncation, not performance controls — the backend already pays full I/O cost regardless of limit, so raising `HISTORY_PAGE_SIZE` alone doesn't reduce load. Finally, when writing to the knowledge store, prefer the VKB HTTP path (via `VkbApiClient`) where possible, since it is the only path enforcing server-side validation/decay logic; direct DB writes and the incremental CLI risk diverging from that behavior over time.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- Although the code graph payload for this component was empty, the surrounding code confirms the parent's separation-of-concerns claim: multi-agent-graph.tsx defines `AGENT_SUBSTEPS` as a static, hand-authored map of every wave-analysis agent (kg_operators, semantic_analysis, ontology_classification, observation_generation, persistence, insight_generation, etc.) with per-substep `llmUsage` tiers ('none' | 'fast' | 'standard' | 'premium'). This is purely a *visualization* of the online-learning/knowledge pipeline's execution steps and LLM cost tiers — it duplicates knowledge about pipeline structure that must be kept in sync with the actual backend agents (code-graph-agent.ts, graphify-graph.ts, referenced in the parent context) but has no code-graph edges wiring it to them, meaning this sync is a manual/documentation-only contract rather than an enforced one.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component centers on the VKB (Virtual Knowledge Base) server, which acts as the primary interface for storing, querying, and decaying knowledge graph entities. This server sits atop a graph database backend (KMCore) that replaced an earlier LevelDB-based storage engine. Developers working on this component should understand that the VKB server is not just a passthrough to the database—it implements query logic, caching, and decay scheduling that must be preserved across any storage backend swap, as evidenced by the dedicated migration test suite.

### Children
- [DynamicEtaCalculator](./DynamicEtaCalculator.md) -- [LLM] calculateDynamicEta() in integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx implements a two-regime estimator that switches behavior based on process.batchProgress.currentBatch versus totalBatches: when currentBatch < totalBatches it is in the 'BATCH PHASE' and computes remainingBatches * learnedAvgBatchMs plus workflowStats?.avgFinalizationDurationMs (defaulting to 60000ms), then further refines by estimating time-left-in-current-batch using the fraction of completed steps in the last entry of batchIterations. When currentBatch >= totalBatches && totalBatches > 0 it switches to 'FINALIZATION PHASE' and instead sums getStepMedianDuration() per pending/running step from process.steps, applying a flat 50% completion assumption for any step in 'running' status. This is a hand-rolled piecewise model with no shared abstraction between the two phases — the finalization branch does not reuse learnedAvgBatchMs at all, and the batch branch does not use per-step medians, so the two estimation strategies could silently diverge in units or accuracy without either one being tested against the other.

### Siblings
- [ManualLearning](./ManualLearning.md) -- [LLM] The 'ManualLearning' component, as represented by the supplied files, is not a single cohesive module but a set of parallel entry points into the same knowledge-graph substrate: `lib/ukb-database/cli.js` writes via `DatabaseManager`/`UKBDatabaseWriter` directly to SQLite + Qdrant, `lib/ukb-unified/cli.js` orchestrates a higher-level incremental workflow via `WorkflowOrchestrator`/`TeamCheckpointManager`/`GapAnalyzer`, and `lib/ukb-unified/core/VkbApiClient.js` talks to the same data over HTTP against a running VKB server (`http://localhost:8080`). This means there are at least three distinct code paths capable of mutating the same knowledge entities/relations — direct DB writes, HTTP API writes, and an orchestrated incremental pipeline — and nothing in the shown code enforces that they can't race or diverge.
- [VkbServer](./VkbServer.md) -- [CGR] VKBServer (class) in index.js
- [UkbUnifiedCli](./UkbUnifiedCli.md) -- [LLM] lib/ukb-unified/cli.js implements the UKBCli class as the top-level entry point for knowledge base updates, and its defaultCommand() method (around line ~150) encodes a deliberate incremental-first philosophy: it loads a TeamCheckpointManager checkpoint, and if none exists it explicitly refuses to run a full analysis, instead printing a recommendation to use `ukb --full`. This is a safety valve against an unbounded first-run cost (analyzing the entire git history and session log corpus) being triggered accidentally by a bare `ukb` invocation — the CLI treats 'first run' as a distinct, opt-in code path rather than silently falling back to full analysis.


---

*Generated from 10 observations*
