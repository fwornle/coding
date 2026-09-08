# FeatureGatingBridge

**Type:** Detail

[Code References] docker/entrypoint.sh:60-79 - .env loading loop with *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY allowlist-by-exclusion tied to T2 egress lockdown; docker/entrypoint.sh:104-152 - feature-gating block: FEATURES_SNAPSHOT read, PROGRAM_FEATURES list, per-program node -e enablement check, disabled.conf generation; lib/service-starter.js: withDeadline() - Promise.race + finally-clearTimeout deadline wrapper reused for both startFn() and healthCheckFn() timeouts; lib/service-starter.js: startServiceWithRetry() - retry loop combining exponential backoff (retryDelay * Math.pow(2, attempt-1)), withDeadline-based timeout, and post-start health verification with SIGTERM/SIGKILL on failure; scripts/api-service.js:16-30 - CODING_REPO/API_SERVER_PATH resolution and existsSync guard before spawn; scripts/dashboard-service.js:26-34 - spawn() call with hardcoded NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3031' not derived from CONSTRAINT_API_PORT; scripts/api-service.js:70-90 and scripts/dashboard-service.js:70-90 - fire-and-forget async IIFE registering the spawned child with ProcessStateManager after the synchronous 'Started (PID: ...)' log; scripts/generate-docker-mcp-config.sh:29-36 - CODEGRAPH_ENABLED gate via `bin/coding-features enabled codegraph`; scripts/generate-docker-mcp-config.sh:39-49 - two-tier code-graph MCP entry resolution: code-graph-config.mjs registry lookup then literal graphify JSON fallback with WARNING log

# FeatureGatingBridge — Technical Insight Document

## What It Is

FeatureGatingBridge is implemented in `docker/entrypoint.sh:104-152`, as a discrete sub-block within the larger DockerEntrypoint startup sequence. Its job is narrow and specific: read a single host-written JSON snapshot (`FEATURES_SNAPSHOT` / `FEATURES_DIR` / `PROGRAM_FEATURES`), evaluate a fixed list of container programs (9 in the current list) against that snapshot, and emit a static `disabled.conf` file that supervisord parses only once, when it first builds its config tree. It is, structurally, a translator — not a resolver, not a live channel, and not a health check. It converts host-computed feature state into a native supervisord config artifact and then gets out of the way.

## Architecture and Design

The defining architectural decision is that FeatureGatingBridge is **boot-time only** (apply-tier, per the project's documented tier model) rather than live-tier. There is no inotify watch, no SIGHUP re-read, and no mechanism by which a feature toggled off mid-session — say, via the dashboard's Features tab — can stop an already-running `semantic-analysis` or `graphify` supervisord program. The bridge only affects the *next* `docker-compose restart` or container recreate. This is a deliberate scope limitation, not an oversight: it keeps the container's startup logic simple and avoids the complexity of a config-reload daemon.

The per-feature check is implemented as N independent `node -e '...'` process spawns (one per `PROGRAM_FEATURES` entry) rather than a single batch JSON parse. This is computationally wasteful but has a specific safety rationale: each invocation is wrapped in `... 2>/dev/null || echo "true"`, so a JSON syntax error, a missing `features` key, or node being unavailable fails only that one program's lookup (defaulting to enabled) rather than aborting the whole loop or corrupting already-evaluated state. This is a second, finer-grained fail-open layer sitting beneath a coarser file-existence check — the design prioritizes blast-radius containment over efficiency.

This fail-open posture (unknown feature key or missing snapshot ⇒ "everything runs") is philosophically consistent with the parent DockerEntrypoint's own risk stance: the `wait_for_service()` TCP-probe loop for Qdrant/Redis also fails open, explicitly commented "Don't fail - let supervisord handle it," pushing real health determination downstream to supervisord's restart policy and the health-coordinator. FeatureGatingBridge and its parent both choose to under-assert rather than over-assert failure at container-boot time.

Notably, this fail-open direction is *inverted* elsewhere in the system: `scripts/generate-docker-mcp-config.sh`'s CODEGRAPH_ENABLED gate treats an unreadable or false `bin/coding-features enabled codegraph` result as "off," omitting the MCP entry rather than defaulting to "on." The two scripts independently query feature/flag state through different mechanisms — one reads a pre-computed snapshot inline, the other shells out to a live CLI — with no shared function or file serving as single source of truth. This creates a theoretical drift risk: if the snapshot and the live resolver disagree (e.g., snapshot stale, MCP config regenerated later), the container's running programs and its MCP tool configuration could reflect different views of the same feature flags.

## Implementation Details

The bridge's core loop reads `FEATURES_SNAPSHOT` (the file the host wrote to `/coding/.coding/runtime/features.json` before `docker-compose up`), iterates `PROGRAM_FEATURES` (a space-delimited list), and for each program invokes an inline Node one-liner to check enablement, generating supervisord `autostart=false` directives collected into `disabled.conf`. The file-existence check on the snapshot itself is the outer, coarse-grained fail-open gate; the per-program `node -e` try/catch-via-shell (`2>/dev/null || echo "true"`) is the inner, fine-grained one. Both layers converge on the same default: when in doubt, enable.

This mirrors — but doesn't share code with — the `.env`-loading loop also in `docker/entrypoint.sh:60-79` (closely related to sibling component HostEnvImportFilter), which applies an allowlist-by-exclusion pattern (skipping `*_API_KEY|*_TOKEN|*_MANAGEMENT_KEY`) tied to T2 egress lockdown. Both blocks share a "precedence deference to an external authority" philosophy: the `.env` loop's `if [ -z "${!key}" ]` guard defers to docker-compose-supplied env vars, while FeatureGatingBridge's snapshot read defers to the host's `~/.coding/features.yaml` resolver. Neither block re-implements the actual policy logic (secret-filtering rules, feature resolution) inside the container — the container remains a passive consumer of host-computed state in both cases.

## Integration Points

FeatureGatingBridge sits inside DockerEntrypoint, which contains it alongside sibling HostEnvImportFilter (the `.env`-loading block). It depends entirely on an external, host-side write of `features.json` under `FEATURES_DIR` — it does not call `bin/coding-features` directly, unlike `generate-docker-mcp-config.sh`, which does invoke that CLI live. Downstream, its only consumer is supervisord, which reads the generated `disabled.conf` include exactly once during config-tree parsing at boot. There is no runtime API surface exposed to other services; its entire interface is file-based (read one JSON snapshot, write one config include).

## Usage Guidelines

Developers should treat any feature toggle affecting containerized supervisord programs as requiring a `docker-compose restart` or container recreate — toggling a feature in the dashboard's Features tab has no effect on already-running programs like `semantic-analysis` or `graphify`. When adding new gated programs, they must be added to the `PROGRAM_FEATURES` list explicitly; the per-entry node-spawn model means each addition costs one more process spawn but doesn't risk cascading failure. Anyone reconciling behavior between container-side feature gating and MCP config generation (`generate-docker-mcp-config.sh`) should be aware these are two independently-read, potentially divergent sources of the same nominal truth, and should not assume they're always in sync — a shared resolver function/file is a plausible future improvement to eliminate that drift risk.


## Hierarchy Context

### Parent
- [DockerEntrypoint](./DockerEntrypoint.md) -- [LLM] entrypoint.sh implements a two-phase startup gate before ever invoking supervisord: a `wait_for_service()` loop that TCP-probes Qdrant and Redis via `/dev/tcp/$host/$port` bash pseudo-device redirection, followed by unconditional `return 0` regardless of success — the comment 'Don't fail - let supervisord handle it' makes explicit that this is a best-effort readiness delay, not a hard dependency gate. This mirrors the three-state pessimism described in the parent SPEC R6 invariant (service-probe.js never asserts 'healthy'), except here entrypoint.sh doesn't even distinguish stopped/unknown — it just logs a warning and proceeds, pushing all real health determination downstream to supervisord's own restart policy and, ultimately, the health-coordinator.

### Siblings
- [HostEnvImportFilter](./HostEnvImportFilter.md) -- [LLM] [object Object]


---

*Generated from 10 observations*
