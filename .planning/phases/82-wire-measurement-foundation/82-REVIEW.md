---
phase: 82-wire-measurement-foundation
reviewed: 2026-07-06T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/shim-tools.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/background-process.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/providers/base-provider.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/providers/copilot-provider.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/types.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/messages-tap-cache-parse.test.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/shim-tool-passthrough.test.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-usage-cache-migration.test.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/background-process-guard.test.mjs
  - lib/lsl/token/token-db.mjs
  - tests/token-adapters/token-db-dedup-merge.test.js
  - lib/experiments/experiment-runner.mjs
  - scripts/launch-agent-common.sh
  - config/agents/copilot.sh
  - config/agents/opencode.sh
  - config/experiments/wire-verify-82-06.yaml
  - config/experiments/wire-verify-82-06-v2.yaml
  - tests/experiments/experiment-runner.test.mjs
findings:
  critical: 1
  warning: 6
  info: 8
  total: 15
status: issues_found
---

# Phase 82: Code Review Report

**Reviewed:** 2026-07-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Reviewed the Phase 82 wire-measurement foundation: cache-token columns + migration (proxy `token-usage.ts`, coding `token-db.mjs`), the `/v1/messages` tap cache parse + per-request `x-task-id`/`x-agent` binding, the `isBackgroundProcess` ambient-span guard, the OpenAI-shim tool-call passthrough + `/v1/copilot[/t/<id>]` routes with capability gating, merge-on-cache dedup, and the launcher routing changes (claude re-route, copilot BYOK, flag-gated opencode). Proxy review was scoped to the `01a4758..d3f3869` diff regions per the phase brief.

The schema/migration work, the merge-on-cache dedup, the capability gate, and the background-process denylist are solid and well-tested. However, the per-request binding seam introduces one crash-grade defect (unguarded `sanitizeTaskId` throws in the HTTP handler, killing the proxy on a malformed header/path), and two measurement-correctness gaps survive the phase's own kill-target: interactive-session tap rows still inherit the ambient cell span, and the new copilot BYOK route creates an un-deduplicated second writer alongside the copadt file adapter (never live-gated — both wire-verify specs contain only claude + opencode cells).

Known accepted issues NOT re-flagged (per SUMMARYs): duplicate `id` values in `token_usage` (pre-existing writer collision), the `COPILOT_PROVIDER_API_KEY` literal placeholder (T-82-05-01), and mastra remaining ambient-bound.

## Critical Issues

### CR-01: Unguarded `sanitizeTaskId` throw in the HTTP handler crashes the proxy daemon (DoS on any malformed x-task-id / task path segment)

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:1999` and `:2243-2244`
**Issue:** `sanitizeTaskId` (dist/measurement-span.js:83-99) **throws** on any input outside `/^[A-Za-z0-9._-]+$/`, longer than 200 chars, or resolving to `.`/`..`. Two Phase-82 call sites invoke it with untrusted input, outside any try/catch, inside the `http.createServer(async (req, res) => ...)` handler:

1. Line 1999 (`/v1/messages` tap): `const taskId = hdrTaskId ? sanitizeTaskId(hdrTaskId) : resolveLiveTaskId();` — a request with e.g. `x-task-id: foo bar`, a `%`, or a 201-char value throws.
2. Lines 2243-2244 (shim task-scoped path): `try { shimPathTaskId = sanitizeTaskId(decodeURIComponent(m[2])); } catch { shimPathTaskId = sanitizeTaskId(m[2]); }` — the catch was written for `decodeURIComponent`'s URIError, but when the FIRST `sanitizeTaskId` throws (illegal chars after decode, e.g. `/v1/copilot/t/foo%20bar/chat/completions` → `foo bar`), the retry in the catch throws AGAIN (`%` is illegal in the raw segment) — unguarded.

There is no top-level try/catch in the handler and no `process.on('unhandledRejection')` (only SIGINT/SIGTERM at lines 2942-2943). In Node ≥15 an unhandled async-handler rejection terminates the process. One malformed request kills the proxy mid-stream for every live session (launchd respawns it, but in-flight requests die and a repeat sender creates a crash loop). This is also reachable through the phase's own wiring: `launch-agent-common.sh:418` embeds `${TASK_ID}` into `ANTHROPIC_CUSTOM_HEADERS` and `:448` into the copilot base URL **without validation or URL-encoding** — any TASK_ID containing a space/illegal char turns every agent request into a proxy-killer.
**Fix:**
```js
// server.mjs — never let header/path validation throw into the handler.
// Tap site (line 1999):
let taskId = '';
if (hdrTaskId) {
  try { taskId = sanitizeTaskId(hdrTaskId); }
  catch (err) { logErr(`x-task-id rejected (${err?.message}); falling back to ambient`); taskId = resolveLiveTaskId(); }
} else {
  taskId = resolveLiveTaskId();
}

// Shim path site (lines 2243-2244):
try { shimPathTaskId = sanitizeTaskId(decodeURIComponent(m[2])); }
catch {
  try { shimPathTaskId = sanitizeTaskId(m[2]); }
  catch (err) { logErr(`/t/<taskId> segment rejected (${err?.message}); unbound`); shimPathTaskId = ''; }
}
```
Additionally add a defense-in-depth `process.on('unhandledRejection', ...)` log-and-survive handler (or wrap the whole handler body in try/catch → 500), and URL-encode/validate `TASK_ID` in `launch-agent-common.sh` (mirror `encodeURIComponent` as `configureProxyRoutingEnv` already does at experiment-runner.mjs:185).

## Warnings

### WR-01: Interactive-session rows on the `/v1/messages` tap still inherit the ambient cell span — the singleton leak the phase set out to kill survives on the tap path

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:1999,2174`
**Issue:** The WIRE-03 guard (`isBackgroundProcess`) gates only the `/api/complete` ambient fallback (line 2675). The `/v1/messages` tap has its OWN ambient fallback at line 1999 (`: resolveLiveTaskId()`) and stamps that task_id into the DB row unconditionally at line 2174. `captureBelongsToRun` (line 2030) gates only the context-breakdown FILE, not the token row. During an ATTENDED experiment (the wire-verify-82-06 design point: "an interactive claude session ... generate live proxy traffic DURING the run"), the interactive session is proxy-routed (launcher `ANTHROPIC_BASE_URL`) with an EMPTY `x-task-id` (launcher exports `x-task-id: ${TASK_ID:-}` — empty at interactive launch), so every interactive turn falls through to `resolveLiveTaskId()` = the open cell's task_id. `aggregateByTaskId` (lib/experiments/token-aggregate.mjs:146-160) sums ALL rows with that task_id, so interactive foreground tokens inflate the claude cell's totals. The v2 gate's pass criterion only asserted daemon `/api/complete` rows land with `task_id=''` — it did not check tap-path contamination.
**Fix:** Apply the run-identity gate to the DB stamp as well, e.g. at line 2174: `task_id: (taskId && captureBelongsToRun(taskId, model, 'anthropic')) ? taskId : ''` — or stronger, only allow the ambient fallback to bind an EXPERIMENT-shaped task_id (`includes('--')`) when the request carried an explicit header. Re-run an attended gate asserting the interactive session's rows carry `task_id=''` (or its own id) during an open cell span.

### WR-02: Copilot BYOK routing creates a second, un-deduplicated writer next to the copadt file adapter — copilot cell totals can double-count; never live-gated

**File:** `/Users/Q284340/Agentic/coding/lib/experiments/experiment-runner.mjs:179-192`, `/Users/Q284340/Agentic/coding/config/agents/copilot.sh:72-81`, `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2613-2677`
**Issue:** With BYOK, every copilot foreground completion now lands a proxy shim row (`user_hash` = machine hash, `tool_call_id=''`, `task_id` = cell id via `/t/<id>`). The copadt stop adapter (lib/lsl/token/stop-adapter-registry.mjs, `capture:'transcript'` with `buildCopilotTokenRows`) SEPARATELY reconstructs the same turns from `~/.copilot/session-state/.../events.jsonl` as `(copadt, <turn-id>)` rows stamped with the same span task_id. The claude equivalent is bridged by the shared `(cladpt, request-id)` dedup key + Plan-04 merge-on-cache; copilot has NO shared key (different `user_hash`, empty `tool_call_id` on the shim rows), so `aggregateByTaskId` sums both writers → double-counted copilot cells. Neither wire-verify spec contains a copilot cell (both YAMLs: claude + opencode only), so this path was never gated live.
**Fix:** Either (a) suppress the copadt `build` when the session was BYOK-routed (detectable via `COPILOT_PROVIDER_BASE_URL` in the launch env / a marker in the span), (b) give the shim rows a copadt-compatible dedup key (stamp `user_hash='copadt'` + a turn-correlatable `tool_call_id` on `/v1/copilot` rows so `insertTokenRowDeduped` merges), or (c) exclude one writer's rows in `aggregateByTaskId`. Then add a copilot cell to a wire-verify gate and assert single-counting.

### WR-03: SSE reframe emits `delta.tool_calls` without the OpenAI-required `index` field on the common buffered path

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/shim-tools.mjs:64-69`, `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2705-2707`
**Issue:** `buildStreamDelta` passes `result.toolCalls` verbatim into the first SSE chunk. The shim's internal body carries no `maxTokens`, so `completeCopilot` defaults to 4096 and `useStream = 4096 > 4096` is **false** — the buffered JSON path is the common case, and non-streaming OpenAI responses' `message.tool_calls` items carry NO `index` field. The OpenAI streaming wire contract requires `choices[].delta.tool_calls[].index` (clients like `@ai-sdk/openai-compatible` key fragment accumulation on it). Multiple parallel tool calls with `index: undefined` collapse into one slot or are rejected, breaking the opencode agentic loop this passthrough was built for. (The streamed `readCopilotStream` path happens to retain `index` on its accumulated objects — the inconsistency masks the bug in large-maxTokens tests.)
**Fix:**
```js
export function buildStreamDelta(result) {
  const delta = { role: 'assistant', content: (result && result.content) || '' };
  if (hasToolCalls(result)) {
    delta.tool_calls = result.toolCalls.map((tc, i) => (
      typeof tc?.index === 'number' ? tc : { index: i, ...tc }
    ));
  }
  return { delta, finishReason: hasToolCalls(result) ? 'tool_calls' : 'stop' };
}
```

### WR-04: SDK `CopilotProvider` claims `supportsFunctionCalling = true` unconditionally, but its proxy-bridge path silently drops tools — the exact silent-strip the gate forbids

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/providers/copilot-provider.ts:133,377-423`
**Issue:** `supportsFunctionCalling = true` is declared on the class (line 133) and `completeDirectHTTP` forwards `tools`/`tool_choice` (lines 299-304). But `completeViaProxy` (the path used in Docker / when direct HTTP fails, line 261-262 → 377) builds its `/api/complete` body WITHOUT `tools`/`tool_choice` (lines 390-396) and never reads `toolCalls` off the response (lines 408-417). Any consumer that trusts the capability flag and sends tools through a proxy-mode `CopilotProvider` gets a silent strip — precisely the T-82-03-02 failure mode `gateToolCapableChain` exists to prevent, reintroduced one layer up.
**Fix:** Forward the fields and parse the result in `completeViaProxy`:
```ts
body: JSON.stringify({
  provider: this.name, messages: request.messages,
  model: this.resolveModel(request.tier),
  maxTokens: request.maxTokens || 4096, temperature: request.temperature,
  ...(Array.isArray(request.tools) && request.tools.length > 0 ? { tools: request.tools } : {}),
  ...(request.toolChoice !== undefined ? { tool_choice: request.toolChoice } : {}),
}),
```
(the shim/`/api/complete` pipeline already returns tool-bearing results), and surface `data.toolCalls` in the returned `LLMCompletionResult` — or make `supportsFunctionCalling` reflect the active mode (`!this.useProxy`) until the proxy path is wired.

### WR-05: `copilot.sh` exports BYOK proxy env unconditionally — a down proxy leaves copilot pointed at a dead URL, breaking the fail-soft contract

**File:** `/Users/Q284340/Agentic/coding/config/agents/copilot.sh:72-81`, `/Users/Q284340/Agentic/coding/scripts/launch-agent-common.sh:400-404`
**Issue:** `agent_pre_launch` exports `COPILOT_PROVIDER_BASE_URL`/`_TYPE`/`_API_KEY` with no health gate. The comment claims `configure_proxy_routing()` "has the final say", but when the health probe fails, `configure_proxy_routing` `return 0`s WITHOUT unsetting anything (launch-agent-common.sh:400-404) — the "launching UNROUTED" log is false for copilot: the stale exports remain, and every copilot completion targets a dead `127.0.0.1:12435` endpoint. Claude/opencode degrade gracefully (their overrides are only set inside the healthy branch); copilot hard-breaks.
**Fix:** Move the BYOK exports out of `agent_pre_launch` into the health-gated `configure_proxy_routing` copilot branch only (delete lines 72-82 of copilot.sh, which duplicate launch-agent-common.sh:447-455 anyway), or have the unhealthy branch explicitly `unset COPILOT_PROVIDER_BASE_URL COPILOT_PROVIDER_TYPE COPILOT_PROVIDER_API_KEY`.

### WR-06: Inconsistent task-id sanitization across the three binding seams — shim header/body task_ids reach the DB raw while file keys are sanitized

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2272-2276,2284-2298,2315`
**Issue:** On the OpenAI-shim path, `hdrTaskId` and `bodyTaskId` are used verbatim (`resolveShimTaskId`, line 2276) — stored raw in the DB (line 2315 → logCall) and used raw as the `_ctxMaxByTask` key (line 2293), while `perRunBreakdownPath` sanitizes internally (line 1592, and THROWS on illegal chars — silently swallowed by the surrounding try, so the per-run breakdown is never written for such an id while its DB rows exist). The `/v1/messages` tap sanitizes the header (line 1999) and the path segment is sanitized (line 2243). Net effect: the same logical task id can be keyed three different ways (raw DB task_id, raw in-memory max key, sanitized filename), breaking the DB↔breakdown-file join and the keep-largest invariant for any id that `sanitizeTaskId` would reject.
**Fix:** Sanitize once at intake on ALL seams (header, body, path) with the CR-01 catch-to-fallback pattern, and use the sanitized value uniformly for DB rows, `_ctxMaxByTask` keys, and filenames.

## Info

### IN-01: Contradictory docblock in `configureProxyRoutingEnv`

**File:** `/Users/Q284340/Agentic/coding/lib/experiments/experiment-runner.mjs:113-117`
**Issue:** The "Capture model" paragraph states claude and copilot "are NOT proxy-routed here", directly contradicted by the Contract lines below (122-127) and the code (claude `ANTHROPIC_BASE_URL`, copilot BYOK). Stale text from the pre-82 design.
**Fix:** Rewrite the paragraph to describe the Phase-82 state (all except mastra routed; file adapters remain for cache/dedup enrichment).

### IN-02: `adapterUserHash` unknown-agent derivation can collide

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:68-74`
**Issue:** Unknown agents are truncated to 6 chars (`openhands` and `openhand2` both → `openha`), silently merging distinct agents into one adapter hash bucket (and dedup keyspace).
**Fix:** Append a short hash of the full name (e.g. first char + 5 hash chars) instead of blind truncation.

### IN-03: Export/hydrate round-trip drops the attribution columns

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:356-364,710-717`
**Issue:** Phase 82 added `cache_read/write_tokens` to `exportToHourFile` and `hydrateFromExports`, but `agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier`, `reasoning_tokens` are still absent — a DB reset + rehydrate silently loses all per-run attribution (the phase's core payload) while preserving cache counters. Pre-existing (Phase 68) gap, now more consequential.
**Fix:** Add the six attribution columns to the export SELECT and hydrate INSERT with `?? ''`/`?? 0` coalescing like the cache columns.

### IN-04: Weak/tautological assertions and a coverage gap in the new tests

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/messages-tap-cache-parse.test.mjs:83-96`, `/Users/Q284340/Agentic/coding/tests/experiments/experiment-runner.test.mjs:227-253`
**Issue:** Test (C) asserts `total === uIn + uOut` against a locally computed `total = uIn + uOut` (tautology) and `total < total + positive` (always true) — it does not exercise the tap's accumulation code. The routing test covers opencode/claude/down/opt-out but not the NEW copilot BYOK branch of `configureProxyRoutingEnv` (base-URL encoding, placeholder key, `COPILOT_MODEL`).
**Fix:** Drive the actual SSE-parse loop (extract it or feed fixture frames through a harness) for (C); add a `configureProxyRoutingEnv('copilot', ...)` assertion including the `encodeURIComponent` behavior.

### IN-05: OpenAI-wire cache fields are not parsed — copilot/opencode shim rows always report 0 cache

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:890-910,745-802`
**Issue:** `completeCopilot`/`readCopilotStream` read only `prompt_tokens`/`completion_tokens`/`total_tokens`; `usage.prompt_tokens_details.cached_tokens` (OpenAI cache accounting) is dropped. The phase documents "no provider-side prompt cache on this route" as observed reality, but if the upstream starts reporting it, the uniform-measurement claim silently degrades with no signal.
**Fix:** Parse `usage.prompt_tokens_details?.cached_tokens ?? 0` into `cache_read_tokens` on the `/api/complete` logCall so the wire stays authoritative.

### IN-06: `writeSkipRun` ignores the main-data-dir span env

**File:** `/Users/Q284340/Agentic/coding/lib/experiments/experiment-runner.mjs:445,451`
**Issue:** `runCell` carefully builds `spanEnv` with `LLM_PROXY_DATA_DIR = mainDataDir` (line 375-376), but `writeSkipRun` calls `runMeasurement('start'/'stop', ..., {})` — the span for copilot skip-Runs lands wherever `process.env.LLM_PROXY_DATA_DIR` points, diverging from real cells when `opts.dataDir` is set.
**Fix:** Thread `dataDir` into `writeSkipRun` and pass the same `spanEnv` construction.

### IN-07: Port env-var split-brain across launcher layers

**File:** `/Users/Q284340/Agentic/coding/config/agents/copilot.sh:72`, `/Users/Q284340/Agentic/coding/config/agents/opencode.sh:59`, `/Users/Q284340/Agentic/coding/scripts/launch-agent-common.sh:397`
**Issue:** Agent configs default from `LLM_CLI_PROXY_PORT` while `configure_proxy_routing` and `configureProxyRoutingEnv` use `LLM_PROXY_PORT`. An operator overriding only one gets a copilot BYOK URL on a different port from the health-gated routing layer.
**Fix:** Resolve one canonical variable (CLAUDE.md precedence order) in one place and reference it everywhere.

### IN-08: Launcher unconditionally clobbers `ANTHROPIC_CUSTOM_HEADERS`

**File:** `/Users/Q284340/Agentic/coding/scripts/launch-agent-common.sh:418`
**Issue:** `export ANTHROPIC_CUSTOM_HEADERS="x-task-id: ${TASK_ID:-}"` overwrites any user/env-provided custom headers even when TASK_ID is empty (where the export adds nothing but destroys pre-set values).
**Fix:** Append to an existing value with a newline separator, and skip the export entirely when `TASK_ID` is empty.

---

_Reviewed: 2026-07-06T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
