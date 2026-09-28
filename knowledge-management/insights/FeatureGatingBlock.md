# FeatureGatingBlock

**Type:** Detail

## What It Is

FeatureGatingBlock is a specific section of `docker/entrypoint.sh` — the code defining `FEATURES_SNAPSHOT`, `FEATURES_DIR`, and the `PROGRAM_FEATURES` loop — that runs as a sub-stage inside its parent, ContainerEntrypoint. It translates a pre-resolved host-side feature snapshot into supervisord's process-supervision model, selectively suppressing autostart of gated-off programs rather than participating in database readiness checks or exec handoff (those belong to the parent).

## Architecture and Design

The block implements an override-file pattern: instead of rewriting `supervisord.conf`, it generates a separate `disabled.conf` in `/etc/supervisor/features.d` containing only `[program:X]\nautostart=false` stanzas, relying on supervisord's `[include]` directive to merge it in. This keeps program definitions (command, logging, env) in a single canonical file while allowing dynamic suppression via a second file — a two-file coordination pattern that only works if program names agree across both files.

Equally central is a fail-open design, applied in two independent places: if `FEATURES_SNAPSHOT` is missing/unreadable, the script falls through to leaving `features.d` empty (everything starts); and within the per-feature `node -e` inline reader, any value other than the literal boolean `false` — including an absent key — is treated as enabled. Both decisions are explicitly justified inline as favoring diagnosability over resource efficiency.

## Implementation Details

`PROGRAM_FEATURES` hardcodes an 8-entry, space-separated string mapping program names to feature IDs (e.g., `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`), parsed via bash parameter expansion (`${pair%%:*}` / `${pair##*:}`) as a POSIX-sh-compatible substitute for associative arrays. Its correctness — that it exactly covers the `[program:...]` sections of `supervisord.conf` — is not verifiable from `entrypoint.sh` alone; it depends on an external test, `tests/features/container-gating.test.mjs`. The feature-enabled determination itself is delegated to a small inline `node -e` script rather than pure bash, producing the string `"true"`/`"false"` consumed by the surrounding shell logic.

## Integration Points

The block consumes a flat, pre-resolved JSON snapshot at `/coding/.coding/runtime/features.json`, read-only-mounted at container start — since `~/.coding/features.yaml` lives on the host and is never mounted, the container cannot run the full resolver and instead relies on this one-way, restart-triggered hand-off (no live-reload path exists here, unlike hot-reload behavior described elsewhere for `llm-routing.yaml`/`prompt-classifier.yaml`).

Within ContainerEntrypoint, this block executes after database-wait and env/secret-filtering steps (`*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` exclusion) and before the final `exec "$@"` that hands control to supervisord — a strictly sequential, unguarded ordering. It also has a structural sibling on the host side: `SERVICE_ORDER`/`SERVICE_CONFIGS` in `scripts/start-services-robust.js`, validated by `tests/features/service-gating.test.mjs`, which mirrors `PROGRAM_FEATURES` conceptually but is maintained completely independently, with drift risk called out explicitly in that test suite.

## Usage Guidelines

Any change to `PROGRAM_FEATURES` must be mirrored in `supervisord.conf`'s `[program:...]` sections and validated against `tests/features/container-gating.test.mjs`; the mapping's correctness is not otherwise enforced. Similarly, changes to feature IDs should be checked against the host-side `SERVICE_CONFIGS` mirror to avoid silent drift, since no shared source-of-truth module exists — enforcement is by parallel tests only. Developers should preserve the current ordering of entrypoint stages (env loading before gating, gating before `exec`) if refactoring into separate scripts, verifying against `supervisord.conf` since it wasn't available in these observations. Finally, treat the fail-open behavior as intentional: a container that silently runs nothing is harder to diagnose than one that runs too much, so tightening these defaults should be a deliberate, documented decision, not an incidental fix.


## Hierarchy Context

### Parent
- [ContainerEntrypoint](./ContainerEntrypoint.md) -- [LLM] docker/entrypoint.sh implements the ContainerEntrypoint directly: it blocks on wait_for_service() TCP checks for Qdrant and Redis before ever invoking supervisord via `exec "$@"`, meaning the container's supervised process tree (feeding into service-probe/service-starter health checks described in the parent) only begins after database reachability is confirmed at the raw TCP level — a weaker guarantee than the HTTP health-endpoint polling the parent describes, since a TCP-open Qdrant/Redis could still be mid-cold-start.


---

*Generated from 9 observations*
