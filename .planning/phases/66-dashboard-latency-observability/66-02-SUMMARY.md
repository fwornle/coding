---
phase: 66-dashboard-latency-observability
plan: 02
subsystem: system-health-dashboard (LLM latency observability)
tags: [perf, observability, dashboard, react, median, latency, PERF-03]
status: complete
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
  completed: "2026-06-21 (all 4 tasks; Task 4 human-verify APPROVED after v3 enhancements)"
  tasks_completed: 4
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

### User-directed deviation (v3 enhancement, recorded per plan instruction)

**[Tile-scoped deviation from D-05] Headline tile uses a 1h rolling window, not rolling-24h**
- **D-05 locked** a rolling-24h window for the median surfaces. The headline LlmLatencyTile now fetches `summary?hours=1` instead of `hours=24`.
- **Scope:** ONLY the headline tile. The Token Usage drill-down TABLE (`token-usage.tsx`) **stays 24h** — unchanged.
- **Rationale (user decision):** a 24h median is dominated by stale pre-worker-pool history and reads red even when warm calls are ≤3s; a 1h window reflects current warm-pool health and goes green as history ages out. The drill-down table retains the full 24h honest median for forensic context.
- **Authorized by:** the human reviewer at the blocking checkpoint (second review), explicitly directing the tile-only window change.

### Out-of-scope (deferred, NOT fixed — per SCOPE BOUNDARY)

Logged to `66-dashboard-latency-observability/deferred-items.md`. All confirmed PRE-EXISTING via a `git stash` baseline comparison before any 66-02 edit:

1. `token-usage.tsx` — 2 recharts `Formatter<number, NameType>` TS2322 errors on `<Tooltip formatter={...} />` (pre-existing recharts typing drift). No NEW token-usage.tsx error from the median column.
2. `system-health-dashboard.tsx` — 3 `StatusItem[]` TS2322 errors where `getDatabaseItems/getServiceItems/getProcessItems` emit a `'unknown'` status not in the `StatusItem` union. Pre-existing; the `<LlmLatencyTile />` registration type-checks cleanly and adds no new error.

## Checkpoint-Fix Iteration (2026-06-21, post-human-review)

The human reviewed the live `:3032` LLM Latency tile at the blocking checkpoint and flagged THREE rendering issues. All three were fixed in a single `fix(66-02): ...` commit, the frontend was rebuilt + restarted, and a fresh gsd-browser screenshot was captured (`/tmp/66-02-tile-fix.png`). The checkpoint remains **blocking and NOT self-approved** — these are presentation fixes for re-review.

1. **Haiku "Offline" badge was misleading** — it read as a fault, but haiku is the direct-path REFERENCE baseline (D-04, alive ~1.3s). Introduced a neutral `'reference'` status in `health-status-card.tsx` that renders a muted italic "reference" label (no pass/fail Badge, no operational/warning/error/offline semantics). The tile maps haiku → `'reference'`.
2. **Sonnet red "Error" badge text read as a service outage** — the RED color is correct (D-03 regression treatment, kept) but "Error" reads as an outage next to the "Healthy" header. Added latency-specific badge LABELS via a new optional `badgeLabel` override on `StatusItem` (color unchanged): green → "OK", amber → "Elevated", red → "Regressed". The tile now passes these per-state.
3. **Tile wrapped to its own row** below the 5-up grid. Widened the grid from `lg:grid-cols-5` to `lg:grid-cols-3 xl:grid-cols-6` so all 6 health cards sit inline on one row at wide widths (lg keeps a sensible 3-up). The other 5 tiles render correctly at the new column count.

Also auto-fixed (Rule 1, latent bug my grid edit surfaced): added `'unknown'` to the `StatusItem` status union in `health-status-card.tsx` — `getDatabaseItems/getServiceItems/getProcessItems` already emit `'unknown'` (handled in `getStatusBadge`) but it was missing from the union, causing 3 pre-existing TS2322 errors. Now tsc-clean for all touched files.

**Files touched in this iteration:** `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx`, `integrations/system-health-dashboard/src/components/health-status-card.tsx`, `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx`.

**Visual re-confirmation** (`/tmp/66-02-tile-fix.png`): haiku shows a muted "reference" label (no Offline/fault badge); sonnet (4.6s median) shows the red badge with "Regressed" text; the LLM Latency tile sits inline as the 6th tile in the grid row.

## Checkpoint-Enhancement Iteration v3 (2026-06-21, second human review)

The human APPROVED the v2 badge/placement fixes but asked the tile to **explain its assessment** and use a **fresher window**. Four enhancements were applied to `llm-latency-tile.tsx` ONLY (no other file touched), the frontend was rebuilt + restarted, and fresh gsd-browser screenshots were captured. The checkpoint remains **blocking and NOT self-approved**.

1. **Headline tile switched to a 1h rolling window** (`fetch('/api/token-usage/summary?hours=1')`, was `hours=24`). **DEVIATION from D-05** (which locked rolling-24h) — see the dedicated deviation entry below. Both rows now read "· last 1h".
2. **Subtitle/legend added** under the card: muted `Per-model median · warm target ≤3s · last 1h`, so the threshold + window are visible at a glance.
3. **Per-model hover tooltips added** (via the existing `StatusItem.tooltip` field rendered by HealthStatusCard): sonnet/opus → "Median latency over last 1h. Warm target ≤3s; amber 3–5s; red >5s climbing toward the ~14s pre-pool baseline."; haiku → "Direct-path OAuth baseline — not pool-graded (reference only)." (DOM-verified present.)
4. **Per-model latency TREND sparkline added** — a tiny inline SVG polyline per model row, drawn from the per-bucket median latency over the last 1h (12 buckets, lower-mid median per bucket, empty buckets dropped). Stroke color matches the status (green/amber/red). Lets an operator SEE the assessment arising — a rising sonnet line = regressing, falling = recovering — rather than trusting one number. Degrades to the number alone when <2 in-window buckets exist.

**Sparkline data source (cheapest, option 4a — NO proxy change):** the existing same-origin `/api/token-usage/recent?limit=500` feed already returns per-call rows carrying `timestamp` + `model` + `latency_ms`. The tile fetches it alongside the summary, filters to the last 1h, buckets per-model client-side, and computes the per-bucket median. The proxy `token-usage.ts` was **NOT** touched (no new endpoint, no parameterized time-series query needed); the recent endpoint is already clamped to 500 rows server-side. recharts was deliberately avoided (it carries the deferred-items typing cluster) in favor of a hand-rolled inline SVG `<polyline>` to keep the tile cheap and tsc-clean.

**Visual re-confirmation v3** (`/tmp/66-02-tile-v3-full.png` full page; `/tmp/66-02-tile-v3-crop.png` tile crop): both rows read "last 1h"; the subtitle legend renders muted under the rows; 4 tooltips are present in the DOM with the exact specified wording; two sparklines render — sonnet a red rising trend (matching the "Regressed" badge), haiku a grey reference trend. sonnet still reads red (~90.8s) because this hour's history is sonnet-fallback-heavy, but the rising sparkline now makes the assessment self-explanatory.

**Files touched in this iteration:** `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx` (only).

## Checkpoint-Redesign Iteration v4 (2026-06-21, REOPENED blocking checkpoint — last-N-calls)

The operator REOPENED the blocking checkpoint: the v3 **1h-window** tile (`summary?hours=1`)
**DROPPED the sonnet/opus rows entirely** whenever there were no claude-code fallback calls in
the last hour — the tile went blank except for haiku ("no more sonnet?"). The operator chose a
**last-N-calls + always-keep-rows** redesign. Applied to `llm-latency-tile.tsx` ONLY (no other file
touched), frontend rebuilt + restarted, fresh gsd-browser screenshots captured. The checkpoint
remains **blocking and NOT self-approved**.

1. **SINGLE data source = the `/recent` feed.** BOTH the headline median AND the sparkline now
   derive from `/api/token-usage/recent` (same-origin proxy). The tile **no longer fetches
   `summary?hours=1`** (`grep -c token-usage/summary llm-latency-tile.tsx` → 0). This also fixes a
   latent inconsistency: v3's headline came from `summary?hours=1` while the sparkline came from
   `/recent`, so they could contradict; now they ride identical samples. The `/recent` limit was
   raised to `?limit=1000` (bounded, not unbounded) so each tracked family can accumulate up to
   ~50 samples; fewer is fine (uses whatever it has).
2. **Per-model median over the last ~50 calls.** For each tracked family, filter the feed by family
   keyword, sort newest-first, slice 50, and take the lower-mid `median()` of `latency_ms` (same
   convention as 66-01). The sparkline rides those same samples (oldest→newest, per-call) so headline
   and trend agree.
3. **ALWAYS keep fixed rows — never drop a model when quiet.** A `TRACKED_FAMILIES` list (sonnet,
   opus, haiku) drives the row set, matched by **family keyword** (`/sonnet/i` etc.) so a version
   bump (claude-sonnet-4.6 → 4.x) doesn't break the row. A family with **zero recent calls** renders
   a muted "no recent calls" placeholder (neutral `'reference'` status, `—` badge, no sparkline)
   instead of vanishing. This is the direct fix for the operator's "no more sonnet?".
4. **Threshold + reference semantics preserved (D-03/D-04), wording updated to "last ~50 calls":**
   sonnet/opus green ≤3000ms ("OK") / amber 3000–5000ms ("Elevated") / red >5000ms ("Regressed");
   haiku muted italic "reference", no threshold. Tooltips updated: sonnet/opus → "Median of the last
   ~50 calls. Warm target ≤3s; amber 3–5s; red >5s."; haiku → "Direct-path OAuth baseline — not
   pool-graded (reference only)." Subtitle/legend now reads `Per-model median · warm target ≤3s ·
   last ~50 calls`.

The Token Usage drill-down table (`token-usage.tsx`) was **NOT** touched — it stays on its 24h
summary basis (D-05). This redesign is the headline tile only.

**Files touched in this iteration:** `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx` (only).

**Visual re-confirmation v4** (`/tmp/66-02-tile-v4.png` full page; `/tmp/66-02-tile-v4-crop.png` tile crop):
the live tile renders THREE rows — **claude-sonnet-4.6** "90.8s median · last ~18 calls" with the red
**Regressed** badge; **opus** "no recent calls" muted placeholder (kept as a row, NOT dropped — the
operator's fix); **claude-haiku-4.5** "966ms median (reference) · last ~50 calls" muted italic
"reference". Subtitle reads "Per-model median · warm target ≤3s · last ~50 calls". Sparklines render
for sonnet (18 samples) and haiku (50 samples). `tsc --noEmit` clean for the tile; `npm run build`
exit 0; frontend service RUNNING (pid 31224).

**Resume signal (operator):** approve if sonnet+opus+haiku always render (quiet models show "no recent
calls" rather than dropping) and the median/sparkline ride the last ~50 calls; otherwise describe what
renders wrong.

## Checkpoint Status

**Task 4 (`checkpoint:human-verify`, gate="blocking") — APPROVED by the operator on 2026-06-21 after the v4 last-N-calls redesign.** The operator confirmed the tile stays useful both busy and quiet: sonnet/opus/haiku always render as fixed rows (quiet models show "no recent calls" rather than vanishing), and the median + sparkline both ride the last ~50 calls from the `/recent` feed. Plan 66-02 is COMPLETE. Prior v3/v4 history below for context.

**Earlier (v3) — APPROVED by the human reviewer on 2026-06-21.** Approval came after the v3 enhancements (1h window, subtitle/legend, per-model tooltips, trend sparkline), with the gsd-browser visual evidence re-captured (`/tmp/66-02-tile-v3-full.png`, `/tmp/66-02-tile-v3-crop.png`). The operator confirmed the tile now explains its assessment (why "Regressed", what "reference") over the fresher 1h window. Plan 66-02 is COMPLETE.

**Resume signal (from the plan):** Type "approved" if both surfaces show the per-model median with the green ≤3s treatment and haiku reference row; otherwise describe what renders wrong.

> Note on the live data (v3, 1h tile window): the sonnet median now reads ~90.8s over the last 1h (fresher than the 24h ~176s) and the badge is RED — this hour's history is still sonnet-fallback-heavy. The per-model **trend sparkline** now makes the assessment self-explanatory: a rising sonnet line = the median climbing (regressing), a falling line = recovering toward the ≤3s warm bar. The threshold machinery is proven: haiku ≤3s renders plain (reference, ~1.1s); sonnet >5s renders red with the "Regressed" label. The 1h window will flip the badge green as warm-pool traffic dominates the hour. The operator may confirm the green state once warm, OR approve on the basis that the 1h window + subtitle + tooltips + trend sparkline are demonstrably wired and the threshold envelope (green ≤3000 / amber / red >5000) flips correctly.

## Self-Check: PASSED

- `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx` — FOUND
- `integrations/system-health-dashboard/src/pages/token-usage.tsx` carries `p50_latency_ms` — FOUND (7)
- `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx` carries `LlmLatencyTile` — FOUND (2)
- Commit `ae80d5242` (Task 1) — FOUND
- Commit `beec159eb` (Task 2) — FOUND
- Commit `e9cd18733` (Task 3) — FOUND
- `dist/assets/index-*.js` carries `p50_latency_ms` — FOUND (2)
- Both surfaces render the median (gsd-browser screenshots) — VERIFIED on :3032
