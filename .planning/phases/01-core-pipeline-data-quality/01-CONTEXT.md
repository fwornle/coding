# Phase 1: Core Pipeline Data Quality - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the data quality layer of the UKB multi-agent analysis pipeline so it produces real, meaningful content. Specifically: fix pattern extraction parsing, fix entity naming, replace template observations with LLM-synthesized content, and switch analysis depth to 'deep'. This phase produces quality data that Phase 2 (insight generation) depends on.

</domain>

<decisions>
## Implementation Decisions

### Pattern Parsing
- Multi-format parser: handle markdown lists, JSON, plain text — parse whatever the LLM sends
- On parse failure: retry with explicit format hints in the prompt (Claude decides retry count)
- Keep all extracted patterns across batches — downstream dedup handles merging
- Let the codebase determine what's significant — don't constrain to architecture-only patterns

### Entity Naming
- PascalCase descriptive names (target format: MVIReduxArchitecturePattern, BatchSchedulerComponent)
- Hybrid naming source: use actual code identifiers (class names, module names) when they exist, LLM-generated names for abstract patterns
- Include type suffix (Pattern, Service, Component) when it adds clarity, omit when self-explanatory

### Observation Content
- Observations must contain analysis + evidence: what the pattern/component IS, WHY it matters, WHERE it appears
- No file/line-number references in observations (avoids staleness as code evolves)
- LLM-synthesized content, never template strings or commit-message paraphrases

### Analysis Depth
- Switch from 'surface' to 'deep' analysis
- Include full file contents in LLM prompts (not just diffs/signatures)
- Include broader context: imports, dependencies, callers — understand how changed code fits the system
- Cross-batch pattern synthesis in the finalization pass
- Quality over token cost — rather have 10 great entities than 50 shallow ones

### Error Visibility
- On step failure: log error clearly and continue pipeline (partial results > nothing)
- End-of-run summary always: X entities created, Y patterns extracted, Z errors encountered

### Batch Boundaries
- Merge batches that touch the same files/modules for richer context
- Claude decides optimal window size

### Quality Threshold
- Target: 30-50 significant entities for a repo this size
- Dual-signal threshold: LLM assigns significance (1-10, filter below 5) AND evidence frequency (must appear in multiple commits or span multiple files)
- Merge intelligently with existing entities from previous runs — keep good existing, update stale, add new

### Claude's Discretion
- Model tier selection for pattern extraction
- Retry count on parse failures
- Observation count per entity
- Whether to include pattern evolution from git history
- Handling large files that exceed context windows
- Repo structure context level
- Batch window size optimization
- Logging approach (existing vs structured)

</decisions>

<specifics>
## Specific Ideas

- The MVIReduxArchitecturePattern.md insight document represents the quality bar — entities should carry the depth of analysis that feeds into documents of that caliber
- Entity like "PathanalyzerpatternProblemHowConsider" is the anti-example — mangled name, trivial observation, no insight value
- The pipeline currently has 57 entities, almost all at significance 0.5 with identical template observations — this entire set is essentially useless

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-core-pipeline-data-quality*
*Context gathered: 2026-02-26*
