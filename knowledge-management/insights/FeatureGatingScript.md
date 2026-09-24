# FeatureGatingScript

**Type:** Detail

## What It Is

FeatureGatingScript is the "Feature gating" section (roughly lines 90–140) embedded within `docker/entrypoint.sh`, the sole implementation location referenced across all observations. It is not a standalone script but a logical subcomponent of its parent, DockerEntrypoint, responsible for translating a host-resolved feature snapshot into container-level supervisord autostart decisions. It reads a pre-resolved JSON file at `FEATURES_SNAPSHOT="/coding/.coding/runtime/features.json"` and, for a hardcoded set of eight `program:feature` pairs, determines whether each supervisord-managed program should start.

## Architecture and Design

The design is built around three intertwined patterns: fail-open configuration gating, additive override over a base configuration, and regenerate-on-boot idempotency. Every conceivable failure mode — a missing snapshot file (`if [ -f "$FEATURES_SNAPSHOT" ]` else branch), a missing/unknown feature key (`value === false ? "false" : "true"`), or a node runtime error (`|| echo "true"`) — resolves toward "enabled" rather than "disabled." This is a deliberate, stacked redundancy: three independent points all bias toward running more, not less.

The script never redefines what a program does — supervisord.conf remains the single authoritative source for command, working directory, and log paths. FeatureGatingScript only ever emits `autostart=false` stanzas into `$FEATURES_DIR/disabled.conf` (`/etc/supervisor/features.d`), making it strictly additive/subtractive at the autostart layer, never authoritative over program definition. This mirrors a broader system pattern noted in Architecture Notes: feature resolution happens entirely on the host, and the container — via DockerEntrypoint — is a pure consumer of a derived, read-only artifact, never evaluating `features.yaml` itself.

## Implementation Details

The core loop iterates over the hardcoded `PROGRAM_FEATURES` string containing exactly eight pairs: `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `constraint-dashboard:constraints`, `constraint-dashboard-api:constraints`, `health-dashboard:health`, `health-dashboard-frontend:health`, and `embedding-listener:knowledge`. Bash parameter expansion (`${pair%%:*}` / `${pair##*:}`) splits each on the first colon to recover program name and feature id.

For each pair, rather than depending on `jq` (absent from the image), the script shells out to a `node -e` one-liner that `require()`s the snapshot JSON and reads `snap.features?.[featureId]`, applying the fail-open ternary. The entire invocation is wrapped in `|| echo "true"` as a second fail-open layer. When a feature resolves to `"false"`, the script appends a `[program:<name>]\nautostart=false\n\n` stanza to `disabled.conf`, after first `mkdir -p`-ing `FEATURES_DIR` and `rm -f`-ing prior `*.conf` contents — ensuring full regeneration each boot with no stale-entry risk. A `disabled_programs` string accumulates across the loop and is printed as a single summary line, serving as the only audit trail of gating decisions for that boot, since `disabled.conf` itself is overwritten on restart.

## Integration Points

FeatureGatingScript's primary integration point is supervisord: it writes into `features.d`, a directory that supervisord.conf's `[program:...]` sections must incorporate for the autostart override to take effect. This coupling is by convention only, not shared code — `PROGRAM_FEATURES` and supervisord.conf's program list must be manually kept in sync, with `tests/features/container-gating.test.mjs` named in the script's own comments as the intended enforcement mechanism. Notably, that test file is not present among supplied code; the analogous, actually-supplied test is `tests/features/service-gating.test.mjs`, which polices the structurally separate host-side `SERVICE_CONFIGS`/`SERVICE_ORDER` tables in `scripts/start-services-robust.js` — a parallel, non-shared gating system for host launch-time services rather than container programs. This exposes a system-level insight: two independent gating tables, both features.yaml-derived, guarded by separate test suites with no shared validation table between them.

## Usage Guidelines

Developers modifying supervisord program definitions must remember that adding, renaming, or removing a `[program:...]` block in supervisord.conf requires a corresponding manual update to `PROGRAM_FEATURES` in `docker/entrypoint.sh` — there is no automated cross-check today since `tests/features/container-gating.test.mjs` doesn't exist despite being referenced. Any new gated program should follow the existing `program:feature` string convention and rely on the same fail-open semantics: only an explicit `false` in the snapshot disables a program. When debugging unexpected startup behavior (e.g., during the DockerEntrypoint-associated "Docker Container Restart Verification Baseline" checks against stale process lists), inspect the printed summary line ("Disabled by configuration:..." or "All container programs enabled") in stdout, since it is the only per-boot record of gating decisions — `disabled.conf` reflects only the current run's state. Because the design intentionally favors fail-open behavior, absence of expected gating (a program running when it should be disabled) is more likely a bug than the reverse, and should be diagnosed by checking snapshot file presence, JSON validity, and exact feature-id spelling.


## Hierarchy Context

### Parent
- [DockerEntrypoint](./DockerEntrypoint.md) -- [SESSION] Docker Container Restart Verification Baseline establishes a pre/post supervisor-process-list and container-state comparison habit around routine docker-compose up -d restarts to catch regressions like stale naming or misconfigured mounts.


---

*Generated from 10 observations*
