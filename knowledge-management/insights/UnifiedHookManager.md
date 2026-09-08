# UnifiedHookManager

**Type:** SubComponent

Dispatch logic iterates registered handlers for a given event in priority order, invoking scripts, commands, or in-process modules depending on handler type

# UnifiedHookManager: Technical Insight Document

## What It Is

UnifiedHookManager is implemented in `hook-manager.js` and serves as the dispatch core of the ConstraintSystem's hook infrastructure. At its heart it maintains a priority-sorted handler registry keyed by event name — covering lifecycle and tool-execution events such as `pre-tool`, `post-tool`, `startup`, and `shutdown`. Rather than being a passive configuration store, it is an active dispatcher: it decides, for any given event, which registered handlers should run and in what order, then executes them regardless of whether they are implemented as scripts, shell commands, or in-process modules.

## Architecture and Design

The design cleanly separates configuration concerns from execution concerns. UnifiedHookManager does not read `hooks.json` directly; instead it consumes the already-merged configuration produced by its sibling, HookConfigLoader (`hook-config.js`), which applies a layered defaults → user (`~/.coding-tools/hooks.json`) → project (`.coding/hooks.json`) merge. This decoupling means the manager's dispatch logic is agnostic to how configuration was assembled — it only needs a final, resolved set of handler definitions.

![UnifiedHookManager — Architecture](images/unified-hook-manager-architecture.png)

A second key architectural trait is agent-scoping layered atop an agent-agnostic event model: the same event (e.g. `pre-tool`) can fire across all supported agents, but individual handlers can be scoped to a specific agent, letting agent-specific scripts, commands, or modules react selectively. This is a pattern of generalized triggers with specialized responses, keeping the event vocabulary small while allowing per-agent customization.

## Implementation Details

Internally, dispatch logic iterates the registered handlers for a given event in priority order. Execution is driven by a discriminated handler-type dispatch: each handler entry carries a "kind" (script, command, or module), and the manager branches accordingly — invoking an external script file, running a shell command, or calling into an in-process module. This discriminated-union-style dispatch keeps heterogeneous execution mechanisms behind a uniform invocation interface, so callers triggering an event don't need to know how any individual handler is implemented.

Priority ordering is central to correctness: because handlers for the same event can originate from different configuration layers (default/user/project) and different agents, the priority-sorted registry is what guarantees deterministic execution order across these merged sources.

## Integration Points

![UnifiedHookManager — Relationship](images/unified-hook-manager-relationship.png)

UnifiedHookManager is a core child of ConstraintSystem, which relies on it for the hook-triggering half of its rule-based validation and enforcement responsibilities (the other half handled by violation capture). Its immediate upstream dependency is HookConfigLoader, from which it consumes merged handler configuration — a strict one-way dependency that keeps parsing and dispatch independently testable and replaceable. While UnifiedHookManager itself does not appear to directly invoke ViolationCaptureService or ContentValidationAgent based on the observations, it operates within the same ConstraintSystem umbrella, where dispatched hooks (e.g. `pre-tool`/`post-tool`) are the likely trigger points feeding into violation detection and downstream persistence flows.

## Usage Guidelines

Developers registering new hooks should target HookConfigLoader's layered config files (`~/.coding-tools/hooks.json` or `.coding/hooks.json`) rather than expecting UnifiedHookManager to read configuration directly — the manager only sees the merged result. When defining handlers, specify the correct handler kind (script, command, or module) since dispatch behavior branches strictly on this type. Use agent scoping deliberately: omit it for handlers that should fire for all agents, and set it explicitly when a script or module is only valid for a particular agent context. Finally, since execution order within an event is governed by priority, place shared/system-level handlers at appropriate priority tiers relative to project- or agent-specific ones to avoid unintended ordering conflicts.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem provides rule-based validation and enforcement for tool calls and file operations during Claude Code sessions, plus a hook infrastructure that lets agent-agnostic events (pre-tool, post-tool, startup, shutdown, etc.) trigger scripts, commands, or modules. It is composed of a hook configuration layer (lib/agent-api/hooks/hook-config.js) that loads and merges user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) configs, and a central UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) that registers, prioritizes, and dispatches handlers per event across all supported agents. Violations detected during live sessions are captured and persisted via the ViolationCaptureService (scripts/violation-capture-service.js), which writes JSONL logs and maintains rolling statistics for dashboard consumption.

Architecturally, the system favors a layered configuration-merge pattern (defaults → user → project) with validation warnings rather than hard failures, and a priority-sorted handler registry keyed by event name. Constraint violations flow from live session monitoring into a persistent JSON store capped at 1000 entries, with statistics (severity breakdown, most common violation, per-session averages) computed on write. The system also integrates with content/documentation validation (ContentValidationAgent in integrations/semantic-analysis) which, while primarily about entity staleness, shares the same validation-issue/severity taxonomy pattern used elsewhere in constraint reporting, and with the System Health Dashboard's workflow visualization hooks (React-side, distinct from the agent-api hook system) for rendering constraint/violation data.

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- hook-config.js implements a layered merge pattern: defaults are loaded first, then user-level ~/.coding-tools/hooks.json, then project-level .coding/hooks.json, each layer overriding the previous
- [ViolationCaptureService](./ViolationCaptureService.md) -- violation-capture-service.js persists individual violation events as JSONL log lines, appending rather than rewriting the whole log per capture
- [ContentValidationAgent](./ContentValidationAgent.md) -- content-validation-agent.ts checks entity observations and diagrams against live codebase state to flag stale references


---

*Generated from 5 observations*
