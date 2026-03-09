---
phase: 14-documentation-generation
plan: 01
subsystem: insights
tags: [plantuml, diagrams, cgr, code-evidence, relationship-diagrams]

requires:
  - phase: 13-code-graph-agent-integration
    provides: CGR observation builder and [CGR]/[LLM+CGR] tagged observations
provides:
  - Relationship diagram generator from CrossReferenceContext
  - CGR code evidence section builder for insight documents
  - New diagram storage paths (.data/knowledge-graph/insights/puml/ and images/)
  - Updated document assembly order (content -> code evidence -> diagrams -> hierarchy)
affects: [14-02, 14-03, wave-pipeline, insight-generation]

tech-stack:
  added: []
  patterns: [relationship-diagram-from-cross-references, cgr-observation-filtering, grouped-code-evidence]

key-files:
  created: []
  modified:
    - integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts

key-decisions:
  - "Relationship diagrams use PlantUML component diagram type with stereotype-based coloring"
  - "CGR evidence grouped by type: Structural, Relationships, Other -- capped at 15 items"
  - "Graceful fallback: .puml written even when plantuml CLI unavailable (success=true)"
  - "Diagram storage moved from knowledge-management/insights/ to .data/knowledge-graph/insights/"

patterns-established:
  - "Relationship diagrams: parent<<parent>>, current<<current>>, siblings<<sibling>>, children<<child>>"
  - "Code evidence extraction: filter [CGR]/[LLM+CGR] prefix, strip tags, group by regex patterns"

requirements-completed: [DOC-01, DOC-04]

duration: 4min
completed: 2026-03-09
---

# Phase 14 Plan 01: Relationship Diagrams and CGR Code Evidence Summary

**Relationship diagram generator from CrossReferenceContext + CGR code evidence sections in insight documents with new .data/knowledge-graph/insights/ storage paths**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-09T20:44:41Z
- **Completed:** 2026-03-09T20:49:09Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- PlantUMLDiagram type extended with 'relationship' variant and generateRelationshipDiagram() method
- Diagram storage paths changed to .data/knowledge-graph/insights/puml/ and images/
- generateAllDiagrams now produces architecture + relationship (replacing generic sequence/use-cases/class)
- buildCodeEvidenceSection() filters and groups [CGR]/[LLM+CGR] observations as quick-reference cards
- buildDiagramLinksSection() embeds relative image links for L1/L2 entities
- Document assembly order: content -> code evidence -> diagrams -> hierarchy context

## Task Commits

Each task was committed atomically:

1. **Task 1: Add relationship diagram generator and update diagram storage paths** - `cd5363a` (feat)
2. **Task 2: Add CGR code evidence section builder and embed in insight documents** - `4b3152d` (feat)

## Files Created/Modified
- `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts` - Added generateRelationshipDiagram(), buildCodeEvidenceSection(), buildDiagramLinksSection(), pumlDir/imagesDir properties, updated generateAllDiagrams signature and PlantUMLDiagram type

## Decisions Made
- Relationship diagrams use PlantUML component diagrams with stereotype-based coloring (<<current>> = #LightBlue, <<parent>> = #FFFFDD, etc.)
- CGR evidence grouped into Structural/Relationships/Other categories with 15-item cap
- Graceful fallback when plantuml CLI unavailable: .puml file still written, success=true
- Diagram file storage moved to .data/knowledge-graph/insights/ subdirectories

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- InsightGenerationAgent ready for Phase 14-02 (document template improvements) and 14-03 (pipeline integration)
- All diagram types and code evidence sections available for the wave pipeline

---
*Phase: 14-documentation-generation*
*Completed: 2026-03-09*
