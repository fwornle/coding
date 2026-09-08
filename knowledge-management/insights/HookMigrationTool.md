# HookMigrationTool

**Type:** Detail

migrateClaudeHooks() reads settings.hooks, skips handlers with unknown native events (logger.warn + results.skipped++), and tags each migrated handler with agents: ['claude'] plus a _migrated metadata block recording source, originalEvent, and timestamp.

# HookMigrationTool: Technical Insight Document

## What It Is

HookMigrationTool is a migration utility living within the HookManager subsystem, responsible for converting agent-native hook configurations (Claude, Copilot) into a unified hook schema. Its core entry points are `migrateClaudeHooks()` (and an implied Copilot counterpart) which read native agent settings — for Claude, this means reading `settings.hooks` — and translating them into a normalized representation that the broader HookManager ecosystem can consume. The tool is invoked via a CLI-style argument parser, `parseArgs()`, which supports `--dry-run`, `--no-backup`, `--force`, `--source`, and `--project` flags, indicating it is designed to be run as a standalone migration script rather than purely as an internal library call.

## Architecture and Design

The central architectural pattern is a **translation table / adapter pattern**, implemented via `CLAUDE_EVENT_MAP` and `COPILOT_EVENT_MAP`. These maps define explicit, per-agent event-name translations — e.g., Copilot's `sessionStart` becomes unified `startup`, and Claude's `PreToolUse` becomes `pre-tool`. This mirrors the sibling `ClaudeBridge` component, whose own `EVENT_MAP` in `claude-bridge.js` performs a nearly identical translation (`PreToolUse` → `pre-tool`, `PostToolUse` → `post-tool`), suggesting a shared naming convention for the unified event vocabulary across the hook system, even though the mapping tables themselves appear to be duplicated rather than shared.

The migration tool acts as a boundary process: it runs once (or on demand) to transform legacy/native configuration into the schema that `UnifiedHookManagerConfigLoader` and `UnifiedHookManager.initialize(projectPath)` expect at runtime. This separates one-time/occasional data transformation concerns from the steady-state config-loading pipeline (user config then project config, with project config taking precedence via later overwrite), keeping the runtime loader simple and the migration logic isolated and independently testable.

## Implementation Details

`migrateClaudeHooks()` iterates over `settings.hooks`, checking each native event against `CLAUDE_EVENT_MAP`. If an event isn't recognized, the handler is skipped defensively: a `logger.warn` call flags the issue and `results.skipped++` tracks it, rather than throwing — a resilience choice that lets migration continue over partially-known configurations. For each successfully mapped handler, the tool:

- Tags it with `agents: ['claude']`, explicitly recording provenance of the handler.
- Attaches a `_migrated` metadata block capturing `source`, `originalEvent`, and `timestamp`, preserving an audit trail back to the pre-migration state.
- Generates a unique id following the pattern `claude-migrated-${nativeEvent}-${Date.now()}`, ensuring collision-resistant, human-readable identifiers.
- Applies sensible defaults: `priority: 100` and `enabled: true`, so migrated handlers behave predictably alongside natively-authored unified handlers.

This design indicates the migrated output is meant to be indistinguishable in shape from natively-authored unified hook entries, differing only by the `_migrated` metadata and `agents` tag — enabling downstream code to treat all handlers uniformly while still allowing introspection into migration history.

## Integration Points

HookMigrationTool is a child/contained component of **HookManager**, which implies its output feeds into the same configuration space that `UnifiedHookManagerConfigLoader` populates via `loadConfig`. Because project config is loaded after user config and takes precedence through later overwrite, migrated handlers written into project-level or user-level configuration will interact with that same precedence system — a migration run at the project level could override or coexist with user-level migrated/native entries depending on target `--project` flag usage.

The tool shares conceptual territory with **ClaudeBridge**, which performs live runtime event translation (`PreToolUse`/`PostToolUse` → `pre-tool`/`post-tool`) as opposed to the one-time static migration `HookMigrationTool` performs. The two likely need to stay in sync: any change to Claude's native event vocabulary should be reflected in both `CLAUDE_EVENT_MAP` (migration) and ClaudeBridge's `EVENT_MAP` (runtime bridging).

Indirectly, the tool must also respect the constraints implied by **HooksApiInterface**, where `HooksManager`'s constructor enforces abstract-only usage (throwing if instantiated directly). This suggests migrated hook data is ultimately handled by a concrete subclass of `HooksManager`, not the base class — migration output should be compatible with whatever concrete manager (e.g., UnifiedHookManager) consumes it.

## Usage Guidelines

Operators running the migration tool should use `--dry-run` to preview changes before committing them, and rely on the default backup behavior (disabling only via `--no-backup` when intentionally skipping safety nets). The `--force` flag should be reserved for cases where known warnings (like skipped/unknown native events) are acceptable to override. The `--source` and `--project` flags let operators target specific native configs and specific project directories, which is important given that `UnifiedHookManager.initialize(projectPath)` distinguishes user-level vs. project-level configuration — migrating into the wrong scope could cause unexpected precedence behavior.

Developers extending event maps (`CLAUDE_EVENT_MAP`, `COPILOT_EVENT_MAP`) should ensure new unified event names stay consistent with those used elsewhere in the system, particularly ClaudeBridge's `EVENT_MAP`, to avoid divergent vocabularies between migrated and live-bridged events. Because skipped handlers are only logged (not surfaced as hard failures), consumers of migration results should inspect `results.skipped` counts/logs rather than assuming a clean run implies full coverage of the original configuration.


## Hierarchy Context

### Parent
- [HookManager](./HookManager.md) -- UnifiedHookManager.initialize(projectPath) loads user config first via loadConfig(userConfigPath, 'user') then project config via loadConfig(projectConfigPath, 'project'), giving project-level entries precedence through later overwrite.

### Siblings
- [ClaudeBridge](./ClaudeBridge.md) -- EVENT_MAP in claude-bridge.js maps native events like 'PreToolUse' and 'PostToolUse' to unified names 'pre-tool' and 'post-tool'.
- [HooksApiInterface](./HooksApiInterface.md) -- HooksManager's constructor throws if instantiated directly ('HooksManager is abstract and cannot be instantiated directly'), enforcing subclassing.
- [UnifiedHookManagerConfigLoader](./UnifiedHookManagerConfigLoader.md) -- initialize(projectPath) first calls loadConfig(this.config.userConfigPath, 'user') then, if a projectPath is given, sets projectConfigPath to path.join(projectPath, '.coding', 'hooks.json') and calls loadConfig(..., 'project'), so project config loads and registers after user config.


---

*Generated from 4 observations*
