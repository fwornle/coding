---
phase: 66-dashboard-latency-observability
plan: 04
subsystem: system-health-dashboard (LlmLatencyTile + Token Usage by-model table re-point to worker-pool overhead)
tags: [perf, observability, dashboard, react, overhead, latency, PERF-03]

# Dependency graph
requires:
  - phase: 66-dashboard-latency-observability (Plan 03)
    provides: "recent.overhead_ms + summary.by_model[].p50_overhead_ms (worker-pool spawn/queue overhead, generation excluded)"
provides:
  - ":3032 LlmLatencyTile grades worker-pool SPAWN OVERHEAD (overhead_ms median, last ~50 calls) instead of total latency — ≤3s green / amber / red, relabelled 'LLM Pool Overhead'"
  - "Token Usage by-model table gains a 'Spawn Overhead' column (p50_overhead_ms) with the green/amber/red badge; total-latency Median column retained as forensic context"
  - "haiku rendered as a non-graded 'direct path — no pool overhead' reference; quiet graded families show 'no recent pool calls'"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Graded value swapped from total latency_ms to pool overhead_ms while preserving the 66-02 v4 last-N-calls + always-keep-rows + sparkline UX unchanged"
    - "Number.isFinite(overhead_ms) filter excludes NULL (direct/haiku/legacy) rows from the graded median + sparkline (T-66-04-02)"

key-files:
  created: []
  modified:
    - "integrations/system-health-dashboard/src/components/llm-latency-tile.tsx (overhead_ms re-point + relabel)"
    - "integrations/system-health-dashboard/src/pages/token-usage.tsx (Spawn Overhead column reading p50_overhead_ms)"

key-decisions:
  - "Tile title relabelled 'LLM Latency' -> 'LLM Pool Overhead'; subtitle 'Per-model spawn overhead · warm target ≤3s · last ~50 calls'; per-row line 'N overhead median · last ~50 calls'."
  - "haiku is a non-graded reference row labelled 'direct path — no pool overhead' (D-04 spirit) — its overhead_ms is NULL so it is never graded."
  - "Token Usage Median Latency (total, p50_latency_ms) column retained as forensic context; the threshold badge moved OFF it onto the new Spawn Overhead column (total latency is generation-dominated and must not be graded against the ≤3s pool bar)."
  - "SC-2 red badge could NOT be demonstrated on this host — genuine cold-spawn overhead tops out at ~2.5s (< the 5s red / 3s amber thresholds); the pool-disable switch logs NULL overhead (filtered out, never red). Logged to deferred-items.md; PERF-03 NOT marked fully Complete."

requirements-completed: []

# Metrics
duration: ~45 min (Task 3 disruptive run + restore + verification only; Tasks 1-2 by prior executor)
completed: 2026-06-21
---

# Phase 66 Plan 04: Dashboard Re-point to Worker-Pool Spawn Overhead Summary

**Re-pointed both :3032 dashboard surfaces from total end-to-end latency to the per-model worker-pool SPAWN OVERHEAD (overhead_ms / p50_overhead_ms from 66-03), so the ≤3s green / amber / red envelope finally grades the metric the pool actually affects — warm reuse near zero -> green, cold-spawn regression -> climbs. SC-1 (warm green) is confirmed live on both surfaces; SC-2 (pool-disabled red) could NOT be reached on this Apple Silicon host because genuine cold-spawn overhead tops out at ~2.5s, well below the 5s red threshold, and the pool-disable switch logs NULL overhead which the tile filters out — documented and deferred rather than faked.**

## Task Commits

Tasks 1 & 2 were committed by a prior executor (coding repo); this run executed the Task 3 operator-approved disruptive verification + finalization only.

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Re-point LlmLatencyTile to overhead median + relabel | `4ecbb9fcd` | src/components/llm-latency-tile.tsx |
| 2 | Add Spawn Overhead column to Token Usage table + rebuild/restart | `66a52bd6e` | src/pages/token-usage.tsx |
| 3 | Operator visual re-verification (gsd-browser) — warm green + pool-disabled red | (no source commit; verification + this SUMMARY) | evidence/*.png |

## must_haves Verification

| # | Truth | Result | Evidence |
|---|-------|--------|----------|
| 1 | Tile renders per-model OVERHEAD median (overhead_ms), relabelled 'Pool Overhead' | PASS | Tile title "LLM Pool Overhead"; subtitle "Per-model spawn overhead · warm target ≤3s · last ~50 calls"; sonnet row "1.3s overhead median · last ~50 calls". `evidence/66-04-tile-green-uat.png`, `66-04-tile-restored-green.png` |
| 2 | Warm steady state shows sonnet overhead ≤3s with GREEN 'OK' badge | PASS | sonnet "OK" badge `rgb(21,128,61)` green / bg `rgb(240,253,244)`; live warm overhead 1–7ms. `evidence/66-04-tile-warm-green.png`, `66-04-tile-restored-green.png` |
| 3 | Pool disabled -> overhead climbs toward ~14s, badge flips red within a poll cycle | **NOT REACHED on this host** | Genuine cold spawn ~650ms single / max ~2545ms under 30-way storm (< 5s red, < 3s amber). Pool-disable path logs NULL overhead (filtered out -> "no recent pool calls", not red). Metric IS attributable warm(~5ms) vs cold(~2.5s). See deferred-items.md. |
| 4 | Token Usage by-model table shows OVERHEAD column (p50_overhead_ms) with envelope; total Median column retained | PASS | "Spawn Overhead" header present alongside "Median Latency"; sonnet 7ms with GREEN badge, haiku "—"; Median Latency 165.1s retained. `evidence/66-04-table-overhead-column.png`, `66-04-table-overhead-uat.png` |
| 5 | Quiet models render as fixed rows; haiku non-graded reference | PASS | opus "no recent pool calls"; haiku "direct path — no pool overhead" / "reference"; haiku table cell "—". `evidence/66-04-tile-restored-green.png`, `66-04-table-overhead-column.png` |

artifacts:
- `llm-latency-tile.tsx` contains `overhead_ms` — confirmed (committed `4ecbb9fcd`).
- `token-usage.tsx` contains `p50_overhead_ms` — confirmed (committed `66a52bd6e`).

## Success Criteria

- **SC-1 (warm -> ≤3s green): PASSED.** Both surfaces grade pool overhead; sonnet warm overhead 1–7ms renders the green "OK" badge (`rgb(21,128,61)`) on the tile and a green 7ms badge on the by-model table, while the table's retained Median Latency column shows the large generation-dominated total (165.1s) as forensic context. This is the ~14s->≤3s speedup the prior total-latency tile could never show.
- **SC-2 (pool-disabled -> red): NOT DEMONSTRATED on this host (partial).** The red threshold is >5000ms overhead (amber >3000ms). Live evidence:
  - single distinct-key cold spawn: overheadMs ~610–716
  - 12 concurrent cold spawns: max overheadMs ~1783 (median ~925)
  - 30 concurrent cold spawns: max overheadMs ~2545 (median ~1331)
  None crossed the 3s amber line, let alone the 5s red line. The plan's primary SC-2 mechanism — `LLM_PROXY_DISABLE_WORKER_POOL=1` — cannot produce red either: per 66-03's locked design the GUARD-01-disabled execFile path logs `overhead_ms = NULL`, which the tile filters out (`Number.isFinite(overhead_ms)`), so a fully pool-disabled state renders "no recent pool calls", not a red badge. The threshold envelope was calibrated against a ~14s cold-boot baseline that does not hold on this fast Apple Silicon host. **What IS proven:** the metric cleanly separates warm reuse (~1–7ms) from cold spawn (~650–2545ms) — pool regression is now attributable, the core PERF-03 gap; and the green/amber/red logic is correctly wired to `overhead_ms`/`p50_overhead_ms` and would flip at the documented boundaries. Deferred to `deferred-items.md` with a recommended follow-up (opt-in `LLM_PROXY_WORKER_SPAWN_DELAY_MS` proxy test seam) rather than faked.
- haiku non-graded reference + quiet "no recent pool calls": confirmed.

## SC-2 Disruptive Test — Execution Log + Pool Restoration

The operator explicitly approved the disruptive SC-2 run. Sequence:
1. Captured warm baseline (overheadMs=5) and confirmed proxy healthy on :12435 serving JSON `/api/complete`.
2. Attempted pool-disable via `launchctl setenv LLM_PROXY_DISABLE_WORKER_POOL 1` + `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`. The bridge continued logging NUMERIC overhead -> the var did NOT propagate (the plist carries an explicit `EnvironmentVariables` dict, so session-env from `setenv` is not inherited). Established that even a propagated disable would log NULL overhead (filtered out), so this path cannot drive red.
3. Drove genuine cold spawns through the live pool via distinct system prompts (distinct worker keys) — single ~650ms; then 12-way and 30-way concurrent storms — max ~2545ms. Never reached red.
4. **RESTORE (mandatory, completed):** `launchctl unsetenv LLM_PROXY_DISABLE_WORKER_POOL` (confirmed cleared — raw getenv returns empty `[]`), kickstarted the proxy, drove warm sonnet calls (overheadMs 1/2/7), confirmed `/health` HTTP 200 and `/api/complete` returns JSON (provider=claude-code), and confirmed the tile badge is GREEN "OK" (`rgb(21,128,61)`). `evidence/66-04-tile-restored-green.png`.

**Final live state: the worker pool is ENABLED and healthy. Proxy on :12435 serves `POST /api/complete` (JSON). Warm sonnet overhead 1–7ms. No disable switch lingering. No services left degraded.**

## Evidence (gsd-browser, per CLAUDE.md mandate)

- `evidence/66-04-tile-warm-green.png` — SC-1 tile warm green (prior executor)
- `evidence/66-04-table-overhead-column.png` — SC-1 by-model table: sonnet 7ms GREEN Spawn Overhead, haiku "—", Median Latency 165.1s retained (prior executor)
- `evidence/66-04-tile-current-state.png` — full dashboard showing the LLM Pool Overhead tile in context
- `evidence/66-04-tile-green-uat.png` — scoped tile: "LLM Pool Overhead", sonnet "OK" green, opus "no recent pool calls", haiku reference
- `evidence/66-04-tile-restored-green.png` — post-restore tile, sonnet GREEN "OK" `rgb(21,128,61)`
- `evidence/66-04-table-overhead-uat.png` — Evolution table headers incl. "Median Latency" + "Spawn Overhead"; muted "—" for no-pool-data process rows

## Deviations from Plan

1. **[Verification method] SC-2 red could not be demonstrated on this host (hardware limitation, not a code defect).** Documented in detail above and in `deferred-items.md`. No source change was made — driving red would require a proxy-side spawn-delay seam (out of scope for this dashboard-only plan).
2. **[Probe input]** The pool-disable injection via `launchctl setenv` did not propagate to the bridge (plist `EnvironmentVariables` dict precedence). Did NOT escalate to a wrapper edit because the disabled path logs NULL overhead anyway (cannot produce red); a wrapper edit would not have changed the outcome and would have been a non-reversible source touch to the proxy.

**Total deviations:** 0 auto-fixed code changes (this run made no source edits — Tasks 1-2 were pre-committed). 1 verification-scope deviation (SC-2 deferred), 1 probe-input note.

## Threat Model Status

- **T-66-04-01 (info disclosure, fetch path):** mitigated — tile/page use same-origin `/api/token-usage/*` (unchanged from 66-02); no hardcoded `localhost:12435` in the dashboard. The `:12435` calls in this SUMMARY's verification were operator-side curl probes, not dashboard code.
- **T-66-04-02 (NULL/absent overhead):** mitigated + LIVE-VERIFIED — `Number.isFinite(overhead_ms)` filter on the tile; muted "—" dash on the table for absent `p50_overhead_ms` (observed live: consolidator-* / observation-writer / haiku rows render "—", no NaN, no crash).
- **T-66-04-03 (DoS, /recent fetch):** accept — `limit` server-clamped to 500 (66-03), unchanged.
- **T-66-04-SC (npm/pip installs):** mitigated — no new package added.

## Self-Check: PASSED (with SC-2 caveat)

- `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx` carries `overhead_ms` — FOUND (commit `4ecbb9fcd`)
- `integrations/system-health-dashboard/src/pages/token-usage.tsx` carries `p50_overhead_ms` — FOUND (commit `66a52bd6e`)
- Commits `4ecbb9fcd`, `66a52bd6e` — FOUND in coding repo log
- Live :3032 tile renders "LLM Pool Overhead" with sonnet GREEN "OK" badge, opus "no recent pool calls", haiku reference — VERIFIED via gsd-browser read-back (rgb) + screenshots
- Live :3032 Token Usage by-model table renders "Spawn Overhead" column (sonnet 7ms green, haiku "—") alongside retained "Median Latency" — VERIFIED
- Worker pool RESTORED + healthy on :12435 after the disruptive run — VERIFIED (overheadMs 1–7, /health 200, /api/complete JSON, disable env cleared)
- **CAVEAT:** SC-2 red badge NOT demonstrated live on this host (overhead < 5s red threshold; pool-disable logs NULL). Deferred to `deferred-items.md`. PERF-03 therefore NOT marked fully Complete.

---
*Phase: 66-dashboard-latency-observability*
*Completed: 2026-06-21*
