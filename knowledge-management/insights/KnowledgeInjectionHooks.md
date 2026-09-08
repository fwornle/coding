# KnowledgeInjectionHooks

**Type:** SubComponent

knowledge-injection-pi.js builds its query from process.env.CODING_EXPERIMENT_GOAL when present (experiment cell) versus a generic 'project context for {project}' query otherwise, and passes recent git-changed files (via `git diff --name-only HEAD~3`) as context

# KnowledgeInjectionHooks — Technical Insight Document

## What It Is

KnowledgeInjectionHooks is implemented across two scripts — `knowledge-injection-hook.js` and `knowledge-injection-pi.js` — that together form a fail-safe subsystem for enriching Claude Code sessions with contextual project knowledge. As a SubComponent of ConstraintSystem, it sits alongside HookConfigLoader, UnifiedHookManager, ViolationCaptureService, ContentValidationAgent, and HealthPromptHook, but its concerns are narrower and more operational: rather than governing configuration layering or validation policy, it focuses on safely injecting retrieved knowledge (topics, project context, git-changed files) into a running session without ever risking a hang or a corrupted user environment.

![KnowledgeInjectionHooks — Architecture](images/knowledge-injection-hooks-architecture.png)

## Architecture and Design

The dominant architectural pattern here is defensive, fail-open execution wrapped around an optional enrichment step. `knowledge-injection-hook.js` gates its own execution per-process via `isInjectionEnabled()`, which reads `CODING_KNOWLEDGE_INJECTION` and treats only explicit '0'/'false'/'off' values (case-insensitive) as disabling — the default posture is "on," reflecting a design bias toward enrichment being additive and low-risk unless explicitly turned off.

A second pattern is bounded resource consumption: rather than parsing full session transcripts, `extractConversationTopics()` reads only the last `TRANSCRIPT_TAIL_BYTES` (50000 bytes) via a computed-offset `fs.readSync`, trading completeness for predictable latency and memory usage. Similarly, `MAX_OUTPUT_CHARS=16000` acts as a documented backstop above the retrieval service's own token budget — a safety net rather than a primary limiter, indicating the design assumes the upstream retrieval service is the real authority on result sizing.

The most safety-critical pattern is the unref'd watchdog timer: a `SAFETY_TIMEOUT_MS` (5000ms interactive, 15000ms for experiment cells) force-exits the process, guaranteeing the hook can never hang Claude Code regardless of downstream failures. This is a hard architectural guarantee layered on top of the softer fail-open error handling.

## Implementation Details

`knowledge-injection-hook.js` is responsible for lightweight, per-session enrichment: detecting whether injection is enabled, tail-reading the transcript for topic extraction, and enforcing the timeout watchdog. The experiment-mode detection relies on `CODING_EXPERIMENT_TASK_ID` containing `--`, which distinguishes automated experiment cells (given a longer 15s timeout) from interactive sessions (capped at 5s) — an implicit acknowledgment that experiment cells may have heavier or slower retrieval paths.

`knowledge-injection-pi.js` handles the write-side responsibility: constructing a query either from `process.env.CODING_EXPERIMENT_GOAL` (experiment cell) or a generic `'project context for {project}'` fallback, and enriching that query with recently changed files pulled via `git diff --name-only HEAD~3`. Before writing `AGENTS.md`, it performs an explicit safety check against `PI_CODING_AGENT_DIR`, refusing to write when that path resolves to the user's default `~/.pi/agent` directory — a targeted guard against clobbering global user configuration.

Both scripts converge on the same resilience contract: `knowledge-injection-hook.js` returns silently on any parse/filter failure, while `knowledge-injection-pi.js` wraps `main()` in a catch-all and still calls `process.exit(0)`. This fail-open-with-clean-exit contract is the defining implementation trait of the whole subsystem.

## Integration Points

![KnowledgeInjectionHooks — Relationship](images/knowledge-injection-hooks-relationship.png)

As a child of ConstraintSystem, KnowledgeInjectionHooks operates within the same hierarchy as HookConfigLoader's two-tier `~/.coding-tools/hooks.json` / `.coding/hooks.json` merge model, though the observations don't indicate it directly consumes that config loader — its own gating is environment-variable driven (`CODING_KNOWLEDGE_INJECTION`, `CODING_EXPERIMENT_TASK_ID`, `CODING_EXPERIMENT_GOAL`, `PI_CODING_AGENT_DIR`) rather than JSON-config driven, distinguishing it from the registration/priority mechanisms used by sibling HookConfigLoader and UnifiedHookManager. It integrates with the filesystem (session transcript files, `AGENTS.md`) and with git (via `git diff --name-only HEAD~3`) as external context sources, and presumably calls out to a retrieval/knowledge service whose token budget it defers to (per the `MAX_OUTPUT_CHARS` backstop design).

## Usage Guidelines

Developers should treat `CODING_KNOWLEDGE_INJECTION` as the primary on/off switch, remembering that only specific negative strings disable it — anything else, including unset, leaves injection active. When working with experiment cells, `CODING_EXPERIMENT_TASK_ID` (containing `--`) and `CODING_EXPERIMENT_GOAL` should be set consistently, since they simultaneously affect the timeout budget and the query construction logic. Anyone extending `knowledge-injection-pi.js` must preserve the `PI_CODING_AGENT_DIR` guard against the default `~/.pi/agent` path — this is a deliberate protection against overwriting global user configuration and should never be bypassed. Finally, both scripts' fail-open philosophy (silent return / catch-all with `process.exit(0)`) should be maintained in any modifications: this subsystem is designed to degrade silently rather than ever block or crash the host session, and the unref'd force-exit timeout should not be removed or lengthened without reconsidering the hang-prevention guarantee it provides.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem's configuration architecture follows a strict two-tier layered merge pattern implemented in HookConfigLoader (lib/agent-api/hooks/hook-config.js). User-level configuration lives at ~/.coding-tools/hooks.json and represents global defaults applicable across all projects, while project-level configuration at .coding/hooks.json can override specific handlers or add project-specific constraints. The mergeConfigs() function performs this layering, meaning a new developer modifying constraint behavior needs to understand which file actually takes effect at runtime — project config wins on key collisions, but non-overlapping keys from both sources are preserved. This design allows teams to ship organization-wide constraints via user config while individual projects retain the ability to loosen or tighten specific rules without forking the entire config file.

### Siblings
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [ViolationCaptureService](./ViolationCaptureService.md) -- [CGR] ViolationCaptureService (class) in violation-capture-service.js
- [ContentValidationAgent](./ContentValidationAgent.md) -- [LLM] Two structurally similar but separately-maintained hook managers exist in this codebase: the abstract `HooksManager` class in lib/agent-api/hooks-api.js and the concrete `UnifiedHookManager` in lib/agent-api/hooks/hook-manager.js. Both independently implement a `Map<event, Handler[]>` registry, both re-sort the per-event array by numeric `priority` on every registration (`registerHook` in hooks-api.js vs `registerHandler` in hook-manager.js), and both generate a fallback ID using `Date.now()` when the caller doesn't supply one. This duplication suggests `HooksManager` was intended as a generic base class that `UnifiedHookManager` should have extended, but the two evolved independently — a maintenance risk if the duplicate-ID replacement fix (present in `registerHandler`) or the priority-sort fix ever needs to be applied to only one of them.
- [HealthPromptHook](./HealthPromptHook.md) -- [LLM] [object Object]


---

*Generated from 7 observations*
