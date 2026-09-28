# ClassifierKnnFallback

**Type:** Detail

## What It Is

ClassifierKnnFallback is only visible at its boundary in the supplied files: `scripts/prompt-classifier-service.mjs` imports `PromptKnnClassifier` and `resolveKnnPaths` from `./lib/prompt-classifier-knn.mjs`, and that latter file — which would actually implement the abstain/accept decision, the similarity threshold, and shadow-mode comparison logic — is not among the observations. What can be documented, therefore, is the orchestrating service's contract with this component: how it's instantiated, cached, configured, and measured, not its internal decision logic.

## Architecture and Design

The parent, PromptClassifierService, treats KNN classification and LLM judging as two tiers of a single pipeline, expressed through config (`strategy: 'llm'`, `knn.fallbackToLlm: true`) and through metrics (`counts.knn` vs `counts.bySource`). This is a Strategy-pattern setup at the config level: an operator can presumably select KNN-primary-with-LLM-fallback or pure-LLM judging without redeploying code, consistent with the codebase's broader hot-reload-config convention shared by llm-routing.yaml and prompt-classifier.yaml.

Architecturally, ClassifierKnnFallback is deliberately decoupled from the network-awareness machinery that its sibling ClassifierBackendResolution owns: `classifierFor(cfg)` and `resolveKnnPaths` have no dependency on `currentNetwork()` or the backend candidate list. This separation implies the KNN path is meant to be network-independent — a locally-resident model — which is precisely why it can serve as a fallback: it doesn't share the LLM path's failure modes (network dials, API key loading via `ENV_FILE`, as handled in sibling ClassifierEnvSecretLoading).

## Implementation Details

The one confirmed mechanic is a caching façade: `classifierFor(cfg)` builds a cache key via `JSON.stringify(resolveKnnPaths(REPO, cfg.knn))` so that a hot-reloaded config which doesn't change the KNN model/cache paths avoids rebuilding the index. This is an adapter/façade pattern layered over `PromptKnnClassifier`, optimizing for reload frequency rather than raw instantiation cost.

Configuration defaults are visible in `envFallbackConfig()`: `knn: { modelPath: '.data/prompt-classifier/knn-model.json', cacheDir: '.data/fastembed-cache', fallbackToLlm: true }`. The metrics object `counts.knn = { asked, accepted, abstained, failed, shadowDisagreed }` strongly implies the classifier can (a) abstain, triggering LLM fallback, and (b) run in a shadow mode where its verdict is logged against the LLM's without being authoritative — but neither the abstention threshold nor the `shadowDisagreed` computation is present in the supplied files; both live in `lib/prompt-classifier-knn.mjs`.

## Integration Points

The component is invoked exclusively from `scripts/prompt-classifier-service.mjs`, its parent, via the two named imports. It has no visible coupling to `ClassifierBackendResolution`'s `currentNetwork()`/`candidatesForNetwork` machinery, and no visible coupling to `ClassifierEnvSecretLoading`'s `.env`/`apiKeyEnv` handling — the two sibling paths that govern the LLM backend it falls back to. Its only confirmed downstream integration is through the `counts.knn` / `counts.bySource` metrics contract, which exposes the KNN-then-LLM pipeline shape without exposing the decision code itself.

## Usage Guidelines

Given how much of this component is undocumented in the current observation set, the safe guidance is: treat `lib/prompt-classifier-knn.mjs`, `lib/prompt-classifier-config.mjs`, and `config/prompt-classifier.yaml` as the authoritative sources for abstain-threshold tuning and shadow-mode behavior — do not infer thresholds from the service file. When modifying `classifierFor(cfg)`'s caching key, remember it is scoped to `resolveKnnPaths` output only, so config changes elsewhere (e.g., `fallbackToLlm` toggling) won't trigger a rebuild — verify that's intended. Any future incident analysis should also check whether the "fail-toward-what-worked" philosophy documented for `loadConfig()` extends to KNN abstain/failure paths, since that is currently unconfirmed.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per the parent's incident record (asked: 18, answered: 0, failed: 18, 'QWEN_LOCAL_API_KEY not set', and the earlier network-dial 502 incident where two `--pi` turns hit the wrong fixed backend URL), the classifier's LLM backend path has documented failure modes tied to network reachability and secret loading. Neither incident is attributed to the KNN path specifically — network reachability and API key auth (`askBackend`'s `apiKeyEnv`) only apply to the remote/local LLM backend, not a locally-resident KNN model, which is consistent with KNN existing as a fallback precisely because it doesn't share those failure modes.

## Hierarchy Context

### Parent
- [PromptClassifierService](./PromptClassifierService.md) -- [SESSION] A live-network dial failure was traced to the classifier holding one fixed backend URL from boot: two --pi turns hit 'classifier HTTP 502' when the network changed and the laptop backend went unreachable while the on-prem cluster destination stayed up; config/prompt-classifier.yaml now declares an ordered backend list with first-enabled-network-match, mirroring llm-routing.yaml's offload target pattern.

### Siblings
- [ClassifierBackendResolution](./ClassifierBackendResolution.md) -- [LLM] The backend-resolution logic lives in scripts/prompt-classifier-service.mjs and is deliberately split into two halves that never touch the network layer directly: `currentNetwork()` (truncated but visible as an async function reading `PROXY_HEALTH_URL` with a `NETWORK_TTL_MS`-based cache) supplies the 'where are we' answer, while the imported `candidatesForNetwork` from `./lib/prompt-classifier-config.mjs` supplies the 'what can serve that network' answer. This mirrors the parent record's claim that the service reuses llm-routing.yaml's offload-target pattern (ordered list, first enabled network match wins) rather than inventing a second resolution algorithm.
- [ClassifierEnvSecretLoading](./ClassifierEnvSecretLoading.md) -- [LLM] The secret-loading logic sits inline at module load time in scripts/prompt-classifier-service.mjs, immediately after the import block and before PORT/CONFIG_PATH are read: it computes ENV_FILE from `process.env.CLASSIFIER_ENV_FILE || path.join(REPO, '.env')`, then runs a pre-pass `for (const [k, v] of Object.entries(process.env)) { if (v === '') delete process.env[k]; }` before calling `process.loadEnvFile(ENV_FILE)` inside a try/catch that sets the module-level `envFileLoaded` boolean. Placing this ahead of any other initialization guarantees `askBackend()`'s later reads of `process.env[apiKeyEnv]` see the loaded value, but it also means a malformed .env fails silently into the catch block with no logger yet available.


---

*Generated from 9 observations*
