# FeatureGatingEntrypoint

**Type:** Detail

# FeatureGatingEntrypoint — Technical Insight Document

## What It Is

FeatureGatingEntrypoint is implemented in `docker/entrypoint.sh` (roughly lines 95-130 for the core loop, 103-112 for the JSON-parsing snippet), and it constitutes the container-side half of the feature-gating mechanism whose parent component, ConstraintMonitorWrappers, frames as a fail-open translation layer between the host's feature resolver and supervisord. It reads a pre-resolved flat snapshot from `/coding/.coding/runtime/features.json` and, for each `program:feature` pair in the `PROGRAM_FEATURES` mapping (semantic-analysis:knowledge, embedding-listener:knowledge, graphify:codegraph, constraint-monitor:constraints, constraint-dashboard:constraints, constraint-dashboard-api:constraints, health-dashboard:health, health-dashboard-frontend:health), determines whether that program should be disabled. Rather than rewriting `supervisord.conf`, it emits a supplementary `disabled.conf` fragment into `/etc/supervisor/features.d/`, setting `autostart=false` for programs whose feature is explicitly off.

## Architecture and Design

The dominant pattern is an **override-directory design**: supervisord.conf remains the single source of truth for how each program launches (its `command=`, `autostart=` defaults), and the gating layer's blast radius is strictly limited to flipping `autostart=false` for a fixed, enumerable set of programs via a separate config fragment. This keeps the canonical launch definitions untouched and the gating logic auditable in isolation.

A second defining pattern is **fail-open semantics**, deliberately contrasted with fail-closed philosophies used elsewhere (e.g., `required` service retry-exhaustion logic in `scripts/start-services-robust.js`). Three distinct failure modes — an unknown feature key, a missing snapshot file, or a thrown `require()`/JSON.parse error — all resolve to "enabled" rather than "disabled." The comment block frames this explicitly: a stale host snapshot must never silently kill a program, and a late-arriving JSON file must never leave the container running nothing.

Structurally, this entrypoint sits at the coarse end of a two-tier gating architecture. As the Architecture Notes observe, the container-side model only supports whole-program `autostart=false`, whereas the host-side model (SERVICE_CONFIGS, ProcessStateManager) tracks much finer-grained `required`/retry/health-check state — the two are not peer implementations of the same idea but different resolutions of the same underlying problem, with docker/entrypoint.sh consuming a pipeline it has no write access to (`~/.coding/features.yaml` lives only on the host, never mounted).

## Implementation Details

The core loop splits `PROGRAM_FEATURES` pairs using `${pair%%:*}`/`${pair##*:}` bash parameter expansion, rather than an associative array, keeping the mapping a plain space-delimited string. For each pair, it shells out to `node -e` — explicitly instead of `jq`, which per the entrypoint.sh comment is not installed in the image — to evaluate `snap.features?.[feature]` with optional chaining. Only an explicit `value === false` triggers the disabled path; anything else (true, undefined, or a caught parse/require exception via `2>/dev/null || echo "true"`) resolves to the string `"true"`, cementing the fail-open triple-fallback described above.

A related but structurally separate concern lives in the same file: the `.env` import loop (lines ~47-61) filters out `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` variables as an egress-lockdown boundary, paralleling (but not sharing code with) `scripts/prompt-classifier-service.mjs`'s own `process.loadEnvFile()`-based secret-scrubbing — two different mechanisms converging on "never trust host env blindly."

Notably, the entrypoint's gating model has no tri-state distinction. It can only mark a program `autostart=false`; it has no concept analogous to the host-side `disabled` vs. `degraded` distinction that `SERVICE_CONFIGS`/`startOneService()` encode, no retry/backoff, and no `required` boolean. Supervisord consequently reports nothing about *why* a program isn't running — "off due to feature X" and "off because it crashed" are indistinguishable at this layer.

## Integration Points

FeatureGatingEntrypoint is the sole container-side consumer of the host's feature resolution pipeline, terminating a one-way flow that begins at `~/.coding/features.yaml` and produces the flattened `features.json` snapshot. It has no mechanism to write back or influence the resolver.

It shares its parent, ConstraintMonitorWrappers, with siblings ApiServiceWrapper and DashboardServiceWrapper, both of which depend on the `constraints` feature. Notably, `constraint-monitor` (mapped to ApiServiceWrapper's domain) and both `constraint-dashboard`/`constraint-dashboard-api` (DashboardServiceWrapper's domain) are all keyed to the single `constraints` feature flag — a many-to-one mapping meaning toggling one flag takes down the monitor API and both dashboard programs together. Any wrapper expecting independent control (e.g., keeping a dashboard UI alive while the API degrades) cannot assume that granularity exists here.

The feature-to-program mapping (`PROGRAM_FEATURES`) is duplicated independently in `scripts/start-services-robust.js`'s `SERVICE_CONFIGS[key].feature` field, with no shared source of truth. Each is guarded by its own test suite: `tests/features/container-gating.test.mjs` asserts `PROGRAM_FEATURES` covers exactly supervisord.conf's `[program:...]` sections and names only real features, while `tests/features/service-gating.test.mjs` validates `SERVICE_ORDER`/`SERVICE_CONFIGS` against `FEATURE_IDS` from `lib/features/catalogue.cjs`. A feature ID renamed in the catalogue is only caught if both suites run.

## Usage Guidelines

Developers modifying feature gating must update `PROGRAM_FEATURES` in `docker/entrypoint.sh` and the corresponding `SERVICE_CONFIGS[key].feature` entries in `scripts/start-services-robust.js` in tandem — there is no shared source of truth, only parallel structural tests (`tests/features/container-gating.test.mjs` and `tests/features/service-gating.test.mjs`) that must both be run to catch drift.

Because the gating logic is fail-open by design, any new feature added to `PROGRAM_FEATURES` will default to "enabled" if the snapshot is stale, missing, or malformed — this is intentional and should not be "fixed" toward fail-closed without understanding the rationale (a container must never silently run nothing due to config-pipeline timing issues).

When adding new programs gated by a shared feature flag (as with `constraint-dashboard`/`constraint-dashboard-api` under `constraints`), be aware there is no per-program independence: disabling the feature disables all mapped programs uniformly. If finer-grained control is needed, it must be built at the host-side (SERVICE_CONFIGS) layer, since the container-side gating only operates at whole-program `autostart=false` granularity and has no retry, degraded-state, or required-service semantics to build on.


## Hierarchy Context

### Parent
- [ConstraintMonitorWrappers](./ConstraintMonitorWrappers.md) -- [LLM] docker/entrypoint.sh implements a fail-open feature-gating layer that translates the host's `~/.coding/features.yaml` (never mounted into the container) into a supervisord include directory. It reads a flat snapshot at `/coding/.coding/runtime/features.json` and, for each entry in the `PROGRAM_FEATURES` mapping (e.g. `constraint-monitor:constraints`, `constraint-dashboard:constraints`, `constraint-dashboard-api:constraints`), shells out to `node -e` (not `jq`, which isn't installed in the image) to read `snap.features?.[feature]` and writes `[program:<name]\nautostart=false` into `/etc/supervisor/features.d/disabled.conf` when the value is explicitly `false`. An unknown feature key or a missing snapshot file both resolve to 'enabled', which the comment block explicitly frames as deliberate: a stale/older host snapshot must never silently turn a program off, and a late-arriving JSON file must never leave the container running nothing.

### Siblings
- [ApiServiceWrapper](./ApiServiceWrapper.md) -- [LLM] docker/entrypoint.sh's feature-gating block (lines implementing `PROGRAM_FEATURES` and the `node -e` snapshot read) is the container-side half of a symmetric, fail-open design whose host-side counterpart is `scripts/start-services-robust.js`'s `SERVICE_CONFIGS`/`startOneService()` pattern verified by `tests/features/service-gating.test.mjs`. Both interpret an unset or unreadable feature state as 'enabled' rather than 'disabled', but they arrive at that symmetry through different mechanisms: the container writes `autostart=false` stanzas into `/etc/supervisor/features.d/disabled.conf` as an override layer on top of `supervisord.conf`, while the host-side `startOneService()` (asserted by the gating describe block in `tests/features/service-gating.test.mjs`) skips calling `cfg.startFn` entirely and records the skip in `results.disabled`. The entrypoint's approach is structurally weaker because it has no equivalent to the test file's `'every service declares a feature'` and `'every declared feature is a real one'` assertions — nothing in the container guards `PROGRAM_FEATURES` against drifting from `supervisord.conf`'s actual `[program:...]` sections except the comment's claim that `tests/features/container-gating.test.mjs` does this externally.
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- [LLM] docker/entrypoint.sh's feature-gating block is the container-side counterpart of what a 'DashboardServiceWrapper' would need to respect: it maps `constraint-dashboard` and `constraint-dashboard-api` (distinct PROGRAM_FEATURES entries, both keyed to the single `constraints` feature) to supervisord `autostart=false` stanzas written into `/etc/supervisor/features.d/disabled.conf`. Because the mapping is many-to-one (two programs, one feature flag), any dashboard wrapper cannot assume its own on/off state is independently controllable from the constraint-monitor API process — toggling `constraints` off takes down both together, which matters if a wrapper ever tries to keep the dashboard UI alive while the API degrades.


---

*Generated from 10 observations*
