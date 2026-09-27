# PortCleanupHelpers

**Type:** Detail

## What It Is

PortCleanupHelpers refers to the pair of port-cleanup/readiness functions implemented in `scripts/start-services-robust.js`: `killProcessOnPortAndWait()` and `waitForPortBindable()`, along with their legacy counterparts `check_port()` and `kill_port()` in `start-services.sh`. These helpers exist to solve one concrete problem — ensuring a port is actually usable before a service binds to it — within the broader StartServicesScripts orchestration layer.

## Architecture and Design

The design splits port-readiness into two independent concerns rather than one undifferentiated retry loop. `killProcessOnPortAndWait()` handles the case where a live process still holds the port: it checks occupancy via `lsof -ti:<port>`, then escalates from SIGTERM to SIGKILL — issuing SIGKILL only after half of `maxWaitMs` has elapsed — polling at `pollIntervalMs` intervals, and returning a boolean instead of throwing. `waitForPortBindable()` handles a distinct failure mode: a crashed process can leave the kernel holding the socket in a state invisible to both HTTP probes (`isPortListening`, imported from `../lib/service-starter.js`) and `lsof`, yet still causing EADDRINUSE. It resolves this by attempting a real, throwaway `net.createServer().listen(port, host)` bind — the only reliable way to observe true OS-level bindability — and does so without consuming any of a service's `maxRetries` slots.

This reflects several deliberate patterns: graceful-then-forceful signal escalation, probe-before-act readiness checking, and boolean-return over exception-throwing for expected/recoverable states. The legacy bash pair is kept side-by-side rather than deleted, gated by the `ROBUST_MODE` flag documented in parent StartServicesScripts.

## Implementation Details

`killProcessOnPortAndWait()` and `waitForPortBindable()` are used together as a matched pair by the SERVICE_CONFIGS start routines (e.g., transcriptMonitor, liveLoggingCoordinator), treating "is this port usable" as a single concern spanning both process-squatting and kernel-artifact scenarios. Both operate against the centralized `PORTS` object (CONSTRAINT_DASHBOARD:3030, CONSTRAINT_API:3031, SYSTEM_HEALTH_DASHBOARD:3032, SYSTEM_HEALTH_API:3033, LLM_CLI_PROXY:12435, OBSERVATIONS_API:12436), each derived via `parseInt(process.env.<X>_PORT || '<default>', 10)`.

The legacy equivalents in `start-services.sh` are structurally simpler and cruder: `check_port()` is a bare `lsof -i :$port` existence check, and `kill_port()` jumps straight to `kill -9` after a single `lsof -t -i :$port` lookup, followed by a flat `sleep 1` with no confirmation polling — functionally subsumed but never removed.

## Integration Points

These helpers are invoked exclusively from within the ROBUST_MODE=true path exec'd from parent StartServicesScripts (`start-services.sh` dispatch to `scripts/start-services-robust.js`). The legacy pair is only reachable when an operator sets `ROBUST_MODE=false`, at which point `start-services.sh` loops `for port in 8080 8001` (retired VKB server and FastMCP respectively) before Docker/constraint-monitor setup — a dormant path relevant to sibling ConstraintMonitorBootstrap's scattered startup logic.

## Usage Guidelines

Treat `killProcessOnPortAndWait()` and `waitForPortBindable()` as complementary, not interchangeable — omitting either reintroduces an under-specified retry that conflates process-squatting with kernel-release delay. New services should register ports through the `PORTS` object rather than hardcoding values. The legacy `check_port`/`kill_port` path should be treated as frozen backward-compatibility code, not a target for new features.


## Hierarchy Context

### Parent
- [StartServicesScripts](./StartServicesScripts.md) -- [LLM] start-services.sh is a dual-mode dispatcher: with ROBUST_MODE (default true, overridable via env var) it simply execs `node scripts/start-services-robust.js` and exits immediately, deferring all real orchestration to that Node script; the remainder of the bash file (roughly 200+ lines of legacy port-killing, docker-compose invocation for Qdrant/Redis, and manual `docker run` fallbacks for constraint-monitor) only executes when ROBUST_MODE=false. This is a live-but-deprecated code path — it still constructs CONSTRAINT_MONITOR_STATUS/CONSTRAINT_MONITOR_WARNING strings and calls `check_docker`, `check_port`, `kill_port` — kept explicitly for backward compatibility rather than deleted.

### Siblings
- [ConstraintMonitorBootstrap](./ConstraintMonitorBootstrap.md) -- [LLM] No file, function, or class literally named 'ConstraintMonitorBootstrap' appears anywhere in the supplied code. The closest material is scattered constraint-monitor startup logic split across three unrelated locations: the legacy branch of start-services.sh (bash), the PROGRAM_FEATURES mapping in docker/entrypoint.sh, and (by the parent's description, not shown here) SERVICE_CONFIGS entries in scripts/start-services-robust.js. This entity looks like a name assigned to a theme rather than to a single retrievable implementation.


---

*Generated from 9 observations*
