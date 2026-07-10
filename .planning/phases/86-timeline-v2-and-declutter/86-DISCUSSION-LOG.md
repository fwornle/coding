# Phase 86: Timeline v2 & Performance Page Declutter - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-10
**Phase:** 86-timeline-v2-and-declutter
**Areas discussed:** Turn anatomy & drill-down, Context-window band, Difference viewer scope, Declutter IA

---

## Turn anatomy & drill-down

### Inline vs modal depth
| Option | Description | Selected |
|--------|-------------|----------|
| Compact row + rich modal | Row: prompt excerpt + tool chips + token/cache summary + mini band; modal: full messages, per-tool arg digest, cache-breakpoint indices, byte sizes, raw preview | ✓ |
| Rich inline, modal for raw | Expand collapsible to show tool digests + cache split inline; modal only for raw bodies | |
| Minimal row, all in modal | Keep today's row; put all new detail behind the modal | |

### Modal vs fullscreen purpose
| Option | Description | Selected |
|--------|-------------|----------|
| Modal=turn, FS=whole timeline | Click turn → single-turn modal; fullscreen = whole-timeline full-viewport view | ✓ |
| FS = maximized modal | Fullscreen is the same single-turn modal, bigger | |
| You decide | Planner picks | |

### Tool-call arg surfacing
| Option | Description | Selected |
|--------|-------------|----------|
| Semantic-first + raw when captured | Name + arg size + ETM observation intent line; full args only when capture_raw_bodies was ON | ✓ |
| Raw preview always inline | Name + size + ~120-char raw preview for every tool | |
| Name + size only inline | Semantic line + preview live in modal only | |

**Notes:** Honors Phase-84 D-07 semantic-first; degrades honestly when raw capture was off.

---

## Context-window band

### Band shape
| Option | Description | Selected |
|--------|-------------|----------|
| Cumulative growth band | One continuous band across the run, context filling turn-by-turn | |
| Per-turn stacked bar | Each row gets its own composition bar | |
| Both — mini inline + full band | Mini per-turn bar inline + full cumulative band in fullscreen/modal | ✓ |

### Band encoding
| Option | Description | Selected |
|--------|-------------|----------|
| Category taxonomy | Segments = system/tools/history/fresh | |
| Cache split | Segments = fresh/cache_read/cache_write/output | |
| Category + cached overlay | Length = category composition; texture/opacity = cache state | ✓ |

### Degradation (no context-turns data)
| Option | Description | Selected |
|--------|-------------|----------|
| Fall back to v1 rows | v1 row + subtle "no per-turn context captured" note | ✓ |
| v2 chrome + empty band | Full v2 layout with placeholder band + empty states | |
| Partial v2 | Drop only the band; keep what renders from timeline data | |

**Notes:** Cache overlay must reflect measured values, never inferred (Phase-84 D-12).

---

## Difference viewer scope

### Compare depth
| Option | Description | Selected |
|--------|-------------|----------|
| Middle: side-by-side v2 timelines | Two timelines aligned by turn, per-turn deltas, no auto-detection | |
| Full difference viewer | Auto-align, auto-detect first divergence, side-by-side from there, cumulative deltas, loop badges, collapse identical prefix | ✓ |
| Light: wire into existing compare | Select 2 → open existing run-compare.tsx; diff deferred | |

### Compare entry point
| Option | Description | Selected |
|--------|-------------|----------|
| Runs-table multi-select | Checkboxes → "Compare selected (2)" action | ✓ |
| Re-run pairs auto-offer | Paired run shows "Compare to base" button + manual fallback | |
| You decide | Planner picks | |

### Loop flagging
| Option | Description | Selected |
|--------|-------------|----------|
| Flag on single runs too | Advisory "possible loop" badge on repeated tool signatures, on any single run | ✓ |
| Only in compare | Loop badges only inside the diff view | |
| Defer loop-flagging | Skip loop detection this phase | |

**Notes:** User chose the FULL viewer — materially grows the phase (alignment algorithm + loop heuristic → research hand-offs). Deliberate, Phase-85-sanctioned inclusion. Loop detector is shared between single-run badges and the diff view.

---

## Declutter IA

### Quarantine toggle placement
| Option | Description | Selected |
|--------|-------------|----------|
| Page-level control | Prominent header-row toggle with count, out of the sidebar | ✓ |
| Top of sidebar, always-visible | Pinned top of sidebar, separated from facets | |
| You decide | Planner picks | |

### One-step scoring
| Option | Description | Selected |
|--------|-------------|----------|
| One-click score unscored runs | "Score" button triggers judge from dashboard | |
| Streamline override drawer | Inline-editable score cells in the runs-table row, autosave, no drawer | ✓ |
| Clarify with me | — | |

### Reconciliation badge placement
| Option | Description | Selected |
|--------|-------------|----------|
| Runs-table row badge | Per-run badge: reconciled / Δ discrepancy / transcript-fallback | |
| Timeline header | Detailed note on the open run's timeline header | |
| Both row + header | Glanceable row badge + detailed timeline-header note | ✓ |

**Notes:** Inline score editing preserves the existing server-authoritative saveOverride PATCH contract — surface change only, not scoring-logic change.

---

## Claude's Discretion

- Modal/fullscreen component mechanics; band render approach (SVG vs CSS) + token→width scaling.
- Run-alignment rule (D-07) and loop-heuristic definition (D-09) — captured as research hand-offs.
- Redux slice layout for the diff viewer + inline-score-edit state.
- Reconciliation badge status vocabulary/colours; quarantine-count query.

## Deferred Ideas

- Live agent-output tail streaming (rejected Phase 85 D-04/D-10).
- Queueing launches when the span slot is busy (Phase 85 D-02).
- Line-size ceiling / pagination on `/api/context-turns` for very large spans (Phase 84 deferral).
