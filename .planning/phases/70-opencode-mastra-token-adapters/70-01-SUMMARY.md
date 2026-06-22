---
phase: 70-opencode-mastra-token-adapters
plan: 01
subsystem: rapid-llm-proxy (proxy-bridge)
tags: [proxy, openai-shim, token-attribution, adapt-03, telemetry]
requires:
  - "Phase 68 token_usage attribution columns (agent/task_id/granularity_tier) — already shipped"
  - "resolveLiveTaskId() single-reader (measurement-span.ts) — already shipped"
provides:
  - "POST /v1/chat/completions OpenAI-compatible shim on the rapid-llm-proxy (:12435)"
  - "Generic agent/granularity_tier/task_id envelope passthrough on the shared logTokenCall row build"
  - "Per-llm-call token_usage rows for any proxy-routed agent (opencode default, mastra via X-Agent) with zero per-agent branches"
affects:
  - "Plan 70-04 Track A (Mastra) — can stamp agent='mastra' by sending X-Agent: mastra, no server.mjs change"
  - "OpenCode provider config (Plan 70-02/03) — can point baseURL at http://localhost:12435/v1"
tech-stack:
  added: []
  patterns:
    - "Single-pipeline shim: normalize OpenAI body -> internal /api/complete envelope -> fall through shared provider chain (no duplicated routing)"
    - "Generic envelope passthrough (agent/granularity_tier stamped the way process/subscription already are)"
    - "X-Agent / X-Task-Id header precedence mirroring body.* override (default 'opencode')"
key-files:
  created:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/agent-envelope-passthrough.test.mjs"
  modified:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs"
decisions:
  - "[70-01] Shim reuses the /api/complete pipeline via req._shimBody stash + req.url rewrite + req._shimOpenAI response wrap — a single-pipeline design (D-02) with no duplicated provider-chain logic"
  - "[70-01] randomUUID imported from node:crypto (bare `crypto` is not a Node global in ESM) for the chatcmpl-<uuid> id"
  - "[70-01] T-70-03 0.0.0.0 LAN bind ACCEPTED by operator (load-bearing for host.docker.internal container access; out of plan scope)"
metrics:
  duration: ~12 min
  completed: 2026-06-22
  tasks: 3
  files: 2
---

# Phase 70 Plan 01: OpenAI-Compatible Proxy Shim + Generic Token Attribution Passthrough Summary

OpenAI `/v1/chat/completions` shim on rapid-llm-proxy that maps onto the existing `/api/complete` pipeline and logs every call as a `per-llm-call` token_usage row, with a generic `agent`/`granularity_tier`/`task_id` envelope passthrough so opencode/mastra/any future proxy-routed agent is served by one code path with zero per-agent branches.

## What Was Built

**Task 1 — Generic envelope passthrough on the `logTokenCall` build** (`server.mjs:1764-1789`, inside the shared `if (_tokenDb)` guard):
- `row.agent` stamped from `body.agent` (non-empty string, else `''`) — the same way `process`/`subscription` are already threaded.
- `row.granularity_tier` stamped from `body.granularity_tier` (non-empty string, else `''`) — default unchanged for existing callers.
- `row.task_id` changed from hardcoded `resolveLiveTaskId()` to precedence: `body.task_id` (non-empty) wins, else `resolveLiveTaskId()`. Backward-compatible — existing `/api/complete` callers omit `task_id` and keep the active-span behaviour.
- `src/token-usage.ts` **NOT edited** — the six Phase-68 attribution columns already exist and `logCall` already binds `agent`/`task_id`/`granularity_tier` with `''`/`0` defaults.

**Task 2 — `POST /v1/chat/completions` shim branch** (`server.mjs:1519-1601` shim pre-branch; `1603-1618` body reuse; `1796-1816` OpenAI-envelope response wrap; `randomUUID` import at `:35`):
- New `if (req.method === 'POST' && req.url === '/v1/chat/completions')` branch. Reuses the raw-body read + `JSON.parse` + 400-on-bad-JSON guard.
- Normalizes the OpenAI body into an internal `/api/complete` envelope: `model`/`messages` pass straight through (no new routing — Claude's Discretion guardrail), `granularity_tier='per-llm-call'`.
- `agent` precedence (D-06): `X-Agent` request header OR `body.agent` wins when non-empty, else defaults to `'opencode'`. Lets Plan 04 Track A stamp `agent='mastra'` via `X-Agent: mastra` with no server.mjs change.
- `task_id` precedence: `X-Task-Id` header OR `body.task_id`; left unset on the internal body when absent so Task 1's `body.task_id ?? resolveLiveTaskId()` resolves the active span.
- Single-pipeline design: stashes the parsed body on `req._shimBody`, sets `req._shimOpenAI=true`, rewrites `req.url='/api/complete'`, and falls through the shared pipeline. The `/api/complete` branch reuses `req._shimBody` (the stream is already consumed) and wraps its 200 result in the OpenAI `chat.completion` envelope (`id`/`object`/`created`/`model`/`choices`/`usage`) when `_shimOpenAI` is set.
- Non-streaming only (D-02): `body.stream === true` is ignored, logged to stderr as deferred.

**Task 3 — Reload + live confirmation:**
- No TS touched (only `proxy-bridge/server.mjs`, a plain `.mjs`) → no `npm run build` needed.
- Reloaded via `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`; proxy came back healthy with build identity `b5cbdc1` (the shim commit), `networkMode: public`, `claude-code` available.
- Live verified on `:12435` (the LLM proxy, NOT 3033):
  - Default call (no X-Agent) → `chat.completion` envelope; landed row `125940` `agent='opencode'`, `granularity_tier='per-llm-call'`, provider `claude-code`, model `claude-haiku-4.5`, 17 tokens.
  - `X-Agent: mastra` call → `chat.completion` envelope; landed row `125946` `agent='mastra'`, `granularity_tier='per-llm-call'`. Proves the precedence override (Plan 04 Track A path).
  - Malformed JSON → HTTP **400** `{"error":"Invalid JSON"}`.
  - The plan's full automated `<verify>` block printed **PASS**.

## Observed Facts (per `<output>` requirements)

- **Proxy binding (T-70-03):** `lsof -nP -iTCP:12435 -sTCP:LISTEN` shows `node ... TCP *:12435 (LISTEN)` = bound to `0.0.0.0` (all interfaces), reachable on the LAN. `server.mjs:1994` is `server.listen(PORT, '0.0.0.0', ...)`. See Security Findings below — operator-acknowledged HIGH.
- **Measurement span during live check:** NONE. `.data/active-measurement.json` does not exist, so `resolveLiveTaskId()` returned `''` and both live rows carry `task_id=''`. This is the documented acceptable case (acceptance criteria: "empty string is acceptable when no measurement span is active").
- **agent values observed:** default row = `opencode`; `X-Agent: mastra` row = `mastra`. Both `granularity_tier='per-llm-call'`.
- **token-usage.ts NOT edited:** confirmed — `git diff --name-only` across all three proxy commits lists only `proxy-bridge/server.mjs` and the new test file; `src/token-usage.ts` is untouched (no schema change).

## Security Findings

### HIGH (operator-acknowledged) — T-70-03: proxy listener binds 0.0.0.0 (LAN-exposed)

- **Measured fact:** the rapid-llm-proxy listener binds `0.0.0.0` at `proxy-bridge/server.mjs:1994` (`server.listen(PORT, '0.0.0.0', ...)`), confirmed live via `lsof -nP -iTCP:12435 -sTCP:LISTEN` → `TCP *:12435 (LISTEN)`. The proxy (and therefore the new unauthenticated `/v1/chat/completions` shim and the pre-existing unauthenticated `/api/complete`) is reachable from the LAN at `192.168.x.x:12435`.
- **Disposition:** **ACCEPTED by the operator** (operator decision recorded at execution time, final — no checkpoint).
- **Rationale (operator-supplied + verified):** The `0.0.0.0` bind is LOAD-BEARING and required — `docker/docker-compose.yml` wires the coding-services container to reach the proxy via `host.docker.internal:12435` (a non-loopback interface). Binding to `127.0.0.1` would break all container→proxy LLM traffic. The bind line is OUT OF SCOPE for this plan and was not changed.
- **Shim-specific risk delta:** The shim adds NO new exposure beyond the already-LAN-exposed `/api/complete` (T-70-02 disposition = accept). T-70-03 only required surfacing + operator acknowledgment before shipping; that is now satisfied.

### Accepted (per threat register, unchanged) — T-70-01 / T-70-02 / T-70-SC

- **T-70-01 (Spoofing, accept):** the `X-Agent`/`body.agent` and `X-Task-Id`/`body.task_id` overrides are attribution labels on a local-only telemetry row, not auth principals. Each field is bound as a parameterized string in `logCall` (never interpolated into SQL), so injection cannot escape the column. Worst case is a mis-attributed local telemetry row, re-attributable by the timestamp-join backfill.
- **T-70-02 (DoS/abuse, accept):** the proxy already exposes `/api/complete` unauthenticated on the same port; the shim adds no new exposure. Off-host abuse is governed by the binding (T-70-03 accept), not per-request auth; adding shim auth is out of scope.
- **T-70-SC (Tampering, mitigate):** NO new packages added. `randomUUID` is imported from the Node builtin `node:crypto` (not a package-manager install), so the package-legitimacy checkpoint did not apply.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `crypto.randomUUID()` would have thrown a ReferenceError**
- **Found during:** Task 2.
- **Issue:** The shim response wrap used `crypto.randomUUID()`, but `crypto` is not a Node global identifier in ESM (`server.mjs` is a `.mjs` module and did not import it). Bare `crypto.randomUUID()` would throw at runtime.
- **Fix:** Added `import { randomUUID } from 'node:crypto'` at `server.mjs:35` (a Node builtin, NOT a package install — T-70-SC does not apply) and changed the call site to `randomUUID()`.
- **Files modified:** `proxy-bridge/server.mjs`.
- **Commit:** `b5cbdc1` (folded into the shim feat).

### Plan-text staleness (no action needed, documented)

- Tasks 1 & 2 `read_first` reference "the existing X-Task-Id header read / body.task_id precedence expression to mirror." In fact server.mjs had NO pre-existing `X-Task-Id`/`body.task_id`/`X-Agent` handling — `task_id` was a hardcoded `resolveLiveTaskId()`. The precedence pattern was built fresh (Task 1 for `task_id`, Task 2 for `agent`), consistent with the intended design. No functional impact.

## TDD Gate Compliance

- Task 1 (`tdd="true"`): RED test committed first (`58a3514` — `test(70-01)`), then GREEN source (`5536f59` — `feat(70-01)`). Note: the test consumes the SHIPPED `dist/` persistence layer (token-usage.ts already plumbs the columns, zero edits expected), so all three test cases passed immediately on first run. Per the documented "feature already exists" case, this is expected — the test is the executable proof of the row-shape contract the shim relies on, not a guard against new persistence code. The GREEN gate (the server.mjs passthrough) is verified by the source-grep `<verify>` gate and the Task-3 live row assertions.
- Task 2 (`tdd="true"`): the shim's behavior is HTTP-level and was proven by Task 3's live curl + row checks (the plan's Task-2 acceptance criteria are explicitly "live" assertions run in Task 3). Committed as `feat` (`b5cbdc1`). Deterministic gate (`node --check` + source greps) all green.
- Task 3 (`type="auto"`, non-TDD): reload + live verification; no proxy-repo code change to commit.

## Commits

**rapid-llm-proxy repo** (`/Users/Q284340/Agentic/_work/rapid-llm-proxy`, branch `main`):
- `58a3514` — test(70-01): prove agent/granularity_tier/task_id envelope passthrough row contract
- `5536f59` — feat(70-01): generic agent/granularity_tier/task_id envelope passthrough on logTokenCall (ADAPT-03, D-04/D-05/D-06)
- `b5cbdc1` — feat(70-01): add POST /v1/chat/completions OpenAI-compatible shim (ADAPT-03, D-02/D-06)

**coding repo** (`/Users/Q284340/Agentic/coding`): this SUMMARY + STATE/ROADMAP/REQUIREMENTS updates.

## Success Criteria

- ADAPT-03 SC-1 (proxy half): each shim call logs a `per-llm-call` row — ✓ (rows 125940 opencode, 125946 mastra).
- ADAPT-03 SC-2 (proxy half): active task_id is passed via the envelope and lands on the row — ✓ (precedence wired; no span active during the live check, so `task_id=''` per the acceptable case).
- D-06 (generic passthrough): shim resolves agent via X-Agent/body.agent precedence (default 'opencode'), enabling Plan 04 Track A — ✓ (`X-Agent: mastra` landed an `agent='mastra'` row).
- Backward compatibility: existing `/api/complete` callers (omitting agent/task_id) keep current behaviour — ✓ (test case (c) + the `req._shimBody`-absent path preserved verbatim).

## Self-Check: PASSED

- FOUND: `tests/integration/agent-envelope-passthrough.test.mjs` (rapid-llm-proxy)
- FOUND: `.planning/phases/70-opencode-mastra-token-adapters/70-01-SUMMARY.md` (coding)
- FOUND proxy commits: `58a3514`, `5536f59`, `b5cbdc1`
