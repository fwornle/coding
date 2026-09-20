# MigrationTool

**Type:** Detail

migrateClaudeHooks() reads ~/.claude/settings.json and maps native events via CLAUDE_EVENT_MAP (e.g. 'PreToolUse' -> 'pre-tool') into a migratedHooks object tagged with _migrated metadata.

# MigrationTool — Technical Insight Document

## What It Is

MigrationTool is a component of the hook configuration subsystem, logically contained within `HookConfigLoader` (as indicated by the "HookConfigLoader contains MigrationTool" relationship). Its purpose is to convert agent-native hook configurations — Claude's `~/.claude/settings.json` and Copilot's `.github/hooks/hooks.json` — into the unified hook format consumed elsewhere in the system. It exposes two primary migration routines, `migrateClaudeHooks()` and `migrateCopilotHooks()`, plus a CLI-style argument parser, `parseArgs()`, that governs how migrations are executed. The tool is exercised in integration testing via `testMigrationTools`, defined in `full-system-validation.test.js`, which calls `createTestFile` and `runScript` to validate migration behavior end-to-end.

## Architecture and Design

The core architectural pattern is **format translation via mapping tables**, mirroring the sibling concept of `EventTranslationMapping` described for `hooks-api.js`'s `EVENT_MAPPINGS`. Just as `EVENT_MAPPINGS` defines per-agent translation tables for `claude` and `copilot` (with some unified events like `PRE_PROMPT`/`POST_PROMPT` mapping to `null` for unsupported cases), MigrationTool uses analogous static maps — `CLAUDE_EVENT_MAP` and `COPILOT_EVENT_MAP` — to translate native event names (`'PreToolUse' -> 'pre-tool'`, `'sessionStart' -> 'startup'`) into the tool's internal vocabulary. This suggests a broader system convention: agent-specific event names are never used directly downstream; they are always normalized through a mapping table before consumption.

Migrated output is not just translated but annotated: each `migratedHooks` object carries `_migrated` metadata, indicating a design decision to preserve provenance/traceability of transformed configuration rather than silently overwriting native formats. This is consistent with a migration tool (as opposed to a live translation layer) — it produces artifacts intended for inspection, backup, or one-time conversion rather than continuous runtime translation.

## Implementation Details

`migrateClaudeHooks()` reads the Claude settings file directly from disk (`~/.claude/settings.json`) and applies `CLAUDE_EVENT_MAP` to rewrite event keys, producing a `migratedHooks` object tagged with `_migrated` metadata. `migrateCopilotHooks()` performs the analogous operation on `.github/hooks/hooks.json`, using `COPILOT_EVENT_MAP`.

Execution behavior is controlled by `parseArgs()`, which supports `--dry-run`, `--no-backup`, `--force`, `--source`, and `--project` flags. This gives the tool a safe-by-default operability profile: dry-run mode allows inspection of migration output without side effects, `--no-backup`/`--force` provide escape hatches for automation or repeated runs, and `--source`/`--project` allow flexible targeting of configuration locations rather than hardcoding paths.

Critically, MigrationTool imports `DEFAULT_CONFIG` from `./hook-config.js`, directly coupling its output schema to `HookConfigLoader`'s expected format. This is an explicit, intentional coupling — the tool's entire purpose is to produce output compatible with the loader's schema — but it is also a maintenance dependency: any schema change in `hook-config.js`'s `DEFAULT_CONFIG` must be reflected in the migration logic to avoid producing invalid merged configs.

## Integration Points

MigrationTool's most direct integration is with `HookConfigLoader` (parent entity), from which it imports `DEFAULT_CONFIG`, tying migrated output format to the loader's schema expectations. This is analogous to — but distinct from — the data-contract boundary noted in the sibling `UnifiedHookConfigLoading` observation, where `HooksManager` (`lib/agent-api/hooks-api.js`) accepts a plain `HookConfig` object without importing `hook-config.js` directly. MigrationTool sits earlier in this pipeline: it produces migrated hook data intended to feed into `HookConfigLoader`'s merged output, which downstream code eventually wires into `new HooksManager(config)`. As with that boundary, there is no evident type-checking mechanism connecting MigrationTool's output shape to `HookConfigLoader`'s consumption — schema mismatches would surface only at runtime.

Testing integration is handled through `testMigrationTools` in `full-system-validation.test.js`, which validates the tool via `createTestFile` (likely constructing fixture settings/hooks files) and `runScript` (likely invoking the migration tool as a subprocess or script entry point) — the call chains `MigrationTool -> createTestFile` and `MigrationTool -> runScript` confirm this is validated as part of full-system rather than isolated unit tests.

## Usage Guidelines

Developers modifying `CLAUDE_EVENT_MAP` or `COPILOT_EVENT_MAP` should verify parity with `EVENT_MAPPINGS` in `hooks-api.js`, since both represent the same conceptual translation (native agent events → unified events) and inconsistency between them could cause divergent behavior between migration-time and runtime translation. Given that unsupported events are mapped to `null` in `EVENT_MAPPINGS` for claude, migration logic should be checked for equivalent handling of unmapped/unsupported native events to avoid silently dropping or mishandling them.

Because MigrationTool's output format is directly tied to `DEFAULT_CONFIG` from `hook-config.js`, any change to `HookConfigLoader`'s schema (field renames, structural changes) requires a corresponding update to migration logic — this coupling is not enforced by type checking and should be covered by the `full-system-validation.test.js` suite. Users of the CLI should default to `--dry-run` when validating unfamiliar source configurations before committing to `--no-backup --force` execution, given the explicit design of these flags to separate inspection from destructive action.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- testMigrationTools (method) in full-system-validation.test.js

**Relationships:**
- Calls: createTestFile, runScript

**Other:**
- Call chain: MigrationTool -> createTestFile
- Call chain: MigrationTool -> runScript


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js

### Siblings
- [UnifiedHookConfigLoading](./UnifiedHookConfigLoading.md) -- [LLM+CGR] The parent-entity observations place HookConfigLoader as a standalone class in hook-config.js, and the actual hooks-api.js file confirms the architectural split described: HooksManager (lib/agent-api/hooks-api.js) is an abstract base class whose constructor accepts a plain HookConfig object (`{userConfigPath, projectConfigPath, bridgeScriptPath, enableLogging}`) rather than an instance of HookConfigLoader. This is a genuine data-contract boundary — HooksManager.constructor() never imports or calls into hook-config.js in the code shown, so any change to HookConfigLoader's merged output shape (e.g. renaming a field, changing 'agents' from an array to an object) would not be caught by type checking at this seam, only by a runtime failure inside whatever code eventually wires the loader's output into `new HooksManager(config)`.
- [EventTranslationMapping](./EventTranslationMapping.md) -- hooks-api.js's EVENT_MAPPINGS defines per-agent translation tables for 'claude' and 'copilot', with several unified events (e.g. PRE_PROMPT, POST_PROMPT) mapped to null for claude, signaling unsupported events.


---

*Generated from 8 observations*
