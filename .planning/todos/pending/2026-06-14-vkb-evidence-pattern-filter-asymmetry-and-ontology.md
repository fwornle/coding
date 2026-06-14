---
created: 2026-06-14T06:55:00.000Z
title: VKB Evidence/Pattern filter asymmetry + ontology cross-domain bleed
area: unified-viewer / Layer filter + ontology
relates_to_phase: 56.1 (surfaced during 56.1 visual smoke — out of scope of 56.1 bidirectional bridge)
resolves_phase: 60
files:
  - integrations/unified-viewer/src/store/viewer-store.ts (Layer filter — Evidence / Pattern checkboxes)
  - integrations/unified-viewer/src/panels/coding/* (the VKB-specific code path)
  - integrations/unified-viewer/src/graph/visibility.ts (or wherever per-node Evidence/Pattern is read into visibleIds)
  - .data/knowledge-graph/exports/general.json (inspect actual per-node Evidence/Pattern values for the coding team — VKB scope)
  - integrations/code-graph-rag/ + integrations/mcp-server-semantic-analysis/ (where Evidence/Pattern get attached to nodes — likely an OKB-origin classifier still running on VKB ingest)
---

## Problem A — Filter behavior asymmetry

Observed 2026-06-14 in `localhost:5173/viewer/coding` (VKB):

| Action | Expected | Observed |
|---|---|---|
| Toggle Evidence OFF (Pattern still ON) | Show only Pattern-tagged nodes (or all nodes minus Evidence-only) | Graph shrinks to a few greyed-out nodes |
| Toggle Pattern OFF (Evidence still ON) | Show only Evidence-tagged nodes | Entire graph redrawn unchanged (no-op) |

The two checkboxes are not symmetric. One actually filters, the other does nothing.

## Problem B — Ontology question

`Evidence` and `Pattern` were introduced in the OKB / VOKB context (root-cause-analysis domain — observations classified as Evidence vs Pattern in the OKB ontology). The VKB (`/viewer/coding`) shows the same two checkboxes, and individual VKB nodes apparently carry these property values.

Open questions for the next person to investigate (do not speculate — read the data first):

1. Inspect actual VKB node properties:
   ```bash
   jq '.nodes[] | select(.attributes.team == "coding") | {label: .attributes.label, evidence: .attributes.evidence, pattern: .attributes.pattern, source: .attributes.source}' \
     .data/knowledge-graph/exports/general.json | head -100
   ```
   How many VKB-scope nodes have Evidence or Pattern set, and what values?

2. Trace where the Evidence/Pattern attributes get attached during ingest:
   - `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts`
   - `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` (ontology classification step)
   - the wave-analysis pipeline (`workflow-runner.ts`)

3. If VKB has its own ontology that does NOT include Evidence/Pattern as first-class concepts, the filter UI for those checkboxes should be hidden in the VKB tab, OR the classifier should not tag VKB nodes with those values, OR (least desirable) the checkboxes should be no-ops in VKB.

## Acceptance

- The two filter checkboxes behave symmetrically: each one independently restricts visible nodes to those carrying its tag
- For VKB specifically: either Evidence/Pattern are validated as appropriate properties (with a doc note explaining why), OR the UI hides them when in VKB tab, OR the underlying classifier stops attaching them to VKB-team nodes
- A unit test covers symmetric toggle behavior

## How surfaced

During Phase 56.1 Plan 06 operator visual smoke on 2026-06-14. Operator reported the asymmetry plus raised the architectural question about why VKB carries OKB-domain properties.
