# HealthPromptHook

**Type:** SubComponent

outputEnvelope() always emits the fixed shape `{hookSpecificOutput:{hookEventName:'UserPromptSubmit', additionalContext}}` even in the catch block of main(), preserving the SPEC R8 contract under fatal errors.

# HealthPromptHook — Technical Insight Document

## What It Is

HealthPromptHook is a UserPromptSubmit hook within the ConstraintSystem responsible for surfacing service health status as contextual information injected into Claude's prompt pipeline. Its core logic centers on `checkHealthStatus()`, `deriveSummary()`, and `outputEnvelope()`, orchestrated by a `main()` entry point. Rather than performing arbitrary health probing, it applies a set of deliberately conservative heuristics and fail-safe behaviors so that health-reporting failures never disrupt the broader constraint-enforcement and prompt-handling flow that the ConstraintSystem provides.

![HealthPromptHook — Architecture](images/health-prompt-hook-architecture.png)

## Architecture and Design

The design follows a defensive, "never block the caller" philosophy consistent with hook-style architecture generally seen across sibling components like HookManager and HookConfigLoader. Where HookConfigLoader logs warnings instead of throwing on malformed config, and KnowledgeInjectionHooks defaults to enabled unless explicitly disabled, HealthPromptHook similarly biases toward safe defaults and non-fatal failure paths — but inverts the "default to healthy" instinct specifically to avoid a fail-safe-to-healthy bug (SPEC R6). Any coordinator fetch failure — non-OK HTTP response or thrown exception — is explicitly mapped to `overallStatus:'unknown'`, a conscious design decision that treats ambiguity as a distinct, honest state rather than collapsing it into a false-positive "healthy" reading.

A second architectural safeguard is environment detection: `checkHealthStatus()` uses `existsSync(VERIFIER_SCRIPT)` as a heuristic proxy for "are we inside the coding repo," short-circuiting to `servicesAvailable:false` without attempting a network call when outside that context (the "Q3 carve-out"). This avoids wasted network I/O and false errors in environments where health services are known not to exist.

## Implementation Details

`checkHealthStatus()` gates all downstream logic on the filesystem heuristic described above, ensuring the hook behaves correctly both inside and outside a coding repository context without requiring explicit configuration.

`deriveSummary()` implements status normalization via an `OK_SERVICE_STATUSES` set that includes `'busy'` as an acceptable, non-alarming state. This distinguishes services that are alive-but-loaded from services that are genuinely stopped, preventing false "service stopped" alarms from noisy or transient busy states.

`outputEnvelope()` guarantees a fixed output contract: `{hookSpecificOutput:{hookEventName:'UserPromptSubmit', additionalContext}}`. Critically, this same shape is emitted even from the `catch` block of `main()`, so the SPEC R8 output contract holds under both success and fatal-error conditions — callers never need to special-case the hook's failure mode.

Finally, `main()` unconditionally calls `process.exit(0)`, regardless of whether health checks succeeded, failed, or threw. This is a hard requirement: the hook must never block or fail the Claude session, reflecting its role as an advisory, best-effort signal rather than a gating mechanism.

![HealthPromptHook — Relationship](images/health-prompt-hook-relationship.png)

## Integration Points

HealthPromptHook is a child of ConstraintSystem, operating within the same unified hook dispatch model that UnifiedHookManager coordinates — events like pre-prompt/post-prompt are routed to registered handlers, of which this hook represents one instance for the `UserPromptSubmit` event. While the observations don't detail direct calls between HealthPromptHook and HookManager, HookConfigLoader, or ViolationCaptureService, it shares the ConstraintSystem's general design ethos: non-throwing failure paths, explicit precedence/defaulting rules, and structured output contracts (paralleling how ViolationCaptureService maintains structured JSONL/aggregate outputs). Its output envelope is the primary integration surface, consumed by whatever orchestrates `UserPromptSubmit` hook results.

## Usage Guidelines

Developers extending or modifying HealthPromptHook should preserve its three core invariants: (1) never assume network/service availability when outside the coding repo — respect the `VERIFIER_SCRIPT` existence check; (2) never map unknown/failed states to "healthy" — an ambiguous or failed check must resolve to `'unknown'`, not a false positive; and (3) never allow the hook to throw uncaught or exit with a non-zero code — all paths, including the catch block, must produce the standard envelope shape and terminate via `process.exit(0)`. When adding new service status values, extend `OK_SERVICE_STATUSES` deliberately, since it directly governs which live states are surfaced as acceptable versus alarming.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem provides rule-based validation and enforcement of code actions and file operations during Claude Code sessions, spanning hook configuration loading, hook dispatch orchestration, and violation capture/persistence. It is built around a unified hook architecture that merges user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) configurations, with project config taking precedence, and dispatches events (pre-tool, post-tool, pre-prompt, post-prompt, startup, shutdown, error) to registered handlers of type script, command, or module.

Core orchestration lives in UnifiedHookManager (lib/agent-api/hooks/hook-manager.js), which maintains a Map of event names to sorted handler arrays (by priority), supports duplicate-ID overwrite semantics, and exposes registerHandler/unregisterHandler APIs bridging agent-native hook systems to a common HookEvent enum. Configuration parsing and structural validation is handled separately by HookConfigLoader (lib/agent-api/hooks/hook-config.js), which loads, merges, and validates settings/hooks blocks, logging warnings (not throwing) on malformed entries.

Violation detection results are captured and persisted via ViolationCaptureService (scripts/violation-capture-service.js), which writes JSONL violation records to .mcp-sync/session-violations.jsonl and maintains an aggregated violation-history.json with session tracking and computed statistics (severity breakdowns, most common constraint, average violations per session) for dashboard consumption. Sensitive parameter values are redacted before being written to logs, and history is capped at 1000 entries to bound file growth.

### Siblings
- [HookManager](./HookManager.md) -- UnifiedHookManager.initialize(projectPath) loads user config first via loadConfig(userConfigPath, 'user') then project config via loadConfig(projectConfigPath, 'project'), giving project-level entries precedence through later overwrite.
- [HookConfigLoader](./HookConfigLoader.md) -- loadConfig() in hook-manager.js applies config.settings.enableLogging, stopOnError, and timeout only when explicitly defined in the file (`!== undefined` checks), preserving constructor defaults otherwise.
- [ViolationCaptureService](./ViolationCaptureService.md) -- Per architecture description, ViolationCaptureService writes JSONL violation records to .mcp-sync/session-violations.jsonl, separating an append-only raw log from a computed aggregate file.
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- knowledge-injection-hook.js's isInjectionEnabled() reads process.env.CODING_KNOWLEDGE_INJECTION and treats only '0'/'false'/'off' (case-insensitive) as disabling, defaulting to enabled for unset values.


---

*Generated from 5 observations*
