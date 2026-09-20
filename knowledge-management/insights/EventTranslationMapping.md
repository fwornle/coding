# EventTranslationMapping

**Type:** Detail

hooks-api.js's EVENT_MAPPINGS defines per-agent translation tables for 'claude' and 'copilot', with several unified events (e.g. PRE_PROMPT, POST_PROMPT) mapped to null for claude, signaling unsupported events.

# EventTranslationMapping: Technical Insight Document

## What It Is

EventTranslationMapping is the logical mechanism, implemented primarily in `hooks-api.js`, that translates unified/agent-agnostic event names into agent-specific event names (and vice versa). Its centerpiece is the `EVENT_MAPPINGS` data structure, which defines per-agent translation tables for at least two agent types — `claude` and `copilot`. Some unified events, such as `PRE_PROMPT` and `POST_PROMPT`, are explicitly mapped to `null` for the `claude` agent, encoding the fact that these events are simply unsupported by that agent rather than mistakenly omitted. A parallel, complementary implementation of this concept exists in `claude-bridge.js`, whose `transformContext()` function performs the inverse translation (native → unified) with a fallback strategy. As a Detail entity, EventTranslationMapping is conceptually owned by HookConfigLoader (in `hook-config.js`), though the actual mapping tables and logic live in the agent-facing runtime code rather than in the loader itself.

## Architecture and Design

The core pattern is a **lookup-table-based translation layer** (a form of adapter/anti-corruption layer) that isolates agent-specific event vocabularies from a unified event vocabulary used elsewhere in the system. `HooksManager.translateEvent()` is the enforcement point for this contract: it throws when no mapping table exists for a given agent type (a hard failure for truly unknown agents), but returns `null` when a mapping exists yet the specific event is unsupported (a soft, expected outcome). This two-tier error/null distinction is a deliberate design choice — it separates "we don't know this agent" (programmer error / misconfiguration) from "this agent doesn't support this event" (a legitimate, expected state that callers must handle gracefully).

In contrast, `claude-bridge.js`'s `transformContext()` takes an intentionally more permissive approach: rather than throwing or returning null for unmapped native events, it falls back to `nativeEvent.toLowerCase()`. This asymmetry reflects differing risk tolerances at different boundaries of the system — `HooksManager` sits at a controlled internal seam where strict validation is affordable, while the bridge script is closer to external/native input and prioritizes resilience (never crashing) over strictness.

## Implementation Details

The translation tables in `EVENT_MAPPINGS` are structured as nested per-agent dictionaries mapping unified event constants (e.g., `PRE_PROMPT`, `POST_PROMPT`) to native event strings or `null`. `HooksManager.translateEvent()` consumes this structure, using the agent type as the first-level key to locate a mapping table, then the unified event name as the second-level key. Absence of the first-level key triggers an exception; presence of the key but a `null` value signals unsupported-event semantics and propagates that `null` back to the caller.

`claude-bridge.js` implements the reverse-direction concern with its own `EVENT_MAP` and `transformContext()` function. Its fallback mechanic — lowercasing the raw native event name when no explicit mapping is found — acts as a defensive default that guarantees a return value under all conditions, trading precision for robustness.

Sibling functionality in `MigrationTool` (`migrateClaudeHooks()`) illustrates a related but distinct translation concern: rather than runtime event dispatch, it performs a one-time migration, reading `~/.claude/settings.json` and mapping native events via `CLAUDE_EVENT_MAP` (e.g., `'PreToolUse'` → `'pre-tool'`) into a `migratedHooks` object tagged with `_migrated` metadata. This shows the same underlying naming-translation problem being solved independently in at least three places (`hooks-api.js`, `claude-bridge.js`, `MigrationTool`), each with its own map and its own fallback/error semantics.

## Integration Points

EventTranslationMapping's most significant integration nuance is a **data-contract boundary with no compile-time enforcement**. As noted in the `UnifiedHookConfigLoading` sibling observations, `HooksManager`'s constructor accepts a plain `HookConfig` object (`{userConfigPath, projectConfigPath, bridgeScriptPath, enableLogging}`) and never imports or calls into `hook-config.js`. This means HookConfigLoader (the parent entity) and the translation logic in `hooks-api.js` are architecturally decoupled at the type level — any change to HookConfigLoader's merged output shape would only surface as a runtime failure at the point where the loader's output is wired into `new HooksManager(config)`.

Within this landscape, EventTranslationMapping specifically governs how event names flow between the unified layer (consumed by `HooksManager` and its callers) and native agent-specific formats (consumed by bridge scripts like `claude-bridge.js` and migration utilities like `MigrationTool`). It is a dependency for anything that dispatches or interprets hook events across agent boundaries.

## Usage Guidelines

Developers extending `EVENT_MAPPINGS` should preserve the `null`-for-unsupported convention rather than omitting entries entirely, since `HooksManager.translateEvent()` relies on key presence to distinguish "unknown agent" (throws) from "unsupported event" (returns null). Callers of `translateEvent()` must therefore explicitly handle `null` results rather than assuming a valid translation always exists. When adding new agents, a corresponding top-level entry in `EVENT_MAPPINGS` is required, or calls will throw.

When working with `claude-bridge.js`, developers should be aware that its lowercase-fallback behavior in `transformContext()` can silently produce ad hoc event names for anything not explicitly in `EVENT_MAP` — this is a deliberate crash-avoidance mechanism but does mean unmapped events may propagate non-standard names downstream rather than failing loudly. Since equivalent translation logic is duplicated across `hooks-api.js`, `claude-bridge.js`, and `MigrationTool`'s `CLAUDE_EVENT_MAP`, changes to unified event naming conventions should be cross-checked against all three locations to avoid divergence. Finally, because the HookConfigLoader → HooksManager seam is untyped, any modification to the shape of configuration or mapping data passed between them should be paired with integration testing rather than relying on static type checks.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js

### Siblings
- [MigrationTool](./MigrationTool.md) -- migrateClaudeHooks() reads ~/.claude/settings.json and maps native events via CLAUDE_EVENT_MAP (e.g. 'PreToolUse' -> 'pre-tool') into a migratedHooks object tagged with _migrated metadata.
- [UnifiedHookConfigLoading](./UnifiedHookConfigLoading.md) -- [LLM+CGR] The parent-entity observations place HookConfigLoader as a standalone class in hook-config.js, and the actual hooks-api.js file confirms the architectural split described: HooksManager (lib/agent-api/hooks-api.js) is an abstract base class whose constructor accepts a plain HookConfig object (`{userConfigPath, projectConfigPath, bridgeScriptPath, enableLogging}`) rather than an instance of HookConfigLoader. This is a genuine data-contract boundary — HooksManager.constructor() never imports or calls into hook-config.js in the code shown, so any change to HookConfigLoader's merged output shape (e.g. renaming a field, changing 'agents' from an array to an object) would not be caught by type checking at this seam, only by a runtime failure inside whatever code eventually wires the loader's output into `new HooksManager(config)`.


---

*Generated from 3 observations*
