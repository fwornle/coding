---
created: 2026-06-14T11:30:00.000Z
title: Online learning pipeline emits Insights with only `capturedBy → LiveLoggingSystem` edges; timeline lacks bi-source coloring
area: live-logging / observation consolidator / vkb ingest / unified-viewer timeline
relates_to_phase: 56.1 (surfaced during 56.1 visual smoke — out of scope of 56.1 bidirectional bridge)
scope_hint: This is a multi-phase milestone, not a single TODO. Recommend promoting via `/gsd-review-backlog` when triaged.
resolves_phase: 58
resolves_phase_secondary: 61 (timeline bi-source coloring portion is closed by LSLTIME-03 in Phase 61)
related_todos:
  - 2026-06-14-online-filter-hides-ck-truncates-trace.md
  - 2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md
  - 2026-06-14-vkb-shows-observations-digests-architecture-bleed.md
  - 2026-06-14-ontology-rework-lower-ontology-and-project-grouping.md
  - 2026-06-14-vkb-legend-static-cross-domain-bleed.md
files:
  - src/live-logging/ObservationConsolidator.js (the producer of Insight nodes — needs to emit semantic-content edges)
  - src/live-logging/ObservationExporter.js (reads km-core, emits JSON — informational)
  - src/live-logging/ObservationWriter.js (the Observation writer — related, may also need edge work)
  - integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx (timeline tick coloring — needs second source for blue/red distinction)
  - integrations/unified-viewer/src/store/viewer-store.ts (Learning Source filter — currently doesn't surface subsystem on nodes)
---

## Architectural reality (vocabulary nailed down 2026-06-14)

- **LSL** = Live Session Logging. The verbatim conversation logger that writes to `.specstory/history/` (prompts, tool calls, results, LLM answers).
- **ETM** = Enhanced Transcript Monitor. The launchd daemon (`com.coding.etm`) that does TWO things: (1) primary — produces the LSL files; (2) secondary — triggers the online learning pipeline.
- **Online learning pipeline:** LSL files → Observations (automatic, ETM-driven) → Digests (manual consolidation when operator triggers) → Insights (manual consolidation). Insights are written into km-core via `src/live-logging/ObservationConsolidator.js`.
- **Batch wave-analysis pipeline:** `integrations/mcp-server-semantic-analysis` runs in 4 waves when operator triggers it manually (rarely now). Reads LSL files, produces Components / SubComponents / Details / structural edges.
- **`LiveLoggingSystem`** (the graph node, `entityType: Component`) = the umbrella subsystem covering BOTH LSL + ETM + classifier. Created by the wave-analysis pipeline. NOT the same thing as the LSL file format.

## The data gap (hard evidence, 2026-06-14 jq against `.data/knowledge-graph/exports/general.json`)

```
Insights total:                   91
Insights with any edge:           74
Total edges touching Insights:   111
Edges by type touching Insights: capturedBy: 111  (← ALL of them)
```

Zero `mentions`, `discusses`, `references`, `parent-child`, `has_insight`, `derives_from`, etc. Every Insight is an isolated leaf hanging off `LiveLoggingSystem` via `capturedBy` only.

```
LLS_ID="019e5559-69cf-75e2-9e01-2be12a451c35"
Edges with LLS as target:  { capturedBy: 429, parent-child: 1 }
Edges with LLS as source:  { contains: 50, related_to: 8 }
```

The 429 `capturedBy` edges land on LLS regardless of what the Observation actually discusses. The 1-hop ancestry fallback in `pickAllResolvable` then collapses every LSL bucket to LLS — which is what the operator sees in the viewer (every tick resolves to LLS only, no multi-card sidebar lists are reachable in the recent window).

## What's missing in ObservationConsolidator.js

When the pipeline creates an Insight from N digests, it currently writes:
- The Insight node into km-core ✓
- A `capturedBy → LiveLoggingSystem` provenance edge ✓
- (Likely) `has_insight` or similar back-edges from the source digests/observations — verify by reading the code
- **NOTHING about what the Insight is semantically about** — no edges to the Components / SubComponents / Patterns / other Insights that the content discusses

The fix is a new step in ObservationConsolidator (or a new agent): LLM classifier call per Insight that identifies the entities the Insight is about, then writes `mentions` / `relates_to` / `discusses` / appropriate edges to those entities in km-core.

## Why operator sees this

In the live viewer at `localhost:5173/viewer/coding` with the new LLS suppression + auto-drill behaviors in place (Plan 56.1):
- 100% of LSL ticks in last 7d resolve to LLS only (LLS suppression then yields empty → fallback to "LLS as only option" → focal=LLS)
- A few 30d ticks resolve to 2 nodes; after LLS suppression they auto-drill to the 1 remaining
- The multi-card sidebar list never appears because no bucket ever has >1 non-LLS resolved ancestor

The viewer is faithfully rendering the data. The data lacks semantic-content edges.

## Secondary issue — Timeline bi-source coloring

Operator expects timeline ticks to be colored by their source:
- **Blue (shades)** = batch wave-analysis events (semantic-analysis MCP)
- **Red (shades)** = online learning events (ETM-driven observations/digests/insights)

Current `LslTimelineStrip` reads LSL session files from `.specstory/history/` only. Every session is "live recorded", so all ticks render the same color (currently pink). To get blue/red distinction:
- Add second tick source: km-core Insight `createdAt` grouped by subsystem
- Color computation: LSL session ticks stay as-is (pink, since they're inherently online verbatim recordings); add blue tick layer for wave-analysis-created entities (`metadata.subsystem == "wave-analysis"`); add red tick layer for online-pipeline-created Insights (`metadata.subsystem == "online-consolidator"` or whatever marker is used)
- BUT: the 91 existing Insights have `metadata.subsystem == null` — no source distinction is currently being recorded. So Phase 1 of this work is to TAG Insights with their source subsystem on write.

## Suggested milestone shape (when triaged)

Recommend a phase sequence:

1. **Tag Insight nodes at write time** with `metadata.subsystem` ("online-consolidator" vs "wave-analysis"). Mechanical — extends both writers. Enables (3) and (4).
2. **Semantic-edge generation per Insight** in ObservationConsolidator. Add an LLM classifier step: "given this Insight summary + the existing Component/SubComponent/Pattern catalog, which entities does this Insight discuss?" → write `mentions` or `discusses` edges. Cost: 1 extra LLM call per Insight (manageable since insights consolidation is manual + low volume).
3. **Subsystem-aware `pickAllResolvable`**: optional, only if (2) doesn't produce enough multi-resolution buckets — could fall back to semantic-similarity edges (Qdrant) to widen the resolution net.
4. **Timeline bi-source coloring** in `LslTimelineStrip`: add tick layer for km-core Insight createdAt, color by subsystem, render alongside existing LSL session ticks.
5. **Backfill**: re-run consolidation against existing 91 Insights to populate semantic edges retroactively. Expensive (91 LLM calls) but one-shot.
6. **Filter UX**: the existing Learning Source filter (Batch / Online / Combined) is meaningful again once subsystem is tagged at write time.

## How surfaced

During Phase 56.1 Plan 06 operator visual smoke on 2026-06-14. After the bidirectional bridge + LLS suppression + UX shortcut all landed and worked correctly, operator noticed that no multi-card sidebar lists ever appeared. Investigation revealed that the data simply has no semantic-content edges on Insights — every Insight is structurally an isolated leaf off LLS.

## Acceptance (high-level — to be sharpened during planning)

- ObservationConsolidator emits ≥1 semantic-content edge per new Insight (in addition to capturedBy provenance)
- Existing 91 Insights backfilled with semantic-content edges
- Insight nodes carry `metadata.subsystem` distinguishing online vs batch
- Timeline strip shows blue ticks for batch-created Insights, red ticks for online-created Insights, alongside the existing LSL session ticks
- Operator can click a representative tick and see a multi-card BucketCardList with >1 resolved ancestor
