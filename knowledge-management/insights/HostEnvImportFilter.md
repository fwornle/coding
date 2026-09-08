# HostEnvImportFilter

**Type:** Detail

[Architecture Notes] Two independent gating mechanisms in entrypoint.sh (env-key suffix denylist vs. feature-snapshot enable/disable) share a fail-open philosophy but differ in whether the absence of their input file is logged; HostEnvImportFilter enforces the T2 egress-lockdown boundary entirely in shell (bash case-statement glob matching), with no corresponding automated test referenced in-file, unlike the PROGRAM_FEATURES mapping a few sections later; Environment merge ordering (compose env vars > .env file > unset) is implemented via bash indirect parameter expansion (`${!key}`) rather than a dedicated dotenv library

# HostEnvImportFilter — Technical Insight Document

## What It Is

HostEnvImportFilter is implemented entirely within `docker/entrypoint.sh`, as a shell-based mechanism that reads a host-supplied `.env` file (`/coding/.env`) during container startup and selectively imports its key-value pairs into the container's environment. It is not a separate module, class, or library — it is a `while` loop with an embedded `case` statement, operating as one stage in the broader startup sequence orchestrated by its parent component, DockerEntrypoint. Its job is narrow but security-relevant: decide which environment variables from a file-based config source are allowed to reach the running process environment, and with what precedence relative to variables already supplied by docker-compose.

## Architecture and Design

The design centers on three composable patterns, all identified directly from the code path. First, an **allowlist-by-exclusion (deny-list)** filter blocks specific variable name suffixes — `*_API_KEY`, `*_TOKEN`, `*_MANAGEMENT_KEY` — using bash glob matching inside a `case` statement (`case "$key" in *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY) continue ;; esac`). Rather than enumerating safe variables, it enumerates dangerous name patterns and skips them, which is simpler to write but inherently incomplete against naming conventions it doesn't anticipate.

Second, a **merge-if-absent precedence pattern** ensures that variables already set by the orchestrator (docker-compose) take priority over file-supplied values: `if [ -z "${!key}" ]; then export "$key=$value"; fi`. This uses bash's indirect parameter expansion (`${!key}`) rather than any dotenv library, keeping the mechanism dependency-free but tightly coupled to bash semantics.

Third, a **fail-open** loading strategy: `if [ -f /coding/.env ]; then ... fi` has no `else` branch, so a missing file is silently skipped and startup proceeds with a reduced but non-blocking configuration. This mirrors the fail-open philosophy of the sibling FeatureGatingBridge (its FEATURES_SNAPSHOT/PROGRAM_FEATURES gating), though the two differ in observability: HostEnvImportFilter's missing-file case is not logged, whereas the feature-snapshot gate's absence-handling behavior is more explicit. Both gates also share the parent DockerEntrypoint's broader "don't fail — let downstream handle it" ethos, echoing the `wait_for_service()` readiness probe's unconditional `return 0`.

## Implementation Details

The core implementation is a single `while IFS='=' read -r key value; do ... done < /coding/.env` loop that parses the `.env` file line by line, splitting on `=`. Inside the loop body, each key is tested against the denylist `case` pattern before any assignment is attempted. Variables surviving the filter are exported into the shell environment only if not already set (`-z "${!key}"` check), which is what implements compose-precedence: docker-compose environment variables > `.env` file values > unset. There is no dedicated parser, no dotenv library, and no data structure beyond the shell's own variable table — the entire boundary enforcement (referred to as the "T2 egress-lockdown boundary") lives in this bash logic, unlike the PROGRAM_FEATURES mapping described a few sections later in the same file, which is not enforced this way.

## Integration Points

HostEnvImportFilter is one stage nested inside DockerEntrypoint, which precedes invocation of supervisord and follows (or coexists with) the `wait_for_service()` readiness-probe phase. It has no direct dependency on FeatureGatingBridge, but the two are structural siblings within entrypoint.sh, sharing the file's fail-open design philosophy while differing in scope: HostEnvImportFilter governs process environment variables, while FeatureGatingBridge governs a static `disabled.conf` consumed once by supervisord at config-parse time. Downstream, any process supervisord launches inherits the filtered/merged environment this mechanism produces, making it an implicit but critical dependency for every containerized program.

## Usage Guidelines

Because the filter is a denylist rather than an allowlist, developers adding new secret-like environment variable names must ensure they match one of the existing suffix patterns (`*_API_KEY`, `*_TOKEN`, `*_MANAGEMENT_KEY`) or extend the `case` statement — the filter offers no default-safe behavior for unanticipated secret naming conventions. Precedence rules mean docker-compose-supplied variables always win over `.env` file content, so operators should treat `.env` as a fallback/local-dev convenience layer, not an override mechanism. Notably, there is no automated test referenced for this logic (in contrast to the PROGRAM_FEATURES mapping), so any modification to the case-statement patterns or precedence guard should be manually verified against both the "secret blocked" and "compose var wins" scenarios before deployment. Finally, since a missing `.env` file fails silently, absence of expected variables at runtime should be diagnosed by checking file presence directly rather than relying on entrypoint logs.


## Hierarchy Context

### Parent
- [DockerEntrypoint](./DockerEntrypoint.md) -- [LLM] entrypoint.sh implements a two-phase startup gate before ever invoking supervisord: a `wait_for_service()` loop that TCP-probes Qdrant and Redis via `/dev/tcp/$host/$port` bash pseudo-device redirection, followed by unconditional `return 0` regardless of success — the comment 'Don't fail - let supervisord handle it' makes explicit that this is a best-effort readiness delay, not a hard dependency gate. This mirrors the three-state pessimism described in the parent SPEC R6 invariant (service-probe.js never asserts 'healthy'), except here entrypoint.sh doesn't even distinguish stopped/unknown — it just logs a warning and proceeds, pushing all real health determination downstream to supervisord's own restart policy and, ultimately, the health-coordinator.

### Siblings
- [FeatureGatingBridge](./FeatureGatingBridge.md) -- [LLM] docker/entrypoint.sh's feature-gating block (FEATURES_SNAPSHOT/FEATURES_DIR/PROGRAM_FEATURES) is deliberately a one-way, best-effort translator rather than a live config channel: it runs once at container boot, reads a single JSON snapshot the host wrote before `docker-compose up`, and produces a static `disabled.conf` include that supervisord reads only when it first parses its config tree. There is no inotify watch, no SIGHUP re-read, and no mechanism in this file for a feature toggled off mid-session (e.g. via the dashboard's Features tab) to stop an already-running `semantic-analysis` or `graphify` program — the bridge only ever influences the next `docker-compose restart`/container recreate, which is consistent with the project's documented 'apply tier' model where container programs are an `apply`-tier surface, not a `live`-tier one.


---

*Generated from 8 observations*
