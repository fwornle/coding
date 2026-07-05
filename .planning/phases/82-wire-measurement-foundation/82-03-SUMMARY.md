---
phase: 82-wire-measurement-foundation
plan: 03
subsystem: llm-proxy-openai-shim
tags: [tool-calls, function-calling, openai-shim, copilot-byok, capability-gating, task-binding]
requires:
  - /v1/messages tap x-task-id/x-agent per-request binding (Plan 82-02)
  - sanitizeTaskId single-reader import in server.mjs (Plan 68-03 / 82-02)
provides:
  - POST /v1/copilot/chat/completions dedicated shim path (defaultAgent='copilot')
  - optional /v1/<copilot|mastra>/t/<taskId>/chat/completions per-request task binding (header-less agents)
  - internalBody tools[]/tool_choice forward (guarded; tool-less byte-unchanged)
  - completeCopilot (runtime) tools forward + tool_calls parse-back (non-streaming AND streaming index-merge)
  - copilot-provider.ts (SDK) tools body + tool_calls parse-back + supportsFunctionCalling capability
  - capability gating: tools-bearing request cannot select claude-code (--tools ''); prefer-capable or fail loud
  - buffered + single-shot-SSE response envelope tool_calls mapping (finish_reason 'tool_calls')
  - proxy-bridge/shim-tools.mjs pure helpers (forward/map/gate/precedence) shared with unit test
affects:
  - Plan 82-06 (2-cell live gate — behavioral "real file on disk" acceptance of the agentic loop)
  - copilot BYOK + opencode agentic loops (native tool_calls now flow end-to-end)
tech-stack:
  added: []
  patterns:
    - pure never-throw shim helpers in a plain .mjs (no build) shared by runtime + test
    - static supportsFunctionCalling capability flag (opt-in; base default false)
    - path→defaultAgent {table} + optional /t/<taskId> per-request binding seam
    - streamed tool_calls accumulation by index (id/type/function.name once, arguments appended)
key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/shim-tools.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/shim-tool-passthrough.test.mjs
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/providers/copilot-provider.ts
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/providers/base-provider.ts
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/types.ts
decisions:
  - "Runtime shim uses server.mjs completeCopilot (NOT copilot-provider.ts SDK) — wired tools forward + tool_calls parse in BOTH so the loop is REAL, not just grep-passing (Rule 2)"
  - "Streaming path (readCopilotStream, maxTokens>4096) accumulates tool_calls by index — agentic loops use large budgets so this path matters for real tool use"
  - "supportsFunctionCalling capability set = {copilot} only (the sole provider whose runtime fn forwards tools[] + parses tool_calls); honest capability, others opt-in later — prevents dishonest capability claims that would silent-strip"
  - "Capability gate FAILS LOUD (400 NO_TOOL_CAPABLE_PROVIDER) when no capable provider reachable — never strips tools to fit claude-code (--tools ''), the exact spike gap"
  - "task_id precedence header > body > path > ambient; path segment sanitizeTaskId'd (traversal-safe) — the only per-request seam for header-less copilot BYOK / mastra"
  - "Pure mapping/gating logic extracted to shim-tools.mjs (plain .mjs, no build) so the same code runs at runtime AND under node --test (server response code is not importable)"
requirements: [WIRE-04, WIRE-05]
metrics:
  duration_minutes: 20
  completed: 2026-07-05
  tasks: 3
  files_changed: 6
---

# Phase 82 Plan 03: OpenAI-Shim Native Tool-Call Passthrough Summary

Gave the proxy's OpenAI shim native `tool_calls` passthrough end-to-end and added the dedicated `/v1/copilot/chat/completions` path. Previously the shim's `internalBody` dropped `tools[]`/`tool_choice`, so no native `tool_calls` ever returned — agentic BYOK/opencode loops were text hallucinations (spike probe 3: copilot claimed file creation, no file on disk). This plan wires the three drop-points (internalBody forward → copilot request body → response envelope) in BOTH the runtime (`server.mjs`) and SDK (`copilot-provider.ts`) code paths, plus capability gating so a tools-bearing request can never silently land on the tools-incapable claude-code CLI (spawned `--tools ''`). The dedicated `/v1/copilot` path fixes the spike's agent mis-stamping (BYOK was stamped `agent='opencode'`, row 163286).

## What Was Built

**`proxy-bridge/server.mjs` (runtime, no build)** — five seams extended:
- **Shim guard → 3-entry table** — `SHIM_PATH_AGENTS = { '/v1/chat/completions':'opencode', '/v1/mastra/...':'mastra', '/v1/copilot/...':'copilot' }` replaces the `||` chain; `isOpenAIShim` derives from a table hit OR the task-scoped regex.
- **Task-scoped path form** — `/^\/v1\/(copilot|mastra)\/t\/([^/]+)\/chat\/completions$/` extracts `<taskId>` (`decodeURIComponent` → `sanitizeTaskId`) and feeds it into the task_id precedence at LOWER priority than header/body (`resolveShimTaskId(hdr, body, path)` → `header > body > path`, ambient downstream).
- **Drop point 1 — internalBody forward** — `if (Array.isArray(oaBody.tools)) internalBody.tools = oaBody.tools;` + `if (oaBody.tool_choice !== undefined) internalBody.tool_choice = oaBody.tool_choice;` (guarded → tool-less byte-unchanged).
- **`completeCopilot` runtime provider (Rule 2)** — forwards `requestBody.tools`/`tool_choice`, parses `message.tool_calls` back on the non-streaming path, and accumulates streamed `tool_calls` by index in `readCopilotStream` (the `maxTokens>4096` path agentic loops hit). *This is the code the shim actually runs — the plan pointed only at the SDK `copilot-provider.ts`, which the runtime shim does not use.*
- **Capability gate** — `PROVIDER_FUNCTION_CALLING={copilot:true}` + `supportsFunctionCalling(p)`; `gateToolCapableChain(chain, wantsTools, supportsFunctionCalling)` filters the chain to capable-only or returns a loud `400 NO_TOOL_CAPABLE_PROVIDER` when none is reachable — never strips tools onto claude-code.
- **Drop point 3 — response envelope** — buffered branch uses `buildBufferedChoice(result)` (→ `message.tool_calls` + `finish_reason:'tool_calls'`); single-shot SSE branch uses `buildStreamDelta(result)` (→ `delta.tool_calls` + terminal `finish_reason:'tool_calls'`). The no-toolCalls path is byte-identical to the prior `'stop'` envelope.

**`proxy-bridge/shim-tools.mjs` (new, plain .mjs — no build)** — pure never-throw helpers shared by the runtime and the unit test (server response code is not directly importable): `shimToolFields`, `hasToolCalls`, `resolveShimTaskId`, `buildBufferedChoice`, `buildStreamDelta`, `gateToolCapableChain`.

**`src/providers/copilot-provider.ts` (SDK, compiles to dist/)** — `completeDirectHTTP` forwards `request.tools`/`toolChoice` into the OpenAI body and parses `message.tool_calls` back onto `LLMCompletionResult.toolCalls`; static `readonly supportsFunctionCalling = true`.

**`src/providers/base-provider.ts`** — `readonly supportsFunctionCalling = false` default (opt-in capability).

**`src/types.ts`** — optional `tools?`/`toolChoice?` on `LLMCompletionRequest` and `toolCalls?` on `LLMCompletionResult` (non-breaking).

**`tests/integration/shim-tool-passthrough.test.mjs` (new)** — 13 cases (12 pass / 1 live-skip): forward present-vs-omitted, buffered + SSE mapping (+ byte-identical no-tool path), capability fail-loud vs prefer-capable, and `resolveShimTaskId` header>body>path precedence. LIVE round-trip gated on `LLM_PROXY_LIVE=1` (env, not argv).

## Tasks

| Task | Name | Commit (proxy repo `main`) | Files |
| ---- | ---- | -------------------------- | ----- |
| 1 | /v1/copilot path + task-scoped binding + internalBody tools forward | `7d948f9` | proxy-bridge/server.mjs |
| 2 | copilot tools body + tool_calls parse-back + capability gating | `f8bc1e6` | src/types.ts, src/providers/{copilot,base}-provider.ts, proxy-bridge/{server.mjs,shim-tools.mjs}, dist/ |
| 3 (RED) | shim tool-call forward/map/gating + precedence test | `790d435` | tests/integration/shim-tool-passthrough.test.mjs |
| 3 (GREEN) | response envelope tool_calls mapping (buffered + SSE) | `fa7763c` | proxy-bridge/{server.mjs,shim-tools.mjs} |

Note: implementation lives in the separate `/Users/Q284340/Agentic/_work/rapid-llm-proxy` git repo (commits on its `main` branch, built on Plans 82-01/82-02). This coding-repo worktree carries only the SUMMARY.

## Verification

- `npm run build` (proxy repo) exits 0 — TypeScript compiles clean to `dist/` (types.ts + provider additions); reproducible (no dist drift on re-run).
- `node --check proxy-bridge/server.mjs` and `proxy-bridge/shim-tools.mjs` → syntax OK (runtime `.mjs`, no build).
- `node --test tests/integration/shim-tool-passthrough.test.mjs` → 12 pass / 1 skip (live-gated) / 0 fail.
- Combined with the Plan 82-02 suite → 16 pass / 2 skip / 0 fail (no regression).
- Task 1 greps: `grep -c "/v1/copilot/chat/completions"` = 2; `internalBody.tools = oaBody.tools` + `internalBody.tool_choice = oaBody.tool_choice` each present.
- Task 2 greps: `tool_calls` in copilot-provider.ts (6); `supportsFunctionCalling` in copilot-provider.ts (`=true`) and server.mjs (chain check `supportsFunctionCalling(p)` + `gateToolCapableChain`); `body.tools = request.tools` in completeDirectHTTP.
- Task 3 greps: `finish_reason.*tool_calls` present in BOTH buffered (`:2696`) and SSE (`:2686`) branches; `delta.*tool_calls` present in the SSE branch (`:2685`) and streaming accumulator (`:769`).

## Deviations from Plan

### Auto-added critical functionality

**1. [Rule 2 - Missing critical functionality] Wired tools forward + tool_calls parse in server.mjs `completeCopilot` (runtime), not only `copilot-provider.ts` (SDK)**
- **Found during:** Task 2 (tracing the shim's actual provider call).
- **Issue:** The plan's Task 2 targets `src/providers/copilot-provider.ts` `completeDirectHTTP`, but the RUNTIME shim path (`/v1/copilot` → `/api/complete` → `completeCopilot(callBody)` at `server.mjs:784`) uses server.mjs's OWN `completeCopilot`, NOT the TypeScript SDK provider. Editing only the SDK path would pass the grep acceptance yet leave the agentic loop broken at runtime — the exact silent-failure this plan exists to kill. This also covers the streaming variant `readCopilotStream` (`maxTokens>4096`), which agentic tool loops trigger.
- **Fix:** Forwarded `tools`/`tool_choice` into `completeCopilot`'s `requestBody`, parsed `message.tool_calls` back on the non-streaming response, and added index-keyed `tool_calls` accumulation to `readCopilotStream` — in addition to the SDK edits the plan specifies.
- **Files modified:** proxy-bridge/server.mjs
- **Commits:** `f8bc1e6` (forward + non-streaming + streaming parse), `fa7763c` (envelope consumes `result.toolCalls`)

**2. [Rule 3 - Testability] Added `resolveShimTaskId` helper + used it for the shim task_id precedence**
- **Found during:** Task 3 (Task 1's acceptance requires the header>body>path precedence "asserted in the unit test", but the inline `hdr || body || path` in server.mjs is not importable).
- **Fix:** Extracted `resolveShimTaskId(hdr, body, path)` into `shim-tools.mjs` and replaced the inline expression in server.mjs, so the precedence is unit-tested against the same code the runtime uses.
- **Files modified:** proxy-bridge/shim-tools.mjs, proxy-bridge/server.mjs
- **Commit:** `fa7763c`

Otherwise the plan executed as written (path table vs `||` chain and static-flag-vs-probe were both within the plan's Claude's Discretion latitude — chose the 3-entry table and the static flag as the lower-risk options the plan named).

## TDD Gate Compliance

Task 3 (`tdd="true"`) is represented by a `test(82-03)` commit (`790d435`) preceding the `feat(82-03)` GREEN commit (`fa7763c`). Note: the pure forward/map/gate helpers (`shimToolFields`, `buildBufferedChoice`, `buildStreamDelta`, `gateToolCapableChain`) were introduced in Task 2's commit (`f8bc1e6`) because the capability gate depends on `gateToolCapableChain` at runtime; Task 3's `resolveShimTaskId` + the server.mjs response-envelope integration are the RED→GREEN delta. The behavioral "real file on disk" acceptance is deferred to Plan 06's live 2-cell gate per this plan's `<verification>`.

## Known Stubs

- The `LIVE` test in `shim-tool-passthrough.test.mjs` is an intentional placeholder skipped unless `LLM_PROXY_LIVE=1`; the behavioral copilot-BYOK/opencode "real file on disk" gate is deferred to Plan 82-06 (per the plan's `<verification>`). The offline suite fully covers the wiring in isolation.
- `supportsFunctionCalling` is `true` only for `copilot` in the runtime capability map; `openai`/`groq`/`anthropic` are OpenAI-native and COULD forward tools but their server.mjs completion fns do not yet — marked incapable to avoid a dishonest capability claim that would silent-strip. Extending them is a future opt-in, not a blocker for the copilot-BYOK target of this phase.

## Threat Flags

None — no new network endpoints or trust boundaries beyond the plan's `<threat_model>`. The `/v1/copilot` path + `/t/<taskId>` segment are covered by T-82-03-03 (path-derived default only, X-Agent still wins, sanitizeTaskId on the untrusted segment); the tools passthrough by T-82-03-01/02/04 (opaque schemas, capability gate, Array.isArray guards).

## Self-Check: PASSED

- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/shim-tools.mjs
- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/shim-tool-passthrough.test.mjs
- FOUND: server.mjs /v1/copilot path + internalBody.tools forward + gateToolCapableChain + buildBufferedChoice/buildStreamDelta (greps above)
- FOUND: copilot-provider.ts tools body + tool_calls parse + supportsFunctionCalling=true
- FOUND commit 7d948f9 (Task 1)
- FOUND commit f8bc1e6 (Task 2)
- FOUND commit 790d435 (Task 3 RED)
- FOUND commit fa7763c (Task 3 GREEN)
