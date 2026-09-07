# ContentValidationAgent

**Type:** SubComponent

Located in integrations/semantic-analysis/src/agents, indicating it operates as part of the semantic-analysis agent suite rather than the core hook/constraint pipeline

# ContentValidationAgent — Technical Insight Document

## What It Is

ContentValidationAgent is implemented in `content-validation-agent.ts`, located within `integrations/semantic-analysis/src/agents`. This placement is architecturally significant: rather than living inside the core hook/constraint pipeline (alongside `HookConfigLoader` or `UnifiedHookManager`), it operates as part of the semantic-analysis agent suite. Its core responsibility is checking entity observations and diagrams against the live codebase state to flag stale references — in other words, detecting documentation drift rather than enforcing live tool-call rules. This distinguishes it functionally from most of its ConstraintSystem siblings, which are concerned with runtime validation of tool calls and file operations.

## Architecture and Design

Despite sitting outside the primary hook/constraint dispatch path, ContentValidationAgent is deliberately integrated into the broader ConstraintSystem's reporting architecture. It adopts a `ValidationIssue` severity taxonomy that mirrors the classification scheme used in `ViolationCaptureService`. This is a notable design decision: rather than inventing a bespoke reporting format for documentation staleness, the agent conforms to the existing severity model so that its findings can flow into the same dashboard surfaces used for constraint violations.

![ContentValidationAgent — Architecture](images/content-validation-agent-architecture.png)

This reflects a "shared taxonomy, separate concern" pattern — ContentValidationAgent is architecturally decoupled from the live session monitoring performed by `UnifiedHookManager` and `HookConfigLoader`, but conceptually unified with them through consistent data shaping. The ConstraintSystem as a whole favors layered, additive designs (e.g., the config-merge pattern in `HookConfigLoader`), and ContentValidationAgent extends that philosophy into the documentation-validation space without requiring changes to the hook infrastructure itself.

## Implementation Details

The agent's core mechanism is comparative: it inspects entity observations and diagrams (documentation artifacts) and cross-references them against the actual, current state of the codebase. When discrepancies are found — stale entity descriptions, diagrams referencing removed or renamed code — it emits `ValidationIssue` records classified by severity. Because this severity taxonomy matches the one used by `ViolationCaptureService` for tool-call/file-operation violations, downstream consumers do not need agent-specific parsing logic to interpret ContentValidationAgent's output.

No additional code symbols were surfaced for this component beyond the agent file itself, suggesting a relatively self-contained implementation focused narrowly on staleness detection logic rather than a broad multi-class subsystem.

## Integration Points

![ContentValidationAgent — Relationship](images/content-validation-agent-relationship.png)

ContentValidationAgent is a contained child of ConstraintSystem, but its integration is reporting-oriented rather than execution-oriented. Its primary integration point is the shared `ValidationIssue` severity format also used by `ViolationCaptureService`, which enables the same severity-breakdown reporting pattern to serve both live constraint violations and static documentation drift findings. This shared format is what allows both violation types to feed the System Health Dashboard's workflow visualization layer without bespoke adapters. Unlike `HookConfigLoader` and `UnifiedHookManager`, which participate directly in the pre-tool/post-tool/startup/shutdown event lifecycle, ContentValidationAgent does not hook into live session events — its integration is at the data/reporting layer, not the execution layer.

## Usage Guidelines

Developers should treat ContentValidationAgent as a documentation-integrity checker, not a runtime enforcement mechanism — it will not block tool calls or file operations the way constraint validation in the core hook pipeline does. When extending or consuming its output, maintain conformance with the existing `ValidationIssue` severity taxonomy so that dashboard reporting continues to treat staleness findings and live violations uniformly. Because it lives in `integrations/semantic-analysis/src/agents` rather than the constraint/hook core, changes to hook infrastructure (`hook-config.js`, `hook-manager.js`) are unlikely to require corresponding changes here, and vice versa — the coupling is intentionally limited to the shared reporting schema.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem provides rule-based validation and enforcement for tool calls and file operations during Claude Code sessions, plus a hook infrastructure that lets agent-agnostic events (pre-tool, post-tool, startup, shutdown, etc.) trigger scripts, commands, or modules. It is composed of a hook configuration layer (lib/agent-api/hooks/hook-config.js) that loads and merges user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) configs, and a central UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) that registers, prioritizes, and dispatches handlers per event across all supported agents. Violations detected during live sessions are captured and persisted via the ViolationCaptureService (scripts/violation-capture-service.js), which writes JSONL logs and maintains rolling statistics for dashboard consumption.

Architecturally, the system favors a layered configuration-merge pattern (defaults → user → project) with validation warnings rather than hard failures, and a priority-sorted handler registry keyed by event name. Constraint violations flow from live session monitoring into a persistent JSON store capped at 1000 entries, with statistics (severity breakdown, most common violation, per-session averages) computed on write. The system also integrates with content/documentation validation (ContentValidationAgent in integrations/semantic-analysis) which, while primarily about entity staleness, shares the same validation-issue/severity taxonomy pattern used elsewhere in constraint reporting, and with the System Health Dashboard's workflow visualization hooks (React-side, distinct from the agent-api hook system) for rendering constraint/violation data.

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- hook-config.js implements a layered merge pattern: defaults are loaded first, then user-level ~/.coding-tools/hooks.json, then project-level .coding/hooks.json, each layer overriding the previous
- [UnifiedHookManager](./UnifiedHookManager.md) -- hook-manager.js maintains a priority-sorted handler registry keyed by event name (e.g. pre-tool, post-tool, startup, shutdown)
- [ViolationCaptureService](./ViolationCaptureService.md) -- violation-capture-service.js persists individual violation events as JSONL log lines, appending rather than rewriting the whole log per capture


---

*Generated from 5 observations*
