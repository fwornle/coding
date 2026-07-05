---
phase: 82-wire-measurement-foundation
plan: 02
subsystem: llm-proxy-messages-tap
tags: [cache-tokens, sse-parse, wire-measurement, task-binding, agent-attribution]
requires:
  - token_usage.cache_read_tokens / cache_write_tokens columns (Plan 82-01)
  - logTokenCall cache-token bind (Plan 82-01)
provides:
  - src/usage-cache.ts parseUsageCache(usage) pure helper (flat + cache_creation-object forms)
  - /v1/messages tap writes cache_read_tokens/cache_write_tokens (both SSE + non-streaming paths)
  - /v1/messages tap x-task-id/x-agent per-request binding (header wins over ambient span)
  - non-cladpt user_hash stamping for non-claude agents (copadt/opcadt/mstadt)
affects:
  - Plan 82-04 (coding-side dedup-merge enriches cache-less rows — now the tap emits cache directly)
  - Plan 82-06 (2-cell concurrent live gate proves per-task binding kills the singleton leak)
tech-stack:
  added: []
  patterns:
    - pure never-throw usage extractor (numeric coalesce) compiled to dist/
    - X-Task-Id/X-Agent header precedence over ambient resolveLiveTaskId() (mirrors OpenAI-shim block)
    - agent-derived 6-char user_hash matching /^[a-z][a-z0-9]{5}$/
key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/messages-tap-cache-parse.test.mjs
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
decisions:
  - "Cache captured off message_start.usage only (message_delta carries no cache fields) + the non-streaming j.usage path"
  - "total_tokens stays uIn+uOut — cache surfaced separately, never folded in (preserves Plan-01 contract)"
  - "Header binding (x-task-id/x-agent) wins over ambient span; empty header falls back to resolveLiveTaskId()/'claude'"
  - "sanitizeTaskId applied to the untrusted header task id before it reaches DB/filenames (T-82-02-02 mitigation)"
  - "adapterUserHash maps agent->6-char code: claude->cladpt, copilot->copadt, opencode->opcadt, mastra->mstadt; any other agent derives a valid /^[a-z][a-z0-9]{5}$/ code"
  - "captureBelongsToRun secondary guard left intact — header-bound task_ids bypass the ambient file"
requirements: [WIRE-02, WIRE-03]
metrics:
  duration_minutes: 12
  completed: 2026-07-05
  tasks: 3
  files_changed: 3
---

# Phase 82 Plan 02: /v1/messages Cache Tap + Per-Request Task Binding Summary

Upgraded the proxy `/v1/messages` transparent-passthrough tap to (a) parse Anthropic prompt-cache accounting off the wire (both SSE `message_start.usage` and the non-streaming JSON `usage`, in both the flat and `cache_creation`-object shapes) and write it through the Plan-01 `cache_read_tokens`/`cache_write_tokens` columns, and (b) bind each captured row to the correct task+agent via `x-task-id`/`x-agent` request headers — killing the ambient-span singleton that leaked concurrent traffic across spans.

## What Was Built

**`src/usage-cache.ts` (new, compiles to `dist/` via `npm run build`)** — a pure `parseUsageCache(usage)` returning `{cacheRead, cacheWrite}`:
- `cacheRead` = numeric `usage.cache_read_input_tokens ?? 0`.
- `cacheWrite` = numeric `usage.cache_creation_input_tokens`, else the sum of the numeric sub-fields of the `usage.cache_creation` object (newer breakpoint-typed wire), else 0.
- Never throws, no I/O; every field coalesced to 0 (STRIDE T-82-02-04 mitigation).

**`proxy-bridge/server.mjs` (runtime, no build)** — three seams extended inside the `/v1/messages` tap (`:1914-2110`):
- **Cache capture** — `let cacheRead = 0; let cacheWrite = 0;` accumulator; `parseUsageCache` called off `message_start.message.usage` in the SSE loop and off `j.usage` in the non-streaming path. `message_delta` intentionally not read for cache (it carries none).
- **Row build** — `cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite` added to the `logTokenCall` row. `total_tokens` still `= uIn + uOut` (no fold-in).
- **Per-request binding** — `hdrTaskId`/`hdrAgent` read from `req.headers['x-task-id']`/`['x-agent']` (trimmed), `agent = hdrAgent || 'claude'`, `taskId = hdrTaskId ? sanitizeTaskId(hdrTaskId) : resolveLiveTaskId()`. `proc` becomes agent-aware (`token-adapter-<agent>` for non-claude; claude keeps the main/sub-agent split). Row stamps `agent` + `user_hash: adapterUserHash(agent)`.
- **`adapterUserHash(agent)`** (module-scope helper) — `claude→cladpt`, `copilot→copadt`, `opencode→opcadt`, `mastra→mstadt`; any other agent derives a valid 6-char code (first char forced alpha, padded/truncated to 6). All values satisfy `/^[a-z][a-z0-9]{5}$/`.

**`tests/integration/messages-tap-cache-parse.test.mjs` (new)** — fixture-based, imports `parseUsageCache` from the shipped `../../dist/usage-cache.js`. Fixture A (flat) → cacheRead=5/cacheWrite=8; Fixture B (object) → cacheRead=12/cacheWrite=7 (3+4 summed); a total-excludes-cache invariant check; a malformed-input coalesce check; a live-proxy assertion gated on `LLM_PROXY_LIVE=1` (env, not argv).

## Tasks

| Task | Name | Commit (proxy repo `main`) | Files |
| ---- | ---- | -------------------------- | ----- |
| 1 | parseUsageCache helper + tap cache capture | `c53af2c` | src/usage-cache.ts, dist/usage-cache.d.ts.map, proxy-bridge/server.mjs |
| 2 | Per-request x-task-id/x-agent binding + non-cladpt stamping | `742189d` | proxy-bridge/server.mjs |
| 3 | SSE cache-parse integration test | `073d4c6` | tests/integration/messages-tap-cache-parse.test.mjs |

Note: implementation lives in the separate `/Users/Q284340/Agentic/_work/rapid-llm-proxy` git repo (commits on its `main` branch, built on Plan 82-01's `491b2ff`/`9edd7e0`), per the plan. This worktree carries only the SUMMARY.

## Verification

- `npm run build` in the proxy repo exits 0 (TypeScript compiles clean to `dist/`).
- Task 1 probe: `parseUsageCache({cache_read_input_tokens:5,cache_creation_input_tokens:8})` → `{5,8}`; object form `{cache_creation:{x:3,y:4}}` → cacheWrite=7. Prints `ok`.
- Acceptance greps green: `cache_read_tokens: ` in the row build; `import ... parseUsageCache ... dist/usage-cache` at `:51`; `const total = uIn + uOut` unchanged (no cache fold-in); new `x-task-id`/`x-agent` reads at `:1950-1951` (distinct from the pre-existing shim block at `:2186/:2193`); `token-adapter-${agent}` template at `:1959`; `sanitizeTaskId(hdrTaskId)` at `:1955`; `claude: 'cladpt'` literal survives.
- Derived non-cladpt user_hash values all match `/^[a-z][a-z0-9]{5}$/`: **copadt**, **opcadt**, **mstadt** (plus fallback derivation verified for `gemini`, `7bad`→`x7badx`, empty→`xxxxxx`, `llama-3`→`llama3`).
- `node --check proxy-bridge/server.mjs` → syntax OK (runtime `.mjs`, no build).
- `node --test tests/integration/messages-tap-cache-parse.test.mjs` → 4 pass / 1 skip (live-gated).
- Full suite `messages-tap-cache-parse` + Plan-01 `token-usage-cache-migration` → 8 pass / 1 skip / 0 fail (Plan-01 test still green — no regression).

## Deviations from Plan

### Auto-fixed / preserved

**1. [Rule 3 - Pre-existing working-tree change preserved] Phase-78 span-leakage guard co-committed in Task 1**
- **Found during:** Task 1 (staging `proxy-bridge/server.mjs`).
- **Issue:** The proxy working tree carried an unrelated, uncommitted modification to `server.mjs` (the Phase-78 `captureBelongsToRun` / `runIdentityFromTaskId` / `modelFamily` span-leakage guard, `:1536-1725`). Per the executor instructions I must NOT revert or blanket-`git add -A` it away. Because git stages whole files, this pre-existing change landed inside the Task 1 commit (`c53af2c`) alongside my parseUsageCache tap edits.
- **Fix:** Preserved verbatim (not authored by this plan); the plan explicitly relies on `captureBelongsToRun` staying intact as the secondary guard, so its presence is compatible. Documented here for traceability.
- **Files modified:** proxy-bridge/server.mjs
- **Commit:** `c53af2c`

Otherwise the plan executed exactly as written.

## Known Stubs

- The `(LIVE)` test in `messages-tap-cache-parse.test.mjs` is an intentional placeholder skipped unless `LLM_PROXY_LIVE=1`. The behavioral 2-cell concurrent per-task-binding gate is deferred to Plan 82-06 (per the plan's `<verification>` and threat register T-82-02-03). The default offline suite fully covers the pure helper + wire-form fixtures.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries beyond those already enumerated in the plan's `<threat_model>` (the `x-task-id`/`x-agent` header surface and the SSE/JSON usage parse are both covered, with sanitizeTaskId + never-throw coalesce mitigations applied).

## Self-Check: PASSED

- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts
- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/messages-tap-cache-parse.test.mjs
- FOUND: proxy-bridge/server.mjs cache-tap + header-binding edits (greps above)
- FOUND commit c53af2c (Task 1)
- FOUND commit 742189d (Task 2)
- FOUND commit 073d4c6 (Task 3)
