---
phase: 70-opencode-mastra-token-adapters
plan: 03
subsystem: mastra token attribution (investigation/decision)
tags: [mastra, mastracode, token-attribution, adapt-04, d-08, d-09, investigation]
requires:
  - "Plan 70-01 OpenAI-compatible /v1/chat/completions shim with X-Agent precedence (shipped, b5cbdc1)"
  - "Phase 68 token_usage attribution columns (agent/granularity_tier/task_id) — shipped"
provides:
  - "70-MASTRA-SURFACE.md — the D-08 Resolution (proxy-route) + D-09 instrumentation-surface finding"
  - "Plan 04 Track A directive: redirect seam (mastracode customProviders / ANTHROPIC_BASE_URL) + X-Agent: mastra stamp"
affects:
  - "Plan 70-04 (Mastra implementation) — executes Track A proxy-route; Track B fallback is OUT of scope"
tech-stack:
  added: []
  patterns:
    - "Investigation-only plan: Task 1 gathers evidence (read-only), Task 2 is sole writer of the decision record"
    - "Redirect-capability probe reuses Plan-01 shim verbatim (no proxy code change) to prove the proxy-route path"
key-files:
  created:
    - "/Users/Q284340/Agentic/coding/.planning/phases/70-opencode-mastra-token-adapters/70-MASTRA-SURFACE.md"
  modified: []
decisions:
  - "[70-03] D-08 RESOLVED: proxy-route — mastracode customProviders {name,url,apiKey} is a first-class arbitrary-url redirect seam (ModelRouterLanguageModel speaks OpenAI /chat/completions); fallback (D-11) not required"
  - "[70-03] Primary redirect seam is mastracode customProviders (auth-agnostic); ANTHROPIC_BASE_URL is secondary (API-key path only — OAuth fetch hardwires the endpoint and bypasses it)"
  - "[70-03] Achievable granularity tier = per-llm-call (proxy-route logs each /chat/completions as one row); @mastra/core observability spans (AGENT_RUN/WORKFLOW_RUN) are per-session-aggregate floor, relevant only to the unused fallback"
metrics:
  duration: ~20 min
  completed: 2026-06-22
  tasks: 2
  files: 1
---

# Phase 70 Plan 03: Mastra Surface Finding & D-08 Resolution Summary

Resolved the D-08 proxy-route-vs-fallback fork for Mastra to **proxy-route** with live evidence,
and delivered the D-09 instrumentation-surface finding (ADAPT-04 SC-3), written into
`70-MASTRA-SURFACE.md` so Plan 04 executes Track A without re-investigating.

## What Was Built

This is an investigation/decision plan — no proxy code changed. The single artifact is the decision
record `70-MASTRA-SURFACE.md`.

**Task 1 — Disambiguate the two Mastra surfaces and probe redirect capability (investigation-only):**
- Disambiguated surface (a) `.opencode/mastra.json` (the mastracode observation/reflection memory
  engine, model `anthropic/claude-haiku-4-5`) from surface (b) the `mastracode` TUI launched via
  `config/agents/mastra.sh` (`MASTRA_MODEL` network-adaptive). Both are backed by the **same** global
  `mastracode@0.11.0` binary (`/opt/homebrew/lib/node_modules/mastracode`), which bundles Vercel
  `ai@^6` + `@ai-sdk/anthropic@3.0.66` + `@ai-sdk/openai@3.0.41` + `@mastra/core@1.22.0`.
- Confirmed `.opencode/mastra.json` has NO first-party `coding` consumer (only a `test-coding.sh`
  existence check) — it is mastracode's own memory-engine config, read by the global binary.
- Found the **custom-provider redirect seam** by inspecting the installed bundle: `resolveModel`
  (chunk-6XX4P5XQ.js) matches `settings.customProviders` (`{ name, url, apiKey }`) and routes matches
  through `ModelRouterLanguageModel({ url: customProvider.url, ... })`, which speaks OpenAI
  `/chat/completions` — a direct, supported, arbitrary-`url` redirect (point at `http://localhost:12435/v1`).
- Confirmed the secondary `ANTHROPIC_BASE_URL` seam in `@ai-sdk/anthropic` (`loadOptionalSetting(... "ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com"`), with the OAuth-fetch caveat that mastracode's
  OAuth path installs a custom `fetch` bypassing it.
- Identified the framework-instrumentation surface (D-09, fallback intel): `@mastra/core/dist/observability`
  span types `AGENT_RUN`/`WORKFLOW_RUN`/`TOOL_CALL`/`GENERIC` carrying `usage`/`inputTokens`/`outputTokens`
  (per-session-aggregate floor; no per-llm-call span in 1.22.0) + `@mastra/core/dist/hooks` (mitt emitter).
- **Live redirect probe (acceptance criterion #3):** `POST :12435/v1/chat/completions` with
  `X-Agent: mastra` (trivial prompt) returned a `chat.completion` envelope (`total_tokens=19`) and
  landed `token_usage` row **125959** with `agent='mastra'`, `granularity_tier='per-llm-call'`.

**Task 2 — Write the D-08 resolution + D-09 surface finding into `70-MASTRA-SURFACE.md`:**
- Wrote the decision record: Surfaces table, D-09 instrumentation surface (three seams + granularity),
  the single `Resolution: proxy-route` line with evidence, the achievable tier (`per-llm-call`), and
  the Plan 04 Track A directive naming BOTH the redirect seam (mastracode `customProviders` /
  `ANTHROPIC_BASE_URL`) AND the agent-stamp mechanism (`X-Agent: mastra` header, or `body.agent`
  fallback) the Plan-01 shim consumes.

## Findings (per `<output>` requirements)

- **Two surfaces:** (a) `.opencode/mastra.json` memory engine; (b) mastracode TUI — same SDK stack.
- **Redirect verdicts (evidence-backed):**
  - Custom-provider seam → **redirectable** (resolveModel + ModelRouterLanguageModel, arbitrary `url`).
  - `ANTHROPIC_BASE_URL` seam → **redirectable on API-key path**, bypassed under OAuth (custom fetch).
  - Framework observability → per-session-aggregate floor (fallback only; not needed).
- **Resolution:** `proxy-route`.
- **Achievable granularity tier:** `per-llm-call`.
- **Plan 04 track:** Track A (proxy-route). Track B (D-11 fallback adapter) is out of scope.

## Deviations from Plan

None — plan executed exactly as written. Both surfaces disambiguated with evidence-backed verdicts
(Task 1), the decision record written with the required `Resolution:` line + granularity tier + Track A
directive (Task 2), and the live probe recorded per acceptance criterion #3.

## Notes

- **No packages installed** (T-70-SC honored): investigation was read-only inspection of the
  already-installed global `mastracode` bundle + `coding/node_modules`. No package-legitimacy
  checkpoint applied.
- **T-70-07/T-70-08 honored:** the redirect probe used a trivial non-sensitive prompt through the
  loopback-owned proxy (single local telemetry row); NO `ANTHROPIC_BASE_URL` was exported into any
  shell/launchd — the seam to be made permanent in Plan 04 is mastracode's own `settings.json`
  `customProviders`, scoped to mastracode. The exact location of any redirect env is recorded in
  `70-MASTRA-SURFACE.md` §5 for Plan 04.
- **ADAPT-04 requirement status:** this plan satisfies ADAPT-04 SC-3 (surface identified + tier
  determined). The full ADAPT-04 requirement (an adapter emitting rows) completes when Plan 04 ships
  Track A — left Pending here for Plan 04 to mark complete.

## Commits

**coding repo** (`/Users/Q284340/Agentic/coding`, branch `main`):
- `74e545570` — docs(70-03): resolve D-08 (proxy-route) + D-09 Mastra surface finding (ADAPT-04 SC-3)
- (this SUMMARY + STATE/ROADMAP updates — final metadata commit)

## Success Criteria

- ADAPT-04 SC-3: Mastra's instrumentation surface identified + granularity tier determined — ✓ (three
  seams documented; per-llm-call via proxy-route).
- D-08 fork resolved with evidence, conditioning Plan 04 — ✓ (`Resolution: proxy-route`, live probe row 125959).
- D-09 surface deliverable produced regardless of path — ✓ (`70-MASTRA-SURFACE.md` §2).
- Plan 04 Track A directive unambiguous, names the X-Agent stamp mechanism — ✓ (§5).

## Self-Check: PASSED

- FOUND: `.planning/phases/70-opencode-mastra-token-adapters/70-MASTRA-SURFACE.md`
- FOUND: commit `74e545570`
- Resolution line present (exactly one): `Resolution: proxy-route`
- Granularity tier present: `per-llm-call`
