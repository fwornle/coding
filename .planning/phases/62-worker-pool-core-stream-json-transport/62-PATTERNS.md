# Phase 62: Worker Pool Core & stream-JSON Transport - Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 4 (1 new module, 1 dispatcher edit, 2 new test files)
**Analogs found:** 4 / 4

All analogs live in a single file: `_work/rapid-llm-proxy/proxy-bridge/server.mjs` (the `claude-code` provider, ~1800 lines). This is a net-new transport+routing layer behind an env gate — there is no pre-existing persistent-subprocess pool in the repo, so the "closest analog" for the new worker module is the per-call `execFileAsync` path it sits beside (`completeClaudeCodeViaCLI`), which already owns every flag, env, and token-extraction concern the worker must replicate.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `proxy-bridge/worker-pool.mjs` (NEW) | service / worker-manager module (`ClaudeWorker` + `WorkerPool`) | streaming (persistent stdio session) | `completeClaudeCodeViaCLI()` (`server.mjs:1071-1201`) — same boot flags / env / cwd / token extraction, but `execFile` one-shot vs `spawn` persistent | role-match (no existing persistent-pool analog; one-shot spawn is the template) |
| `proxy-bridge/server.mjs` (dispatcher edit) | dispatcher / router | request-response | `completeClaudeCode()` (`server.mjs:1214-1231`) — the file being edited; its own current body is the template | exact (in-place extension) |
| `proxy-bridge/tests/unit/worker-pool.test.mjs` (NEW) | test (unit, mock stdio) | event-driven (mock streams) | `tests/integration-bridge.test.mjs` mock block (`:158-514`) + `node:test`/`assert/strict` house style | role-match |
| `proxy-bridge/tests/integration/worker-pool-live.test.mjs` (NEW) | test (integration, live CLI) | request-response (live subprocess) | `tests/integration-bridge.test.mjs` `--live`/`--smoke` gating (`:20-35`, `:515-616`) | role-match |

**Config knobs (not separate files):** the two new env vars (`LLM_PROXY_DISABLE_WORKER_POOL`, the pool-size knob e.g. `LLM_PROXY_WORKER_POOL_SIZE`, and an LRU cap e.g. `LLM_PROXY_WORKER_PROMPT_CAP`) are read inline via `process.env`. Their analog is the existing `LLM_PROXY_DISABLE_CLAUDE_DIRECT` read at `server.mjs:1215` — see Shared Patterns § Escape-hatch-via-env.

## Pattern Assignments

### `proxy-bridge/worker-pool.mjs` (NEW — worker-manager service, streaming)

**Analog:** `completeClaudeCodeViaCLI()` — `server.mjs:1071-1201`

This is the load-bearing analog. The worker MUST replicate the analog's boot flags, env, cwd, and token-extraction verbatim (changing only one-shot `execFile` → persistent `spawn` + JSON-Lines framing). Every excerpt below is something the executor copies or respects.

**Imports the module needs** (`server.mjs:29-38` shows what the parent already imports; the worker adds `spawn` + `createHash`):
```javascript
// server.mjs:33 — only execFile/execSync imported today; worker adds spawn:
import { execFile, execSync } from 'node:child_process';
// NEW in worker-pool.mjs:
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
```
RESEARCH §"Installation" confirms zero new npm deps — `spawn` + `crypto` are builtins. The worker should NOT re-implement auth/model mapping; it imports/receives `CLAUDE_CLI`, `buildClaudeEnv`, `resolveClaudeModel` (see Shared Patterns).

**Boot-args pattern — translate VERBATIM** (`server.mjs:1106-1122`). This is the single most important excerpt: the comment at `:1102-1105` measures that omitting these flags burns 14.8K input tokens vs ~130 with them. The worker's session-start argv must carry the same flags, swapping `--output-format json` → `--input-format stream-json --output-format stream-json --verbose` and DROPPING the trailing `--`/prompt (the prompt arrives over stdin, not argv):
```javascript
// server.mjs:1106-1122 (one-shot) — what the worker boot-args MUST mirror:
const args = [
  '-p',
  '--output-format', 'json',          // worker: 'stream-json' + add --input-format stream-json + --verbose
  '--model', model,                   // boot-immutable — the per-model key (POOL-02 / Q2)
  '--tools', '',                              // disable tool definitions
  '--no-session-persistence',                 // don't persist
  '--disable-slash-commands',                 // skip skill resolution
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', // no MCP tool defs
  '--setting-sources', '',                    // skip hooks/auto-memory/CLAUDE.md
];
// Always pass --system-prompt (boot-immutable — the prompt-hash key, D-01/Q1):
args.push('--system-prompt', systemPrompt || 'You are a helpful assistant.');
args.push('--', userPrompt);   // <-- worker OMITS this line: stream-json takes prompt via stdin
```
RESEARCH §"Session-start args" gives the exact worker variant (adds `--verbose`, no `--` prompt). RESEARCH §"Boot args helper" code sketch (`workerBootArgs(model, systemPrompt)`) is the recommended shape.

**Spawn env + cwd + abort — replicate** (`server.mjs:1125-1138`). The worker `spawn` call reuses `buildClaudeEnv()` and `cwd:'/tmp'` for the SAME reasons documented inline (force Max OAuth; keep the project breadcrumb out of the status-line tracker). The `signal: clientAbortSignal` line is the analog for the per-request cancel seam — but a persistent worker CANNOT be SIGTERM'd per request, so this is the seam that changes to a `cancel()` method emitting an interrupt control_request (see below):
```javascript
// server.mjs:1125-1138 — env/cwd reused as-is; signal seam becomes cancel():
const { stdout, stderr } = await execFileAsync(CLAUDE_CLI, args, {
  timeout: timeoutMs,
  env: buildClaudeEnv(),       // worker: spawn(CLAUDE_CLI, bootArgs, { env: buildClaudeEnv(),
  maxBuffer: 10 * 1024 * 1024,
  cwd: '/tmp',                 //          cwd: '/tmp', stdio: ['pipe','pipe','pipe'] })
  signal: clientAbortSignal,   // <-- per-request SIGTERM; worker replaces with cancel() → interrupt
});
```

**Error → typed-error mapping — reuse** (`server.mjs:1147-1156`). The stream-JSON `{type:"result", is_error:true}` path must reuse this exact QUOTA_EXHAUSTED / AUTH_ERROR string mapping so the dispatcher's downstream handling is unchanged:
```javascript
// server.mjs:1147-1156 — reuse for result.is_error===true:
if (output.is_error) {
  const errMsg = output.result || 'Unknown CLI error';
  if (errMsg.toLowerCase().includes('credit balance') || errMsg.toLowerCase().includes('rate limit')) {
    throw new Error(`QUOTA_EXHAUSTED: ${errMsg}`);
  }
  if (errMsg.toLowerCase().includes('not logged in') || errMsg.toLowerCase().includes('login')) {
    throw new Error(`AUTH_ERROR: ${errMsg}`);
  }
  throw new Error(`Claude CLI error: ${errMsg}`);
}
```
RESEARCH §"Token + content extraction" note: also map `result.subtype === 'error_during_execution'` (interrupted/aborted) to the existing `client disconnected` semantics from `server.mjs:1185-1187`.

**Token + content extraction — port directly** (`server.mjs:1158-1178`). The stream-JSON `result` event mirrors the one-shot JSON shape, so this block ports almost unchanged (the summation `inputTokens + cacheRead + cacheCreation` at `:1165` applies as-is):
```javascript
// server.mjs:1158-1178 — port to consume the {type:"result"} event:
let inputTokens = output.usage?.input_tokens || 0;
let outputTokens = output.usage?.output_tokens || 0;
if (output.modelUsage) {
  const modelEntry = Object.values(output.modelUsage)[0];
  if (modelEntry) {
    inputTokens = modelEntry.inputTokens + (modelEntry.cacheReadInputTokens || 0) + (modelEntry.cacheCreationInputTokens || 0);
    outputTokens = modelEntry.outputTokens;
  }
}
return {
  content: output.result,                              // result.result on the stream-JSON event
  model: Object.keys(output.modelUsage || {})[0] || model,
  tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
};
```
This `{content, model, tokens:{input,output,total}}` is the RETURN CONTRACT the worker MUST produce so the dispatcher and `completeClaudeCodeViaCLI` overflow path are interchangeable (D-06).

**Core worker loop — one-promise-per-request** (RESEARCH §"Pattern 1", distilled from research probe; no in-file analog because no persistent pipe exists today):
```javascript
write(content) {
  return new Promise((resolve, reject) => {
    this._pending = { resolve, reject };          // exactly one (concurrency-1, POOL-03)
    const msg = { type: 'user', message: { role: 'user', content } };
    this._proc.stdin.write(JSON.stringify(msg) + '\n');
  });
}
// stdout '\n'-split loop: on ev.type === 'result' → resolve/reject + mark worker free.
```

**Cancel-hook seam — interrupt control_request** (RESEARCH §"Cancellation envelope" + §Q3; the seam REPLACES the `signal:` line at `:1138`). Expose `cancel()` now even though full client-disconnect wiring is Phase 63:
```javascript
// worker survives — interrupt, NOT SIGTERM+respawn (Q3 VERIFIED):
{"type":"control_request","request_id":"<uuid>","request":{"subtype":"interrupt"}}
```

**Worker key derivation** (RESEARCH §"Pattern 2"; uses `resolveClaudeModel` from `server.mjs:531`):
```javascript
const key = `${resolveClaudeModel(body.model || 'sonnet')}::${createHash('sha256').update(systemPrompt || 'You are a helpful assistant.').digest('hex').slice(0,16)}`;
```

**Prompt assembly — mirror** (`server.mjs:1076-1091`). The worker assembles `content` (user turns) and derives the worker-key `systemPrompt` (system turns) the SAME way the one-shot path splits messages — the difference is system parts feed the key, not the message body (Q1):
```javascript
// server.mjs:1076-1091 — split system vs user; system → worker key, user → stdin content:
for (const m of messages) {
  if (m.role === 'system') systemParts.push(m.content);
  else if (m.role === 'assistant') userParts.push(`Assistant: ${m.content}`);
  else userParts.push(m.content);
}
const userPrompt = userParts.join('\n\n');
const systemPrompt = systemParts.length > 0 ? systemParts.join('\n\n') : null;
```

**Respects (Pitfalls — RESEARCH §"Common Pitfalls"):**
- Buffer stdout, split on `\n`, parse complete lines only; continuously drain stderr (Pitfall 3) — no in-file analog (the one-shot `execFile` buffers the whole output; the persistent worker must stream-frame).
- Recycle worker by max-requests/context-size to bound cross-call context leakage (Pitfall 1) and reap on exit (Runtime State Inventory).

---

### `proxy-bridge/server.mjs` — `completeClaudeCode()` dispatcher edit (request-response)

**Analog:** the function's own current body — `server.mjs:1214-1231` (exact, in-place extension).

**Current dispatcher** (the two `completeClaudeCodeViaCLI(...)` call sites at `:1216` and `:1227` are the insertion points — POOL-04 / GUARD-01 / D-06 all land here):
```javascript
// server.mjs:1214-1231 (current):
async function completeClaudeCode(body, clientAbortSignal) {
  if (process.env.LLM_PROXY_DISABLE_CLAUDE_DIRECT === '1') {
    return completeClaudeCodeViaCLI(body, clientAbortSignal);            // <-- call site #1 (:1216)
  }
  try {
    return await completeClaudeCodeDirect(body, clientAbortSignal);      // POOL-04 — stays unchanged
  } catch (err) {
    if (err && err.shouldFallbackToCLI) {
      const msg = err.message || '';
      const reason = msg.startsWith('RATE_LIMITED') ? 'rate-limited'
                   : msg.startsWith('AUTH_ERROR')   ? 'auth-error'
                   : 'unknown';
      log(`claude-code: direct API ${reason} (...); falling back to CLI ...`);
      return completeClaudeCodeViaCLI(body, clientAbortSignal);          // <-- call site #2 (:1227)
    }
    throw err;
  }
}
```

**Edit pattern** (RESEARCH §"Inserting the pool at the dispatcher"). Introduce a `viaCliPath` helper that reads `LLM_PROXY_DISABLE_WORKER_POOL` (GUARD-01) and routes either to the pool (passing `completeClaudeCodeViaCLI` as the D-06 overflow callback) or straight to the unchanged execFile path; replace BOTH call sites with it. `completeClaudeCodeDirect()` at `:1219` is NOT touched (POOL-04). The orthogonal truth table is CONTEXT.md §D-08:
```javascript
const poolDisabled = process.env.LLM_PROXY_DISABLE_WORKER_POOL === '1';   // GUARD-01
const viaCliPath = (b, sig) =>
  poolDisabled ? completeClaudeCodeViaCLI(b, sig)
               : workerPool.complete(b, sig, /* overflow */ completeClaudeCodeViaCLI); // D-06
```

**Trigger to respect:** `err.shouldFallbackToCLI` (set at `server.mjs:953`, `:1013`, `:1026` inside `completeClaudeCodeDirect`) is the existing 429/401 gate that fires pool creation (D-07) — the edit keeps this branch, only swapping what the fallback calls.

---

### `proxy-bridge/tests/unit/worker-pool.test.mjs` (NEW — unit, mock stdio)

**Analog:** `tests/integration-bridge.test.mjs` mock block (`:158-514`) + the house test stack.

**Test stack pattern** (`tests/integration-bridge.test.mjs:31-32`) — `node:test` + `assert/strict`, run via `node --test`:
```javascript
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
```
**Covers (RESEARCH §"Test Map" / §"Wave 0 Gaps"):** POOL-01 (`{type:"result"}` parsed → `{content,model,tokens}` from a mock stdout stream), POOL-02 (router never hands a sonnet request to a haiku-booted worker — keying), POOL-03 (concurrency-1 + all-busy → overflow calls a `completeClaudeCodeViaCLI` spy, D-06). Use mock stdin/stdout streams (no real CLI) for determinism. Build a shared helper that emits `system/init` → `assistant` → `result` lines (RESEARCH §Wave 0 third bullet).
**Quick run:** `node --test tests/unit/worker-pool.test.mjs`.

---

### `proxy-bridge/tests/integration/worker-pool-live.test.mjs` (NEW — integration, live CLI)

**Analog:** `tests/integration-bridge.test.mjs` `--live`/`--smoke` gating (`:20-35` header + `:35` mode switch + `:515-616` live block).

**Live-gating pattern** (`tests/integration-bridge.test.mjs:35`) — gate behind an argv flag so CI without Max OAuth skips:
```javascript
const MODE = process.argv.includes('--live') ? 'live'
           : process.argv.includes('--smoke') ? 'smoke'
           : 'mock';
// ... later:  if (MODE === 'live' || MODE === 'smoke') { describe(...) }   // :517
```
**Covers (RESEARCH §"Test Map"):** POOL-01 (real persistent worker, stable PID/session across ≥2 sequential requests), POOL-04 (a haiku probe via the direct path never spawns a worker), GUARD-01 (`LLM_PROXY_DISABLE_WORKER_POOL=1` → execFile path, no spawn, response shape == baseline), cancel seam (`cancel()` emits `control_request{interrupt}`; worker survives + serves next request), warm-2nd-request < 3s sanity (cold excluded — Pitfall 4: send a warm-up first).
**Full run:** `cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && node --test tests/`.

---

## Shared Patterns

### Escape-hatch-via-env (house style)
**Source:** `server.mjs:1215` — `if (process.env.LLM_PROXY_DISABLE_CLAUDE_DIRECT === '1')`
**Apply to:** the dispatcher edit (new `LLM_PROXY_DISABLE_WORKER_POOL` gate) and the pool-size / prompt-cap knobs.
```javascript
// server.mjs:1215 — the established pattern the new gate mirrors (=== '1', read at call time):
if (process.env.LLM_PROXY_DISABLE_CLAUDE_DIRECT === '1') { ... }
```
D-08: the new gate is ORTHOGONAL to this one — do not couple them; the truth table in CONTEXT.md §D-08 is the spec. Suggested non-load-bearing names (RESEARCH §Open-Q 2): `LLM_PROXY_WORKER_POOL_SIZE`, `LLM_PROXY_WORKER_PROMPT_CAP`.

### Claude CLI binary + clean env (force Max OAuth)
**Source:** `server.mjs:395` (`CLAUDE_CLI`) + `server.mjs:401-406` (`buildClaudeEnv`)
**Apply to:** every worker `spawn` call.
```javascript
// server.mjs:395
const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || '/opt/homebrew/bin/claude';
// server.mjs:401-406 — strips API keys so the CLI uses keychain Max OAuth:
function buildClaudeEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}
```

### Model-name mapping (per-model worker key, D-07/POOL-02)
**Source:** `server.mjs:517-533` (`CLAUDE_MODEL_MAP` + `resolveClaudeModel`)
**Apply to:** worker-key derivation and the `--model` boot flag. Maps `body.model` → `haiku`/`sonnet`/`opus`.
```javascript
// server.mjs:531-533:
function resolveClaudeModel(model) {
  return CLAUDE_MODEL_MAP[model] || model;
}
```

### Logging
**Source:** `log(...)` / `logErr(...)` used throughout (`server.mjs:1142`, `:1226`, `:442`).
**Apply to:** worker spawn/exit/recycle events and the dispatcher's pool-vs-execFile route log (mirror the existing `:1226` fallback log line).

## No Analog Found

No file is fully analog-less, but two concerns are NET-NEW (no in-repo prior art — implement from RESEARCH protocol reference + probe-derived patterns rather than an existing file):

| Concern | Role | Data Flow | Reason |
|---------|------|-----------|--------|
| Persistent stdio framing (buffer + `\n`-split JSON-Lines, drain stderr) | worker transport | streaming | No persistent-subprocess pipe exists in the codebase; one-shot `execFile` buffers the whole output. Use RESEARCH §"Response event sequence" + Pitfall 3. |
| Worker→request router (Map<key, ClaudeWorker[]>, acquire/release, LRU cap, concurrency-1, overflow) | pool manager | request-response | No in-process pool/router precedent. Use RESEARCH §"Recommended Project Structure" + §Pattern 1/2. |

## Metadata

**Analog search scope:** `_work/rapid-llm-proxy/proxy-bridge/server.mjs`, `_work/rapid-llm-proxy/tests/`
**Files scanned:** server.mjs (targeted ranges :390-549, :940-969, :1060-1240), tests/ listing + integration-bridge.test.mjs header/gating
**Pattern extraction date:** 2026-06-20

## PATTERN MAPPING COMPLETE

**Phase:** 62 - Worker Pool Core & stream-JSON Transport
**Files classified:** 4
**Analogs found:** 4 / 4

### Coverage
- Files with exact analog: 1 (dispatcher edit — its own body)
- Files with role-match analog: 3 (new worker module, 2 test files)
- Files with no analog: 0 (two net-new *concerns* within the worker module flagged separately)

### Key Patterns Identified
- The new worker module copies `completeClaudeCodeViaCLI`'s boot flags (`server.mjs:1106-1122`), env/cwd (`:1125-1138`), error mapping (`:1147-1156`), and token extraction (`:1158-1178`) verbatim — swapping one-shot `execFile` for persistent `spawn` + JSON-Lines stdio and returning the same `{content,model,tokens}` contract so it is drop-in interchangeable with the D-06 overflow path.
- The dispatcher edit replaces BOTH `completeClaudeCodeViaCLI(...)` call sites (`server.mjs:1216`, `:1227`) with a `viaCliPath` helper gated by the new `LLM_PROXY_DISABLE_WORKER_POOL` env hatch (mirroring `LLM_PROXY_DISABLE_CLAUDE_DIRECT` at `:1215`), orthogonal per D-08; `completeClaudeCodeDirect` (POOL-04) is untouched.
- The cancel-hook seam is `control_request{subtype:"interrupt"}` (worker survives — Q3), replacing the per-request `signal: clientAbortSignal` SIGTERM that the one-shot path uses at `:1138`.
- Tests follow the in-repo `node:test` + `assert/strict` + argv `--live`/`--smoke` gating from `tests/integration-bridge.test.mjs`.

### File Created
`/Users/Q284340/Agentic/coding/.planning/phases/62-worker-pool-core-stream-json-transport/62-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can reference analog line ranges directly in PLAN.md action sections.
