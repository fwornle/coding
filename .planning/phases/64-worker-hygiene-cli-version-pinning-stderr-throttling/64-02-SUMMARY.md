---
phase: 64-worker-hygiene-cli-version-pinning-stderr-throttling
plan: 02
subsystem: rapid-llm-proxy worker pool
tags: [GUARD-03, WR-02, worker-pool, stderr-throttle, recycle-ceiling, cache-inclusive-tokens]
requires:
  - "Phase 62 ClaudeWorker deps seam (spawn/claudeCli/buildEnv) + toCompletion cache-inclusive sum"
  - "Phase 63 WorkerPool _reapStale + _disposeAndDrop + needsRecycle/isStale recycle path"
  - "Phase 64 Plan 01 (GUARD-02): pool opts.log/opts.logErr wiring + readVersion threading in _spawnWorker"
provides:
  - "ClaudeWorker drain-and-throttle stderr handler (_onStderr): every chunk drained, <=200-char sample logged <=1/min/worker via injected logErr + injectable clock"
  - "ClaudeWorker deps.log/deps.logErr/deps.now seams (no-op / Date.now defaults); pool forwards its loggers in _spawnWorker"
  - "inputTokensFromEvent(ev): the ONE cache-inclusive input-token summation shared by toCompletion AND the recycle-ceiling bookkeeping (_lastInputTokens)"
affects:
  - "rapid-llm-proxy persistent-worker stderr visibility (warnings now surface, throttled) and context-leak recycle threshold (now measures true cache-inclusive context)"
tech-stack:
  added: []
  patterns: ["injectable deps with no-op/default-impl (logger + clock seam mirrors spawn/readVersion)", "per-worker last-logged-timestamp throttle gate", "single shared summation helper to keep ceiling + reported tokens in lockstep"]
key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/helpers/mock-claude-stdio.mjs
decisions:
  - "Throttle window is a bare named constant STDERR_THROTTLE_MS = 60_000 (D-07 env knob optional, not added). Sample cap STDERR_SAMPLE_MAX_CHARS = 200 (mirrors server.mjs:1143)."
  - "Logger seam: deps.log/deps.logErr on ClaudeWorker (logErr falls back to log, then no-op). Throttled sample emitted via _logErr ONLY — no console.log, no raw stderr write (no-console-log / GUARD-03 constraint)."
  - "Clock seam: deps.now (default Date.now), reused only by the stderr throttle gate so the unit suite advances time deterministically."
  - "_stderrLastLoggedAt initialized to null (not 0): null = never-logged so the FIRST chunk always logs even when the injected clock reads 0 — a 0-init would mis-throttle the first chunk at clock=0 (caught by the truncation test)."
  - "WR-02/D-08: extracted inputTokensFromEvent(ev) as the SINGLE summation used by both toCompletion and _lastInputTokens, so the recycle ceiling and the reported token contract can never diverge. Raw usage.input_tokens fallback only when modelUsage is absent."
metrics:
  duration: "~1 commit, single wave"
  tasks_completed: 4
  files_modified: 3
  tests: "58 unit tests, 0 fail (was 53 after Wave 1; +5 new GUARD-03/WR-02 cases)"
  completed: 2026-06-21
---

# Phase 64 Plan 02: GUARD-03 stderr Drain+Throttle + WR-02 Cache-Inclusive Recycle Ceiling Summary

Replace the silent worker-stderr discard with a per-worker drain-and-throttle handler (every chunk drained so the pipe never blocks the subprocess; a trimmed <=200-char sample logged via an injected logger at most once per minute per worker), and fold in WR-02 (D-08) so the context-leak recycle ceiling measures the cache-inclusive `modelUsage` sum instead of raw `input_tokens` — proven by unit tests with a fake clock + injected logger and a summed-token payload that crosses the ceiling while raw input alone would not.

## What Was Built

**Task 1 — Drain-and-throttle stderr with per-worker gate + deps logger.**
- Replaced `this._proc.stderr.on('data', () => {})` (the silent discard) with `this._proc.stderr.on('data', (chunk) => this._onStderr(chunk))`.
- `_onStderr(chunk)`: ALWAYS consumes the chunk (drain is unconditional, independent of the throttle gate — Pitfall 3, the subprocess never blocks on a full stderr buffer). Then, when the per-worker window has elapsed, logs `worker-pool: stderr pid=<pid>: <sample>` via the injected `_logErr`, where `sample = String(chunk).trim().slice(0, 200)` (mirrors server.mjs:1143). Empty/whitespace-only chunks are drained but never logged (and never consume the throttle budget).
- Added `deps.log`/`deps.logErr` seams to the `ClaudeWorker` constructor (no-op default; `logErr` falls back to `log` then no-op), and a `deps.now` clock seam (default `Date.now`) used only by the throttle gate.
- Throttle window is a bare named constant `STDERR_THROTTLE_MS = 60_000`; sample cap `STDERR_SAMPLE_MAX_CHARS = 200`. No env knob added (D-07 Claude's-Discretion).
- `_stderrLastLoggedAt` initialized to `null` (never-logged ⇒ first chunk always logs, even at clock 0); gate is `lastLoggedAt !== null && now - lastLoggedAt < window ⇒ suppress`.
- The pool threads its `log`/`logErr` into the real worker in `_spawnWorker` (alongside the GUARD-02 `readVersion`), so the throttled sample reaches the proxy logs.

**Task 2 — WR-02 fold-in: recycle ceiling uses the cache-inclusive token sum.**
- Extracted `inputTokensFromEvent(ev)` — the single `input + cacheReadInputTokens + cacheCreationInputTokens` summation (first `modelUsage` entry), with a `usage.input_tokens || 0` fallback when `modelUsage` is absent. This is the same sum server.mjs:1166 treats as authoritative.
- `toCompletion` now calls `inputTokensFromEvent(ev)` for its input token count (output-token derivation unchanged), so there is ONE summation.
- At the result boundary, `this._lastInputTokens = ev.usage?.input_tokens || 0` became `this._lastInputTokens = inputTokensFromEvent(ev)`. `_evaluateRecycle()` (`_lastInputTokens >= _maxInputTokens`) is unchanged — it now trips on the true cache-inclusive context.

**Task 3 — Tests + mock stdio stderr.**
- `makeMockWorkerStdio` gained a `stderr` PassThrough and an `emitStderr(text)` helper; the returned spawn-shape now includes `stderr` so the worker's handler binds.
- GUARD-03 throttle tests (fake clock + capturing logErr): first chunk logs one line; second chunk within the window is suppressed; after advancing the clock past 60s the next chunk logs again; a 5000-char blob is trimmed + sliced to exactly 200 chars; a no-logger worker drains every chunk without throwing.
- WR-02 tests: a payload with raw `input_tokens=100` + `cacheRead=5000` (summed 5100) against `maxInputTokens=1000` flips `needsRecycle`/`isStale` true (raw 100 alone would not); a hand-built `modelUsage`-absent result with `input_tokens=100` under the 1000 ceiling does NOT trip (fallback path).

**Task 4 — Commit to the rapid-llm-proxy repo (local-only).**
- Committed the three files to the standalone `rapid-llm-proxy` git repo. NOT pushed (Phase-62/63 cross-repo convention). No coding-repo files in the commit.

## Key Decisions

- **Throttle constant (D-07):** `STDERR_THROTTLE_MS = 60_000`, bare named constant; per-worker gate so one noisy worker can't mute another's first warning. No env knob (optional, not free enough to justify).
- **Logger seam (D-06):** `deps.log`/`deps.logErr` mirror the pool's `opts.log`/`opts.logErr` no-op defaults; throttled sample emitted via `_logErr` ONLY (constraint-compliant — no `console.log`, no raw `process.stderr.write`).
- **Clock seam (D-05):** `deps.now` (default `Date.now`) makes the throttle deterministically testable.
- **`_stderrLastLoggedAt = null` not `0`:** distinguishes "never logged" from "logged at clock 0" so the first chunk always surfaces (the truncation test, which starts the fake clock at 0, caught the 0-init mis-throttle — see Deviations).
- **Single summation (D-08):** `inputTokensFromEvent` is shared by `toCompletion` and the recycle bookkeeping, guaranteeing the reported tokens and the recycle ceiling never diverge.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] First-chunk throttle mis-fire at clock 0**
- **Found during:** Task 3 (truncation test, which constructs the worker with an injected `now: 0`).
- **Issue:** The throttle gate was initially `now - this._stderrLastLoggedAt < STDERR_THROTTLE_MS` with `_stderrLastLoggedAt = 0`. At clock 0 the first chunk evaluates `0 - 0 = 0 < 60_000` and is suppressed — the first warning would be silently dropped whenever the worker's clock started at 0 (and, more subtly, any real worker whose very first stderr arrives within 60s of an epoch-0-relative baseline). The plan's behavior requires the FIRST chunk after construction to always log.
- **Fix:** Initialized `_stderrLastLoggedAt = null` and gated on `lastLoggedAt !== null && ...` so a never-logged worker always logs its first sample; the timestamp is only set once a real sample is emitted.
- **Files modified:** proxy-bridge/worker-pool.mjs
- **Commit:** 8fbc8d2 (folded into the single Plan-02 code commit)

All other work executed exactly as written. Field/seam names (`_onStderr`, `STDERR_THROTTLE_MS`, `inputTokensFromEvent`, `deps.now`) were planner/executor discretion per the Phase-62/63 house style.

## Verification

- `node --test tests/unit/worker-pool.test.mjs` in `/Users/Q284340/Agentic/_work/rapid-llm-proxy` → **58 tests, 0 fail** (was 53 after Wave 1; +5 new GUARD-03/WR-02 cases).
- Silent discard removed: `grep -E "stderr\.on\('data', \(\) => \{\}\)"` → not found (SILENT_DISCARD_REMOVED); a `stderr.on('data', ...)` listener that drains every chunk is still registered.
- `_lastInputTokens` at the result boundary uses `inputTokensFromEvent(ev)` (cache-inclusive sum with raw-input fallback); `cacheReadInputTokens` present at the recycle-bookkeeping site via the shared helper.
- ClaudeWorker constructor destructures `log`/`logErr`/`now` deps with no-op/`Date.now` defaults; throttle clock is injectable.
- GUARD-03 + WR-02 committed to the rapid-llm-proxy repo only (`8fbc8d2`), local-only, no coding-repo files.

## SC / Success-Criteria Mapping

- **ROADMAP SC-2 (GUARD-03):** worker stderr is drained continuously (pipe never blocks) AND throttled to <=1 log line/min/worker — proven by the fake-clock throttle test (first logs, within-window suppressed, post-window logs again) + the unconditional-drain handler. MET.
- **WR-02 fold-in (D-08 / 62-REVIEW):** the context-leak recycle ceiling measures the cache-inclusive token sum — proven by the summed-token-crosses-ceiling test (recycle trips on input+cacheRead while raw input alone stays under) + the modelUsage-absent control. MET.

## Commit

- `8fbc8d2` (rapid-llm-proxy repo, local-only): `feat(worker-pool): GUARD-03 stderr drain+throttle and WR-02 cache-inclusive recycle ceiling`

## Self-Check: PASSED

- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs (contains `_onStderr`, `STDERR_THROTTLE_MS`, `inputTokensFromEvent`, `deps.now`/`logErr` seams)
- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs (GUARD-03 throttle + WR-02 ceiling describe blocks)
- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/helpers/mock-claude-stdio.mjs (stderr PassThrough + emitStderr)
- FOUND: proxy-repo commit 8fbc8d2 referencing GUARD-03
- Unit suite: 58 pass / 0 fail
