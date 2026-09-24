# ClaudeBridgeTranslation

**Type:** Detail

# ClaudeBridgeTranslation

## What It Is

ClaudeBridgeTranslation is implemented in `lib/agent-api/hooks/claude-bridge.js`, a standalone CLI process (not a library import) invoked by Claude Code's own hook runner per the settings.json snippet documented in its header comment. It is the concrete bridge component within the parent **KnowledgeInjectionHooks** system, translating between Claude Code's native hook event vocabulary (`PreToolUse`, `PostToolUse`, `Startup`, `Shutdown`, `PrePrompt`, `PostPrompt`, `Error`) and the unified internal `HookContext`/`HookEvent` shape consumed by the broader hooks system. Its sibling **HooksManagerAbstractContract** (`hooks-api.js`'s `HooksManager`) defines the abstract, agent-agnostic contract that a concrete dispatcher must fulfill; claude-bridge.js is the Claude-specific edge adapter that feeds into that world via the dynamically-imported `hook-manager.js`.

## Architecture and Design

The core pattern is a bidirectional adapter/bridge: `transformContext(claudeContext, nativeEvent)` (claude-bridge.js:75-97) converts native Claude payloads into unified `HookContext` objects, while `transformResponse(unifiedResult)` (claude-bridge.js:104-110) converts back. This translation is deliberately asymmetric and lossy in only one direction — `transformContext` spreads the entire raw `claudeContext` into `metadata` so nothing native is discarded, whereas `transformResponse` discards everything from the unified result except `allow`/`messages`, producing Claude's narrow `{decision, message?}` contract.

Event name mapping is table-driven via `EVENT_MAP` (claude-bridge.js:34-42) rather than per-event conditionals, mirroring the sibling **EventMappingsTable** artifact (`EVENT_MAPPINGS.claude` in hooks-api.js:37-45). Critically, these two tables are not synchronized programmatically and make conflicting claims: `EVENT_MAP` treats `Startup`/`Shutdown`/`PrePrompt`/`PostPrompt`/`Error` as real, actively-forwarded native events, while `hooks-api.js`'s `translateEvent()` maps those same five to `null` in the unified→native direction, annotated as "handled by launcher script" or "EXIT trap." Nothing in the supplied code cross-checks these two sources of truth, making this a latent architectural inconsistency.

The dispatcher dependency is loaded lazily — `main()` (claude-bridge.js:118-155) performs `await import('./hook-manager.js')` and calls `getHookManager()` only inside its try block — deferring module load cost until the bridge process actually runs and creating a natural fail-open boundary around that import.

## Implementation Details

`readStdin()` (claude-bridge.js:47-69) races an `end` event handler (which JSON-parses accumulated `data`) against a bare `setTimeout(..., 1000)` that resolves to `{}` only `if (!data)`. Because the timeout only guards the zero-bytes case rather than clearing/cancelling stream listeners, it offers no real protection against a stdin producer that writes a partial payload and then hangs — the 1s window is a no-data fallback, not a truncation guard.

`transformContext` looks up `EVENT_MAP[nativeEvent]`, falling back to `nativeEvent.toLowerCase()` for unmapped names, and conditionally attaches `tool: { name, input, output }` only when `claudeContext.tool_name` is present — using `undefined` rather than `{}` so downstream consumers like `manager.executeHooks` can distinguish tool events from lifecycle events by presence/absence of the field.

`transformResponse` joins the unified `messages: string[]` array with `\n` into Claude's single `message` string, using `undefined` (not empty string) when there are no messages, keeping the emitted JSON free of a spurious empty key.

`main()` wraps the entire hook-manager lookup and execution in a try/catch where any failure — import error, thrown handler, malformed stdin — falls into a catch clause that fabricates `{decision: 'allow', message: 'Hook bridge error: ...'}` and calls `process.exit(0)`. This is a deliberate fail-open translation boundary: a broken `hook-manager.js` silently degrades to a no-op rather than blocking Claude Code's tool execution.

## Integration Points

ClaudeBridgeTranslation depends on `hook-manager.js` (via lazy dynamic import) as its dispatch target, and structurally parallels — without sharing code with — `hooks-api.js`'s `EVENT_MAPPINGS.claude` table. It is one of potentially several per-agent bridges; a session record on Copilot's context-injection hook establishes that Copilot's equivalent hook name is version-adaptive (`postToolUse` on Copilot CLI ≤1.0.71 vs. `userPromptSubmitted` on 1.0.72+), meaning any Copilot bridge built on this same architecture would need a version-check field that the current mapping table shape (and by extension `EVENT_MAPPINGS.copilot`) has no room for. It has no relation to **KnowledgeInjectionHookFiltering**, which governs tool-call allow/block decisions rather than knowledge-content selection, nor to the unrelated `system-health-dashboard` "hooks" (React data-fetching hooks), which share only a filename substring.

## Usage Guidelines

Treat `EVENT_MAP` and `hooks-api.js`'s `EVENT_MAPPINGS.claude` as two independent, currently-diverging sources of truth for Claude's lifecycle events — any change to one must be manually checked against the other, especially regarding `Startup`/`Shutdown`/`PrePrompt`/`PostPrompt`/`Error`. Do not assume the 1-second `readStdin()` timeout protects against slow or truncated stdin writes; it only covers the empty-input case. Because `main()` fails open, a missing or broken `hook-manager.js` will not block tool execution — this is intentional but means bridge failures may be silently invisible unless the emitted `Hook bridge error` message is surfaced/logged elsewhere. When extending translation logic, preserve the existing asymmetry (full metadata retention on ingress, minimal decision/message on egress) unless there's a concrete need for richer round-tripping.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Copilot filesystem hooks no injection' record establishes that Copilot's context-injection hook name is version-adaptive (`postToolUse` on Copilot CLI ≤1.0.71, `userPromptSubmitted` on 1.0.72+) rather than fixed — this is architecturally relevant to claude-bridge.js's sibling `EVENT_MAPPINGS.copilot` table in hooks-api.js:47-55, which hardcodes single event names per unified event with no version parameter, meaning any bridge built the same way as claude-bridge.js but for Copilot would need a version check that the current mapping shape has no field for.
- The 'Dashboard ESLint Configuration' record establishes that constraint-monitor's Next.js dashboard and system-health-dashboard's Vite build require separately maintained ESLint configs — relevant here because `integrations/system-health-dashboard/src/components/workflow/hooks.ts` and `src/hooks/usePolledFetch.ts` share the word 'hooks' with `lib/agent-api/hooks-api.js` and `lib/agent-api/hooks/claude-bridge.js` but belong to an unrelated React/Vite data-fetching pipeline, not the Claude Code agent-hook translation layer this component covers.

## Hierarchy Context

### Parent
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- [LLM] lib/agent-api/hooks-api.js defines an abstract `HooksManager` base class whose constructor pre-populates `this.hooks` (a `Map<string, RegisteredHook[]>`) with an empty array for every value in the `HookEvent` enum, exactly mirroring the eager-initialization pattern the parent context attributes to `hook-manager.js`'s `UnifiedHookManager`. This is a distinct file from `hook-manager.js` — `hooks-api.js` exposes `registerHook()`/`unregisterHook()`/`triggerHook()` as a generic interface, while subclasses must implement `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` (all of which throw 'must be implemented by subclass' if unimplemented here), so this file is the abstract contract rather than the concrete dispatcher.

### Siblings
- [HooksManagerAbstractContract](./HooksManagerAbstractContract.md) -- [LLM] The `HooksManager` class in lib/agent-api/hooks-api.js guards against direct instantiation via `if (new.target === HooksManager) throw new Error(...)` in its constructor, a runtime enforcement of the abstract-class contract that TypeScript's `abstract` keyword would provide statically; because this is plain JS, the check is the only thing preventing a caller from `new HooksManager()` and getting a half-functional object whose `getAgentType()`, `loadNativeHooks()`, and `saveNativeHooks()` all throw.
- [EventMappingsTable](./EventMappingsTable.md) -- [LLM] No file in the supplied set defines a component named 'EventMappingsTable' — no table/grid UI component, no React table renderer, and no data structure literally named that. The closest thematically-related artifact is `EVENT_MAPPINGS` in lib/agent-api/hooks-api.js:38-55, a plain JS object mapping unified `HookEvent` enum values to agent-native event name strings per agent type (`claude`, `copilot`). That is a static lookup table, not a UI or persistence component, and the filename match ('EventMappings' + 'Table') appears to be a substring/synonym collision from retrieval rather than an actual implementation of this entity.
- [KnowledgeInjectionHookFiltering](./KnowledgeInjectionHookFiltering.md) -- [LLM] The supplied files implement tool-call lifecycle hooks, not knowledge injection. lib/agent-api/hooks-api.js's `HooksManager` governs PreToolUse/PostToolUse/Startup/Shutdown/Error events via `registerHook()`/`triggerHook()`, and lib/agent-api/hooks/claude-bridge.js's `main()` bridges Claude Code's native stdin/stdout hook protocol into that same event vocabulary. Neither file selects, ranks, or filters knowledge-base content for insertion into an agent prompt — they decide whether a tool call is allowed, not what context an agent sees.


---

*Generated from 10 observations*
