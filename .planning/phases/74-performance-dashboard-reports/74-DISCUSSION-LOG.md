# Phase 74: Performance Dashboard & Reports - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-28
**Phase:** 74-performance-dashboard-reports
**Areas discussed:** Query-builder model, Score override UX, Report save & snapshot, Timeline sub-bands + tier badge

---

## Query-builder model (DASH-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Structured filter form + table | Fixed filter controls above a runs table; mirrors token-usage.tsx (recommended) | |
| Faceted sidebar | Left-rail facets with live counts, click to narrow | ✓ |
| Pick-a-task-first drill-down | Choose task_id first, then runs scoped to it | |

**User's choice:** Faceted sidebar
**Notes:** Stronger UX than the recommended form, but a new pattern for system-health-dashboard — flagged for research to confirm no existing faceted component and to reuse filter/table primitives.

---

## Score override UX (SC#5 / SCORE-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Per-run detail drawer | Row click → side drawer with judged values + editable corrected fields + rationale; Save calls PATCH (recommended) | ✓ |
| Inline-editable table cells | Edit corrected values directly in table cells | |
| Modal dialog per run | Focused modal per run | |

**User's choice:** Per-run detail drawer
**Notes:** Calls the existing Phase 73 `PATCH /api/experiments/scores/:taskId` — UI only, no new write logic.

---

## Report save & snapshot (KB-04 / DASH-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Query + cached snapshot + Refresh | Store query def AND frozen snapshot; view renders snapshot, manual Refresh re-runs (recommended) | ✓ |
| Immutable frozen snapshot only | Freeze rows at save, never re-run | |
| Live query only (no snapshot) | Re-run every view, no snapshot (bit-rots) | |

**User's choice:** Query + cached snapshot + Refresh
**Notes:** Satisfies both DASH-03 (stable snapshot) and KB-04 (live saved-query workflow). Follow-up: Reports live as a **sub-view inside the Performance tab** (not a top-level tab).

---

## Timeline sub-bands + tier badge (DASH-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsible sub-bands, collapsed default | Parent turn shows tier badge; expand for stacked per-step sub-bands (recommended) | ✓ |
| Always-expanded stacked sub-bands | Every step inline under its turn at all times | |
| Badge + count, detail on click | Tier badge + step count; detail in popover on click | |

**User's choice:** Collapsible sub-bands, collapsed by default
**Notes:** `granularity_tier` badge stays visible even when collapsed — the honesty signal against cross-tier averaging.

---

## Sub-decisions (follow-up turn)

| Decision | Choice |
|----------|--------|
| Where Reports live | Sub-view inside the Performance tab (not a top-level tab) |
| Default table display for overridden dims | Corrected-wins (effective value + "edited" marker); judged shown on hover/drawer — realizes 73-CONTEXT D-06 |

## Claude's Discretion

- Exact facet set/ordering in the sidebar (start from locked facets; add obvious ones with justification).
- Visual styling of the "edited" marker and tier badge (follow existing dashboard component conventions).
- Whether Report query/snapshot persists via the `Report` ontology entity vs a lighter dashboard-side store (intended home is the `Report` class; decide in planning by persistence cost).

## Deferred Ideas

- Report sharing/export (CSV/permalink) — future dashboard phase.
- Faceted-sidebar cross-task analytics/charts beyond the runs table — out of DASH-01 scope.
- 15 observability/VKB/unified-viewer todos surfaced by `todo.match-phase 74` — all out of Phase 74 scope (reviewed, not folded; see CONTEXT.md Deferred Ideas).
