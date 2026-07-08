---
phase: 84-per-turn-context-revelation
plan: 04
subsystem: proxy-instrumentation
tags: [context-turns, proxy, jsonl, cache-split, wire-discriminator, digest, read-route, wave-1]

# Dependency graph
requires:
  - "84-01 — tests/context-turns/_helpers.mjs harness + anthropic/openai fixtures + skipped stubs"
provides:
  - "proxy-bridge/context-turns.mjs — pure shared line-builder (buildAnthropicLine/buildOpenAILine) + digest helpers + appendContextTurn (no side effects on import)"
  - "logContextTurn(dir,line) + 2 write sites (/v1/messages anthropic, /api/complete openai) appending one context-turns JSONL line per measured request"
  - "contextTurnsDir(taskId) co-located .data/measurements/<sanitized> path helper"
  - "analyze*Request now emit cache_breakpoint_indices (message indices)"
  - "GET /api/context-turns?task_id= read route (gunzip .gz or plaintext, graceful-empty)"
affects: [84-05, 84-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure line-builder extracted to a sibling ESM module so the coding-repo unit tests import it cross-repo WITHOUT booting the proxy HTTP server"
    - "Best-effort never-throw sibling try/catch at both write sites (clone of the logTokenCall wrap)"

key-files:
  created:
    - ../_work/rapid-llm-proxy/proxy-bridge/context-turns.mjs
  modified:
    - ../_work/rapid-llm-proxy/proxy-bridge/server.mjs
    - tests/context-turns/write-line.test.mjs
    - tests/context-turns/cache-split.test.mjs
    - tests/context-turns/openai-wire.test.mjs
    - tests/context-turns/digest.test.mjs

key-decisions:
  - "The line-builder + digest helpers live in a NEW pure sibling module proxy-bridge/context-turns.mjs (no side effects on import). server.mjs boots an HTTP server on import, so the tests could not import it directly — they import the sibling and exercise the REAL production assembly path."
  - "cache_breakpoints on the LINE carries the message INDICES (D-08), computed by the sibling's cacheBreakpointIndices; the analyzers' existing cache_breakpoints COUNT is kept and a parallel cache_breakpoint_indices field was ADDED (not replaced) so per-run-breakdown consumers are unaffected."
  - "OpenAI-wire usage.cache_write is emitted as null (NOT 0) so the UI renders N/A per D-12; the other three split fields stay real numbers, never folded into a total (D-09)."
  - "The /api/complete task_id is now resolved ONCE into a hoisted const and reused by both logTokenCall and the new context-turn write hook — no fresh resolveLiveTaskId() call was introduced (net-zero code call count), preserving the Phase 82-06 ambient-span-leak fix."

patterns-established:
  - "Cross-repo test import: coding-repo tests import ../../../_work/rapid-llm-proxy/proxy-bridge/context-turns.mjs to validate proxy assembly logic without a network boot."

requirements-completed: []

# Metrics
duration: 18min
completed: 2026-07-08
---

# Phase 84 Plan 04: Per-Request Context-Turns Write Hook + Read Route Summary

**The core of the phase: a single best-effort never-throw write hook at the proxy appends one honest context-turns JSONL line per measured request (separate cache split, wire discriminator, D-08 breakpoint indices, taxonomy categories, per-message digest with a ≤120-char preview + tool meta, observation_ref:null), and a same-origin `GET /api/context-turns` route serves the per-turn array with graceful-empty on miss. The pure line-assembly logic was extracted to a sibling module so the unit tests exercise the real production path without booting the proxy.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-07-08
- **Tasks:** 3
- **Files created:** 1 (proxy sibling module); **modified:** 5 (proxy server.mjs + 4 coding tests)

## Accomplishments

- **Task 1** — `contextTurnsDir(taskId)` helper resolving the co-located `<CODING_ROOT>/.data/measurements/<safeSanitizeTaskId>/` dir (returns `''` on empty/traversal id → the write is skipped, never escapes the root). Extended `analyzeAnthropicRequest` to emit `cache_breakpoint_indices` (message indices carrying `cache_control`) alongside the existing count, and `analyzeOpenAIRequest` to return `cache_breakpoint_indices: []`.
- **Task 2** — New pure sibling module `proxy-bridge/context-turns.mjs` (`messageBytes` / `toolMeta` / `shortPreview` / `cacheBreakpointIndices` / `mapMessages` / `buildAnthropicLine` / `buildOpenAILine` / `appendContextTurn`); `logContextTurn(dir,line)` best-effort async append in server.mjs; both write sites wired in their OWN sibling try/catch — `/v1/messages` emits a `wire:'anthropic'` line with the separate cache split, `/api/complete` emits a `wire:'openai'` line with `usage.cache_write:null`. Interactive/neutral rows (empty task_id) are skipped.
- **Task 3** — `GET /api/context-turns?task_id=` route (gunzip `.gz`, or plaintext `.jsonl` while the span is open; ENOENT/partial/traversal → `200 {contextTurns:[]}`, never 500). Un-skipped and filled the four Wave-0 unit stubs against the shared line-builder + recorded fixtures.

## Task Commits

1. **Task 1: contextTurnsDir helper + cache_breakpoint_indices** — `ad6f7f7` (proxy repo, feat)
2. **Task 2: logContextTurn + both write-site call sites** — `0b1b012` (proxy repo, feat)
3. **Task 3a: GET /api/context-turns route** — `f6b462f` (proxy repo, feat)
4. **Task 3b: fill the four unit tests** — `fc2d6dc49` (coding repo, test)

## Files Created/Modified

- `../_work/rapid-llm-proxy/proxy-bridge/context-turns.mjs` (**NEW, proxy repo**) — pure shared line-builder + digest helpers + sync appender; no side effects on import.
- `../_work/rapid-llm-proxy/proxy-bridge/server.mjs` (**MODIFIED, proxy repo**) — `import zlib` + `import {buildAnthropicLine,buildOpenAILine}`; `contextTurnsDir` + `logContextTurn`; `cache_breakpoint_indices` in both analyzers; call-sites A & B; `GET /api/context-turns` route.
- `tests/context-turns/{write-line,cache-split,openai-wire,digest}.test.mjs` (**MODIFIED, coding repo**) — un-skipped and filled.

## Deviations from Plan

None — plan executed as written. The plan's Task-3 fallback ("export the pure line-builder + digest helpers from a small sibling module the route and the write sites both use, so the tests can import them") was the chosen path, because `server.mjs` starts an HTTP server on import and cannot be imported by a unit test.

## Cross-Repo / Runtime Note (IMPORTANT)

- `../_work/rapid-llm-proxy/proxy-bridge/server.mjs` and the new `context-turns.mjs` are the **runtime proxy files** and live in the **separate `_work/rapid-llm-proxy` git repo** (NOT tracked by this coding repo). They are plain runtime JS — **NO `npm run build`**. The proxy edits were committed IN that repo (`ad6f7f7`, `0b1b012`, `f6b462f`); the coding repo's atomic commit (`fc2d6dc49`) covers only the four in-repo test files.
- **NOT redeployed here** by design: live redeploy (`launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` after confirming coordinator :3034 `location=open`) + the golden E2E run are **Plan 84-09's** job.
- **Observation correlation is OUT OF SCOPE** (Pitfall 1): every line carries `observation_ref: null` — correlation is filled at span close in Plan 84-05.

## Threat Surface

- **T-84-04-01 (Tampering, path build)** mitigated: `contextTurnsDir` routes the id through `safeSanitizeTaskId` and returns `''` on empty/traversal → the write is skipped; `logContextTurn` also guards a falsy dir.
- **T-84-04-02 (DoS, malformed body)** mitigated: both write sites sit in their own best-effort try/catch → `logErr`; the pure builders/helpers are individually never-throw (defensive `enc`, guarded scans).
- **T-84-04-03 (Tampering, read-route param)** mitigated: the route resolves `task_id` through `contextTurnsDir` → `safeSanitizeTaskId`; ENOENT / parse error / traversal → graceful-empty `{contextTurns:[]}`, never 500.
- **T-84-04-04 (Info disclosure via preview)** accepted per plan (≤120-char digest; raw bodies gated+redacted in Plan 06; age-swept by Plan 03).
- **T-84-04-SC** N/A: no package installs; runtime JS, no build.

## Verification

- `node --check ../_work/rapid-llm-proxy/proxy-bridge/server.mjs` — clean.
- `node --check ../_work/rapid-llm-proxy/proxy-bridge/context-turns.mjs` — clean.
- `node --test tests/context-turns/write-line.test.mjs tests/context-turns/cache-split.test.mjs tests/context-turns/openai-wire.test.mjs tests/context-turns/digest.test.mjs` → **4 pass / 0 fail / 0 skipped**.
- Full glob `node --test tests/context-turns/*.test.mjs` → 7 tests, **5 pass / 0 fail**, 2 skipped (close-gzip + correlate → 84-05).
- Grep gates: `contextTurnsDir`=1, `cache_breakpoint_indices`=2, `cache_breakpoints`=3, `logContextTurn`=3, `api/context-turns`=1; `resolveLiveTaskId` net-zero new code calls (one hoisted, not added).

## Next Phase Readiness

- 84-05 consumes the plaintext `context-turns.jsonl` written here: gzip at span close, fill `observation_ref` (nearest-by-createdAt within the span window), and un-skip `close-gzip` + `correlate`.
- The `GET /api/context-turns` route (gunzip + graceful-empty) is ready for the vkb-server mirror + dashboard read path (84-07).

---
*Phase: 84-per-turn-context-revelation*
*Completed: 2026-07-08*

## Self-Check: PASSED
- All created/modified files verified present (`context-turns.mjs`, the four tests, this SUMMARY).
- Proxy commits `ad6f7f7`, `0b1b012`, `f6b462f` verified in the `_work/rapid-llm-proxy` repo; coding test commit `fc2d6dc49` verified in the coding repo.
