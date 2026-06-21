---
phase: 66-dashboard-latency-observability
plan: 05
subsystem: rapid-llm-proxy (worker-pool spawn-delay test seam) + live :3032 SC-2 proof
tags: [perf, observability, worker-pool, overhead, test-seam, PERF-03, SC-2]

# Dependency graph
requires:
  - phase: 66-dashboard-latency-observability (Plan 03)
    provides: "overhead window firstOutputAt - dispatchedAt + p50_overhead_ms median this seam inflates"
  - phase: 66-dashboard-latency-observability (Plan 04)
    provides: ":3032 tile + Token Usage by-model 'Spawn Overhead' column graded against overhead_ms with the 3s amber / 5s red envelope; the SC-2 gap this plan closes"
provides:
  - "opt-in LLM_PROXY_WORKER_SPAWN_DELAY_MS test seam in worker-pool.mjs: defers the prompt write by N ms AFTER dispatchedAt so the delay lands in the overhead window (NOT generation); no-op when unset/0; injectable via deps.spawnDelayMs"
  - "PERF-03 SC-2 (regression -> red badge) live-proven on BOTH :3032 surfaces and then restored to green — closes the 66-04 deferral, PERF-03 now Complete"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Host-independent overhead-regression test seam: defer the dispatch write via an unref'd setTimeout(_spawnDelayMs) AFTER stamping dispatchedAt; the per-request timeout is extended by the same delay so a 6000ms inject never trips it; superseded-dispatch guard (exited / generation mismatch) drops a stale late write; _clearSpawnDelayTimer wired into _onExit + dispose"
    - "Deterministic unit test of a real-timer seam without seconds-long sleep: use a tiny real defer (deps.spawnDelayMs=15ms) to PROVE the write is deferred (stdin empty right after dispatch), then drive the OVERHEAD MAGNITUDE with the injectable _now fake clock (advance by N) — overheadMs >= N asserted with no real sleep"
    - "Reversible launchd env injection for a job whose plist carries an explicit EnvironmentVariables dict (launchctl setenv inert): write the var into the gitignored repo .env that bin/start-llm-proxy.sh sources with set -a, then kickstart; restore by reverting .env + kickstart"

key-files:
  created: []
  modified:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs (LLM_PROXY_WORKER_SPAWN_DELAY_MS seam: constructor _spawnDelayMs read+clamp; _dispatch deferred-write gate; timeout extended by delay; _clearSpawnDelayTimer in _onExit + dispose)"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs (4 new node:test cases D/E/F/G — delayed-write overhead inflation, delay=0 unchanged, env fallback, negative/NaN clamp)"

key-decisions:
  - "Seam defers the WRITE, not dispatchedAt — so the injected delay falls in (firstOutputAt - dispatchedAt), exactly the overhead window 66-03 measures, leaving generation time untouched. Byte-for-byte no-op when unset/0 (every prior worker-pool test passes unchanged)."
  - "Per-request timeout armed at (requestTimeoutMs + _spawnDelayMs) so a 6000ms inject never trips the default 120s timeout (defensive even though 6s < 120s — robust for short custom timeouts too)."
  - "Deferred write is an unref'd setTimeout with a superseded-dispatch guard (drop if _exited or generation changed) + _clearSpawnDelayTimer on _onExit/dispose, so a settled/crashed/disposed turn never writes a late prompt into a closing stdin."
  - "Unit determinism: a tiny REAL defer (15ms via deps.spawnDelayMs) proves the deferral; the OVERHEAD VALUE rides on the injectable _now fake clock (advance by N), so overheadMs >= N is asserted with no seconds-long real sleep (honours the PLAN 'no real sleep' rule)."
  - "Live SC-2 injection via the gitignored .env (sourced by start-llm-proxy.sh, set -a), NOT launchctl setenv (66-04 proved inert against the plist EnvironmentVariables dict). Fully reversible — .env reverted byte-identical after the run."

patterns-established:
  - "Pattern: a PERF metric's threshold can be exercised on any host via an opt-in source-level injection that targets the EXACT measured window, defaulting to a true no-op"

requirements-completed: [PERF-03]

# Metrics
duration: ~50 min
completed: 2026-06-21
---

# Phase 66 Plan 05: LLM_PROXY_WORKER_SPAWN_DELAY_MS Overhead Test Seam + Live SC-2 Red Proof Summary

**Added an opt-in `LLM_PROXY_WORKER_SPAWN_DELAY_MS` test seam to the rapid-llm-proxy worker pool that defers the prompt write by the configured ms AFTER `dispatchedAt` is stamped — so the injected delay lands squarely in the spawn/queue overhead window (`firstOutputAt − dispatchedAt`) and NOT in model generation — making the dashboard's ≤3s green / 3s amber / >5s red overhead envelope exercisable on any host; with it set to 6000ms BOTH `:3032` surfaces (the "LLM Pool Overhead" tile and the Token Usage by-model "Spawn Overhead" column) flipped RED, and clearing it returned both to GREEN and the pool to healthy — closing the SC-2 gap 66-04 deferred and marking PERF-03 Complete. The seam is a byte-for-byte no-op when unset/0.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-06-21T18:50:00Z
- **Tasks:** 3 (RED, GREEN, blocking live human-verify — operator pre-approved)
- **Files modified:** 2 (worker-pool.mjs + worker-pool.test.mjs); no dist delta (worker-pool.mjs is a runtime `.mjs`, not tsc-compiled)

## Task Commits

All code commits in the `rapid-llm-proxy` repo (`/Users/Q284340/Agentic/_work/rapid-llm-proxy`, branch `main`):

| Task | Name | Repo | Commit | Subject |
| ---- | ---- | ---- | ------ | ------- |
| 1 (RED) | Failing spawn-delay seam assertions | rapid-llm-proxy | `aa474a3` | `test(66-05): add failing spawn-delay seam assertions (PERF-03 SC-2)` |
| 2 (GREEN) | Implement LLM_PROXY_WORKER_SPAWN_DELAY_MS seam | rapid-llm-proxy | `a4ce41d` | `feat(66-05): LLM_PROXY_WORKER_SPAWN_DELAY_MS overhead test seam (PERF-03 SC-2)` |
| 3 | Live SC-2 red proof + restore + finalization | coding | (this SUMMARY's metadata commit) | `docs(66-05): SUMMARY + STATE + ROADMAP + PERF-03 complete (SC-2 closed)` |

No separate `build(66-05)` commit: `npm run build` ran clean (exit 0) but produced no `dist/` delta because the only source touched is `proxy-bridge/worker-pool.mjs`, a runtime ESM module not compiled by tsc (unlike 66-03 which edited `src/token-usage.ts`).

## must_haves Verification

| # | Truth | Result | Evidence |
|---|-------|--------|----------|
| 1 | Opt-in env (parsed int, default 0) injects a delay that lands INSIDE the overhead window, NOT generation | PASS | `_dispatch` defers `_writeGuarded` by `_spawnDelayMs` AFTER `dispatchedAt` is stamped; Test D asserts `overheadMs >= N` AND `< N + generation` (delay in overhead, not generation). Live: overheadMs 6005–6023 with the 6000ms inject. |
| 2 | Delay unset/0 → byte-for-byte identical dispatch path; every existing test passes unchanged | PASS | `else { this._writeGuarded(payload) }` (synchronous, as before). Test E asserts delay=0 keeps the write synchronous + overhead unchanged (5ms). Full suite 65/65 pass (61 prior unchanged + 4 new). |
| 3 | Delay=N → warm completion reports overheadMs >= N within clock tolerance, deterministic on any host | PASS | Test D `overheadMs >= 6000`; Test F (env) `overheadMs >= 5500`. Live on `:12435`: 5 sonnet calls all reported overheadMs 6005–6023ms. |
| 4 | Injectable for unit testing via deps/_now seam — no real wall-clock sleep | PASS | `deps.spawnDelayMs` seam + `now: () => clock.now` fake clock; overhead magnitude driven by advancing `clock.now`, real defer only 15ms. Suite runs in <1s. |
| 5 | SC-2 live-proven: env above 5000ms flips BOTH the tile AND the by-model column RED within a poll cycle; clearing returns both to GREEN | PASS | See "SC-2 Live Result" below — tile "Regressed" bg `rgb(239,68,68)` + table "6.0s" badge `rgb(185,28,28)`/bg `rgb(254,242,242)`; restored to tile "OK" `rgb(21,128,61)` + table 1.1s green. |

**artifacts (contains-grep):**
- `proxy-bridge/worker-pool.mjs` contains `LLM_PROXY_WORKER_SPAWN_DELAY_MS` — confirmed (1) and `_spawnDelayMs` (7).
- `tests/unit/worker-pool.test.mjs` contains `spawnDelay` — confirmed.

**key_links:**
- `_dispatch` dispatchedAt stamp → `_writeGuarded` prompt write, via deferring by `_spawnDelayMs` — implemented (deferred-write gate).
- `LLM_PROXY_WORKER_SPAWN_DELAY_MS` env → red-threshold badge via inflated `overhead_ms` → `p50_overhead_ms` median crosses red → `latencyStatus=error` — live-proven on both surfaces.

## Success Criteria

- **SC-2 (worker-pool overhead regression now demonstrably detectable on any host — red badge reachable via the deterministic seam): PASSED.** The 66-04 deferral is closed. With the seam at 6000ms the per-model overhead median crossed the 5000ms red threshold and both graded surfaces rendered the red "Regressed"/destructive badge; clearing the seam reverted both to green. The red badge is now reachable on any host (no slow VPN cold-boot required).

## SC-2 Live Result (gsd-browser computed-rgb read-back, not eyeballed)

**Injection (reversible):** appended `LLM_PROXY_WORKER_SPAWN_DELAY_MS=6000` to the gitignored `/Users/Q284340/Agentic/_work/rapid-llm-proxy/.env` (sourced by `bin/start-llm-proxy.sh` with `set -a`), backed up first; `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`. (`launchctl setenv` was NOT used — 66-04 proved it inert against the plist's explicit `EnvironmentVariables` dict.) Confirmed `/health` 200 and `/api/complete` serving JSON.

**Live overhead with the seam (POST :12435/api/complete, model=sonnet):** 5 calls → overheadMs 6023 / 6009 / 6011 / 6005 / 6006; provider=claude-code (pool path). The 6000ms inject landed in the overhead window; latencyMs (overhead + generation) rose correspondingly (~7.2–8.9s).

**Surface medians driven over the threshold** (the tile rides the trailing-50 `/recent` window; the by-model table rides `summary.by_model[].p50_overhead_ms`, a non-null-overhead median over the selected hours window — WR-02 design): drove ~170 sequential delayed sonnet calls so the delayed rows dominated both windows. Trailing-50 sonnet overhead median → 6009ms; 1h `p50_overhead_ms` → 6006ms.

| Surface | Before (warm, green) | After 6000ms inject (RED) | Computed badge rgb (RED) |
|---------|----------------------|---------------------------|--------------------------|
| `:3032` "LLM Pool Overhead" tile (sonnet row) | "6ms overhead median" · "OK" green | "6.0s overhead median" · **"Regressed"** | text `rgb(255,255,255)` on bg **`rgb(239,68,68)`** (red-500) |
| Token Usage → Evolution → By Model → "Spawn Overhead" (sonnet) | warm green badge | **"6.0s"** red badge | text **`rgb(185,28,28)`** on bg **`rgb(254,242,242)`**, border `rgb(254,202,202)` |

**Restore (MANDATORY, completed):** reverted `.env` byte-identical to the backup (0 spawn-delay entries; `diff` IDENTICAL); kickstarted the job; drove warm sonnet calls — overheadMs back to 9–14ms (no 6000ms), provider=claude-code. Flushed the medians green by driving warm pool calls until warm non-null-overhead rows outnumbered the delayed ones.

| Surface | After restore (GREEN) | Computed badge rgb (GREEN) |
|---------|------------------------|----------------------------|
| `:3032` tile (sonnet) | "6ms overhead median" · "OK" | text `rgb(21,128,61)` on bg `rgb(240,253,244)` |
| Token Usage by-model "Spawn Overhead" (sonnet) | "1.1s" green | text `rgb(21,128,61)` on bg `rgb(240,253,244)`, border `rgb(187,247,208)` |

**Final live state:** worker pool ENABLED and healthy. `/health` HTTP 200; `/api/complete` serves JSON (provider=claude-code); warm sonnet overhead 9–14ms; `.env` clean (no spawn-delay); 1h `p50_overhead_ms`=1212ms green, 24h=1057ms green. No services left degraded, no env lingering.

## Evidence (gsd-browser, per CLAUDE.md mandate)

- `evidence/66-05-tile-cold-red.png` — tile sonnet "6.0s overhead median" + red "Regressed" badge
- `evidence/66-05-table-overhead-red.png` — Token Usage by-model "Spawn Overhead" sonnet "6.0s" red badge
- `evidence/66-05-tile-restored-green.png` — tile sonnet back to "6ms" + green "OK"
- `evidence/66-05-table-restored-green.png` — by-model "Spawn Overhead" sonnet "1.1s" green badge

## Deviations from Plan

1. **[Verification mechanics — surface median windows] Driving more delayed calls than the plan's "4-5 sonnet calls".** The plan suggested 4-5 calls would suffice. In practice both graded surfaces use a *median over a window* (the tile: trailing-50 `/recent`; the by-model table: `p50_overhead_ms` over the non-null-overhead rows in the selected hours window — the WR-02 design from 66-03), so 5 delayed calls left the medians diluted by historical warm rows. Drove ~170 sequential delayed calls (sequential to keep them on the warm-reuse pool path; parallel bursts would overflow to the execFile path that logs NULL overhead) so the delayed rows became the window majority and the medians crossed 5000ms. No code change — purely how many probes were needed to move the median. The seam itself behaved exactly as designed (each call reported ~6000ms overhead).
2. **[Verification mechanics — table tab/group-by] The by-model "Spawn Overhead" column lives under Token Usage → Evolution tab → "By Model" group-by, not the default Overview/By-Process view.** The Evolution table is process-keyed by default and the `p50_overhead_ms` join only lights up when grouped by model (rows become model names matching `by_model`). Switched the group-by to "By Model" (matching 66-04's evidence) to read the sonnet badge. No code involved.
3. **[Tooling] gsd-browser daemon needed a restart mid-run** ("send failed because receiver is gone"); a stale CDP session — `pkill` + `daemon start` recovered it, then navigation/eval/screenshot worked normally. No impact on results.

**Total deviations:** 0 auto-fixed code changes (the seam was implemented exactly as planned). 3 verification-mechanics notes. **Impact:** none on the deliverable — SC-2 red was proven on both surfaces and fully restored.

## Threat Model Status

- **T-66-05-01 (seam left active / pool degraded):** mitigated + VERIFIED — restoration is mandatory and completed; `.env` reverted byte-identical, pool healthy, warm overhead 9–14ms, no lingering env. The seam defaults to a true no-op (clamp neg/NaN→0), so an accidental empty/garbage env value cannot degrade the pool.
- **T-66-05-02 (deferred write into a dead/superseded turn):** mitigated — superseded-dispatch guard (`_exited` / generation mismatch) drops a stale late write; `_clearSpawnDelayTimer` wired into `_onExit` + `dispose`; the deferred timer is `unref()`'d so it never pins the event loop.
- **T-66-05-03 (delay trips the per-request timeout):** mitigated — the timeout is armed at `requestTimeoutMs + _spawnDelayMs` so a 6000ms inject never expires the request before the write happens (live calls completed cleanly).
- **T-66-05-SC (npm/pip/cargo installs):** mitigated — NO new package added (Node builtins only; reused the existing `deps`/`_now` seam). Slopcheck N/A.

## Self-Check: PASSED

- `proxy-bridge/worker-pool.mjs` carries `LLM_PROXY_WORKER_SPAWN_DELAY_MS` — FOUND (1) and `_spawnDelayMs` — FOUND (7)
- `tests/unit/worker-pool.test.mjs` carries `spawnDelay` — FOUND
- Commits `aa474a3` (test) + `a4ce41d` (feat) — FOUND in rapid-llm-proxy repo log
- `node --test tests/unit/worker-pool.test.mjs` — 65/65 pass, 0 fail (4 new D/E/F/G + 61 prior unchanged)
- `npm run check` (tsc --noEmit) — clean (exit 0); `npm run build` — clean (exit 0, no dist delta)
- Live `:3032` tile + by-model "Spawn Overhead" both flipped RED with the seam (computed rgb `rgb(239,68,68)` / `rgb(185,28,28)`) and both restored to GREEN (`rgb(21,128,61)`) — VERIFIED via gsd-browser
- Worker pool RESTORED + healthy on `:12435` (overhead 9–14ms, /health 200, /api/complete JSON, `.env` clean) — VERIFIED
- Evidence PNGs present on disk — FOUND (4 files)

## TDD Gate Compliance

- **Task 1/2:** RED `aa474a3` (`test(66-05)`) → GREEN `a4ce41d` (`feat(66-05)`). RED proven (Tests D/F failed for the right reason — write synchronous today); GREEN turned them green with all prior cases unchanged. REFACTOR — none needed.

## Next Phase Readiness

- PERF-03 fully closed (SC-1 green + SC-2 red both live-proven). Phase 66 (4 plans + this gap-closure) complete. No blockers.

---
*Phase: 66-dashboard-latency-observability*
*Completed: 2026-06-21*
