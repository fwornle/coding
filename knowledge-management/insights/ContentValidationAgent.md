# ContentValidationAgent

**Type:** SubComponent

# ContentValidationAgent — Technical Insight Document

## What It Is

ContentValidationAgent is implemented at `integrations/semantic-analysis/src/agents/content-validation-agent.ts` as part of the semantic-analysis integration, though it is organizationally positioned within the ConstraintSystem as "a related enforcement concern." Its function is to parse free-text entity observations and diagrams for references to files, commands, and APIs — using regex-based `filePathPatterns` and `commandPatterns` — and then cross-check those extracted references against the live codebase and git history via `GitStalenessDetector` and `CommitEntityCorrelation`. The output is a staleness/validation report indicating where knowledge-graph entities have drifted out of sync with the code they describe.

Importantly, this document must be read with a caveat noted directly in the observations: the actual source of `content-validation-agent.ts` was not available for inspection. All implementation claims here are derived from parent-entity (ConstraintSystem) observation text rather than direct code review, and a follow-up pass against the real file is recommended before relying on specifics like exact regex definitions or correlation logic.

## Architecture and Design

The dominant architectural pattern is text-mining-over-structured-metadata: rather than requiring entities to declare typed, machine-readable pointers to code, the agent infers those pointers by pattern-matching observation strings. This is a deliberate trade-off — authoring an observation stays as simple as writing a sentence, but staleness-detection accuracy is bounded by how well the regexes generalize across phrasing (backticked paths, inline code spans, shell snippets with flags). References phrased in unanticipated ways silently escape validation, producing false negatives rather than hard errors.

![ContentValidationAgent — Architecture](images/content-validation-agent-architecture.png)

This yields a two-stage validation pipeline: (1) reference extraction from observation text, followed by (2) cross-source correlation against git history for staleness scoring. This is architecturally analogous to a documentation-linter pattern, but applied to a knowledge graph instead of markdown files.

A key structural insight is that ContentValidationAgent is **not** a live hook participant. It is absent from `EVENT_MAPPINGS` and `HookEvent` handling paths in `lib/agent-api/hooks-api.js` and `lib/agent-api/hooks/claude-bridge.js`, both of which implement a synchronous request/response cycle per tool call (`HooksManager.triggerHook`, `claude-bridge.js`'s `main()`/bridge flow). That dispatch model suits blocking/warning on a single tool invocation but is poorly suited to git-based correlation, which requires a full-repository view and commit history. This strongly suggests ContentValidationAgent runs on a separate cadence — scheduled or on-demand knowledge-base maintenance — rather than being wired into the PreToolUse/PostToolUse pipeline.

## Implementation Details

The core mechanics, per the observations, revolve around `filePathPatterns` and `commandPatterns`: regex constructs designed to detect file/command mentions embedded in natural-language observation strings. Extracted candidates are then handed to `GitStalenessDetector` and `CommitEntityCorrelation`, which correlate them against actual commit history to determine whether the underlying code has changed since the observation was written.

No explicit remediation-triggering mechanism is described — the agent appears to be a reporting/scoring component rather than an actor that flags entities for refresh or otherwise modifies the knowledge graph. Whether reports are persisted, appended, or regenerated fresh on each run is unconfirmed; if it follows sibling durability patterns such as ViolationCaptureService's capped rolling-statistics store (1000-entry cap on `violation-history.json`), a similar bounded-storage trade-off would be a reasonable expectation, but this remains an open question pending direct source inspection.

## Integration Points

![ContentValidationAgent — Relationship](images/content-validation-agent-relationship.png)

Within the ConstraintSystem hierarchy, ContentValidationAgent is a sibling to UnifiedHookManager, HookConfigLoader, ViolationCaptureService, HealthPromptHook, and KnowledgeInjectionHooks, but its integration profile differs sharply from the hook-dispatch siblings. It shares no observed calls into `HooksManager`'s priority-sorted handler registry (`lib/agent-api/hooks-api.js`) or the Claude/Copilot bridge/adapter pattern in `claude-bridge.js`'s `EVENT_MAP`. Its dependencies instead run toward `GitStalenessDetector` and `CommitEntityCorrelation` — components oriented around repository/commit-history analysis rather than event dispatch.

Stylistically, it likely inherits the constraint-system family's fail-open error handling idiom: `claude-bridge.js`'s `main()` wraps execution in try/catch and defaults to `{decision: 'allow', ...}` on infrastructure failure; `HookConfigLoader.validateConfig()` similarly logs warnings rather than throwing. If ContentValidationAgent follows this house style, a parsing failure in its pattern matchers would likely yield an incomplete staleness report rather than a crashed run — favoring availability of partial signal over correctness of complete signal, consistent with the constraint-system's broader preference for lenient validation over hard failures.

Notably, none of the code files available for this analysis (`integrations/system-health-dashboard/src/components/workflow/hooks.ts`, `tests/features/cli-and-rules-gating.test.mjs`, `usePolledFetch.ts`, `hooks-api.js`, `claude-bridge.js`) reference `content-validation-agent.ts` or its constituent patterns/classes — reinforcing that this component lives in a distinct subsystem (semantic-analysis) from the hook-management/feature-gating code surfaced alongside it.

## Usage Guidelines

Developers authoring entity observations that describe code should be aware that validation accuracy hinges entirely on phrasing recognized by `filePathPatterns`/`commandPatterns`; unconventional formatting (unusual code-span styles, complex shell invocations with flags) may cause references to silently escape staleness checks. Because the agent produces reports rather than blocking actions, it should not be relied upon as a gating mechanism — unlike hook-based enforcement components, a stale or incomplete ContentValidationAgent report degrades knowledge-base trustworthiness gradually rather than failing loudly.

Given its likely batch/offline cadence, it should not be expected to run per-tool-call like `UnifiedHookManager` or `HookConfigLoader`; teams should verify how and when it's actually invoked (scheduled job vs. manual trigger) before assuming its reports reflect current repository state. Finally, given that this document is built without direct inspection of `content-validation-agent.ts`, any work modifying or extending the agent should begin with a direct read of that file to confirm the exact regex definitions, correlation algorithm, and persistence behavior before proceeding.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem provides constraint monitoring and enforcement across Claude Code sessions through a layered hook architecture. At its core is a unified hook management system (lib/agent-api/hooks/) that loads configuration from user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) sources, merges them with project config taking precedence, and dispatches lifecycle events (startup, shutdown, pre-tool, post-tool, pre-prompt, post-prompt, error) to registered handlers sorted by priority.

Violation capture and persistence is handled by a dedicated service (scripts/violation-capture-service.js) that bridges live session logging with the constraint monitor dashboard, sanitizing sensitive parameters, writing to a JSONL violation log, and maintaining rolling statistics (severity breakdowns, most common violations, per-session averages) capped at 1000 entries. Content validation, a related enforcement concern, is implemented via ContentValidationAgent which parses entity observations/diagrams for file, command, and API references, checks them against the live codebase, and produces staleness/validation reports with git-based correlation via GitStalenessDetector.

The architecture emphasizes agent-agnostic extensibility: hook handlers can be scripts, commands, or modules, scoped to specific agents, and dynamically registered/unregistered at runtime. Configuration validation is lenient (warnings rather than hard failures) to avoid blocking agent execution, while the violation capture layer prioritizes durability and dashboard consumability over strict schema enforcement.

### Siblings
- [UnifiedHookManager](./UnifiedHookManager.md) -- [CGR] UnifiedHookManager (class) in hook-manager.js
- [HookConfigLoader](./HookConfigLoader.md) -- [CGR] HookConfigLoader (class) in hook-config.js
- [ViolationCaptureService](./ViolationCaptureService.md) -- [CGR] ViolationCaptureService (class) in violation-capture-service.js
- [HealthPromptHook](./HealthPromptHook.md) -- checkHealthStatus() fetches from HEALTH_COORDINATOR_URL (default http://localhost:3034)/health/state and never falls back to 'healthy' on error, per SPEC R6 — exceptions and non-OK responses surface as overallStatus: 'unknown'
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- isInjectionEnabled() in knowledge-injection-hook.js reads CODING_KNOWLEDGE_INJECTION from process.env, defaulting to enabled unless explicitly '0'/'false'/'off', scoped per-process for experiment-cell avenue toggling


---

*Generated from 9 observations*
