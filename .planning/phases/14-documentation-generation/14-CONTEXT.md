# Phase 14: Documentation Generation - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend InsightGenerationAgent to generate PlantUML architecture and relationship diagrams for L1/L2 entities, compile to PNG, and embed in insight markdown documents. Consolidate constraint validation into a single pre-persistence gate within semantic-analysis. Enrich all entity insight docs with CGR code evidence sections and diagram links.

</domain>

<decisions>
## Implementation Decisions

### Docs agent identity
- Extend existing InsightGenerationAgent — NOT a new standalone agent
- Two diagram types generated: architecture diagrams and component diagrams
- Diagram scope: L1 (Component) and L2 (SubComponent) entities only — L0 too broad, L3 too granular
- Diagram content: Hybrid CGR + LLM — CGR data for concrete dependencies/call graphs, LLM fills in architectural concepts and design patterns
- PNG compilation during pipeline run (Wave 4 finalization) via `plantuml` CLI, adding ~1-2s per diagram
- Graceful fallback: if plantuml CLI unavailable, keep .puml files and skip PNG compilation. Insight docs link to .puml instead. Pipeline does not fail
- Uses existing standard style (`docs/puml/_standard-style.puml`)

### Diagram storage
- .puml files stored in `.data/knowledge-graph/insights/puml/`
- PNG images stored in `.data/knowledge-graph/insights/images/`
- Insight docs reference PNGs with relative paths

### Relationship diagrams
- Separate .puml file from architecture diagram — each L1/L2 entity gets TWO diagrams
- Shows hierarchy tree: 1 level up (parent) + current entity + 1 level down (children) + siblings at same level
- Current entity highlighted with distinct color/border for visual identification
- For an L2 SubComponent: shows L1 parent, L2 siblings, L3 children

### Constraint validation
- New validation gate within mcp-server-semantic-analysis — NOT mcp-constraint-monitor (which stays for Claude Code tool-use constraints)
- Blocking pre-persistence gate — entities that fail are rejected with feedback
- Consolidate with Phase 11's content-validation-agent into a single unified gate
- Four constraint rules:
  1. Entity naming: PascalCase, no generic names (reuse existing blocklist)
  2. Observation count: minimum 3+ meaningful observations
  3. Content quality: multi-sentence observations, no hallucination markers, code-grounded where applicable
  4. Hierarchy integrity: valid parentId exists in KG, level matches path depth, hierarchyPath valid
- Rejections visible in logs (per success criteria)

### KB markdown enrichment
- Two enrichments: diagram image links AND CGR code evidence sections
- Diagram image links (L1/L2 only): `![architecture](images/EntityName-architecture.png)` and `![relationships](images/EntityName-relationships.png)`
- CGR code evidence sections (ALL entities L0-L3): summaries + key signatures (file paths, function signatures, import chains, complexity metrics) — no full code blocks
- Code evidence section placement: after observations, before hierarchy context
- Document flow: Observations → Code Evidence → Diagrams → Hierarchy Context

### Claude's Discretion
- Exact PlantUML syntax and layout choices for both diagram types
- How to consolidate content-validation-agent checks with new constraint rules (extend class vs refactor)
- Error handling for individual diagram compilation failures
- Naming convention for .puml and .png files (e.g., EntityName-architecture.puml)
- How to extract CGR summary data from existing entity observations vs re-querying CGR

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `InsightGenerationAgent` (insight-generation-agent.ts): Already has `PlantUMLDiagram` interface, `plantumlAvailable` check, `generateAllDiagrams()`, `standardStylePath`
- `PlantUMLDiagram` type (insight-generation-agent.ts:32): Has type ('architecture'|'sequence'|'use-cases'|'class'), name, content fields
- `content-validation-agent.ts`: Existing content validation logic from Phase 11 — consolidation target
- `CgrObservationBuilder` (Phase 13): Formats CGR data — can extract summaries for code evidence sections
- `CgrQueryCache` (Phase 13): Cached CGR queries per component — reuse for diagram data
- `CrossReferenceContext` type: Used by InsightGenerationAgent for hierarchy cross-references — feeds relationship diagrams
- `docs/puml/_standard-style.puml`: Existing PlantUML style sheet

### Established Patterns
- Wave 4 finalization: InsightGenerationAgent runs after all waves complete, with full cross-reference data
- Fire-and-forget trace capture (Phase 12): Extend for diagram generation traces
- Observation source tags `[CGR]`/`[LLM]`/`[LLM+CGR]` (Phase 13): Use to identify CGR-grounded content for code evidence sections
- Content validation gate (Phase 11): Pre-persistence blocking pattern to extend

### Integration Points
- `wave-controller.ts` Wave 4: InsightGenerationAgent already called here — extend with diagram generation and enrichment
- `persistence-agent.ts`: Pre-persistence validation gate — consolidate constraint checks here
- `insight-generation-agent.ts generateInsightDocument()`: Add diagram embedding and CGR evidence sections
- `.data/knowledge-graph/insights/`: Output directory for enriched markdown docs

</code_context>

<specifics>
## Specific Ideas

- Relationship diagram should make the "you are here" entity immediately obvious with color highlight
- CGR code evidence sections should feel like a quick reference card — signatures and paths, not walls of code
- Constraint consolidation should result in ONE validation function call before persistence, not two separate passes
- Diagram compilation can be parallelized across entities since each is independent

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-documentation-generation*
*Context gathered: 2026-03-09*
