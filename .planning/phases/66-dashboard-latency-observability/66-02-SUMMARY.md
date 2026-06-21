---
phase: 66-dashboard-latency-observability
plan: 02
subsystem: system-health-dashboard (LLM latency observability)
tags: [perf, observability, dashboard, react, median, latency, PERF-03]
status: awaiting-human-verify
requires:
  - "66-01: getSummary().by_model[].p50_latency_ms (proxy SQL median)"
provides:
  - "Median Latency column + green/amber/red threshold badge on the Token Usage by-model table (drill-down surface, D-01)"
  - "LlmLatencyTile headline tile on the :3032 system-health dashboard grid (glanceable surface, D-01)"
affects:
  - "PERF-03 / SC-1: operator reads the ~14s→≤3s speedup off the dashboard"
tech-stack:
  added: []
  patterns:
    - "Tile owns its own data via useState+useEffect+fetch of the dashboard SAME-ORIGIN /api/token-usage/summary proxy (NOT the proxy host:port directly) — main dashboard reads Redux which lacks the median (66-PATTERNS Redux caveat)"
    - "D-03 threshold envelope reuses health-status-card's operational/warning/error → green/amber/red badge idiom; D-04 keys haiku (direct path) off model-name match for the no-threshold reference rendering"
key-files:
  created:
    - "integrations/system-health-dashboard/src/components/llm-latency-tile.tsx"
  modified:
    - "integrations/system-health-dashboard/src/pages/token-usage.tsx"
    - "integrations/system-health-dashboard/src/components/system-health-dashboard.tsx"
decisions:
  - "Median rides on the existing `summary` response (66-01 piggyback) — NO new fetch on token-usage.tsx; the tile owns one same-origin fetch on a 30s poll."
  - "Threshold badge applied ONLY in the model group-by view AND only to non-haiku models; haiku renders plain (muted) as the direct-path reference baseline (D-04)."
  - "Tile feeds the existing default-export HealthStatusCard via a StatusItem[] builder (cheapest consistent path per D-03 'tile visual layout') rather than a bespoke big-number layout; haiku mapped to neutral 'offline' status so it reads as reference, not pass/fail."
metrics:
  duration_minutes: 11
  completed: "2026-06-21 (Tasks 1-3; Task 4 human-verify pending)"
  tasks_completed: 3
  tasks_total: 4
  files_changed: 3
---

# Phase 66 Plan 02: Dashboard Per-Model Median Latency on Both Surfaces Summary

Surfaced the per-model median (`p50_latency_ms` from Plan 66-01) on BOTH dashboard surfaces required by D-01: a **Median Latency** column with a green ≤3s / amber / red regression badge on the Token Usage by-model table (drill-down), and a new **LlmLatencyTile** headline tile on the `:3032` system-health dashboard grid (glanceable). Haiku is the no-threshold direct-path reference row on both. **Tasks 1-3 complete and committed; Task 4 is a blocking human-verify checkpoint awaiting operator approval.**

## What Was Built

**Task 1 — Median Latency column on the Token Usage by-model table (commit `ae80d5242`)**
- Extended `TokenSummary.by_model` with `p50_latency_ms?: number` (66-01 piggyback; no new fetch).
- Added a "Median Latency" header + cell beside the existing "Avg Latency" column on the Evolution-tab by-model table.
- Added `isHaikuModel()` + `latencyThresholdStatus()` helpers; the cell renders `formatLatency(m.p50_latency_ms)` (reused AS-IS) with a green ≤3000ms / amber 3000–5000ms / red >5000ms badge for sonnet+opus (model group-by only), and a plain muted median for haiku (D-04).

**Task 2 — LlmLatencyTile + registration (commit `beec159eb`)**
- New `llm-latency-tile.tsx` (131 lines): owns its data via `useState`+`useEffect`+`fetch('/api/token-usage/summary?hours=24')` (the dashboard SAME-ORIGIN proxy → server.js → host.docker.internal; NOT the proxy host:port directly, per the 66-PATTERNS Redux caveat), polling every 30s.
- Builds a `StatusItem[]` from `by_model[].p50_latency_ms` filtered to sonnet/opus/haiku, feeds the existing default-export `HealthStatusCard`. sonnet/opus → green/amber/red threshold status; haiku → neutral `'offline'` (reference, not pass/fail).
- Registered `<LlmLatencyTile />` into the existing `:3032` tile grid (`import` + JSX). The `lg:grid-cols-5` grid wraps the 6th card to a new row responsively.

**Task 3 — rebuild + restart (commit `e9cd18733`)**
- `npm run build` in the dashboard dir (exit 0; bundle carries `p50_latency_ms`, 2 occurrences).
- `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend` → RUNNING (pid 9274) so `:3032` serves the new column + tile.

## Verification

| Check | Result |
|-------|--------|
| `grep -c p50_latency_ms token-usage.tsx` | 7 (≥2) |
| `grep formatLatency(.*p50` token-usage.tsx | matches (2 sites) |
| green-threshold class in by-model cell | present (`bg-green-50 text-green-700 border-green-200`) |
| `tsc --noEmit` new errors for token-usage.tsx | none (2 pre-existing recharts Formatter errors only — see Deviations) |
| `llm-latency-tile.tsx` line count | 131 (≥40) |
| tile fetches same-origin `/api/token-usage/summary` | yes; `grep -c localhost:12435` → 0 |
| `grep -c p50_latency_ms llm-latency-tile.tsx` | 5 (≥1) |
| `grep -c LlmLatencyTile system-health-dashboard.tsx` | 2 (import + JSX) |
| `tsc --noEmit` new errors for tile/dashboard | none (3 pre-existing StatusItem 'unknown' errors only — see Deviations) |
| `npm run build` | exit 0; `grep -c p50_latency_ms dist/assets/index-*.js` → 2 |
| frontend service after restart | RUNNING (pid 9274) |

### Visual evidence (gsd-browser, captured for the Task 4 checkpoint)

- `/tmp/66-02-dashboard-tile.png` — `:3032` tile grid; the **LLM Latency** tile renders `claude-sonnet-4.6` (red **Error** badge — honest pre-pool median) and a haiku reference row (plain/neutral).
- `/tmp/66-02-bymodel-table.png` — Token Usage → Evolution → By Model; the **Top Consumers** table shows `Model | Calls | Total Tokens | Avg Latency | Median Latency | Share`. `claude-haiku-4.5` median **1.3s** plain (reference); `claude-sonnet-4.6` median **176.1s** with a **red badge** (D-03 regression treatment).

Observed live medians (read off the rendered table): haiku 1.3s (avg 1.7s); sonnet 176.1s (avg 174.5s). The sonnet figure is the honest 24h median PERF-03 asks the dashboard to surface — it still contains pre-worker-pool historical calls and will trend toward ≤3s as warm-worker traffic ages into the window (per 66-01 SUMMARY § Notes for Plan 66-02). The red badge correctly signals "not yet at the warm bar".

## Deviations from Plan

### Auto-fixed Issues

None — the three source changes landed as written.

### Out-of-scope (deferred, NOT fixed — per SCOPE BOUNDARY)

Logged to `66-dashboard-latency-observability/deferred-items.md`. All confirmed PRE-EXISTING via a `git stash` baseline comparison before any 66-02 edit:

1. `token-usage.tsx` — 2 recharts `Formatter<number, NameType>` TS2322 errors on `<Tooltip formatter={...} />` (pre-existing recharts typing drift). No NEW token-usage.tsx error from the median column.
2. `system-health-dashboard.tsx` — 3 `StatusItem[]` TS2322 errors where `getDatabaseItems/getServiceItems/getProcessItems` emit a `'unknown'` status not in the `StatusItem` union. Pre-existing; the `<LlmLatencyTile />` registration type-checks cleanly and adds no new error.

## Checkpoint Status

**Task 4 (`checkpoint:human-verify`, gate="blocking") is NOT self-approved.** The gsd-browser visual evidence has been captured (paths above). Control is being returned to the orchestrator for explicit human confirmation that both surfaces render the per-model median with the green ≤3s treatment (when warm) and the haiku reference row. The plan is NOT marked fully complete.

**Resume signal (from the plan):** Type "approved" if both surfaces show the per-model median with the green ≤3s treatment and haiku reference row; otherwise describe what renders wrong.

> Note on the live data: with the 24h window still dominated by pre-worker-pool sonnet calls, the sonnet median reads ~176s and the badge is RED — this is the *honest* median (SC-1 surfaces the number; the green ≤3s state appears as warm traffic ages in). The threshold machinery is proven correct: haiku ≤3s renders plain (reference), sonnet >5s renders red. The operator may wish to confirm the green state once the window is warm, OR approve on the basis that the threshold logic and both surfaces are demonstrably wired (green ≤3000 / amber / red >5000 envelope is in code and the badge already flips red on the >5s sonnet median).

## Self-Check: PASSED

- `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx` — FOUND
- `integrations/system-health-dashboard/src/pages/token-usage.tsx` carries `p50_latency_ms` — FOUND (7)
- `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx` carries `LlmLatencyTile` — FOUND (2)
- Commit `ae80d5242` (Task 1) — FOUND
- Commit `beec159eb` (Task 2) — FOUND
- Commit `e9cd18733` (Task 3) — FOUND
- `dist/assets/index-*.js` carries `p50_latency_ms` — FOUND (2)
- Both surfaces render the median (gsd-browser screenshots) — VERIFIED on :3032
