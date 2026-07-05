# Phase 82: Wire-Measurement Foundation - Pattern Map

**Mapped:** 2026-07-05
**Files analyzed:** 8 (2 proxy-repo modify, 1 proxy provider modify, 3 coding-repo modify, 2 new tests)
**Analogs found:** 8 / 8 (all in-repo precedents — this phase is entirely "extend an existing seam")

> Two repos in play. Coding repo: `/Users/Q284340/Agentic/coding`. Proxy repo (additional working dir): `/Users/Q284340/Agentic/_work/rapid-llm-proxy`. Proxy `src/*.ts` compiles to `dist/` via `npm run build`; `proxy-bridge/server.mjs` is runtime (no build) — see Deploy note at bottom.

## File Classification

| New/Modified File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/token-usage.ts` (schema+logCall+export+summary) | proxy | model/persistence | CRUD + migration | itself — Phase 68-01 attribution-column block (`:559-577`) | exact (self-precedent) |
| `proxy-bridge/server.mjs` — /v1/messages cache tap + x-agent binding | proxy | route/middleware | streaming (SSE) + request-response | itself — /v1/messages tap SSE loop (`:2029-2044`) + shim precedence (`:2144-2153`) | exact (self-precedent) |
| `proxy-bridge/server.mjs` — new `/v1/copilot/chat/completions` path | proxy | route | request-response | `/v1/mastra/chat/completions` dedicated-path precedent (`:2126-2129`) | exact mirror |
| `proxy-bridge/server.mjs` — shim tool-call passthrough | proxy | route/transform | request-response | `internalBody` builder (`:2186-2203`) + response envelope (`:2517-2554`) | role-match (extend) |
| `src/providers/copilot-provider.ts` — tools[] forward + tool_calls back | proxy | service/provider | request-response | `completeDirectHTTP` body builder (`:277-340`) | role-match (extend) |
| `lib/lsl/token/token-db.mjs` — `insertTokenRowDeduped` merge-on-cache | coding | utility/persistence | CRUD | itself (`:205-222`) + `ensureCacheColumns` (`:70-78`) | exact (self-precedent) |
| `lib/experiments/experiment-runner.mjs` — remove claude unroute + copilot BYOK env + headers | coding | config/orchestration | request-response | `configureProxyRoutingEnv` switch (`:135-172`) | exact (self-precedent) |
| `scripts/launch-agent-common.sh` — claude x-task-id header + copilot BYOK env | coding | config/launcher | request-response | `configure_proxy_routing()` case block (`:388-441`) | exact (self-precedent) |
| NEW test: SSE cache-parse + dedup-merge | both | test | — | `tests/integration/token-usage-schema-migration.test.mjs`; `tests/token-adapters/token-db.test.js` | exact (harness precedent) |
| opencode/copilot agent config touch (flag-gated) | coding | config | — | `config/agents/opencode.sh:35,39`; `config/agents/copilot.sh:41,58` | partial |

---

## Pattern Assignments

### `src/token-usage.ts` — cache-column migration + logCall/export/summary extension (model, CRUD+migration)

**Analog: itself.** Four self-precedents to copy verbatim. The two new columns MUST be `cache_read_tokens` and `cache_write_tokens` `INTEGER NOT NULL DEFAULT 0` — the EXACT names+types the coding side already adds in `lib/lsl/token/token-db.mjs:73`, so the two migrations are mutually idempotent.

**Migration block — copy the Phase 68-01 attribution pattern** (`src/token-usage.ts:559-577`):
```typescript
try {
  const attributionCols: Array<{ name: string; ddl: string }> = [
    { name: 'reasoning_tokens', ddl: `ALTER TABLE token_usage ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0` },
    // ← add: cache_read_tokens, cache_write_tokens with the SAME shape
  ];
  const cols4 = db.prepare(`PRAGMA table_info(token_usage)`).all() as Array<{ name: string }>;
  const existing = new Set(cols4.map(c => c.name));
  for (const col of attributionCols) {
    if (!existing.has(col.name)) { db.exec(col.ddl); }
  }
} catch (err) {
  process.stderr.write(`[token-usage] attribution column migration failed (non-fatal): ${(err as Error).message}\n`);
}
```
This is the canonical PRAGMA-guarded idempotent ALTER (the same style used for `model_raw` `:512-516` and `overhead_ms` `:531-533`). Add a NEW analogous block (or extend this array) for the two cache columns. Do NOT add them inside the composite-PK rebuild `INSERT...SELECT` (`:474-484`) — the comment at `:544-548` explains why: standalone ALTERs after the rebuild avoid copy-column-mismatch on legacy source tables. The fresh-install `CREATE TABLE` (`:395-411`) does NOT list these — the ALTER path is authoritative (matches how `model_raw`/attribution cols are absent from CREATE TABLE too).

**`logCall` insert binding — extend the positional bind** (`:798-837`). Current insertStmt is 21 columns (`:584-591`); add `cache_read_tokens, cache_write_tokens` to BOTH the `insertStmt` column list and the `.run(...)` positional args, coalesced `?? 0` exactly like `reasoning_tokens ?? 0` (`:830`):
```typescript
row.reasoning_tokens ?? 0,
row.cache_read_tokens ?? 0,   // ← new
row.cache_write_tokens ?? 0,  // ← new
```
Also add the two optional fields to the `TokenUsageRow` interface next to `reasoning_tokens?: number` (`:127`).

**`getRecent` — ZERO change needed.** It is `SELECT * FROM token_usage` (`:1143-1145`), so the new columns surface automatically once migrated. `GET /api/token-usage/recent` returns them for free (satisfies the acceptance check). Verify the columns land in the row objects; no code edit.

**`getSummary` bucket aggregates — additive `SUM()`** (`:898-932`). Mirror the existing `SUM(input_tokens)` / `SUM(total_tokens)` shape: add `COALESCE(SUM(cache_read_tokens),0)` and `COALESCE(SUM(cache_write_tokens),0)` to the `totals` query (`:898-905`) and to `by_process`/`by_provider`/`by_model` (`:906-932`) as needed. Extend the return-type interface (`:865-884`) with the new keys. All additive — never remove an existing field.

**Export/hydrate round-trip — extend column lists.** Two export paths: the live per-hour path `exportToHourFile` (`:319` + its SELECT at `:347`) and the deprecated `exportToJson` (`:736-770`, SELECT at `:741-747`). Add `cache_read_tokens, cache_write_tokens` to the export SELECT so snapshots carry them. `hydrateFromExports` INSERT (`:663-697`) uses `INSERT OR IGNORE` with an explicit column list — add the two columns and fall-back-coalesce older peer files that lack them (`(r.cache_read_tokens as number) ?? 0`), exactly like the `model_raw` fallback at `:678-681`.

---

### `proxy-bridge/server.mjs` — /v1/messages cache tap + per-request task binding (route, SSE + request-response)

**Analog: itself — the /v1/messages tap (`:1898-2096`).**

**Cache capture — extend the SSE parse loop** (`:2029-2044`). Today it reads only `input_tokens`/`output_tokens` off `message_start.message.usage` and `message_delta.usage`. Add cache fields from the SAME `usage` object:
```javascript
if (d.type === 'message_start' && d.message && d.message.usage) {
  uIn  = d.message.usage.input_tokens ?? uIn;
  uOut = d.message.usage.output_tokens ?? uOut;
  // ← add: cache_read_input_tokens + cache_creation_input_tokens.
  //   Newer wire uses a `cache_creation` OBJECT — handle defensively:
  //   cacheWrite = usage.cache_creation_input_tokens
  //             ?? (usage.cache_creation && sum of its numeric fields)
  sawUsage = true;
}
```
Apply the SAME extraction to the non-streaming JSON path (`:2057-2064`, `j.usage`). Accumulate `cacheRead`/`cacheWrite` alongside `uIn`/`uOut`.

**Tap logTokenCall — pass the new fields** (`:2071-2089`). Add `cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite` to the row object. Note the existing contract: `total_tokens = uIn + uOut` (cache is surfaced SEPARATELY, not folded into total — matches token-db.mjs comment `:48-50`).

**Per-request task binding — mirror the shim precedence** (`:2144-2153`, the block CONTEXT.md points at as "server.mjs:2148"). The tap currently hard-codes `taskId = resolveLiveTaskId()` (`:1930`), `agent: 'claude'`, `user_hash: 'cladpt'`, `process: proc` (`:2084-2085`). Replace the ambient resolution with header precedence copied verbatim from the shim:
```javascript
const hdrTaskId = typeof req.headers['x-task-id'] === 'string' ? req.headers['x-task-id'].trim() : '';
const hdrAgent  = typeof req.headers['x-agent']   === 'string' ? req.headers['x-agent'].trim()   : '';
const taskId = hdrTaskId || resolveLiveTaskId();
const agent  = hdrAgent  || 'claude';
```
When `agent !== 'claude'`: stamp `agent`, `process = 'token-adapter-' + agent`, and a matching non-cladpt `user_hash` (the current row uses the literal `'cladpt'` at `:2085` — parameterize it; adapter user_hash must still satisfy `/^[a-z][a-z0-9]{5}$/`, see `token-db.mjs:38-43` for the `cladpt`/`copadt` precedent). `captureBelongsToRun` (`:1567`, used at `:1956` and `:2163`) stays as the secondary guard — header-bound task_ids bypass the ambient file. NOTE: `ANTHROPIC_CUSTOM_HEADERS` reaches the tap because forward-headers are copied verbatim (`:1974-1979`) — but the tap reads `req.headers` directly, so no forwarding change is needed for binding.

---

### `proxy-bridge/server.mjs` — new `/v1/copilot/chat/completions` dedicated path (route, request-response)

**Analog: the Phase 70-04 mastra dedicated-path precedent — copy it EXACTLY.**

The mastra path is a one-line addition to the `isOpenAIShim` guard plus a path-derived default agent (`:2126-2129`):
```javascript
const isOpenAIShim = req.method === 'POST' &&
  (req.url === '/v1/chat/completions' || req.url === '/v1/mastra/chat/completions');
if (isOpenAIShim) {
  const defaultAgent = req.url === '/v1/mastra/chat/completions' ? 'mastra' : 'opencode';
```
Add `/v1/copilot/chat/completions` to the guard and extend the `defaultAgent` derivation to return `'copilot'` for it. Everything downstream (X-Agent/X-Task-Id precedence `:2144-2153`, internalBody build `:2186-2203`, response wrap `:2517-2554`) is reused VERBATIM. Claude's Discretion (CONTEXT §Discretion): either extend the `||` list or introduce a small `{path: defaultAgent}` route table — the mastra precedent used the `||` list, so a 3-entry table is the natural next step. This closes the spike bug where BYOK requests were mis-stamped `agent='opencode'` (probe 1, row 163286).

---

### `proxy-bridge/server.mjs` + `src/providers/copilot-provider.ts` — shim tool-call passthrough (transform, request-response)

**HARD requirement. Analog: the internalBody builder + response envelope (extend both).**

**Drop point 1 — internalBody strips tools** (`:2186-2203`). The internal envelope carries only `model`, `messages`, `agent`, `granularity_tier`, `task_id`, `process`, `subscription`, `provider`. Add:
```javascript
if (Array.isArray(oaBody.tools)) internalBody.tools = oaBody.tools;
if (oaBody.tool_choice !== undefined) internalBody.tool_choice = oaBody.tool_choice;
```

**Drop point 2 — provider request drops tools** (`copilot-provider.ts:277-282`, `completeDirectHTTP`). The body maps only `model`/`messages`/`max_tokens`/`stream`; thread `tools`/`tool_choice` through `LLMCompletionRequest` into `body` (Copilot's `/chat/completions` is OpenAI-native and supports function calling). Extend the response parse (`:318-324`) to read `data.choices[0].message.tool_calls` (currently only `.content`) and surface them on `LLMCompletionResult`.

**Drop point 3 — response envelope drops tool_calls** (`server.mjs:2517-2554`). Both the buffered (`:2542-2553`) and single-shot-SSE (`:2529-2540`) branches emit only `message: { role, content }` / `delta: { content }` and `finish_reason: 'stop'`. When the provider result carries `tool_calls`, include them in `message.tool_calls` and set `finish_reason: 'tool_calls'` (and the SSE `delta.tool_calls`).

**Capability gating — the provider-chain selection** (`server.mjs:2222-2300+`, "Auto-route" comment at `:2298`). The claude-code CLI provider spawns with `--tools ''` (`:1243`) → it CANNOT serve tool calls. When a tools-bearing request would land on a tools-incapable provider, the chain must PREFER a capable provider (copilot HTTP) or fail loudly — NEVER silently strip. Claude's Discretion (CONTEXT): a static `supportsFunctionCalling` flag on provider entries vs a runtime probe — the static flag is lower-risk and matches how `base-provider.ts` capabilities are typically declared. Acceptance is BEHAVIORAL: a copilot BYOK (and opencode) file-creation task must produce a real file on disk.

---

### `lib/lsl/token/token-db.mjs` — `insertTokenRowDeduped` merge-on-cache (utility, CRUD)

**Analog: itself (`:205-222`).** Today it is first-writer-wins: `DEDUP_SQL` (`:181-182`) probes `(user_hash, tool_call_id)`; on hit it `return false` (drops the incoming row) at `:212`. That is the root cause of the claude-cells-unrouted workaround — a cache-less tap row permanently shadows the richer cladpt transcript row.

**Upgrade:** on a dedup HIT, before dropping, SELECT the existing row's `cache_read_tokens + cache_write_tokens` (and `reasoning_tokens`). If the existing row is cache-less (`= 0`) AND the incoming row has cache data (or nonzero reasoning), run a parameterized `UPDATE token_usage SET cache_read_tokens=?, cache_write_tokens=?, reasoning_tokens=? WHERE user_hash=? AND tool_call_id=?` in place instead of returning false. Reuse the module's discipline: parameterized `?` binds only (`:138`), `num()` coalescing (`:88-90`), never-throw try/catch with `[token-adapter]` stderr (`:167-172`). The `ensureCacheColumns` guard (`:70-78`) already runs on open (`:111`) so the columns exist. Keep the IN-03 empty-`tool_call_id` skip-dedup guard (`:208-213`) untouched.

---

### `lib/experiments/experiment-runner.mjs` — remove claude unroute + copilot BYOK env (config, request-response)

**Analog: itself — `configureProxyRoutingEnv` switch (`:135-172`).**

**Removal:** delete the `default: … delete env.ANTHROPIC_BASE_URL` claude special-case (`:157-170`). After removal, claude cells fall into the same `env.ANTHROPIC_BASE_URL = base` treatment as opencode (`:155-156`), routing through the proxy again. Keep the `CODING_PROXY_ROUTE` opt-out (`:141-145`) and the health gate (`:150-153`) — both stay as the safety valve.

**Header injection (claude cells):** set `env.ANTHROPIC_CUSTOM_HEADERS = 'x-task-id: ' + cell.task_id` in the claude branch. VERIFY the newline-separated `Name: value` format live before relying on it (CONTEXT flag). Add a matching `x-agent: claude` if the tap binding requires it.

**Copilot BYOK branch (new `case 'copilot':`):** set `COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:${port}/v1/copilot`, `COPILOT_PROVIDER_TYPE=openai`, `COPILOT_PROVIDER_API_KEY=<placeholder>`, `COPILOT_MODEL=<model>` (+ `COPILOT_PROVIDER_WIRE_MODEL` when wire name differs). Follows the exact env-COPY discipline the fn already documents (`:132` "Returns a COPY of baseEnv; NEVER mutates LLM_PROXY_DATA_DIR").

---

### `scripts/launch-agent-common.sh` — claude x-task-id header + copilot BYOK env (launcher, request-response)

**Analog: itself — `configure_proxy_routing()` case block (`:388-441`).**

- **claude case** (`:405-412`): already sets `ANTHROPIC_BASE_URL` + unsets API-key envs. Add `export ANTHROPIC_CUSTOM_HEADERS="x-task-id: ${TASK_ID}"` (interactive launcher path; task id source is the launcher's span id). VERIFY the header env format live.
- **copilot case** (`:434-436`): replace the "NOT yet proxy-measured (follow-up)" warning with the BYOK env exports (same 5 vars as experiment-runner above), gated on Phase-81 verification. Drop the warning at `:435` once verified.
- **opencode case** (`:420-430`): the flag-gated anthropic-native provider entry — templated per-launch headers. See config touch below.

Keep the opt-out (`:382-388`) and health gate (`:398-403`) intact.

---

### opencode/copilot agent-config touch (config, flag-gated)

- **opencode** `config/agents/opencode.sh:35,39` sets `OPENCODE_CONFIG_CONTENT` as a JSON blob (`{"model":…,"disabled_providers":[…]}`). The flag-gated anthropic-native provider entry (`@ai-sdk/anthropic` → proxy `/v1/messages`) with per-launch `options.headers` (x-task-id/x-agent) is templated by editing/extending this JSON. Keep OPT-IN this phase (CONTEXT §deferred) — verify opencode actually sets `cache_control` breakpoints on this path before default.
- **copilot** `config/agents/copilot.sh:41,58` runs an HTTP adapter (`COPILOT_HTTP_ADAPTER_PID`). The BYOK env for the interactive launcher lands alongside these exports.

---

## Shared Patterns

### PRAGMA-guarded idempotent migration (proxy + coding, MUST be mutually idempotent)
**Sources:** `src/token-usage.ts:559-577` (attribution cols) and `lib/lsl/token/token-db.mjs:70-78` (`ensureCacheColumns`).
**Apply to:** the proxy schema migration. Both add `cache_read_tokens`/`cache_write_tokens` `INTEGER NOT NULL DEFAULT 0` — identical names+types so whichever runs first wins and the other is a no-op. Proxy uses `PRAGMA table_info` existence-check; coding uses try/catch-swallow duplicate-column. Both valid; keep the proxy on the PRAGMA style to match its existing blocks.
```javascript
// token-db.mjs:71-77 — the coding-side contract the proxy must stay compatible with
for (const col of ['cache_read_tokens', 'cache_write_tokens']) {
  try { db.exec(`ALTER TABLE token_usage ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`); }
  catch { /* already exists — idempotent no-op */ }
}
```

### Best-effort never-throw token write
**Source:** `logCall` try/catch (`token-usage.ts:798-837`); `insertTokenRow` (`token-db.mjs:132-173`); the tap's `logErr(... non-fatal)` guards (`server.mjs:2091-2093`).
**Apply to:** every new write path (cache tap, dedup-merge UPDATE, tool-passthrough logging). A DB/parse failure must NEVER fail the LLM request. Parameterized `?` binds only; numerics coalesced `?? 0`; `undefined` → explicit `null`.

### X-Task-Id / X-Agent header precedence
**Source:** shim precedence block `server.mjs:2144-2153`.
**Apply to:** the /v1/messages tap binding AND the /v1/copilot path (inherited). Header wins over ambient `resolveLiveTaskId()`; empty header falls back to ambient. This is the mechanism that kills the ambient-singleton leakage (v9 opencode rows contaminated with observation-writer/health-coordinator calls).

### Dedicated per-agent shim sub-route
**Source:** `/v1/mastra/chat/completions` (`server.mjs:2126-2129`).
**Apply to:** `/v1/copilot/chat/completions` — exact mirror; path-derived `defaultAgent`, pipeline reused verbatim.

---

## Test Patterns

### SSE cache-parse unit test (proxy repo)
**Harness analog:** `tests/integration/token-usage-schema-migration.test.mjs:20-48` — `node:test` + `node:assert/strict`, isolated tmpdir DB via `LLM_PROXY_TOKEN_DB_PATH`, asserts against the SHIPPED `../../dist/token-usage.js` (run AFTER `npm run build`). Fixture-record the SSE `message_start`/`message_delta` bytes (a `cache_creation`-object variant + the flat `cache_read_input_tokens` variant) and assert the parsed `cacheRead`/`cacheWrite` and that `total = uIn + uOut` excludes cache. Fixtures precedent: `tests/fixtures/mock-llm-responses.ts`.
**Gotcha (memory `reference_node_test_argv_live_gate`):** `--live`-style trailing argv is dropped for child procs — gate any live test on an ENV var (`LLM_PROXY_LIVE=1`), not argv.

### Dedup-merge unit test (coding repo)
**Harness analog:** `tests/token-adapters/token-db.test.js:23-55` — `createRequire` + `better-sqlite3`, temp DB with the full 21-column `CREATE_TABLE_SQL` (`:39-55`), dynamic `import()` of `token-db.mjs`. Add the two cache columns to the fixture table, insert a cache-less row, then `insertTokenRowDeduped` a same-`(user_hash, tool_call_id)` row WITH cache data, assert the existing row's cache columns were UPDATED in place (not a second row, not dropped). Cover the negative: existing row already has cache → incoming dropped (return false).

---

## No Analog Found

None. Every file extends an existing, well-precedented seam in one of the two repos. This phase is deliberately "wire what already exists" — the risk is in correctness of the extensions, not in green-field design.

---

## Metadata

**Analog search scope:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/{src,proxy-bridge,tests}`, `/Users/Q284340/Agentic/coding/{lib/lsl/token,lib/experiments,scripts,config/agents,tests/token-adapters}`
**Files scanned:** ~14 (token-usage.ts, server.mjs, token-db.mjs, experiment-runner.mjs, launch-agent-common.sh, copilot-provider.ts, opencode.sh, copilot.sh, 2 test files, fixtures dir)
**Pattern extraction date:** 2026-07-05
**Deploy (from CONTEXT §specifics):** proxy `src/*.ts` edit → `npm run build` in rapid-llm-proxy → `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`. `server.mjs` is runtime (no build). Restart can mis-detect corporate network — confirm coordinator :3034 `location=open` BEFORE kickstart (memory: `reference_llm_proxy_override_fallback`).
