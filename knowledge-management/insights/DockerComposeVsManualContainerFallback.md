# DockerComposeVsManualContainerFallback

**Type:** Detail

# DockerComposeVsManualContainerFallback

## What It Is

`DockerComposeVsManualContainerFallback` is a branching decision point implemented in `start-services.sh`, inside the legacy code block that constitutes the parent component `ConstraintMonitorServices`. After `cd "$CONSTRAINT_DIR"`, the script tests `if [ -f "docker-compose.yml" ]` and diverges into two structurally distinct startup paths: a docker-compose-managed path and a manual `docker run`-managed path for the same two dependencies, `constraint-monitor-qdrant` and `constraint-monitor-redis`. This is not a shared function with an internal switch — it is two independent, mutually exclusive shell code blocks keyed on file existence, each with its own notion of "started" and "healthy."

Critically, this entire decision point is reachable only when `ROBUST_MODE=false`; the default (`ROBUST_MODE="${ROBUST_MODE:-true}"`) causes the script to `exec node scripts/start-services-robust.js` before ever reaching this logic, making the fallback dead code under normal operation — a trait it shares directly with sibling `LegacyProvisioningPath`, which describes the same guard from the provisioning side.

## Architecture and Design

The dominant pattern is preferred-path-with-fallback: docker-compose is treated as the desired mechanism, with raw `docker run` as a degraded substitute when `docker-compose.yml` is absent. Layered onto this is a poll-until-healthy pattern, but the two branches implement it with different rigor. The docker-compose branch polls `docker-compose ps` for `Up.*healthy` across 12 attempts at 5-second intervals, trusting each container's own HEALTHCHECK directive. The manual branch instead does a flat 3-second sleep and then merely checks container *presence* via `docker ps --filter name=...`, with no healthcheck concept at all — `qdrant/qdrant:v1.15.0` and `redis:7-alpine` are launched via bare `docker run -d --name ... -p ...` with no health flags.

Both branches ultimately collapse their outcomes into the same two-value status vocabulary — `✅ FULLY OPERATIONAL` / `⚠️ DEGRADED MODE` — masking at least five distinct root causes (already-running, poll-success, poll-exhaustion, compose-command-failure, manual-container-failure) behind a shared string. This is a deliberate but risky simplification: callers reading `CONSTRAINT_MONITOR_STATUS` cannot distinguish *why* something degraded, only *that* it did.

## Implementation Details

The docker-compose branch short-circuits with `docker-compose ps | grep -E "(qdrant|redis)" | grep -q "Up"`, and if not already running, runs `timeout 120 docker-compose pull` (soft-failing to "using existing images" on timeout) followed by `timeout 60 docker-compose up -d`, then the 12×5s health poll, marking `⚠️ DEGRADED MODE` with `CONSTRAINT_MONITOR_WARNING="Health checks failing"` on exhaustion, or `"Docker compose startup failed"` if the `up -d` command itself fails.

The manual branch checks for `constraint-monitor-qdrant` and `constraint-monitor-redis` by name, starts any missing container with explicit port mappings (6333/6334 for Qdrant, 6379 for Redis), sleeps 3 seconds flat, and re-checks presence via the same filter. Uniquely, only this branch also starts constraint-monitor's own web services — `PORT=3030 npm run dashboard > /dev/null 2>&1 &` and `npm run api > /dev/null 2>&1 &`, capturing `dashboard_pid`/`api_pid`, followed by another flat 3-second sleep and an `lsof -ti:3030`/`:3031` presence check. This asymmetry means "databases up" and "web services up" are rolled into one combined status in the manual path, while the compose path's status resolves purely at the health-poll stage with no visible handling of dashboard/API concerns in this file — implying those processes are either baked into `docker-compose.yml` as services, or the fallback path duplicates responsibility the preferred path hands off to Docker.

Neither branch attempts retry-with-backoff; both are single-attempt, in contrast to `lib/service-starter.js`'s `startServiceWithRetry`, which the `ROBUST_MODE=true` path (`scripts/start-services-robust.js`) uses instead.

## Integration Points

This fallback logic is entirely disjoint from the supervised startup flow governed by `scripts/start-services-robust.js` and its `SERVICE_CONFIGS`/`SERVICE_ORDER` contract (with per-service `startFn`/`healthCheckFn`), which is what `tests/features/service-gating.test.mjs` actually exercises — meaning this component has no test coverage of its own in the supplied files. It is also unrelated to `docker/entrypoint.sh`'s `PROGRAM_FEATURES` supervisord-managed topology (`constraint-monitor:constraints constraint-dashboard:constraints constraint-dashboard-api:constraints`), which governs an entirely separate in-container deployment mode. The fallback exists solely within the host-side, pre-container provisioning topology implemented by sibling `LegacyProvisioningPath`, alongside the web-service-launching responsibilities loosely analogous to siblings `ApiServiceWrapper` and `DashboardServiceWrapper` — though neither sibling is a real named abstraction; both are just inline bash (`npm run dashboard`, `npm run api`) within this same manual branch.

## Usage Guidelines

Operators should understand that this fallback only activates with `ROBUST_MODE=false`, an explicit opt-out from the supervised, retry-capable default flow — the console warning "Using LEGACY startup mode (no retry logic)" is the only signal. Given the manual branch's weak health verification (presence-only, no healthcheck polling), it can report `✅ FULLY OPERATIONAL` while Qdrant is still initializing collections, a known false-positive risk consistent with health-check issues flagged elsewhere in the probe/reporting machinery. Anyone debugging a `⚠️ DEGRADED MODE` result from this path should treat the collapsed status string with suspicion and inspect logs directly, since three or more distinct failure causes are indistinguishable from the surfaced state. This component should be considered legacy/manual-recovery only — new work should target `start-services-robust.js`'s service-config contract rather than extending either branch here.


## Hierarchy Context

### Parent
- [ConstraintMonitorServices](./ConstraintMonitorServices.md) -- [LLM] start-services.sh's legacy path (invoked when ROBUST_MODE=false) contains the only executable logic for provisioning constraint-monitor in this file set: it conditionally `git clone`s `github.com/fwornle/constraint-monitor.git` into `integrations/constraint-monitor` if absent, runs `npm install --production`, then either `docker-compose up -d` (preferred, checking for `qdrant`/`redis` containers reporting `Up.*healthy`) or falls back to raw `docker run` for `constraint-monitor-qdrant` (ports 6333/6334) and `constraint-monitor-redis` (port 6379). It further starts `constraint-monitor`'s own dashboard (`PORT=3030 npm run dashboard`) and API (`npm run api`, implicitly port 3031) as background shell jobs when the docker-compose path isn't used, with success/failure captured only in shell-local `CONSTRAINT_MONITOR_STATUS`/`_WARNING` variables printed to console — there is no structured health object returned to a caller.

### Siblings
- [LegacyProvisioningPath](./LegacyProvisioningPath.md) -- [LLM] start-services.sh's legacy branch is gated by a single top-level check — `if [ "$ROBUST_MODE" = "true" ]; then exec node scripts/start-services-robust.js; fi` — followed by `echo "⚠️  Using LEGACY startup mode (no retry logic)"`. Everything below that echo, including the constraint-monitor provisioning block, is dead code on any invocation where `ROBUST_MODE` is unset or `true`, which is the documented default (`ROBUST_MODE="${ROBUST_MODE:-true}"`). This makes LegacyProvisioningPath an opt-in fallback that most operators will never exercise, yet it remains the only place in the supplied files where constraint-monitor's git clone, npm install, and docker startup are actually implemented in shell rather than delegated to a Node service.
- [ApiServiceWrapper](./ApiServiceWrapper.md) -- [LLM] None of the supplied files define, import, or reference a class, module, or function named `ApiServiceWrapper` anywhere in their visible contents — not in `start-services.sh`, `scripts/start-services-robust.js`, `docker/entrypoint.sh`, `scripts/prompt-classifier-service.mjs`, or `tests/features/service-gating.test.mjs`. The closest thematic match is the constraint-monitor 'API server' invoked via `npm run api` inside `start-services.sh`'s legacy path, and the `observationsApi` service key referenced in `tests/features/service-gating.test.mjs`'s gating tests (backed by `SERVICE_CONFIGS.observationsApi` in `scripts/start-services-robust.js`, only partially shown before truncation) — but neither is named or shaped as an 'ApiServiceWrapper'.
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- [LLM] None of the supplied files define, import, or reference a symbol, class, or file named `DashboardServiceWrapper`. `start-services.sh` starts the constraint-monitor dashboard and API as raw backgrounded shell jobs (`PORT=3030 npm run dashboard > /dev/null 2>&1 &` and `npm run api > /dev/null 2>&1 &`, both under the manual-container fallback branch), which is conceptually the closest thing to a 'dashboard service wrapper' in this file set, but it is inline bash, not a named wrapper component/object of any kind.


---

*Generated from 9 observations*
