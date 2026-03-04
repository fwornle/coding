# Phase 7: Hierarchy Completeness - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wave analysis produces comprehensive sub-node trees that reflect real architectural structure discovered from code, with each level providing standalone useful knowledge. This phase improves Wave 2 and Wave 3 agent discovery capabilities, fixes file scoping gaps, implements manifest auto-extension, and establishes the full replace re-run model. It does not change wave orchestration (Phase 5), observation quality enforcement (Phase 6), or VKB visualization (Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Coverage targets
- No fixed child count target per component — LLM discovers naturally, quality filter removes junk
- Allow single or zero L2 children for simple components (e.g., CodingPatterns) — no artificial minimums forced
- Complex components like SemanticAnalysis should naturally yield more children through better file scoping and prompts
- Self-sufficiency standard for each node: enough to orient a new developer — they should know where to look and what to expect without drilling into children

### Manifest auto-extension
- Discovered entities are written back to `component-manifest.yaml` so they seed future runs
- Discovered entries tagged with `discovered: true` in YAML — distinguishable from curated entries
- The `discovered` tag is informational only — no promotion workflow, no behavioral difference
- Manifest accumulates across runs: curated entries persist forever, discoveries are added each run

### Discovery quality bar
- Code evidence preferred: nodes traced to specific files/classes are kept as-is; nodes from pure LLM reasoning are kept but flagged as `inferred` for lower confidence
- Breadth-first priority — Phase 7 focuses on discovering all sub-components; deep observations come from Phase 6's quality enforcement
- No extra deduplication step needed — existing prompt instructions and graph dedup handle near-duplicates

### Re-run behavior
- Full replace per run: each `ukb full` produces a complete fresh hierarchy in the knowledge graph
- Manifest accumulates separately: curated base grows with discoveries across runs, but KG entities are replaced each run
- All insight documents regenerated each run (consistent with full replace)
- No diff report between runs needed now — existing structured summary (entities per level, manifest vs discovered) is sufficient

### Claude's Discretion
- Whether to enrich the manifest with known sub-components or focus on better LLM prompts/file scoping for natural discovery
- Manifest auto-extension timing: during waves vs post-processing finalization step
- Filtering strictness per level (L2 vs L3 blocklists)
- File scoping improvements for Wave 3 (passing L1 keywords, using Wave 2's suggestedL3Children, directory structure heuristics)
- How to pass Wave 2's suggested L3 children into Wave 3 prompts (currently dead data)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Wave2ComponentAgent` (wave2-component-agent.ts): L2 discovery with manifest seeds + LLM discovery. Prompt asks for manifest enrichment + additional sub-components. Has `ensureMinimumObservations()` validation
- `Wave3DetailAgent` (wave3-detail-agent.ts): Pure L3 discovery (no manifest). Filters generic names via hardcoded blocklist. Budget: 2-8 with files, 1-3 without
- `WaveController.getComponentFiles()` (wave-controller.ts): CGR Cypher file scoping. Returns up to 50 file paths per component
- `loadComponentManifest()` / `flattenManifestEntries()` (component-manifest.ts): YAML manifest loading, flattens to L1+L2 array. Fixed at 2 depth levels
- `runWithConcurrency()` (wave-controller.ts): Work-stealing concurrency pattern for bounded parallel execution
- `WaveAgentOutput.childManifest` (wave-types.ts): Wave 2 outputs suggested L3 children here, but Wave 3 never reads them

### Critical Gaps to Fix
- **Wave 3 file scoping too narrow**: `getComponentFiles(l2Entity.name, [l2Entity.name.toLowerCase()])` only uses L2 name — misses files when L2 name doesn't appear in paths
- **Suggested L3 children are dead data**: Wave 2's `suggestedL3Children` stored in `childManifest` but `executeWave3()` never passes them to Wave 3 agents
- **6 of 8 manifest components have empty `children: []`**: Their entire L2 structure is LLM-discovered from whatever CGR returns — quality depends entirely on file scoping
- **No manifest write-back mechanism**: `component-manifest.ts` only reads YAML — no writer exists

### Established Patterns
- Wave agents receive structured input with parent context (l1Entity for Wave 2, l1Entity+l2Entity for Wave 3)
- Manifest-driven at L0/L1, manifest+discovery at L2, pure discovery at L3 (Phase 5 decision)
- Discovered entities flagged with `discovered: true` tag (Phase 5 decision)
- Observation quality enforcement via filter → retry → supplement chain (Phase 6)
- CGR Cypher queries for file scoping with graceful fallback to empty array

### Integration Points
- `component-manifest.yaml`: Bind-mounted read-only into Docker — **no Docker rebuild needed** to iterate manifest changes
- `wave-controller.ts`: Orchestrates wave→agent context passing, needs enhanced file scoping and manifest write-back
- `wave2-component-agent.ts`: Prompt enhancement target for broader L2 discovery
- `wave3-detail-agent.ts`: Prompt enhancement + input enrichment (receive suggested children from Wave 2)
- `component-manifest.ts`: Needs `writeManifestDiscoveries()` function for auto-extension

</code_context>

<specifics>
## Specific Ideas

- Fix the Wave 3 file scoping by passing L1 component keywords down alongside L2 name
- Wire Wave 2's `suggestedL3Children` into Wave 3 prompts so they act as discovery seeds (not dead data)
- Quality filter should distinguish code-evidenced nodes from LLM-inferred ones
- Self-sufficiency means "orient a new dev" — know where to look, what to expect, which files matter

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-hierarchy-completeness*
*Context gathered: 2026-03-04*
