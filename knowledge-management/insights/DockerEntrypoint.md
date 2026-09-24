# DockerEntrypoint

**Type:** SubComponent

# DockerEntrypoint — Technical Insight Document

## What It Is

DockerEntrypoint is implemented at `docker/entrypoint.sh`, the container-side startup script for the coding-services Docker image. It sits directly under the parent component DockerizedServices and contains a single child, FeatureGatingScript, which is the concrete "Feature gating" section of the same file (roughly lines 90–140). Rather than duplicating feature-resolution logic inside the container, entrypoint.sh acts as a host-to-container bridge: it consumes a pre-resolved, flattened JSON snapshot rather than the host's original YAML configuration, enforces an egress-security boundary on environment variables, performs best-effort service readiness polling, and finally hands off process control to supervisord.

![DockerEntrypoint — Architecture](images/docker-entrypoint-architecture.png)

## Architecture and Design

The script embodies several deliberate architectural patterns. The most prominent is fail-open, override-not-rewrite feature gating: the host resolves `~/.coding/features.yaml` into a flat snapshot, and the container only ever overlays `autostart=false` directives into a generated `/etc/supervisor/features.d/disabled.conf` include — supervisord.conf remains the single authoritative source for command and logging configuration (docker/entrypoint.sh:~95-135). This is a one-directional, host-owned configuration flow: the raw YAML is never mounted into the container, and the container has no path to mutate or resolve features itself (Architecture Notes).

A second pattern is best-effort readiness polling that always succeeds: `wait_for_service()` (docker/entrypoint.sh:14-30) polls Qdrant and Redis via a pure-bash `/dev/tcp` probe to avoid adding curl/nc as image dependencies, but always `return 0` even after exhausting `max_attempts` (default 30, ~60s), logging only a WARNING. Final correctness is deliberately deferred to supervisord's own restart behavior rather than aborting startup — `set -e` is scoped only to the setup phase, not this gate.

A third pattern is env-var allow/deny filtering as a boundary-enforcement mechanism: the `.env` loader excludes `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` (docker/entrypoint.sh:44-62), a T2 egress-lockdown decision distinct from routing logic elsewhere, forcing LLM/embedding traffic through the host's llm-cli-proxy at :12435.

Finally, the script ends with `exec "$@"` (docker/entrypoint.sh:end), replacing its own process with supervisord exactly once, after setup and gating complete — a clean PID 1 handoff.

## Implementation Details

The FeatureGatingScript child encodes the mapping explicitly as PROGRAM_FEATURES pairs — `semantic-analysis:knowledge`, `graphify:codegraph`, `constraint-monitor:constraints`, `constraint-dashboard:constraints`, `constraint-dashboard-api:constraints`, `health-dashboard:health`, `health-dashboard-frontend:health`, `embedding-listener:knowledge` — parsed via bash parameter expansion (`${pair%%:*}` / `${pair##*:}`). For each pair, it shells out to `node -e` (not jq, which is absent from the image) to evaluate `snap.features?.[feature] === false` against `FEATURES_SNAPSHOT=/coding/.coding/runtime/features.json`.

Two distinct fail-open behaviors are baked in deliberately: if the snapshot file is entirely absent, `features.d` stays empty and every program starts (pre-flag behavior); if a feature key is unknown to the snapshot, it resolves to enabled rather than disabled. The stated rationale: an over-running container is easier to diagnose than one silently starved by a late-arriving JSON file.

## Integration Points

DockerEntrypoint depends on a runtime artifact — `/coding/.coding/runtime/features.json` — written by the host and mounted read-only, but never reads `~/.coding/features.yaml` directly. Its sibling DockerComposeStartupScript describes this same container-side mechanism, confirming entrypoint.sh's role as the definitive implementation. A structurally separate but analogous host-side gating system lives in `scripts/start-services-robust.js`'s SERVICE_CONFIGS/SERVICE_ORDER, policed by `tests/features/service-gating.test.mjs` — while the container-side PROGRAM_FEATURES table is meant to be kept in sync with supervisord.conf's `[program:...]` sections by a not-provided `tests/features/container-gating.test.mjs`.

![DockerEntrypoint — Relationship](images/docker-entrypoint-relationship.png)

Siblings ServiceStarter and ServiceProbe operationalize verification around this script's startup paths, and ProcessStateManager is presumably involved in the supervisor process-list comparisons referenced by the parent DockerizedServices.

## Usage Guidelines

Operators should not treat entrypoint.sh's printed "Service Ports" banner or successful `exec supervisord` as proof of a working container — session records establish that a documented manual workflow of rebuilding via docker-compose and explicitly checking supervised processes plus health endpoints is required, since prior rebuilds have appeared to succeed at the process level while health endpoints remained unready. Similarly, no tooling — including entrypoint.sh — enforces the pre/post supervisor-process-list and container-state comparison around `docker-compose up -d` restarts; this remains manual operational discipline for catching stale naming or misconfigured mounts. When modifying PROGRAM_FEATURES, keep it synchronized with supervisord.conf's `[program:...]` sections, and remember any new secret-like env var naming should match the `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY` exclusion pattern to preserve the egress lockdown guarantee.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Docker Container Restart Verification Baseline establishes a pre/post supervisor-process-list and container-state comparison habit around routine docker-compose up -d restarts to catch regressions like stale naming or misconfigured mounts.
- Feature Snapshot Forensics documents an unresolved investigation into what rewrites the runtime feature snapshot into a restrictive state (e.g. 'logging-only'), causing silent service outages such as the Constraint Monitor Service going down.
- The 'Coding-Services Docker Container — Health Verification Workflow' session record establishes that entrypoint.sh's own startup success (its printed 'Service Ports' banner and `exec supervisord`) is not sufficient evidence the container is usable: the standard operational procedure requires rebuilding via docker-compose and then explicitly confirming supervised processes AND individual health endpoints report live, because a rebuilt container has previously appeared to start successfully at the process level while health endpoints remained unready — a gap entrypoint.sh's own fail-open readiness checks (wait_for_service, feature snapshot fallback) cannot close.
- The 'Docker Container Restart Verification Baseline' record documents that no tooling in this repo — including entrypoint.sh — enforces the pre/post comparison of supervisor process lists and container state around a `docker-compose up -d` restart; this is described explicitly as a manual operational discipline layered on top of docker-compose, meant to catch regressions like stale container naming or misconfigured volume mounts that the entrypoint script itself has no mechanism to detect.

## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [SESSION] Docker Container Restart Verification Baseline establishes a pre/post supervisor-process-list and container-state comparison habit around routine docker-compose up -d restarts to catch regressions like stale naming or misconfigured mounts

### Children
- [FeatureGatingScript](./FeatureGatingScript.md) -- [LLM] docker/entrypoint.sh is the FeatureGatingScript itself: the section headed "Feature gating" (roughly lines 90-140) reads a pre-resolved JSON snapshot at FEATURES_SNAPSHOT="/coding/.coding/runtime/features.json" and, for every space-separated pair in the hardcoded PROGRAM_FEATURES string (e.g. "semantic-analysis:knowledge", "graphify:codegraph", "constraint-monitor:constraints", "constraint-dashboard:constraints", "constraint-dashboard-api:constraints", "health-dashboard:health", "health-dashboard-frontend:health", "embedding-listener:knowledge"), splits on the first ':' with bash parameter expansion (`${pair%%:*}` / `${pair##*:}`) to recover a program name and a feature id. This confirms and extends the parent's [LLM] observation with the exact eight program:feature pairs actually encoded, rather than the four illustrative examples given there.

### Siblings
- [ServiceStarter](./ServiceStarter.md) -- [SESSION] Docker Container Restart Verification Baseline establishes a habit of comparing supervisor process lists and container state before/after docker-compose up -d restarts to catch regressions like stale naming or misconfigured mounts, directly exercising the startup paths this library implements.
- [ServiceProbe](./ServiceProbe.md) -- [SESSION] coding --copilot Launcher Health Check reuses the same rebuild-and-verify Docker workflow as the restart-verification baseline, confirming supervised processes and health endpoints are live before downstream pipelines like wave-analysis depend on them.
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js
- [DockerComposeStartupScript](./DockerComposeStartupScript.md) -- [LLM] docker/entrypoint.sh implements the container-side half of the feature-gating mechanism described in its own inline comments: it reads a flat JSON snapshot at /coding/.coding/runtime/features.json (mounted read-only, written by the host, never the host's ~/.coding/features.yaml itself since that file is never mounted into the container) and, for each entry in the hardcoded PROGRAM_FEATURES mapping (e.g. semantic-analysis:knowledge, constraint-monitor:constraints, health-dashboard:health), invokes `node -e` — not jq, which is explicitly absent from the image — to check snap.features[feature] and writes an `autostart=false` supervisord include into /etc/supervisor/features.d/disabled.conf for anything that resolves to false. An unknown feature name defaults to enabled, so an older host snapshot can never accidentally disable a program it doesn't know about.


---

*Generated from 12 observations*
