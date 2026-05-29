# GitHistoryStalenessSignal

**Type:** Detail

Described in the ContentValidationAgent sub-component context as comparing recorded entity observations against recent commits to flag observations that predate significant file changes, per docs/constraints/README.md and docs/constraints/constraint-monitoring-system.md documentation context.

# GitHistoryStalenessSignal — Technical Reference

## What It Is

`GitHistoryStalenessSignal` is a staleness detection component implemented in `git_history_staleness_signal.py`, operating as a sub-component of `ContentValidationAgent`. Its singular responsibility is to determine whether a stored knowledge observation about a codebase entity has been rendered potentially outdated by subsequent changes to the files that entity is associated with.

The mechanism is straightforward: it compares the timestamp of a recorded observation against the latest commit timestamp for the relevant file paths. If meaningful code changes have occurred in tracked files *after* an observation was recorded, the signal flags that observation as stale. This is documented in `docs/constraints/README.md` and `docs/constraints/constraint-monitoring-system.md`, situating it firmly within the broader ConstraintSystem infrastructure.

---

## Architecture and Design

The design follows a **signal-based validation pattern**: rather than invalidating observations directly, `GitHistoryStalenessSignal` produces a flag or signal that something *may* be wrong, deferring the decision about what to do with stale knowledge to higher-level components. This is a deliberate separation of concerns — detection is decoupled from remediation.

Within the `ContentValidationAgent`, this component acts as one lens through which recorded entity observations are evaluated. The parent `ContentValidationAgent` uses git history as a staleness signal broadly, and `GitHistoryStalenessSignal` is the concrete implementation of that strategy. This suggests the `ContentValidationAgent` may aggregate multiple validation signals, with git history being one dimension of content validity alongside potentially other sibling signals.

The use of raw `git log` output (rather than a higher-level VCS abstraction) is a pragmatic design choice that keeps the implementation dependency-light — it requires only a standard git installation rather than any third-party library. The trade-off is that it couples the component to git as the version control system and to the shell execution environment.

---

## Implementation Details

The core mechanics in `git_history_staleness_signal.py` revolve around a `git log --format=%ct` invocation against observed file paths. The `%ct` format specifier extracts the **committer timestamp as a Unix epoch integer**, which is the most reliable format for programmatic timestamp comparison — it avoids locale and timezone parsing issues entirely.

The logical flow is:
1. Accept an observed file path and the stored observation timestamp.
2. Execute `git log --format=%ct` on that path to retrieve the latest commit timestamp.
3. Compare the latest commit timestamp against the observation timestamp.
4. If the commit timestamp is newer, emit a staleness flag for the associated knowledge node.

A key implicit assumption is that `git log` is scoped to the most recent commit (`HEAD` or similar), returning the single latest `%ct` value. This means the signal is binary — the observation is either stale relative to the latest change or it isn't — rather than providing a graduated measure of how many changes have occurred since the observation was recorded.

---

## Integration Points

`GitHistoryStalenessSignal` is contained within and driven by `ContentValidationAgent`, which provides it with the observations to evaluate — specifically the file paths and timestamps stored as part of entity observation records. The ConstraintSystem (documented in `docs/constraints/constraint-monitoring-system.md`) is the broader operational context; this signal feeds into constraint monitoring workflows that track whether the system's knowledge remains valid as codebases evolve.

The component has a hard dependency on a local git repository being present and accessible at the path context in which it executes. There is an implicit dependency on the file paths stored in observations being repository-relative or absolute paths resolvable within the git working tree.

---

## Usage Guidelines

**File path accuracy is critical.** The signal is only as reliable as the file paths stored in observations. If an observation records a path that has been renamed or deleted, `git log` will return no output, and the comparison will be undefined — implementations should handle empty output from `git log` defensively, treating it as a signal of potential staleness or path invalidity rather than freshness.

**Timestamp granularity.** Because `%ct` is second-level Unix time, observations recorded and commits made within the same second could produce false negatives. In practice this is unlikely but worth noting for high-frequency automated environments.

**Scope of "meaningful change."** The current design treats *any* commit touching a file as a staleness trigger. It does not distinguish between a comment typo fix and a structural refactor. Teams relying on this signal should understand that it is conservative — it will over-flag rather than under-flag staleness. This is the correct default for a constraint-monitoring system where false negatives (missing real staleness) are more dangerous than false positives.

**Consulting the constraint documentation.** `docs/constraints/README.md` and `docs/constraints/constraint-monitoring-system.md` are the authoritative references for how this signal fits into the broader constraint lifecycle — developers extending or modifying this component should consult those documents to understand how staleness flags are consumed downstream.


## Hierarchy Context

### Parent
- [ContentValidationAgent](./ContentValidationAgent.md) -- ContentValidationAgent uses git history as a staleness signal, comparing recorded entity observations against recent commits to flag observations that predate significant file changes


---

*Generated from 3 observations*
