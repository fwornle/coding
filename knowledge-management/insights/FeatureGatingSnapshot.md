# FeatureGatingSnapshot

**Type:** Detail

# FeatureGatingSnapshot

## What It Is

FeatureGatingSnapshot is the concrete artifact and mapping mechanism that powers its parent component, SupervisordRuntime: a flat, pre-resolved JSON file at `/coding/.coding/runtime/features.json`, consumed by `docker/entrypoint.sh` to decide which supervisord programs should autostart. The container never resolves features itself — the host-side YAML feature resolver (`~/.coding/features.yaml`) is never mounted into the container — so the snapshot is the sole channel through which feature state crosses the host/container boundary. Inside the entrypoint script, a hardcoded `PROGRAM_FEATURES` string (e.g. `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`) maps supervisord program names to feature keys, and each entry is resolved against the snapshot via a per-feature `node -e` invocation rather than `jq`, since the base image explicitly lacks `jq`.

## Architecture and Design

The defining architectural pattern is a **cross-boundary snapshot handoff**: the host resolves features once (via `loadFeatures()`/YAML) and writes a flat consumable artifact, while the container reads only that artifact and never reimplements resolution logic. This keeps the container's runtime footprint minimal and dependency-free (shell + `node -e`, no `jq`), at the cost of introducing a second, independently-maintained mapping (`PROGRAM_FEATURES`) that must stay in sync with `supervisord.conf`'s `[program:...]` sections — a coupling enforced only by an external test, `tests/features/container-gating.test.mjs`, rather than a shared source of truth.

A second pattern is **config-as-override via `[include]`**: rather than mutating supervisord's canonical program definitions, the script writes `autostart=false` stanzas into `/etc/supervisor/features.d/disabled.conf`, a directory pulled in via `supervisord.conf`'s `[include]` directive. This override layer is additive and fully regenerable — `disabled.conf` is deleted and rewritten (`rm -f "$FEATURES_DIR"/*.conf`) on every boot — so a program's canonical definition remains discoverable in exactly one place, and feature-gating logic can never drift into or corrupt program definitions elsewhere.

Sitting alongside this component at the same architectural level is its sibling, EnvFileImportFilter, which applies the opposite failure direction (fail-closed) to a different concern (secret leakage) within the same script. This is a deliberate **policy segregation by blast radius**: FeatureGatingSnapshot fails open because running an extra program is a correctness nuisance, while EnvFileImportFilter fails closed because leaking a credential is a security violation under the T2 egress-lockdown policy.

## Implementation Details

The resolution loop iterates `PROGRAM_FEATURES`, splitting each `pair` into program and feature name via `${pair%%:*}`/`${pair##*:}` shell parameter expansion — a shell-native map emulation chosen to avoid external dependencies. For each feature, `node -e ... || echo "true"` reads the JSON snapshot; any JS-level failure (parse error, missing `features` key) is swallowed and substituted with `"true"`. This inner fallback is layered under an outer guard, `if [ -f "$FEATURES_SNAPSHOT" ]`, which skips the entire disabling loop if the snapshot file is absent at all. The result is three independent failure modes — missing file, malformed JSON, unrecognized feature key — all collapsing to the same "enabled" outcome, explicitly documented in-code: "An unknown feature reads as enabled, so a snapshot written by an older host cannot silently switch a program off." This protects forward compatibility when a newer container image introduces a `PROGRAM_FEATURES` entry an older host snapshot writer doesn't yet know about.

On the host side, `scripts/start-services-robust.js`'s `SERVICE_CONFIGS` structure is the sibling implementation of this same mapping concept, declaring `feature`/`required`/`maxRetries`/`timeout`/`startFn`/`healthCheckFn` per service and resolving features directly via `loadFeatures()` from `lib/features/index.mjs`, rather than through a snapshot. `writeSnapshot` (from `lib/features/snapshot.cjs`) is the presumed bridge that produces the container-side JSON, but the two resolution paths — shell+`node -e` in the container, direct JS resolution on the host — are not shared code; they are only reconciled by parallel test suites (`container-gating.test.mjs` and `tests/features/service-gating.test.mjs`), both ultimately checking against the same `FEATURE_IDS` catalogue in `lib/features/catalogue.cjs`.

## Integration Points

FeatureGatingSnapshot is the load-bearing dependency of SupervisordRuntime: the parent's entire autostart-toggling behavior depends on this snapshot existing and being current. It also implicitly depends on an unseen upstream step — the host writing `features.json` via `writeSnapshot` before container boot — creating a latent risk that the container and host mappings could diverge if that write falls out of sync with the live host resolver.

Downstream, the host-side `start-services-robust.js` and its `SERVICE_CONFIGS`/`SERVICE_ORDER` registry mirror the same feature catalogue independently, tested by `service-gating.test.mjs` assertions ("every service declares a feature", "every declared feature is a real one"). Notably, `start-services.sh`'s legacy branch (active when `ROBUST_MODE=false`) bypasses this feature-awareness entirely, issuing raw `docker-compose`/`docker run` calls for services like Constraint Monitor with no equivalent of `loadFeatures()` — meaning a feature disabled via `~/.coding/features.yaml` (e.g. `constraints: off`) is correctly gated only in ROBUST_MODE, not in LEGACY MODE.

## Usage Guidelines

Anyone modifying `PROGRAM_FEATURES` in `docker/entrypoint.sh` must simultaneously update `supervisord.conf`'s `[program:...]` sections and expect `container-gating.test.mjs` to catch drift — there is no shared source of truth enforcing this automatically. Because feature gating here is a binary autostart toggle with no concept of "required" (unlike host-side `SERVICE_CONFIGS.transcriptMonitor.required`), developers should not assume container-level escalation to boot-blocking failure; a disabled feature simply means `autostart=false`. When introducing a new feature flag, prefer having it snapshotted with a value the container can read cleanly, since any malformed or missing entry defaults to enabled — a safe default for availability but one that must be understood by anyone auditing which programs are actually running. Finally, any new work relying on feature-gated startup should go through the ROBUST_MODE path (`start-services-robust.js`); the LEGACY MODE branch in `start-services.sh` is an untested, unmaintained liability with respect to feature changes.


## Hierarchy Context

### Parent
- [SupervisordRuntime](./SupervisordRuntime.md) -- [LLM] docker/entrypoint.sh implements a fail-open feature-gating layer that sits in front of supervisord rather than inside it: it reads a host-written snapshot at /coding/.coding/runtime/features.json (mounted read-only) and, for each entry in the PROGRAM_FEATURES mapping (e.g. `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`), shells out to `node -e` to read the flag and writes a `[program:<name]\nautostart=false` stanza into /etc/supervisor/features.d/disabled.conf when a feature is off. Because supervisord.conf's `[include]` directive pulls in that directory, the override never touches the canonical program definitions — it only flips autostart. The script deliberately treats an absent snapshot, an unreadable snapshot, or an unknown feature key as 'enabled' (comment: 'starts everything — the historical behaviour'), which is a conscious fail-open decision to avoid a container that silently runs nothing because a JSON file arrived late.

### Siblings
- [EnvFileImportFilter](./EnvFileImportFilter.md) -- [LLM] docker/entrypoint.sh's .env-loading while-loop (lines beginning `if [ -f /coding/.env ]`) implements what the parent context calls the EnvFileImportFilter: a `case "$key" in *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY) continue ;; esac` guard evaluated per line BEFORE the `export "$key=$value"` step. The filter operates on raw text keys via a `read -r key value` split on `=`, meaning any secret whose env-var name doesn't end in one of those three suffixes (e.g. a bare `SECRET`, `PASSWORD`, or `CREDENTIAL` var) would slip through unfiltered — the T2 boundary is a naming convention enforced by pattern match, not a content-based secret scanner.


---

*Generated from 10 observations*
