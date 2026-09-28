# LegacyProvisioningPath

**Type:** Detail

## What It Is

LegacyProvisioningPath is the shell-script fallback implementation of constraint-monitor provisioning inside `start-services.sh`, reachable only when `ROBUST_MODE` is explicitly set to something other than `true` (default is `"${ROBUST_MODE:-true}"`, so this is opt-in dead code for most operators). It is the sole location in the supplied file set where constraint-monitor's git clone, `npm install`, and Docker startup are implemented directly in bash rather than delegated to the Node-based `scripts/start-services-robust.js`. It lives entirely within its parent, ConstraintMonitorServices, and overlaps heavily with sibling DockerComposeVsManualContainerFallback, which documents the same docker-compose-vs-manual branching in more granular detail.

## Architecture and Design

The top-level control flow (`start-services.sh:9-24`) is a hard fork: `if [ "$ROBUST_MODE" = "true" ]; then exec node scripts/start-services-robust.js; fi`, meaning LegacyProvisioningPath is a wholesale alternate implementation, not a conditional branch within shared logic. This is the "two separate implementations" pattern rather than "one implementation, one flag" — a deliberate but costly trade-off, since neither logic nor readiness criteria are shared between the two paths.

Within the legacy path, provisioning follows a cascading fallback: prefer `docker-compose up -d` with 12×5s polling for `Up.*healthy` (`start-services.sh:~108-128`), falling back to raw `docker run` for `constraint-monitor-qdrant`/`-redis` with only a flat 3-second sleep before a `docker ps`-based presence check (`~150-170`). These two tiers use materially different readiness rigor, so reliability is asymmetric depending on whether `docker-compose.yml` exists — a structural inconsistency baked into the design rather than an oversight in one branch.

Idempotency is handled via existence guards (`[ ! -d .../constraint-monitor ]`, `[ ! -f .initialized ]`) before mutating operations, and all outcomes funnel into two shell-scoped variables, `CONSTRAINT_MONITOR_STATUS` and `CONSTRAINT_MONITOR_WARNING`, that exist purely for `echo` output — an ad hoc, unstructured health-reporting mechanism with no downstream consumer.

## Implementation Details

Cloning (`~75-93`) uses an unauthenticated HTTPS URL, `git clone https://github.com/fwornle/constraint-monitor.git constraint-monitor`, guarded by a check for a local dev copy and executed inside `cd "$CODING_DIR/integrations"`. Failure is fully absorbed via `2>/dev/null` plus an `if/else` that always returns 0, printing a manual-clone suggestion instead of aborting — there is no `set -e` interaction to worry about because the compound conditional swallows the exit code either way.

Health determination is hand-rolled independently of `lib/service-probe.js`: the docker-compose branch polls `docker-compose ps | grep -E "(qdrant|redis)" | grep -q "Up.*healthy"` twelve times at 5-second intervals, while the manual branch merely sleeps 3 seconds and checks `docker ps --filter name=... | grep -c`. Only the manual branch (`~185-200`) starts the web tier itself — `PORT=3030 npm run dashboard > /dev/null 2>&1 &` and `npm run api > /dev/null 2>&1 &` — capturing `dashboard_pid`/`api_pid` that are never used again; liveness is instead re-derived via `lsof -ti:3030 | wc -l` / `lsof -ti:3031 | wc -l`. This is conceptually the closest thing to DashboardServiceWrapper/ApiServiceWrapper in the codebase, but both siblings are confirmed to not exist as named components — this is inline bash, not a wrapper object.

The Docker-unavailable branch (`~205-230`) prints a large degraded-mode banner listing disabled advanced features (semantic analysis, pattern learning, cross-session persistence, predictive risk assessment, vector similarity search, analytical queries) versus still-working basic features (regex matching, MCP connectivity), setting `CONSTRAINT_MONITOR_STATUS="⚠️ DEGRADED MODE"`. This banner is purely UX for a human terminal observer — nothing parses it — even though it duplicates in prose the same degraded/failed distinction enforced programmatically elsewhere.

## Integration Points

LegacyProvisioningPath structurally cannot satisfy the feature-gating contract that `tests/features/service-gating.test.mjs` enforces against `SERVICE_CONFIGS`/`SERVICE_ORDER` and `FEATURE_IDS` (from `lib/features/catalogue.cjs`) for the robust path, because it is bash, not a `SERVICE_CONFIGS` entry with `startFn`/`healthCheckFn`. Since the ROBUST_MODE gate `exec`s before any Node code runs, constraint feature flags (e.g., `constraints:false`) have zero effect when legacy mode is taken — it clones and starts constraint-monitor unconditionally. This contrasts with `docker/entrypoint.sh`'s `PROGRAM_FEATURES` gating of constraint-monitor's supervisord programs, which has no analog here at all. No structured health object crosses this path's boundary to any caller; status is confined to the two shell variables described above, never exported, written to file, or consumed by IPC.

## Usage Guidelines

Developers should treat this path as a legacy/manual-recovery mechanism, not a maintained parallel implementation — since `ROBUST_MODE` defaults to `true`, it will rarely execute in practice, and any bug fixes made in `scripts/start-services-robust.js` (including its shared `service-probe.js` health-check abstraction) do not propagate here. Anyone relying on constraint feature flags to disable constraint-monitor provisioning must know this path ignores them entirely. Because the git clone silently swallows failures, and because dashboard/API PIDs are discarded in favor of `lsof`-based checks, this path offers weaker guarantees around both provisioning correctness and process supervision than the robust path or even its own docker-compose branch — it should not be used as a template for new provisioning logic, and any consolidation effort should aim to retire it in favor of the `SERVICE_CONFIGS`-driven approach used by ConstraintMonitorServices' robust counterpart.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- tests/features/service-gating.test.mjs imports `SERVICE_CONFIGS`/`SERVICE_ORDER` from scripts/start-services-robust.js and asserts every entry declares a `feature` drawn from `FEATURE_IDS` (lib/features/catalogue.cjs) — a contract LegacyProvisioningPath is structurally incapable of satisfying, since it is bash rather than a `SERVICE_CONFIGS` entry with `startFn`/`healthCheckFn`. Because `start-services.sh` picks ROBUST_MODE vs. legacy with a single `exec` before any Node code runs, the entire feature-gating apparatus this test suite enforces (`results.disabled` vs. `results.failed`, `constraints` feature flag lookups) never executes when the legacy path is taken — legacy mode has no equivalent of `startOneService('constraintMonitor', ...)`'s feature check at all, so a `constraints:false` feature flag has zero effect on whether legacy mode clones and starts constraint-monitor.


## Hierarchy Context

### Parent
- [ConstraintMonitorServices](./ConstraintMonitorServices.md) -- [LLM] start-services.sh's legacy path (invoked when ROBUST_MODE=false) contains the only executable logic for provisioning constraint-monitor in this file set: it conditionally `git clone`s `github.com/fwornle/constraint-monitor.git` into `integrations/constraint-monitor` if absent, runs `npm install --production`, then either `docker-compose up -d` (preferred, checking for `qdrant`/`redis` containers reporting `Up.*healthy`) or falls back to raw `docker run` for `constraint-monitor-qdrant` (ports 6333/6334) and `constraint-monitor-redis` (port 6379). It further starts `constraint-monitor`'s own dashboard (`PORT=3030 npm run dashboard`) and API (`npm run api`, implicitly port 3031) as background shell jobs when the docker-compose path isn't used, with success/failure captured only in shell-local `CONSTRAINT_MONITOR_STATUS`/`_WARNING` variables printed to console — there is no structured health object returned to a caller.

### Siblings
- [DockerComposeVsManualContainerFallback](./DockerComposeVsManualContainerFallback.md) -- [LLM] start-services.sh's legacy path (guarded by `if [ "$ROBUST_MODE" = "true" ]` at the top of the file, which `exec`s into scripts/start-services-robust.js and never reaches the code below) contains the actual docker-compose-vs-manual fallback: after `cd "$CONSTRAINT_DIR"`, it checks `if [ -f "docker-compose.yml" ]` and branches into two structurally different code paths rather than one function with an internal switch. The docker-compose branch does `docker-compose ps | grep -E "(qdrant|redis)" | grep -q "Up"` to short-circuit if already running, else `timeout 120 docker-compose pull` (soft-failing to 'using existing images'), then `timeout 60 docker-compose up -d`, then a 12×5s health-poll loop against `Up.*healthy`. The manual branch, reached only `else` (no docker-compose.yml found), does none of that: it checks two specific container names via `docker ps --filter "name=constraint-monitor-qdrant"` / `-redis`, starts each with a bare `docker run -d --name ... -p ...` if missing, sleeps a flat 3 seconds, and re-checks with the same filter pattern — no healthy-status polling at all, just container presence.
- [ApiServiceWrapper](./ApiServiceWrapper.md) -- [LLM] None of the supplied files define, import, or reference a class, module, or function named `ApiServiceWrapper` anywhere in their visible contents — not in `start-services.sh`, `scripts/start-services-robust.js`, `docker/entrypoint.sh`, `scripts/prompt-classifier-service.mjs`, or `tests/features/service-gating.test.mjs`. The closest thematic match is the constraint-monitor 'API server' invoked via `npm run api` inside `start-services.sh`'s legacy path, and the `observationsApi` service key referenced in `tests/features/service-gating.test.mjs`'s gating tests (backed by `SERVICE_CONFIGS.observationsApi` in `scripts/start-services-robust.js`, only partially shown before truncation) — but neither is named or shaped as an 'ApiServiceWrapper'.
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- [LLM] None of the supplied files define, import, or reference a symbol, class, or file named `DashboardServiceWrapper`. `start-services.sh` starts the constraint-monitor dashboard and API as raw backgrounded shell jobs (`PORT=3030 npm run dashboard > /dev/null 2>&1 &` and `npm run api > /dev/null 2>&1 &`, both under the manual-container fallback branch), which is conceptually the closest thing to a 'dashboard service wrapper' in this file set, but it is inline bash, not a named wrapper component/object of any kind.


---

*Generated from 10 observations*
