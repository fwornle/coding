# Phase 70 — Mastra Surface Finding & D-08 Resolution (ADAPT-04 SC-3)

**Investigated:** 2026-06-22
**Plan:** 70-03 (investigation/decision; Plan 04 implements the resolved path)
**Status:** RESOLVED — this file is the contract Plan 04 reads. No re-investigation needed.

---

## 1. Surfaces

Two distinct "Mastra" surfaces exist. Both are backed by the **same SDK stack**: the global
`mastracode@0.11.0` binary (`/opt/homebrew/lib/node_modules/mastracode`), which bundles the
Vercel `ai@^6` SDK with `@ai-sdk/anthropic@3.0.66` + `@ai-sdk/openai@3.0.41` providers and
`@mastra/core@1.22.0` / `@mastra/memory@1.13.1`.

| # | Surface | Config / Launch Path | Model | Role |
|---|---------|----------------------|-------|------|
| (a) | **Mastra observation/reflection memory engine** | `.opencode/mastra.json` | `anthropic/claude-haiku-4-5` | Memory engine consumed by mastracode at runtime (`storagePath=.observations/observations.db`, `observation.messageTokens=20000`, `reflection.observationTokens=90000`). The SC-3 named target. |
| (b) | **mastracode coding-agent TUI** | `scripts/launch-mastra.sh` → `config/agents/mastra.sh` (`AGENT_COMMAND="mastracode"`, `MASTRA_MODEL` network-adaptive) | `github-copilot-enterprise/claude-opus-4.6` (VPN) / `claude-opus-4-6` (public) | The standalone TUI; the larger token consumer. |

**Key disambiguation evidence:** `.opencode/mastra.json` is NOT read by any first-party `coding`
source (only `scripts/test-coding.sh:2271` checks it *exists*). Its schema
(`model`/`storagePath`/`observation`/`reflection`) is mastracode's own memory-engine config,
read by the global `mastracode` binary at runtime — not a `coding`-authored consumer. The earlier
`@opencode-ai/plugin@1.3.17` "type-stubs-only (27 bytes)" lead was a dead end: that package is
**not installed in `coding/node_modules`** and is **not** the Mastra model-call surface.

---

## 2. Instrumentation Surface (D-09 deliverable — documented regardless of path)

mastracode exposes **three** instrumentation seams. Two are redirect seams (proxy-route); one is a
framework-callback seam (fallback). All findings are from inspecting the installed bundle
(`/opt/homebrew/lib/node_modules/mastracode/dist/chunk-6XX4P5XQ.js` and `@mastra/core/dist`).

### Seam 1 — Custom Provider (`settings.customProviders`) — PRIMARY redirect seam
- `resolveModel(modelId, options)` (chunk-6XX4P5XQ.js) splits `modelId` into `providerId/modelName`,
  then matches `settings.customProviders.find(p => providerId === getCustomProviderId(p.name))`.
- On match it returns `new ModelRouterLanguageModel({ id, url: customProvider.url, apiKey: customProvider.apiKey, headers })`.
- `ModelRouterLanguageModel` speaks OpenAI-compatible `/chat/completions` (confirmed: the bundle's
  URL-rewrite logic gates on `parsed.pathname.includes("/chat/completions")`).
- `customProviders` is a first-class settings array — shape `{ name, url, apiKey }` — persisted to
  `getAppDataDir()/settings.json` (macOS: `~/Library/Application Support/mastracode/settings.json`,
  same dir as the existing `auth.json`). `addCustomProvider`/`saveSettings` exist (chunk-HKX743QN.js).
- **This is a direct, supported, arbitrary-`url` redirect** — exactly analogous to OpenCode's custom
  OpenAI-compatible provider. Point `url` at `http://localhost:12435/v1` and every call for that
  provider id routes through the Plan-01 shim.
- **Granularity exposed:** per-llm-call (every `/chat/completions` request is one row).

### Seam 2 — `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` env — SECONDARY redirect seam (API-key path only)
- `@ai-sdk/anthropic`'s `createAnthropic()` resolves
  `baseURL = loadOptionalSetting({ settingValue: options.baseURL, environmentVariableName: "ANTHROPIC_BASE_URL" }) ?? "https://api.anthropic.com"`.
  `@ai-sdk/openai` mirrors this with `OPENAI_BASE_URL`.
- mastracode's **API-key provider path** (`anthropicApiKeyProvider` → `createAnthropic({ apiKey, headers })`,
  no explicit `baseURL`) therefore honors `ANTHROPIC_BASE_URL`.
- **CAVEAT (do not rely on this seam alone):** mastracode's **OAuth path**
  (`createAnthropic({ apiKey:"oauth-placeholder", headers, fetch: buildAnthropicOAuthFetch() })`)
  installs a **custom `fetch`** that hardwires the Anthropic OAuth endpoint and *throws* if an
  api_key credential is present. When mastracode is authenticated via OAuth (the default after the
  first-run wizard in `mastra.sh:_mastra_first_run_setup`), `ANTHROPIC_BASE_URL` is bypassed. The
  custom-provider seam (Seam 1) is auth-agnostic and is therefore preferred.
- **Granularity exposed:** per-llm-call.

### Seam 3 — `@mastra/core` observability spans — FRAMEWORK-CALLBACK seam (fallback only)
- `@mastra/core@1.22.0/dist/observability` exposes span-based telemetry. Span types present in this
  version: `AGENT_RUN`, `WORKFLOW_RUN`, `TOOL_CALL`, `GENERIC` (no dedicated `LLM_GENERATION` span in
  1.22.0). Span attributes carry token `usage` with `inputTokens`/`outputTokens`.
- `@mastra/core/dist/hooks` is an `mitt`-based event emitter (framework callbacks).
- **Granularity exposed:** **per-step / per-agent-run aggregate** (token usage rolls up at the
  `AGENT_RUN`/`WORKFLOW_RUN` level, NOT strictly per-llm-call in this version) — i.e. the
  per-session-aggregate floor scenario of D-10. Only relevant if Seams 1 & 2 were unavailable.

---

## 3. Resolution

**Resolution: proxy-route**

**Evidence that drove it:** Mastra's model endpoint IS redirectable. mastracode's `resolveModel`
provides a first-class `customProviders` array (`{ name, url, apiKey }`) whose `url` is sent verbatim
to a `ModelRouterLanguageModel` that speaks OpenAI `/chat/completions` (Seam 1) — pointable at
`http://localhost:12435/v1`. Independently, the `@ai-sdk/anthropic` API-key path honors
`ANTHROPIC_BASE_URL` (Seam 2). Because at least one auth-agnostic redirect seam exists, the
framework-instrumentation fallback (D-11) is **NOT** required.

**Live verification (the D-08 probe — recorded per acceptance criterion #3):** routing a Mastra-tagged
call through the Plan-01 shim was proven end-to-end. A single trivial, non-sensitive probe
(`POST http://localhost:12435/v1/chat/completions`, `X-Agent: mastra`, prompt "reply with the single
word: ping") returned a valid `chat.completion` envelope (`usage.total_tokens=19`) and landed
`token_usage` row **`125959`** with `agent='mastra'`, `granularity_tier='per-llm-call'`,
`total_tokens=19`, provider `claude-code`. This reuses the Plan-01 shim verbatim — no proxy code
change — and confirms the agent-stamp mechanism. (T-70-07/T-70-08 honored: probe prompt trivial; no
`ANTHROPIC_BASE_URL` was exported into any shell/launchd — the redirect seam to be made permanent in
Plan 04 is `customProviders` in mastracode's own `settings.json`, scoped to mastracode.)

---

## 4. Achievable Granularity Tier

**`per-llm-call`** — guaranteed, because proxy-route logs every `/chat/completions` request as one
`token_usage` row via the existing `logTokenCall` path (Plan 01). This is the finest tier and matches
OpenCode's. The per-session-aggregate floor (D-10) is moot — it would only apply had the resolution
been `fallback`.

---

## 5. Plan 04 Directive

**Execute Track A (proxy-route).** Track B (fallback / framework instrumentation) is NOT executed —
the D-11 host-side `better-sqlite3` adapter, the `sub-agent-live-opencode` emission-hook extension,
and the WAL-concurrency acceptance test are all out of scope for Plan 04.

**Track A — exact redirect seam (point Mastra at `http://localhost:12435/v1`):**
- **Primary (preferred, auth-agnostic):** register a mastracode **custom provider** in
  `~/Library/Application Support/mastracode/settings.json` under `customProviders`, shape:
  `{ "name": "<provider-name>", "url": "http://localhost:12435/v1", "apiKey": "<placeholder>" }`,
  then select a `<providerId>/<model>` whose `providerId === getCustomProviderId(name)`. `resolveModel`
  then routes that model through the shim (`ModelRouterLanguageModel.url`). For surface (a), set the
  `.opencode/mastra.json` `model` to that custom-provider id; for surface (b), set `MASTRA_MODEL`
  (in `config/agents/mastra.sh`) to the same id. Prefer additive registration (do not clobber existing
  providers), mirroring the OpenCode "additive + documented switch" guardrail.
- **Secondary (only when mastracode auths via API key, not OAuth):** export
  `ANTHROPIC_BASE_URL=http://localhost:12435/v1` scoped to the mastracode launch (NOT global — T-70-08:
  set it inline in `config/agents/mastra.sh`'s launch env, never in the shell/launchd profile, to avoid
  misrouting other agents). Note the OAuth caveat in §2 Seam 2 — under OAuth this is bypassed, so
  Seam 1 is the load-bearing path.

**Track A — exact agent-stamp mechanism (so rows carry `agent='mastra'`):**
- Send the Plan-01 shim header **`X-Agent: mastra`** (equivalently `body.agent: "mastra"`). The Plan-01
  shim reads `agent` via `X-Agent` header OR `body.agent`, defaulting to `'opencode'` — using the same
  precedence as `X-Task-Id`. Setting `X-Agent: mastra` overrides the default and stamps
  `row.agent='mastra'` with `granularity_tier='per-llm-call'` (proven by probe row `125959`).
- **Surface note:** mastracode's `ModelRouterLanguageModel`/custom-provider seam sends a fixed
  `apiKey` but the per-request custom-header injection path is the open question Plan 04 must close —
  if mastracode does not let the custom provider attach `X-Agent: mastra` on outbound requests, Plan 04
  falls back to `body.agent` injection OR a dedicated proxy provider-id binding (e.g. a mastra-specific
  shim sub-route / provider key whose default agent is `mastra`). The shim already supports `body.agent`
  precedence, so a body-level stamp is the guaranteed mechanism if the header path is unavailable.

---

## Appendix — Investigation Evidence Index

- Surface (a) config: `.opencode/mastra.json` (model `anthropic/claude-haiku-4-5`).
- Surface (b) launch: `config/agents/mastra.sh:166-191` (proxy `/health` warn-only probe; `MASTRA_MODEL`
  network-adaptive; aspirational "all calls route through proxy" comment sets NO redirect env today).
- mastracode SDK stack: `/opt/homebrew/lib/node_modules/mastracode/package.json` (`ai@^6`,
  `@ai-sdk/anthropic@^3`, `@ai-sdk/openai@^3`, `@mastra/core@1.22.0`, `@mastra/memory@1.13.1`).
- `createAnthropic` baseURL env default: `@ai-sdk/anthropic/dist/index.mjs` —
  `loadOptionalSetting({ settingValue: options.baseURL, environmentVariableName: "ANTHROPIC_BASE_URL" }) ?? "https://api.anthropic.com"`.
- `resolveModel` + `customProviders` + `ModelRouterLanguageModel`: `mastracode/dist/chunk-6XX4P5XQ.js`
  (provider resolution), `chunk-HKX743QN.js` (`addCustomProvider`/`saveSettings`),
  `chunk-OXZXGLCJ.js` (`loadSettings`, `getSettingsPath()=getAppDataDir()/settings.json`,
  `customProviders: []` default).
- OAuth-fetch caveat: `buildAnthropicOAuthFetch` (chunk-6XX4P5XQ.js) — custom fetch, throws on api_key cred.
- `@mastra/core` observability: `@mastra/core/dist/observability` (span types `AGENT_RUN`/`WORKFLOW_RUN`/
  `TOOL_CALL`/`GENERIC`; `usage`/`inputTokens`/`outputTokens` attrs), `@mastra/core/dist/hooks` (mitt emitter).
- Live probe: shim `POST :12435/v1/chat/completions` + `X-Agent: mastra` → row `125959`
  (`agent='mastra'`, `granularity_tier='per-llm-call'`, `total_tokens=19`) in
  `.data/llm-proxy/token-usage.db`.
