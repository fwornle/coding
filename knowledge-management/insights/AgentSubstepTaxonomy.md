# AgentSubstepTaxonomy

**Type:** Detail

[Architecture Notes] Presentation-layer taxonomy (AGENT_SUBSTEPS in multi-agent-graph.tsx) appears decoupled from the actual execution/routing config (llm-routing.yaml), creating a manual-sync burden between what the dashboard displays and what the pipeline actually runs; Batch completion state is persisted independently of any single report/run (.data/batch-checkpoints.json), requiring downstream consumers like batch-provenance.mjs to reconstruct provenance via time-window matching rather than direct foreign-key-style linkage; Distinct substep topologies coexist under one taxonomy abstraction: linear chains (git_history, kg_operators) vs. stateful/resumable cycles (batch_scheduler, observation_generation), suggesting the taxonomy type may need to be a discriminated union rather than a flat list shape; No code-graph evidence was available to confirm the internal implementation of AGENT_SUBSTEPS itself — analysis here is limited to what the parent observations state and to structurally analogous, verified code in batch-provenance.mjs

# AgentSubstepTaxonomy — Technical Insight Document

## What It Is

AgentSubstepTaxonomy refers to the `AGENT_SUBSTEPS` lookup table declared in `multi-agent-graph.tsx`, a per-agent-node map keyed by node id (`kg_operators`, `git_history`, `batch_scheduler`, `observation_generation`) whose values are ordered lists of substeps, each annotated with an `llmUsage` tier (`none`/`fast`/`standard`/`premium`). It belongs conceptually to the Pipeline entity, since its parent component context is precisely the `kg_operators` entry — `conv`/`aggr`/`embed`/`dedup`/`pred`/`merge` — each tagged for whether it invokes an LLM and at what cost tier. Critically, this taxonomy is a presentation-layer artifact: it sits on top of, but is structurally independent from, the actual execution graph declared via `ORCHESTRATOR_NODE`/`MULTI_AGENT_EDGES` (imported from `./constants`). It exists to let the dashboard render an expanded node's internal steps, not to drive runtime behavior.

## Architecture and Design

The defining architectural pattern is a **declarative lookup-table taxonomy layered over a separately-declared graph topology**. `AGENT_SUBSTEPS` and `ORCHESTRATOR_NODE`/`MULTI_AGENT_EDGES` are two independent declarations describing the same underlying pipeline from different angles (execution topology vs. per-node substep detail), with no evident mechanism forcing them to stay consistent.

A second pattern is **tiered cost/latency annotation**: rather than deriving `llmUsage` from the live routing configuration (`llm-routing.yaml`, `prompt-classifier.yaml`), the taxonomy hardcodes it. This mirrors a duplication risk CLAUDE.md already flags elsewhere in the project for `taskType`/`complexity` mismatches — a routing change could silently desynchronize from what the dashboard displays.

A third pattern, visible by contrasting the four node entries, is the coexistence of **two distinct substep topologies** under one flat abstraction: linear/stateless chains (`git_history`'s fetch→diff→extract, `kg_operators`'s conv/aggr/embed/dedup/pred/merge) versus stateful/checkpointed cycles (`batch_scheduler`'s plan/track/resume, `observation_generation`'s generate/accumulate). This suggests the taxonomy's real shape is a discriminated union rather than a uniform list, since resumable loops and one-shot transformations likely need different visual treatments (progress/spinner vs. checkmark chain).

## Implementation Details

Each `AGENT_SUBSTEPS[nodeId]` entry is an ordered array of substep descriptors carrying at minimum a label and an `llmUsage` tier. For `kg_operators`, the six steps trace the graphify pipeline's analyze/build/cluster stages (conv, aggr, embed, dedup, pred, merge), each independently priceable via its tier. For `observation_generation`, the split between a premium-tier `generate` step and a non-LLM `accumulate` step (which dedups across batch iterations) separates the expensive/authoritative operation from cheap bookkeeping — structurally the same design as sibling **BatchProvenance**, whose `batch-provenance.mjs` separates costly window-based attribution from lightweight file-based checkpoint matching.

For `batch_scheduler`, the plan/track/resume substeps correspond structurally to the checkpoint-driven mechanics verified in `batch-provenance.mjs`'s `selectBatchesForReport()`, which reads `.data/batch-checkpoints.json` and attributes batches to a report by matching `completedAt` against a `[startTime, endTime]` window rather than by name. The taxonomy's "resume" substep and the provenance function's window-based attribution are two independent solutions to the same fact: batch completion state persists independently of any single report run and must be reconciled after the fact, not tracked live. `toEpoch()` in the same file provides null-safe timestamp parsing supporting this reconciliation.

## Integration Points

The taxonomy's primary dependency is presentational: it's consumed by `multi-agent-graph.tsx`'s dashboard rendering when a node is expanded, alongside `ORCHESTRATOR_NODE`/`MULTI_AGENT_EDGES` from `./constants`, which define the actual executable graph. Its conceptual (but not code-level) dependency is on the live routing configuration files (`llm-routing.yaml`, `prompt-classifier.yaml`), which are the actual source of truth for model/tier assignment — a dependency that is currently unlinked and must be manually kept in sync.

Structurally, it shares design DNA with sibling BatchProvenance: `batch_scheduler`'s plan/track/resume and `observation_generation`'s generate/accumulate both echo the expensive-step/cheap-bookkeeping split and checkpoint-reconciliation approach proven out in `batch-provenance.mjs`. Notably, BatchProvenance's own history — replacing a fragile `workflowName.includes('batch')` substring gate because it could silently over-credit unrelated runs on rename — is directly relevant conservative-design precedent for the taxonomy if it ever moves from purely presentational to deriving real per-step timing/status from checkpoint data.

## Usage Guidelines

Anyone modifying the pipeline's actual execution steps (e.g., graphify's analyze/build/cluster modules, or routing config for `embed`/`pred`) must manually update the corresponding `AGENT_SUBSTEPS` entry, since there is no automated sync between the taxonomy and either the execution graph or the routing config — drift here is silent and only visible on inspection. When adding new node types, developers should recognize the two existing substep shapes (linear chains vs. stateful/checkpointed cycles) and choose the appropriate one rather than forcing every node into a flat, uniform substep list; a discriminated-union type may better express this going forward.

Should the taxonomy ever be wired to real checkpoint/timing data rather than static tier labels, it should adopt the same "under-report rather than over-credit" bias evident in `batch-provenance.mjs`: missing or ambiguous per-step timestamps should render as "unknown" rather than being silently attributed to the wrong step or run, consistent with that module's fail-safe defaults (returning `[]` for null `start`, excluding batches lacking `completedAt`, rejecting only on definite team mismatch).


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- multi-agent-graph.tsx defines AGENT_SUBSTEPS['kg_operators'] with sub-steps conv/aggr/embed/dedup/pred/merge, each tagged with an llmUsage tier (none/fast/standard/premium) indicating which pipeline steps invoke an LLM

### Siblings
- [BatchProvenance](./BatchProvenance.md) -- The module replaces a prior `workflowName.includes('batch')` gate, explaining in comments that a substring match on a display string would silently break on rename and over-credit batches from unrelated runs.


---

*Generated from 9 observations*
