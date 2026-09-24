# FeatureSnapshotGating

**Type:** Detail

# FeatureSnapshotGating

## What It Is

FeatureSnapshotGating is implemented entirely within the "feature-gating block" of `docker/entrypoint.sh`, centered on the `FEATURES_SNAPSHOT="/coding/.coding/runtime/features.json"` variable and a `PROGRAM_FEATURES` mapping (e.g. `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `health-dashboard:health`). It is the mechanism by which the container decides, at startup, whether individual supervisord-managed programs should be allowed to autostart, based on a pre-resolved JSON snapshot written by the host. It is a child concern of its parent component, SupervisordRuntime, and shares its host script (`entrypoint.sh`) with the sibling EnvFileSecretFiltering, though the two are functionally unrelated.

## Architecture and Design

The design rests on several deliberate patterns. First, **override-not-rewrite layering**: disabled features produce `[program:%s]\nautostart=false\n` stanzas written to `features.d/disabled.conf`, which supervisord includes alongside the base `supervisord.conf`. The entrypoint never templates or rewrites `supervisord.conf` itself, so that file remains the single source of truth for each program's command and logging configuration — gating can only suppress autostart, never redefine behavior.

Second, **fail-open defaults at multiple independent layers**, consistent with the sibling pattern in `wait_for_service()`. An unknown feature key, a missing snapshot file, and a `node` execution crash all resolve to "enabled" rather than "disabled" — deliberately biasing failures toward availability rather than lockout.

Third, **read-only, host-authoritative snapshot consumption**: the container has no path to resolve `~/.coding/features.yaml` itself. It strictly trusts the flat, pre-resolved `features.json` snapshot; the host is the sole authority over feature state, and the container is a passive consumer. This is directly implicated in the unresolved parent-level investigation (Feature Snapshot Forensics) into what rewrites this snapshot into an overly restrictive state.

Fourth, **deferred enforcement**: entrypoint.sh doesn't block on gating decisions — it writes config and lets supervisord enforce autostart behavior after `exec "$@"` hands off control.

## Implementation Details

On every container start, the script does a full rebuild of `/etc/supervisor/features.d`, executing `rm -f "$FEATURES_DIR"/*.conf` before regenerating it — there is no incremental update path. It then iterates the space-separated `PROGRAM_FEATURES` list, splitting each `program:feature` pair via bash parameter expansion (`${pair%%:*}` / `${pair##*:}`) rather than any structured parser.

The enabled/disabled decision itself is delegated to an inline `node -e` one-liner, justified by an in-script comment: "jq is not installed in this image, node is." This snippet reads `snap.features?.[feature]` and treats anything other than an explicit `false` as enabled (`value === false ? "false" : "true"`). The shell wraps the entire call in `|| echo "true"`, providing a second, independent fail-open layer in case `node` itself errors — meaning a malformed snapshot, a missing key, and a parse crash all converge on the same "enabled" outcome.

Notably, entrypoint.sh's `.env`-import block (implementing the sibling EnvFileSecretFiltering) sits adjacent in the same script and shares its execution window — both must complete before `exec "$@"` transfers control to supervisord, since there is no later enforcement checkpoint in the container lifecycle.

## Integration Points

FeatureSnapshotGating integrates downstream with supervisord via `features.d/disabled.conf`, which supervisord.conf is configured to include. Upstream, it depends entirely on the host writing a valid `features.json` to `/coding/.coding/runtime/`, a boundary that is currently the subject of unresolved drift investigation under the parent SupervisordRuntime.

It is verified by `tests/features/container-gating.test.mjs` (referenced in entrypoint.sh's own comments but not directly retrieved here) — distinct from `tests/features/service-gating.test.mjs`, which instead validates a structurally parallel but independent host-side gating system in `scripts/start-services-robust.js` (`SERVICE_CONFIGS`/`SERVICE_ORDER`, PSM-based, gating Node-spawned processes like `transcriptMonitor` and `liveLoggingCoordinator`). These two gating mechanisms — container-side supervisord gating and host-side PSM gating — are not substitutes for one another and carry separate coverage guarantees.

Operationally, it also connects to the "Coding-Services Docker Container — Health Verification Workflow," which added a procedural (non-code) safeguard: capturing pre-restart and post-restart supervisor process/health-endpoint baselines before trusting downstream pipelines like wave-analysis, precisely because services have previously appeared to restart successfully while actually being silently gated off.

## Usage Guidelines

Developers modifying `PROGRAM_FEATURES` should preserve the `program:feature` colon-delimited format, since parsing relies on bash string splitting, not a structured format. Any change to the fail-open semantics of the `node -e` snippet should be made deliberately and documented, as it is a deliberate design choice, not an oversight — but its interaction with the observed snapshot-corruption issue (features.json being rewritten to an overly restrictive "logging-only" state) means fail-open alone has proven insufficient to prevent silent service outages like Constraint Monitor's autostart suppression. Anyone debugging a service that unexpectedly fails to autostart should treat the on-disk snapshot's content as suspect before assuming the gating logic itself is at fault, and should follow the operational health-verification workflow (baseline/post-restart checks) rather than trusting a "successful" restart alone. Finally, do not conflate this gating system with the separate PSM-based gating in `start-services-robust.js`; each has its own coverage test and neither substitutes for the other.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Feature Snapshot Forensics — Runtime Config Drift Investigation' work record establishes that this fail-open design has not been sufficient in practice: across multiple investigation sessions, something rewrites the on-disk `features.json` snapshot that entrypoint.sh consumes into an overly restrictive state (e.g. 'logging-only'), causing the Constraint Monitor service to silently stop autostarting. The root cause of who or what performs this rewrite remains unconfirmed, meaning the snapshot itself — not its absence — is the unresolved failure mode.
- The 'Coding-Services Docker Container — Health Verification Workflow' record shows the operational response to that gap was procedural rather than code-level: docker-compose restarts require capturing a pre-restart baseline of the supervisor process list and a post-restart confirmation that all supervised processes and health endpoints are live, before any downstream pipeline (e.g. wave-analysis) is trusted to depend on the container. This verification step exists entirely outside entrypoint.sh and supervisord.conf, implying supervised services have previously appeared to restart successfully while actually being gated off.

## Hierarchy Context

### Parent
- [SupervisordRuntime](./SupervisordRuntime.md) -- [SESSION] Feature Snapshot Forensics — Runtime Config Drift Investigation documents an ongoing, unresolved effort to find what rewrites the runtime feature snapshot into an overly restrictive state (e.g. 'logging-only'), causing silent service outages.

### Siblings
- [EnvFileSecretFiltering](./EnvFileSecretFiltering.md) -- [LLM] The .env-loading block in docker/entrypoint.sh (lines under 'Environment setup') implements EnvFileSecretFiltering directly: it reads /coding/.env line by line with `IFS='=' read -r key value`, skips comments/blank lines, trims the key with `xargs`, and then runs a `case` statement matching `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` to `continue` before any `export` happens — a pattern-based denylist rather than an allowlist.


---

*Generated from 10 observations*
