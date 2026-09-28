# ClassifierEnvSecretLoading

**Type:** Detail

# ClassifierEnvSecretLoading — Technical Insight Document

## What It Is

ClassifierEnvSecretLoading is the inline, module-top-level secret-loading mechanism found in `scripts/prompt-classifier-service.mjs`, executing immediately after the import block and before `PORT`, `CONFIG_PATH`, or `BANDS` are defined. It computes an `ENV_FILE` path (`process.env.CLASSIFIER_ENV_FILE || path.join(REPO, '.env')`), sanitizes the current process environment, and then calls Node's built-in `process.loadEnvFile(ENV_FILE)` inside a try/catch, recording success in a module-level `envFileLoaded` boolean. Its sole purpose is to guarantee that `askBackend()` — part of the parent PromptClassifierService — can later read `process.env[apiKeyEnv]` (e.g., `QWEN_LOCAL_API_KEY`) reliably at request time.

## Architecture and Design

The component embodies several deliberate, narrowly-scoped patterns rather than a general-purpose config-loading framework. First is a **fail-soft/fail-silent initialization guard**: a missing or malformed `.env` is swallowed by an empty `catch {}`, justified by a comment noting that the logger doesn't exist yet and that downstream failures (a 502 from `askBackend()`) will already name the missing variable precisely. Second is an **environment-sanitization pass**: before calling `loadEnvFile`, the code deletes every zero-length environment variable across the entire process environment, not just the targeted key — a blast-radius trade-off accepted to close a specific incident where `export FOO="$FOO"` on an unset `FOO` silently shadowed real values. Third is **explicit-env-wins-over-file precedence**, which is not implemented by this module but inherited from `process.loadEnvFile`'s documented (and explicitly verified, per the comments) non-overwrite behavior — variables already present in `process.env` are never replaced by the `.env` file's contents.

Placement matters architecturally: because this logic runs before `PORT`/`CONFIG_PATH` are read, initialization order is coupled to environment availability, and any secret needed later in the file's lifecycle is guaranteed to already be resolved by the time route handlers or `classifierFor(cfg)` execute.

## Implementation Details

The core mechanics are three sequential steps at module load:

1. **Path resolution** — `ENV_FILE` is derived from `CLASSIFIER_ENV_FILE` or defaults to `path.join(REPO, '.env')`, giving operators an override escape hatch analogous to `CLASSIFIER_BACKEND_URL` / `QWEN_LAPTOP_API_BASE_URL` seen elsewhere in `envFallbackConfig()`.
2. **Sanitization loop** — `for (const [k, v] of Object.entries(process.env)) { if (v === '') delete process.env[k]; }` removes any defined-but-empty variable, closing the gap where Node's `loadEnvFile` would otherwise treat 'defined-empty' identically to 'defined-with-value' and refuse to populate it from the file.
3. **Load and flag** — `process.loadEnvFile(ENV_FILE)` executes inside try/catch; success or failure is captured only as the `envFileLoaded` boolean, later exposed via the service's `/health` endpoint — the only diagnostic surface this component produces on its own.

Notably, `envFallbackConfig()` deliberately sets `apiKeyEnv: null` rather than naming `CLASSIFIER_BACKEND_API_KEY`, because `askBackend()` already falls back to reading that variable directly when a backend declares no `api_key_env`; naming it explicitly here would wrongly turn a legitimate no-auth-needed case into a thrown error.

## Integration Points

ClassifierEnvSecretLoading is a foundational dependency of its parent, **PromptClassifierService**, whose recent evolution (an ordered, first-enabled-network-match backend list in `config/prompt-classifier.yaml`, mirroring `llm-routing.yaml`) depends on secrets being available regardless of which backend is ultimately dialed. It has no direct coupling to sibling components **ClassifierBackendResolution** or **ClassifierKnnFallback** — those operate on network selection and KNN-based classification/caching respectively — but all three share the same host process and module lifecycle, so a secret-loading failure here would surface only through `askBackend()`'s downstream HTTP error, not through either sibling.

Externally, the component consciously mirrors — but does not share code with — `rapid-llm-proxy`'s `bin/start-llm-proxy.sh` convention of loading credentials from a repo `.env` via `process.loadEnvFile` rather than a launchd plist. This is enforced purely by comment/convention: there is no shared helper module between the two services. It also stands in direct contrast to `docker/entrypoint.sh`, which strips `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` variables under a "T2 egress lockdown" policy to force LLM egress through the host `llm-cli-proxy`. This structural opposition implies the classifier service is intentionally run on the host, outside that container's entrypoint-managed process tree — the container's env pipeline would strip exactly the `QWEN_LOCAL_API_KEY` this component exists to deliver.

## Usage Guidelines

Developers modifying or debugging this component should keep several rules in mind. Any override of the `.env` path must go through `CLASSIFIER_ENV_FILE`, not a code change. Because failures are silent at the load site, diagnosing a broken secret load requires correlating two disjoint signals: the `envFileLoaded` flag on `/health` and the eventual HTTP-layer error from `askBackend()` — there is no single log line to consult. Anyone touching the empty-string deletion loop should recognize its global scope (it purges *all* empty vars, not just classifier-related ones) and preserve that behavior deliberately, since it is the fix for a real shadowing incident (`export FOO="$FOO"`) rather than incidental cleanup. Finally, because this pattern is duplicated by convention rather than shared code with `rapid-llm-proxy`, any future policy change (e.g., adopting a secrets manager) must be applied in at least two separate places, and engineers should resist the temptation to special-case `CLASSIFIER_BACKEND_API_KEY` in `envFallbackConfig()`, since `apiKeyEnv: null` is intentional, not an oversight.


## Hierarchy Context

### Parent
- [PromptClassifierService](./PromptClassifierService.md) -- [SESSION] A live-network dial failure was traced to the classifier holding one fixed backend URL from boot: two --pi turns hit 'classifier HTTP 502' when the network changed and the laptop backend went unreachable while the on-prem cluster destination stayed up; config/prompt-classifier.yaml now declares an ordered backend list with first-enabled-network-match, mirroring llm-routing.yaml's offload target pattern.

### Siblings
- [ClassifierBackendResolution](./ClassifierBackendResolution.md) -- [LLM] The backend-resolution logic lives in scripts/prompt-classifier-service.mjs and is deliberately split into two halves that never touch the network layer directly: `currentNetwork()` (truncated but visible as an async function reading `PROXY_HEALTH_URL` with a `NETWORK_TTL_MS`-based cache) supplies the 'where are we' answer, while the imported `candidatesForNetwork` from `./lib/prompt-classifier-config.mjs` supplies the 'what can serve that network' answer. This mirrors the parent record's claim that the service reuses llm-routing.yaml's offload-target pattern (ordered list, first enabled network match wins) rather than inventing a second resolution algorithm.
- [ClassifierKnnFallback](./ClassifierKnnFallback.md) -- [LLM] scripts/prompt-classifier-service.mjs imports `PromptKnnClassifier` and `resolveKnnPaths` from `./lib/prompt-classifier-knn.mjs` and instantiates it inside `classifierFor(cfg)`, which caches the classifier instance keyed by `JSON.stringify(resolveKnnPaths(REPO, cfg.knn))` so a hot-reloaded config that doesn't actually change the KNN model/cache paths avoids rebuilding the index. This confirms the *call site* and caching contract for the KNN component, but the file implementing the fallback/abstain decision itself, `lib/prompt-classifier-knn.mjs`, is not among the supplied files.


---

*Generated from 10 observations*
