# Phase 70: OpenCode + Mastra Token Adapters - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 7 (3 created/modified in proxy submodule, 2 config, 2 coding-repo scripts — last 2 only if Mastra fallback triggers)
**Analogs found:** 7 / 7 (all in-repo; this phase is pure pattern-reuse, no greenfield surface)

## File Classification

| New/Modified File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `proxy-bridge/server.mjs` (new `/v1/chat/completions` shim branch + generic `agent`/`task_id` envelope passthrough on the `logTokenCall` build) | rapid-llm-proxy | route + controller | request-response | the existing `/api/complete` branch in the SAME file (`server.mjs:1518`) + its `logTokenCall` build (`:1666`) | exact (same file, sibling branch) |
| `src/token-usage.ts` (no schema change; confirm `TokenUsageRow.agent`/`task_id`/`granularity_tier` already plumbed by `logCall`) | rapid-llm-proxy | model / persistence | CRUD | itself — Phase-68 columns already exist (`:122-127`, `:812-817`); **read-only confirmation, likely zero edits** | exact (consume-as-is) |
| `src/measurement-span.ts` / `src/index.ts` (no change; shim consumes `resolveLiveTaskId` via existing barrel) | rapid-llm-proxy | utility / barrel | request-response | itself — `resolveLiveTaskId()` (`measurement-span.ts:256`) re-exported at `index.ts:26-29` | exact (consume-as-is) |
| `~/.config/opencode/opencode.json` (custom OpenAI-compatible provider → `http://localhost:12435/v1`) | coding | config | — | the existing `model`/`enabled_providers`/`mcp` blocks in the same file (currently `github-copilot/claude-opus-4.6`) | role-match (additive edit) |
| `.opencode/mastra.json` (SC-3 investigation target; possible model→shim redirect) | coding | config | — | `config/agents/mastra.sh` proxy-reachability + `MASTRA_MODEL` wiring (`:166-191`) | partial (investigation, not copy) |
| `scripts/sub-agent-live-opencode.mjs` (Mastra fallback: try/catch-isolated emission hook on the supervisor) — **only if D-08 fork → fallback** | coding | service / supervisor | event-driven | itself (existing daemon shape, error-budget + atomic-write patterns at `:122-185`) | exact (extend in place) |
| Mastra fallback adapter write path (host-side `better-sqlite3` INSERT into `token-usage.db`) — **only if fallback** | coding | service / persistence | batch + CRUD | `scripts/backfill-task-id-by-timestamp.mjs` (busy_timeout open + UPDATE + user_hash scope) + `lib/lsl/adapters/opencode-sqlite.mjs` (busy_timeout pragma) | role-match |

---

## Pattern Assignments

### `proxy-bridge/server.mjs` — new `/v1/chat/completions` shim (route, request-response)

**Analog:** the `/api/complete` branch in the same file — the shim is a sibling `if` branch that *internally re-runs the same pipeline*, so the planner's task is "add a branch that normalizes an OpenAI body → the existing `body` shape, then fall through the existing chain + `logTokenCall`."

**Imports already present at the top of the file (reuse, add nothing new):** (`server.mjs:37,43`)
```javascript
import { initTokenDb, logCall as logTokenCall, getSummary as getTokenSummary, getRecent as getTokenRecent, backfillCanonicalModelNames } from '../dist/token-usage.js';
import { resolveLiveTaskId } from '../dist/measurement-span.js';
```
> Note the `dist/` import target: a TS edit to `src/token-usage.ts` or `src/measurement-span.ts` requires `npm run build` before the `.mjs` server sees it (proxy build pipeline).

**Branch placement + body-parse pattern to copy** (`server.mjs:1518-1528`): the new `req.url === '/v1/chat/completions'` branch slots beside this one, reusing the identical raw-body read + JSON-parse + 400-on-bad-JSON guard.
```javascript
if (req.method === 'POST' && req.url === '/api/complete') {
  let rawBody = '';
  for await (const chunk of req) rawBody += chunk;
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }
  // ... abort controller, provider-chain resolution, completeXxx(), logTokenCall ...
```

**Core mapping (the shim's only real logic — OpenAI envelope ⇆ proxy envelope):**
- IN: OpenAI `chat/completions` body `{ model, messages:[{role,content}], ... }` → the proxy already speaks `{ model, messages, process, subscription }`. `messages` shape is compatible (`role`/`content`). Per Claude's Discretion guardrail: **pass `body.model` straight through** and let the existing chain (`:1577-1626`) resolve it — add NO new routing logic.
- OUT: wrap the proxy result (`server.mjs:1701-1712` returns `{ content, provider, model, tokens, latencyMs }`) into the OpenAI response envelope `{ id, object:'chat.completion', model, choices:[{message:{role:'assistant',content}, finish_reason}], usage:{prompt_tokens, completion_tokens, total_tokens} }`. Map `tokens.input→prompt_tokens`, `tokens.output→completion_tokens`, `tokens.total→total_tokens`. Non-streaming only (D-02) — single buffered JSON, no SSE.

**`logTokenCall` row build — the ONLY substantive change to the existing path** (`server.mjs:1666-1698`). Today `agent`/`granularity_tier` are left at defaults and `task_id` is `resolveLiveTaskId()`. The phase fills the two gaps via **generic envelope passthrough (D-06)** — stamp `row.agent` from `body.agent` exactly the way `body.process`/`body.subscription` are already threaded:
```javascript
if (_tokenDb) {
  const tokensEstimated = (result.tokens?.total ?? 0) === 0 ? 1 : 0;
  logTokenCall(_tokenDb, {
    timestamp: new Date().toISOString(),
    provider: providerName,
    model: canonicalizeModelName(result.model) || 'unknown',
    model_raw: result.model || 'unknown',
    process: typeof body.process === 'string' && body.process ? body.process : 'unknown',
    subscription: typeof body.subscription === 'string' && body.subscription
      ? body.subscription
      : defaultSubscription(providerName),
    input_tokens: result.tokens?.input ?? 0,
    output_tokens: result.tokens?.output ?? 0,
    total_tokens: result.tokens?.total ?? 0,
    latency_ms: latencyMs,
    overhead_ms: typeof result.overheadMs === 'number' ? result.overheadMs : null,
    prompt_preview: extractPromptPreview(body.messages),
    tokens_estimated: tokensEstimated,
    task_id: resolveLiveTaskId(),
    // ── PHASE 70 ADDITIONS (generic passthrough, same shape as process/subscription above) ──
    // agent:            typeof body.agent === 'string' && body.agent ? body.agent : '',
    // granularity_tier: typeof body.granularity_tier === 'string' && body.granularity_tier ? body.granularity_tier : '',
  });
}
```
**Plumbing intent (locked, D-04/D-05/D-06):** the shim builds the *internal* `body` it hands to this shared path, setting `body.agent='opencode'`, `body.granularity_tier='per-llm-call'`, and `body.task_id = <override> ?? resolveLiveTaskId()`. Because `logTokenCall` reads `row.agent`/`row.task_id` from the envelope generically, the SAME code serves `agent='mastra'` later with zero new branches. Keep `task_id` precedence: **client override (e.g. `X-Task-Id` header or `body.task_id`) wins if present, else `resolveLiveTaskId()`** (D-04/D-05). For the `/api/complete` path, also switch its hardcoded `task_id: resolveLiveTaskId()` to the same `body.task_id ?? resolveLiveTaskId()` precedence so the override is backward-compatible there too (D-04 "existing callers that omit the field keep current behavior").

**Error/best-effort pattern to preserve** (`server.mjs:1666` guard + `logCall`'s internal try/catch at `token-usage.ts:788-823`): the `if (_tokenDb)` guard + `logCall`'s own try/catch mean a DB hiccup never fails the LLM call. The shim adds NO second writer — it rides this exact path (no WAL concern on the proxy-route side; the proxy owns the DB).

**Provider-chain reuse (no copy needed, just fall through):** `server.mjs:1577-1626` resolves `head`+`preferenceOrder`→`chain`, honoring `processOverrides`, `body.provider`, and subscription hints. The shim passes `body.model`/`body.process` and lets this run unchanged.

---

### `src/token-usage.ts` — consume-as-is (model/persistence, CRUD)

**Analog:** itself. **Expect zero edits.** The six Phase-68 attribution columns already exist and `logCall` already binds `agent`/`task_id`/`granularity_tier` with `'' `/`0` defaults.

**Row type already carries the fields** (`token-usage.ts:122-127`):
```typescript
agent?: string;
task_id?: string;
tool_call_id?: string;
parent_call_id?: string;
granularity_tier?: string;
reasoning_tokens?: number;
```

**`logCall` already binds them, coalesced to column defaults** (`token-usage.ts:812-817`):
```typescript
row.agent ?? '',
row.task_id ?? '',
row.tool_call_id ?? '',
row.parent_call_id ?? '',
row.granularity_tier ?? '',
row.reasoning_tokens ?? 0
```
> Planner: do NOT add a column or touch the schema (`<domain>` out-of-scope). The shim only needs to PASS these on the row object — the persistence layer is already complete.

---

### `src/measurement-span.ts` / `src/index.ts` — consume-as-is (utility/barrel)

**Analog:** itself. The single active-span reader is the only task_id source the shim calls server-side (D-05).

**The resolver the shim calls** (`measurement-span.ts:256-265`) — never throws, returns `''` when no span:
```typescript
export function resolveLiveTaskId(overrideDataDir?: string): string {
  try {
    const span = getActiveMeasurement(overrideDataDir);
    return span ? span.task_id : '';
  } catch {
    return '';
  }
}
```
**Already re-exported from the barrel** (`index.ts:26-29`) — no new export needed. `getActiveMeasurement` (`measurement-span.ts:112`) is the SINGLE JSON parser of `.data/active-measurement.json`; **do not add a second parser** (canonical-refs constraint).

---

### `~/.config/opencode/opencode.json` — custom OpenAI-compatible provider (config)

**Analog:** the existing top-level keys in the same file. Current state (host-side):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "github-copilot/claude-opus-4.6",
  "enabled_providers": ["github-copilot"],
  ...
}
```
**Change (additive — Claude's Discretion guardrail: do NOT break existing setup, prefer additive + documented switch):** add a custom OpenAI-compatible provider whose `baseURL` is `http://localhost:12435/v1` (host-side canonical per D-03; `host.docker.internal:12435` is the container alias of the same proxy). OpenCode's provider config uses an `@ai-sdk/openai-compatible`-style `npm`+`options.baseURL` block under a `provider` key, plus a `models` map. Planner: confirm the exact OpenCode `provider` schema against `https://opencode.ai/config.json` (the `$schema` in the file) — the shape is `provider.<id> = { npm, name, options:{ baseURL, apiKey }, models:{...} }`. Decide replace-vs-add for `enabled_providers`/`model` per the documented switch.

> Port discipline (CLAUDE.md): `12435` is the LLM proxy. Do NOT use `3033` (Health API) — it silently returns `Cannot POST /api/complete` HTML.

---

### `.opencode/mastra.json` — SC-3 instrumentation-surface investigation (config)

**This is the D-08 fork. Findings from inspecting the installed surface (so the planner writes a CONCRETE investigation task, not a vague one):**

Current `.opencode/mastra.json`:
```json
{
  "model": "anthropic/claude-haiku-4-5",
  "storagePath": ".observations/observations.db",
  "observation": { "messageTokens": 20000 },
  "reflection": { "observationTokens": 90000 }
}
```

**What is knowable now:**
1. **Two distinct "Mastra" surfaces exist — disambiguate first.**
   - (a) `.opencode/mastra.json` with model `anthropic/claude-haiku-4-5` — this is the **observation/reflection memory engine** config (`storagePath=.observations/observations.db`, token budgets). It is the SC-3 target.
   - (b) `mastracode` — a standalone coding-agent TUI launched via `scripts/launch-mastra.sh` → `config/agents/mastra.sh` (`AGENT_COMMAND="mastracode"`, `MASTRA_MODEL` set network-adaptively). Separate concern; its LLM traffic is the bigger token consumer.
2. **`@opencode-ai/plugin@1.3.17` is installed but is type-stubs only** — `dist/index.js` is 27 bytes; the package ships `.d.ts` declarations, not a runtime. **It is NOT the Mastra model-call surface.** Its hook types (`Hooks` in `dist/index.d.ts:142`) DO expose redirect-capable seams for the *OpenCode* agent, though: `chat.params` (`:171`), `chat.headers` (`:183`), and `provider`/`provider.loader`/`provider.models` (`:138,:151`). These are an alternative OpenCode redirect path the planner can note, but D-01 already locked OpenCode on the provider-config (shim) path, NOT a plugin — so these are fallback intel only.
3. **No `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` / `baseURL` redirect is currently exported for Mastra anywhere.** `config/agents/mastra.sh:166-191` only (a) curl-probes `http://localhost:12435/health` for reachability (warn-only) and (b) sets `MASTRA_MODEL` to a provider-prefixed id (`github-copilot-enterprise/...` on VPN, `claude-opus-4-6` public) and warns if `ANTHROPIC_API_KEY` is unset — i.e. mastracode currently authenticates to providers **directly**, NOT through the proxy, despite the "D-07: all calls route through proxy" comment (the comment is aspirational; no redirect env is set). Grep confirms: the only `base_url` hits in `config/`/`scripts/` are upstream provider URLs in `live-logging-config.json`, none point at `:12435/v1`.

**Concrete investigation task for the planner (resolves D-08):**
- Determine whether the Mastra observation engine (`.opencode/mastra.json` consumer) resolves its `anthropic/...` model through an OpenAI/Anthropic SDK whose base URL is overridable via env (`ANTHROPIC_BASE_URL` / a config `baseURL`). If yes → **proxy-route** (point it at `http://localhost:12435/v1`, set `agent='mastra'` via the shim's generic passthrough; per-llm-call rows for free).
- Determine the same for `mastracode` (set `MASTRA_MODEL` to a shim-served id and/or export a base-URL env in `config/agents/mastra.sh`).
- If neither endpoint is redirectable → fall back to framework instrumentation (D-10 best-available tier, per-session-aggregate floor) using the write path below.
- **Either way (D-09): document the instrumentation surface** — the plugin `Hooks` seams (`chat.params`/`chat.headers`/`provider.loader`) are the documented per-call surface for the OpenCode-plugin route; the Mastra memory engine's surface must be identified from its own package once located at runtime.

---

### `scripts/sub-agent-live-opencode.mjs` + host-side adapter — Mastra fallback (service/supervisor + persistence) — ONLY IF D-08 → FALLBACK

**Analog A — supervisor extension (`scripts/sub-agent-live-opencode.mjs`):** the emission hook is a try/catch-isolated call added to the existing daemon (D-11: no new launchd plist). Copy the daemon's existing failure-isolation discipline:
- Error-budget pattern (`:170-185`): `trackError()` drops >60s-old timestamps, exits 1 after >10 errors in 60s for supervisor restart. A token-emission failure must feed this budget, never crash the LSL poll.
- Atomic state-file write (`:122-131`): `<file>.tmp` + `fs.renameSync`.
- Best-effort import-with-noop-fallback (`:191-211`): the ObservationWriter init wraps in try/catch and falls back to a no-op writer — mirror this for the token emitter so an init failure degrades gracefully.

**Analog B — host-side `better-sqlite3` write path (`scripts/backfill-task-id-by-timestamp.mjs`):** the fallback adapter writes directly into `token-usage.db` (D-11 reuses Phase-69's locked path verbatim). Copy:

DB open + path resolution (`backfill-task-id-by-timestamp.mjs:44-64,193-200`):
```javascript
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
// ...
function resolveDataDir() {
  return process.env.LLM_PROXY_DATA_DIR || '/Users/Q284340/Agentic/coding/.data';
}
function resolveDbPath(override) {
  return override || path.join(resolveDataDir(), 'llm-proxy', 'token-usage.db');
}
// open read-write for apply:
db = new Database(dbPath, { readonly: false, fileMustExist: true });
```

**`busy_timeout` pragma (Phase-69 D-07 WAL-concurrency requirement)** — the backfill script omits it, so copy it from the OpenCode SQLite adapter (`lib/lsl/adapters/opencode-sqlite.mjs:168-169`):
```javascript
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');
```
The fallback adapter opens **read-write** + `busy_timeout = 5000` and the plan must include a WAL concurrency test as an acceptance criterion (D-11 / Phase-69 D-07).

**Distinct adapter user_hash (D-11 / Phase-69 D-06):** the fallback adapter binds its own `user_hash` namespace (NOT the proxy's `LLM_PROXY_USER_HASH`). `runSweep`'s optional `userHashFilter` (`backfill-task-id-by-timestamp.mjs:131-172`) is the precedent for scoping a sweep to one adapter namespace — the timestamp-join backfill UPDATE is parameterized (`user_hash = ?`), never interpolated.

**task_id resolution (D-11 / Phase-69 D-03):** live via `getActiveMeasurement()` (from `@rapid/llm-proxy` barrel — same single reader the shim uses), plus the timestamp-join backfill sweep (`runSweep`/`loadArchivedSpans`, importable from `backfill-task-id-by-timestamp.mjs` thanks to its `isMain` entry-point guard at `:281-295`).

**Row INSERT shape:** match `logCall`'s bind order (`token-usage.ts:574-581` insert columns; `:788-818` bind values) — the adapter must supply `id` (via a per-user `MAX(id)+1` seed, see `seedLocalSeq` at `token-usage.ts:588-595`), `user_hash`, and stamp `agent='mastra'`, `granularity_tier=<actual tier achieved>` (D-10).

---

## Shared Patterns

### Generic envelope passthrough (THE central pattern of this phase)
**Source:** `proxy-bridge/server.mjs:1673-1676` (`process`/`subscription` already passed from `body` onto the row).
**Apply to:** the `agent`, `granularity_tier`, and optional `task_id`-override fields on the `logTokenCall` build.
**Why it matters (D-06):** one code path serves `opencode`, `mastra`, and any future proxy-routed agent — no per-agent branches. Stamp `row.agent` from `body.agent` the same way `row.process` comes from `body.process`.

### Best-effort logging / never-fail-the-LLM-call
**Source:** `server.mjs:1666` (`if (_tokenDb)` guard) + `token-usage.ts:788-823` (`logCall` internal try/catch) + `measurement-span.ts:256-265` (`resolveLiveTaskId` never throws).
**Apply to:** the shim (rides the existing guarded path — adds no risk) AND the host-side Mastra fallback emitter (try/catch-isolated on the supervisor; an emission failure can never crash the LSL path — D-11).

### no-console-log discipline
**Source:** `process.stderr.write(...)` throughout (`measurement-span.ts:22`, `token-usage.ts:236`, `sub-agent-live-opencode.mjs:34`, `backfill-task-id-by-timestamp.mjs:47-48`).
**Apply to:** all new code in both repos. Use `process.stderr.write` for forensic logging; never `console.log` (CLAUDE.md constraint, enforced on .js/.ts edits).

### Proxy build pipeline (dist/ staleness trap)
**Source:** `server.mjs:37,43` import from `../dist/token-usage.js` / `../dist/measurement-span.js`.
**Apply to:** any TS edit in `src/` — run the proxy's `npm run build` before the running `.mjs` server picks it up. (If `src/token-usage.ts`/`src/measurement-span.ts` truly need no edit — expected — this trap does not bite, but the shim branch lives in the `.mjs` directly so it takes effect on proxy restart.)

### Port discipline
**Source:** CLAUDE.md + `config/agents/mastra.sh:172`.
**Apply to:** OpenCode provider config + any Mastra redirect. `12435/v1` = LLM proxy shim. `3033` = Health API (returns `Cannot POST` HTML — masks the wrong-port bug).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every surface this phase touches has a concrete in-repo analog. The OpenAI→proxy *envelope translation* logic inside the shim is the only genuinely new code, but it is a thin adapter over the fully-existing `/api/complete` pipeline + `logTokenCall` build, and the OpenAI `chat/completions` schema itself is a stable external contract (planner can validate field names via the OpenAI API docs / ctx7 if needed). |

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/`, `/src/`
- `/Users/Q284340/Agentic/coding/scripts/`, `/lib/lsl/adapters/`, `/config/agents/`, `/.opencode/`, `~/.config/opencode/`
**Files scanned (read or grepped):** `server.mjs` (shim + logTokenCall region), `token-usage.ts` (full), `measurement-span.ts` (full), `index.ts`, `backfill-task-id-by-timestamp.mjs` (full), `sub-agent-live-opencode.mjs` (header+main), `opencode-sqlite.mjs` (header+pragmas), `opencode.json`, `mastra.json`, `config/agents/mastra.sh`, `@opencode-ai/plugin@1.3.17` dist.
**Pattern extraction date:** 2026-06-22
