---
phase: 82-wire-measurement-foundation
verified: 2026-07-06T10:30:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 82: Wire-Measurement Foundation Verification Report

**Phase Goal:** All four agents' LLM calls land in proxy `token_usage` with cache split and per-request task binding: cache-token columns in the proxy schema (names matching coding-side `ensureCacheColumns`), `/v1/messages` tap parses `cache_read/cache_creation` usage (SSE + non-streaming), `x-task-id`/`x-agent` headers honored on `/v1/messages` (kills ambient-singleton leakage), claude experiment cells re-routed through the proxy, copilot BYOK routing per the Phase 81 verdict, and `insertTokenRowDeduped` merges richer rows instead of first-writer-wins. Flag-gated: opencode anthropic-native provider for prompt-cache fidelity.
**Verified:** 2026-07-06T10:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth (WIRE requirement) | Status | Evidence |
|---|---|---|---|
| 1 | WIRE-01: proxy cache-token schema — `cache_read_tokens` / `cache_write_tokens` INTEGER NOT NULL DEFAULT 0 columns, logCall binds, getSummary aggregates, export/hydrate round-trip, byte-identical to coding-side `ensureCacheColumns` | VERIFIED | ALTER block at `src/token-usage.ts:611-612`; `row.cache_read_tokens ?? 0` at `:887-888`; `COALESCE(SUM(cache_read_tokens),0)` at `:963`; integration test 4/4 pass |
| 2 | WIRE-02: `/v1/messages` tap parses `cache_read_input_tokens` + `cache_creation_input_tokens` (flat and object forms) from SSE `message_start.usage` AND non-streaming JSON usage; `total_tokens` still = uIn+uOut | VERIFIED | `parseUsageCache` imported at `server.mjs:51`; called at `:2117` (SSE) and `:2143` (non-streaming); `cache_read_tokens: cacheRead` row field at `:2164-2165`; total = uIn + uOut confirmed at `:2152-2163`; test 4/4 pass |
| 3 | WIRE-03: x-task-id/x-agent headers honored on `/v1/messages` tap with precedence over ambient `resolveLiveTaskId()`; non-claude agents stamp `token-adapter-<agent>` and correct 6-char user_hash; background daemons excluded from ambient span on `/api/complete` | VERIFIED | Header reads at `server.mjs:1994-1995`; `sanitizeTaskId` applied at `:1999`; `adapterUserHash()` maps copilot→copadt, opencode→opcadt, mastra→mstadt at `:70-71`; `isBackgroundProcess()` denylist at `:2675`; background-process-guard test 2/2 pass |
| 4 | WIRE-04: POST `/v1/copilot/chat/completions` is a recognized shim path defaulting `agent='copilot'`; optional `/v1/copilot/t/<taskId>/chat/completions` per-request binding | VERIFIED | `SHIM_PATH_AGENTS['/v1/copilot/chat/completions'] = 'copilot'` at `server.mjs:2229`; task-scoped regex extracts taskId via `sanitizeTaskId(decodeURIComponent(m[2]))` at `:2240-2244` |
| 5 | WIRE-05: shim forwards `tools[]`/`tool_choice` through `internalBody`; copilot provider sends tools in request body and parses `tool_calls` back; response envelope emits `message.tool_calls` + `finish_reason='tool_calls'`; capability gating fails loud (400 NO_TOOL_CAPABLE_PROVIDER) for tools-incapable providers | VERIFIED | `internalBody.tools = oaBody.tools` at `server.mjs:2331-2332`; `gateToolCapableChain` at `:2533`; `buildBufferedChoice`/`buildStreamDelta` from `shim-tools.mjs`; `copilot-provider.ts:133` `supportsFunctionCalling = true`; `base-provider.ts:16` default false; shim-tool-passthrough test 12/13 pass (1 live-skip) |
| 6 | WIRE-06: `insertTokenRowDeduped` enriches a cache-less row on dedup HIT instead of first-writer-wins; genuine duplicate rows still dropped; MAX(reasoning_tokens) preserves transcript-first reasoning | VERIFIED | `UPDATE token_usage SET cache_read_tokens = ?, cache_write_tokens = ?, reasoning_tokens = MAX(reasoning_tokens, ?) WHERE user_hash = ? AND tool_call_id = ?` at `lib/lsl/token/token-db.mjs:194`; dedup-merge test 4/4 pass |
| 7 | WIRE-07: coding-repo routing — claude cells re-route through proxy (unroute workaround removed); claude launches set `ANTHROPIC_CUSTOM_HEADERS` with x-task-id; copilot BYOK env (`COPILOT_PROVIDER_BASE_URL=/v1/copilot/t/<task_id>`) set; opencode anthropic-native provider flag-gated OFF by default; mastra documented ambient-bound | VERIFIED | `delete env.ANTHROPIC_BASE_URL` ABSENT from `experiment-runner.mjs`; `ANTHROPIC_CUSTOM_HEADERS='x-task-id: '+taskId` at `:177`; `COPILOT_PROVIDER_BASE_URL` at `:184-186`; `OPENCODE_ANTHROPIC_NATIVE=1` gate at `opencode.sh:58`; mastra ambient-bound documented at `experiment-runner.mjs:128` |
| 8 | WIRE-08: live verification — proxy rebuilt and restarted; ANTHROPIC_CUSTOM_HEADERS format verified live (sentinel binding); 2-cell concurrent run zero cross-contamination + claude cache matches cladpt; `/api/token-usage/recent` returns cache fields; copilot BYOK + opencode each write a real file on disk | VERIFIED | Plan 06 SUMMARY: Task 1 sentinel row 164372 task_id=verify-82-06-1783271878; Task 2 (human-approved) v2 run rows 164609-164611 cladpt cache_read 47946-72264, zero daemon contamination; Task 3 (human-approved) `/tmp/byok-proof-1783274148.txt` sha256 `565339bc4d33d72817b583024112eb7f5cdf3e5eef0252d6ec1b9c9a94e12bb3` + `/tmp/opencode-proof-1783274148.txt` |

**Score: 8/8 truths verified**

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` | cache-token schema migration + logCall bind + getSummary aggregates + export/hydrate | VERIFIED | 14 `cache_read_tokens` sites, 14 `cache_write_tokens` sites; ALTER block + interface + insertStmt + getSummary + export SELECTs + hydrate INSERT |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-usage-cache-migration.test.mjs` | migration idempotency + logCall persistence + summary/export round-trip assertions | VERIFIED | 4/4 tests pass |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts` | pure `parseUsageCache(usage)` helper — flat + cache_creation-object forms | VERIFIED | Exports `parseUsageCache`; handles both wire forms; never throws; all fields coalesce to 0 |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` | tap cache capture + x-task-id/x-agent binding + /v1/copilot path + internalBody tools forward + response tool_calls mapping + capability gating + background-process denylist | VERIFIED | All greps confirm; no debt markers |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/messages-tap-cache-parse.test.mjs` | fixture-based parseUsageCache assertions (both wire forms + total exclusion) | VERIFIED | 4/5 pass, 1 skip (intentional live-gated) |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/shim-tools.mjs` | pure helpers: shimToolFields, hasToolCalls, resolveShimTaskId, buildBufferedChoice, buildStreamDelta, gateToolCapableChain | VERIFIED | All 6 exports present; used by both runtime and test |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/providers/copilot-provider.ts` | tools/tool_choice in request body + tool_calls parse-back + supportsFunctionCalling=true | VERIFIED | `supportsFunctionCalling = true` at `:133`; `tool_calls` parse at `:344-345` |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/shim-tool-passthrough.test.mjs` | tools forward + tool_calls envelope + capability-gating unit assertions | VERIFIED | 12/13 pass, 1 live-skip |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/background-process.ts` | isBackgroundProcess() denylist (health-coordinator, observation-writer, consolidator-*, token-adapter-*, wave-analysis-*) | VERIFIED | Exact + prefix family denylist confirmed |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/background-process-guard.test.mjs` | denylist regression test | VERIFIED | 2/2 pass |
| `/Users/Q284340/Agentic/coding/lib/lsl/token/token-db.mjs` | merge-on-cache upgrade to `insertTokenRowDeduped` | VERIFIED | `UPDATE token_usage SET cache_read_tokens = ?...MAX(reasoning_tokens, ?)` at `:194` |
| `/Users/Q284340/Agentic/coding/tests/token-adapters/token-db-dedup-merge.test.js` | positive merge + negative drop + empty-tool_call_id + reasoning MAX assertions | VERIFIED | 4/4 pass |
| `/Users/Q284340/Agentic/coding/lib/experiments/experiment-runner.mjs` | claude re-route + ANTHROPIC_CUSTOM_HEADERS + copilot BYOK case | VERIFIED | `delete env.ANTHROPIC_BASE_URL` absent; CUSTOM_HEADERS at `:177`; COPILOT_PROVIDER_BASE_URL at `:184-186` |
| `/Users/Q284340/Agentic/coding/scripts/launch-agent-common.sh` | interactive claude x-task-id header + copilot BYOK env (warning dropped) | VERIFIED | CUSTOM_HEADERS at `:418`; COPILOT_PROVIDER_BASE_URL at `:448-450`; warning absent |
| `/Users/Q284340/Agentic/coding/config/agents/copilot.sh` | BYOK exports | VERIFIED | COPILOT_PROVIDER_BASE_URL at `:74-76` with /v1/copilot path and port 12435 |
| `/Users/Q284340/Agentic/coding/config/agents/opencode.sh` | flag-gated anthropic-native provider entry (default OFF) | VERIFIED | `OPENCODE_ANTHROPIC_NATIVE=1` gate at `:58`; default config byte-identical when unset |
| `/Users/Q284340/Agentic/coding/config/experiments/wire-verify-82-06-v2.yaml` | live-gate experiment spec (v2 re-run after leak fix) | VERIFIED | File exists, contains `wire-verify-82-06-v2` experiment_id with 2-cell (claude + opencode) spec |

---

## Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `TokenUsageRow` | `insertStmt positional bind` | `row.cache_read_tokens ?? 0` | WIRED | `token-usage.ts:887-888` |
| `PRAGMA table_info(token_usage)` | `ALTER TABLE ... ADD COLUMN cache_read_tokens` | existence-guarded standalone ALTER | WIRED | `token-usage.ts:611-612` in cacheCols migration block |
| SSE `message_start.message.usage` | `logTokenCall row.cache_read_tokens / cache_write_tokens` | `parseUsageCache` extraction | WIRED | `server.mjs:2117` (SSE) + `:2143` (non-streaming) → `:2164-2165` |
| `req.headers['x-task-id']` / `['x-agent']` | tap `taskId` / `agent` / `user_hash` | header precedence over `resolveLiveTaskId()` | WIRED | `server.mjs:1994-1999` + `adapterUserHash()` at `:70-71` |
| `oaBody.tools` / `tool_choice` | `internalBody.tools` / `tool_choice` → copilot request body | shim internalBody forward | WIRED | `server.mjs:2331-2332` + `completeCopilot` runtime forward |
| provider `result.toolCalls` | OpenAI envelope `message.tool_calls` + `finish_reason='tool_calls'` | `buildBufferedChoice` / `buildStreamDelta` in response wrap | WIRED | `server.mjs` imports from `shim-tools.mjs` at `:57`; used in envelope |
| `DEDUP_SQL` hit (existing cache-less) | in-place UPDATE of cache/reasoning columns | parameterized UPDATE keyed on (user_hash, tool_call_id) | WIRED | `token-db.mjs:194` — `MERGE_ON_CACHE_SQL` |
| `cell.task_id` | `ANTHROPIC_CUSTOM_HEADERS='x-task-id: <id>'` | experiment-runner claude branch | WIRED | `experiment-runner.mjs:177` |
| `COPILOT_PROVIDER_BASE_URL /v1/copilot` | proxy `/v1/copilot/chat/completions` | copilot BYOK env | WIRED | `experiment-runner.mjs:184-186`; `launch-agent-common.sh:448-450`; `copilot.sh:74-76` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `token-usage.ts` getSummary | `cache_read_tokens`, `cache_write_tokens` | `COALESCE(SUM(...))` over `token_usage` SQLite table | Yes — real DB aggregation | FLOWING |
| `proxy-bridge/server.mjs` tap | `cacheRead`, `cacheWrite` | `parseUsageCache(message_start.message.usage)` from live Anthropic SSE | Yes — live wire parsing | FLOWING |
| `token-db.mjs` insertTokenRowDeduped | `cache_read_tokens`, `cache_write_tokens` | `UPDATE token_usage ... WHERE user_hash = ? AND tool_call_id = ?` parameterized | Yes — real DB UPDATE | FLOWING |
| `experiment-runner.mjs` `configureProxyRoutingEnv` | `ANTHROPIC_CUSTOM_HEADERS` | `taskId` from `opts` (cell task_id at runtime) | Yes — live cell task_id | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| `parseUsageCache` flat form | `node -e "const {parseUsageCache}=require('./dist/usage-cache.js'); const a=parseUsageCache({cache_read_input_tokens:5,cache_creation_input_tokens:8}); if(a.cacheRead!==5||a.cacheWrite!==8) process.exit(1); console.log('ok')"` (in proxy repo) | ok | PASS |
| `parseUsageCache` object form | `parseUsageCache({cache_creation:{x:3,y:4}})` → cacheWrite=7 | Verified by test fixture B (4/4 pass) | PASS |
| token-usage-cache-migration test suite | `node --test tests/integration/token-usage-cache-migration.test.mjs` | 4/4 pass | PASS |
| messages-tap-cache-parse test suite | `node --test tests/integration/messages-tap-cache-parse.test.mjs` | 4/5 pass, 1 intentional live-skip | PASS |
| shim-tool-passthrough test suite | `node --test tests/integration/shim-tool-passthrough.test.mjs` | 12/13 pass, 1 intentional live-skip | PASS |
| background-process-guard test suite | `node --test tests/integration/background-process-guard.test.mjs` | 2/2 pass | PASS |
| token-db-dedup-merge test suite | `node --test tests/token-adapters/token-db-dedup-merge.test.js` | 4/4 pass | PASS |
| dist/ build outputs present | `ls dist/usage-cache.js dist/token-usage.js dist/background-process.js` | All three present | PASS |

---

## Probe Execution

No conventional `probe-*.sh` files declared or expected for this phase. Plan 06 live verification served as the behavioral probe. Both human checkpoints were explicitly approved (Task 2 concurrent run: user-approved after leak fix; Task 3 file-on-disk: user-approved).

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| WIRE-01 | 82-01 | Proxy cache-token schema + logCall/summary/export | SATISFIED | `src/token-usage.ts` ALTER + bind + aggregate + export; test 4/4 |
| WIRE-02 | 82-02 | `/v1/messages` tap cache parse SSE+non-streaming | SATISFIED | `usage-cache.ts` + `server.mjs` tap edits; test 4/5 (1 live-skip) |
| WIRE-03 | 82-02 | x-task-id/x-agent per-request binding, kill ambient singleton | SATISFIED | Header binding + `adapterUserHash` + background-process denylist; test 2/2 |
| WIRE-04 | 82-03 | `/v1/copilot` dedicated shim path + copilot agent stamping | SATISFIED | `SHIM_PATH_AGENTS` table + task-scoped `/t/<taskId>` regex |
| WIRE-05 | 82-03 | Shim tool-call passthrough + capability gating — real files on disk | SATISFIED | `internalBody.tools` + `gateToolCapableChain` + `shim-tools.mjs` + live file proof; test 12/13 |
| WIRE-06 | 82-04 | `insertTokenRowDeduped` merge-on-cache | SATISFIED | `MERGE_ON_CACHE_SQL` UPDATE + `MAX(reasoning_tokens,?)` guard; test 4/4 |
| WIRE-07 | 82-05 | Coding-repo routing: claude re-route + copilot BYOK + headers + flag-gated opencode | SATISFIED | Unroute removed; CUSTOM_HEADERS set; BYOK env in runner + launcher + copilot.sh; opencode flag-gated |
| WIRE-08 | 82-06 | Live verification: concurrent spans, cache fidelity, file-creation | SATISFIED | Plan 06 SUMMARY: sentinel binding Task 1; v2 concurrent run zero-contamination Task 2 (human-approved); byok-proof + opencode-proof files Task 3 (human-approved) |

**Note on REQUIREMENTS.md coverage:** The WIRE-01 through WIRE-08 requirements are defined only in ROADMAP.md (Phase 82 entry), not in REQUIREMENTS.md. REQUIREMENTS.md tracks v7.4 (TELEM/ADAPT/ATTR/etc.) and v7.5 (VALID/SPEC/RUN/CMP/ORCH) milestones, which are distinct requirement series. No WIRE requirements are mapped to Phase 82 in REQUIREMENTS.md — this is an expected documentation structure (Phase 82 is an inter-milestone foundational phase). There are no orphaned REQUIREMENTS.md entries for this phase.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `config/agents/copilot.sh` | 79 | `rapid-proxy-no-auth-placeholder` string in `COPILOT_PROVIDER_API_KEY` | INFO | Intentional — documented non-secret placeholder against localhost no-auth proxy (STRIDE T-82-05-01, accepted). Not a stub. |
| `scripts/launch-agent-common.sh` | 453 | Same placeholder value | INFO | Same as above — consistent intentional usage. |

No `TBD`, `FIXME`, `XXX`, or unresolved debt markers found in any file modified by this phase. The two "placeholder" occurrences are the intentional literal value of the BYOK API key — documented in all three plan threat models as an accepted non-secret residual.

---

## Known Documented Deviations (Accepted per Prompt Context)

The following items are documented deviations from original wording that do not affect the phase goal:

1. **Mastra stays ambient-bound** — no launcher-controlled per-request task binding seam (`MASTRACODE_MODEL_ID` has no base-URL path form). Documented in Plan 05 SUMMARY as an explicit anticipated deviation. Mastra calls still land in `token_usage` via the ambient span; per-request binding is a future enhancement requiring a proxy-side path seam.

2. **COPILOT_PROVIDER_WIRE_MODEL inherited-only** — neither runner nor launcher has a model→wire-name mapping; the env is honored when pre-set by the operator. Documented in Plan 05.

3. **Pre-existing duplicate `id` values in `token_usage`** — writer collision between tap and adapter writers. Does not affect task_id/agent/cache attribution. Noted as a follow-up in Plan 06 SUMMARY.

4. **Copilot haiku narrates instead of tool_calls on large schemas** — model-choice behavior; the acceptance used `claude-sonnet-4.6`. Plan 03 shim passthrough is correct (direct curl confirmed native `tool_calls` in both buffered and streaming modes).

---

## Human Verification Required

None outstanding. Both human verification checkpoints from Plan 06 were explicitly approved by the user during plan execution:

- **Task 2** (2-cell concurrent experiment, zero cross-contamination + cache fidelity) — approved after the mid-gate background-process leak fix (proxy commit `d3f3869`)
- **Task 3** (tool-passthrough behavioral acceptance — real files on disk) — approved with `/tmp/byok-proof-1783274148.txt` and `/tmp/opencode-proof-1783274148.txt` verified on disk

---

## Gaps Summary

None. All 8 WIRE requirements are satisfied. All integration tests pass (20/21 automated — 21st is an intentional live-proxy skip gated on `LLM_PROXY_LIVE=1`). All documented commits exist in both repos. All key wiring verified at all four levels (existence, substantive, wired, data flowing). The live acceptance gate (Plan 06) was completed with explicit human approval on both blocking checkpoints.

---

_Verified: 2026-07-06T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
