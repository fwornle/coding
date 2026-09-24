# ClaudeBridge

**Type:** Detail

## What It Is

ClaudeBridge is implemented in `lib/agent-api/hooks/claude-bridge.js`. It is an adapter/translation layer that converts Claude Code's native hook wire format — JSON delivered over stdin, using event names like `PreToolUse`, `PostToolUse`, `Startup`, `Shutdown`, `PrePrompt`, `PostPrompt`, `Error` — into a unified internal event vocabulary consumed by its parent, UnifiedHookManager (`hook-manager.js`), and back again into the `{decision, message}` shape Claude Code expects. The file operates both as a standalone CLI hook script (invoked by Claude Code's settings.json) and as an importable module exposing pure functions for testing.

## Architecture and Design

The core pattern is a three-stage Adapter/Bridge pipeline inside `main()`: `readStdin()` → `transformContext(claudeContext, nativeEvent)` → dispatch via the manager's `executeHooks()` → `transformResponse(unifiedResult)`. Event name translation is table-driven via the `EVENT_MAP` constant (lines 34-40), with an unmapped fallback of `nativeEvent.toLowerCase()` — a deliberate but risky design choice that lets unrecognized future Claude events pass through as guessed names rather than failing loudly.

Error handling follows a fail-open posture: any exception in `main()` is caught and answered with an `allow` decision plus `process.exit(0)`, prioritizing not blocking Claude Code's operation over strict correctness. This same philosophy surfaces at the parsing layer too — untrusted stdin data is trusted without schema validation before reaching `manager.executeHooks()`.

Module loading is lazy: `hook-manager.js` is pulled in via a dynamic `await import()` inside `main()` rather than a static import, and initialization is gated by a mutable `manager.initialized` flag before calling `manager.initialize(projectPath)`. This defers cost until the bridge is actually invoked and treats the manager as a lazily-initialized singleton — consistent with ClaudeBridge's role as a thin, disposable adapter sitting in front of the heavier UnifiedHookManager dispatch core.

## Implementation Details

`readStdin()` (lines 47-72) wires up `data`/`end`/`error` listeners on `process.stdin` alongside an independent `setTimeout(..., 1000)` that resolves with `{}` if no data has arrived by then. Because the enclosing Promise resolves only once, a genuine `end` event firing after the timeout is silently discarded — a race condition that degrades gracefully (fail-open) rather than hanging, but can leave `unifiedContext.tool` and `metadata` undefined for a slow parent process.

`transformContext()` (lines 77-102) builds the `metadata` object as `{ workingDirectory: claudeContext.cwd || process.cwd(), projectPath: ..., ...claudeContext }` — spreading the entire raw stdin payload into the context handed to every hook handler, unvalidated. `sessionId` resolution falls through `claudeContext.session_id || process.env.CLAUDE_SESSION_ID || 'claude-${process.pid}'`, and `projectPath` itself resolves through a third fallback chain (`process.env.TRANSCRIPT_SOURCE_PROJECT || claudeContext.project_path`, implicitly `process.cwd()` otherwise) that determines which project's hook configuration gets loaded — none of these fallbacks are cross-validated against Claude Code's actual working directory.

`transformResponse()` (lines 109-116) maps the unified `{allow, messages}` result back to Claude's `{decision: 'allow'|'block', message}` shape. The module closes with a CLI guard, `if (process.argv[1] === fileURLToPath(import.<COMPANY_NAME_REDACTED>.url)) { main(); }`, alongside `export { main, transformContext, transformResponse, EVENT_MAP }`, enabling the pure transform functions to be unit-tested without stdin or a live `hook-manager.js`.

## Integration Points

ClaudeBridge's primary dependency is its parent, UnifiedHookManager, accessed via `getHookManager()` from `./hook-manager.js` and driven through `.initialized`, `.initialize(projectPath)`, and `.executeHooks(event, context, agentType)`. Notably, `hook-manager.js`'s internals were not available for direct inspection, so its Map<event, handler[]> dispatch mechanics remain unverified from ClaudeBridge's perspective — a gap shared with the sibling UnifiedHookManagerConfigLoading component, which likewise cannot confirm how `initialize()` loads or resolves project-level hook configuration.

A same-directory class, `hooks-api.js`'s `HooksManager`, exposes a superficially similar API (`registerHook`, `triggerHook`, priority-sorted handler arrays, eager `Map` pre-population per `HookEvent` at lines 103-121) but is confirmed unrelated: its method surface (`getAgentType()`, `loadNativeHooks()`, `registerHook()`, `triggerHook()`) shares no names with what ClaudeBridge actually calls. This is an architecturally adjacent but distinct abstraction and should not be conflated with the manager ClaudeBridge drives.

## Usage Guidelines

Developers modifying `EVENT_MAP` should treat it as the single source of truth for Claude-native event names; adding a new Claude Code event requires an explicit entry, since the lowercase fallback silently masks omissions rather than erroring. Anyone consuming `metadata` in a downstream hook handler should not assume it is validated — the entire raw stdin payload is spread in, so handlers must defensively check fields rather than trust schema. Given the stdin race in `readStdin()`, hook authors relying on `tool` arguments should be aware that unusually slow or buffered parent processes could yield an empty context; extending or replacing the fixed 1000ms timeout is a candidate improvement rather than a settled design constant. Finally, because `transformContext`/`transformResponse` are pure and exported, they should be the primary units under test rather than exercising `main()` end-to-end, and any changes to project-path resolution should be cross-checked against `hook-manager.js`'s `initialize(projectPath)` once its implementation is available for review.


## Hierarchy Context

### Parent
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js

### Siblings
- [UnifiedHookManagerConfigLoading](./UnifiedHookManagerConfigLoading.md) -- [LLM] None of the retrieved files contain an implementation of a config-loading routine for UnifiedHookManager. lib/agent-api/hooks/claude-bridge.js only *calls* `manager.initialize(projectPath)` on the singleton returned by `getHookManager()` from './hook-manager.js' — it does not define what `initialize()` does, whether it reads a JSON/YAML config file, or how it resolves user-level vs project-level hook config paths. The parent entity's own observations already flag this: 'None of the retrieved files contain the actual body of hook-manager.js.' This pass inherits the same gap for the more specific ConfigLoading sub-component.


---

*Generated from 9 observations*
