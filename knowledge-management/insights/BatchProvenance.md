# BatchProvenance

**Type:** Detail

Batches are filtered by completedAt falling within [start, end], with start required (returns [] if absent) and end left open when a report is still running, avoiding a 'now' default that would drift between calls.

## What It Is

BatchProvenance is the attribution logic responsible for determining which batches legitimately belong to a given report within the Pipeline. Its centerpiece is `selectBatchesForReport()`, supported by a timestamp-parsing helper `toEpoch()`. Rather than relying on fragile string matching, BatchProvenance establishes correctness criteria based on structured fields — team identity and completion timestamps — to decide batch-to-report association.

## Architecture and Design

The defining architectural decision is the replacement of a substring-matching gate (`workflowName.includes('batch')`) with explicit, structured provenance checks. The prior approach matched against a display string, which is inherently unstable: renaming a workflow could silently break matching, and generic substring hits could over-credit batches from unrelated runs. BatchProvenance's design principle is to prefer explicit structured identity/time fields over derived or display-oriented strings whenever attribution matters.

This same philosophy — "don't guess, use defined boundaries" — recurs in the time-window filtering logic. Batches are included only when `completedAt` falls within `[start, end]`, with `start` being mandatory (an absent `start` yields an empty result rather than a permissive default) and `end` deliberately left open when a report is still running. This avoids introducing a `now`-based default that would make query results non-deterministic and drift between successive calls — an important trait for provenance data, which should be reproducible.

Team matching in `selectBatchesForReport()` follows a similarly conservative-but-permissive pattern: rejection only occurs when both `report.team` and `report.checkpointTeam` are present and mismatched. Missing data is treated as 'unknown' rather than an automatic rejection, avoiding false negatives caused by incomplete metadata while still enforcing strict checks when data is available.

## Implementation Details

- **`toEpoch()`**: A defensive ISO-timestamp parser that returns `null` for missing or invalid values instead of throwing or coercing to an arbitrary default. This null-safety is foundational, since downstream filtering logic depends on being able to distinguish "unparseable timestamp" from "valid time."
- **Exclusion of batches lacking `completedAt`**: Any batch without a completion timestamp is dropped outright from consideration, rather than being included under an assumed default. This is a deliberate conservative bias against over-attribution — better to miss a legitimate batch than to wrongly count an incomplete/unrelated one.
- **`selectBatchesForReport()`**: Combines the team-matching logic and the time-window filtering to return the final candidate set of batches tied to a report. Its logic branches are explicit: team mismatch is a filter only under full data availability, and time bounds are asymmetric (hard lower bound, open upper bound for in-flight reports).

## Integration Points

BatchProvenance sits within Pipeline, providing it (or its consumers) a reliable determination of batch/report association. Although the Related Entities note that Pipeline contains BatchProvenance, the observations do not describe the calling code paths in detail — the emphasis is purely on the correctness contract of the selection logic itself.

Structurally, BatchProvenance is conceptually adjacent to AgentSubstepTaxonomy, a sibling entity that also deals with attributing execution details (in that case, LLM usage tiers) to pipeline nodes like `kg_operators`, `git_history`, `batch_scheduler`, and `observation_generation` as defined in `multi-agent-graph.tsx`. Notably, AgentSubstepTaxonomy's `AGENT_SUBSTEPS` table is a visualization-only annotation layer that can drift from the actual execution graph (`ORCHESTRATOR_NODE`/`MULTI_AGENT_EDGES`) unless manually kept in sync. BatchProvenance, by contrast, encodes attribution logic that directly gates real batch inclusion — a stronger consistency guarantee than the display-only taxonomy, though both modules illustrate the same architectural concern: keeping derived/attributive data faithful to ground truth rather than allowing it to silently diverge.

## Usage Guidelines

- Do not reintroduce substring/display-name matching for batch-to-report attribution; use structured identity fields (team, checkpointTeam) and timestamps instead, per the documented rationale against renaming/over-crediting bugs.
- Always treat missing `start` as a hard failure case (`[]`), never default to an implicit lower bound.
- Never default `end` to `now` for in-progress reports; leave it open to preserve determinism across repeated calls.
- Treat unparseable or missing `completedAt` as exclusion criteria, not inclusion by default — this avoids over-attribution errors.
- When only one of `report.team` / `report.checkpointTeam` is present, do not treat this as a mismatch; only reject when both are present and disagree, preserving the 'unknown' semantics for partial data.
- When extending or modifying this logic, maintain the general design bias toward conservative false-negative behavior over false-positive attribution, consistent with the existing time-window and completedAt exclusions.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- multi-agent-graph.tsx defines AGENT_SUBSTEPS['kg_operators'] with sub-steps conv/aggr/embed/dedup/pred/merge, each tagged with an llmUsage tier (none/fast/standard/premium) indicating which pipeline steps invoke an LLM

### Siblings
- [AgentSubstepTaxonomy](./AgentSubstepTaxonomy.md) -- [LLM] The parent context describes AGENT_SUBSTEPS as a per-agent-node lookup table in multi-agent-graph.tsx keyed by node id (kg_operators, git_history, batch_scheduler, observation_generation), where each entry is an ordered list of substeps tagged with an llmUsage tier (none/fast/standard/premium). This is a taxonomy layered purely for visualization purposes on top of the actual execution graph declared by ORCHESTRATOR_NODE/MULTI_AGENT_EDGES — the substeps do not appear to drive runtime behavior, only annotate a node when the dashboard expands it, meaning the taxonomy can drift from the real pipeline unless someone manually keeps it synchronized with the code that actually executes the steps (e.g. the kg_operators pipeline in graphify's analyze/build/cluster modules referenced in CGR Imports).


---

*Generated from 4 observations*
