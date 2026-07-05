# Phase 82: Wire-Measurement Foundation (Uniform 4-Agent Proxy Capture) - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/research/uniform-measurement-dossier.md + .planning/phases/81-copilot-byok-verification-spike/81-SPIKE-VERDICT.md)

<domain>
## Phase Boundary

All four agents' (claude, copilot, opencode, mastra) LLM calls land in the proxy's `token_usage` DB with a full cache split (cache_read/cache_write) and correct per-request task binding. Claude experiment cells become proxy-routable (currently deliberately unrouted). Copilot joins via the BYOK seam verified in Phase 81. Concurrent spans (interactive session + N experiment cells) coexist with zero leakage. The OpenAI shim gains native tool-call passthrough so agentic BYOK/opencode loops are real, not text hallucinations.

Out of scope: reconciliation layer (Phase 83), per-turn context-turns persistence (Phase 84), any dashboard UI work (Phases 85–86), avenues (Phase 87).
</domain>

<decisions>
## Implementation Decisions

### Schema (proxy side)
- Idempotent migration in `_work/rapid-llm-proxy/src/token-usage.ts` adding `cache_read_tokens INTEGER NOT NULL DEFAULT 0` and `cache_write_tokens INTEGER NOT NULL DEFAULT 0` — EXACT names the coding-side `ensureCacheColumns` (`lib/lsl/token/token-db.mjs:71,111`) already uses; both migrations must be mutually idempotent (PRAGMA table_info guard style).
- Extend `logCall` insert binding, `getRecent` row shape, `getSummary` bucket aggregates, and the Phase-36 JSON export/hydrate round-trip with the two cache fields. All additive — never break existing consumers.

### /v1/messages tap cache capture
- SSE parser reads `message_start.message.usage.cache_read_input_tokens` and `cache_creation_input_tokens`; handle the newer `cache_creation` object form defensively; same for the non-streaming JSON path. Pass into `logTokenCall`.
- The claim "proxy routing corrupts claude cache accounting" is FALSE — the wire carries cache usage; the tap just never parsed it. This phase fixes that root cause.

### Per-request task binding (kill the ambient singleton)
- `/v1/messages` honors `x-task-id` and new `x-agent` headers with precedence over ambient `resolveLiveTaskId()`, mirroring the shim precedence at `proxy-bridge/server.mjs:2148`. When `x-agent` ≠ claude, stamp `agent`, `process` (`token-adapter-<agent>`), and matching user_hash instead of the hardcoded `cladpt`.
- Launcher header injection:
  - claude: `ANTHROPIC_CUSTOM_HEADERS="x-task-id: <id>"` — set in `scripts/launch-agent-common.sh` `configure_proxy_routing()` AND `lib/experiments/experiment-runner.mjs` `configureProxyRoutingEnv` for cells. VERIFY the env var format live (newline-separated `Name: value`) before relying on it.
  - opencode: provider `options.headers` in the rapid-proxy provider entry (templated per launch), fallback to ambient.
  - mastra: X-Task-Id header / body.task_id (already supported by the shim) — wire the launcher to set it.
  - copilot: NO header seam exists in BYOK (Phase 81 spike verdict #3) — copilot binds via ambient span + dedicated path only.
- `captureBelongsToRun` stays as a secondary guard; header-bound task_ids bypass the ambient file entirely.

### Routing changes
- Remove the `delete env.ANTHROPIC_BASE_URL` claude special-case in `experiment-runner.mjs` (~lines 157–170); keep routing behind the existing `CODING_PROXY_ROUTE` opt-out. Claude cells route through the proxy again.
- Copilot BYOK env for measured launches (interactive launcher + experiment cells): `COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:12435/v1/copilot`, `COPILOT_PROVIDER_TYPE=openai`, `COPILOT_PROVIDER_API_KEY=<placeholder>`, model via `COPILOT_MODEL` (+ `COPILOT_PROVIDER_WIRE_MODEL` when the wire name differs). Drop the "copilot unmeasured" warning in launch-agent-common.sh (~line 435) once verified.
- New dedicated shim path `/v1/copilot/chat/completions` with path-derived default `agent='copilot'` — EXACT mirror of the Phase 70-04 mastra precedent (`/v1/mastra/chat/completions`). BYOK requests were stamped `agent='opencode'` in the spike (probe 1, row 163286).

### Shim tool-call passthrough (HARD requirement — Phase 81 spike gap #1)
- The shim's `internalBody` currently drops `tools[]`/`tool_choice` (server.mjs ~2185) → no native tool_calls ever return → agentic loops through the shim are text hallucinations (spike probe 3: copilot claimed file creation, no file written; opencode v9 run scored goal:null — suspect for the same reason).
- Forward `tools[]`/`tool_choice` through the internal envelope to function-calling-capable providers and map provider `tool_calls` back into the OpenAI chat.completion envelope (including the single-shot SSE reframe for `stream:true` clients).
- Provider capability gating: the copilot HTTP provider supports OpenAI function calling; the claude-code CLI provider CANNOT serve tool calls (spawned with `--tools ''`). When a tools-bearing request would land on a tools-incapable provider, the chain must prefer a capable provider (or fail loudly) — NEVER silently strip tools.
- Acceptance is behavioral: a copilot BYOK (and an opencode) run given a file-creation task must produce the actual file on disk.

### Dedup upgrade
- `insertTokenRowDeduped` (`lib/lsl/token/token-db.mjs:205`) is first-writer-wins today — the cache-less tap row permanently shadows the richer cladpt transcript row (root cause of the claude-cells-unrouted workaround). On dedup hit: if the existing row has `cache_read_tokens + cache_write_tokens = 0` and the incoming row has cache data (or nonzero `reasoning_tokens`), UPDATE those columns in place instead of dropping the incoming row.

### Flag-gated extra
- opencode anthropic-native provider entry (`@ai-sdk/anthropic` → proxy `/v1/messages`) to restore prompt caching + cache-token fidelity on the opencode path. Depends on the x-agent stamping (else rows mis-stamp as cladpt). Verify live that opencode actually sets cache_control breakpoints on this path BEFORE making it default; keep it opt-in this phase.

### Claude's Discretion
- Exact PRAGMA-guard implementation style for the migration (copy token-db.mjs's approach).
- Provider-capability representation (static flag on provider entries vs runtime probe).
- Test file layout and fixture recording approach for the SSE cache-parse unit test.
- Whether /v1/copilot path reuses the isOpenAIShim branch via a path list or a small route table.
- How the launcher templates per-launch opencode headers (env interpolation vs config rewrite).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Program research (the WHY and the verified facts)
- `.planning/research/uniform-measurement-dossier.md` — program plan, per-agent verdicts, caching explainer, user decisions
- `.planning/research/proxy-infra-report.md` — proxy endpoints/taps, schema, adapters, span mechanism (detailed file:line map)
- `.planning/phases/81-copilot-byok-verification-spike/81-SPIKE-VERDICT.md` — live BYOK proof + the 3 gaps this phase closes
- `.planning/spikes/copilot-proxy-interception.md` — § 2026-07-05 revision

### Code surfaces
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` — /v1/messages passthrough (~1913–2095: tap, SSE parse), OpenAI shim (~2126–2218: isOpenAIShim, internalBody, X-Task-Id/X-Agent precedence), /api/complete pipeline
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` — schema + logCall + getSummary/getRecent + export/hydrate (compiled to dist/ via npm run build)
- `lib/lsl/token/token-db.mjs` — ensureCacheColumns (:71,111), insertTokenRowDeduped (:205)
- `lib/experiments/experiment-runner.mjs` — configureProxyRoutingEnv (~140–170, incl. the claude unroute special-case to remove)
- `scripts/launch-agent-common.sh` — configure_proxy_routing() (~370–441)
- `lib/lsl/token/stop-adapter-registry.mjs` — STOP_ADAPTERS + captureForegroundTokens (context for what must keep working; adapter changes are Phase 83)

### Project rules
- `CLAUDE.md` § km-core LLM proxy endpoint (port 12435 contract), § launchd daemons (kickstart com.coding.llm-cli-proxy)
</canonical_refs>

<specifics>
## Specific Ideas

- Spike-verified copilot BYOK invocation (adapt path to /v1/copilot):
  `COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:12435/v1 COPILOT_PROVIDER_TYPE=openai COPILOT_PROVIDER_API_KEY=rapid-proxy-no-auth-placeholder COPILOT_MODEL=claude-haiku-4-5 COPILOT_AUTO_UPDATE=false copilot -p "..." --allow-all`
- Live leakage evidence to regression-test against: v9 opencode task rows contained observation-writer/health-coordinator calls stamped with the cell task_id.
- Verification plan (from the approved program plan): SSE-fixture unit test for tap cache parse; dedup-merge unit test; LIVE 2-cell experiment (claude + opencode) run CONCURRENTLY with the interactive session → per-task rows correct, zero cross-contamination, claude cache_read matches cladpt within tolerance; `GET /api/token-usage/recent` returns cache fields; copilot BYOK file-creation task produces a real file.
- Deploy: proxy src edit → `npm run build` in rapid-llm-proxy → `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` (server.mjs itself is runtime, no build). Restart can mis-detect corporate network — confirm coordinator :3034 location=open BEFORE kickstart (memory: reference_llm_proxy_override_fallback).
</specifics>

<deferred>
## Deferred Ideas

- Reconciliation mode for cladpt/copadt adapters → Phase 83
- Per-turn context-turns JSONL persistence + read APIs → Phase 84
- Dashboard-triggered runs → Phase 85; Timeline v2 → Phase 86; avenues → Phase 87
- Making the opencode anthropic-native provider the default (this phase: flag-gated opt-in only)
- Re-validating past shim-routed opencode experiment results (v7–v9) after tool passthrough lands — new backlog item, not this phase
</deferred>

---

*Phase: 82-wire-measurement-foundation*
*Context gathered: 2026-07-05 via PRD Express Path*
