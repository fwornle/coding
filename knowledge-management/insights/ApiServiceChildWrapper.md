# ApiServiceChildWrapper

**Type:** Detail

# ApiServiceChildWrapper — Technical Insight Document

## What It Is

ApiServiceChildWrapper is the child-level detail component under the parent APIServiceWrapper, and its concrete implementation surface spans the service-lifecycle and feature-gating machinery described across `docker/entrypoint.sh`, `scripts/start-services-robust.js`, `scripts/prompt-classifier-service.mjs`, and `start-services.sh`. Where its sibling `FeatureGatingOverride` focuses narrowly on generating the supervisord `disabled.conf` override from `PROGRAM_FEATURES`, ApiServiceChildWrapper represents the broader runtime child-process orchestration layer: the code paths responsible for starting, guarding, and reporting on individual services (transcript monitor, live-logging coordinator, observations API, prompt classifier) once the parent wrapper's feature-gating decision has been applied. It is the layer where a resolved feature snapshot and a supervisord process model turn into actual, safely-spawned child processes.

## Architecture and Design

The dominant pattern is defense-in-depth around process uniqueness: `scripts/start-services-robust.js`'s `transcriptMonitor.startFn` layers PSM global registration, PSM per-project registration, and OS-level `pgrep`-based detection via `isProcessRunningByScript()` before ever calling `spawn()`. This three-layer guard exists because, per the Phase 33 plan 07 retirement of a per-project LSL coordinator, orchestration responsibility that used to live in a separate component was consolidated into this single function — a clear case of architectural consolidation trading distributed complexity for concentrated complexity.

Port-handling logic is split into two purpose-built, non-overlapping helpers rather than one general-purpose "make sure the port is free" function: `killProcessOnPortAndWait()` (SIGTERM → poll `lsof -ti:<port>` → SIGKILL escalation) actively reclaims a port from a live process, while `waitForPortBindable()` passively waits out a kernel TIME_WAIT window using a throwaway `net.createServer().listen()` probe. These two solve visually identical symptoms (EADDRINUSE-like failures) with opposite techniques, and the architecture does not chain them automatically — callers must know to combine them.

Config lifecycle in `scripts/prompt-classifier-service.mjs` mirrors the service-lifecycle pattern but for configuration rather than processes: `loadConfig({force})` uses mtime comparison to hot-reload `CONFIG_PATH`, preserving the last-known-good config and recording `configError` for `/health` rather than throwing. Both this module and `start-services-robust.js` independently reinvent similar reload/fallback shapes without sharing an abstraction — a maintainability gap noted directly in architecture notes.

## Implementation Details

Key functions and their mechanics:

- **`isProcessRunningByScript()`** — OS-level orphan detection via `pgrep -lf`, the last-resort check before spawning.
- **`killProcessOnPortAndWait()`** — escalating termination (SIGTERM, poll, SIGKILL after `maxWaitMs/2`).
- **`waitForPortBindable()`** — a throwaway socket probe distinguishing kernel-held sockets from `isPortListening`'s HTTP-level check.
- **`SERVICE_CONFIGS.transcriptMonitor.startFn`** — the concrete three-layer guard described above, using `spawn('node', [...], {detached:true})` only once all checks pass.
- **`loadConfig()` / `envFallbackConfig()`** — hot-reload with legacy single-endpoint fallback (`CLASSIFIER_BACKEND_URL`/`QWEN_LAPTOP_API_BASE_URL`) preserved as the pre-2026-09-02 behavior when YAML is unreadable and no config has ever loaded.
- **Top-level empty-env sanitization** in `prompt-classifier-service.mjs` — deletes empty-string env vars before `process.loadEnvFile(ENV_FILE)`, justified by a real production incident (`asked: 18, answered: 0, failed: 18`) and necessitated by the fact that `loadEnvFile` won't overwrite an already-set variable.
- **`ROBUST_MODE` branch in `start-services.sh`** — `exec`s into `start-services-robust.js`, rendering ~150 lines of legacy Docker/constraint-monitor bash unreachable and untested under default configuration.

`SERVICE_ORDER`/`SERVICE_CONFIGS` correctness (coverage, ordering, `feature` membership in `FEATURE_IDS`) is enforced purely externally by `tests/features/service-gating.test.mjs`, with zero runtime assertion at the point the orchestrator actually consumes `SERVICE_ORDER`.

## Integration Points

ApiServiceChildWrapper sits downstream of the parent APIServiceWrapper's feature-gating decision (`docker/entrypoint.sh`'s fail-open snapshot translation of `/coding/.coding/runtime/features.json`) and structurally cannot resolve feature state itself — it only consumes it, mirroring the one-way host→container dependency described at the parent level. It shares the `FEATURE_IDS` contract from `lib/features/catalogue.cjs` with sibling `FeatureGatingOverride`'s `PROGRAM_FEATURES` mapping, though the two are validated by entirely separate mechanisms (bash `node -e` parsing vs. JS test coverage), with no shared module bridging the duplicated feature-flag parsing logic across languages. The result vocabulary (`successful`, `degraded`, `failed`, `disabled`) returned by `startOneService` is a load-bearing interface contract enforced behaviorally by `tests/features/service-gating.test.mjs`, distinguishing `disabled` (feature off, `startFn` never invoked) from `degraded`/`failed` outcomes, and clarifying that `required: true` only blocks startup when combined with feature-enablement. `prompt-classifier-service.mjs` integrates with `rapid-llm-proxy`'s `/health` endpoint as its sole source of truth for network mode, deliberately avoiding independent network sensing.

## Usage Guidelines

Developers modifying `SERVICE_CONFIGS`/`SERVICE_ORDER` must run the full `service-gating` test suite, since no runtime guard prevents a hand-edited reordering from breaking the transcript-monitor/live-logging-coordinator startup precedence. Any caller needing to free a port should invoke both `killProcessOnPortAndWait()` and `waitForPortBindable()` together — using one without the other reintroduces the EADDRINUSE race the second was written to close. Changes to `features.json`'s shape must be replicated by hand in both the bash-embedded `node -e` snippet in `docker/entrypoint.sh` and the JS-side loader, since no shared module or test currently guards against drift between them. The `ROBUST_MODE=false` legacy path and `envFallbackConfig()` should be treated as unverified escape hatches — retained deliberately but unexercised by any automated check — so changes to constraint-monitor image tags or config formats should not assume the legacy branches still function correctly without manual verification.


## Hierarchy Context

### Parent
- [APIServiceWrapper](./APIServiceWrapper.md) -- [LLM] docker/entrypoint.sh implements a fail-open feature-gating override layered on top of supervisord rather than a rewrite of supervisord.conf itself: it reads a host-written snapshot at /coding/.coding/runtime/features.json and, for each entry in the PROGRAM_FEATURES mapping (e.g. `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`), shells out to `node -e` (not jq, which isn't installed in the image) to decide whether to emit a `[program:X]\nautostart=false` stanza into /etc/supervisor/features.d/disabled.conf. The comment block explicitly justifies the 'unknown feature reads as enabled' default and the 'missing snapshot starts everything' default as deliberate fail-open behavior, reasoning that a container that silently runs nothing because a JSON file arrived late is harder to diagnose than one that runs too much — this is an explicit trade-off favoring debuggability over minimalism at container boot.

### Siblings
- [FeatureGatingOverride](./FeatureGatingOverride.md) -- [LLM] docker/entrypoint.sh implements the feature gate as a generated supervisord *include* rather than a templated supervisord.conf: it always does `rm -f "$FEATURES_DIR"/*.conf` then rebuilds `/etc/supervisor/features.d/disabled.conf` from scratch on every container start, iterating the space-delimited `PROGRAM_FEATURES` string (`semantic-analysis:knowledge embedding-listener:knowledge graphify:codegraph constraint-monitor:constraints constraint-dashboard:constraints constraint-dashboard-api:constraints health-dashboard:health health-dashboard-frontend:health`) and splitting each `program:feature` pair with bash parameter expansion (`${pair%%:*}` / `${pair##*:}`). This means supervisord.conf's `[program:...]` blocks are the single source of truth for command/logging, and features.d only ever emits `autostart=false` overrides — an additive-diff design that keeps the override surface small enough to regenerate unconditionally instead of diffing against a previous run.


---

*Generated from 12 observations*
