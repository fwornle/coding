# Phase 83: Token Reconciliation Layer - Pattern Map

**Mapped:** 2026-07-06
**Files analyzed:** 11 (7 coding-side + 2 proxy-side + 2 new artifacts)
**Analogs found:** 11 / 11 (every surface is an in-place modification of an existing file with a strong same-file precedent, OR a new artifact with a close sibling)

> **Note on this phase's shape.** Almost every "file to create" is really a **modification** of an existing, heavily-patterned file. So the closest analog for each surface is usually *the file itself* (a prior additive change to the same module) plus a sibling for the genuinely new pieces (the `reconcile` adapter mode, the `reconciliation.json` sink, the read API). The planner should COPY the existing conventions in each file, not invent a parallel structure.

---

## File Classification

| File (modify unless noted) | Role | Data Flow | Closest Analog | Match Quality |
|----------------------------|------|-----------|----------------|---------------|
| `lib/lsl/token/stop-adapter-registry.mjs` | adapter/registry | transform (transcript→rows) | itself — the `mode: 'transcript'`/`'stamp-only'` dispatch (`captureForegroundTokens` :330) | exact (extend in place) |
| `lib/lsl/token/token-db.mjs` | data-access (SQLite) | CRUD + dedup-merge | itself — `insertTokenRowDeduped` :224 + `DEDUP_SQL`/`MERGE_ON_CACHE_SQL` :184-194 | exact (extend in place) |
| **NEW** reconcile matcher module (e.g. `lib/lsl/token/reconcile.mjs`) | service | transform/join | `insertTokenRowDeduped` merge logic + `withinSpanWindow` (:319) | role-match (extract+generalize) |
| `scripts/measurement-stop.mjs` | orchestrator/CLI | batch (span-close pipeline) | itself — the (3.0) `captureForegroundTokens` call (:402-417) + (3.3) fixture-archive sink (:479-507) | exact (extend in place) |
| **NEW** `reconciliation.json` (per-span artifact) | data artifact | file-I/O (write) | (3.3) `perRunBreakdownPath` / RunSnapshot fixtures write in measurement-stop | role-match |
| `lib/vkb-server/api-routes.js` | route/controller | request-response (read API) | itself — `handleTimeline` (:572, read-only proxy DB) + `handleRunsQuery` (:515) | exact (add sibling route) |
| `scripts/launch-agent-common.sh` | config/shell | env-wiring | itself — `configure_proxy_routing()` copilot branch (:441-459) | exact (gate in place) |
| `config/agents/copilot.sh` | config/shell | env-wiring | itself — `agent_pre_launch()` BYOK block (:64-82) | exact (remove/gate in place) |
| `lib/experiments/experiment-runner.mjs` | service | env-wiring | itself — `configureProxyRoutingEnv` copilot case (:179-192) | exact (cell-side stays) |
| `_work/rapid-llm-proxy/proxy-bridge/server.mjs` | proxy handler | request-response + tap | itself — `/v1/messages` tap (:1957-2182) + OpenAI-shim (:2226-2338) | exact (guard/patch in place) |
| `_work/rapid-llm-proxy/src/token-usage.ts` | data-access (SQLite schema) | CRUD + migration | itself — PRAGMA-guarded `ADD COLUMN` blocks (:572-623) + composite-PK rebuild (:458-507) | exact (extend migration) |

---

## Pattern Assignments

### `lib/lsl/token/stop-adapter-registry.mjs` — add `mode: 'reconcile'` (D-01, D-02, D-04)

**Analog:** itself. `reconcile` slots in as a THIRD mode next to `transcript`/`stamp-only`.

**Dispatch pattern to copy** (`captureForegroundTokens` :330-339) — the guard is the extension point:
```javascript
const agent = opts.agent ?? span.agent;
const adapter = agent ? STOP_ADAPTERS[agent] : undefined;
// (1) Double-count guard: stamp-only / unknown agents do ZERO transcript work.
if (!adapter || adapter.mode !== 'transcript' || typeof adapter.build !== 'function') {
  return 0;
}
```
> The new mode must be selected here. Today claude/copilot are `mode: 'transcript'` (:86-105). D-01 says reconcile applies to **measured spans only** — so the planner should thread a `reconcile: true` opt (passed by measurement-stop) that switches these two agents onto the reconcile path, while the interactive Stop/sweep path keeps `mode: 'transcript'` untouched.

**Window-scope + insert pattern to reuse** (:388-409) — the reconcile loop replaces the blind `insertTokenRowDeduped` with a match-then-enrich-or-fallback:
```javascript
for (const row of batch.rows) {
  if (!withinSpanWindow(row, span)) continue;   // reuse verbatim (:319-328)
  const ok = insertTokenRowDeduped(db, { ...row, user_hash: adapter.userHash, task_id: taskId });
  if (ok) inserted += 1;
}
```
> **Critical join note (D-02, code_context):** wire rows carry `user_hash='cladpt'`/`'copadt'` too (proxy `/v1/messages` tap stamps `adapterUserHash(agent)` — see server.mjs :2170), BUT the reconcile matcher must join on **request-id (`tool_call_id`)**, NOT reuse the `(user_hash, tool_call_id)` dedup probe, because retry/time-fuzzy fallback needs a cross-key match. The transcript `requestId` == the proxy tap's `tool_call_id = upstream request-id` (server.mjs :2166-2172 / :1966-1969) — that shared key is what makes the match load-bearing.

**Provenance stamping convention** (SUBAGENT_PROCESS :64, batch.process :382): follow this for the fallback provenance tag D-02 requires — a distinct `process` / marker field on fallback-inserted rows.

**`:reason:` always-insert rule (D-02):** mirror the IN-03 degeneracy guard in token-db.mjs (:227-229) — a `tool_call_id` ending `:reason:N` has no wire counterpart, so it must bypass the matcher and insert unconditionally.

---

### `lib/lsl/token/token-db.mjs` — the matcher's authority model (D-04, D-05)

**Analog:** itself — `insertTokenRowDeduped` (:224-264) is the reconcile matcher's direct ancestor. Same fields, same authority direction (wire/existing wins, transcript enriches gaps only).

**Fill-gaps-only pattern to generalize** (:236-250):
```javascript
const existingCacheLess =
  num(existing.cache_read_tokens) + num(existing.cache_write_tokens) === 0;
const incomingHasCache = num(row.cache_read_tokens) + num(row.cache_write_tokens) > 0;
const incomingHasReasoning = num(row.reasoning_tokens) > 0;
if (existingCacheLess && (incomingHasCache || incomingHasReasoning)) {
  db.prepare(MERGE_ON_CACHE_SQL).run(/* enrich in place, overwrite-once */);
  return true;
}
return false; // existing already rich, or incoming adds nothing → drop (no double-count)
```
> D-04 generalizes this: the reconcile enrich covers `reasoning_tokens`, `granularity_tier`, `parent_call_id`, AND the cache split — but only WHERE the wire row is empty. Wire counts are NEVER overwritten. `MERGE_ON_CACHE_SQL` (:193-194) is the template for a widened `UPDATE ... SET <gap fields> WHERE user_hash=? AND tool_call_id=?`.

**Probe-selects-columns pattern** (`DEDUP_SQL` :184-185): the probe already SELECTs cache/reasoning columns (not `SELECT 1`) so the caller can compute per-field deltas — D-05's "record every nonzero per-field delta" reads directly off this shape. Widen the SELECT to all reconciled fields.

**Parameterized-bind + never-throw discipline** (:132-173, :224-264): every value bound via `?`, every numeric `num()`-coalesced, every failure → `[token-adapter]` stderr line + `return false`. The matcher MUST preserve this (T-69-sql / D-08).

---

### `scripts/measurement-stop.mjs` — invoke reconcile + write the sink (D-01, D-12)

**Analog:** itself. The reconcile invocation replaces/extends the existing (3.0) capture call; the sink write mirrors the (3.3) fixture-archive block.

**Capture-invocation seam to extend** (:402-417):
```javascript
const foregroundAgent = span.agent ?? span.meta?.agent ?? 'claude';
try {
  await captureForegroundTokens(span, { agent: foregroundAgent });
} catch (err) {
  process.stderr.write(`[measurement-stop] foreground capture failed (non-fatal): ${err.message}\n`);
}
```
> D-01: this is the measured-span path. Thread the `reconcile: true` opt here (and have `captureForegroundTokens` return the reconciliation report object instead of just an insert count). This is ALSO where the interactive path diverges — measurement-stop passes reconcile, the Stop/sweep path does not.

**Per-span artifact-write pattern to copy** (:479-507, the snapshotId/fixtures block):
```javascript
const snapshotDirId = sanitizeTaskId(span.task_id);
const snapDir = path.join(REPO_ROOT, '.data', 'run-snapshots', snapshotDirId);
// ... fs.existsSync / fs.mkdir / write ... all best-effort try/catch + stderr
```
> The `reconciliation.json` sink lands under `.data/measurements/<span>/` (per domain statement) — use `sanitizeTaskId(span.task_id)` for the dir name (imported at :82), write via the Write-tool-analog `fs.writeFileSync` used at :599, and wrap the whole thing best-effort so a sink failure NEVER hard-blocks the close (mirrors the fixture block's contract at :505-507).

**D-12 shape:** self-contained JSON = top-level summary (matched / unmatched_wire / unmatched_transcript / fallback-inserted counts, per-field aggregate deltas, flagged count) + a per-request array (match method, per-field deltas, flags). Field-name/schema-versioning is Claude's Discretion.

---

### `lib/vkb-server/api-routes.js` — `GET .../reconciliation` read API (D-13)

**Analog:** itself — `handleTimeline` (:564-591) is the exact template: a read-only, task-id-parameterized GET that touches an on-disk/proxy source and never opens the experiment LevelDB.

**Route registration** (copy the pattern at :89):
```javascript
app.get('/api/experiments/runs/:taskId/timeline', (req, res) => this.handleTimeline(req, res));
// ADD:
app.get('/api/experiments/runs/:taskId/reconciliation', (req, res) => this.handleReconciliation(req, res));
```

**Handler pattern to copy** (`handleTimeline` :572-591) — validate taskId, read the file verbatim, graceful-empty on ENOENT:
```javascript
const { taskId } = req.params;
if (!taskId || typeof taskId !== 'string' || taskId.trim().length === 0) {
  return res.status(400).json({ error: 'Invalid taskId', message: 'taskId is required' });
}
// read .data/measurements/<sanitized taskId>/reconciliation.json via fs.readFile
// return res.status(200).json(<parsed>); ENOENT → 200 with an empty/absent shape
```
> **task_id sanitization:** reuse `_validTaskId` (:735-737) — the same `[A-Za-z0-9._-]`, ≤80 gate the measurement endpoints use — before building the path, to keep the read inside `.data/measurements/`. `_dataDir()` (:729-732) resolves the container-safe root. D-13: serve the file **verbatim** so Phase 86's badge needs zero backend work.

---

### `scripts/launch-agent-common.sh` + `config/agents/copilot.sh` — gate copilot BYOK (D-03, WR-05, WR-02)

**Analog:** both files, in place. D-03 moves the unconditional `COPILOT_PROVIDER_*` exports OUT of the interactive path into measured-launch wiring only.

**The unconditional exports to REMOVE/GATE** — `config/agents/copilot.sh` `agent_pre_launch()` (:64-82):
```bash
if [ -n "${TASK_ID:-}" ]; then
  export COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:${_copilot_proxy_port}/v1/copilot/t/${TASK_ID}"
else
  export COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:${_copilot_proxy_port}/v1/copilot"
fi
export COPILOT_PROVIDER_TYPE="openai"
export COPILOT_PROVIDER_API_KEY="rapid-proxy-no-auth-placeholder"
```
> WR-05/D-03 fix shape (from 82-REVIEW, quoted in `<specifics>`): move these out of `agent_pre_launch` into the health-gated `configure_proxy_routing` copilot branch, OR have the unhealthy/interactive branch explicitly `unset COPILOT_PROVIDER_*`. The launcher branch that keeps them (`launch-agent-common.sh` :441-459) is the ALREADY-health-gated home — copy its `if [ -n "${TASK_ID:-}" ]` structure. Interactive copilot (no measured span) then returns to copadt-only capture, killing the WR-02 double-writer.

**Gating precedent:** `configure_proxy_routing()`'s opt-out + health-gate preamble (:388-404) is the pattern — `CODING_PROXY_ROUTE=0` early-return, then `curl -sf .../health` gate, then per-agent `case`. The copilot branch already lives inside that gate; the fix is ensuring copilot BYOK exists ONLY there (measured), never in `copilot.sh`'s always-run `agent_pre_launch`.

---

### `lib/experiments/experiment-runner.mjs` — cell-side BYOK stays (D-03)

**Analog:** itself. `configureProxyRoutingEnv` copilot case (:179-192) is the measured-launch wiring that D-03 says KEEPS the BYOK env (experiment cells are measured by definition):
```javascript
case 'copilot': {
  env.COPILOT_PROVIDER_BASE_URL = taskId
    ? `${base}/v1/copilot/t/${encodeURIComponent(taskId)}`
    : `${base}/v1/copilot`;
  env.COPILOT_PROVIDER_TYPE = 'openai';
  env.COPILOT_PROVIDER_API_KEY = 'rapid-proxy-no-auth-placeholder';
  if (model) env.COPILOT_MODEL = model;
  env.COPILOT_AUTO_UPDATE = 'false';
  break;
}
```
> This is the correct pattern for the D-03 "measured launches only" home — env is built PER-CELL and passed to `launchCell` (:246-250), never exported into the interactive shell. Health-gated at :157-162. The planner's discretion (D-03) is whether the interactive gating lives here, in `launch-agent-common.sh`, or both — this file is the reference for "measured BYOK done right."

---

### `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — CR-01, WR-01, IN-05, WR-06 (D-07/08/09/10)

**Analog:** itself. Four fold-ins, all in-place patches to existing tap/shim handlers.

**CR-01 (D-07) — guard the two unguarded `sanitizeTaskId` call sites.**
- Tap header path (:1999): `const taskId = hdrTaskId ? sanitizeTaskId(hdrTaskId) : resolveLiveTaskId();`
- Shim path segment (:2243-2244): `try { shimPathTaskId = sanitizeTaskId(decodeURIComponent(m[2])); } catch { shimPathTaskId = sanitizeTaskId(m[2]); }`
> The shim site already has a try/catch (:2243-2244); the TAP site (:1999) does NOT — a malformed `x-task-id` that makes `sanitizeTaskId` throw crashes the daemon. Copy the shim's try/catch-to-safe-default shape onto the :1999 site (fall back to `resolveLiveTaskId()` on throw).

**WR-01 (D-08) — kill the ambient-span leak on the `/v1/messages` tap.** The header precedence already exists (:1988-1999) but the EMPTY-header fallback to `resolveLiveTaskId()` (:1999) inherits a concurrent cell's ambient span. D-08 requires an interactive (header-less) row NOT inherit a measured cell's task_id. The WIRE-03 comment block (:1988-1993) documents the intent; the fix tightens the empty-header branch.

**IN-05 (D-09) — parse OpenAI-wire cache fields on the shim path.** The Anthropic tap already parses cache via `parseUsageCache` (:2117, :2143 — `src/usage-cache.ts`), but the shim/copilot completion parse (`completeCopilot` return, :796-800) reads only `prompt_tokens`/`completion_tokens`/`total_tokens` — cache is DROPPED:
```javascript
tokens: {
  input: usage.prompt_tokens || 0,
  output: usage.completion_tokens || 0,
  total: usage.total_tokens || 0,
},
```
> Add `prompt_tokens_details.cached_tokens` (OpenAI's cache-read field) → `cache_read_tokens` so copilot/opencode wire rows carry real cache splits (also at the sibling parse sites :905-907, :1084-1086). Model the extraction on `parseUsageCache`'s pure/never-throw/coalesce-to-0 contract (`src/usage-cache.ts`). Then copadt's session-state merge covers only what the wire genuinely lacks.

**WR-06 (D-10) — unify task-id sanitization across the three binding seams.** The seams:
- raw DB `task_id` (tap :2174, shim `internalBody.task_id` :2315)
- raw in-memory `_ctxMaxByTask` key (:2031-2032 uses `taskId`; :2293-2294 uses `effTaskId = taskId || resolveLiveTaskId()`)
- sanitized breakdown filename (`perRunBreakdownPath` :1592 = `sanitizeTaskId(taskId)`)
> The DB/`_ctxMaxByTask` seams key on the RAW id while the file seam keys on `sanitizeTaskId(id)` — so the same logical id keys differently, breaking the DB↔breakdown-file join the matcher needs. D-10: pick ONE sanitized form and use it at all three seams. `sanitizeTaskId` (imported :49 from `../dist/measurement-span.js`) is the canonical validator — wrap once, key everywhere.

---

### `_work/rapid-llm-proxy/src/token-usage.ts` — D-11 duplicate-id constraint

**Analog:** itself. The composite-PK rebuild (:458-507) and the six PRAGMA-guarded additive-ALTER blocks (:520-623) are the two migration idioms to follow.

**The duplicate-id problem (D-11):** the tap writer (server.mjs :2154 `logTokenCall`) and the adapter writers (coding `token-db.mjs insertTokenRow` :138) both allocate `id` via per-`user_hash` `MAX(id)+1` — but from SEPARATE connections/counters, so concurrent tap+adapter writes to the SAME `user_hash` (both `cladpt`) can collide on `id`. Current PK is `(user_hash, id)` (:423) — a genuine collision would be silently `INSERT OR IGNORE`-dropped on hydrate (:710-717) but the LIVE `insertStmt` (:630-638, no OR IGNORE) would THROW.

**Migration idiom to copy** (additive, PRAGMA-guarded, idempotent, non-fatal — :572-590):
```javascript
const cols4 = db.prepare(`PRAGMA table_info(token_usage)`).all();
const existing = new Set(cols4.map(c => c.name));
for (const col of attributionCols) {
  if (!existing.has(col.name)) db.exec(col.ddl);
}
// whole block wrapped in try/catch → non-fatal stderr, never aborts startup
```
> D-11 is Claude's Discretion on mechanics (SQLite migration + collision-repair of existing rows if needed). Whatever constraint/coordinated-allocation is chosen MUST stay mutually idempotent with the coding-side `ensureCacheColumns` (token-db.mjs :70-78) — the two independent migrations already share this "whichever runs first wins" contract (see the byte-identical-columns note at :600-607). **Build step:** any change here needs `npm run build` in rapid-llm-proxy → `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` (CLAUDE.md proxy deploy loop).

---

## Shared Patterns

### Best-effort / never-throw (D-08)
**Sources:** `token-db.mjs` (:167-172), `stop-adapter-registry.mjs` (:411-416), `measurement-stop.mjs` fixture block (:505-507), proxy `logCall` (:892-894), `parseUsageCache` (pure/coalesce).
**Apply to:** EVERY new surface. The matcher, the sink write, the read API, the proxy patches — all catch, write a `[<tag>] ... (non-fatal): <msg>` stderr line, and return a safe default. A reconciliation failure NEVER fails a run (D-06) and NEVER hard-blocks the close.

### Parameterized SQL only (T-69-sql)
**Source:** `token-db.mjs` `INSERT_SQL`/`DEDUP_SQL`/`MERGE_ON_CACHE_SQL` (:52-58, :184-194); proxy `getSummary` p50 note (:1008).
**Apply to:** the matcher's join/enrich queries. Every value via `?`; task_id/model never interpolated.

### PRAGMA-guarded idempotent additive migration
**Source:** `token-usage.ts` (:520-623) + `token-db.mjs ensureCacheColumns` (:70-78).
**Apply to:** D-11 constraint. The two DBs' migrations must stay mutually idempotent (byte-identical column names/types).

### task_id sanitization
**Source:** proxy `sanitizeTaskId` (`dist/measurement-span.js`, imported server.mjs :49); vkb `_validTaskId` (api-routes.js :735-737).
**Apply to:** CR-01/WR-06 proxy seams AND the D-13 read-API path build. D-07/D-10 WRAP the existing validator — never replace it (code_context: "D-07/D-10 wrap it, don't replace it").

### Provenance stamping (`process` / `user_hash`)
**Source:** `SUBAGENT_PROCESS` (:64), `adapterUserHash` (server.mjs :70-71: `cladpt`/`copadt`/`opcadt`/`mstadt`).
**Apply to:** fallback-provenance tag (D-02) and any new reconcile marker.

### Transient store open→operate→close-in-finally
**Source:** every experiment handler in api-routes.js (`handleRunsQuery` :515-533, etc.).
**Apply to:** N/A for the reconciliation read (it reads a FILE, not the LevelDB — like `handleTimeline`), but noted so the planner does NOT accidentally route it through the experiment store (two-store boundary, :84-86).

---

## Test Analogs (for the acceptance/golden-comparison gate)

| New test need | Copy structure from |
|---------------|---------------------|
| matcher unit tests (match/enrich/fallback/delta) | `tests/token-adapters/token-db-dedup-merge.test.js` — temp-DB + `CREATE_TABLE_SQL` (:43-68) + `openTokenDb`/`insertTokenRowDeduped` (:34-35), four labeled positive/negative cases |
| proxy IN-05 cache-parse | `_work/rapid-llm-proxy/tests/integration/messages-tap-cache-parse.test.mjs` — SSE flat/object fixtures against the SHIPPED `dist/` helper, `LLM_PROXY_LIVE=1` env-gate (NOT argv — memory `reference_node_test_argv_live_gate`) |
| D-11 migration idempotency | `_work/rapid-llm-proxy/tests/integration/token-usage-cache-migration.test.mjs` + `token-usage-schema-migration.test.mjs` |
| golden comparison (routed==transcript, proxy-down==full fallback, healthy==unmatched_wire=0) | Phase-82 wire-verify experiment specs (claude + opencode 2-cell concurrent) — cited in `<code_context>` as the template; live-gate + human checkpoint (Phase-82 house style) |

---

## No Analog Found

None. Every surface has a strong in-file or sibling precedent. The only genuinely NEW artifacts are:
- the **reconcile matcher** (new module OR extension of `captureForegroundTokens`) — but its authority model, join, and enrich are direct generalizations of `insertTokenRowDeduped`.
- the **`reconciliation.json`** file shape — a new schema (D-12), but the WRITE mechanics copy the measurement-stop fixture-archive block and the READ copies `handleTimeline`.

---

## Metadata

**Analog search scope:** `lib/lsl/token/`, `lib/experiments/`, `lib/vkb-server/`, `scripts/`, `config/agents/`, `_work/rapid-llm-proxy/proxy-bridge/`, `_work/rapid-llm-proxy/src/`, `tests/token-adapters/`, `_work/rapid-llm-proxy/tests/integration/`
**Files scanned:** 11 primary surfaces + 4 test analogs read
**Pattern extraction date:** 2026-07-06
