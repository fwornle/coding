# LLM-Proxy Insights — Truthfulness Audit

_Generated 2026-05-17 from live `coding` repo + `/Users/Q284340/Agentic/_work/rapid-llm-proxy` (canonical standalone)._

## Why are there still 4 LLM-Proxy-related insights after 70 → 62?

Short answer: the migration was deliberately narrow — it merged the ONE obvious near-duplicate pair I had high confidence about (`722fb941` "LLM CLI Proxy" → `dec1c5e6` "VPN/Corporate Network Detection") and stopped there.

The other three insights look similar but the audit-time Jaccard at 0.30 threshold didn't put them in the same cluster because their topic-tokens diverge:

| insight | shared tokens | with `dec1c5e6` |
|---|---|---|
| `dec1c5e6` "LLM CLI Proxy — VPN/Corporate Network Detection" | {llm, cli, proxy, vpn, corporate, network, detection} | — |
| `1e91533b` "LLM CLI Proxy — Provider Health Tracking and Fallback" | {llm, cli, proxy, provider, health, tracking, fallback} | 3/11 = 0.27 (under 0.30 cut) |
| `9499e97a` "LLM Token Usage Tracking — Proxy Instrumentation and Dashboard" | {llm, token, usage, tracking, proxy, instrumentation, dashboard} | 2/12 = 0.17 |
| `4c51c90e` "rapid-llm-proxy Standalone Package" | {rapid, llm, proxy, standalone, package} | 1/11 = 0.09 |

So the migration was correct to skip them at that signal level — but the `compactInsights()` pass with embedding-cosine + Jaccard adjacency (cluster preview run earlier today) **did** flag three of them as a cluster:

```
Cluster 1 (3 insights):
  - LLM CLI Proxy — Provider Health Tracking and Fallback
  - LLM CLI Proxy — VPN/Corporate Network Detection
  - LLM Token Usage Tracking — Proxy Instrumentation and Dashboard
```

That compaction hasn't been applied yet — the user-question now is whether *the underlying insights are even truthful enough to merge in the first place*. The answer for several of them is **no**: they describe a codebase state that no longer exists.

---

## Verdict per insight

I read each insight's full summary, then walked through every concrete claim against the live code (`/Users/Q284340/Agentic/_work/rapid-llm-proxy/`), the launchd plist, the YAML config, the dashboard frontend, and the MkDocs (`docs-content/`).

Legend: ✅ TRUE · ⚠️ PARTIALLY TRUE / MISLEADING · ❌ FALSE / STALE · 🆕 MISSING (in code, not in insight)

---

### 1. `dec1c5e6` — "LLM CLI Proxy — VPN/Corporate Network Detection" (canonical, 108 digests, conf 0.95)

| Claim | Verdict | Evidence |
|---|---|---|
| Routes to "five providers (claude-code, Copilot, Groq, OpenAI, Anthropic)" via the bridge | ✅ | `docs/providers.md`: *"POST /api/complete on the proxy bridge currently routes to five providers: copilot, claude-code, openai, groq, anthropic"* |
| "Distinct from the TypeScript `integrations/llm-cli-proxy` service" | ❌ STALE | `integrations/llm-cli-proxy/` no longer exists. It was deleted; the MkDocs `docs-content/integrations/llm-cli-proxy.md` now says *"Extracted to standalone package. The local `src/llm-proxy/llm-proxy.mjs` is a thin wrapper that delegates to the package."* The insight refers to a path that has been gone for some time. |
| Home priority: `claude-code → copilot → groq → openai → anthropic` | ⚠️ | Actual `config/llm-providers.yaml` `network_overrides.public.provider_priority.standard`: `claude-code → copilot → groq → gemini → openai → anthropic → github-models`. The order *of providers mentioned* is right; the insight omits gemini and github-models. |
| Corporate priority: `copilot → claude-code → groq → openai → anthropic` | ❌ | Actual VPN `standard` tier: `copilot → groq → gemini → openai → anthropic → github-models`. **`claude-code` is NOT in the VPN standard tier** (only in `premium`). The insight has `claude-code` in second position on VPN, which is wrong. |
| `bin/start-llm-proxy.sh` queries `/health/state` at startup; coordinator is single source of truth | ✅ | `start-llm-proxy.sh:51-59`: `COORDINATOR_URL=…/health/state` curl probe. |
| `LLM_PROXY_USER_HASH` is "computed via env-var-driven dynamic import of `user-hash-generator.js`" | ⚠️ | The pattern (`import(process.env.USER_HASH_SCRIPT)`) is correct ✅. But the insight implies the file lives in `rapid-llm-proxy/src/user-hash-generator.js` — actual path is `/Users/Q284340/Agentic/coding/scripts/user-hash-generator.js` (a different repo). |
| `LSL_TIMEZONE` exported "between the final `fi` block and the `exec node` log line" | ✅ | Line 165 `fi`, line 169 export `LSL_TIMEZONE`, line 196 `log "exec node $PROXY_BRIDGE"`. |
| `server.mjs` has env-gated init blocks registering `openai` and `groq` | ✅ | Both modules dispatch in `proxy-bridge/server.mjs` lines 1250-1252. |
| Dispatcher is a `switch` statement routing to `completeOpenAI`/`completeGroq` | ✅ | Functions exist at lines 735, 748; dispatched at 1250-1252 (it's actually an `if`/`else if` chain rather than a literal `switch`, but the structure matches). |
| "Stage-0 override (process-level hard pin)" replaces `body.provider`/`body.model` even when caller sets them | ✅ in spirit | The mechanism exists as `processOverrides` in `server.mjs:150,168,1189` ("Honor explicit body.provider only when no hard pin applies"). Code doesn't use the literal phrase "Stage-0" but the behaviour matches. |
| CORS `Access-Control-Allow-Methods` must include `PUT` | ✅ | `server.mjs:1016`: `'GET, POST, PUT, OPTIONS'`. |
| Routes `GET /settings` and `PUT /settings` | ❌ | Actual paths are **`GET /api/llm/settings`** and **`PUT /api/llm/settings`** (`server.mjs:1058,1075`). The insight's path is wrong by a `/api/llm` prefix. |
| Key file: `rapid-llm-proxy/proxy-bridge/server.mjs` | ✅ | Exists. |
| Key file: `rapid-llm-proxy/src/user-hash-generator.js` | ❌ | Does not exist in the standalone repo. The script is in the coding repo at `scripts/user-hash-generator.js`. |

**Summary**: This is the strongest of the four insights — most architecture claims are accurate. But it gets two specific facts wrong (VPN provider order; `/settings` vs `/api/llm/settings`) and one file path wrong (`user-hash-generator.js` location).

---

### 2. `1e91533b` — "LLM CLI Proxy — Provider Health Tracking and Fallback" (30 digests, conf 0.9)

| Claim | Verdict | Evidence |
|---|---|---|
| `selectBestProvider()` consults `providerHealth` tracking map | ❌ STALE | Neither `selectBestProvider` nor `providerHealth` exists anywhere in `_work/rapid-llm-proxy/` (grep returned zero matches). These symbols belong to a long-removed predecessor implementation. |
| `recordProviderResult()` populates the health map | ❌ STALE | Doesn't exist. |
| Per-provider timeout 30s | ⚠️ | A 30s timeout exists (`server.mjs:1350: timeout: 30_000`) but it's the **overall completion** timeout, not per-provider. There's also a 30s `circuitBreaker.resetTimeoutMs` (`llm-service.ts:44`) and a 30s `healthCheckInterval` (`config.ts:234`). The insight collapses three different 30s constants into one. |
| Outside VPN: `claude-code` preferred | ✅ | Confirmed by `network_overrides.public.default_provider: "claude-code"`. |
| Inside VPN: Copilot → Groq → OpenAI → Anthropic | ⚠️ | Order of mentioned providers is right for `standard` tier; insight omits `gemini` and `github-models`. |
| Observations fall back to `[Raw]` storage when all providers fail | ✅ | Documented behavior in ObservationWriter; backfill script at `scripts/backfill-raw-observations.mjs` confirms it (referenced in MEMORY.md). |
| Canonical at `integrations/llm-cli-proxy/src/index.ts` | ❌ | **File and directory do not exist**. `ls integrations/llm-cli-proxy/` → "No such file or directory". |
| Secondary JS at `integrations/llm-proxy/src/proxy.js` | ❌ | Also doesn't exist. |
| `claude-code` hangs; 41s total round-trip observed | 🟦 N/A | Untestable claim — operational observation, not code-verifiable. May once have been true. |
| Backfill recipe: `LIKE '[Raw]%'` (prefix match) to avoid re-processing | ✅ | Pattern matches `scripts/backfill-raw-observations.mjs` per MEMORY.md. |

**Summary**: **This insight is essentially WRONG end-to-end about the architecture.** It describes a code path (`integrations/llm-cli-proxy/src/index.ts` with `selectBestProvider`/`providerHealth`/`recordProviderResult`) that no longer exists in the repo. The high-level concepts (provider fallback, network-aware order, raw-fallback) are still valid generally, but every named function and file path is stale. **Strong candidate for deletion** — or for full re-write against current code.

---

### 3. `4c51c90e` — "rapid-llm-proxy Standalone Package" (37 digests, conf 0.9, project=rapid-automations)

| Claim | Verdict | Evidence |
|---|---|---|
| Package name `@rapid/llm-proxy` | ✅ | `package.json` confirms. |
| `_work/rapid-llm-proxy/` is the single canonical source | ⚠️ | Path is correct but: the standalone repo lives at `/Users/Q284340/Agentic/_work/rapid-llm-proxy/`, NOT inside `coding/_work/`. Insight is ambiguous about which `_work` it means. The coding repo has no `_work/` subdir. |
| `integrations/llm-cli-proxy/` is dead code "slated for deletion (Phase D)" | ⚠️ | The directory is **already gone** — has been for a while. The insight's framing ("slated for deletion") is stale. Also there is no "Phase D" reference anywhere in the canonical repo. |
| `copilot-provider.ts`: "OAuth → session token exchange via `api.github.com/copilot_internal/v2/token`, 5-min cache" | ❌ | The current implementation **does NOT do token exchange.** The provider docstring states: *"Use the refresh token directly as Bearer — no token exchange needed"*. There is no `/copilot_internal/v2/token` call in the codebase. The "5-min cache" the insight references actually belongs to **network-detection caching**, not OAuth (`docs/network-detection.md`: *"results cached for 5 minutes"*). The insight has conflated two different concepts. |
| Proxy bridge supports "5 provider backends: 1 CLI (Copilot) + 4 HTTP" | ❌ | Wrong characterisation. From `docs/providers.md`: Copilot is **HTTP** (direct), claude-code is **CLI**. So it's 1 CLI + 4 HTTP, but `claude-code` is the CLI one, not Copilot. |
| `src/vpn-detection.ts` exists | ❌ | The file is `src/network-detect.ts`. There is no `vpn-detection.ts`. |
| Network detection: "Inspects utun routes and DNS suffixes" | ⚠️ | Partially right: detects via interface inspection (`utun`/`tun`/`ppp`/`wg`) — but the third signal is a **DNS probe of a configurable hostname** (`LLM_VPN_PROBE_HOST`), not "DNS suffixes". And it omits the first/highest-priority signal: env override `LLM_NETWORK_MODE`. |
| `src/config-loader.ts` | ❌ | File is `src/config.ts`. There is no `config-loader.ts` (the docstring inside `config.ts` does say "Configuration Loader" but the file path is wrong). |
| `network_overrides` in YAML config | ✅ | `config/llm-providers.yaml` has the section. |
| LaunchAgent "should run `dist/server.js` (compiled from `server.ts`), not the legacy `server.mjs`" | ❌ | **There is no `src/server.ts` and no `dist/server.js`** in the repo. The launchd plist (`~/Library/LaunchAgents/com.coding.llm-cli-proxy.plist`) actually runs `bin/start-llm-proxy.sh`, which launches `proxy-bridge/server.mjs`. The insight's premise is inverted: `server.mjs` IS the current canonical code, not "legacy". |
| Copilot enterprise: "Enterprise tokens must NOT go through the token exchange step" | ⚠️ | Half-true: there is no token-exchange step at all, so the warning is moot. The provider uses the OAuth token directly. |
| Versioned model names like `claude-sonnet-4-20250514` unsupported; use `claude-sonnet-4.6` | ✅ | Matches `config/llm-providers.yaml`: `standard: "claude-sonnet-4.6"`. |
| `RAPID_HOME` env var required in `.env` | ✅ | Mentioned in `docs/configuration.md` (not re-verified per char, but consistent with toolkit setup). |
| Key files: `ROADMAP.md`, `STATE.md`, `.env` referenced as canonical | ❌ | `ROADMAP.md` and `STATE.md` **do not exist** in the canonical repo. |
| OKB vendors as local tarball under `vendor/`; `Dockerfile` has `COPY vendor/`; uses `LLM_CLI_PROXY_URL` on port 12435 | 🟦 N/A | Not verifiable from the coding repo alone — this is about the OKB consumer. The `.tgz` packages exist in `_work/rapid-llm-proxy/` (`rapid-llm-proxy-1.0.0.tgz`, `rapid-llm-proxy-2.0.0.tgz`). |
| `/raas-job/:uuid` route preserved | ✅ | `server.mjs:1322`: `req.url?.match(/^\/raas-job\/([0-9a-f-]{36})$/i)`. |

**Summary**: Mix of valid high-level architecture and **multiple wrong filenames + a fundamentally wrong claim about which code is canonical** (server.mjs vs imaginary dist/server.js). The "Phase D dead code" reference points to documentation that doesn't exist. The Copilot OAuth flow description is **wrong** in a way that would mislead anyone debugging auth. **Substantial re-write needed.**

---

### 4. `9499e97a` — "LLM Token Usage Tracking — Proxy Instrumentation and Dashboard" (66 digests, conf 0.97)

| Claim | Verdict | Evidence |
|---|---|---|
| `src/token-usage.ts` is the core tracking module | ✅ | Exists. |
| Function `resolveTokenExportDir()` | ✅ | `token-usage.ts:157`. |
| Function `currentWindow()` | ✅ | `token-usage.ts:192`. |
| Function `lslWritePath()` | ❌ | Actual function is **`tokenExportWritePath()`** (`token-usage.ts:230`). The docstring on line 224 explicitly says it's a *"Port of `scripts/lsl-paths.js:lslWritePath`"* — i.e. inlined from elsewhere under a new name. Insight uses the old/external name. |
| Function `exportToHourFile()` | ✅ | `token-usage.ts:282`. |
| Per-window-keyed debounce `Map` | ✅ | Pattern exists in the SQLite write path. |
| `LLM_PROXY_TOKEN_EXPORT_DIR` env override | ✅ | `start-llm-proxy.sh:188`, `token-usage.ts:158`. |
| Default path `.specstory/history/logs/llm-proxy-export/` (private coding-history repo) | ✅ | `start-llm-proxy.sh:188`. |
| SELECT + INSERT OR IGNORE include `model_raw`; legacy fall back to `model` | ✅ | `token-usage.ts:308,442,492,567,570,581` — `model_raw` is in both projection and insert. Backward compatibility comment at line 581-583 confirms fallback. |
| `model_raw` survives export → hydrate round-trips | ✅ | Phase 36-06 migration at lines 471-480. |
| Dashboard at `integrations/system-health-dashboard/src/pages/token-usage.tsx`, Recharts treemap | ✅ | File exists, line 478 wraps `<Treemap>`. |
| **"Treemap currently has no `Tooltip` component (smaller boxes non-interactive)"** | ❌ STALE | Line 484: `<Tooltip content={<TreemapTooltip />} />` — Tooltip **IS** present. There's also a dedicated `TreemapTooltip` component at line 184. The fix was applied; the insight didn't get refreshed. |
| PlantUML diagrams in `docs/diagrams/`: "three in-place diagrams — `component-model.puml`, `request-flow.puml`, `architecture-overview.puml`" | ⚠️ | All three exist ✅. But there are **at least 10 more** alongside them: `deployment.puml`, `docker-integration.puml`, `network-routing.puml`, `provider-routing.puml`, `request-sequence.puml`, `llm-architecture.puml`, `llm-providers.puml`. Insight under-counts. |

**Summary**: Strongest fidelity of the four — most token-usage internals match. Two real errors: (a) function name `lslWritePath` is wrong (actual is `tokenExportWritePath`), (b) the Treemap-no-Tooltip troubleshooting entry has been outdated by a fix that landed.

---

## Cross-insight contradictions

These four insights *contradict each other* on facts both about the codebase. The consolidation pipeline didn't catch them because they pass the "topical similarity" test but each one anchors against different files:

1. **Canonical code location**
   - `dec1c5e6`: refers to `rapid-llm-proxy/proxy-bridge/server.mjs` as authoritative
   - `1e91533b`: says canonical is `integrations/llm-cli-proxy/src/index.ts`
   - `4c51c90e`: says `_work/rapid-llm-proxy/` is canonical; `integrations/llm-cli-proxy/` is dead code; recommends `dist/server.js`
   - **Truth**: `_work/rapid-llm-proxy/` (the absolute one in `/Users/Q284340/Agentic/_work/`, not inside coding) with `proxy-bridge/server.mjs` is canonical. `integrations/llm-cli-proxy/` is already deleted. `dist/server.js` does not exist.

2. **VPN provider order**
   - `dec1c5e6`: VPN = `copilot → claude-code → groq → openai → anthropic`
   - `1e91533b`: VPN = `copilot → groq → openai → anthropic` (no claude-code)
   - **Truth**: VPN `standard` tier = `copilot → groq → gemini → openai → anthropic → github-models`. `claude-code` is only in the VPN `premium` tier.

3. **Copilot auth model**
   - `4c51c90e`: token exchange via `/copilot_internal/v2/token` with 5-min cache
   - `dec1c5e6`/`1e91533b`: don't address it
   - **Truth**: no token exchange. OAuth refresh token is used directly as Bearer.

4. **Provider count**
   - `dec1c5e6`: "five providers"
   - `4c51c90e`: "5 provider backends: 1 CLI + 4 HTTP"
   - **Truth**: 5 providers serve `POST /api/complete` on the bridge (claude-code [CLI], copilot [HTTP], openai [HTTP], groq [HTTP], anthropic [HTTP] — so 1 CLI + 4 HTTP, but Copilot is HTTP not CLI as `4c51c90e` implies). The npm package supports another 7 providers not wired into the bridge.

## Gaps — code/docs reality NOT covered by any insight

Things that actually exist in the production code but aren't reflected in any LLM-Proxy insight:

1. **Circuit-breaker subsystem** (`src/circuit-breaker.ts`) — not mentioned by any insight.
2. **Subscription quota tracking** (`src/subscription-quota-tracker.ts`) — referenced in YAML config (`quotaTracking.softLimitPerHour: 100`) but absent from insights.
3. **Metrics collection** (`src/metrics.ts`) — silent.
4. **Provider registry abstraction** (`src/provider-registry.ts`) — the actual extension point for providers; insights talk about individual provider files instead.
5. **Cache module** (`src/cache.ts`) — separate from network-detect's 5-min cache.
6. **DMR / Ollama / Gemini / GitHub-Models providers** — exist in `src/providers/`, configured in YAML, but not in the bridge `/api/complete` route. Insights only mention the 5 bridge providers.
7. **MkDocs `docs-content/integrations/llm-cli-proxy.md`** — this *is* the modern source of truth for the integration, and it correctly states the package is extracted. No insight references it.
8. **MkDocs `docs-content/architecture/llm-architecture.md`** — the architectural overview at the project level. Not cited by any insight.
9. **Wrapper-script three-tier detection** (`bin/start-llm-proxy.sh`): coordinator `/health/state` → `px-proxy` local probe → PAC-host DNS probe. The wrapper has its OWN detection chain that's independent of the in-process detection. `dec1c5e6` mentions only the coordinator path.
10. **`docs/providers.md`** statement that *"On a corporate/VPN network, only `copilot` and `claude-code` are initialized"* — concrete behavioral fact that contradicts the YAML's `provider_priority` list but matches operational reality. Not in any insight.

## Recommendation

| Insight | Action |
|---|---|
| `dec1c5e6` (VPN/Corporate Network Detection) | **KEEP + REPAIR**. Fix VPN priority order, fix `/settings` → `/api/llm/settings`, fix `user-hash-generator.js` path, drop the `integrations/llm-cli-proxy` reference. Strong base, four targeted edits. |
| `1e91533b` (Provider Health Tracking and Fallback) | **DELETE OR FULL REWRITE**. The named entities (`selectBestProvider`, `providerHealth`, `recordProviderResult`, `integrations/llm-cli-proxy/src/index.ts`) do not exist. Re-writing means starting over against current code (`server.mjs` fallback loop + `circuit-breaker.ts` + `subscription-quota-tracker.ts`). The current text is misleading. |
| `4c51c90e` (rapid-llm-proxy Standalone Package) | **HEAVY EDIT**. Fix Copilot OAuth flow (no token exchange), fix file names (`network-detect.ts` not `vpn-detection.ts`; `config.ts` not `config-loader.ts`), drop the `dist/server.js`/`server.ts` recommendation, drop ROADMAP.md/STATE.md references, clarify the "Phase D dead code" reference. |
| `9499e97a` (Token Usage Tracking) | **LIGHT EDIT**. Fix function name `lslWritePath` → `tokenExportWritePath`. Remove the obsolete Treemap-no-Tooltip troubleshooting entry. Optionally enumerate the full diagram set. |

After those edits, the compactor's flagged cluster (#1, #2, #4) is **still** a candidate to consider — but now as an informed merge (canonical = repaired `dec1c5e6`, absorbing the relevant true facts from the others) rather than a blind one against stale content.

## Meta-observation: why insights drift

Three patterns from this audit explain why the corpus accumulates stale claims:

1. **Topic stability ≠ content stability.** Even when the LLM keeps a topic name, regenerating the summary against new digests *introduces* new errors faster than it removes old ones (the OAuth/token-exchange paragraph in `4c51c90e` looks like cargo-culted detail from an earlier provider iteration).
2. **The pipeline never re-verifies against the code.** Once an insight names a file or function, no downstream pass checks whether that path still exists. A weekly `compactInsights()` pass merges duplicates but does not detect stale references.
3. **Cross-repo claims rot fastest.** Insights that reference both `coding` and `_work/rapid-llm-proxy/` (or `integrations/`) drift the moment either side moves files — and nothing notices.

If we want truthful long-term insights, the consolidator needs a code-verification step: parse out backticked file paths and function names, grep the repo(s) for each, and reduce confidence (or flag for review) when a claim's referent has disappeared. That's the natural next layer above the consolidation work shipped today.
