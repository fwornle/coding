# ClaudeBridge

**Type:** Detail

transformContext() builds a unified context object with event, agentEvent, agentType: 'claude', sessionId (falling back to CLAUDE_SESSION_ID env var or a pid-based id), and tool/metadata fields pulled from the Claude-native payload.

# ClaudeBridge Technical Insight Document

## What It Is

ClaudeBridge is implemented in `claude-bridge.js` as a translation layer between Claude Code's native hook event system and the unified hook abstraction used by `HookManager`. Its core responsibility is bidirectional format conversion: it ingests Claude-native payloads (events like `PreToolUse` and `PostToolUse`), transforms them into a normalized representation the hook system understands, drives execution through the hook manager, and converts the results back into the shape Claude expects on the way out.

## Architecture and Design

The design follows an adapter/bridge pattern: ClaudeBridge exists specifically to decouple Claude's native event vocabulary from the vendor-neutral vocabulary used internally by `HookManager`. This is evident in `EVENT_MAP`, a static lookup table translating native event names (`PreToolUse`, `PostToolUse`) into unified names (`pre-tool`, `post-tool`). By centralizing this mapping, the bridge insulates the rest of the hook infrastructure from Claude-specific naming, meaning other bridges for different agent types could plug into `HookManager` the same way, each performing their own native-to-unified translation.

The `main()` entry point acts as the orchestration function and demonstrates a lazy-initialization pattern: it imports `getHookManager()` from `hook-manager.js` only when needed and checks `manager.initialized` before calling `manager.initialize(projectPath)`, avoiding redundant setup. This mirrors the parent relationship where `HookManager` (specifically `UnifiedHookManager.initialize(projectPath)`) owns configuration loading — first user config, then project config for override precedence — while ClaudeBridge simply triggers that initialization on demand rather than duplicating config logic.

A key design decision is the fail-open error handling strategy: rather than propagating errors or blocking execution, `main()` catches any failure and writes `{decision: 'allow', message: 'Hook bridge error: ...'}` to stdout, exiting 0. This trades strict correctness/safety for availability — a bridge crash should never block Claude's operation, prioritizing uptime over blocking-on-error semantics.

## Implementation Details

The transformation logic splits cleanly into two directions. `transformContext()` handles inbound normalization: it builds a unified context object containing `event` (mapped via `EVENT_MAP`), `agentEvent` (presumably the original native name), a fixed `agentType: 'claude'` tag, `sessionId` (resolved via `CLAUDE_SESSION_ID` env var or falling back to a pid-based identifier), and tool/metadata fields extracted from the Claude-native payload. This function is the single point where Claude-specific payload structure is parsed into the generic shape the rest of the system consumes.

`transformResponse()` handles the outbound direction, converting the unified `{allow, messages}` result structure into Claude's expected `{decision: 'allow'|'block', message}` shape. This asymmetry (unified uses plural `messages`, Claude expects singular `message`) suggests some consolidation or selection occurs during transformation.

`main()` ties these together: it resolves `projectPath` from `metadata.projectPath` or falls back to `process.cwd()`, ensures the hook manager is initialized exactly once per invocation, and wraps the entire flow in a try/catch that guarantees a valid Claude-shaped response is always emitted, even on error.

## Integration Points

ClaudeBridge's primary dependency is `hook-manager.js`, accessed through the `getHookManager()` factory function, establishing a clear contract where ClaudeBridge is a consumer of `HookManager` rather than an implementation detail of it — reflected in the parent relationship "HookManager contains ClaudeBridge." The initialization call `manager.initialize(projectPath)` connects directly into the config-loading behavior described for `UnifiedHookManager`/`UnifiedHookManagerConfigLoader`, where user config loads first and project config (from `.coding/hooks.json`) loads second and takes precedence.

Environment integration occurs through `CLAUDE_SESSION_ID`, giving external processes a way to supply session continuity, with a pid-based fallback ensuring a session id always exists. Sibling entities like `HooksApiInterface` (which enforces abstract instantiation) and `HookMigrationTool` (with its CLI flags) suggest ClaudeBridge operates within a broader ecosystem of enforced interfaces and tooling for hook lifecycle management, though ClaudeBridge itself is not shown implementing or extending those abstractions directly.

## Usage Guidelines

Developers integrating with or modifying ClaudeBridge should preserve the fail-open contract: any new failure paths introduced into `main()` must still resolve to a valid `{decision: 'allow', ...}` response rather than throwing, to avoid blocking Claude Code execution. When extending `EVENT_MAP`, ensure both `transformContext()` and any consumers of the unified event names are updated consistently, since this map is the single source of truth for event name translation.

Because `manager.initialized` is checked before calling `initialize()`, callers should not assume `main()` always performs full project/user config loading — repeated invocations within the same process will skip initialization, so any state that needs per-invocation freshness should not rely on this path. Finally, since `projectPath` resolution falls back to `process.cwd()`, invocations expecting project-specific config (per `UnifiedHookManagerConfigLoader`'s `.coding/hooks.json` convention) should explicitly supply `metadata.projectPath` to avoid ambiguity when the working directory differs from the intended project root.


## Hierarchy Context

### Parent
- [HookManager](./HookManager.md) -- UnifiedHookManager.initialize(projectPath) loads user config first via loadConfig(userConfigPath, 'user') then project config via loadConfig(projectConfigPath, 'project'), giving project-level entries precedence through later overwrite.

### Siblings
- [HooksApiInterface](./HooksApiInterface.md) -- HooksManager's constructor throws if instantiated directly ('HooksManager is abstract and cannot be instantiated directly'), enforcing subclassing.
- [HookMigrationTool](./HookMigrationTool.md) -- parseArgs() supports --dry-run, --no-backup, --force, --source, and --project flags for controlling migration behavior.
- [UnifiedHookManagerConfigLoader](./UnifiedHookManagerConfigLoader.md) -- initialize(projectPath) first calls loadConfig(this.config.userConfigPath, 'user') then, if a projectPath is given, sets projectConfigPath to path.join(projectPath, '.coding', 'hooks.json') and calls loadConfig(..., 'project'), so project config loads and registers after user config.


---

*Generated from 5 observations*
