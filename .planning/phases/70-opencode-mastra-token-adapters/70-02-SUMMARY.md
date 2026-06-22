---
phase: 70-opencode-mastra-token-adapters
plan: 02
type: execute
status: complete
requirements: [ADAPT-03]
completed: 2026-06-22
---

# Plan 70-02 Summary — OpenCode Provider Wiring + Live Token-Attribution Gate

## Outcome

**ADAPT-03 fully closed (SC-1/SC-2).** A real OpenCode session now drives its LLM
calls through the rapid-llm-proxy shim, renders replies normally, **and** lands
`token_usage` rows stamped `agent='opencode'`, `granularity_tier='per-llm-call'`.

Live-verified end-to-end (operator-confirmed):
- OpenCode `--model rapid-proxy/claude-haiku-4-5`, prompt "say hi" → reply rendered
  (`Claude Haiku 4.5 (via proxy) · 2.6s`).
- Rows **126876** (`agent=opencode`, 572 tok) and **126877** (`agent=opencode`,
  9147 tok) — the 9147 matches OpenCode's own context panel exactly.

## What was built

### Task 1 — OpenCode provider config (the plan's declared file)
Additive `provider.rapid-proxy` block in `~/.config/opencode/opencode.json`
(OpenAI-compatible, `@ai-sdk/openai-compatible`), `baseURL: http://localhost:12435/v1`,
non-secret placeholder apiKey. `enabled_providers` → `["github-copilot", "rapid-proxy"]`
(existing github-copilot setup preserved; the proxy provider is an additive switch).
Final contents:

```json
"provider": {
  "rapid-proxy": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "Rapid LLM Proxy (token-attribution shim)",
    "options": { "baseURL": "http://localhost:12435/v1", "apiKey": "rapid-proxy-no-auth-placeholder" },
    "models": {
      "claude-haiku-4-5": { "name": "Claude Haiku 4.5 (via proxy)" },
      "claude-opus-4.6":  { "name": "Claude Opus 4.6 (via proxy)" }
    }
  }
}
```

### Task 2 — Live gate (human-verified)
Surfaced as a `blocking-human` checkpoint; operator drove the real OpenCode call and
confirmed. The first attempts failed with a downstream `Claude API error (400):
"Third-party apps now draw from your extra usage, not your plan limits"` — which
triggered the deviations below.

## Deviations (in-scope fixes to close the gate)

The plan declared only `opencode.json`, but closing the gate required three
**rapid-llm-proxy** fixes (separate repo, `proxy-bridge/server.mjs`, commit
`5f02957`) plus one routing-config change. All discovered by capturing OpenCode's
real inbound request (it sends `stream:true`, 42 tools, no `process`/`X-Agent`):

1. **Per-agent routing** — shim now defaults `internalBody.process` to the agent
   name when the client sends none, so operator `processOverrides` can route it.
   Root cause: OpenCode's untagged agentic payload fell to the `claude-code`-first
   chain, which hard-400s on the Claude plan-limit policy with **no fallback** (a
   400 is non-retryable). Small synthetic prompts dodged the limit, masking it.
2. **Routing override** (`/.data/llm-proxy/llm-settings.json`, not git-tracked):
   added `opencode → copilot` and `mastra → copilot` (mirrors the existing
   `health-coordinator`/`wave-analysis → copilot` overrides). copilot is HTTP +
   healthy; this bypasses the limit-blocked claude-code path (with fallback intact).
3. **Copilot model canonicalization** — `resolveCopilotModel()` now canonicalizes
   full upstream model ids (`claude-haiku-4-5` dash form) to the dot form Copilot
   expects (`claude-haiku-4.5`); Copilot otherwise 400s "model not supported."
4. **Minimal SSE framing** — the shim re-frames its buffered result as a single-shot
   SSE stream (content delta + finish/usage + `[DONE]`) when `stream:true`, so
   OpenCode renders the reply. Single-pipeline D-02 design preserved (not
   incremental token streaming). Operator chose this over deferring streaming.

## Notes / carry-forward

- **task_id was `''`** on the verified rows because no measurement span was active
  (`.data/active-measurement.json` absent) — the documented acceptable case. The
  `body.task_id ?? resolveLiveTaskId()` precedence is contract-tested in 70-01.
- **Plan 04 (Mastra) benefits directly**: the `mastra → copilot` override + the
  per-agent `process` default mean Mastra's Track-A path (X-Agent: mastra) routes
  through the healthy provider with zero further proxy changes.
- The `opencode.json` and `llm-settings.json` live outside the git repo (`$HOME`
  and `.data/`); their final state is recorded here for reproducibility.

## Key files

- `~/.config/opencode/opencode.json` (created/modified — provider.rapid-proxy)
- `~/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` (rapid-llm-proxy repo
  commit `5f02957` — fixes 1, 3, 4)
- `.data/llm-proxy/llm-settings.json` (override fix 2 — not git-tracked)

## Self-Check: PASSED

- [x] OpenCode configured with OpenAI-compatible provider at `12435/v1` (additive)
- [x] Existing github-copilot setup not broken
- [x] Real OpenCode call lands `token_usage` row with `agent='opencode'`,
      `granularity_tier='per-llm-call'` (rows 126876/126877, operator-confirmed)
- [x] OpenCode renders replies (SSE framing) — usable, not just logging
- [x] Proxy build green; temporary diagnostic logging removed before commit
