---
phase: 64-worker-hygiene-cli-version-pinning-stderr-throttling
verified: 2026-06-21T00:00:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
---

# Phase 64: Worker Hygiene — CLI Version Pinning & stderr Throttling Verification Report

**Phase Goal:** Long-lived workers stay correct and quiet across CLI upgrades and noisy CLI warnings — prompt-cache assumptions don't silently rot when the `claude` binary changes under a running worker, and persistent-worker stderr doesn't flood the logs.
**Verified:** 2026-06-21
**Status:** passed
**Re-verification:** No — initial verification

All verification is against the SHIPPED code at
`/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` (1356 lines) and
`/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs` (1574 lines), NOT SUMMARY claims.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Each worker records the `claude` CLI version at boot; on `--version` drift the worker is recycled (drain + respawn) before serving the next request | ✓ VERIFIED | `_bootVersion` captured synchronously at worker-pool.mjs:340-347 (before spawn at :351, no `await`); pool `_currentVersion` snapshot at :910; drift detected at REUSE in `complete()` — `_flagDriftedWorkers` (:1230) sets `needsRecycle`/`isStale` BEFORE `_reapStale` (:1232) drains+respawns. Version reader deps-injectable (worker `deps.readVersion` :275; pool `opts.readVersion` :908). Degrade-open: falsy boot OR falsy snapshot ⇒ never recycle (`_isVersionDrifted` :1088-1093). No per-request exec — only lazy `_maybeRefreshVersionSnapshot` (:1186). Test `SC-1 drift recycle` (test:1328) proves dispose+respawn on simulated 1.0.0→2.0.0; `no per-request exec` (test:1406) proves reader not re-invoked. |
| SC-2 | Worker stderr drained continuously (pipe never blocks) and throttled to ≤1 log line/min/worker via injected logger | ✓ VERIFIED | Silent `() => {}` discard removed; handler `_onStderr` bound at :375. `_onStderr` (:564-578): `String(chunk)` consumes EVERY chunk unconditionally (drain independent of throttle, :567); throttle gate `_stderrLastLoggedAt !== null && now - last < STDERR_THROTTLE_MS` (:571, 60_000ms const :124); sample `.trim().slice(0, 200)` (:574, const :125); emitted via injected `_logErr` ONLY (:577) — no console.log, no raw write. Per-worker timestamp (`_stderrLastLoggedAt` :331). Clock injectable (`deps.now` :287). Test `throttle` (test:1458): first logs, within-window suppressed, post-window logs again. Test `truncation` (test:1486): 5000-char blob → exactly 200. Test `drain-without-logger` (test:1503): no-op logger drains every chunk without throwing. |
| WR-02 | Recycle ceiling measures cache-inclusive `modelUsage` sum (input + cacheRead + cacheCreation), not raw `usage.input_tokens` | ✓ VERIFIED | `inputTokensFromEvent(ev)` (:191-203) sums `inputTokens + cacheReadInputTokens + cacheCreationInputTokens` of first modelUsage entry, falls back to `usage.input_tokens || 0` when modelUsage absent. SHARED by `toCompletion` (:212) AND `_lastInputTokens` at the result boundary (:613). `_evaluateRecycle` trips on `_lastInputTokens >= _maxInputTokens` (:647). Test `summed-token ceiling` (test:1521): input=100 + cacheRead=5000 = 5100 > 1000 ceiling → `needsRecycle=true` (raw 100 alone would not); `control` (test:1546): modelUsage-absent raw 100 < 1000 → no recycle. |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `proxy-bridge/worker-pool.mjs` | `_bootVersion`, `_currentVersion`, drift-at-reuse, `_onStderr`, throttle, `inputTokensFromEvent` shared by `_lastInputTokens` | ✓ VERIFIED | All present and wired; 1356 lines, substantive. |
| `tests/unit/worker-pool.test.mjs` | GUARD-02 / GUARD-03 / WR-02 cases with the exact required mechanics | ✓ VERIFIED | GUARD-02 drift (test:1324), GUARD-03 throttle (test:1457), WR-02 ceiling (test:1520) describe blocks present and passing. |
| `tests/helpers/mock-claude-stdio.mjs` | stderr PassThrough + `emitStderr` | ✓ VERIFIED | Consumed by `workerWithStderr` (test:1441) using `mock.stderr` / `mock.emitStderr`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| pool `_spawnWorker` | `ClaudeWorker` | `readVersion`, `log`, `logErr` threaded | ✓ WIRED | worker-pool.mjs:947,951-952 — worker stamps `_bootVersion` from same reader; loggers reach throttled stderr sample. |
| `complete()` | `_reapStale` drain+respawn | `_flagDriftedWorkers` sets `needsRecycle`/`isStale` BEFORE reap | ✓ WIRED | :1230 → :1232 ordering confirmed; reuses existing recycle path (D-02), no parallel mechanism. |
| `_onStderr` | proxy logs | injected `_logErr` | ✓ WIRED | :577 emits via `_logErr` only. |
| result boundary | recycle ceiling | `inputTokensFromEvent` → `_lastInputTokens` → `_evaluateRecycle` | ✓ WIRED | :613 → :647. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit suite (GUARD-02/03 + WR-02) | `node --test tests/unit/worker-pool.test.mjs` | tests 58 / pass 58 / fail 0, EXIT=0 | ✓ PASS |
| No console.log / raw stderr-write dodge | `grep console.log / process.stderr.write` in worker-pool.mjs | NONE | ✓ PASS |
| Silent discard removed | `grep "stderr.on('data', () =>"` | NONE | ✓ PASS |
| Boot stays synchronous | `grep await` near spawn/version | NONE (capture at :342 is sync, no await before spawn :351) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GUARD-02 | 64-01 | Record CLI version at boot, recycle on drift | ✓ SATISFIED | SC-1 above; commit cc4a0b6 |
| GUARD-03 | 64-02 | Drain + throttle stderr ≤1/min/worker | ✓ SATISFIED | SC-2 above; commit 8fbc8d2 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None | — | No debt markers, no console.log, no raw write, no silent discard, boot synchronous |

### Human Verification Required

None. All three success criteria are unit-provable via injected reader (drift), fake clock (throttle), and summed-token payload (WR-02), and were verified by running the suite to exit 0.

### Gaps Summary

No gaps. The shipped `worker-pool.mjs` makes both ROADMAP success criteria and the WR-02 folded refinement TRUE:
- SC-1: boot-version capture is synchronous + degrade-open; drift is detected at reuse against an O(1) cached snapshot (no per-request exec) and funnels through the existing `_reapStale` drain+respawn; the reader is deps-injectable.
- SC-2: every stderr chunk is drained unconditionally; a ≤200-char sample is logged at most once per 60s per worker through an injected logger — no console.log or raw-write dodge.
- WR-02: `_lastInputTokens` derives from the single cache-inclusive `inputTokensFromEvent` summation (raw-input fallback), so the recycle ceiling trips at the true context size.

Tests (58/58, exit 0) include the GUARD-02 simulated drift, GUARD-03 fake-clock within-window suppression, and the WR-02 ceiling-trips-on-summed-but-not-raw cases. Commits `cc4a0b6` (GUARD-02) and `8fbc8d2` (GUARD-03 + WR-02) present in the rapid-llm-proxy repo.

---

_Verified: 2026-06-21_
_Verifier: Claude (gsd-verifier)_
