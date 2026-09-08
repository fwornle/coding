# HookConfigLoader

**Type:** SubComponent

[Code References] lib/agent-api/hooks/hook-manager.js - UnifiedHookManager.registerHandler(): duplicate-ID replace-in-place + re-sort by priority; lib/agent-api/hooks/hook-manager.js - UnifiedHookManager.initialize(): user-config-then-project-config load order; lib/agent-api/hooks/hook-manager.js - UnifiedHookManager.executeHooks(): agents[] filtering and stopOnError short-circuit; lib/agent-api/hooks-api.js - HooksManager.registerHook(): abstract-class hook registration with priority sort; lib/agent-api/hooks-api.js - EVENT_MAPPINGS: per-agent null mappings for unsupported unified events; lib/agent-api/hooks/claude-bridge.js - main(): fail-open try/catch returning decision:'allow' on any error; lib/agent-api/hooks/migration-tool.js:24 - import of DEFAULT_CONFIG from './hook-config.js'; lib/agent-api/hooks/migration-tool.js - migrateClaudeHooks()/migrateCopilotHooks(): hardcoded single-agent `agents` array on migrated handlers

# HookConfigLoader — Technical Insight Document

## What It Is

HookConfigLoader is a class implemented in `lib/agent-api/hooks/hook-config.js`, serving as the configuration-loading engine for the ConstraintSystem. Although the source file itself was not directly available for inspection, its shape is confirmed indirectly through its consumer `lib/agent-api/hooks/migration-tool.js:24`, which imports a `DEFAULT_CONFIG` constant from the same module. This tells us hook-config.js exports at least two things: the `HookConfigLoader` class and a `DEFAULT_CONFIG` template object that represents the canonical shape of a unified hooks configuration. The migration tool relies on this template directly — `writeUnifiedConfig()` performs `JSON.parse(JSON.stringify(DEFAULT_CONFIG))` to deep-clone a fresh config skeleton before merging in migrated legacy hooks — making HookConfigLoader's module the single source of truth for what a "valid" unified config looks like.

As the parent ConstraintSystem context establishes, HookConfigLoader implements a strict two-tier layered merge: user-level config at `~/.coding-tools/hooks.json` (organization-wide defaults) is layered beneath project-level config at `.coding/hooks.json` (project-specific overrides), reconciled via `mergeConfigs()`.

## Architecture and Design

![HookConfigLoader — Architecture](images/hook-config-loader-architecture.png)

The dominant pattern here is a two-tier layered configuration merge with override-by-ID semantics, and it is architecturally mirrored — though not directly reused — by sibling component `UnifiedHookManager`. `UnifiedHookManager.initialize()` in `lib/agent-api/hooks/hook-manager.js` hardcodes the same load order at the runtime level: `loadConfig(userConfigPath, 'user')` always resolves before `loadConfig(projectConfigPath, 'project')`. Because `registerHandler()` replaces same-ID entries in place, a project handler sharing an ID with a user handler silently overwrites it, with no diagnostic surfaced — a direct runtime enactment of the merge semantics HookConfigLoader defines at the config level.

A second, more concerning pattern is structural duplication rather than layered reuse: `UnifiedHookManager.registerHandler()` and the abstract `HooksManager.registerHook()` (`lib/agent-api/hooks-api.js`) independently implement nearly identical logic — a `Map<event, handler[]>` registry, fallback ID generation, and priority re-sorting on every registration — despite having no inheritance relationship. `HooksManager` is an abstract base that throws if instantiated directly, intended for per-agent subclassing, whereas `UnifiedHookManager` is a concrete singleton (via `getHookManager()`, consumed by `claude-bridge.js`). This is a notable architectural redundancy: fixes to sort/dedup logic in one will not propagate to the other, a risk also flagged independently by sibling `ContentValidationAgent`'s observations.

Config validation follows the same "fail-open" philosophy pervasive across this subsystem: HookConfigLoader's `validateConfig()` is warning-only rather than throwing, consistent with `claude-bridge.js`'s `main()`, which wraps stdin parsing, config loading, and hook execution in a try/catch that unconditionally emits `{decision: 'allow', ...}` and exits 0 on any failure. Both a malformed `hooks.json` and a crashing bridge script degrade identically — silent permission plus a logged warning.

## Implementation Details

![HookConfigLoader — Relationship](images/hook-config-loader-relationship.png)

The deep-clone-then-merge idiom in `migration-tool.js` (`JSON.parse(JSON.stringify(DEFAULT_CONFIG))`) reveals that DEFAULT_CONFIG is treated as an immutable template rather than a live object — necessary because multiple migrations (`migrateClaudeHooks()`, `migrateCopilotHooks()`) may run against the same base shape without cross-contamination. Migrated handlers are stamped with a hardcoded schema of `id/type/path/priority/enabled/agents`, and critically, each handler receives a single-element `agents` array (`['claude']` or `['copilot']`). Combined with `UnifiedHookManager.executeHooks()`'s filtering logic — `if (handler.agents && handler.agents.length > 0 && !handler.agents.includes(fullContext.agentType)) continue;` — this means migrated hooks are permanently agent-scoped and can never fire for a future third agent type without manual post-migration editing, undercutting the "unified" framing of the config format.

The override-by-ID mechanism depends entirely on handlers sharing an explicit `id` field across tiers. Migration-tool's ID-generation pattern (`${event}-${type}-${Date.now()}`) means two independently authored handlers targeting the same event/type will almost never collide, so cross-tier overriding in practice only works when configs deliberately coordinate IDs — an implicit contract that HookConfigLoader's merge logic doesn't enforce or validate.

## Integration Points

HookConfigLoader sits beneath `UnifiedHookManager` in the initialization chain: the manager's `initialize()` calls into config loading for both user and project tiers before handlers become active. It also underpins `migration-tool.js`'s ETL flow, which converts legacy per-agent config files into the unified schema HookConfigLoader's `DEFAULT_CONFIG` defines — though observation 10 notes there is no shared schema validator between the two files, creating tight but unenforced coupling.

Downstream, `claude-bridge.js` dynamically imports `hook-manager.js`'s `getHookManager()` singleton at request time (not module load), deferring config-loading cost to first invocation. The agent-capability asymmetries encoded in `hooks-api.js`'s `EVENT_MAPPINGS` (e.g., Claude lacks PRE_PROMPT/POST_PROMPT/ERROR; Copilot lacks POST_PROMPT) mean a config validated successfully by HookConfigLoader can still contain handlers that silently never fire under a given agent's bridge, since `translateEvent()` returns `null` rather than erroring.

## Usage Guidelines

Developers editing `hooks.json` files must understand that project-level config always wins on ID collisions, and that overrides require deliberately matching IDs across user and project tiers — omitted IDs mean two configs will coexist rather than merge. Because HookConfigLoader's validation is lenient by design (warnings, not exceptions), malformed configs will not halt agent operation; the `stopOnError` flag exposed in `UnifiedHookManager`'s constructor (default `false`) is the one available escape hatch for teams needing fail-closed behavior on high-stakes hook chains. Finally, authors of migrated configs should manually review the `agents` array before assuming cross-agent applicability, and should cross-reference `EVENT_MAPPINGS`/`CLAUDE_EVENT_MAP`/`COPILOT_EVENT_MAP` to confirm a target event is actually dispatchable by the intended agent bridge before relying on it.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- HookConfigLoader (class) in hook-config.js

**Relationships:**
- The code graph identifies HookConfigLoader as a class in hook-config.js, but the provided code files do not include hook-config.js itself — only its consumer migration-tool.js, which imports `DEFAULT_CONFIG` from './hook-config.js' (lib/agent-api/hooks/migration-tool.js:24). This confirms hook-config.js exports at least a DEFAULT_CONFIG constant alongside the HookConfigLoader class, and that the migration tool depends on this shared default shape when constructing a unified config object in writeUnifiedConfig() (lib/agent-api/hooks/migration-tool.js), via `JSON.parse(JSON.stringify(DEFAULT_CONFIG))` to get a deep-cloned template before merging migrated hooks into it.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem's configuration architecture follows a strict two-tier layered merge pattern implemented in HookConfigLoader (lib/agent-api/hooks/hook-config.js). User-level configuration lives at ~/.coding-tools/hooks.json and represents global defaults applicable across all projects, while project-level configuration at .coding/hooks.json can override specific handlers or add project-specific constraints. The mergeConfigs() function performs this layering, meaning a new developer modifying constraint behavior needs to understand which file actually takes effect at runtime — project config wins on key collisions, but non-overlapping keys from both sources are preserved. This design allows teams to ship organization-wide constraints via user config while individual projects retain the ability to loosen or tighten specific rules without forking the entire config file.

### Siblings
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [ViolationCaptureService](./ViolationCaptureService.md) -- [CGR] ViolationCaptureService (class) in violation-capture-service.js
- [ContentValidationAgent](./ContentValidationAgent.md) -- [LLM] Two structurally similar but separately-maintained hook managers exist in this codebase: the abstract `HooksManager` class in lib/agent-api/hooks-api.js and the concrete `UnifiedHookManager` in lib/agent-api/hooks/hook-manager.js. Both independently implement a `Map<event, Handler[]>` registry, both re-sort the per-event array by numeric `priority` on every registration (`registerHook` in hooks-api.js vs `registerHandler` in hook-manager.js), and both generate a fallback ID using `Date.now()` when the caller doesn't supply one. This duplication suggests `HooksManager` was intended as a generic base class that `UnifiedHookManager` should have extended, but the two evolved independently — a maintenance risk if the duplicate-ID replacement fix (present in `registerHandler`) or the priority-sort fix ever needs to be applied to only one of them.
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- knowledge-injection-hook.js gates injection per-process via isInjectionEnabled(), reading CODING_KNOWLEDGE_INJECTION and treating only '0'/'false'/'off' (case-insensitive) as disabling, defaulting ON otherwise
- [HealthPromptHook](./HealthPromptHook.md) -- [LLM] [object Object]


---

*Generated from 11 observations*
