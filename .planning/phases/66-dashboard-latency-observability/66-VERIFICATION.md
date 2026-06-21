---
phase: 66-dashboard-latency-observability
verified: 2026-06-21T00:00:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Confirm the :3032 LlmLatencyTile goes GREEN once warm-pool traffic dominates the 1h window"
    expected: "LlmLatencyTile shows claude-sonnet-4.6 badge flipping from 'Regressed' (red) to 'OK' (green, ≤3s) as warm calls fill the rolling 1h window — the ~14s→≤3s speedup is visually readable at a glance"
    why_human: "The tile window is 1h. At verification time the running proxy still has a red badge (~90.8s 1h median per SUMMARY) because the last hour contains pre-pool history. The threshold machinery is wired and proven correct; only live traffic aging through the window can confirm the green state. Automated checks cannot substitute for observing the badge state once the pool has been warm for 1h."
  - test: "Regression path: disable the worker pool and confirm the badge flips red"
    expected: "After setting LLM_PROXY_DISABLE_WORKER_POOL=1 and driving a handful of sonnet fallback calls, the 1h tile median climbs above 5s and the badge shows 'Regressed' (red) within the next poll cycle (30s)"
    why_human: "SC-2 of PERF-03 — the regression signal path. Requires driving real proxy calls and observing the badge color change over time. Cannot verify statically."
---

# Phase 66: Dashboard Latency Observability Verification Report

**Phase Goal:** Operators can see the speedup land in production — the dashboard's claude-code latency column reflects the warm-pool steady-state, so the ~14s → ≤3s improvement is visible and trackable within a day of rollout rather than only provable by an ad-hoc probe.
**Verified:** 2026-06-21T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `getSummary().by_model` rows each carry a `p50_latency_ms` field (median over the 24h window, D-02 median not average, D-06 all in-window rows including cold spawns) | ✓ VERIFIED | `token-usage.ts:815-845` — ordered-offset subquery (`LIMIT 1 OFFSET ?`) per model; D-06 comment at line 819-820 confirms no warm/cold filter; all 3 params bound as `?` (SQLi mitigated) |
| 2 | `GET /api/token-usage/summary?hours=24` JSON carries `by_model[].p50_latency_ms` live on the running proxy | ✓ VERIFIED | Live probe: `p50 PRESENT on by_model rows: [('claude-haiku-4.5', 1330), ('claude-sonnet-4.6', 176120)]` — confirmed on port 12435 |
| 3 | Token Usage page by-model table shows a "Median Latency" column reading `p50_latency_ms` with green ≤3s / amber / red threshold badge for sonnet+opus (D-03), and haiku renders plain with no threshold (D-04) | ✓ VERIFIED | `token-usage.tsx:752` — `<TableHead>Median Latency</TableHead>` adjacent to "Avg Latency"; `latencyThresholdStatus()` at line 204 (≤3000 operational / ≤5000 warning / else error); `isHaikuModel()` at line 194 gates threshold off for haiku; green class `bg-green-50 text-green-700` at line 791 |
| 4 | A headline LlmLatencyTile on the :3032 system-health dashboard tile grid shows per-model median (sonnet, opus, haiku-reference) with green→red threshold badge and haiku as reference (D-01) | ✓ VERIFIED | `llm-latency-tile.tsx` exists at 314 lines (≥40); fetches `/api/token-usage/summary?hours=1` same-origin (no `localhost:12435`); haiku mapped to `'reference'` status (muted italic, no pass/fail badge); sonnet/opus mapped to `latencyStatus(p50)` threshold; registered in `system-health-dashboard.tsx` as `<LlmLatencyTile />` at line 573 with import at line 27 |
| 5 | An operator can read the ~14s→≤3s speedup AND a regression (median climbing toward ~14s / badge red) off the dashboard, sourced from the same fallback-path token-usage telemetry (SC-2) | ✓ VERIFIED (wiring confirmed; live data confirmation is human-needed) | The tile fetches the same proxy telemetry the pool serves (D-07); live data shows haiku 1.3s (reference) and sonnet 176.1s (pre-pool 24h history, correctly red); threshold envelope is wired; trend sparkline computed from `/api/token-usage/recent` per-bucket medians confirms direction |
| 6 | Empty or young token-usage DB returns `p50_latency_ms: 0` or absent rather than throwing a 500 | ✓ VERIFIED | `token-usage.ts:825` — entire p50 block in `try/catch`; `count <= 0` skipped at line 836; Test 2 (`empty token_usage DB returns without throwing`) asserts `by_model: []` with `doesNotThrow` |

**Score:** 6/6 truths verified (wiring confirmed; SC-1 "badge green" path is human-needed pending warm-pool data aging through the 1h window)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` | MEDIAN(latency_ms) per-model query on `getSummary` by_model rows | ✓ VERIFIED | 5 occurrences of `p50_latency_ms`; ordered-offset prepared statement; try/catch wrapper; all params bound |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist/token-usage.js` | Compiled output proxy loads | ✓ VERIFIED | 4 occurrences of `p50_latency_ms` in dist file; rebuilt at commit `a7ba478` |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.test.ts` | 3 node:test assertions for median behavior | ✓ VERIFIED | File exists (3561 bytes); Test 1: seeded [1000..5000] → p50=3000; Test 2: empty-DB no-throw; Test 3: out-of-window exclusion |
| `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx` | Headline tile ≥40 lines, same-origin fetch, p50_latency_ms reads | ✓ VERIFIED | 314 lines; 5 occurrences of `p50_latency_ms`; fetches `/api/token-usage/summary?hours=1` (same-origin); 0 occurrences of `localhost:12435` |
| `integrations/system-health-dashboard/src/pages/token-usage.tsx` | Median Latency column with p50_latency_ms | ✓ VERIFIED | 7 occurrences of `p50_latency_ms`; "Median Latency" `<TableHead>` at line 752; `formatLatency(m.p50_latency_ms)` at lines 797/802; `isHaikuModel()` gates threshold |
| `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx` | LlmLatencyTile registered in tile grid | ✓ VERIFIED | 2 occurrences of `LlmLatencyTile` (import line 27 + JSX line 573) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `getSummary by_model SELECT` | `token_usage` table | parameterized `prepare().get(model, since, offset)` with bound `?` | ✓ WIRED | `token-usage.ts:826-832` — prepared statement with `?` placeholders; `model`, `since` (clamped 24h window from lines 774-779), `offset` all bound |
| `llm-latency-tile.tsx` | `/api/token-usage/summary` | same-origin `fetch()` through server.js → host.docker.internal:12435 | ✓ WIRED | Line 211: `fetch('/api/token-usage/summary?hours=${WINDOW_HOURS}')` — relative URL confirmed; no hardcoded proxy host |
| `token-usage.tsx by-model row` | `p50_latency_ms` field | `formatLatency` + `latencyThresholdStatus` badge | ✓ WIRED | Lines 786-802: `m?.p50_latency_ms != null` guard; `latencyThresholdStatus()` at 789; `formatLatency(m.p50_latency_ms)` at 797 (threshold) / 802 (haiku plain) |
| `LlmLatencyTile` | `:3032` tile grid | `<LlmLatencyTile />` JSX + import in `system-health-dashboard.tsx` | ✓ WIRED | Import line 27; JSX line 573 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `llm-latency-tile.tsx` | `summaryData.by_model[].p50_latency_ms` | `/api/token-usage/summary?hours=1` → proxy `getSummary()` → SQLite `token_usage` table ordered-offset query | Yes — live probe returned real values (haiku 1330ms, sonnet 176120ms) | ✓ FLOWING |
| `token-usage.tsx` by-model table | `meta.get(key).p50_latency_ms` | same-origin `PROXY_BASE/api/token-usage/summary` → same proxy path | Yes — same endpoint; hardcoded `localhost:12435` (pre-existing IN-02, not Phase 66 introduced) | ✓ FLOWING (pre-existing PROXY_BASE pattern) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Live proxy serves `p50_latency_ms` on `by_model` rows | `curl -s http://localhost:12435/api/token-usage/summary?hours=24` | `[('claude-haiku-4.5', 1330), ('claude-sonnet-4.6', 176120)]` | ✓ PASS |
| `dist/token-usage.js` built with p50 field | `grep -c p50_latency_ms dist/token-usage.js` | 4 | ✓ PASS |
| Dashboard running at :3032 | `curl -s http://localhost:3032` returns HTML | HTML doctype returned | ✓ PASS |
| Bundle carries `p50_latency_ms` | `find dist/assets -name index-*.js | xargs grep -l p50_latency_ms` | 1 file found | ✓ PASS |
| Dashboard bundle carries LlmLatencyTile | `find dist/assets -name index-*.js | xargs grep -l "LLM Latency"` | 1 file found | ✓ PASS |
| `tsc --noEmit` for Phase 66 modified files | `npx tsc --noEmit 2>&1 | grep -iE "llm-latency|system-health-dashboard|health-status-card"` | 0 new errors for Phase 66 files | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PERF-03 | 66-01, 66-02 | Dashboard's claude-code latency column shows the speedup — median claude-code/sonnet latency drops from ~14s to ≤3s within 24h of rollout | ✓ SATISFIED (infrastructure) / ? NEEDS HUMAN (≤3s green state live) | The median column and tile are wired and showing real data. The ≤3s green state requires warm-pool traffic to dominate the 1h window — a time-dependent condition that cannot be verified statically. The REQUIREMENTS.md traceability row still reads `Not started` (stale — see WARNING below). |

**WARNING — REQUIREMENTS.md traceability row is stale:** `PERF-03 | Phase 66 | Not started` at line 70. The phase is complete; the traceability table was not updated. This is a documentation gap, not a functional blocker.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `token-usage.ts` | 859, 888, 916, 943 | `${bucketSeconds}` interpolated into SQL string (pre-existing, not Phase 66) | Warning (WR-01 from code review) | Pre-existing code adjacent to the new median block; not introduced by Phase 66; `bucketSeconds` is a JS number (Math.max of a floor'd value), so no classic string-inject, but NaN can reach the query on malformed input |
| `token-usage.tsx` | 583, 669 | Pre-existing `recharts Formatter` TS2322 type errors | Info | Pre-existing; confirmed present in the file before commit `ae80d5242`; Phase 66 introduced 0 new TS errors on this file |
| `token-usage.tsx` | 18-19 | Hardcoded `PROXY_BASE = http://localhost:12435` (pre-existing, IN-02 from code review) | Info | Pre-existing; the new tile correctly uses same-origin; the page retains the pre-existing pattern |
| `llm-latency-tile.tsx` / `token-usage.tsx` | multiple | Threshold constants (`≤3000 / ≤5000`) duplicated in two files with no shared module (IN-03) | Info | Advisory only; will require dual-edit if warm bar changes |

No TBD / FIXME / XXX markers in any Phase 66 file. No debt markers introduced.

---

### Accepted Deviations

**Tile 1h window (tile-scoped deviation from D-05):** The headline LlmLatencyTile fetches `summary?hours=1` instead of the D-05 rolling-24h window. The Token Usage drill-down table retains `hours=24`. This deviation was operator-authorized at the blocking human-verify checkpoint (Task 4, second review iteration). Rationale: a 24h median is dominated by pre-worker-pool history and reads red even when warm calls are ≤3s; a 1h window reflects current pool health. The 24h honest median remains available on the drill-down. Treated as accepted decision per the phase context note.

---

### Human Verification Required

#### 1. Badge Turns Green Once Warm Pool Dominates the 1h Window

**Test:** After the worker pool has been warm for at least 1h (serving claude-code/sonnet requests through the pool), navigate to `http://localhost:3032` and observe the LLM Latency tile.
**Expected:** The `claude-sonnet-4.6` row shows a green "OK" badge with a median ≤3s, and the trend sparkline shows a falling or flat line. This is the operator-visible proof that the ~14s→≤3s speedup has landed.
**Why human:** The tile uses a 1h rolling window. At verification time the median is ~90.8s (pre-pool history dominating the hour). The threshold machinery is correctly wired and flips on the data alone — no code change is needed. Only live warm-pool traffic aging through the 1h window can produce the green state.

#### 2. Regression Signal Path (SC-2)

**Test:** Set `LLM_PROXY_DISABLE_WORKER_POOL=1` on the running proxy (or restart via `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` with the env var), drive 3-5 sonnet fallback calls, wait 30s for the tile poll cycle, and observe the LLM Latency tile badge.
**Expected:** The `claude-sonnet-4.6` badge shows "Regressed" (red) as the median climbs above 5s, confirming the tile reads the same fallback-path telemetry the pool serves (PERF-03 SC-2).
**Why human:** Requires driving real proxy traffic with the pool disabled and observing a live badge color change over time — cannot be verified statically.

---

### Gaps Summary

No functional gaps found. All 6 must-haves are verified against the actual codebase. The two human verification items are time-dependent observability checks (waiting for warm-pool data to populate the 1h window) rather than code defects.

**Non-blocking items to note:**
1. REQUIREMENTS.md traceability row `PERF-03 | Phase 66 | Not started` is stale. The implementation is complete; the row should be updated to `Complete`.
2. WR-01 (pre-existing `${bucketSeconds}` SQL interpolation) and IN-02/IN-03 from the code review are advisory and pre-date Phase 66.

---

_Verified: 2026-06-21T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
