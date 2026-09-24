# ContainerEntrypointFeatureGating

**Type:** Detail

## What It Is

ContainerEntrypointFeatureGating is implemented entirely within `docker/entrypoint.sh`, in a self-contained "Feature gating" bash section that decides which supervisord-managed programs should start inside the container. It is a child concept under the StartServicesOrchestrator parent, but it is architecturally distinct from its sibling ServiceGatingRegistry: rather than consulting a host-resolvable feature config, it reads a pre-resolved, read-only JSON snapshot mounted at `/coding/.coding/runtime/features.json`. The gate iterates a hardcoded, space-separated `PROGRAM_FEATURES` string of `program:feature` pairs (e.g. `semantic-analysis:knowledge`, `constraint-monitor:constraints`, `health-dashboard:health`) and, for each pair whose feature evaluates to `false`, writes an `autostart=false` stanza into `/etc/supervisor/features.d/disabled.conf`.

## Architecture and Design

The core architectural pattern is **config snapshot consumption**: the container has no access to `~/.coding/features.yaml` and cannot execute the host's resolver logic (found in `scripts/start-services-robust.js`'s `loadFeatures()`), so it trusts a flat JSON artifact produced elsewhere and mounted in. This is a deliberate decoupling — the container-side gate and the host-side `SERVICE_CONFIGS`/`SERVICE_ORDER` gating embodied in sibling ServiceGatingRegistry are two independent mechanisms answering the same question ("should this run?") through different data paths, not a shared implementation.

A second defining pattern is the **additive configuration overlay**: instead of rewriting supervisord.conf's `[program:...]` blocks, the gate only ever adds `autostart=false` stanzas into a separate `/etc/supervisor/features.d/` directory, presumably pulled in via an `[include]` directive. supervisord.conf remains the single canonical definition of command/logging setup. This overlay is regenerated idempotently on every start — the directory is cleared (`rm -f "$FEATURES_DIR"/*.conf`) before repopulation — preventing a stale disabled.conf from a prior run or a since-removed feature pairing from mis-gating the current container.

The third defining pattern, stated explicitly in the script's own comments, is **fail-open by design in two independent places**: an unknown feature name defaults to enabled, and a missing/unreadable snapshot file skips gating entirely, logging "starting everything." The rationale given directly in-source is diagnosability: a container that silently runs nothing is harder to debug than one that runs too much.

## Implementation Details

Mechanically, the gate is a bash loop over `$PROGRAM_FEATURES`, splitting each `program:feature` pair and invoking `node -e` per pair to evaluate the feature's boolean value from the snapshot. The choice of `node -e` over `jq` is explicit and pragmatic — the script comments note "jq is not installed in this image, node is" — so the JSON parsing logic lives as an inline, argv-driven one-liner (snapshot path and feature name passed as arguments) rather than a separate, testable helper. The inline snippet's fail-open logic hinges on a narrow check: it only emits `'false'` when `value === false` is literally true; anything else — `undefined`, missing keys, other truthy/falsy values — defaults to enabled.

When a feature is off, the loop appends a `[program:%s]\nautostart=false\n\n` stanza to `disabled.conf` for that program name. The `FEATURES_SNAPSHOT` and `FEATURES_DIR` variables anchor the file paths, and the whole block is guarded by `if [ -f "$FEATURES_SNAPSHOT" ]`, falling to an else branch that logs and takes no gating action if absent.

## Integration Points

The gate's only external dependency is the mounted `features.json` snapshot, which structurally corresponds to program/feature names documented in `docs/architecture/features.md` — `PROGRAM_FEATURES` is a hand-maintained mirror of that mapping. Downstream, its output (`disabled.conf`) integrates with supervisord via the `/etc/supervisor/features.d/` include mechanism, not shown in supplied files but inferred from the additive-overlay design.

Within the StartServicesOrchestrator hierarchy, this component is one of several independent gating surfaces alongside sibling ServiceGatingRegistry (host-side `SERVICE_CONFIGS` in `scripts/start-services-robust.js`) and ConstraintMonitorBootstrap-adjacent program names (`constraint-monitor`, `constraint-dashboard`, `constraint-dashboard-api`) that this gate also toggles via the `constraints` feature. PortCleanupLogic's `killProcessOnPortAndWait()` is unrelated in mechanism but co-resides in the same orchestration layer.

## Usage Guidelines

Any change to the snapshot's shape (e.g., renaming the `features` key) requires directly editing the embedded `node -e` string in `entrypoint.sh` — there is no importable/unit-testable function equivalent to the host-side `lib/service-starter.js` functions. When adding a new program to supervisord.conf that should be feature-gated, `PROGRAM_FEATURES` must be updated to include the corresponding `program:feature` pair; a described (but not supplied) test, `tests/features/container-gating.test.mjs`, is claimed to assert exact coverage between `PROGRAM_FEATURES` and supervisord.conf's `[program:...]` sections, but this file was absent from the evidence — `tests/features/service-gating.test.mjs` only covers the host-side `SERVICE_CONFIGS`/`SERVICE_ORDER` parity, leaving the container-side structural-parity claim unverified in the current codebase snapshot. Developers should treat the fail-open defaults as intentional: don't assume an unrecognized feature name will disable a program, and don't assume a missing snapshot file silently gates anything — both cases start everything by design.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- Because the code_graph block supplied above is empty, none of these observations can be grounded in static call-graph relationships (e.g. what imports/calls `waitForPortBindable`, `killProcessOnPortAndWait`, or the `node -e` snippet in entrypoint.sh) — all analysis here is derived directly from reading the source text of the five files, not from graph-verified cross-references.


## Hierarchy Context

### Parent
- [StartServicesOrchestrator](./StartServicesOrchestrator.md) -- [SESSION] Docker Container Restart Verification Baseline establishes capturing supervisor process list and container state as a baseline before docker-compose up -d, to compare against post-restart state and catch regressions like stale naming or misconfigured mounts.

### Siblings
- [PortCleanupLogic](./PortCleanupLogic.md) -- [LLM+CGR] `killProcessOnPortAndWait()` in scripts/start-services-robust.js is the concrete PortCleanupLogic: it takes a `port` and options (`maxWaitMs=5000`, `pollIntervalMs=200`, `label`), first calling an inline `checkPortInUse()` closure (built on `lsof -ti:${port}`) to short-circuit if the port is already free. If occupied, it re-runs `lsof -ti:${port}` to collect PIDs, then loops `process.kill(pid, 'SIGTERM')` over each one. This mirrors the parent's [LLM] observation describing the same function's 'graduated-escalation design' — the code confirms it structurally: SIGTERM is unconditional and immediate, SIGKILL is conditional and delayed.
- [ConstraintMonitorBootstrap](./ConstraintMonitorBootstrap.md) -- [LLM] None of the supplied code files define, export, or reference a symbol, class, or function literally named 'ConstraintMonitorBootstrap'. The closest material is docker/entrypoint.sh's PROGRAM_FEATURES gate (which maps 'constraint-monitor', 'constraint-dashboard', and 'constraint-dashboard-api' program names to the 'constraints' feature and writes autostart=false into /etc/supervisor/features.d/disabled.conf when that feature is off), and start-services.sh's legacy bash block that clones integrations/constraint-monitor, brings up its docker-compose stack (Qdrant + Redis), and starts its dashboard/API processes on ports 3030/3031. Neither of these is a 'bootstrap' abstraction in the sense of a dedicated initialization class/module — they are, respectively, a container-level feature toggle and a shell-scripted legacy startup sequence.
- [ServiceGatingRegistry](./ServiceGatingRegistry.md) -- [LLM+CGR] There is no class or file literally named `ServiceGatingRegistry`; the registry function is implemented as a plain object, `SERVICE_CONFIGS`, in `scripts/start-services-robust.js`, where each key (e.g. `transcriptMonitor`, `liveLoggingCoordinator`) maps to a config entry declaring `name`, `feature`, `psmPath`, `required`, `maxRetries`, `timeout`, `startFn`, and `healthCheckFn`. `tests/features/service-gating.test.mjs` treats this object as the canonical registry under test, asserting structurally that every entry in `SERVICE_CONFIGS` declares a `feature` field and that `SERVICE_ORDER` and `SERVICE_CONFIGS` 'cover each other exactly' (`ordered = SERVICE_ORDER.map(o => o.key).sort()` must equal `configured = Object.keys(SERVICE_CONFIGS).sort()`). This is the concrete mechanism behind the parent entity's claim that 'ten hand-written start blocks were ten chances to forget a gate.'


---

*Generated from 9 observations*
