---
phase: 55-unified-viewer-feature-parity-with-vokb
plan: 03
subsystem: ui
tags: [vokb, palette, tailwind, evidence-types, port, shared-module, vitest, snapshot]

# Dependency graph
requires:
  - phase: 55-unified-viewer-feature-parity-with-vokb
    provides: "Phase 55 plan + UI-SPEC §4 (semantic palette table) + §7 row 10 (shared evidence-types module) + D-55-02a verbatim VOKB port rule"
provides:
  - "vokb-palette.ts — single source of truth for VOKB semantic palette (FAILURE_MODEL_CLASSES, BUSINESS_CLASSES, nodeFill, nodeStroke, nodeStrokeWidth, nodeStrokeDasharray, EDGE_STYLES, LAYER_BADGE_CLASS, CONFIDENCE_COLOR, RUN_COLORS, SourceAuthority type)"
  - "evidence-types.ts — single source of truth for evidence-link icons + labels + age badge (EvidenceLinkType, EVIDENCE_TYPE_ICONS, EVIDENCE_TYPE_LABELS, evidenceAgeBadge)"
  - "Snapshot test on EDGE_STYLES — drift detector against VOKB GraphVisualization.tsx:135-173"
affects:
  - "55-05 (renderer node + edge styling) — imports nodeFill / nodeStroke / nodeStrokeWidth / nodeStrokeDasharray / EDGE_STYLES"
  - "55-07 (LegendPanel + StatsBar) — imports FAILURE_MODEL_CLASSES / BUSINESS_CLASSES / LAYER_BADGE_CLASS / nodeFill"
  - "55-09 (EntityDetailPanel) — imports LAYER_BADGE_CLASS / CONFIDENCE_COLOR / RUN_COLORS / EVIDENCE_TYPE_ICONS / EVIDENCE_TYPE_LABELS / evidenceAgeBadge"
  - "55-10 (IssueTriageView + TrendingPanel) — imports CONFIDENCE_COLOR / EVIDENCE_TYPE_ICONS / EVIDENCE_TYPE_LABELS (replaces VOKB IssueTriage.tsx:21-53 duplicate)"

# Tech tracking
tech-stack:
  added: []  # no new packages — pure constants + helper modules
  patterns:
    - "Verbatim VOKB port (D-55-02a): hex values + Tailwind classes + dark-mode modifiers copied LITERALLY from VOKB source; drift detected by toMatchInlineSnapshot"
    - "PORT-SPEC header comment naming the exact VOKB source file + line range (per 55-PATTERNS.md guidance)"
    - "Shared lib-domain module replaces duplicated constants across multiple downstream panels (D-55-02a single source of truth)"

key-files:
  created:
    - "integrations/unified-viewer/src/graph/vokb-palette.ts"
    - "integrations/unified-viewer/src/graph/vokb-palette.test.ts"
    - "integrations/unified-viewer/src/lib-domain/evidence-types.ts"
    - "integrations/unified-viewer/src/lib-domain/evidence-types.test.ts"
  modified: []

key-decisions:
  - "Inlined SourceAuthority literal union into vokb-palette.ts (not imported from okbClient). The unified-viewer has no equivalent module yet; downstream 55-05 will re-export from this module or replace as needed. Keeps Phase 55-03 self-contained."
  - "CONFIDENCE_COLOR extended with dark-mode `dark:bg-…/40` and `dark:text-…-300` modifiers on the class field to match the VOKB `confidenceColorClass` source (NodeDetails.tsx:220-222), even though 55-PATTERNS.md sample omitted them. Test guard targets the dot value (which is stable across themes) — full class string preserved for downstream panel reuse."
  - "Snapshot test uses toMatchInlineSnapshot on EDGE_STYLES (the largest map) so the test file itself records the VOKB hex/dasharray values. Drift in either direction surfaces as a snapshot diff with the offending key visible at the test failure line."

patterns-established:
  - "VOKB verbatim port module: PORT-SPEC header line referencing VOKB source + line range, hex/class values inline (no rounding/translation), readonly types (ReadonlySet, ReadonlyArray) where applicable, snapshot test on at least one large map."
  - "Shared lib-domain constant module (not src/lib/) for evidence-types: panel-agnostic data dictionary consumed by multiple downstream panels — placed alongside states.tsx / markdown-text.tsx / sanitize-markdown.ts per existing convention."

requirements-completed: [UI-02]

# Metrics
duration: 14min
completed: 2026-06-09
---

# Phase 55 Plan 03: VOKB Semantic Palette + Evidence Types — Verbatim Port Summary

**Two shared constant modules (vokb-palette + evidence-types) ported verbatim from VOKB GraphVisualization.tsx + NodeDetails.tsx, snapshot-tested for drift detection, ready for consumption by Waves 2–4 panels.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-06-09T14:50:00Z
- **Completed:** 2026-06-09T15:04:00Z
- **Tasks:** 2
- **Files modified:** 4 (all new)

## Accomplishments

- `vokb-palette.ts` (209 lines) — single source of truth for the VOKB semantic palette: `FAILURE_MODEL_CLASSES`/`BUSINESS_CLASSES` Sets, `nodeFill`/`nodeStroke`/`nodeStrokeWidth`/`nodeStrokeDasharray` functions, the 30-entry `EDGE_STYLES` map, `LAYER_BADGE_CLASS`, `CONFIDENCE_COLOR`, and the 8-color `RUN_COLORS` cycle. `SourceAuthority` literal union exported alongside.
- `evidence-types.ts` (116 lines) — single source of truth for evidence-link iconography: `EvidenceLinkType` 14-key union, `EVIDENCE_TYPE_ICONS` (Unicode glyphs, no font library), `EVIDENCE_TYPE_LABELS` (human-readable), `evidenceAgeBadge` (90d/180d staleness bands with `Math.floor` label).
- 64 new vitest cases (44 for vokb-palette, 20 for evidence-types) including a `toMatchInlineSnapshot` of the full `EDGE_STYLES` map — drift between this port and VOKB GraphVisualization.tsx:135-173 will surface as a snapshot diff with the offending edge type visible at the test-failure line.
- Replaces the verbatim VOKB duplicate at `IssueTriage.tsx:21-53` — downstream Plan 55-10 (IssueTriageView) and Plan 55-09 (EntityDetailPanel) both import from this single module per UI-SPEC §7 row 10.

## Task Commits

Each task was committed atomically following TDD (RED → GREEN):

1. **Task 1 RED: failing test for vokb-palette** — `50ba4ef86` (test)
2. **Task 1 GREEN: port vokb-palette.ts verbatim from VOKB** — `d0e369741` (feat)
3. **Task 2 RED: failing test for evidence-types** — `de42274b9` (test)
4. **Task 2 GREEN: port evidence-types.ts verbatim from VOKB** — `d870f1cd1` (feat)

## Files Created/Modified

- `integrations/unified-viewer/src/graph/vokb-palette.ts` (NEW, 209 LOC) — VOKB semantic palette constants + helper functions; verbatim from `_work/.../viewer/src/components/KnowledgeGraph/GraphVisualization.tsx:31-176` and `NodeDetails.tsx:{219-228,232-241,636-640}`.
- `integrations/unified-viewer/src/graph/vokb-palette.test.ts` (NEW, 330 LOC) — 44 vitest cases including `toMatchInlineSnapshot` on full `EDGE_STYLES` (30 edge types × 2 fields).
- `integrations/unified-viewer/src/lib-domain/evidence-types.ts` (NEW, 116 LOC) — Evidence link iconography + labels + age helper; verbatim from `NodeDetails.tsx:243-296`.
- `integrations/unified-viewer/src/lib-domain/evidence-types.test.ts` (NEW, 128 LOC) — 20 vitest cases covering icons (5 specific glyphs + count), labels (4 specific + count), TS union compile-time contract (with `@ts-expect-error` smoke), and age-band boundary behaviour (now/89/89.5/91/95.7/179.5/181 days).

## Decisions Made

- **Inlined `SourceAuthority` literal union into vokb-palette.ts.** The unified-viewer has no equivalent `okbClient.ts` yet, and pulling in a network/types module just for a 4-literal union would block on a Wave 2 plan that doesn't exist. Downstream 55-05 (renderer) can either re-export from this module or remap as needed once the API client lands.
- **`CONFIDENCE_COLOR.class` retains the VOKB `dark:` modifiers** (`dark:bg-green-900/40 dark:text-green-300`, etc.) even though 55-PATTERNS.md sample showed the light-mode-only form. The VOKB source (`confidenceColorClass` at NodeDetails.tsx:219-222) carries the dark-mode suffix and the unified-viewer ships a dark-mode theme — keeping the full class string preserves visual parity. Test guard targets the `dot` value (stable across themes) so the test stays robust against the same minor reformulation in any consumer.
- **`toMatchInlineSnapshot` on EDGE_STYLES (not on every constant).** The 30-entry edge map is the largest single source of potential drift; pinning it inline is sufficient drift detection without bloating the test file with redundant snapshots for the smaller maps (which are individually asserted by key).

## Deviations from Plan

None — plan executed exactly as written. Tests RED → GREEN per the `tdd="true"` contract on both tasks, all `<behavior>` assertions pass, `<done>` grep counts exceed the lower bounds (15 vs ≥7 for vokb-palette, 5 vs ≥4 for evidence-types), zero `console.*` calls in either module.

One worktree-setup adjustment (not a plan deviation): the worktree was created without an `integrations/unified-viewer/node_modules` directory, so vitest could not load `vitest.config.ts`. Resolved by symlinking the main repo's `node_modules` into the worktree (`ln -s /Users/Q284340/Agentic/coding/integrations/unified-viewer/node_modules node_modules`). This is a worktree-machinery concern, not a code change, and is excluded from git (gitignored). The symlink does NOT modify the main repo's `node_modules`.

## Issues Encountered

None during the implementation. Both modules ported on first attempt; all 254 vitest cases across the full Phase 45+55 suite stay green; `tsc --noEmit --strict` passes with exit 0.

## User Setup Required

None — pure constant modules, no external service configuration, no new packages, no environment variables.

## Next Phase Readiness

- **Wave 2 plans (55-04, 55-05) unblocked.** The renderer can now import `nodeFill`, `nodeStroke`, `nodeStrokeWidth`, `nodeStrokeDasharray`, `EDGE_STYLES`, and `SourceAuthority` from `@/graph/vokb-palette` and stop inventing its own color contracts.
- **Wave 3 plans (55-07 LegendPanel, 55-09 EntityDetailPanel) unblocked.** All Tailwind chip classes (`LAYER_BADGE_CLASS`, `CONFIDENCE_COLOR`, `RUN_COLORS`) plus the evidence iconography are imports away.
- **Wave 4 plan (55-10 IssueTriageView) unblocked.** The previously-duplicated VOKB `IssueTriage.tsx:21-53` constants are now a single import from `@/lib-domain/evidence-types`.
- **No blockers, no concerns.** The snapshot test on `EDGE_STYLES` will catch any future drift between Phase 55 and VOKB main; if a VOKB update lands during a downstream plan, the test fails loudly and the executor must reconcile by re-porting the affected line range and re-running the snapshot (`-u` updates intentionally; review by hand against the VOKB source).

## Self-Check

Verifying claims before returning to orchestrator:

**Files created:**
- `integrations/unified-viewer/src/graph/vokb-palette.ts` — FOUND
- `integrations/unified-viewer/src/graph/vokb-palette.test.ts` — FOUND
- `integrations/unified-viewer/src/lib-domain/evidence-types.ts` — FOUND
- `integrations/unified-viewer/src/lib-domain/evidence-types.test.ts` — FOUND

**Commits exist on worktree-agent-a4db45b39f1116421:**
- `50ba4ef86` test(55-03): add failing test for vokb-palette (RED) — FOUND
- `d0e369741` feat(55-03): port vokb-palette.ts verbatim from VOKB (GREEN) — FOUND
- `de42274b9` test(55-03): add failing test for evidence-types (RED) — FOUND
- `d870f1cd1` feat(55-03): port evidence-types.ts verbatim from VOKB (GREEN) — FOUND

**Verification gates re-run:**
- `npx vitest run src/graph/vokb-palette.test.ts src/lib-domain/evidence-types.test.ts` → 64/64 PASS
- `npx tsc --noEmit` → exit 0
- Full vitest suite → 254/254 PASS across 28 files
- Grep gate vokb-palette → 15 (≥ 7 required) PASS
- Grep gate evidence-types → 5 (≥ 4 required) PASS
- Console-call gate → ZERO in both modules PASS

## Self-Check: PASSED

---
*Phase: 55-unified-viewer-feature-parity-with-vokb*
*Plan: 03*
*Completed: 2026-06-09*
