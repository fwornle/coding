---
created: 2026-06-14T07:10:00.000Z
title: VKB sidebar LEGEND is static and mixes OKB-domain entries — should be derived from rendered graph
area: unified-viewer / sidebar legend rendering
relates_to_phase: 56.1 (surfaced during 56.1 visual smoke — out of scope of 56.1 bidirectional bridge)
resolves_phase: 60
related_todos:
  - 2026-06-14-vkb-evidence-pattern-filter-asymmetry-and-ontology.md
  - 2026-06-14-vkb-shows-observations-digests-architecture-bleed.md
files:
  - integrations/unified-viewer/src/panels/Legend.tsx (or wherever the LEGEND component lives — confirm path)
  - integrations/unified-viewer/src/panels/coding/* (VKB-specific sidebar code)
  - integrations/unified-viewer/src/graph/edge-style.ts (the source of truth for which relationship types VKB actually renders)
  - integrations/unified-viewer/src/store/viewer-store.ts (Sources / Layers / Shapes config)
  - .data/knowledge-graph/exports/general.json (canonical source — what entity types + relation types actually exist)
---

## Problem

The FILTERS sidebar in `localhost:5173/viewer/coding` (VKB) shows a LEGEND with sections **DOMAINS**, **LAYERS**, **SOURCE**, **RELATIONSHIPS**. Several entries do not correspond to anything in the actually-rendered VKB graph and look copied from the OKB/VOKB (root-cause analysis) implementation.

### Observed entries (2026-06-14)

**DOMAINS** (shapes):
- Project (hexagon), Component (square), Detail (circle), Digest (diamond), RuntimeDiagnostics (triangle)
- → `RuntimeDiagnostics` and `Digest` don't match the entity-type counts the same UI shows (1 Observation / 5 Insights / 55 Digests — and the Digest issue is filed separately as `2026-06-14-vkb-shows-observations-digests-architecture-bleed.md`)

**SOURCE**:
- Official doc / Team knowledge / User input / Automated RCA
- → none of these are the actual `source` values in VKB. VKB uses `batch` / `online` / `combined` (the Learning Source filter above the legend reflects that). The four entries here read as RCA-domain (Confluence / MkDocs / etc. — verify by inspecting OKB ontology).

**RELATIONSHIPS**:
- Structural (PART_OF), Causal (CAUSED_BY), Causal dashed (INDICATES), Operational (OBSERVED_IN), Operational dashed (MANAGED_BY), Data flow (READS), Data flow dashed (USES), Resolution (RESOLVES), Resolution dashed (MATCHES), Association (CORRELATED_WITH), Default (RELATES_TO)
- → the rendered VKB graph predominantly shows: `parent_child`, `related_to`, `contains`, `has_insight`, `capturedby` (visible in node-label overlays). Most of the RCA-domain edge types (CAUSED_BY, RESOLVES, MATCHES, CORRELATED_WITH, etc.) likely never appear on VKB edges.

## Operator's argument

The legend should reflect what's actually in the rendered graph — not be a fixed catalog assembled by union over all KM-base projects. Showing OKB-only entries in the VKB legend (a) misleads the operator and (b) reinforces the cross-domain bleed already filed for entity types and filter checkboxes.

## Verification recipe — read first, don't speculate

```bash
# 1. What entity types actually exist in VKB?
jq '[.nodes[] | select(.attributes.team == "coding") | .attributes.entityType] | group_by(.) | map({type: .[0], count: length})' \
  .data/knowledge-graph/exports/general.json

# 2. What relation types actually exist on VKB edges?
jq '[.edges[] | select((.attributes.team // "") == "coding" or (.attributes.source_team // "") == "coding") | .attributes.type] | group_by(.) | map({type: .[0], count: length})' \
  .data/knowledge-graph/exports/general.json

# 3. What source values actually exist on VKB nodes?
jq '[.nodes[] | select(.attributes.team == "coding") | .attributes.source] | group_by(.) | map({source: .[0], count: length})' \
  .data/knowledge-graph/exports/general.json

# 4. Find the LEGEND component
grep -rn "DOMAINS\|RELATIONSHIPS\|LAYERS\|Causal\|CAUSED_BY\|Official doc\|Automated RCA" integrations/unified-viewer/src/

# 5. Is the legend hardcoded or computed?
grep -rn "legendEntries\|LEGEND_ITEMS\|legend.*=.*\\[" integrations/unified-viewer/src/
```

## Acceptance

- Legend is **derived from the actually-rendered graph** — only entries whose entity type / source value / edge type appear at least once in the current view are shown
- (Alternative if dynamic is too costly:) Legend is **scoped per tab** (VKB shows VKB-relevant entries only, OKB/VOKB shows OKB-relevant ones)
- Operator can read the legend and trust that every entry maps to something visible in the graph
- A unit test asserts that legend content is a subset of the rendered graph's actual type vocabulary

## How surfaced

During Phase 56.1 Plan 06 operator visual smoke on 2026-06-14. Fifth in a series of out-of-scope viewer/KB issues surfaced in the same smoke session.
