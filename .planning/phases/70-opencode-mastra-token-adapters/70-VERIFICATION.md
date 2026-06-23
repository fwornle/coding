---
phase: 70-opencode-mastra-token-adapters
verified: 2026-06-23T07:30:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 70: OpenCode + Mastra Token Adapters Verification Report

**Phase Goal:** OpenCode and Mastra token spend lands in `token_usage` on the shared contract, completing the all-four-agent reach.
**Verified:** 2026-06-23T07:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | OpenCode is configured to route LLM calls through the proxy at `host.docker.internal:12435` (host-side: `localhost:12435`) and the proxy logs each call as a `per-llm-call` row | VERIFIED | `~/.config/opencode/opencode.json` carries `provider.rapid-proxy` with `baseURL: http://localhost:12435/v1`. Live DB shows rows 126849–126893 stamped `agent='opencode'`, `granularity_tier='per-llm-call'`. Spot-check curl to `/v1/chat/completions` produced row 127623 (`agent=opencode`, `per-llm-call`, 17 tokens, `provider=copilot`). |
| 2 | OpenCode's active `task_id` is passed via the proxy request envelope and lands on the row | VERIFIED | `server.mjs:1575-1583` implements X-Task-Id/body.task_id precedence, falling back to `resolveLiveTaskId()`. Contract-tested in `agent-envelope-passthrough.test.mjs` (commit `58a3514`). Operator-confirmed rows have `task_id=''` due to no active span — documented acceptable case per PLAN. |
| 3 | Mastra's instrumentation surface is identified and its granularity tier is determined | VERIFIED | `70-MASTRA-SURFACE.md` documents three seams: customProviders (primary, per-llm-call), ANTHROPIC_BASE_URL (secondary), and @mastra/core observability (fallback floor). Resolution: `proxy-route`. Tier: `per-llm-call`. Live probe row 125959 recorded. |
| 4 | A Mastra adapter emits rows on the shared contract at the determined granularity tier, stamped with the active `task_id` | VERIFIED | `POST /v1/mastra/chat/completions` (commit `3dab4ac`) accepts mastracode's customProvider calls and stamps `agent='mastra'`. Live DB shows rows 127062/127405/127605 stamped `agent='mastra'`, `granularity_tier='per-llm-call'`. Spot-check curl produced row 127622 (`agent=mastra`, `per-llm-call`, 18 tokens, `provider=copilot`). `config/agents/mastra.sh` exports `MASTRACODE_MODEL_ID=rapid-proxy-mastra/claude-haiku-4-5` (commits `3682b4349`/`7400943bf`). |

**Score:** 4/4 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` | OpenAI shim: both `/v1/chat/completions` and `/v1/mastra/chat/completions`; generic agent/granularity_tier/task_id envelope passthrough on `logTokenCall` | VERIFIED | `node --check` passes. Grep confirms `/v1/chat/completions`, `/v1/mastra/chat/completions`, `per-llm-call`, `x-agent`, `body.agent`, `body.task_id`, `resolveLiveTaskId()` all live in source. Commits `b5cbdc1` (shim), `5f02957` (routing/SSE), `3dab4ac` (mastra sub-route). |
| `/Users/Q284340/.config/opencode/opencode.json` | Custom OpenAI-compatible provider at `localhost:12435/v1`; additive (github-copilot preserved) | VERIFIED | File contains `provider.rapid-proxy` with `baseURL: http://localhost:12435/v1`; `enabled_providers: ["github-copilot","rapid-proxy"]`; all existing blocks intact; valid JSON. |
| `/Users/Q284340/Agentic/coding/config/agents/mastra.sh` | Exports `MASTRACODE_MODEL_ID=rapid-proxy-mastra/claude-haiku-4-5`; proxy reachability probe on port 12435 | VERIFIED | `MASTRACODE_MODEL_ID="rapid-proxy-mastra/claude-haiku-4-5"` present (line 204). Proxy health probe on `localhost:12435` present. Comment documents the dedicated sub-route rationale and `agent='mastra'` stamping. No `console.log`, no `TBD`/`FIXME`/`XXX`. |
| `/Users/Q284340/Agentic/coding/.planning/phases/70-opencode-mastra-token-adapters/70-MASTRA-SURFACE.md` | D-08 resolution + D-09 surface finding (ADAPT-04 SC-3) | VERIFIED | File exists; contains `Resolution: proxy-route`; documents granularity tier `per-llm-call`; names three seams; Plan 04 directive names both redirect seam and agent-stamp mechanism; live probe row 125959 recorded. |
| `~/Library/Application Support/mastracode/settings.json` | `customProviders` entry `rapid-proxy-mastra` with `url: http://localhost:12435/v1/mastra`; `customModelPacks` with `RapidProxyMastra`; `activeModelPackId: custom:RapidProxyMastra` | VERIFIED (config-only artifact, operator-confirmed) | SUMMARY 70-04 documents the exact settings.json state; operator confirmed mastracode launches on `rapid-proxy-mastra/claude-haiku-4-5` (status bar `build rapid-proxy-mastra/claude-haiku-4-5`); row 127605 (17331 tokens) proves the real session used this config. |
| `.data/llm-proxy/token-usage.db` | `token_usage` rows with `agent IN ('opencode','mastra')`, `granularity_tier='per-llm-call'`, non-zero `total_tokens` | VERIFIED | Schema confirms `agent`, `granularity_tier`, `task_id` columns exist. 18 `opencode` rows and 6 `mastra` rows present. Spot-checks at verification time produced new rows 127622 (mastra) and 127623 (opencode), both `per-llm-call`. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `opencode.json provider.rapid-proxy.options.baseURL` | proxy shim `POST /v1/chat/completions` | `@ai-sdk/openai-compatible` provider config | WIRED | baseURL `http://localhost:12435/v1` confirmed in file; shim route confirmed in server.mjs line 1554; live rows with `agent='opencode'` confirm end-to-end connection. |
| `shim /v1/chat/completions` → `logTokenCall` row build | `token_usage` row with `agent`, `granularity_tier`, `task_id` | `req._shimBody` stash + req.url rewrite + shared `/api/complete` pipeline | WIRED | `server.mjs:1606-1609` stashes `internalBody` on `req._shimBody`; `server.mjs:1802-1821` reads `body.agent`/`body.granularity_tier`/`body.task_id` in logTokenCall; live DB confirms stamped rows. |
| `config/agents/mastra.sh MASTRACODE_MODEL_ID` | `mastracode` customProvider `rapid-proxy-mastra` | `MASTRACODE_MODEL_ID` env var read by mastracode `resolveInitialStateFromEnv` | WIRED | `mastra.sh:204` exports `MASTRACODE_MODEL_ID=rapid-proxy-mastra/claude-haiku-4-5`; operator-confirmed mastracode launches on this model; row 127605 (17331 tokens) is real session evidence. |
| mastracode `/chat/completions` call to `http://localhost:12435/v1/mastra` | proxy shim `POST /v1/mastra/chat/completions` | mastracode customProviders `ModelRouterLanguageModel` speaking OpenAI `/chat/completions` | WIRED | `server.mjs:1554` accepts `/v1/mastra/chat/completions`; `defaultAgent='mastra'` derived from path; spot-check curl at verification produced row 127622 (`agent=mastra`). |
| `body.task_id ?? resolveLiveTaskId()` precedence | `task_id` column on row | `server.mjs:1819-1821` precedence expression | WIRED | Source confirms precedence; contract-tested in `agent-envelope-passthrough.test.mjs`; `task_id=''` on observed rows (no active span — acceptable per plan). |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `server.mjs /v1/chat/completions` shim | `result.tokens` (input/output/total) from provider call | existing `/api/complete` provider chain → `logTokenCall` → `token_usage` INSERT | Yes — DB rows show real non-zero tokens (572, 9147, 17331, 32, etc.) from real LLM provider calls via copilot | FLOWING |
| `server.mjs /v1/mastra/chat/completions` shim | same pipeline, `agent='mastra'` path-derived | same provider chain; `mastra → copilot` routing override in `.data/llm-proxy/llm-settings.json` | Yes — row 127605 at 17331 tokens from real mastracode session | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `/v1/chat/completions` returns `chat.completion` and writes `agent='opencode'` row | `curl -s -X POST http://localhost:12435/v1/chat/completions -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"reply: ok"}]}'` then DB query | Row 127623: `agent=opencode`, `per-llm-call`, 17 tokens, `provider=copilot` | PASS |
| `/v1/mastra/chat/completions` returns `chat.completion` and writes `agent='mastra'` row | `curl -s -X POST http://localhost:12435/v1/mastra/chat/completions -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"reply: ping"}]}'` then DB query | Row 127622: `agent=mastra`, `per-llm-call`, 18 tokens, `provider=copilot` | PASS |
| `server.mjs` passes syntax check | `node --check /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` | Exit 0, "SYNTAX OK" | PASS |
| Proxy health confirms `/v1/mastra/chat/completions` route is live | `curl -s http://localhost:12435/health` | `{"status":"ok",...}` + `/v1/mastra/chat/completions` responding with `chat.completion` | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ADAPT-03 | 70-01, 70-02 | OpenCode LLM calls route through proxy at `host.docker.internal:12435`, logged `per-llm-call` with active `task_id` | SATISFIED | `opencode.json` provider at `localhost:12435/v1`; shim commits `b5cbdc1`/`5f02957`; 18 live `agent='opencode'` rows; REQUIREMENTS.md traceability marked Complete. |
| ADAPT-04 | 70-03, 70-04 | Mastra instrumentation surface identified; adapter emits rows on shared contract at determined tier | SATISFIED | `70-MASTRA-SURFACE.md` delivers SC-3 (surface + tier); `/v1/mastra/chat/completions` shim delivers SC-4 (rows land with `agent='mastra'`, `per-llm-call`); 6 live `agent='mastra'` rows including operator-confirmed row 127605. Note: REQUIREMENTS.md traceability table still shows "Pending" for ADAPT-04 (stale metadata — a cosmetic gap, not a functional gap; the implementation is proven by live evidence). |

**Orphaned requirement check:** REQUIREMENTS.md maps only ADAPT-03 and ADAPT-04 to Phase 70. All plans declare exactly these two IDs. No orphans.

**Note on REQUIREMENTS.md ADAPT-04 traceability status:** The `| ADAPT-04 | Phase 70 | Pending |` row was not updated to "Complete" after Plan 04 shipped. The requirement checkbox (`- [ ] **ADAPT-04:**`) is also not checked. This is a metadata update omission only — it does not affect the implementation. The ROADMAP.md Phase 70 entry is correctly marked `[x]` complete and the live DB rows prove SC-4 is met. This is a WARNING-level cosmetic discrepancy, not a BLOCKER.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No `TBD`/`FIXME`/`XXX` markers, no `console.log`, no placeholder stubs found in any file modified by phase 70. |

---

## Human Verification Required

None. All must-haves are verified by automated source inspection and live behavioral spot-checks. The two operator-gated live sessions (Plan 70-02 Task 2 for OpenCode, Plan 70-04 Task A2 for Mastra) were already completed before this verification ran, with rows in the DB as standing evidence.

---

## Gaps Summary

No blocking gaps. One cosmetic metadata discrepancy:

- REQUIREMENTS.md `ADAPT-04` traceability row still reads "Pending" (not "Complete") and the requirement checkbox is unchecked. This is a stale metadata omission from the executor's post-plan STATE/REQUIREMENTS update. The implementation is fully proven by live evidence (rows, spot-checks, commits). Recommend updating REQUIREMENTS.md to mark ADAPT-04 Complete in a follow-up metadata commit.

---

_Verified: 2026-06-23T07:30:00Z_
_Verifier: Claude (gsd-verifier)_
