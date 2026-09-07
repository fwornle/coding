# ExperimentCellTimeoutTuning

**Type:** Detail

IS_EXPERIMENT_CELL is derived from /--/.test(process.env.CODING_EXPERIMENT_TASK_ID || ''), i.e. a composite task id containing '--'

# ExperimentCellTimeoutTuning

## What It Is

ExperimentCellTimeoutTuning is a configuration-detection mechanism within the KnowledgeInjectionHooks system that adjusts timeout thresholds based on execution context. It hinges on a boolean flag, `IS_EXPERIMENT_CELL`, derived by testing `process.env.CODING_EXPERIMENT_TASK_ID` against the regular expression `/--/`. When the task ID contains a double-hyphen delimiter — indicating a composite experiment cell task identifier — the system recognizes it is running in an experiment cell context rather than an interactive session, and adjusts its timeout behavior accordingly.

## Architecture and Design

The core architectural pattern here is **environment-driven behavioral branching**: a single environment variable inspection (`CODING_EXPERIMENT_TASK_ID`) drives a binary mode switch that cascades into different timeout constants throughout the injection hook logic. This mirrors the pattern used by sibling component InjectionEnabledToggle, which similarly derives behavior from an environment variable (`CODING_KNOWLEDGE_INJECTION`), reinforcing a broader convention within KnowledgeInjectionHooks of using environment state as the primary configuration surface rather than explicit parameters or config files.

The design applies two tiers of timeout constants: `SAFETY_TIMEOUT_MS`/`RETRIEVE_TIMEOUT_MS` set to 15000/12000 milliseconds for experiment cells, versus 5000/4500 milliseconds for standard interactive sessions. This reflects a deliberate trade-off — experiment cells, which likely involve heavier or less predictable workloads, are granted substantially more time (3x) before timeout logic engages, while interactive sessions prioritize responsiveness with tighter thresholds.

Layered atop this tiered timeout system is a **fail-open safety ceiling**: a `safetyTimer` that unconditionally calls `process.exit(0)` regardless of which mode (experiment cell or interactive) is active. This is an architectural safeguard ensuring that no matter how the tiered timeouts are configured or misconfigured, the process cannot hang indefinitely — it will always terminate cleanly, treating timeout as a benign event rather than an error condition.

## Implementation Details

The detection logic itself is minimal and regex-based: `IS_EXPERIMENT_CELL = /--/.test(process.env.CODING_EXPERIMENT_TASK_ID || '')`. The fallback to an empty string guards against undefined environment variables, ensuring the regex test never throws and defaults safely to `false` (interactive/non-experiment mode) when the task ID is absent.

Once `IS_EXPERIMENT_CELL` is resolved, it acts as a selector for the two constant pairs (`SAFETY_TIMEOUT_MS`, `RETRIEVE_TIMEOUT_MS`), presumably via a conditional assignment at module load time. These constants then govern how long the system waits before considering an operation (likely a knowledge retrieval or injection call) as stalled.

The `safetyTimer` is implemented independently of the mode-specific timeout values — it acts as an absolute ceiling timer that fires `process.exit(0)` regardless of whether the experiment cell's longer 15000/12000ms budget or the interactive session's shorter 5000/4500ms budget was in effect. This decouples the "soft" tiered timeout logic from the "hard" process-termination guarantee.

## Integration Points

This entity is a child concept under KnowledgeInjectionHooks, and its environment-variable-driven approach parallels the parent's own `isInjectionEnabled()` logic in knowledge-injection-hook.js, which reads `process.env.CODING_KNOWLEDGE_INJECTION`. Both mechanisms share the design philosophy of defaulting to a permissive/enabled state unless explicit signals indicate otherwise (though ExperimentCellTimeoutTuning defaults to the interactive/non-experiment timeout tier when the env var is absent, rather than defaulting "on").

It is conceptually related to sibling InjectionEnabledToggle (same enablement-check pattern) and PiSessionStartInjector, which likewise reads environment state (`PI_CODING_AGENT_DIR`) to make safety-oriented decisions — in its case, refusing to write config to avoid clobbering the user's default `~/.pi/agent` directory. Across all three components, environment variables serve as the primary integration seam between the injection hook system and its runtime context.

## Usage Guidelines

Developers should recognize that `CODING_EXPERIMENT_TASK_ID` containing a `--` delimiter is the sole signal distinguishing experiment cell execution from interactive sessions — any composite task ID format change must preserve this delimiter convention or the timeout tuning will silently fall back to interactive (shorter) timeouts. When modifying timeout constants, maintain the relative generosity of experiment-cell timeouts (currently 3x longer) since experiment workloads are presumed to need more headroom.

Critically, the `safetyTimer`'s `process.exit(0)` fail-open behavior should be treated as an invariant: it must always fire regardless of which timeout tier is active, and any refactor of the timeout logic should preserve this absolute ceiling to prevent hung processes. Because it exits with code 0, callers/monitoring systems should not interpret this termination as an error signal — it is an intentional, silent safety valve.


## Hierarchy Context

### Parent
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- knowledge-injection-hook.js's isInjectionEnabled() reads process.env.CODING_KNOWLEDGE_INJECTION and treats only '0'/'false'/'off' (case-insensitive) as disabling, defaulting to enabled for unset values.

### Siblings
- [InjectionEnabledToggle](./InjectionEnabledToggle.md) -- isInjectionEnabled() reads process.env.CODING_KNOWLEDGE_INJECTION and returns true when raw == null, defaulting to enabled
- [PiSessionStartInjector](./PiSessionStartInjector.md) -- resolveTargetFile() refuses to write when PI_CODING_AGENT_DIR is unset or resolves to the user's default ~/.pi/agent directory, to avoid clobbering global config


---

*Generated from 3 observations*
