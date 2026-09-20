# InjectionEnabledToggle

**Type:** Detail

# InjectionEnabledToggle: Technical Insight Document

## What It Is

InjectionEnabledToggle is the environment-variable-driven feature gate implemented via `isInjectionEnabled()` in `knowledge-injection-hook.js`. It reads `CODING_KNOWLEDGE_INJECTION` from `process.env` and applies a "default-on, explicit-off" semantic: the feature is enabled unless the variable is explicitly set to `'0'`, `'false'`, or `'off'`. As a child of the **KnowledgeInjectionHooks** component, this toggle is the specific mechanism that determines whether the broader knowledge injection hook machinery executes at all for a given process invocation.

Unlike persistent, file-based configuration systems elsewhere in the codebase, this toggle is scoped per-process, meaning its value is fixed at process startup and cannot be reconfigured at runtime — a trait it shares directly with its sibling, **ExperimentCellTimeoutProfile**.

## Architecture and Design

The toggle follows a "safe defaults over opt-in gating" philosophy that recurs structurally elsewhere in the codebase, notably in the CLI feature-gating system tested in `tests/features/cli-and-rules-gating.test.mjs`, where `features.yaml` governs whether commands like `bin/graphify` execute (returning exit code 2 when disabled). Both systems favor default-enabled behavior, but they diverge in configuration surface: the CLI gating system centralizes control in a shared YAML catalogue (`lib/features/catalogue.cjs`), while InjectionEnabledToggle uses an isolated environment variable, suggesting it's designed for lightweight, per-invocation experiment control rather than durable user-facing configuration.

This environment-variable-only configuration approach extends to the toggle's sibling, ExperimentCellTimeoutProfile, which detects `IS_EXPERIMENT_CELL` via the presence of `'--'` in `CODING_EXPERIMENT_TASK_ID` to double `SAFETY_TIMEOUT_MS` and `RETRIEVE_TIMEOUT_MS`. Together these form a broader experiment-harness convention: environment variables encode both feature flags and execution-mode context (batch vs. interactive), allowing the same hook codebase to alter behavior without embedding branching logic in its core implementation. Configuration lives entirely in `process.env` rather than being passed as parameters, which simplifies testing via subprocess isolation but forecloses any runtime reconfiguration path.

## Implementation Details

The toggle's core logic is a string-comparison guard against a small set of falsy tokens (`'0'`, `'false'`, `'off'`), inverted to produce default-true behavior. This is deliberately simple — no parsing library, no schema validation — consistent with the lightweight, per-process design goal.

Notably, no direct code graph edges connect InjectionEnabledToggle to `lib/agent-api/hooks-api.js`'s `HooksManager`/`triggerHook()`. If `knowledge-injection-hook.js` is registered as a handler via `HooksManager.registerHook()`, the toggle's check would execute inside `triggerHook()`'s per-hook try/catch block, meaning the manager already provides a fail-open safety net at a higher level. This raises the possibility that the hook's own internal fail-open logic is partially redundant with the manager's error handling — unless the hook operates outside this unified system, e.g., as a standalone bridge script analogous to `lib/agent-api/hooks/claude-bridge.js`.

## Integration Points

The toggle sits within the fail-open error handling philosophy pervasive across the hook infrastructure: `claude-bridge.js`'s `main()` function constructs an `errorResponse` with `decision: 'allow'` and calls `process.exit(0)` on any error "to not block Claude." This same defensive pattern is echoed in knowledge-injection hooks' catch-all error handling (exit 0), reinforcing that hooks are advisory/enrichment mechanisms, not gatekeepers.

Structurally, no code files in the provided graph slice (`hooks.ts`, `usePolledFetch.ts`, `hooks-api.js`, `claude-bridge.js`, `cli-and-rules-gating.test.mjs`) directly reference `knowledge-injection-hook.js` or its functions (`isInjectionEnabled`, `extractConversationTopics`, `resolveTargetFile`). The relationships described here — to `HooksManager`, to `EVENT_MAPPINGS`, to the CLI gating tests — are architectural analogies rather than verified call-graph couplings. Developers should treat these as conceptual parallels for reasoning about design intent, not confirmed dependencies.

## Usage Guidelines

Because the toggle is process-scoped, testing different states (enabled/disabled) requires subprocess-level isolation rather than in-process mocking — mirroring the approach implied by `tests/features/cli-and-rules-gating.test.mjs` for the analogous CLI feature-gating system. When disabling the feature, use one of the recognized falsy tokens (`'0'`, `'false'`, `'off'`); any other value, including an empty string in unexpected contexts, will be treated as enabled given the default-on design.

Developers extending or debugging the knowledge injection system should verify whether `knowledge-injection-hook.js` is invoked through `HooksManager.triggerHook()` or as a standalone script, since this affects whether the hook's internal fail-open behavior is necessary or redundant. Given the broader system convention of environment-variable-driven behavior (shared with ExperimentCellTimeoutProfile's `IS_EXPERIMENT_CELL`/timeout doubling and `resolveTargetFile()`'s `PI_CODING_AGENT_DIR` safety gate), any new configuration for this hook family should likely follow the same pattern rather than introducing structured config objects, to preserve consistency with the rest of KnowledgeInjectionHooks.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- No direct code graph edges were provided connecting InjectionEnabledToggle to the shown files, so the relationship between isInjectionEnabled() and lib/agent-api/hooks-api.js's HooksManager/triggerHook() is inferred rather than structurally confirmed. If knowledge-injection-hook.js is registered as a handler via HooksManager.registerHook(), its toggle would execute inside triggerHook()'s per-hook try/catch block (hooks-api.js), which independently already provides fail-open behavior at the manager level — meaning the hook's own internal fail-open logic could be partially redundant with the manager's error handling, unless the hook is invoked outside this unified system (e.g., as a standalone bridge script).


## Hierarchy Context

### Parent
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- isInjectionEnabled() in knowledge-injection-hook.js reads CODING_KNOWLEDGE_INJECTION from process.env, defaulting to enabled unless explicitly '0'/'false'/'off', scoped per-process for experiment-cell avenue toggling

### Siblings
- [ExperimentCellTimeoutProfile](./ExperimentCellTimeoutProfile.md) -- [LLM] The parent context describes an ExperimentCellTimeoutProfile behavior where IS_EXPERIMENT_CELL detection (via '--' presence in CODING_EXPERIMENT_TASK_ID) doubles SAFETY_TIMEOUT_MS and RETRIEVE_TIMEOUT_MS for batch runs. This is a config-driven feature-flag pattern similar to isInjectionEnabled() in knowledge-injection-hook.js, which also reads an environment variable (CODING_KNOWLEDGE_INJECTION) with a default-enabled/opt-out semantics. Both mechanisms rely on process.env as the sole configuration surface, meaning behavior is entirely determined at process startup with no runtime reconfiguration path, which simplifies testing (as seen in tests/features/cli-and-rules-gating.test.mjs) but requires subprocess-level isolation to validate different flag states.


---

*Generated from 10 observations*
