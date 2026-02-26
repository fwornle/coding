# UKB Pipeline Fix & Improvement

## What This Is

A diagnostic and repair project for the Universal Knowledge Base (UKB) multi-agent analysis pipeline in `integrations/mcp-server-semantic-analysis`. The pipeline is designed to analyze a repository and produce knowledge graph entities — each with meaningful observations and rich insight documents (detailed markdown reports with PlantUML diagrams, code examples, and architectural analysis). Currently it runs to completion but produces trivial observations and zero insight documents.

## Core Value

Running `ukb full` on a codebase must produce meaningful, high-quality knowledge graph entities with linked insight documents — not trivial commit-message paraphrases.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Diagnose why the multi-agent pipeline produces 0 insight documents
- [ ] Diagnose why observations are trivial (commit-message parroting) instead of meaningful analysis
- [ ] Fix insight document generation to produce rich reports (like MVIReduxArchitecturePattern.md — with diagrams, code examples, practical guidance)
- [ ] Fix entity naming (currently producing mangled names like "PathanalyzerpatternProblemHowConsider")
- [ ] Fix observation quality — observations should capture significant architectural patterns, design decisions, key components, conventions
- [ ] Ensure the pipeline discovers all categories: architecture patterns, significant components, system design decisions, integration approaches, conventions
- [ ] Preserve the batched execution mode (this is working and wanted)
- [ ] Improve overall analysis quality to match or exceed the early-stage pipeline output

### Out of Scope

- VKB viewer changes — the viewer is fine
- Knowledge graph storage layer changes — storage/export is fine
- Reducing agent count — the 13-14 agent architecture stays, we fix what's broken
- Changing the MCP server interface — the `ukb full` invocation stays the same

## Context

- **Pipeline location:** `integrations/mcp-server-semantic-analysis`
- **Knowledge graph storage:** `.data/knowledge-graph/` (Graphology + LevelDB + JSON exports)
- **Export file:** `.data/knowledge-export/coding.json` (57 entities currently, mostly low quality)
- **Insight documents location:** `knowledge-management/insights/` (good example: `MVIReduxArchitecturePattern.md`)
- **Known good output:** The `MVIReduxArchitecturePattern.md` insight document represents the quality target — multi-section analysis with diagrams, code examples, significance ratings, implementation guidance
- **Known bad output:** Recent entities like `PathanalyzerpatternProblemHowConsider` — mangled name, observation is just a commit message paraphrase, no insight document
- **History:** Pipeline worked better in early stages with 5-6 agents. Now has 13-14 agents. The issue isn't agent count — suspected causes include different models, different prompts, batched mode interaction effects
- **Batched mode:** The batch processing approach is good and should be preserved

## Constraints

- **Scope:** Only the `integrations/mcp-server-semantic-analysis` pipeline — no viewer or storage changes
- **Interface:** The `mcp__semantic-analysis__execute_workflow` MCP tool invocation must remain unchanged
- **Architecture:** Keep the existing multi-agent structure; fix what's broken rather than redesign from scratch

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fix existing pipeline, not redesign | Pipeline worked before — something regressed | — Pending |
| Keep batched execution mode | User confirmed it's working and wanted | — Pending |
| Scope limited to semantic-analysis MCP server | Storage and viewer are functioning correctly | — Pending |

---
*Last updated: 2026-02-26 after initialization*
