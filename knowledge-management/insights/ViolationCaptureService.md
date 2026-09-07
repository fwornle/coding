# ViolationCaptureService

**Type:** SubComponent

violation-capture-service.js persists individual violation events as JSONL log lines, appending rather than rewriting the whole log per capture

# ViolationCaptureService — Technical Insight Document

## What It Is

ViolationCaptureService is implemented in `scripts/violation-capture-service.js` as the persistence layer for constraint violations detected during live Claude Code sessions. It is a SubComponent of ConstraintSystem, sitting alongside HookConfigLoader and UnifiedHookManager as part of the broader hook infrastructure, but with a narrower, focused responsibility: capturing violation events as they occur and turning them into durable, queryable records. Its core function is dual-purpose — it writes an append-only JSONL audit log of every violation event, and simultaneously maintains a rolling, capped JSON store optimized for statistics and dashboard consumption.

## Architecture and Design

The service's architecture reflects a clear separation between raw event logging and aggregated state. Raw events are appended as individual JSONL lines rather than rewriting an entire log file on each capture — this responsibility is delegated to the child component ViolationJSONLWriter, which implements the append-only write pattern. This is a deliberate design decision favoring write efficiency and durability over query convenience: JSONL append is O(1) per write and crash-safe, at the cost of requiring downstream consumers to parse line-by-line rather than query a structured store directly.

![ViolationCaptureService — Architecture](images/violation-capture-service-architecture.png)

Alongside the JSONL log, a separate JSON store retains only the most recent 1000 entries, implying an eviction or rolling-window mechanism once capacity is reached. This two-tier design — an unbounded append log plus a bounded working set — balances long-term auditability against bounded memory/storage footprint and fast access for dashboard-facing statistics. Notably, statistics (severity breakdowns, most common violation type, per-session averages) are computed eagerly at write time rather than lazily at query time, trading additional write-path CPU cost for cheap, always-current reads — a sensible trade-off given that dashboards likely poll or render statistics far more often than new violations are captured.

## Implementation Details

The write path centers on two artifacts: the JSONL log (written by ViolationJSONLWriter) and the capped JSON statistics store. Each violation record carries a severity classification, aligning with the same taxonomy used by ContentValidationAgent's ValidationIssue model — indicating a shared vocabulary for validation/violation severity across the ConstraintSystem and its sibling integrations, even though the two components address different domains (live tool-call violations vs. stale content references). The 1000-entry cap on the JSON store implies logic for evicting the oldest entries as new ones arrive, keeping the statistics computation bounded and predictable in cost despite continuous ingestion.

## Integration Points

![ViolationCaptureService — Relationship](images/violation-capture-service-relationship.png)

ViolationCaptureService is invoked from live tool-call monitoring, which implies it hooks into the same pre-tool/post-tool event flow orchestrated by UnifiedHookManager (`lib/agent-api/hooks/hook-manager.js`). This places it downstream of the priority-sorted handler registry that UnifiedHookManager maintains, receiving violation-triggering events as they are dispatched during a session. As a child, ViolationJSONLWriter is the concrete mechanism fulfilling the append-only persistence contract described above. The shared severity taxonomy with ContentValidationAgent (`content-validation-agent.ts`) suggests these two components, though independent, could feed a unified severity-based reporting or dashboard layer at the ConstraintSystem level.

## Usage Guidelines

Developers extending this service should preserve the append-only nature of JSONL writes — any modification should go through ViolationJSONLWriter rather than rewriting the log file directly, to retain the durability and performance characteristics of the current design. When adjusting the 1000-entry cap or eviction behavior, consider the eager statistics computation: since stats are computed at write time, changes to retention policy directly affect the accuracy and cost of severity breakdowns and averages. Any new violation types or severity levels should remain consistent with the taxonomy shared with ContentValidationAgent's ValidationIssue model to avoid divergent classification schemes across the ConstraintSystem.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem provides rule-based validation and enforcement for tool calls and file operations during Claude Code sessions, plus a hook infrastructure that lets agent-agnostic events (pre-tool, post-tool, startup, shutdown, etc.) trigger scripts, commands, or modules. It is composed of a hook configuration layer (lib/agent-api/hooks/hook-config.js) that loads and merges user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) configs, and a central UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) that registers, prioritizes, and dispatches handlers per event across all supported agents. Violations detected during live sessions are captured and persisted via the ViolationCaptureService (scripts/violation-capture-service.js), which writes JSONL logs and maintains rolling statistics for dashboard consumption.

Architecturally, the system favors a layered configuration-merge pattern (defaults → user → project) with validation warnings rather than hard failures, and a priority-sorted handler registry keyed by event name. Constraint violations flow from live session monitoring into a persistent JSON store capped at 1000 entries, with statistics (severity breakdown, most common violation, per-session averages) computed on write. The system also integrates with content/documentation validation (ContentValidationAgent in integrations/semantic-analysis) which, while primarily about entity staleness, shares the same validation-issue/severity taxonomy pattern used elsewhere in constraint reporting, and with the System Health Dashboard's workflow visualization hooks (React-side, distinct from the agent-api hook system) for rendering constraint/violation data.

### Children
- [ViolationJSONLWriter](./ViolationJSONLWriter.md) -- Per parent description, violation-capture-service.js appends one JSON line per violation event instead of rewriting the entire log file on each capture

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- hook-config.js implements a layered merge pattern: defaults are loaded first, then user-level ~/.coding-tools/hooks.json, then project-level .coding/hooks.json, each layer overriding the previous
- [UnifiedHookManager](./UnifiedHookManager.md) -- hook-manager.js maintains a priority-sorted handler registry keyed by event name (e.g. pre-tool, post-tool, startup, shutdown)
- [ContentValidationAgent](./ContentValidationAgent.md) -- content-validation-agent.ts checks entity observations and diagrams against live codebase state to flag stale references


---

*Generated from 5 observations*
