# Phase 81 — Copilot BYOK Verification Spike: VERDICT

**Date:** 2026-07-05 · **Copilot CLI:** 1.0.68 · **Proxy:** rapid-llm-proxy build 01a4758, `:12435` (public network — enterprise upstream unreachable, claude-code provider served)

## Verdict: BYOK ROUTING CONFIRMED ✅ (with 3 Phase-82 work items)

### Probe results

| # | Probe | Result | Evidence |
|---|-------|--------|----------|
| 1 | `COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:12435/v1`, `TYPE=openai`, `COPILOT_MODEL=claude-haiku-4-5`, one-shot text prompt | ✅ Answered through the proxy ("BYOK-OK", 22s) | token_usage row id=163286: `input=6208 / output=8` — exactly matches copilot's own footer `↑6.2k ↓8`. Hit `/v1/chat/completions` shim → `/api/complete` → provider chain. |
| 2 | Same but `TYPE=anthropic`, base `:12435` | ⚠️ Reaches `/v1/messages` but **HTTP 401** | Passthrough forwards the placeholder key verbatim to api.anthropic.com. Only viable with real Anthropic creds (defeats GHE billing). → **openai type is the route.** |
| 3 | Tool-using task (create a file) via openai type | ❌ **No tool execution** — single LLM call, model TEXT claimed success, no file written | Root cause: the shim's `internalBody` forwards only model/messages/agent/tier/process — **`tools[]` is dropped** (server.mjs ~2185), so no `tool_calls` can ever come back. Claude-code CLI provider is additionally tools-off by design (`--tools ''`). |

### Phase-82 work items surfaced

1. **Native tool-call passthrough through the shim** (HARD requirement): forward `tools[]`/`tool_choice` to function-calling-capable providers (copilot HTTP provider) and map `tool_calls` back into the OpenAI envelope. Without it no BYOK copilot (and possibly no opencode) agentic loop is real. **Collateral finding:** shim-routed opencode experiment runs are suspect for the same reason — v9 opencode run scored `goal: null`; its "created fizzbuzz" reply may be hallucinated text. Past shim-based experiment results should be re-validated after tool passthrough lands.
2. **Dedicated `/v1/copilot/chat/completions` path**: BYOK requests were stamped `agent='opencode'` (path-derived default); copilot cannot set X-Agent headers or body fields. Mirrors the Phase 70-04 mastra precedent.
3. **No per-request identity seam in BYOK** (no custom-header env): copilot task binding stays ambient-span + dedicated path. The x-task-id header binding planned for claude/opencode/mastra does not apply to copilot.

### Live confirmation of the ambient-span leakage problem

The v9 opencode run's task_id rows include `observation-writer` / `health-coordinator` background calls stamped with the cell's task_id — direct evidence for Phase 82's header-binding priority.

### Scope decision

- Copilot wire measurement: **IN** for Phase 82 (BYOK openai type + dedicated path + tool passthrough).
- `copadt` (session-state events.jsonl): demoted to **cache-split reconciliation** (BYOK/OpenAI usage has no cacheRead/Write split; session.shutdown modelMetrics does) — Phase 83.
- Spike doc updated: `.planning/spikes/copilot-proxy-interception.md` § 2026-07-05 revision (original "no seam" verdict overturned).

### Reproduction commands

```bash
# working route
COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:12435/v1 \
COPILOT_PROVIDER_TYPE=openai \
COPILOT_PROVIDER_API_KEY=rapid-proxy-no-auth-placeholder \
COPILOT_MODEL=claude-haiku-4-5 \
COPILOT_AUTO_UPDATE=false \
copilot -p "..." --allow-all
```
