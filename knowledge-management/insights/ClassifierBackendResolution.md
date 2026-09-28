# ClassifierBackendResolution

**Type:** Detail

# ClassifierBackendResolution — Technical Insight Document

## What It Is

ClassifierBackendResolution is the backend-selection subsystem implemented in `scripts/prompt-classifier-service.mjs`, a child component of `PromptClassifierService`. It answers a single question — "given the current network, which backend should serve this classification request?" — by combining two independently-maintained facts: `currentNetwork()`, an async function that reads `PROXY_HEALTH_URL` and caches the result behind `NETWORK_TTL_MS`, and `candidatesForNetwork`, imported from `./lib/prompt-classifier-config.mjs`, which filters an ordered backend list down to those matching that network. It exists because the classifier previously held a single fixed backend URL from boot time, a design that failed visibly (see the parent `PromptClassifierService` incident) when the network changed underneath it.

## Architecture and Design

The dominant pattern is an **ordered candidate list with first-match-wins resolution**, deliberately modeled on llm-routing.yaml's offload-target selection rather than a bespoke algorithm — a conscious choice to avoid a second, divergent resolution scheme in the codebase. Network detection is **delegated, not re-derived**: the component treats the rapid-llm-proxy `/health` endpoint as the single source of truth for "where are we," caching its answer with a TTL instead of duplicating egress logic that lives in `proxy-bridge/egress-decision.mjs`. This keeps resolution a pure function of (live network, ordered backend config), with no internal state machine of its own.

A second key decision is the **separation of static configuration from runtime/reachability state**: `config.backends` (what's declared) and the `runtime` Map keyed by backend id (what's observed) are kept apart so that "switched off" and "declared but not answering" remain distinguishable on `/health` rather than collapsing into one ambiguous flag.

## Implementation Details

`loadConfig()` implements hot-reload via mtime polling against `CONFIG_PATH`, comparing `st.mtimeMs` to a cached `configMtimeMs`. On parse failure it sets `configError` but explicitly refuses to overwrite the in-memory `config`, embodying a fail-toward-what-worked policy: a broken YAML file degrades to the last-known-good backend list, not to the fallback. `envFallbackConfig()` is reserved strictly for the case where no config has ever loaded successfully; it constructs a single `id: 'env'` backend from `CLASSIFIER_BACKEND_URL`/`QWEN_LAPTOP_API_BASE_URL`, with `requireNetwork: null` (matches any network) and `apiKeyEnv: null` — the latter deliberately left unset because `askBackend()` already falls back to reading `CLASSIFIER_BACKEND_API_KEY` directly, so naming it here would turn "no auth needed" into a thrown error.

Runtime reachability is tracked via `runtimeOf(id)` against the `runtime` Map, holding `{reachable, lastLatencyMs, lastError, lastOkAt}` per backend. `KEEPALIVE_MS` (240000ms default) addresses an orthogonal failure axis: even correct backend selection can silently miss the proxy's 2-second budget if llama.cpp has dropped its cached rubric prefix after ~10 minutes idle — selection correctness and responsiveness are treated as independent concerns.

## Integration Points

This component sits beneath `PromptClassifierService` and depends on `./lib/prompt-classifier-config.mjs` for `candidatesForNetwork`, `normalizeNetwork`, and `describeBackends`. It shares the host file with siblings `ClassifierKnnFallback` (whose `classifierFor(cfg)` call site consumes resolved config) and `ClassifierEnvSecretLoading`, whose env-loading pre-pass (stripping empty-string env vars before `process.loadEnvFile`) must run correctly for `askBackend()`'s later `apiKeyEnv` reads to succeed — a documented failure mode previously produced `asked: 18, answered: 0, failed: 18`.

## Usage Guidelines

Treat `config/prompt-classifier.yaml`'s backend list as ordered and network-scoped; new backends should include an appropriate `requireNetwork` value rather than relying on the env fallback shape. Never populate `apiKeyEnv` on the fallback entry. Understand that a parse error preserves old config silently — a fixed file needs no manual reload — but also means broken edits won't surface as an immediate fallback state. Diagnose "not selected" versus "selected but unreachable" separately via `runtime`, not via config inspection alone.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'ClassifierBackendResolution live-network dial failure' incident record shows the mechanism failing exactly at the seam between `currentNetwork()` and the ordered backend list: two `--pi` turns hit `classifier HTTP 502` when the laptop backend (matching the old single-URL boot-time config) went unreachable after a network change, even though the on-prem cluster destination remained reachable for the same offload use case. This directly motivated the ordered-list-with-first-match resolution now visible in `loadConfig`/`envFallbackConfig`/`candidatesForNetwork` rather than a single cached endpoint.

## Hierarchy Context

### Parent
- [PromptClassifierService](./PromptClassifierService.md) -- [SESSION] A live-network dial failure was traced to the classifier holding one fixed backend URL from boot: two --pi turns hit 'classifier HTTP 502' when the network changed and the laptop backend went unreachable while the on-prem cluster destination stayed up; config/prompt-classifier.yaml now declares an ordered backend list with first-enabled-network-match, mirroring llm-routing.yaml's offload target pattern.

### Siblings
- [ClassifierKnnFallback](./ClassifierKnnFallback.md) -- [LLM] scripts/prompt-classifier-service.mjs imports `PromptKnnClassifier` and `resolveKnnPaths` from `./lib/prompt-classifier-knn.mjs` and instantiates it inside `classifierFor(cfg)`, which caches the classifier instance keyed by `JSON.stringify(resolveKnnPaths(REPO, cfg.knn))` so a hot-reloaded config that doesn't actually change the KNN model/cache paths avoids rebuilding the index. This confirms the *call site* and caching contract for the KNN component, but the file implementing the fallback/abstain decision itself, `lib/prompt-classifier-knn.mjs`, is not among the supplied files.
- [ClassifierEnvSecretLoading](./ClassifierEnvSecretLoading.md) -- [LLM] The secret-loading logic sits inline at module load time in scripts/prompt-classifier-service.mjs, immediately after the import block and before PORT/CONFIG_PATH are read: it computes ENV_FILE from `process.env.CLASSIFIER_ENV_FILE || path.join(REPO, '.env')`, then runs a pre-pass `for (const [k, v] of Object.entries(process.env)) { if (v === '') delete process.env[k]; }` before calling `process.loadEnvFile(ENV_FILE)` inside a try/catch that sets the module-level `envFileLoaded` boolean. Placing this ahead of any other initialization guarantees `askBackend()`'s later reads of `process.env[apiKeyEnv]` see the loaded value, but it also means a malformed .env fails silently into the catch block with no logger yet available.


---

*Generated from 10 observations*
