---
phase: 70-opencode-mastra-token-adapters
plan: 04
type: execute
status: complete
requirements: [ADAPT-04]
completed: 2026-06-23
---

# Plan 70-04 Summary — Mastra Token Landing (Track A, proxy-route)

## Outcome

**ADAPT-04 SC-4 closed.** A real mastracode session now routes its LLM calls
through the proxy shim and lands `token_usage` rows stamped `agent='mastra'`,
`granularity_tier='per-llm-call'`.

Live-verified (operator-confirmed): mastracode status bar shows
`build rapid-proxy-mastra/claude-haiku-4-5`, the agent replies normally, and the
turn landed row **127605** — `agent='mastra'`, `granularity_tier='per-llm-call'`,
`model='claude-haiku-4.5'`, `total_tokens=17331`, `provider='copilot'`.

## Track decision

Track A (proxy-route) per 70-MASTRA-SURFACE.md. Track B (host-side emitter) was
**not** built — `lib/token-adapters/mastra-token-emitter.mjs` and the
`scripts/sub-agent-live-opencode.mjs` emission hook are Track-B-only and skipped.

## Agent-stamp mechanism — operator decision A1

A prior pass proved (from the installed `mastracode@0.24.0` bundle) that mastracode's
custom-provider seam can attach **neither** an `X-Agent: mastra` header **nor** a
`body.agent` field, so a bare shim would mis-stamp rows as `agent='opencode'`
(the shim default). Operator chose **A1 — a dedicated shim sub-route**:

- **`POST /v1/mastra/chat/completions`** added to the shim (rapid-llm-proxy commit
  `3dab4ac`). The OpenAI-shim guard now accepts both `/v1/chat/completions` and
  `/v1/mastra/chat/completions`; `defaultAgent` is path-derived (`'mastra'` on the
  mastra sub-route, else `'opencode'`). X-Agent/body.agent precedence still wins
  when present. The Plan-01 pipeline is reused verbatim (`process` default = agent,
  `granularity_tier='per-llm-call'`, `req._shimBody`/`_shimOpenAI`/`_shimStream`).
- mastracode's `customProviders` entry `rapid-proxy-mastra` has `url:
  http://localhost:12435/v1/mastra`; its OpenAI client POSTs `/chat/completions`
  → hits the new sub-route → agent='mastra'.

Synthetic pre-gate verification and the live session both confirm the row stamps
`agent='mastra'` with no header injection.

## mastracode model-selection — the real blockers (and fixes)

The redirect worked immediately, but getting mastracode to actually *use* the
custom-provider model took fixing three non-obvious bundle behaviors. Real
mastracode sessions kept launching on the default `openai/gpt-5.5`:

1. **Wrong env var.** mastracode reads `MASTRACODE_MODEL_ID` (`cli.js`
   `resolveInitialStateFromEnv` → `currentModelId`), NOT `MASTRA_MODEL`. Fixed in
   `config/agents/mastra.sh` (commit `7400943bf`). (Even the correct env var is only
   a transient hint — see #3.)
2. **Empty `models[]` drops the provider.** `fetchProviders()` does
   `if (!models.length) continue`, so the customProvider was silently unusable until
   its `models` array was populated (`["claude-haiku-4-5","claude-opus-4.6"]`).
3. **Model is selected from `models.modeDefaults` / the active model *pack*, not the
   env var.** With `modeDefaults` empty, mastracode backfills `LEGACY_VARIED_MODELS`
   (→ `build: openai/gpt-5.5`). And `/models` only offers **packs**, not individual
   custom-provider models. Fix: created an active **custom model pack**
   `RapidProxyMastra` (`activeModelPackId: custom:RapidProxyMastra`, `modeDefaults`
   for build/plan/fast → `rapid-proxy-mastra/claude-haiku-4-5`). It now launches on
   the proxy model AND appears as a selectable pack in `/models`.

## Files / artifacts

- `~/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` — rapid-llm-proxy commit
  `3dab4ac` (the `/v1/mastra/chat/completions` sub-route). Build green.
- `config/agents/mastra.sh` — coding commits `3682b4349` + `7400943bf`
  (`MASTRACODE_MODEL_ID=rapid-proxy-mastra/claude-haiku-4-5`, routing notes).
- `~/Library/Application Support/mastracode/settings.json` (**$HOME, not
  git-tracked** — backups `*.bak-70-04*`). Required operational state:
  - `customProviders[]`: `{ name: "rapid-proxy-mastra", url:
    "http://localhost:12435/v1/mastra", apiKey: "<placeholder>", models:
    ["claude-haiku-4-5","claude-opus-4.6"] }`
  - `customModelPacks[]`: `{ name: "RapidProxyMastra", models: { build/plan/fast:
    "rapid-proxy-mastra/claude-haiku-4-5" } }`
  - `models.activeModelPackId: "custom:RapidProxyMastra"`, matching `modeDefaults`.
- The `mastra → copilot` routing override (from 70-02, in `.data/llm-proxy/
  llm-settings.json`) carries Mastra's calls through the healthy copilot provider.

## Notes / carry-forward

- **task_id was `''`** on the verified row (no active measurement span) — documented
  acceptable case.
- **Reproducibility follow-up (HUMAN-UAT / future hardening):** the mastracode
  `settings.json` customProvider + custom pack are currently persisted manually. A
  fresh machine would need them re-seeded. A robust follow-up is to have
  `config/agents/mastra.sh` idempotently ensure the customProvider + RapidProxyMastra
  pack exist in `settings.json` at launch. Not required for SC-4 (the operational
  state persists), but noted so it isn't lost.
- Plan 70-02's proxy fixes (per-agent `process` default, copilot model
  canonicalization, SSE framing) all apply to this path too.

## Self-Check: PASSED

- [x] Track A proxy-route delivered via dedicated `/v1/mastra/chat/completions` route
- [x] Real mastracode session lands `token_usage` row with `agent='mastra'`,
      `granularity_tier='per-llm-call'` (row 127605, operator-confirmed)
- [x] server.mjs committed in rapid-llm-proxy (`3dab4ac`); mastra.sh in coding
      (`3682b4349`,`7400943bf`); build green; no diagnostic logging left
- [x] Track-B-only files intentionally not built (documented)
