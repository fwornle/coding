# FeatureGatedSupervisorConfig

**Type:** Detail

## What It Is

FeatureGatedSupervisorConfig is implemented in `docker/entrypoint.sh`, specifically the `FEATURES_SNAPSHOT`/`PROGRAM_FEATURES`/`FEATURES_DIR` block spanning roughly lines 90-140. It reads a host-written, read-only-mounted feature snapshot at `/coding/.coding/runtime/features.json`, and for each `program:feature` pair listed in the flat, whitespace-separated `PROGRAM_FEATURES` string (e.g. `semantic-analysis:knowledge`, `constraint-dashboard:constraints`, `health-dashboard-frontend:health`), it invokes a small `node -e` one-liner to check `snap.features?.[feature]`. Any pair that resolves to `false` causes an `autostart=false` stanza to be appended to `/etc/supervisor/features.d/disabled.conf`, which supervisord includes alongside its main `supervisord.conf`. It is thus best understood not as a config file but as a generation step baked into container startup that produces a supervisord override layer.

## Architecture and Design

The dominant pattern is config-override-via-include-directory: `supervisord.conf` "stays the single place every program's command and logging are defined," per the entrypoint's own comment, and `features.d` only ever adds `autostart=false` stanzas on top, never rewriting the base config. `FEATURES_DIR` is cleared (`rm -f "$FEATURES_DIR"/*.conf`) at the top of every container start, guaranteeing stale gating state can't survive a restart.

A second defining decision is fail-open gating, applied at two independent levels: if the snapshot file is absent entirely, the script logs "starting everything" and leaves `features.d` empty; and inside the `node -e` snippet, `value === false ? "false" : "true"` means any feature id missing from the snapshot's `features` object is treated as enabled. Both defaults bias toward running programs rather than silently disabling them, explicitly to protect against schema drift between an older host snapshot and a newer container.

The design also crosses a host/container trust boundary: the container cannot compute feature resolution itself (the resolver source, `~/.coding/features.yaml`, lives only on the host), so `features.json` is the sole read-only channel between host and container, with no live query path.

## Implementation Details

`PROGRAM_FEATURES` is parsed via plain bash word-splitting and parameter expansion (`${pair%%:*}`, `${pair##*:}`) rather than an associative array, favoring plain-bash compatibility over structure. This costs one `node` subprocess per pair — currently eight per container start — purely to read one JSON key each, a deliberate trade-off because `jq` isn't installed in the image but `node` is. This is a notable language-boundary crossing mid-script: an otherwise pure-bash entrypoint shells out to Node for JSON parsing.

The mapping from programs to features is intentionally duplicated in documentation form (`docs/architecture/features.md` as the canonical mapping) alongside the executable `PROGRAM_FEATURES` list, with `tests/features/container-gating.test.mjs` (referenced but not shown in these observations) asserting the two never drift.

## Integration Points

FeatureGatedSupervisorConfig sits under the parent ServiceProbe, which frames it within the broader "rebuild-and-verify" Docker workflow: the coding-services container must be rebuilt and its supervised processes and health endpoints confirmed live before downstream pipelines like wave-analysis trust it, per the "coding --copilot Launcher Health Check" work record. Because a wrongly gated program simply vanishes from the supervised set, a bad edit to `PROGRAM_FEATURES` or the snapshot format can masquerade as a healthy rebuild if only running endpoints are checked — making this component a direct, if easy-to-miss, input to that verification ritual.

It sits alongside sibling probes HttpHealthProbe, TcpHealthProbe, and RetryWithDeadlineStarter, though observations indicate no direct code coupling; those siblings operate on already-running services (HTTP JSON checks, TCP port checks, retrying starts), whereas FeatureGatedSupervisorConfig determines which programs exist to be probed in the first place.

It also has a structural — not code-level — twin one layer up the stack: `scripts/start-services-robust.js` gates host-launched Node processes (`SERVICE_CONFIGS.transcriptMonitor`, `liveLoggingCoordinator`, etc.) via a `.feature` string and `startOneService()`, checked against a `featureSet()`-shaped object rather than the container's JSON snapshot. This parallel system is covered independently by `tests/features/service-gating.test.mjs`, which enforces "every service declares a feature" and that `SERVICE_ORDER`/`SERVICE_CONFIGS` cover each other exactly — the host-side analog of the coverage discipline `tests/features/container-gating.test.mjs` enforces for `PROGRAM_FEATURES`.

## Usage Guidelines

Anyone adding a new supervised program must add a matching `program:feature` entry to `PROGRAM_FEATURES` and to `docs/architecture/features.md`, since drift between them is exactly what the coverage test is designed to catch — an unlisted or misdeclared program is the failure mode this system exists to prevent. Because gating fails open, developers should not rely on an absent or stale snapshot to disable anything; a missing feature id will run, not skip. After any change to `PROGRAM_FEATURES`, the feature snapshot schema, or the resolver output, the container must be rebuilt and its supervised processes and health endpoints explicitly re-verified — checking only the endpoints expected to be up will not reveal a program that was incorrectly gated off. Finally, since this container-side gate and the host-side gate in `scripts/start-services-robust.js` are separate, duplicated implementations rather than a shared abstraction, changes to feature semantics may need to be applied — and tested — in both places.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- scripts/start-services-robust.js and tests/features/service-gating.test.mjs implement a structurally parallel but distinct gating system for a different runtime domain: HOST-launched Node processes (`SERVICE_CONFIGS.transcriptMonitor`, `liveLoggingCoordinator`, etc.), each declaring a `.feature` string, gated through `startOneService()` against a `featureSet()`-shaped object rather than a container-side JSON snapshot. `tests/features/service-gating.test.mjs`'s 'every service declares a feature' and 'SERVICE_ORDER and SERVICE_CONFIGS cover each other exactly' checks enforce the host-side half of the same discipline that docker/entrypoint.sh's own comment says `tests/features/container-gating.test.mjs` enforces for the container-side `PROGRAM_FEATURES` mapping — two coverage tests guarding two independent tables against the same class of drift (an added program/service that forgets to declare, or misdeclares, its feature).


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The work record 'coding --copilot Launcher Health Check' establishes that after any code or data change, the coding-services container must be rebuilt via docker-compose and its supervised processes and health endpoints confirmed live before downstream pipelines like wave-analysis are trusted to run against it. Because FeatureGatedSupervisorConfig's output is exactly what determines which supervised processes exist post-rebuild (an `autostart=false` stanza silently removes a program from that set), an edit to `PROGRAM_FEATURES` or to the feature snapshot format is a case this verification ritual is specifically meant to catch — a wrongly-gated program would look like a successful, healthy rebuild if only the endpoints that ARE running get checked.

## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- [SESSION] coding --copilot Launcher Health Check reuses the same rebuild-and-verify Docker workflow as the restart-verification baseline, confirming supervised processes and health endpoints are live before downstream pipelines like wave-analysis depend on them.

### Siblings
- [HttpHealthProbe](./HttpHealthProbe.md) -- [SESSION] Service Health Diagnosis — Docker and HTTP Endpoints establishes that diagnosing unhealthy services requires confirming HTTP endpoints return expected JSON rather than error pages, distinct from just checking process state via supervisorctl
- [TcpHealthProbe](./TcpHealthProbe.md) -- [LLM] None of the supplied files — docker/entrypoint.sh, scripts/prompt-classifier-service.mjs, scripts/start-services-robust.js, start-services.sh, tests/features/service-gating.test.mjs — define, export, or reference a symbol, class, or file named TcpHealthProbe. The parent context explicitly states the real implementation lives in lib/utils/service-probe.js with functions probeHttpHealth() and probeTcpPort(), and that file is absent from this retrieval entirely. What was retrieved instead clusters around the word 'health' and 'service' at a layer above any probe: docker/entrypoint.sh gates supervisord autostart from a static JSON snapshot, and start-services-robust.js orchestrates retries around health-check *functions it imports* rather than defines.
- [RetryWithDeadlineStarter](./RetryWithDeadlineStarter.md) -- [LLM] None of the supplied files define, export, or reference a component named `RetryWithDeadlineStarter`. The closest structural analog is `startServiceWithRetry`, which `scripts/start-services-robust.js` imports from `../lib/service-starter.js` alongside `createHttpHealthCheck`, `createPidHealthCheck`, `isPortListening`, `isTcpPortListening`, `isProcessRunning`, and `sleep` — but `lib/service-starter.js` itself is not among the retrieved files, so whether it actually enforces a deadline (versus a bare retry count) cannot be verified from what's here.


---

*Generated from 9 observations*
