# HookConfigLoader

**Type:** SubComponent

hook-config.js implements a layered merge pattern: defaults are loaded first, then user-level ~/.coding-tools/hooks.json, then project-level .coding/hooks.json, each layer overriding the previous

# HookConfigLoader — Technical Insight Document

## What It Is

HookConfigLoader is implemented in `lib/agent-api/hooks/hook-config.js` as the configuration-loading layer of the broader ConstraintSystem's hook infrastructure. Its core responsibility is to locate, read, merge, and normalize hook configuration data from fixed file-system locations before that data is handed off to `UnifiedHookManager` for registration and dispatch. As a subcomponent of ConstraintSystem, it sits alongside `UnifiedHookManager` and `ViolationCaptureService` as one of the three pillars that make hook-driven, agent-agnostic event handling possible during Claude Code sessions.

## Architecture and Design

The defining architectural pattern here is a **layered configuration merge**: defaults are loaded first to establish a baseline configuration, followed by a user-level override (`~/.coding-tools/hooks.json`), and finally a project-level override (`.coding/hooks.json`), with each subsequent layer taking precedence over the previous one. This progressive-override design is formalized as its own child component, `LayeredConfigMerge`, which encapsulates the merge sequencing logic starting from the defaults baseline.

![HookConfigLoader — Architecture](images/hook-config-loader-architecture.png)

A notable design decision is that configuration discovery is **file-path based rather than dynamic** — the loader reads from fixed, known locations instead of searching or discovering config files at runtime. This trades flexibility for predictability and simplicity: developers and operators always know exactly where to look for or place hook configuration, at the cost of not supporting arbitrary config locations or plugin-style discovery.

Equally important is the system's failure-handling philosophy: validation failures during config loading produce **warnings rather than exceptions**. This reflects a broader ConstraintSystem-wide preference for graceful degradation over hard failures, ensuring that a malformed or partially invalid hook config does not halt an entire session — the system falls back to partial or default configurations instead.

## Implementation Details

The loading sequence in `hook-config.js` proceeds in three concrete steps: (1) load built-in defaults, (2) merge in `~/.coding-tools/hooks.json` if present, (3) merge in `.coding/hooks.json` if present. Absence of the project-level file is explicitly treated as a no-op merge rather than an error — the loader simply proceeds with whatever configuration exists from the prior layers, reinforcing the system's tolerance for incomplete environments.

Beyond merging, the loader performs a **normalization pass** on hook entries, transforming raw configuration data into a consistent schema comprising event name, handler type, and priority. This normalization step is what makes the output consumable by `UnifiedHookManager`, which expects a uniform structure to build its priority-sorted, event-keyed handler registry (as implemented in `hook-manager.js`).

## Integration Points

![HookConfigLoader — Relationship](images/hook-config-loader-relationship.png)

HookConfigLoader's primary downstream integration is with its sibling `UnifiedHookManager`: the normalized, merged hook entries it produces (event name, handler type, priority) are exactly the inputs `UnifiedHookManager` needs to populate its priority-sorted handler registry keyed by event name. Structurally, it is contained within `ConstraintSystem`, alongside `ViolationCaptureService` (which persists violation events as JSONL logs) and `ContentValidationAgent` (which shares the constraint system's validation-issue/severity taxonomy). While HookConfigLoader does not directly interact with the latter two, they collectively represent the ConstraintSystem's layered approach to validation: warnings-over-exceptions at the config layer, and structured severity/violation reporting elsewhere. Internally, HookConfigLoader delegates its layer-sequencing logic to its own child component, `LayeredConfigMerge`.

## Usage Guidelines

Developers configuring hooks should understand the override hierarchy: defaults < user-level (`~/.coding-tools/hooks.json`) < project-level (`.coding/hooks.json`), meaning project-specific settings always win. Because missing project-level files are a no-op rather than an error, teams can safely omit `.coding/hooks.json` in projects that don't need custom hook behavior — the system will fall back to user and default configs without failure. Since validation issues surface as warnings rather than thrown exceptions, developers should actively monitor warning output during session startup to catch malformed hook entries, since sessions will otherwise continue silently with partial configuration. Finally, because config discovery relies on fixed, known file paths rather than dynamic discovery, hook configuration files must be placed in exactly the expected locations to be picked up at all.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem provides rule-based validation and enforcement for tool calls and file operations during Claude Code sessions, plus a hook infrastructure that lets agent-agnostic events (pre-tool, post-tool, startup, shutdown, etc.) trigger scripts, commands, or modules. It is composed of a hook configuration layer (lib/agent-api/hooks/hook-config.js) that loads and merges user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) configs, and a central UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) that registers, prioritizes, and dispatches handlers per event across all supported agents. Violations detected during live sessions are captured and persisted via the ViolationCaptureService (scripts/violation-capture-service.js), which writes JSONL logs and maintains rolling statistics for dashboard consumption.

Architecturally, the system favors a layered configuration-merge pattern (defaults → user → project) with validation warnings rather than hard failures, and a priority-sorted handler registry keyed by event name. Constraint violations flow from live session monitoring into a persistent JSON store capped at 1000 entries, with statistics (severity breakdown, most common violation, per-session averages) computed on write. The system also integrates with content/documentation validation (ContentValidationAgent in integrations/semantic-analysis) which, while primarily about entity staleness, shares the same validation-issue/severity taxonomy pattern used elsewhere in constraint reporting, and with the System Health Dashboard's workflow visualization hooks (React-side, distinct from the agent-api hook system) for rendering constraint/violation data.

### Children
- [LayeredConfigMerge](./LayeredConfigMerge.md) -- Per L2 description, hook-config.js loads defaults first, establishing a baseline hook configuration

### Siblings
- [UnifiedHookManager](./UnifiedHookManager.md) -- hook-manager.js maintains a priority-sorted handler registry keyed by event name (e.g. pre-tool, post-tool, startup, shutdown)
- [ViolationCaptureService](./ViolationCaptureService.md) -- violation-capture-service.js persists individual violation events as JSONL log lines, appending rather than rewriting the whole log per capture
- [ContentValidationAgent](./ContentValidationAgent.md) -- content-validation-agent.ts checks entity observations and diagrams against live codebase state to flag stale references


---

*Generated from 5 observations*
