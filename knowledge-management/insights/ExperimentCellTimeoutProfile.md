# ExperimentCellTimeoutProfile

**Type:** Detail

# ExperimentCellTimeoutProfile: Technical Insight Document

## What It Is

ExperimentCellTimeoutProfile is a configuration-driven behavior embedded within the knowledge injection hook infrastructure (`knowledge-injection-hook.js`), living as a child concern of its parent component, KnowledgeInjectionHooks. Its core function is straightforward: when `IS_EXPERIMENT_CELL` is detected — via the presence of `--` in the `CODING_EXPERIMENT_TASK_ID` environment variable — `SAFETY_TIMEOUT_MS` and `RETRIEVE_TIMEOUT_MS` are doubled for batch experiment runs. This mechanism exists to give automated batch/experiment execution contexts more generous timing tolerances than interactive sessions receive by default.

## Architecture and Design

The defining architectural trait of this profile is that it is entirely `process.env`-driven, with no runtime override mechanism. Like its sibling InjectionEnabledToggle (which governs `isInjectionEnabled()` via `CODING_KNOWLEDGE_INJECTION`), the timeout profile treats environment variables as the sole configuration surface, meaning behavior is fixed at process startup. This is a deliberate simplification: it enables straightforward testing via subprocess isolation (as exercised in `tests/features/cli-and-rules-gating.test.mjs`) at the cost of any dynamic reconfiguration capability.

This entity also exemplifies a broader system convention of **context-aware timing** — adjusting temporal parameters based on runtime environment rather than hardcoding constants. A structurally analogous pattern appears in `usePolledFetch` (`integrations/system-health-dashboard/src/hooks/usePolledFetch.ts`), which scales polling behavior based on `document.hidden` state. Both treat "context" (batch vs. interactive, visible vs. hidden) as a first-class input to timing decisions.

Critically, the profile embodies the codebase's **fail-open philosophy**: when experiment context cannot be determined, the system defaults to the non-doubled, interactive timeout path rather than erroring or blocking. This mirrors the fail-open catch block in `lib/agent-api/hooks/claude-bridge.js:main()`, which returns an `allow` decision and exits 0 on any error, and the `if (!features) return true;` guard in `scripts/health-coordinator.js` that lets health checks proceed when feature config is unresolvable. Across the hooks subsystem, infrastructure failures are designed to never block the primary agent workflow.

## Implementation Details

The detection heuristic is syntactic rather than semantic: `IS_EXPERIMENT_CELL` is inferred from string structure (presence of `--` in `CODING_EXPERIMENT_TASK_ID`) rather than an explicit boolean environment variable. This is a recognizable trade-off pattern in the codebase — deriving meaning from string structure instead of adding a dedicated configuration surface — comparable to how `extractConversationTopics()` derives scope from byte-offset slicing (`TRANSCRIPT_TAIL_BYTES`) rather than structured message boundaries. The upside is one fewer configuration knob to document and maintain; the downside is fragility — any change to task ID naming conventions silently breaks the timeout-doubling logic without raising an error.

Once `IS_EXPERIMENT_CELL` is established, the doubling logic simply multiplies `SAFETY_TIMEOUT_MS` and `RETRIEVE_TIMEOUT_MS` by two for the batch execution path. There is no intermediate scaling factor or tiered configuration — it is a binary doubling applied uniformly.

## Integration Points

ExperimentCellTimeoutProfile is nested inside KnowledgeInjectionHooks, sharing its module (`knowledge-injection-hook.js`) with the sibling InjectionEnabledToggle, which governs whether injection runs at all via `isInjectionEnabled()`. Both toggles are scoped per-process via environment variables, distinguishing them from the shared-YAML-driven CLI feature gating (`features.yaml`) tested in `cli-and-rules-gating.test.mjs`, which governs commands like `bin/graphify`. This suggests a layered configuration philosophy: lightweight, per-invocation experiment control (env vars) for hook-level behaviors versus persistent, shared configuration (YAML) for CLI-level feature gating.

The fail-open pattern connecting this entity to the rest of the system is corroborated by `lib/agent-api/hooks-api.js:HooksManager.triggerHook`, which catches per-hook errors without halting execution of remaining hooks — reinforcing that timeout/config resolution failures anywhere in the hooks pipeline should degrade gracefully rather than cascade.

## Usage Guidelines

Developers modifying `CODING_EXPERIMENT_TASK_ID` naming conventions must be aware that the `--` heuristic is the sole trigger for timeout doubling; any change to task ID formats should be cross-checked against this detection logic to avoid silently disabling the doubled-timeout path for batch runs. Because configuration is resolved once at process startup, testing different timeout profiles requires spawning subprocesses with distinct environment variable sets rather than mutating state at runtime — consistent with the testing approach already used for `isInjectionEnabled()` and `health-coordinator.js` feature checks. Finally, when extending this profile, maintain the existing fail-open default (interactive/non-doubled timeout) for undetectable experiment context, preserving consistency with the rest of the hooks subsystem's error-handling philosophy.


## Hierarchy Context

### Parent
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- isInjectionEnabled() in knowledge-injection-hook.js reads CODING_KNOWLEDGE_INJECTION from process.env, defaulting to enabled unless explicitly '0'/'false'/'off', scoped per-process for experiment-cell avenue toggling

### Siblings
- [InjectionEnabledToggle](./InjectionEnabledToggle.md) -- [LLM] The parent context describes isInjectionEnabled() in knowledge-injection-hook.js as an env-var driven feature toggle (CODING_KNOWLEDGE_INJECTION) that defaults to enabled unless explicitly disabled with '0'/'false'/'off'. This is the same 'default-on, explicit-off' pattern seen structurally in the CLI feature gating tested in tests/features/cli-and-rules-gating.test.mjs, where features.yaml controls whether commands like bin/graphify run at all (exit code 2 when off). Both systems favor safe defaults over opt-in gating, though the knowledge injection toggle is scoped per-process via environment variables rather than a shared YAML config file, suggesting it's meant for lightweight, per-invocation experiment control rather than persistent user configuration.


---

*Generated from 9 observations*
