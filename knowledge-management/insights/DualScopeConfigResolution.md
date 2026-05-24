# DualScopeConfigResolution

**Type:** Detail

Because HookConfigLoader reads two physically distinct files, it must implement a merge or precedence strategy to resolve conflicts between user-level and project-level declarations — the resolution order (which scope wins) is a critical behavioral contract for downstream ConstraintSystem consumers.

# DualScopeConfigResolution

## What It Is

DualScopeConfigResolution is the conflict-resolution and precedence behavior implemented within `HookConfigLoader` at `lib/agent-api/hooks/hook-config.js`. It defines how two physically distinct hook configuration files — the user-level file at `~/.coding-tools/hooks.json` and the project-level file at `{project}/.coding/hooks.json` — are reconciled into a single effective configuration that downstream consumers (notably the `ConstraintSystem`) can rely upon.

The "dual scope" terminology refers to the two configuration domains being merged: a **user scope** (machine-wide, per-developer defaults) and a **project scope** (repository-committed, team-shared overrides). The resolution layer exists because these two sources can declare overlapping or conflicting hook policies, and a deterministic precedence contract is required to produce a single authoritative configuration view.

Because `HookConfigLoader` is explicitly designated the *sole entry point* for hook configuration access in the codebase, DualScopeConfigResolution is the only place where this merging logic lives. No other module bypasses it to read either file directly, making this resolution behavior the single source of truth for hook configuration semantics.

## Architecture and Design

The architectural approach is a classic **layered configuration pattern** with two stacked scopes: a broad default layer (user-level) and a narrower override layer (project-level). This mirrors well-established configuration hierarchies seen in tools like Git (`--global` vs. `--local`) or npm (user `.npmrc` vs. project `.npmrc`), where personal preferences provide a baseline and project-specific files refine or override them for collaborative work.

The design embraces a **single-loader gateway pattern**. By centralizing all file access inside `HookConfigLoader`, the system enforces an architectural invariant: every consumer sees the same merged view, computed by the same logic, with the same precedence rules. This prevents the proliferation of inconsistent ad-hoc readers that could each interpret the two files differently. The parent `HookConfigLoader` component encapsulates both the I/O concern (reading two JSON files from distinct filesystem locations) and the semantic concern (resolving conflicts between them).

A key design decision is the *physical separation* of the two configuration files rather than storing them in one merged document. This separation is deliberate:
- The user-level file at `~/.coding-tools/hooks.json` lives in the developer's home directory, intentionally outside any repository, so personal tooling preferences remain private and portable across projects.
- The project-level file at `{project}/.coding/hooks.json` lives inside the repository tree, making it eligible for version control and team-wide distribution.

This separation creates a clean boundary between "what *I* prefer" and "what *the team* requires," which DualScopeConfigResolution then collapses into a single effective policy at load time.

## Implementation Details

The resolution logic is implemented inside `HookConfigLoader` (located at `lib/agent-api/hooks/hook-config.js`). The loader is responsible for:

1. **Locating both files** — the user-level file via the user's home directory (`~/.coding-tools/hooks.json`) and the project-level file via the active project root (`{project}/.coding/hooks.json`).
2. **Reading each file independently** — both files are parsed as JSON. Either may be absent, in which case its layer contributes nothing to the merge.
3. **Applying a precedence strategy** — when the two files declare overlapping hook configuration keys, the resolution layer must pick a winner. Given that the project-level file is described as the *override layer* and the user-level file as the *defaults layer*, the standard interpretation is that project-level declarations win over user-level declarations for any conflicting key. This precedence is the critical behavioral contract that downstream consumers depend on.
4. **Producing a unified configuration object** — the merged result is what `HookConfigLoader` exposes to its callers.

Because the source observations indicate zero code symbols were extracted, the precise function names, merge algorithm (shallow vs. deep merge, key-by-key vs. array-concatenation), and error-handling behavior for missing or malformed files are not enumerated here. Developers maintaining this area should consult `lib/agent-api/hooks/hook-config.js` directly for the exact mechanics. What *is* contractually established by the observations is the two-source input, the precedence relationship, and the single-loader gateway.

## Integration Points

DualScopeConfigResolution sits at the boundary between filesystem state and the runtime hook system. Its primary integration points are:

- **Filesystem inputs**: two well-known paths — `~/.coding-tools/hooks.json` (per-user, machine-wide) and `{project}/.coding/hooks.json` (per-project, version-controllable). Any tool, script, or automation that writes to these paths effectively contributes to the resolved configuration.
- **Parent component**: `HookConfigLoader`, which owns this resolution behavior. DualScopeConfigResolution is not a standalone module but rather the internal logic of the loader; callers interact with it transparently by invoking `HookConfigLoader`'s public interface.
- **Downstream consumer**: the `ConstraintSystem`, which depends on the resolved configuration to apply hook policies. The precedence ordering chosen by DualScopeConfigResolution directly determines which constraints the system enforces at runtime, making this resolution layer behaviorally load-bearing for constraint enforcement.
- **Architectural exclusivity**: because `HookConfigLoader` is the *sole entry point* for hook configuration, no module in the codebase should be reading either `hooks.json` file directly. All access flows through this single funnel, which means DualScopeConfigResolution is the only place where merge semantics need to be implemented or evolved.

## Usage Guidelines

When working with hook configuration, follow these conventions:

**Choose the right scope for the right purpose.** Place personal tooling preferences — things specific to your machine, your workflow, or your individual style — in `~/.coding-tools/hooks.json`. Place policies that the team must share — shared lint hooks, mandatory pre-commit checks, project-wide constraint rules — in `{project}/.coding/hooks.json` and commit that file to version control. Misplacing configuration (e.g., putting team policy in the user file) will cause it to be invisible to teammates.

**Never read `hooks.json` files directly.** Always go through `HookConfigLoader` at `lib/agent-api/hooks/hook-config.js`. Bypassing the loader breaks the architectural invariant that all consumers see the same merged view and introduces the risk of inconsistent precedence handling across the codebase. If you need hook configuration, import or invoke the loader.

**Understand the precedence contract.** Project-level declarations override user-level declarations for conflicting keys. This means a project can guarantee certain hook behavior regardless of individual developer preferences — which is essential for enforceable team policies — but also means developers cannot unilaterally disable team-mandated hooks from their personal config. When debugging unexpected hook behavior, check both files and remember which scope wins.

**Treat the resolution behavior as a stable contract.** Because `ConstraintSystem` and other downstream consumers rely on the resolved configuration, changes to merge semantics (e.g., switching from shallow to deep merge, altering which scope wins) are behavioral breaking changes. Any modification to DualScopeConfigResolution should be evaluated against its impact on constraint enforcement.

---

### Summary of Requested Analysis

1. **Architectural patterns identified**: layered configuration with precedence, single-loader gateway, separation of personal vs. shared scope via distinct filesystem locations.
2. **Design decisions and trade-offs**: physical file separation (gain: clean privacy/sharing boundary; cost: requires merge logic); single entry point (gain: consistency; cost: all consumers coupled to one loader); project-overrides-user precedence (gain: enforceable team policy; cost: reduces individual override flexibility).
3. **System structure insights**: `HookConfigLoader` is a chokepoint — exclusive ownership of hook config I/O concentrates both risk and architectural leverage in a single module at `lib/agent-api/hooks/hook-config.js`.
4. **Scalability considerations**: the two-file model scales naturally per-developer and per-project but does not address multi-project or organization-wide policy layers; if such a layer is ever needed, DualScopeConfigResolution would need to expand into a multi-scope resolver.
5. **Maintainability assessment**: centralization through `HookConfigLoader` is excellent for maintainability — changes to merge semantics happen in one place. The main maintainability risk is the implicit precedence contract: it must be clearly documented and tested, since downstream `ConstraintSystem` behavior silently depends on it.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- HookConfigLoader lives at lib/agent-api/hooks/hook-config.js and is the sole entry point for reading both ~/.coding-tools/hooks.json (user-level) and {project}/.coding/hooks.json (project-level) configuration files


---

*Generated from 4 observations*
