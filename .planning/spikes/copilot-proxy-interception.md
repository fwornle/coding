---
id: copilot-proxy-interception
created: 2026-06-04
status: completed
priority: high
tags: [v7.3, spike, copilot, rapid-llm-proxy, prereq]
discovered_in: /gsd-explore v7.3 perf measurement, 2026-06-04
blocks: v7.3 milestone planning (MVP anchor decision)
timebox: 0.5-1 day
completed: 2026-06-04
revised: 2026-07-05 (Phase 81 — BYOK seam found and live-verified; see § 2026-07-05 revision at the end)
recommendation: SUPERSEDED — Copilot CLI CAN proxy-route via COPILOT_PROVIDER_BASE_URL (BYOK, verified live); Approach D (events.jsonl) demoted to cache-split reconciliation source
---

# Spike — Can we measure GitHub Copilot through `rapid-llm-proxy`?

## Question

**Can we route or intercept GitHub Copilot's LLM calls such that token
usage, model choice, tool calls, and timing data are captured into the
same telemetry pipeline that already serves Claude Code?**

A binary answer (yes / no / yes-with-caveats) determines whether v7.3
ships with Claude+Copilot dual-agent coverage or Claude-only.

## Why this matters

- v7.3 [exploration synthesis] selected **Claude + Copilot** as the MVP
  anchor (the two most-used agents). If Copilot interception is
  infeasible, the anchor must drop to **Claude only** and Copilot becomes
  a v7.3 problem alongside OpenCode/Mastra.
- The decision rolls all the way down: anchor choice shapes the per-agent
  adapter contract, the dashboard "Performance" tab's first-render shape,
  and what comparison queries are actually answerable in the v7.3 KB.

## Approaches to test (ranked by preference)

### A) `HTTPS_PROXY` interception via `rapid-llm-proxy`

The proxy already terminates LLM traffic for Claude (`LLM_CLI_PROXY_URL`
= host `:12435`, container `host.docker.internal:12435`). Can we point
Copilot's VS Code extension at the same proxy via standard `HTTPS_PROXY`
env or VS Code `http.proxy` setting?

Investigate:
- Does Copilot honour `http.proxy` for its LLM backend (vs only for
  marketplace traffic)?
- Does Copilot pin certificates? (would block proxy interception)
- What endpoint(s) does Copilot call? GitHub Copilot's backend or OpenAI?
- Can the proxy transparently forward, recording without rewriting?

### B) Per-call OAuth-token capture via `gh copilot` CLI

`gh copilot` shells out via OAuth — same pattern Claude Code uses. If
the CLI variant is in scope (not just the VS Code extension), the proxy
may already be able to intercept it the same way it intercepts Claude.

Investigate:
- Is `gh copilot` what we'd be measuring in practice (CLI sessions) or
  is the VS Code extension the actual usage?
- Does `gh copilot` respect proxy env vars?
- What does the request shape look like? Compare with Claude's calls.

### C) Editor-side telemetry tap

If neither A nor B works, scrape Copilot's local telemetry: VS Code's
output channel, language-server logs, or the extension's own usage logs.

Investigate:
- Does Copilot expose a stable telemetry surface locally?
- Does it include token counts and model names, or only request counts?
- Stability: would a Copilot update break this?

### D) Out-of-band measurement

Last resort: don't intercept calls, but record `before`/`after` workspace
diffs + LSL transcript of *user-visible* events + a manual estimate of
tokens-per-action. Only useful as a fallback if A/B/C all fail; would
mean Copilot Runs in the KB have lower-fidelity telemetry than Claude
Runs (acknowledged asymmetry, with a flag on the Run entity).

## Acceptance criteria

The spike completes when we have a written answer for each:

1. **Which approach works?** A, B, C, D, or none.
2. **Coverage gap vs Claude.** What telemetry can we get from Copilot
   that we get from Claude, and what's missing? (tokens — yes/no, model
   id — yes/no, tool calls — yes/no, timing — yes/no)
3. **Cost.** Implementation cost of the working approach (LoC, services
   touched, ongoing maintenance overhead).
4. **Recommendation.** Ship v7.3 with Copilot in-scope (and which
   approach), OR ship Claude-only and defer Copilot.

## Out of scope for this spike

- Productionising the chosen approach (that's a v7.3 phase).
- OpenCode / Mastra (separate spikes when their phase comes up).
- Any code changes to `rapid-llm-proxy` (this spike is research only;
  implementation is a milestone-phase task).

## Outputs

- Append findings to this file under `## Findings` heading.
- If recommendation is "drop Copilot from MVP", update the v7.3
  exploration note D6 accordingly.

## Findings

Investigation covered direct source reads of the proxy provider, a sample of
`~/.copilot/session-state/<uuid>/events.jsonl`, the existing Phase 51
adapter, and the in-project OpenCode config. Verdicts per approach:

### A — `HTTPS_PROXY` interception via `rapid-llm-proxy`

**Verdict:** PARTIAL.

The proxy ships a complete Copilot HTTP client at
`node_modules/@rapid/llm-proxy/src/providers/copilot-provider.ts:265-340`.
It reads the OAuth Bearer token from
`~/.local/share/opencode/auth.json` (line 20), constructs the
OpenAI-compatible request, extracts `usage = {prompt_tokens,
completion_tokens, total_tokens}` from the response (lines 318-322), and
returns `{tokens: {input, output, total}, model, latencyMs}` (lines
327-340). `HTTPS_PROXY` is honoured via an HTTP CONNECT tunnel agent
(lines 50-69) with no certificate pinning. The proxy's
`attachTokenLogger` (`integrations/mcp-server-semantic-analysis/src/utils/token-usage-logger.ts:107-128`)
appends per-call rows to `.observations/token-usage.db`.

Coverage: tokens YES, model_id YES, timing YES, tool_calls partial
(present in the request body but not extracted into a structured field).

**Critical caveat:** this provider serves calls that the proxy ITSELF
executes when a caller posts to `/api/complete` with `provider=copilot`.
It does NOT intercept user-driven `gh copilot` CLI invocations or the
VS Code Copilot Chat extension — those bypass the proxy entirely.

### B — `gh copilot` CLI OAuth capture

**Verdict:** SUBSUMED by A.

The OAuth token path (`~/.local/share/opencode/auth.json`) is the same.
`gh copilot` reads it from the same file. There is no distinct
implementation surface; if A is built out, B is implicit.

### C — Editor-side telemetry tap

**Verdict:** INFEASIBLE for VS Code Copilot Chat.

Chat session history lives in VS Code's `state.vscdb` LevelDB
(per `.planning/phases/51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as/51-RESEARCH-copilot.md`).
The DB is opaque while VS Code is running and proprietary in shape.
No stable telemetry surface exposes per-call token data.

Per the AskUserQuestion scope decision documented in `## Recommendation`
below, VS Code Copilot Chat is out of milestone scope. This approach
falls away.

### D — Out-of-band reconstruction from `events.jsonl`

**Verdict:** WORKS, with documented limitations.

The Copilot CLI persists per-session telemetry at
`~/.copilot/session-state/<uuid>/events.jsonl`. A direct sample from
session `002356c5-…` confirms the `session.shutdown` event carries:

```
modelMetrics.<model-id>.usage = {
  inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens
}
```

plus session-level `currentModel`, `totalApiDurationMs`,
`totalPremiumRequests`, and code-change counts (linesAdded, linesRemoved,
filesModified). The `session.start` event carries `selectedModel` and
project context (cwd, gitRoot, branch, repository).

The Phase 51 adapter at `lib/lsl/adapters/copilot-events.mjs` already
walks these files for sub-agent lifecycle bookends. The Path-D
implementation extends that adapter to extract `session.shutdown.modelMetrics`
and emit token-usage rows.

**Documented limitations:**

- Sub-agents share the parent session UUID; `session.shutdown.modelMetrics`
  aggregates at session level, not per `toolCallId`. Per-sub-agent token
  attribution requires apportioning by activity-duration proxy or is
  reported at session-level only.
- Sub-agent rows are stamped `lsl_incomplete: true` (line 227 of the
  adapter) because inner reasoning is not present in events.jsonl, only
  bookend lifecycle events.
- Per-turn token granularity from `assistant.turn_start`/
  `assistant.turn_end` events is unverified — the milestone's Phase 1
  task lists distinct event `type:` values and checks whether
  `model.request` (or similar) events carry per-call usage payloads.

### Cross-agent context discovered during the spike

Two findings discovered while investigating Copilot have broader
implications for the milestone:

- **Claude Code persists per-turn `usage` blocks** in
  `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`. A sample
  shows: `"usage": {input_tokens, cache_creation_input_tokens,
  cache_read_input_tokens, output_tokens, server_tool_use:
  {web_search_requests, web_fetch_requests}}` on every assistant
  message. Per-turn granularity is the maximum Claude offers.
- **OpenCode in this project uses Copilot at the API layer.**
  `~/.config/opencode/opencode.json` configures
  `"model": "github-copilot/claude-opus-4.6"` and
  `"enabled_providers": ["github-copilot"]`. OpenCode's LLM calls go
  through the same OAuth path the `CopilotProvider` reads. Routing
  OpenCode through the proxy as the Copilot provider surfaces per-call
  usage via the same `attachTokenLogger` event path.

## Recommendation

Ship Copilot CLI in the Performance Measurement milestone via Approach D
(events.jsonl reading). The granularity tier is `per-session-aggregate`
out of the gate, with a `per-turn` upgrade contingent on the Phase 1
event-vocabulary verification.

VS Code Copilot Chat is out of milestone scope (user decision recorded
via AskUserQuestion at exploration time).

For OpenCode and Mastra, the milestone reaches them through different
ingestion paths than Copilot:

- **OpenCode** ingestion path: configure OpenCode's model endpoint at
  the proxy and capture per-call usage via `attachTokenLogger`. Detail
  shape is documented in
  `.planning/notes/v73-token-attribution-contract.md`.
- **Mastra** ingestion path: identified as a Phase 1 investigation task.
  The project hosts `.opencode/mastra.json`; the runtime surface and
  instrumentation hooks require direct read of that config.

The corresponding D6 rewrite of
`.planning/notes/v73-perf-measurement-exploration.md` captures the
verified per-agent reality so the milestone roadmap reflects what is
actually reachable.

## Cross-refs

- [Note: v73-perf-measurement-exploration](../notes/v73-perf-measurement-exploration.md) — D6
- [Note: v73-token-attribution-contract](../notes/v73-token-attribution-contract.md) — cross-agent storage + measurement-span design
- [Memory: reference-llm-proxy-corp-wrapper](../../.claude/projects/-Users-Q284340-Agentic-coding/memory/reference_llm_proxy_corp_wrapper.md) — proxy wrapper architecture
- [Memory: feedback-perf-measurement-requirements](../../.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_perf_measurement_requirements.md) — per-step time-series requirement
- `CLAUDE.md` § km-core LLM proxy endpoint — `:12435` contract

---

## 2026-07-05 revision (v7.5 Phase 81) — BYOK seam found; original verdict OVERTURNED

The 2026-06-04 conclusion ("no base-URL override — Approach D only") missed
`copilot help environment`, which documents a full BYOK provider seam. Verified
live on Copilot CLI **1.0.68** against rapid-llm-proxy `:12435`:

### What was proven (live probes, scratchpad/byok-spike)

1. **Routing works.**
   `COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:12435/v1` +
   `COPILOT_PROVIDER_TYPE=openai` + `COPILOT_MODEL=claude-haiku-4-5` →
   one-shot prompt answered THROUGH the proxy. The request hit the
   `/v1/chat/completions` shim and produced token_usage row id=163286
   (`input=6208 / output=8`), exactly matching copilot's own footer
   (`↑6.2k ↓8`). Reply rendered correctly (single-shot SSE reframe).
2. **`COPILOT_PROVIDER_TYPE=anthropic` reaches `/v1/messages` but 401s** —
   the passthrough forwards the placeholder key verbatim to
   api.anthropic.com. Viable only with real Anthropic credentials, which
   defeats the purpose (GHE-billed models). → openai type is the route.
3. **Auth**: `COPILOT_PROVIDER_API_KEY` accepts a placeholder for the local
   proxy (same convention as opencode's rapid-proxy provider).

### Gaps surfaced (feed v7.5 Phase 82 scope)

- **The shim drops `tools[]`** — `internalBody` forwards only
  model/messages/agent/tier/process (server.mjs ~2185), so NO native
  tool_calls flow through it. Probe 3 (file-creation task) produced a
  single LLM call whose text CLAIMED success; no file was written.
  ⇒ Native tool-call passthrough is a HARD Phase 82 requirement for
  agentic BYOK copilot — and re-opens the question whether past
  shim-routed opencode experiment runs really executed tools
  (v9 opencode run scored `goal: null`; its "success" text is suspect).
  The claude-code CLI provider cannot serve tool calls (`--tools ''`);
  the copilot HTTP provider (function-calling capable) can.
- **Agent mis-stamping**: BYOK requests default to `agent='opencode'`
  (path-derived). Copilot cannot set headers/body fields ⇒ add a
  dedicated `/v1/copilot/chat/completions` path (mirrors the
  Phase 70-04 mastra precedent).
- **No per-request identity seam** in BYOK (no custom headers) ⇒ copilot
  task binding stays ambient-span (+ dedicated path) until upstream adds one.
- **Ambient-span leakage seen live**: v9 opencode task rows include
  observation-writer/health-coordinator background calls stamped with the
  cell task_id — confirms Phase 82's x-task-id header-binding priority.

### Revised recommendation

Copilot CLI joins the wire-measured set via BYOK (openai type, dedicated
copilot path, tool-call passthrough — all Phase 82). `copadt`
events.jsonl reading is demoted from primary capture to
**cache-split reconciliation** (BYOK/OpenAI usage lacks the
cacheRead/WriteTokens split that session-state provides).
