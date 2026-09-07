# PiSessionStartInjector

**Type:** Detail

resolveTargetFile() refuses to write when PI_CODING_AGENT_DIR is unset or resolves to the user's default ~/.pi/agent directory, to avoid clobbering global config

# PiSessionStartInjector — Technical Insight Document

## What It Is

PiSessionStartInjector is a session-start hook component within the KnowledgeInjectionHooks system responsible for gathering context and safely writing knowledge artifacts at the start of a coding session. Its core logic centers on a `resolveTargetFile()` function that determines where injected knowledge should be persisted, and a retrieval query mechanism that adapts its behavior based on whether it is running interactively or inside an automated experiment cell.

## Architecture and Design

The component follows a **guarded write** pattern: rather than assuming it is safe to modify files, `resolveTargetFile()` actively checks environment state (`PI_CODING_AGENT_DIR`) and refuses to proceed under conditions that could cause harm — specifically when the variable is unset or points to the user's default `~/.pi/agent` directory. This is a defensive design decision that prioritizes avoiding accidental clobbering of global configuration over maximizing convenience.

A second architectural decision is the choice of write target: instead of writing to a project's version-controlled `AGENTS.md`/`CLAUDE.md`, the injector writes to `join(cfgDir, 'AGENTS.md')` under the configured agent directory. This isolates injected knowledge from source-controlled files, reflecting a design principle of non-intrusive automation — the system avoids making unannounced edits to files that developers track and review in version control.

The component also branches its query-construction logic based on execution context, mirroring the sibling ExperimentCellTimeoutTuning's approach of detecting experiment cells (via composite task IDs containing `--`). Here, PiSessionStartInjector uses `CODING_EXPERIMENT_GOAL` as the query when present, falling back to a generic `'project context for {project}'` query in interactive sessions. This is a context-adaptive strategy rather than a one-size-fits-all query builder.

## Implementation Details

Three mechanisms stand out:

1. **Target resolution guard** — `resolveTargetFile()` inspects `PI_CODING_AGENT_DIR`; if unset or equal to the default `~/.pi/agent`, the function refuses to write, effectively short-circuiting the injection to prevent global-state mutation.
2. **Config-scoped output path** — writes are always directed to `AGENTS.md` inside the resolved config directory (`cfgDir`), never the project root's own documentation files.
3. **Context-sensitive query construction** — the retrieval query string is chosen conditionally: `CODING_EXPERIMENT_GOAL` for experiment cells, or a templated fallback (`project context for {project}`) otherwise.
4. **Best-effort git integration** — recent file context is gathered via `git diff --name-only HEAD~3`, executed defensively so that any failure (e.g., git unavailable, not a repo, insufficient history) is silently skipped rather than raising an error.

## Integration Points

PiSessionStartInjector is a child/member of **KnowledgeInjectionHooks**, whose gating behavior is controlled by `isInjectionEnabled()` in `knowledge-injection-hook.js`. That parent function reads `process.env.CODING_KNOWLEDGE_INJECTION`, disabling injection only on explicit `'0'`/`'false'`/`'off'` values and defaulting to enabled otherwise — meaning PiSessionStartInjector runs by default unless explicitly turned off upstream.

It shares this environment-driven enablement logic with its sibling **InjectionEnabledToggle**, which implements the same enabled-by-default semantics. It is also conceptually related to **ExperimentCellTimeoutTuning**, which detects experiment-cell execution via `IS_EXPERIMENT_CELL` (a regex test for `--` in `CODING_EXPERIMENT_TASK_ID`) — the same experiment-cell context that determines whether PiSessionStartInjector uses `CODING_EXPERIMENT_GOAL` instead of the generic query.

Beyond the hook family, the component integrates with the local git environment (via shell-out to `git diff`) and the filesystem (via `PI_CODING_AGENT_DIR`-relative paths), making it dependent on both environment variables and the ambient execution context (interactive vs. experiment cell).

## Usage Guidelines

Developers relying on this injector should ensure `PI_CODING_AGENT_DIR` is explicitly set to a non-default path if they want injected knowledge to actually be written — otherwise, the write is silently skipped as a safety measure. Because output always lands in a config-directory `AGENTS.md` rather than the project's own docs, developers should not expect automatic updates to version-controlled documentation; any promotion of injected content into project files must be a separate, explicit action. When running inside experiment cells, setting `CODING_EXPERIMENT_GOAL` will directly shape the retrieval query, so callers orchestrating experiments should populate this variable meaningfully. Finally, since git-based recent-file gathering fails silently, absence of git or shallow history will not break the injector but will simply omit that context — this should be understood as a soft dependency, not a hard requirement.


## Hierarchy Context

### Parent
- [KnowledgeInjectionHooks](./KnowledgeInjectionHooks.md) -- knowledge-injection-hook.js's isInjectionEnabled() reads process.env.CODING_KNOWLEDGE_INJECTION and treats only '0'/'false'/'off' (case-insensitive) as disabling, defaulting to enabled for unset values.

### Siblings
- [InjectionEnabledToggle](./InjectionEnabledToggle.md) -- isInjectionEnabled() reads process.env.CODING_KNOWLEDGE_INJECTION and returns true when raw == null, defaulting to enabled
- [ExperimentCellTimeoutTuning](./ExperimentCellTimeoutTuning.md) -- IS_EXPERIMENT_CELL is derived from /--/.test(process.env.CODING_EXPERIMENT_TASK_ID || ''), i.e. a composite task id containing '--'


---

*Generated from 4 observations*
