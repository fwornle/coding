# Uniform 4-Agent LLM Measurement + Performance Analysis Tool

## Context

Recurring frustration: inconsistent claims about which coding agents can/can't be measured at the proxy, conceptual instead of real context-window numbers, a cluttered performance page, and no way to measure/branch interactive work. Deep research (3 explorers + 1 design agent, findings verified in code) established that **all 4 agents (claude, copilot, opencode, mastra) CAN be wire-level measured through rapid-llm-proxy**:

- **Copilot CLI has a documented BYOK seam** — `COPILOT_PROVIDER_BASE_URL` / `COPILOT_PROVIDER_TYPE` / `COPILOT_PROVIDER_WIRE_MODEL` env vars route its LLM calls to any endpoint (our proxy), overturning the 2026-06-04 spike's "no seam" verdict (`.planning/spikes/copilot-proxy-interception.md` — must be corrected).
- **Claude proxy-routing does NOT corrupt cache accounting.** Verified in code: the `/v1/messages` tap (proxy-bridge/server.mjs ~1913–2095) simply never parses `cache_read_input_tokens`/`cache_creation_input_tokens` from the SSE stream, and `insertTokenRowDeduped` (coding `lib/lsl/token/token-db.mjs:205`) is first-writer-wins — so the cache-less tap row shadows the accurate cladpt transcript row. That's why `experiment-runner.mjs:157-170` unroutes claude cells. Implementation bug, not a limitation.
- **Proxy token_usage schema has NO cache columns** (`rapid-llm-proxy/src/token-usage.ts`); the coding side lazily ALTERs `cache_read_tokens`/`cache_write_tokens` in (`token-db.mjs:71,111`) but the proxy's `logCall` never binds them. Migration needed on the proxy side with the SAME column names.
- **`X-Task-Id` header binding already works on the OpenAI shim** (server.mjs:2148) but not on `/v1/messages` (ambient singleton `active-measurement.json` only) — root cause of span leakage.
- **How caching actually works** (user asked): the client re-sends the FULL context buffer every turn; caching is server-side — prefix hashed up to `cache_control` breakpoints; hits billed as `cache_read_input_tokens` (~0.1×), writes ~1.25×. "What was sent" = everything each turn; "what came from cache" is visible only in response usage. Copilot's backend caches internally (reports cacheReadTokens in session-state). This becomes the explainer copy in the UI.
- `.data/llm-proxy/token-usage.db`, `.data/experiments/leveldb`, `.data/run-snapshots` are gitignored ⇒ measurement data survives branch switching (verified via `git check-ignore`) — the avenue/branch concept is safe.

**User decisions:** (1) Copilot BYOK for measured runs — yes, spike first. (2) Full per-turn request payloads for measured runs (gzipped, retention policy); unmeasured live session keeps latest-snapshot. (3) Execute as **GSD phases appended to the v7.5 milestone** (Phase 79+).

## Plan

**Step 1 after approval:** add the phases below to `.planning/ROADMAP.md` (via `/gsd-phase` add), archive this dossier as research input (e.g. `.planning/research/uniform-measurement-dossier.md` + the proxy report from scratchpad), then start Phase 79. Each phase then follows normal GSD discuss→plan→execute with the research below pre-seeded.

### Phase 79 — Copilot BYOK verification spike (gates copilot scope)
Live probes, no product code:
- Launch `copilot` with `COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:12435/v1`, `COPILOT_PROVIDER_TYPE=openai`, one-shot prompt → confirm traffic hits `/v1/chat/completions`, model mapping via `COPILOT_PROVIDER_WIRE_MODEL`, served by proxy provider chain (its copilot HTTP provider → bmw.ghe.com — same backend, now measured), streaming + tool calls intact.
- Try `COPILOT_PROVIDER_TYPE=anthropic` → does it hit `/v1/messages` (would give wire cache markers)?
- Determine per-request identity seam (headers?) for task binding.
- Update `.planning/spikes/copilot-proxy-interception.md` with the verdict.
- Fallback if BYOK fails: copilot stays copadt-primary; uniformity = 3 wire + 1 reconciled; surface immediately.
Verify: copilot-stamped rows in `sqlite3 .data/llm-proxy/token-usage.db`.

### Phase 80 — Wire-measurement foundation (the keystone)
All 4 agents' calls land in token_usage at the proxy with cache split + correct task binding; claude cells become routable; concurrent spans don't leak.
- **80a schema**: idempotent migration in `rapid-llm-proxy/src/token-usage.ts` adding `cache_read_tokens`/`cache_write_tokens` (exact names token-db.mjs uses; mutually idempotent PRAGMA-guarded); extend `logCall`, `getRecent`, `getSummary`, JSON export/hydrate. `npm run build` + `launchctl kickstart com.coding.llm-cli-proxy`.
- **80b tap cache capture**: `/v1/messages` SSE parser + non-streaming path read `cache_read_input_tokens`/`cache_creation_input_tokens` (handle newer `cache_creation` object form) → logTokenCall.
- **80c per-request task binding (kill the ambient singleton)**: honor `x-task-id`/`x-agent` headers on `/v1/messages` (precedence over `resolveLiveTaskId()`, mirroring shim :2148); stamp agent/process/user_hash from `x-agent` instead of hardcoded cladpt. Launcher injection: claude `ANTHROPIC_CUSTOM_HEADERS="x-task-id: <id>"` (verify format live) in `scripts/launch-agent-common.sh` + `experiment-runner.mjs configureProxyRoutingEnv`; opencode provider `options.headers`; mastra body/header (already supported); copilot per Phase-79 verdict. `captureBelongsToRun` stays as secondary guard.
- **80d route claude cells + copilot**: remove `delete env.ANTHROPIC_BASE_URL` claude special-case in `experiment-runner.mjs`; add copilot BYOK env; mirror in launch-agent-common.sh; drop the "copilot unmeasured" warning once verified.
- **80e dedup upgrade**: `insertTokenRowDeduped` merges richer rows — on dedup hit with existing cache-less row and incoming cache/reasoning data, UPDATE in place.
- **80f (flag-gated)**: opencode anthropic-native provider entry (`@ai-sdk/anthropic` → `/v1/messages`) to restore prompt caching; verify it actually sets cache_control before defaulting.
Verify: SSE-fixture unit test for tap cache parse; dedup-merge test; LIVE 2-cell experiment (claude+opencode) concurrent with interactive session → per-task rows correct, zero cross-contamination, claude cache_read matches cladpt within tolerance; `/api/token-usage/recent` returns cache fields.

### Phase 81 — Reconciliation layer (adapters verify/enrich, never double-count)
- New `'reconcile'` mode in `lib/lsl/token/stop-adapter-registry.mjs`: claude transcript rows matched to wire rows by request-id (fuzzy time+model secondary for retry mismatches) → compare, flag deltas; unmatched transcript rows (proxy down) insert as fallback; `:reason:` rows always insert.
- Copilot: merge copadt session.shutdown cache split into wire rows (time-window+model match), provenance-noted.
- Discrepancy sink `.data/measurements/<span>/reconciliation.json` written by measurement-stop; dashboard badge later.
Verify: golden comparison (routed claude cell totals == pre-change transcript-only totals); proxy-down cell → full transcript fallback; reconciliation shows unmatched_wire=0.

### Phase 82 — True per-turn context revelation
Persist EVERY measured request (not keep-largest) paired with response usage.
- Storage: `.data/llm-proxy/context-turns/<task_id>.jsonl` (append live, gzip at span close / idle compaction); optional full raw bodies `context-turns-raw/<task_id>/<seq>.json.gz` behind `LLM_PROXY_SNAPSHOT_FULL=1`; retention via `/api/llm/settings` (30d/200 runs; raw 14d). One line per request: seq, request_id, agent/endpoint/model, `analyzeAnthropicRequest`/`analyzeOpenAIRequest` output extended with cache-breakpoint POSITIONS + per-message digests (role, kinds, bytes, tool_use names+args digest, tool_result sizes — the wire request contains full history, so this alone reconstructs per-turn actions for ALL agents), paired usage {input, output, cache_read, cache_write}.
- Read APIs: proxy `GET /api/context-turns?task_id=`; vkb pass-through `GET /api/experiments/runs/:taskId/context-turns` in `lib/vkb-server/api-routes.js`.
- Extend `context-cache-explainer.tsx` with the honest per-turn "sent X / cached Z / fresh W (+breakpoints)" strip and the caching explainer copy (OpenAI-wire caveat included).
Verify: 5-turn claude cell → 5+ JSONL lines, hist bytes monotonic, cache_read jumps after turn 1; e2e fetch via vkb route.

### Phase 83 — Experiment control center (launch from dashboard)
- `POST /api/experiments/run` (new `lib/experiments/run-trigger.mjs`): materialize effective spec (spec_path/inline + overrides agents/models/frameworks/envs/repeats/timeout) into `.data/experiments/triggered/<run_id>/`, spawn detached `experiment-run.mjs --progress-file …` (unref, log file); `GET /api/experiments/run-status/:runId`; `POST run-cancel` (SIGTERM pgid); `rerun_of: <task_id>` loads that run's spec+snapshot_id from LevelDB and applies overrides (same snapshot ⇒ apples-to-apples).
- `experiment-run.mjs`: additive `--progress-file` flag.
- Dashboard: `experiment-launcher.tsx` (pickers, spec preview), thunks in `performanceSlice.ts`, "Re-run with changes" on runs-table rows.
Verify: e2e `tests/e2e/performance/experiment-launch.spec.ts` — 1-cell haiku smoke via UI → completes → appears in table; gsd-browser visual check; spawn never blocks vkb event loop; spec path allowlisted.

### Phase 84 — Timeline v2 + declutter
- Timeline v2 (`components/performance/timeline.tsx` → split into `timeline/` subcomponents): per turn = user-prompt excerpt, assistant action summary (tool names + args digests), token cost with cache split, per-turn stacked context band (sys/tools/know/hist/tout/user from context-turns), reasoning sub-bands retained; per-turn drill-down modal (breakpoints, fresh-vs-cached bar, raw link); join seq↔token row by request_id==tool_call_id.
- IA declutter: timeline becomes route-level drawer/fullscreen (`?run=<id>&view=timeline`); quarantine toggle surfaced as toolbar chip; compare-from-selection → RunCompare; one-step score editing; reconciliation badge per run (small vkb route).
- Graceful degradation for old runs without context-turns (404 → today's token-only rows).
Verify: e2e timeline-v2 + declutter specs with seeded fixture; gsd-browser visual verification (per feedback memory: never claim UI works from DB queries).

### Phase 85 — Interactive spans + branch avenues
- `measurement-start.mjs`: record `origin_snapshot_id`; capture initial prompt at first bound tap (`.data/measurements-meta/<task_id>/initial-prompt.txt`; fallback --goal).
- New `scripts/avenue-run.mjs` + `lib/experiments/avenue-runner.mjs` (reuse launchCell/restore internals): `git worktree add ../coding-avenues/<avenue_task_id> -b avenue/<avenue_task_id> <origin commit>` (PERSISTENT, unlike restoreForCell's throwaway), run agent headless with the initial prompt + overridden params, measurement wrapped, `writeRun` with `{origin_task_id, origin_snapshot_id, avenue_branch, branch_status}`. `LLM_PROXY_DATA_DIR` stays MAIN .data (branch-independent, verified).
- APIs: `GET /api/experiments/avenues?origin=`, `POST /api/experiments/avenues/run` (detached pattern from Phase 83); prune command + guarded delete (refuse unmerged).
- Dashboard: Avenues grouping (origin span header, children with merged/open branch chips), "Fork avenue…" on MeasurementControl / completed spans, inline avenue compare.
- UI copy sets expectations: avenue re-runs the INITIAL prompt, not the full dialogue.
Verify: live — start span here, stop, launch 2 avenues (claude-sonnet vs opencode) → 2 `avenue/*` branches, both comparable in dashboard, rows correctly attributed, main untouched; merge one → chip flips.

## Dependencies / ordering
79 gates copilot scope in 80. 80 is keystone (correct uniform numbers even with today's UI). 81 needs 80. 82 needs 80, feeds 84. 83 parallelizable with 82. 84 needs 80+82 (+81 badge). 85 needs 80+83. Each phase independently shippable.

## Critical files
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — tap cache parse, x-task-id/x-agent on /v1/messages, context-turns writer, /api/context-turns
- `_work/rapid-llm-proxy/src/token-usage.ts` — cache-column migration, logCall/getSummary/getRecent/export
- `coding/lib/experiments/experiment-runner.mjs` — re-route claude cells, copilot BYOK env, header injection; avenue reuse
- `coding/lib/lsl/token/token-db.mjs`, `coding/lib/lsl/token/stop-adapter-registry.mjs` — dedup merge, reconcile mode
- `coding/lib/vkb-server/api-routes.js` — run-trigger/status/cancel, context-turns pass-through, avenues, reconciliation
- `coding/integrations/system-health-dashboard/src/components/performance/*` + `src/store/slices/performanceSlice.ts` — launcher, timeline v2, avenues UI

## Deploy mechanics (per CLAUDE.md)
Proxy: edit src/ → `npm run build` → `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` (server.mjs is runtime — no build needed for it). Dashboard frontend: `npm run build` + `supervisorctl restart web-services:health-dashboard-frontend`. vkb-server/backend: container restart. All API changes strictly additive. E2E in `tests/e2e/performance/`; visual verify via gsd-browser.

## Verification (program-level acceptance)
1. One command runs the same task across all 4 agents; dashboard shows for EACH: per-call token rows (in/out/cache_read/cache_write) captured at the proxy + a real per-turn context-window band with actual bytes/tokens. No conceptual placeholders for any agent.
2. Open any measured run → timeline tells the story per turn (prompt, tool calls, cost, cache split, context growth).
3. Launch + re-run experiments from the dashboard with param overrides; live progress.
4. Start a span in an interactive session, fork ≥2 avenues on branches, compare them, merge one — measurements intact across branches.
