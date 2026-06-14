---
created: 2026-06-14T07:05:00.000Z
title: Ontology rework — clarify upper/lower split, build out lower ontology, group by project in VKB viewer
area: ontology / semantic-analysis / unified-viewer grouping
relates_to_phase: 56.1 (surfaced during 56.1 visual smoke — milestone-scale architectural item, not a 56.1 bugfix)
resolves_phase: 57
scope_hint: This is a multi-phase rework, not a TODO. Recommend promoting to a milestone (or a parent phase with sub-phases) when triaged. Review with `/gsd-review-backlog`.
files:
  - integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts (current classification logic)
  - integrations/mcp-server-semantic-analysis/src/ontology/ (OntologyManager — current upper/lower structure)
  - integrations/mcp-server-semantic-analysis/config/ (ontology config files, if any — bind-mounted read-only per CLAUDE.md)
  - integrations/unified-viewer/src/store/viewer-store.ts (Ontology Class filter UI in the FILTERS sidebar)
  - integrations/unified-viewer/src/panels/ (where project-grouped rendering would live)
---

## Operator's argument

**Upper ontology** — Component / SubComponent / Detail — makes sense. It's a generic programming-aspect vocabulary that applies to any project. Operator's suggestion: this layer could grow more aspects:
- Diagnosis / Troubleshooting
- Interface
- (etc.)

**Lower ontology** — currently sparse or absent in the operator's perception. It should encode terms specific to the actual content of THIS knowledge base. For project "coding", that means concepts like:
- LSL (Live Logging System)
- Constraints (constraint monitor)
- Online-Observation / Online-Digest / Online-Insight (online learning pipeline)
- Batch-Semantics-Analysis (batch learning pipeline)
- (project-domain concepts the operator chooses)

Ideally these lower-ontology entities are grouped by project / topic area in the VKB viewer rather than mixed flat.

## Why this isn't a small TODO

This touches:
- The ontology schema itself (data model)
- The classification pipeline (how new entities get assigned a lower-ontology tag)
- A reclassification migration (existing entities need lower-ontology tags retro-assigned)
- The VKB viewer UI (project-grouped rendering + new filter dimension)
- Possibly the upper ontology too if "Diagnosis / Interface / etc." are added

That's a milestone, not a TODO. The operator already flagged it as "needs revisited and reworked".

## Verification recipe — read the current state first

```bash
# 1. Confirm current ontology structure
ls integrations/mcp-server-semantic-analysis/src/ontology/ 2>&1
ls integrations/mcp-server-semantic-analysis/config/ 2>&1

# 2. Inspect a sample of currently-classified entities — does any "lower-ontology" tag exist?
jq '.nodes[] | select(.attributes.team == "coding") | {label: .attributes.label, upperClass: .attributes.ontologyClass, lowerClass: .attributes.lowerOntologyClass, anyOtherTag: .attributes.tags}' \
  .data/knowledge-graph/exports/general.json | head -50

# 3. Look at the ontology-classification-agent prompt + classes it can output
grep -n "lower\|tier\|class" integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts | head -40

# 4. Check what ontology classes the unified-viewer surfaces in the FILTERS sidebar (Ontology Class section)
grep -rn "ontologyClass\|HIERARCHY\|Project\|Component\|SubComponent\|Detail" integrations/unified-viewer/src/store/ | head -20
```

## Suggested milestone shape (when triaged)

Recommend a phase sequence along these lines:
1. **Discovery / current-state audit** — what upper + lower classes exist today, what % of entities are tagged, how the classifier decides
2. **Schema decision** — does lower ontology live in a new `lowerOntologyClass` attribute, or as `tags[]`, or hierarchical under upper class? Decide grouping unit (project/topic).
3. **Classifier rework** — extend ontology-classification-agent so new entities get lower-ontology tags. Add the new upper-ontology classes the operator floated (Diagnosis, Interface, …) if the discovery confirms they're needed.
4. **Backfill migration** — reclassify the existing graph using the new classifier. May be costly (LLM calls).
5. **VKB UI rework** — project-grouped node clusters, lower-ontology filter dimension, possibly per-project sub-tabs.
6. **VOKB / OKB alignment** — decide whether VOKB needs the same rework or whether the two ontologies should now diverge intentionally.

## How surfaced

During Phase 56.1 Plan 06 operator visual smoke on 2026-06-14. Fourth in a series of out-of-scope viewer/KB issues surfaced in the same smoke session (others: Online-filter-hides-CK, Evidence/Pattern filter, Observation/Digest entity-type bleed — all dated 2026-06-14 in this directory).

## Acceptance (high-level — to be sharpened during planning)

- Documented upper + lower ontology schema, with rationale for the boundary
- Lower-ontology classes for project "coding" cover: LSL, Constraints, Online-Learning, Batch-Learning, UI, plus whatever discovery surfaces
- Classifier emits both upper and lower class for every new entity
- Existing graph backfilled
- VKB viewer groups entities by project/topic in the rendered graph (not just in the filter UI)
- Lower-ontology filter dimension exists in the FILTERS sidebar
