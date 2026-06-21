# Phase 66 — Deferred Items (out-of-scope discoveries)

Logged per executor SCOPE BOUNDARY rule. NOT fixed by Plan 66-02 (pre-existing,
unrelated to the median-latency work).

## Pre-existing tsc errors in the dashboard (not introduced by 66-02)

Discovered while running `npx tsc --noEmit` for Task 1 / Task 2 verification.
All confirmed present at the 66-02 baseline (via `git stash` comparison) BEFORE
any 66-02 edit.

1. `src/pages/token-usage.tsx` — two recharts `Formatter<number, NameType>`
   type mismatches (TS2322) on `<Tooltip formatter={...} />` props
   (baseline lines 560 + 646). Pre-existing recharts typing drift; unrelated to
   the Median Latency column.

2. `src/components/system-health-dashboard.tsx` — three `StatusItem[]` TS2322
   errors (baseline lines 543/548/553) where `getDatabaseItems()` /
   `getServiceItems()` / `getProcessItems()` emit a `status` that may be
   `'unknown'`, which is not in the `StatusItem.status` union
   (`'operational' | 'warning' | 'error' | 'offline'`). Pre-existing; the
   `<LlmLatencyTile />` registration added in 66-02 type-checks cleanly and adds
   no new error. Fix would be to widen `StatusItem.status` to include `'unknown'`
   (or narrow the builders) — out of scope for the latency observability plan.

## Plan 66-04 — SC-2 red-badge live demonstration could not be reached on this host

Discovered during the operator-approved Task 3 disruptive run (2026-06-21).
The badge turns RED only when the per-model overhead median exceeds **5000ms**
(amber at >3000ms). On this Apple Silicon host the genuine worker-pool
claude-code cold-spawn overhead is far below that envelope:

- single distinct-key cold spawn: ~610–716ms
- 12-way concurrent cold-spawn storm: max ~1783ms (median ~925ms)
- 30-way concurrent cold-spawn storm: max ~2545ms (median ~1331ms)

The plan's primary SC-2 mechanism (`LLM_PROXY_DISABLE_WORKER_POOL=1`) ALSO
cannot drive red: per 66-03's locked design the GUARD-01-disabled execFile path
logs `overhead_ms = NULL`, which the tile filters out via
`Number.isFinite(overhead_ms)` → the family renders the "no recent pool calls"
placeholder, never a red badge. (Confirmed behaviourally: with the pool disabled
the bridge still logged numeric overhead, i.e. `launchctl setenv` did not
propagate into the launchd job whose plist carries an explicit
`EnvironmentVariables` dict; and even had it propagated, the disabled path emits
NULL, not a high number.)

**What IS proven (partial SC-2):** the metric cleanly separates warm reuse
(~1–7ms) from cold spawn (~650–2545ms) — pool regression is now *attributable*,
the core PERF-03 gap the prior total-latency tile could never surface. The
green/amber/red envelope is correctly wired to `overhead_ms` / `p50_overhead_ms`
(green badge reads `rgb(21,128,61)` and is driven by `latencyStatus`, which flips
at the documented ≤3000/≤5000/>5000 boundaries).

**Why deferred, not auto-fixed:** forcing >5000ms would require either (a) a
source-level artificial spawn-delay seam in `worker-pool.mjs` (a proxy code
change, out of scope for a dashboard-only plan and not present today), or (b) a
genuinely slow/contended host (e.g. corporate VPN + cold CLI boot, where 66-03
observed ~14s). Recommended follow-up: add an opt-in
`LLM_PROXY_WORKER_SPAWN_DELAY_MS` test seam to the proxy (separate plan) so the
red threshold can be exercised deterministically on any host, OR capture the red
badge opportunistically on a slow-boot host during normal operation.
