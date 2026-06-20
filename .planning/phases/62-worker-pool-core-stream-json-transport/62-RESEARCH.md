# Phase 62: Worker Pool Core & stream-JSON Transport - Research

**Researched:** 2026-06-20
**Domain:** Persistent subprocess pool over the `claude` CLI stream-JSON stdio protocol (Node.js, no new dependencies)
**Confidence:** HIGH (all 4 open questions answered empirically against the installed CLI `claude 2.1.170`)

## Summary

Phase 62 replaces the per-call `execFile` spawn of the `claude` CLI (claude-code **CLI-fallback path only**) with warm, per-model, persistent `claude -p --input-format stream-json --output-format stream-json` workers, behind a single `LLM_PROXY_DISABLE_WORKER_POOL=1` escape hatch. I empirically drove the installed CLI to answer the four design-critical open questions and pin the exact stdin/stdout protocol the planner needs.

The headline result is decisive: a **cold first request takes ~3.4s (≈2.3s boot + ~1s API); warm reuse on the same persistent worker averaged ~991ms** (range 0.9–1.6s for trivial prompts; 1.7–2.9s for realistic ~400-token prompts). The ~3s PERF-01 steady-state target is comfortably reachable — the entire win is **spawn/boot elimination**, exactly as the codebase scout reframed it (the ~130-token minimal prompt is below Anthropic's 1024-token cache floor, so `cache_read` contributes nothing for the "say OK" probe; for realistic-size prompts `cache_read` *does* engage and keeps latency flat as context grows). No new npm package is required — `node:child_process.spawn` + JSON-Lines framing is the whole transport.

**Primary recommendation:** Build the worker around `spawn(CLAUDE_CLI, [...session-start args], {env: buildClaudeEnv(), cwd:'/tmp'})`, translate the existing context-stripping flag set verbatim into session-start args, write requests as `{"type":"user","message":{"role":"user","content":<text>}}\n` to stdin, and treat the `{"type":"result",...}` event as the end-of-response boundary (its `result`, `usage`, `modelUsage` fields drive content + token extraction). **Keep D-01 (model × prompt-hash keying) — do NOT collapse to model-only**: per-message system prompt is NOT supported (Q1 = NO). Expose a `cancel()` hook now that emits `{"type":"control_request","request:{subtype:"interrupt"}}` (Q3 = YES, supported, worker survives) so Phase 63 extends rather than refactors.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Workers keyed by **(model × system-prompt-hash)**. A persistent stream-JSON worker is bound to its boot-time system prompt; it serves only requests whose system prompt matches its boot prompt. Each distinct (model, prompt) gets its own small pool.
- **D-02:** Number of distinct prompt-pools is **LRU-bounded** (configurable cap); when exceeded, the LRU prompt-pool's workers are drained/evicted. (Proxy uses a small stable set of prompts: consolidator's, observation-writer's, default `"You are a helpful assistant."`)
- **D-03:** Researcher must verify per-message system prompt → if supported, collapse to model-only. **(Answered below: NOT supported → D-01 stands.)**
- **D-04:** Do NOT pool only the default prompt — heaviest fallback callers (consolidator/observation-writer) use **custom** system prompts and are the milestone's primary beneficiary.
- **D-05:** Default **2 workers per (model × prompt) key**, configurable (env/config knob, name planner's choice).
- **D-06:** Concurrency-1 per worker. When all workers for a key are busy, overflow request **falls back to the existing per-call `execFileAsync` path** (NOT a queue, NOT overflow-spawn).
- **D-07:** **Lazy pool for any model that hits the CLI-fallback path** — existing fallback trigger gates pool creation; no hardcoded allow-list.
- **D-08:** `LLM_PROXY_DISABLE_WORKER_POOL=1` and existing `LLM_PROXY_DISABLE_CLAUDE_DIRECT=1` are **orthogonal** (full truth table in CONTEXT.md §D-08).
- **D-09:** No per-model disable flag (YAGNI).

### Claude's Discretion
- Internal module structure (`worker-pool.mjs` vs inline in `server.mjs`), exact config-knob env-var names, stream-JSON event parsing/token-extraction adaptation, worker→request matching data structure.
- The worker abstraction SHOULD expose a **cancel hook now** (full cancellation propagation lands Phase 63/WLIFE-04) so later phases extend rather than refactor.

### Deferred Ideas (OUT OF SCOPE)
- None from scope creep. Worker lifecycle (Phase 63), hygiene (Phase 64), acceptance probe (Phase 65), dashboard observability (Phase 66) are scoped to later phases. Cross-provider fallback (claude-code → copilot) is permanently excluded.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POOL-01 | Persistent stream-JSON workers; boot once, serve multiple sequential requests without respawn | **Verified empirically** — same `session_id`/PID across 3+ sequential requests; warm avg ~991ms vs cold ~3.4s. Protocol nailed below. |
| POOL-02 | Workers pinned per-model (haiku/sonnet/opus); model M routes only to a `--model M` worker; lazy per-model | **Verified** — model is locked at boot; per-message model override is silently ignored (responds as boot model). Per-model isolation is mandatory; `--model` is a session-start flag. |
| POOL-03 | Concurrency-1 per worker; concurrent same-model requests queue or hit a sibling — never interleaved | The `{type:"result"}` event is the unambiguous end-of-response boundary → router can mark a worker free exactly when it arrives. One in-flight request per worker enforced by the router. |
| POOL-04 | Pool serves ONLY the CLI-fallback path; direct OAuth path unchanged (haiku ~0.9s) | Insertion point is the two `completeClaudeCodeViaCLI(...)` call sites inside `completeClaudeCode()` (server.mjs:1216, 1227). `completeClaudeCodeDirect()` untouched. |
| GUARD-01 | `LLM_PROXY_DISABLE_WORKER_POOL=1` reverts to per-call `execFile`, no behavioral change | Single env gate at the dispatcher; when set, both call sites call the unchanged `completeClaudeCodeViaCLI`. Orthogonal to `DISABLE_CLAUDE_DIRECT` (D-08). |

## Open Questions — Empirical Verdicts

> All four answered by driving the installed CLI (`claude 2.1.170`) directly with `node:child_process.spawn` and JSON-Lines stdio. Evidence is reproducible.

### Q1 — Per-message system prompt? **VERDICT: NO** `[VERIFIED: empirical, claude 2.1.170]`
A persistent stream-JSON worker is bound to its **boot-time** `--system-prompt`. I booted a worker with `--system-prompt 'You are a helpful assistant.'` and sent three variants attempting a per-request override to a "PIRATE" persona:
- `message.system` field inside the message object → ignored (replied as plain Claude)
- top-level `system` field on the `{type:"user"}` event → ignored
- control case (boot prompt only) → identical output

None adopted the override. **Consequence: D-01 (model × prompt-hash keying) STANDS. Do NOT collapse to model-only.** Each distinct boot system prompt needs its own worker. The LRU prompt-pool cap (D-02) is therefore load-bearing, not optional.

### Q2 — Does a `--model M` worker reject a different-model request? **VERDICT: Model locked at boot; mis-routed request silently served with the WRONG model (no error).** `[VERIFIED: empirical]`
A sonnet-booted worker ignored both `event.model:'haiku'` and `message.model:'haiku'` overrides and responded as `claude-sonnet-4-6` every time — **no rejection, no error**. A `control_request{subtype:"set_model"}` returns `success` and *assistant* events then report the new model, but the `result.modelUsage` key remained the boot model — i.e. `set_model` mid-session is **inconsistent and unsafe for routing**. **Consequence: per-model worker isolation is mandatory (POOL-02), and the router MUST key strictly by model** — there is no protocol-level guard that would surface a mis-route; a wrong-model worker would just silently answer. `--model` must be a session-start flag (matches existing `resolveClaudeModel()` usage).

### Q3 — Stream-JSON cancellation? **VERDICT: YES — protocol-level interrupt, worker survives (no respawn needed).** `[VERIFIED: empirical]`
Sending `{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}` to stdin:
- returns `{"type":"control_response","response":{"subtype":"success","request_id":"<id>"}}`
- aborts the in-flight request, which terminates with `{"type":"result","is_error":true,"subtype":"error_during_execution","result":""}`
- **the worker stays alive and serves the next request normally** (verified: sent a long count-to-100, interrupted at 1.5s, then sent `say PONG` → got `PONG` on the same process).

Supported control subtypes probed: `interrupt` ✓, `set_permission_mode` ✓, `set_model` ✓ (unreliable, see Q2), `mcp_message` ✓. Unsupported (return error): `clear`, `reset`, `new_session`, `compact`. **Consequence: the cancel-hook seam Phase 62 must expose is `interrupt` (protocol cancel, NOT SIGTERM+respawn).** SIGTERM+respawn remains the fallback path the WLIFE-04 abstraction can also expose, but interrupt is the primary, cheaper mechanism.

### Q4 — Quantify the spawn-only speedup; is ≤3s steady-state reachable? **VERDICT: MEASURED — warm avg ~991ms; ≤3s target comfortably met.** `[VERIFIED: empirical]`
Single persistent worker, sonnet, minimal `"say OK"`-class prompts, 5 sequential requests:

| Request | Wall (send→result) | `duration_api_ms` | input_tokens | cache_read |
|---|---|---|---|---|
| 1 (cold) | 3379 ms | 2046 | 138 | 0 |
| 2 (warm) | 917 ms | — | 155 | 0 |
| 3 (warm) | 940 ms | — | 172 | 0 |
| 4 (warm) | 887 ms | — | 189 | 0 |
| 5 (warm) | 1220 ms | — | 206 | 0 |
| **Warm avg (2-5)** | **991 ms** | | | |

Boot-to-first-init alone measured **2288 ms** — that's the cost eliminated on every warm call. Cold one-shot baseline (`execFile`-equivalent, fresh process) measured **4.35s wall / ~1.04s API** → the persistent worker removes ~2.3–3.3s of per-call overhead.

**Realistic-prompt run** (12 turns, ~400-token prompts) confirmed durability: latency stayed bounded **~1.7–2.9s** across all 12 turns, and **`cache_read` engaged** (grew 1395 → 5389 cached tokens) once prompts exceeded Anthropic's ~1024-token cache floor — so for the actual consolidator/observation-writer payload sizes, the prompt-cache warm benefit is real (it just doesn't show on the "say OK" probe). Either way, ≤3s steady-state holds.

**Caveat surfaced by Q4 testing — context accumulation (see Pitfall 1):** a persistent worker maintains conversation memory across requests (it recalled a secret told in a prior turn; `session_id` field on the stdin event is ignored, so per-request session isolation does NOT work). Input tokens grow each turn. This is bounded cost-wise by `cache_read` but is a **correctness hazard** (one caller's content sits in context for the next caller).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Direct OAuth completion (haiku, primary) | API/Backend (`completeClaudeCodeDirect`) | — | Untouched by Phase 62 (POOL-04); ~0.9s direct POST. |
| CLI-fallback completion (sonnet/opus on 429/401) | API/Backend (worker pool) | API/Backend (`completeClaudeCodeViaCLI` overflow) | Pool is the steady-state fast path; execFile is D-06 overflow + GUARD-01 escape. |
| Worker subprocess lifecycle (spawn/stdio framing) | API/Backend (new worker abstraction) | OS process (`claude` CLI subprocess) | Node owns spawn + JSON-Lines framing; CLI owns auth/model/API. |
| Request→worker routing, concurrency-1, keying | API/Backend (pool manager) | — | In-process router keyed by (model × prompt-hash) per D-01. |
| Cancellation propagation | API/Backend (cancel hook) | OS process (interrupt control_request) | Seam now (Phase 62), full client-disconnect wiring Phase 63. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` (`spawn`) | builtin (Node ≥18) | Long-lived `claude` subprocess with piped stdio | The CLI is a subprocess; `spawn` (not `execFile`) gives streaming stdin/stdout for the persistent session. No dependency. `[VERIFIED: empirical]` |
| `node:readline` *or* manual `\n` split | builtin | Frame JSON-Lines stdout into discrete events | stream-JSON is newline-delimited JSON; either readline-per-line or a manual buffer-split (used in all research probes) works. `[VERIFIED: empirical]` |
| `node:crypto` (`createHash`) | builtin | Compute the system-prompt-hash for the (model × prompt) worker key (D-01) | Stable key derivation; no dependency. `[ASSUMED — standard practice]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:test` + `node:assert` | builtin | Unit/integration tests for the pool (matches existing `tests/integration-bridge.test.mjs`) | Test runner already in use in `rapid-llm-proxy/tests`. `[VERIFIED: repo grep]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `spawn` + manual framing | `@anthropic-ai/claude-agent-sdk` (`ClaudeSDKClient`) | The SDK wraps exactly this protocol (`ClaudeSDKClient.query(prompt, session_id="default")` + `receive_response()` until `ResultMessage`). It would add a dependency and an abstraction layer the proxy doesn't need — the proxy already owns `buildClaudeEnv`, `cwd:'/tmp'`, and the exact flag set. **Recommendation: stay on raw `spawn`** for control + zero-dep, but the SDK confirms the protocol shape (envelope, `ResultMessage` boundary, `session_id` default) `[CITED: github.com/anthropics/claude-agent-sdk-python api-reference]`. |

**Installation:** None. All builtins. `proxy-bridge/server.mjs` already imports `child_process` (`execFile`, `execSync`); add `spawn`.

**Version verification:** Installed CLI confirmed `2.1.170 (Claude Code)` via `claude --version` `[VERIFIED: empirical]`. No npm packages introduced, so no registry/version drift risk.

## Package Legitimacy Audit

> **Not applicable — Phase 62 installs ZERO external packages.** The entire transport is Node builtins (`child_process`, `crypto`, `node:test`) plus the already-installed `/opt/homebrew/bin/claude` binary (resolved via `CLAUDE_CLI` env). slopcheck/registry verification is moot; no `npm install` step exists in this phase.

## Stream-JSON Protocol Reference (for the planner)

> All shapes below captured live from `claude 2.1.170`. This is the authoritative I/O contract the worker abstraction implements.

### Session-start args (translate the existing flag set verbatim)
```
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \                      # REQUIRED for stream-json to emit per-event lines
  --model <haiku|sonnet|opus> \    # boot-time, immutable — the per-model worker key (POOL-02/Q2)
  --tools '' \
  --no-session-persistence \
  --disable-slash-commands \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --setting-sources '' \
  --system-prompt '<boot system prompt>'   # boot-time, immutable — the prompt-hash key (D-01/Q1)
```
Spawn with `env: buildClaudeEnv()` (strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` to force Max OAuth) and `cwd:'/tmp'` (keeps the project breadcrumb out of the status-line tracker). These mirror `completeClaudeCodeViaCLI` exactly (server.mjs:1106-1134). Note: there is **no `--` prompt argument** in stream-json mode — the prompt arrives over stdin.
> **Note on `--verbose`:** stream-json output needs `--verbose` to emit the line-by-line event stream observed here; without it the CLI may collapse output. Confirmed present in all working probes.

### Request envelope (stdin, one JSON object per line, `\n`-terminated)
```json
{"type":"user","message":{"role":"user","content":"<the assembled user prompt>"}}
```
`[VERIFIED: empirical + CITED: anthropics/claude-agent-sdk-python]`. The system prompt is NOT sent here (Q1). Assemble `content` from the request the same way `completeClaudeCodeViaCLI` builds `userPrompt` (server.mjs:1080-1090): join user/assistant turns; system messages determine the worker key, not the message body. **Do NOT rely on `session_id` on this event for isolation — it is ignored (Q4 finding).**

### Response event sequence (stdout, JSON-Lines)
For each request the worker emits, in order:
1. `{"type":"system","subtype":"init",...}` — session/model echo (also emitted before *each* turn on a persistent worker; not a reliable per-request boundary on its own).
2. one or more `{"type":"assistant","message":{...,"content":[{"type":"text","text":"..."}],"usage":{...}}}` — incremental assistant content.
3. optional `{"type":"rate_limit_event","rate_limit_info":{...}}` — surfaces `status:"allowed"|...` and `rateLimitType` (e.g. `five_hour`).
4. **`{"type":"result","subtype":"success","is_error":false,"duration_ms":...,"result":"<assembled text>","usage":{...},"modelUsage":{...}}`** — the **end-of-response boundary** (POOL-03 frees the worker here).

### Token + content extraction (adapt server.mjs:1158-1168)
The `result` event mirrors the one-shot JSON shape, so the existing extraction logic ports almost directly:
- **content:** `result.result` (the assembled text) — same field name as the one-shot path.
- **token usage:** prefer `result.modelUsage` (e.g. `result.modelUsage["claude-sonnet-4-6"] = {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens}`), fall back to `result.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`. The existing summation `inputTokens = inputTokens + cacheRead + cacheCreation` (server.mjs:1165) applies unchanged.
- **model:** `Object.keys(result.modelUsage)[0]`.
- **error handling:** `result.is_error === true` → inspect `result.subtype` (`error_during_execution` = interrupted/aborted; map to the existing `client disconnected` semantics) and `result.result` for quota/auth strings (reuse the `QUOTA_EXHAUSTED`/`AUTH_ERROR` mapping from server.mjs:1147-1156).

### Cancellation envelope (the Phase 62 cancel-hook seam, full use Phase 63)
```json
{"type":"control_request","request_id":"<uuid>","request":{"subtype":"interrupt"}}
```
→ `{"type":"control_response","response":{"subtype":"success","request_id":"<uuid>"}}`, then the in-flight request resolves with `result.is_error:true, subtype:"error_during_execution"`. **Worker survives — no respawn.** `[VERIFIED: empirical]`

## Architecture Patterns

### System Architecture Diagram
```
            HTTP request (provider=claude-code)
                       │
                       ▼
            ┌──────────────────────────┐
            │   completeClaudeCode()    │  (dispatcher, server.mjs:1214 — single insertion point)
            └──────────────────────────┘
                       │
        LLM_PROXY_DISABLE_CLAUDE_DIRECT=1?
            │ no                    │ yes
            ▼                       ▼
   completeClaudeCodeDirect()   (skip direct)
   (POOL-04, unchanged)             │
            │                       │
   429/401 (shouldFallbackToCLI)?   │
            │ yes ─────────────────►┤
            ▼                       ▼
            ┌────────────────────────────────────────┐
            │  LLM_PROXY_DISABLE_WORKER_POOL=1 ?       │ (GUARD-01)
            └────────────────────────────────────────┘
              │ yes                         │ no
              ▼                             ▼
   completeClaudeCodeViaCLI()      ┌─────────────────────────┐
   (per-call execFile, today's     │   WORKER POOL ROUTER     │
    baseline, unchanged)           │  key = (model × prompt-  │
              ▲                     │        hash)  [D-01]     │
              │ overflow (D-06)     └─────────────────────────┘
              │ all workers busy            │
              │                  free worker? │ yes
              └──────────────────────────────┤
                                             ▼
                              ┌──────────────────────────────┐
                              │  Worker (persistent subprocess)│  concurrency-1 [POOL-03]
                              │  claude -p --input-format      │
                              │  stream-json ... --model M     │
                              │  --system-prompt <P>           │
                              │   stdin:  {type:"user",...}\n  │
                              │   stdout: ...{type:"result"}   │ ◄── end-of-response boundary
                              │   cancel: control_request      │
                              │           {subtype:"interrupt"}│
                              └──────────────────────────────┘
```

### Recommended Project Structure (Claude's discretion — D-disc)
```
proxy-bridge/
├── server.mjs            # dispatcher edit: pool engaged at the two completeClaudeCodeViaCLI call sites
└── worker-pool.mjs       # NEW (recommended): ClaudeWorker class + WorkerPool router
                          #   - ClaudeWorker: spawn, write(req)→Promise<result>, cancel(), on('exit'), boot args
                          #   - WorkerPool: Map<key, ClaudeWorker[]>, key=(model×promptHash), LRU cap (D-02),
                          #                 acquire()/release(), overflow→completeClaudeCodeViaCLI (D-06)
```
A separate `worker-pool.mjs` is recommended over inlining: it isolates the stdio framing (high test surface) and gives Phase 63/64 a clean extension point. server.mjs is already 1800+ lines.

### Pattern 1: One-promise-per-request over a persistent pipe
**What:** Each `write(request)` returns a Promise resolved when the matching `{type:"result"}` arrives. Because concurrency is 1 (POOL-03), there is at most one outstanding promise per worker — no request-id correlation needed (the CLI does not echo a caller-supplied id on `result`). Buffer stdout, split on `\n`, parse each line, resolve on `result`.
**When to use:** Always — this is the core worker loop.
**Example:**
```javascript
// Source: research probe (this session), distilled
write(content) {
  return new Promise((resolve, reject) => {
    this._pending = { resolve, reject };          // exactly one (concurrency-1)
    const msg = { type: 'user', message: { role: 'user', content } };
    this._proc.stdin.write(JSON.stringify(msg) + '\n');
  });
}
// in the stdout '\n'-split loop:
if (ev.type === 'result') {
  const p = this._pending; this._pending = null;
  if (ev.is_error) p.reject(mapResultError(ev));  // reuse QUOTA/AUTH mapping
  else p.resolve(toCompletion(ev));               // {content, model, tokens}
  this._markFree();                                // POOL-03: worker available again
}
```

### Pattern 2: Worker key = model + prompt-hash (D-01)
```javascript
import { createHash } from 'node:crypto';
const key = `${resolveClaudeModel(body.model || 'sonnet')}::${createHash('sha256').update(systemPrompt || 'You are a helpful assistant.').digest('hex').slice(0,16)}`;
```
The default-prompt callers and the consolidator/observation-writer custom-prompt callers naturally land in 3-ish stable buckets (D-02/D-04); LRU-evict beyond the cap.

### Anti-Patterns to Avoid
- **Relying on `session_id` for per-request isolation:** ignored in stdin stream-json mode (Q4). Context accumulates regardless — handle via worker recycling, not session ids.
- **Using `set_model` to repurpose a worker for another model:** returns `success` but is inconsistent (Q2). Always boot a fresh per-model worker.
- **Sending the system prompt per request:** ignored (Q1). It must be a boot flag and is part of the worker key.
- **Dropping `--verbose`:** stream-json needs it to emit per-event lines.
- **Treating `system/init` as the response boundary:** it fires per turn; only `result` is the end-of-response marker.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Streaming JSON session to the CLI | A bespoke wire protocol or PTY wrapper | The CLI's native `--input-format stream-json --output-format stream-json` | First-class, documented in the Agent SDK; emits the `result` boundary + token usage for free. |
| Conversation/auth/cache warming | Custom session cache or token refresh in the worker | Let the CLI own auth (Max OAuth via keychain), prompt cache, and session state | `buildClaudeEnv()` already forces OAuth; the CLI rotates the keychain blob. The worker just frames I/O. |
| Cancellation | SIGTERM + respawn as the primary cancel path | `control_request {subtype:"interrupt"}` (worker survives) | Protocol cancel is cheaper and keeps the warm worker alive (Q3). SIGTERM is the fallback only. |
| End-of-response detection | Timers / heuristic "looks done" parsing | The `{type:"result"}` event | Unambiguous, carries final usage. |

**Key insight:** Phase 62 is a *transport + routing* layer over an existing, capable CLI protocol. The temptation is to over-build session management; the CLI already owns auth, model, cache, and conversation state. The worker's only jobs are: spawn with the right flags, frame JSON-Lines, enforce concurrency-1, key by (model×prompt), and expose `cancel()`.

## Runtime State Inventory

> Not a rename/refactor/migration phase — this is net-new code behind an env gate. The closest analog is **process lifecycle state**, captured here for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore touched. | None — verified: pool is in-memory only. |
| Live service config | None new in git. The two new env vars (`LLM_PROXY_DISABLE_WORKER_POOL`, the pool-size knob) are read at runtime, not persisted. | Document the env vars in the proxy README / launchd wrapper (`_work/rapid-llm-proxy/bin/start-llm-proxy.sh`) — but that wiring is operator-facing, not Phase 62 code. |
| OS-registered state | **Worker subprocesses** — persistent `claude -p` children of the proxy process. On proxy SIGTERM/restart these must be reaped (avoid orphans). | Worker abstraction must register exit/cleanup so proxy shutdown drains workers. (Crash-recovery is Phase 63; basic reap-on-exit belongs in 62.) `com.coding.llm-cli-proxy` launchd job manages the parent. |
| Secrets/env vars | Reuses Max OAuth via keychain (`buildClaudeEnv` strips API keys). No new secret. | None. |
| Build artifacts | None — `server.mjs`/`worker-pool.mjs` are plain `.mjs`, no transpile step for proxy-bridge (the parent repo's `tsc` build is for the TS SDK, not this file). | None. |

## Common Pitfalls

### Pitfall 1: Conversation context accumulates across requests on a persistent worker
**What goes wrong:** A persistent worker treats each `{type:"user"}` as the next turn of an ongoing conversation — it remembers prior requests' content (empirically: recalled a "secret word" set in an earlier request). Two consequences: (a) **cross-call data leakage** — caller B's request sees caller A's content in context; (b) **unbounded context growth** — input tokens climb each turn.
**Why it happens:** stdin stream-json mode keeps one session; `session_id` on the event is ignored; there is no `clear`/`reset`/`new_session` control subtype (all return "Unsupported").
**How to avoid:** Bound a worker's lifetime by **request count and/or context size**, and recycle (drain + respawn) when exceeded — a cheap "fresh context" reset. For Phase 62 a simple **max-requests-per-worker recycle** (e.g. recycle after N turns or when `result.usage.input_tokens` exceeds a threshold) is sufficient; the LRU/idle-evict machinery in Phase 63 generalizes it. Document the leakage risk so callers never assume statelessness within a worker's life.
**Warning signs:** `input_tokens` in the `result` event climbing call-over-call; latency drift on a long-lived worker; a response that references a prior unrelated request.

### Pitfall 2: Wrong-model worker silently serves the wrong model
**What goes wrong:** A request mis-routed to a worker booted with a different `--model` gets answered by the boot model with **no error** (Q2).
**Why it happens:** `--model` is boot-immutable; per-message/`set_model` overrides don't reliably take effect, and the CLI doesn't reject the mismatch.
**How to avoid:** The router MUST key strictly by `resolveClaudeModel(body.model)` and never reuse a worker across models. Add a test asserting a sonnet request is never handed a haiku-booted worker (and vice versa).
**Warning signs:** `result.modelUsage` key ≠ the requested model.

### Pitfall 3: stdout pipe backpressure / unparsed partial lines
**What goes wrong:** Large responses arrive as multiple `data` chunks; naive `JSON.parse(chunk)` throws on partial lines; an undrained stderr pipe can block the subprocess.
**Why it happens:** JSON-Lines events span chunk boundaries; OS pipe buffers are finite.
**How to avoid:** Buffer stdout and split on `\n`, parsing complete lines only (the pattern used in every research probe). **Continuously drain stderr** even in Phase 62 (full throttling is GUARD-03/Phase 64, but an undrained stderr pipe will eventually stall a long-lived worker — drain-and-discard now, throttle-and-log later).
**Warning signs:** `JSON.parse` errors on truncated lines; a worker that hangs after a verbose response.

### Pitfall 4: Cold-spawn penalty counted against the steady-state target
**What goes wrong:** The first request to a freshly-spawned worker is ~3.4s (boot-dominated); measuring PERF-01 against a cold call fails the ≤3s gate.
**Why it happens:** Boot-to-first-init is ~2.3s; the spec explicitly allows cold first-spawn to be ~10s.
**How to avoid:** PERF-01 (Phase 65) measures **warm** steady-state. For Phase 62's own tests, send a warm-up request first, then assert ≤3s on the second.
**Warning signs:** Intermittent test failures correlated with worker freshness.

## Code Examples

### Inserting the pool at the dispatcher (server.mjs:1214-1231, GUARD-01 + D-06)
```javascript
// Source: server.mjs current dispatcher, extended for Phase 62
async function completeClaudeCode(body, clientAbortSignal) {
  const poolDisabled = process.env.LLM_PROXY_DISABLE_WORKER_POOL === '1';   // GUARD-01

  // Helper: pool-or-overflow for the CLI-fallback path
  const viaCliPath = (b, sig) =>
    poolDisabled ? completeClaudeCodeViaCLI(b, sig)
                 : workerPool.complete(b, sig, /* overflow */ completeClaudeCodeViaCLI); // D-06

  if (process.env.LLM_PROXY_DISABLE_CLAUDE_DIRECT === '1') {  // D-08 row 3 / 4
    return viaCliPath(body, clientAbortSignal);
  }
  try {
    return await completeClaudeCodeDirect(body, clientAbortSignal);          // POOL-04 unchanged
  } catch (err) {
    if (err && err.shouldFallbackToCLI) {
      log(`claude-code: direct API fallback; routing via ${poolDisabled ? 'execFile' : 'worker pool'}`);
      return viaCliPath(body, clientAbortSignal);                            // pool is the fast path
    }
    throw err;
  }
}
```

### Boot args helper (reuse the existing flag set verbatim)
```javascript
// Source: server.mjs:1106-1120 context-stripping flags, ported to session-start
function workerBootArgs(model, systemPrompt) {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,                                   // boot-immutable (POOL-02)
    '--tools', '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '',
    '--system-prompt', systemPrompt || 'You are a helpful assistant.', // boot-immutable (D-01)
  ];
}
// spawn(CLAUDE_CLI, workerBootArgs(model, sp), { env: buildClaudeEnv(), cwd: '/tmp', stdio: ['pipe','pipe','pipe'] })
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `execFile` per call (cold spawn each time) | Persistent stream-JSON worker pool | This milestone (v7.3) | ~3.4s → ~1s warm; spawn cost amortized. |
| "Keep cache_creation warm" as the main lever (seed rationale) | **Spawn-elimination is the dominant lever**; cache_read only helps for ≥1024-token prompts | Reframed by codebase scout + confirmed here | For the "say OK" probe, cache contributes 0; for real consolidator prompts cache_read does engage. Either way ≤3s holds. |

**Deprecated/outdated:**
- The seed's expected-speedup table attributing ~1500-2500ms to `cache_creation` per call: **partly stale** — the minimal `--system-prompt` already eliminated the giant Claude Code system prompt, so cache_creation on the proxy's small prompts is ~0. The real win is the ~2.3s boot, not cache.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `node:crypto` SHA-256 is the right hash for the prompt key | Standard Stack / Pattern 2 | None material — any stable hash works; planner's discretion. |
| A2 | A max-requests/context-size recycle is sufficient context-isolation for Phase 62 (full lifecycle in 63) | Pitfall 1 | If callers depend on strict per-request statelessness sooner, the recycle threshold needs to be aggressive (e.g. recycle every request = lose the warm benefit). Validate against real consolidator traffic; flag to discuss-phase. |
| A3 | The CLI does not echo a caller-supplied request id on the `result` event, so concurrency-1 needs no id correlation | Pattern 1 | Low — concurrency-1 makes correlation unnecessary regardless. |
| A4 | `--verbose` remains required for stream-json line emission in future CLI versions | Protocol Reference | Low for Phase 62 (pinned to 2.1.170); GUARD-02/Phase 64 handles version drift. |

## Open Questions

1. **Context-isolation policy for Phase 62 vs 63** — How aggressively should a worker recycle to bound the cross-call leakage (Pitfall 1)?
   - What we know: no in-session reset exists; recycle (respawn) is the only reset; warm benefit is lost if recycle is per-request.
   - What's unclear: the acceptable leakage/cost tradeoff for the actual consolidator/observation-writer payloads.
   - Recommendation: Phase 62 ships a conservative max-requests-per-worker recycle (e.g. 50) AND documents the leakage; Phase 63 tunes it with idle-evict. Surface to discuss-phase if the planner wants a tighter default.

2. **Pool-size and prompt-pool-cap env-var names** (D-05/D-02 — planner's discretion) — suggest `LLM_PROXY_WORKER_POOL_SIZE` (per-key worker count) and `LLM_PROXY_WORKER_PROMPT_CAP` (LRU prompt-pool cap). Names are non-load-bearing.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI | Every worker subprocess | ✓ | 2.1.170 (Claude Code) | None needed — same binary the execFile path uses (`CLAUDE_CLI`). |
| Node.js (`spawn`, `node:test`) | Worker transport + tests | ✓ | (proxy already runs on Node ≥18) | None. |
| Max OAuth keychain entry (`Claude Code-credentials`) | Worker auth via `buildClaudeEnv` | ✓ (used by existing direct + CLI paths) | — | CLI's own keychain refresh. |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

> nyquist_validation key absent in config.json → treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (matches `tests/integration-bridge.test.mjs`); jest available for TS but the worker code is `.mjs` |
| Config file | none — `node --test` / direct `node tests/*.test.mjs` invocation |
| Quick run command | `node --test tests/unit/worker-pool.test.mjs` (Wave 0 — file to create) |
| Full suite command | `cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && node --test tests/` (+ existing `npm test` jest TS suite) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POOL-01 | Persistent worker serves ≥2 sequential requests without respawn (stable PID/session) | integration (live CLI) | `node --test tests/integration/worker-pool-live.test.mjs` | ❌ Wave 0 |
| POOL-01 | `{type:"result"}` parsed → `{content,model,tokens}` from a mock stdout stream | unit | `node --test tests/unit/worker-pool.test.mjs` | ❌ Wave 0 |
| POOL-02 | Router never hands a sonnet request to a haiku-booted worker; per-model keying | unit | `node --test tests/unit/worker-pool.test.mjs` | ❌ Wave 0 |
| POOL-03 | Concurrency-1: second same-worker request waits for `result` or hits a sibling; never interleaved | unit (fake clock + mock stdio) | `node --test tests/unit/worker-pool.test.mjs` | ❌ Wave 0 |
| POOL-03/D-06 | All-workers-busy → overflow calls `completeClaudeCodeViaCLI` (spy) | unit | `node --test tests/unit/worker-pool.test.mjs` | ❌ Wave 0 |
| POOL-04 | A haiku probe via the direct path never spawns a worker | integration | `node --test tests/integration/worker-pool-live.test.mjs` | ❌ Wave 0 |
| GUARD-01 | `LLM_PROXY_DISABLE_WORKER_POOL=1` → dispatcher calls execFile path; no worker spawned; response shape == baseline | integration | `node --test tests/integration/worker-pool-live.test.mjs` | ❌ Wave 0 |
| Cancel seam | `cancel()` emits `control_request{interrupt}`; worker survives + serves next request | integration (live CLI) | `node --test tests/integration/worker-pool-live.test.mjs` | ❌ Wave 0 |
| (warm perf sanity) | warm 2nd request < 3s (cold excluded) — informal sanity, formal gate is PERF-01/Phase 65 | integration | `node --test tests/integration/worker-pool-live.test.mjs` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test tests/unit/worker-pool.test.mjs` (mock-stdio unit tests, no LLM, <5s)
- **Per wave merge:** `cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && node --test tests/` (includes live integration — needs Max OAuth + network)
- **Phase gate:** full suite green + a manual warm/cold latency spot-check before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/worker-pool.test.mjs` — covers POOL-01 (result parsing), POOL-02 (keying), POOL-03 (concurrency-1 + overflow). Use mock stdin/stdout streams (no real CLI) for determinism.
- [ ] `tests/integration/worker-pool-live.test.mjs` — covers POOL-01 (real persistent worker, stable PID), POOL-04 (no-spawn on direct), GUARD-01 (escape hatch), cancel seam. Gate behind a `--live`-style flag like `integration-bridge.test.mjs` so CI without OAuth can skip.
- [ ] Shared test helper to mock a `claude` worker stdio stream (emit `system/init` → `assistant` → `result` lines) — reused across unit tests.

## Security Domain

> `security_enforcement` absent in config → treated as enabled. Scope is narrow (local subprocess, no new network surface, no new secrets).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Auth unchanged — Max OAuth via keychain, `buildClaudeEnv` strips API keys (existing). |
| V3 Session Management | yes (informational) | Worker conversation state is NOT a security boundary but a **data-isolation** concern (Pitfall 1) — recycle workers to prevent one caller's content persisting into another's context. |
| V4 Access Control | no | Proxy is localhost-bound (`0.0.0.0:12435`); no new endpoints. |
| V5 Input Validation | yes | The user prompt is JSON-encoded into the `{type:"user"}` envelope (`JSON.stringify`) — no shell interpolation (unlike `--` arg passing in execFile). This is **safer** than the execFile path: no risk of prompt content being parsed as CLI flags. |
| V6 Cryptography | no | SHA-256 for the prompt key is a non-security hash (collision-resistance for keying only). |

### Known Threat Patterns for {Node subprocess pool}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-call context leakage (caller A's prompt visible to caller B on a shared worker) | Information Disclosure | Worker recycling by request-count/context-size (Pitfall 1); document non-statelessness within a worker life. |
| Orphaned worker subprocesses on proxy crash | Denial of Service (RAM) | Reap workers on proxy exit; lazy-spawn + idle-evict (Phase 63). |
| Prompt content interpreted as CLI flags | Tampering | N/A in stream-json mode — prompt travels as JSON over stdin, never as an argv (improvement over the execFile `--` path). |
| Unbounded prompt-pool fragmentation (RAM exhaustion via many distinct system prompts) | Denial of Service | LRU prompt-pool cap (D-02). |

## Sources

### Primary (HIGH confidence)
- **Empirical CLI probes (this session)** — `claude 2.1.170`, direct `spawn` + JSON-Lines stdio: answered Q1 (per-msg system prompt = NO), Q2 (model boot-locked, mis-route silent), Q3 (interrupt cancel = YES, survives), Q4 (warm ~991ms / cold ~3.4s; cache_read engages ≥1024 tokens; context accumulates). All reproducible.
- `claude --help` / `claude --version` — confirmed `--input-format/--output-format stream-json`, `--system-prompt`, `--model`, `--verbose`, `--include-partial-messages`, `--replay-user-messages`, and the full context-stripping flag set.
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — `completeClaudeCode` dispatcher (1214), `completeClaudeCodeViaCLI` (1071), `completeClaudeCodeDirect` (949), `buildClaudeEnv` (401), `CLAUDE_CLI` (395), `resolveClaudeModel` (531), token extraction (1158-1168).
- `.planning/research/v7.2-llm-proxy-perf-worker-pool.md`, `.planning/REQUIREMENTS.md` (v7.3), `.planning/ROADMAP.md` (Phase 62 success criteria), `.planning/phases/62-.../62-CONTEXT.md`.

### Secondary (MEDIUM confidence)
- Context7 `/anthropics/claude-agent-sdk-python` (api-reference/query.md, client.md) — confirms the `{type:"user","message":{role,content}}` envelope, that streaming sessions share conversation state, `session_id` default `"default"`, and `ResultMessage` as the receive boundary. Aligns 1:1 with the empirical findings.

### Tertiary (LOW confidence)
- None relied upon.

## Metadata

**Confidence breakdown:**
- Stream-JSON protocol + Q1-Q4 verdicts: **HIGH** — driven empirically against the exact installed CLI, cross-confirmed by the Agent SDK docs.
- Standard stack: **HIGH** — zero dependencies; all Node builtins already in use.
- Architecture / insertion points: **HIGH** — line-accurate against current server.mjs.
- Pitfalls (esp. context accumulation): **HIGH** — reproduced directly.
- Pool-size / recycle-threshold defaults: **MEDIUM** — sound starting points; need tuning against real traffic (Phase 63/65).

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 for stack/architecture; **protocol findings pinned to `claude 2.1.170`** — re-verify on CLI upgrade (GUARD-02/Phase 64 makes drift-detection a first-class concern).

## RESEARCH COMPLETE
