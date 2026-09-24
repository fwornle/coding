# ServiceGatingRegistry

**Type:** Detail

## What It Is

ServiceGatingRegistry is not a distinctly named class but a design concept realized concretely as `SERVICE_CONFIGS`, a plain JS object in `scripts/start-services-robust.js`. Each key (`transcriptMonitor`, `liveLoggingCoordinator`, `observationsApi`, etc.) maps to a config entry declaring `name`, `feature`, `psmPath`, `required`, `maxRetries`, `timeout`, `startFn`, and `healthCheckFn`. It is the child mechanism underlying its parent StartServicesOrchestrator's stated rationale that "ten hand-written start blocks were ten chances to forget a gate" — replacing imperative per-service startup code with a declarative, introspectable table. `tests/features/service-gating.test.mjs` treats this object as the canonical registry under test, importing it directly alongside `SERVICE_ORDER` and `startOneService`.

## Architecture and Design

The core pattern is "services as data": rather than imperative start blocks, gating and startup policy are co-located in one declarative config entry per service, coupling feature gating (`feature`, `required`) with operational policy (`maxRetries`, `timeout`, `healthCheckFn`). This single object serves as both runtime source of truth and the artifact the test suite introspects directly — no separate schema or serialization layer exists.

A recurring "structural coverage assertion" pattern ties independently-maintained lists together: the test asserts `SERVICE_ORDER` and `SERVICE_CONFIGS` "cover each other exactly" by sorting and comparing their keys. This same pattern reappears in the sibling ContainerEntrypointFeatureGating, where `docker/entrypoint.sh`'s `PROGRAM_FEATURES` table is checked against `supervisord.conf`'s `[program:...]` sections by `tests/features/container-gating.test.mjs` — architecturally parallel but implemented as a bash string table rather than a JS object, with no evidenced shared code.

Feature identity is validated against an external catalogue (`lib/features/catalogue.cjs`'s `FEATURE_IDS`) rather than a registry-local enum, creating a cross-module contract enforced by tests. Notably, this registry's failure mode is "fail loud" — an unknown feature name throws inside `startOneService` — deliberately opposite to the container-side registry's "fail open" default, illustrating a conscious per-context trade-off rather than an oversight.

## Implementation Details

Gating decisions run through `startOneService`, which consults a resolved-features object (shaped like `loadFeatures()` output) per service call rather than gating globally — demonstrated by `startOneService('observationsApi', results, featureSet({ observations: false }))` returning `started === false` and recording the skip under `results.disabled` with the originating feature name.

`required` enforcement is conditional, not absolute: it only matters when the governing feature is enabled. Tests confirm a `required: true` service with its feature disabled does not block startup (`out.blocked === false`), while a required service whose `startFn` throws (with `maxRetries` monkey-patched to `1` to avoid a six-second backoff) does block (`out.blocked === true`, `results.failed[0].required === true`).

Outcomes are classified into four buckets — `successful`, `degraded`, `failed`, `disabled` — via `emptyResults()`. This distinguishes "off by design" from "failed while wanted," so a disabled service never appears in `degraded`, keeping a minimal install's status report from looking broken relative to a full install.

Ordering is asserted structurally, not just conventional: `SERVICE_ORDER.slice(0, 2)` must equal `['transcriptMonitor', 'liveLoggingCoordinator']`, because later services register against the transcript monitor and its coordinator — reordering without updating the test breaks CI.

## Integration Points

The registry is consumed directly by its runtime orchestrator (`start-services-robust.js`) and imported wholesale by `tests/features/service-gating.test.mjs`, with no intermediary schema. It depends on `lib/features/catalogue.cjs` for valid feature identifiers and implicitly on a `loadFeatures()`-shaped resolver for per-call feature state. Its sibling ContainerEntrypointFeatureGating performs an architecturally similar but independent function inside containers, consuming a pre-resolved `/coding/.coding/runtime/features.json` snapshot since it lacks access to `~/.coding/features.yaml`. Sibling PortCleanupLogic shares the same file (`start-services-robust.js`) but addresses port contention, not gating.

## Usage Guidelines

New services must be added to both `SERVICE_CONFIGS` and `SERVICE_ORDER` since coverage is asserted exactly; omitting one fails tests. Every `feature` value must exist in `FEATURE_IDS`, or `startOneService` throws at call time — typos are not silently tolerated. `required` should be understood as "required only if enabled," not absolute. Ordering changes to `SERVICE_ORDER`, especially the load-bearing transcript-monitor/coordinator pair, require corresponding test updates. Developers modifying container-side gating should remember it is a separate mechanism with an opposite fail-open default, not a shared implementation.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The registry's gating decision is exercised through `startOneService`, imported directly by the test file alongside `SERVICE_CONFIGS`/`SERVICE_ORDER`. The test `'a disabled feature skips the service without starting it'` calls `startOneService('observationsApi', results, featureSet({ observations: false }))` and asserts `started === false`, `out.blocked === false`, and that the skip is recorded in `results.disabled` with the originating `feature` name — proving the registry consults a resolved-features object (shaped like `loadFeatures()` output) per-service rather than gating globally.

**Other:**
- There is no class or file literally named `ServiceGatingRegistry`; the registry function is implemented as a plain object, `SERVICE_CONFIGS`, in `scripts/start-services-robust.js`, where each key (e.g. `transcriptMonitor`, `liveLoggingCoordinator`) maps to a config entry declaring `name`, `feature`, `psmPath`, `required`, `maxRetries`, `timeout`, `startFn`, and `healthCheckFn`. `tests/features/service-gating.test.mjs` treats this object as the canonical registry under test, asserting structurally that every entry in `SERVICE_CONFIGS` declares a `feature` field and that `SERVICE_ORDER` and `SERVICE_CONFIGS` 'cover each other exactly' (`ordered = SERVICE_ORDER.map(o => o.key).sort()` must equal `configured = Object.keys(SERVICE_CONFIGS).sort()`). This is the concrete mechanism behind the parent entity's claim that 'ten hand-written start blocks were ten chances to forget a gate.'
- `required` is a first-class, per-service property in the registry, and its enforcement is conditional on the feature being enabled, not absolute. The test `'a REQUIRED service whose feature is off does not block startup'` sets `SERVICE_CONFIGS.transcriptMonitor.required` to `true` as a precondition, then disables its `lsl` feature and asserts `out.blocked === false` — confirming the parent-entity claim that 'required-ness applies only when the feature is on.' Conversely `'a required failure blocks, so downstream services do not start'` temporarily monkey-patches `SERVICE_CONFIGS.transcriptMonitor.startFn` to throw and `maxRetries` to `1` (explicitly to avoid the real six-second exponential backoff), then asserts `out.blocked === true` and `results.failed[0].required === true`.
- The registry distinguishes three outcome buckets — `successful`, `degraded`, `failed`, `disabled` — via the `emptyResults()` shape used across the test file, and the test `'a disabled service is not reported as degraded'` asserts a feature-off service lands only in `disabled` with `degraded.length === 0`. This directly implements the parent entity's stated rationale: 'Degraded means we wanted this and could not have it,' so conflating an intentionally-off service with one that failed would make a minimal install's status report look broken next to a full install's.
- The registry validates its own `feature` values against a separate catalogue rather than trusting free-form strings: `tests/features/service-gating.test.mjs` loads `FEATURE_IDS` via `require(join(REPO, 'lib/features/catalogue.cjs'))` and asserts every `SERVICE_CONFIGS[key].feature` is a member of that set. The failure-mode test `'an unknown feature on a config is a loud failure, not a silent skip'` temporarily sets `SERVICE_CONFIGS.observationsApi.feature = 'nope'` and asserts `startOneService` rejects with `/unknown feature 'nope'/` — so a typo'd feature name in the registry throws at call time inside `startOneService` rather than defaulting to enabled or disabled.


## Hierarchy Context

### Parent
- [StartServicesOrchestrator](./StartServicesOrchestrator.md) -- [SESSION] Docker Container Restart Verification Baseline establishes capturing supervisor process list and container state as a baseline before docker-compose up -d, to compare against post-restart state and catch regressions like stale naming or misconfigured mounts.

### Siblings
- [PortCleanupLogic](./PortCleanupLogic.md) -- [LLM+CGR] `killProcessOnPortAndWait()` in scripts/start-services-robust.js is the concrete PortCleanupLogic: it takes a `port` and options (`maxWaitMs=5000`, `pollIntervalMs=200`, `label`), first calling an inline `checkPortInUse()` closure (built on `lsof -ti:${port}`) to short-circuit if the port is already free. If occupied, it re-runs `lsof -ti:${port}` to collect PIDs, then loops `process.kill(pid, 'SIGTERM')` over each one. This mirrors the parent's [LLM] observation describing the same function's 'graduated-escalation design' — the code confirms it structurally: SIGTERM is unconditional and immediate, SIGKILL is conditional and delayed.
- [ConstraintMonitorBootstrap](./ConstraintMonitorBootstrap.md) -- [LLM] None of the supplied code files define, export, or reference a symbol, class, or function literally named 'ConstraintMonitorBootstrap'. The closest material is docker/entrypoint.sh's PROGRAM_FEATURES gate (which maps 'constraint-monitor', 'constraint-dashboard', and 'constraint-dashboard-api' program names to the 'constraints' feature and writes autostart=false into /etc/supervisor/features.d/disabled.conf when that feature is off), and start-services.sh's legacy bash block that clones integrations/constraint-monitor, brings up its docker-compose stack (Qdrant + Redis), and starts its dashboard/API processes on ports 3030/3031. Neither of these is a 'bootstrap' abstraction in the sense of a dedicated initialization class/module — they are, respectively, a container-level feature toggle and a shell-scripted legacy startup sequence.
- [ContainerEntrypointFeatureGating](./ContainerEntrypointFeatureGating.md) -- [LLM] docker/entrypoint.sh implements the container-side feature gate as a self-contained bash block (the "Feature gating" section) rather than delegating to a Node script for the decision logic, even though it shells out to `node -e` per-pair for the actual on/off evaluation. The design reads `FEATURES_SNAPSHOT="/coding/.coding/runtime/features.json"` — a flat JSON file mounted read-only — and iterates a space-separated `PROGRAM_FEATURES` string of `program:feature` pairs (`semantic-analysis:knowledge`, `embedding-listener:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `constraint-dashboard:constraints`, `constraint-dashboard-api:constraints`, `health-dashboard:health`, `health-dashboard-frontend:health`), writing `autostart=false` stanzas into `/etc/supervisor/features.d/disabled.conf` for anything found off. This is a materially different mechanism from the host-side `loadFeatures()`/`SERVICE_CONFIGS` gating in scripts/start-services-robust.js — the container has no access to `~/.coding/features.yaml` and cannot run the resolver, so it consumes a pre-resolved snapshot rather than re-deriving the same decision.


---

*Generated from 10 observations*
