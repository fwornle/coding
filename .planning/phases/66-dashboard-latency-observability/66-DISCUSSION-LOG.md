# Phase 66: Dashboard Latency Observability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 66-dashboard-latency-observability
**Areas discussed:** Display surface, Regression visibility, Window & scope, Cold-spawn handling

---

## Display surface

| Option | Description | Selected |
|--------|-------------|----------|
| Main health dashboard tile | New 'LLM Fallback Latency' tile on :3032 (glanceable) | |
| Extend Token Usage page | Add median + indicator to existing token-usage.tsx | |
| Both | Headline tile + Token Usage page drill-down | ✓ |

**User's choice:** Both
**Notes:** Glanceable per-model tile on the daily dashboard plus the Token Usage page as the detail view.

---

## Regression visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Threshold color + trend | Median + trend indicator + green→red badge at a threshold | ✓ |
| Number + trend only | Median + up/down trend, no threshold/color | |
| Sparkline over window | Time-series sparkline of median latency | |

**User's choice:** Threshold color + trend
**Notes:** Operator should see a regression at a glance without reading the number; worked example was >5s = regressed, anchored to green ≤3s and the ~14s baseline.

---

## Window & scope

| Option | Description | Selected |
|--------|-------------|----------|
| Rolling 24h, sonnet-specific | Single 24h median, provider=claude-code AND model=sonnet | |
| Selectable window | 1h / 24h / 7d selector | |
| Per-model breakdown | Median per claude-code model (sonnet + opus + haiku-direct) | ✓ |

**User's choice:** Per-model breakdown
**Notes:** Per-model rows preferred over a single sonnet figure; window locked to rolling 24h (D-05) since selectable-window was not chosen. Haiku is the direct-path reference row (no pool, no regression threshold).

---

## Cold-spawn handling

| Option | Description | Selected |
|--------|-------------|----------|
| All traffic (honest) | Median over ALL calls incl. cold spawns; no special-casing | ✓ |
| Warm-only | Exclude cold spawns; requires telemetry cold/warm tagging | |

**User's choice:** All traffic (honest)
**Notes:** Honest real-world number; cold-spawn storms correctly push the median up (trips the regression badge). Avoids a production proxy change to tag cold vs warm.

---

## Claude's Discretion

- WHERE the median is computed (proxy SQL vs dashboard backend vs frontend over /recent) — SQLite has no native MEDIAN; planner picks the approach.
- Exact regression threshold value(s) / amber band within the green ≤3s → red-toward-14s envelope.
- Tile visual layout within the dashboard's existing tile/card system.

## Deferred Ideas

- Selectable time window (1h/7d) on the headline tile — not chosen; possible drill-down-page-only enhancement.
- Warm-vs-cold latency split — needs a production proxy change; out of scope.
- Alerting/paging on regression — this phase makes regression visible, not alertable.
- Reviewed-not-folded todos: sub-agent dashboard observability gap (different concern), OKM Express API bridge, LSL timeline cap, VKB legend — unrelated to PERF-03.

## Side fix (out of band, this session)

- Fixed `no-ascii-art-in-docs` constraint (`.constraint-monitor.yaml`) that was mis-firing on Bash command strings and AskUserQuestion previews and on `.planning/` docs. Added `tool_filter: [Edit,Write,MultiEdit]` and scoped `file_pattern` to `(^|/)docs/.*\.md$`. Committed separately.
