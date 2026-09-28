# ServiceFeatureGatingContract

**Type:** Detail

## What It Is

No file in the supplied sources — docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, or tests/features/service-gating.test.mjs — defines, exports, or names a class, module, or contract literally called "ServiceFeatureGatingContract." This is not a concrete artifact but an analytical label describing a *policy* that is enforced redundantly by two separate mechanisms: the Node-based orchestrator in scripts/start-services-robust.js (via SERVICE_CONFIGS, SERVICE_ORDER, and startOneService) and the container-level supervisord gating in docker/entrypoint.sh (via the PROGRAM_FEATURES mapping and generated disabled.conf). The closest thing to a specification of this contract is tests/features/service-gating.test.mjs, which exercises the expected behavior of startOneService against feature flags.

## Architecture and Design

INSUFFICIENT_EVIDENCE: the observations describe two independently-implemented gating mechanisms (entrypoint.sh's supervisord approach and start-services-robust.js's Node approach) plus their test suite, but no single "ServiceFeatureGatingContract" abstraction that unifies them — so architectural claims below describe the surrounding mechanisms, not a verified contract object.

That said, the pattern evident across observations is a declarative-configuration-drives-imperative-startup design: SERVICE_CONFIGS/SERVICE_ORDER tables describe services (including transcriptMonitor and liveLoggingCoordinator entries) that startOneService interprets at runtime. In parallel, docker/entrypoint.sh performs the equivalent policy check at the container/process-manager layer, translating PROGRAM_FEATURES entries (semantic-analysis, graphify, constraint-monitor, etc.) into supervisord autostart flags. These two enforcement points are structurally distinct — one skips a startFn call, the other mutates a generated disabled.conf — and neither imports or calls the other, so their consistency depends entirely on two independently maintained mappings staying in sync. Sibling components FeatureGatingDisabledConfBuilder (the entrypoint.sh disabled.conf-writing logic) and ServiceStarterRetryPolicy (the scattered maxRetries/timeout fields and startServiceWithRetry import) represent adjacent facets of this same broader gating/startup area under the parent DockerMcpConfigGenerator, itself also unverified against the supplied sources.

## Implementation Details

The Node-side mechanism centers on startOneService(key, results, featureSet), which per tests/features/service-gating.test.mjs must: skip the service's startFn entirely when its declared `feature` is disabled (recording into results.disabled rather than results.degraded); throw loudly on an unknown feature id; and only set out.blocked = true when a *required* service's feature is enabled but startFn still fails (populating results.failed). Critically, blocking is conditional on feature-enablement, not on the `required` flag alone — a required-but-disabled service must not block startup, while a required-and-enabled-but-failing service must. This is a nontrivial state machine (disabled vs degraded vs failed vs blocked) that could easily regress if "off" and "failed" are conflated.

The container-side mechanism in docker/entrypoint.sh works differently: it generates /etc/supervisor style disabled.conf content via an embedded `node -e` snippet, mapping program names to feature ids through PROGRAM_FEATURES and mutating supervisord's autostart flag rather than skipping a function call. scripts/start-services-robust.js also contains port-race handling (killProcessOnPortAndWait / waitForPortBindable) used during service restarts, though this is adjacent retry/robustness machinery rather than gating logic itself.

## Integration Points

start-services.sh is the entry point that decides which gating mechanism actually runs: when ROBUST_MODE=true (the default), it execs into start-services-robust.js and the full feature-gating contract applies. When ROBUST_MODE=false, it takes a legacy path that directly starts constraint-monitor Docker containers and web services via hardcoded check_docker/docker-compose ps checks, entirely bypassing SERVICE_CONFIGS, feature ids, and FEATURE_IDS. This legacy path is dead-but-reachable code that the test suite cannot see, since tests/features/service-gating.test.mjs only exercises start-services-robust.js directly — meaning the contract can be silently skipped via an environment variable with no test coverage of that gap.

scripts/prompt-classifier-service.mjs, despite being retrieved alongside these files, is thematically unrelated (network-aware backend selection and YAML-config hot-reload for LLM classification) and contributes no evidence here, suggesting retrieval was keyed on the word "service" rather than on the gating contract itself.

## Usage Guidelines

Anyone modifying gating behavior must update both docker/entrypoint.sh's PROGRAM_FEATURES mapping and start-services-robust.js's SERVICE_CONFIGS/feature declarations together, since there is no shared code enforcing consistency between the container-layer and orchestrator-layer policies — the entrypoint's own comments point to a separate container-gating test as the authority for that side, not tests/features/service-gating.test.mjs. When adding new services or features, preserve the disabled/degraded/failed/blocked distinction exactly as specified by the existing tests, particularly the rule that "feature off" must never be treated as "failed." Be aware that ROBUST_MODE=false disables the entire contract; if this fallback path is still needed operationally, it should either be brought under equivalent feature-gating logic or explicitly deprecated, since currently it is an unguarded, untested bypass.


## Hierarchy Context

### Parent
- [DockerMcpConfigGenerator](./DockerMcpConfigGenerator.md) -- [LLM] No file among the supplied sources — docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, tests/features/service-gating.test.mjs — defines, imports, or references a class, function, or module named 'DockerMcpConfigGenerator'. The closest thematic neighbors are docker/entrypoint.sh's feature-gating block (lines building /etc/supervisor/features.d/disabled.conf from a features.json snapshot) and lib/service-starter.js (referenced by start-services-robust.js), neither of which generates MCP configuration.

### Siblings
- [FeatureGatingDisabledConfBuilder](./FeatureGatingDisabledConfBuilder.md) -- [LLM] No supplied file defines, imports, or references a class/function/module named 'FeatureGatingDisabledConfBuilder'. The closest thematic match is the inline feature-gating block in docker/entrypoint.sh (the section building /etc/supervisor/features.d/disabled.conf), but that logic is implemented as a bash loop plus an embedded `node -e` one-liner — not as a named builder class or function anywhere in the retrieved sources. The component name appears to be an analytical label applied to entrypoint.sh's disabled.conf-writing behavior rather than an actual identifier in the codebase.
- [ServiceStarterRetryPolicy](./ServiceStarterRetryPolicy.md) -- [LLM] No file among the supplied sources — docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, tests/features/service-gating.test.mjs — defines a class, function, or module literally named 'ServiceStarterRetryPolicy'. The nearest actual retry machinery is the imported `startServiceWithRetry` function (imported into scripts/start-services-robust.js from '../lib/service-starter.js', a file not included in this excerpt) plus the per-service `maxRetries`/`timeout` fields declared inline on each SERVICE_CONFIGS entry (e.g. transcriptMonitor's `maxRetries: 3, timeout: 20000`). There is no standalone 'policy' object, class, or config schema visible anywhere in the supplied code — retry behavior is scattered as literal fields on each service config rather than being centralized in any named policy abstraction.


---

*Generated from 9 observations*
