# PsmLazyImportPattern

**Type:** Detail

# PsmLazyImportPattern: Technical Insight Document

## What It Is

`PsmLazyImportPattern` is a naming label attached to the way `ProcessStateManager` is consumed in `scripts/start-services-robust.js`, but the observations establish clearly that the name is a misnomer relative to the actual code. At line ~38, the file contains a static, top-level ES module import — `import ProcessStateManager from './process-state-manager.js';` — and at line ~42, a module-scope singleton is constructed eagerly: `const psm = new ProcessStateManager();`. Both of these execute the instant the file loads, before any `SERVICE_CONFIGS` entry's `startFn` runs. There is no dynamic `import()` anywhere in the reviewed files. So as an "import pattern," this is the opposite of lazy — it is eager, singleton, module-scope instantiation of the parent entity, `ProcessStateManager`.

## Architecture and Design

The genuine deferral in this system happens at a different layer than importing: it is achieved through ordinary JavaScript closures. Calls like `psm.isServiceRunning('transcript-monitor', 'global')` and `psm.isServiceRunning('enhanced-transcript-monitor', 'per-project', { projectPath: TARGET_PROJECT_PATH })` are embedded inside each service's `startFn` (e.g., `transcriptMonitor.startFn`, `liveLoggingCoordinator.startFn`) declared in the sibling `ServiceRegistration` catalogue (`SERVICE_CONFIGS`/`SERVICE_ORDER`). These closures only execute when `startOneService()` walks `SERVICE_ORDER` and reaches that particular entry. The practical effect — PSM's registry not being queried until a service is actually being considered — resembles laziness, but it is call-site deferral of an already-imported, already-constructed object, not deferred loading of the module itself.

A second, more legitimate "lazy" mechanism exists at the language boundary: `start-services.sh`, written in bash, cannot perform a JS import at all. Instead it shells out per-check via `node scripts/psm-register.js --check transcript-monitor global`. This CLI-wrapper indirection spawns a fresh Node process (and presumably a fresh PSM instantiation) only at the exact moment bash needs an answer, with no persistent in-process object surviving between checks — architecturally the closest thing to true lazy access in the codebase, though it arises from a cross-language constraint rather than an intentional laziness strategy in the Node code.

Separately, `docker/entrypoint.sh` implements an unrelated boot-time gating mechanism using a static JSON snapshot (`FEATURES_SNAPSHOT=/coding/.coding/runtime/features.json`), parsed once via `node -e` to set supervisord `autostart` flags. This operates at the container-enablement layer, decided once at boot and fail-open on a missing snapshot — a different failure philosophy from PSM's per-call dedup checks, which exist to *avoid* redundant starts. The two systems never call into each other, so any "lazy import" framing does not transfer between them.

## Implementation Details

The core mechanics are: (1) a single `import ProcessStateManager from './process-state-manager.js'` statement, (2) a single `const psm = new ProcessStateManager()` at module scope, and (3) multiple call sites distributed across `startFn` closures that invoke `psm.isServiceRunning(...)` with different arguments — a service key, a scope (`'global'` vs `'per-project'`), and, for per-project checks, an options object carrying `projectPath: TARGET_PROJECT_PATH`. Because `psm` is constructed once and shared, whatever internal state `ProcessStateManager` holds (a registry file handle, an in-memory cache populated at construction, etc. — internals not visible in the reviewed excerpts) is read once and reused for the lifetime of a single `start-services-robust.js` run. This raises a subtle correctness question: if PSM's on-disk state changes mid-run due to another process, later `isServiceRunning()` calls would only see that change if the class actively re-reads state on every call rather than relying on a cached snapshot from construction time.

The bash-side implementation is structurally different: rather than sharing an object, `start-services.sh` invokes `scripts/psm-register.js` as a subprocess CLI wrapper per check, with no persistent object at all between invocations. This is a language-boundary-forced pattern rather than a deliberate architectural choice — bash simply has no equivalent to an ES module import.

## Integration Points

`PsmLazyImportPattern` sits directly beneath its parent, `ProcessStateManager`, describing one specific way that class is consumed. It interacts closely with the sibling `ServiceRegistration` pattern: PSM's `isServiceRunning` calls are only reachable through the `startFn` closures that `ServiceRegistration`'s `SERVICE_CONFIGS`/`SERVICE_ORDER` catalogue declares and sequences via `startOneService()`. The layered liveness-check strategy (PSM global registry → PSM per-project registry → OS-level `pgrep`, per the architectural-patterns observation) wraps this single imported dependency in defense-in-depth. The bash-side integration point is `scripts/psm-register.js`, a CLI wrapper that lets `start-services.sh` reach PSM state without a JS import. `docker/entrypoint.sh`'s snapshot-based gating is a structurally unrelated sibling mechanism at the container layer, sharing no runtime coupling with PSM.

## Usage Guidelines

Developers should not describe or extend this pattern using "lazy import" language, since no dynamic `import()` exists — any future refactor labeled as making PSM access "lazy" should be understood as changing closure/call-site placement, not import timing. Because `psm` is a shared singleton, any change to `ProcessStateManager`'s internals affecting cache freshness (e.g., adding a rechecking read vs. relying on construction-time state) has run-wide implications for every `startFn` that queries it, including at least `transcriptMonitor` and `liveLoggingCoordinator`. Notably, `tests/features/service-gating.test.mjs` — the only test file in scope — imports solely `startOneService, SERVICE_CONFIGS, SERVICE_ORDER` and never `ProcessStateManager` directly; its gating tests substitute `SERVICE_CONFIGS.transcriptMonitor.startFn` wholesale (e.g., replacing it with a function that throws) rather than exercising the real `psm.isServiceRunning(...)` path. This means the eager-singleton-vs-lazy-construction strategy for PSM is completely untested, and a regression converting it to per-call lazy construction would pass this suite silently. Any future work intending to genuinely change PSM's instantiation strategy should add direct tests importing `ProcessStateManager`, and should not conflate PSM's runtime dedup role with the unrelated boot-time snapshot gating in `docker/entrypoint.sh`.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js

### Siblings
- [ServiceRegistration](./ServiceRegistration.md) -- [LLM] The SERVICE_CONFIGS/SERVICE_ORDER pair in scripts/start-services-robust.js implements ServiceRegistration as a declarative catalogue rather than a sequence of imperative start calls: each entry (e.g. `transcriptMonitor`, `liveLoggingCoordinator`) carries `feature`, `psmPath`, `required`, `maxRetries`, `timeout` and a `startFn`/`healthCheckFn` pair, and tests/features/service-gating.test.mjs enforces structural invariants over that catalogue directly — 'every service declares a feature', 'every declared feature is a real one' (checked against `FEATURE_IDS` from lib/features/catalogue.cjs), and 'SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly'. This turns a class of historical bugs (a tenth service added to the object literal but never wired into the boot sequence, or wired in without a feature gate) into a unit-test failure instead of a runtime surprise, at the cost of requiring every future service addition to touch three places in lockstep (the config object, the order array, and the feature catalogue).


---

*Generated from 9 observations*
