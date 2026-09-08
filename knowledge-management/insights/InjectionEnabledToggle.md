# InjectionEnabledToggle

**Type:** Detail

Comment ties this to Phase 87 AVN-04: the runner maps an avenue's `env: kb-off` declaration to CODING_KNOWLEDGE_INJECTION=0 in the spawned agent's child env, scoping the disable to that process only

# InjectionEnabledToggle — Technical Insight Document

## What It Is

InjectionEnabledToggle is a gating mechanism implemented via the `isInjectionEnabled()` function within `knowledge-injection-hook.js`, part of the broader **KnowledgeInjectionHooks** system. It reads a single environment variable, `process.env.CODING_KNOWLEDGE_INJECTION`, and determines whether the knowledge injection hook should proceed with its work or exit early. The function's default posture is permissive: when the raw environment value is `null` (unset), injection is enabled.

## Architecture and Design

The design follows a classic **fail-open feature flag pattern**: absence of configuration means the feature is active, and only explicit opt-out values disable it. This is evident in the parsing logic, which normalizes the raw environment value via `String(raw).trim().toLowerCase()` and disables injection only for `'0'`, `'false'`, or `'off'`. Any other value — including malformed or unexpected strings — keeps injection enabled, favoring safety-by-default (i.e., knowledge injection continues unless deliberately silenced) over strict validation.

Architecturally, the toggle is positioned as an **early-exit guard** at the very top of `main()` in `knowledge-injection-hook.js`. This is a short-circuit design: `main()` calls `isInjectionEnabled()` as its first action, and if disabled, returns immediately — before stdin is read, before retrieval logic executes, and before `additionalContext` is produced. This avoids wasted I/O and computation and cleanly separates the "should I run" decision from the "how do I run" logic.

## Implementation Details

The core implementation is a single boolean-returning function, `isInjectionEnabled()`, with straightforward branching logic:
1. Read `process.env.CODING_KNOWLEDGE_INJECTION` into `raw`.
2. If `raw == null`, return `true` (enabled by default).
3. Otherwise, normalize via `String(raw).trim().toLowerCase()` and compare against the disable set `{'0', 'false', 'off'}`.
4. Return `false` only on a match; otherwise return `true`.

This normalization step is notable for its defensiveness — it tolerates whitespace and case variation in the environment variable, which matters since env vars are often set by external orchestration layers (shell scripts, spawners) that may not guarantee exact casing or trimming.

The consuming code path in `main()` treats the boolean as a hard gate: a `false` result triggers an early `return`, skipping stdin consumption and any retrieval/context-building work entirely. This makes the toggle's effect binary and total — there's no partial-injection mode.

## Integration Points

InjectionEnabledToggle is explicitly tied to **Phase 87 AVN-04**, where a runner component maps an avenue's `env: kb-off` declaration into a `CODING_KNOWLEDGE_INJECTION=0` entry in the *child environment* of a spawned agent process. This integration is significant: it means the disable behavior is **process-scoped**, not global — only the specific spawned agent process inherits the disabling env var, leaving other concurrent or parent processes unaffected. This confines the blast radius of the `kb-off` declaration to exactly the intended avenue/agent run.

Within its parent, **KnowledgeInjectionHooks**, this toggle sits alongside sibling components that follow a similar environment-variable-driven configuration philosophy: **ExperimentCellTimeoutTuning** derives `IS_EXPERIMENT_CELL` from a regex test (`/--/.test(...)`) against `CODING_EXPERIMENT_TASK_ID`, and **PiSessionStartInjector** uses `PI_CODING_AGENT_DIR` presence/value to guard against unsafe writes. All three siblings share a pattern of using process environment state as the primary signal for behavioral branching, though each applies different validation strictness (regex matching, exact directory comparison, vs. this toggle's normalized string-set matching).

## Usage Guidelines

Developers and orchestration tooling should treat `CODING_KNOWLEDGE_INJECTION=0` (or `false`/`off`, any case, with surrounding whitespace tolerated) as the canonical way to disable injection for a specific process. Because the check happens before stdin is read, disabling injection is cheap and side-effect-free — no partial state is created downstream. When integrating with runners or spawners (as in the AVN-04 `kb-off` mapping), set the environment variable only in the child process's env to preserve the intended process-scoped isolation rather than mutating a shared/global environment. Avoid relying on any value other than the three recognized disable strings to turn off injection — anything else (including `""`, `"no"`, or `"disabled"`) will be treated as enabled, since the design intentionally fails open.


## Hierarchy Context

### Parent
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- knowledge-injection-hook.js's isInjectionEnabled() reads process.env.CODING_KNOWLEDGE_INJECTION and treats only '0'/'false'/'off' (case-insensitive) as disabling, defaulting to enabled for unset values.

### Siblings
- [ExperimentCellTimeoutTuning](./ExperimentCellTimeoutTuning.md) -- IS_EXPERIMENT_CELL is derived from /--/.test(process.env.CODING_EXPERIMENT_TASK_ID || ''), i.e. a composite task id containing '--'
- [PiSessionStartInjector](./PiSessionStartInjector.md) -- resolveTargetFile() refuses to write when PI_CODING_AGENT_DIR is unset or resolves to the user's default ~/.pi/agent directory, to avoid clobbering global config


---

*Generated from 4 observations*
