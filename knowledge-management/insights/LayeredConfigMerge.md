# LayeredConfigMerge

**Type:** Detail

Project-level overrides are read from .coding/hooks.json and take highest precedence in the merge order

# LayeredConfigMerge — Technical Insight Document

## What It Is

LayeredConfigMerge is the configuration resolution pattern implemented within `hook-config.js`, serving as the core merge strategy for the parent component HookConfigLoader. Rather than existing as a standalone module, it represents the layered override behavior by which hook configuration is assembled from multiple sources in a defined precedence order. The pattern loads a baseline configuration first, then progressively applies more specific overrides on top, culminating in a single resolved configuration object used by the hook system.

## Architecture and Design

The architecture follows a classic **layered override / cascading configuration** pattern, conceptually similar to how CSS specificity or environment-variable precedence chains work. Three distinct layers are defined, each with increasing precedence:

1. **Defaults layer** — loaded first by `hook-config.js`, establishing a baseline hook configuration that guarantees the system always has a valid, complete configuration even in the absence of any user or project customization.
2. **User-level layer** — read from `~/.coding-tools/hooks.json`, representing per-user preferences that apply across all projects on a given machine.
3. **Project-level layer** — read from `.coding/hooks.json`, taking the highest precedence, allowing project-specific requirements to override both defaults and user preferences.

This design cleanly separates *scope of configuration* (global default → user → project) from *merge mechanics* (each layer merged over the previous). The precedence order is fixed and sequential, which keeps the mental model simple: later layers always win over earlier ones for any given key.

## Implementation Details

The mechanics are driven entirely within `hook-config.js`, which orchestrates the three-step load-and-merge sequence:

- It first materializes the default hook configuration in memory as the baseline object.
- It then attempts to read `~/.coding-tools/hooks.json`; if present, its contents are merged over the defaults, with user-specified keys overwriting corresponding default keys.
- Finally, it reads `.coding/hooks.json` from the project directory and merges it over the result of the previous step, so project-specific settings have the final say.

Because this is described as a layered merge rather than a full deep clone/replace, the implementation implies key-by-key overriding (i.e., a shallow or recursive merge) rather than wholesale replacement of the configuration object — each layer only needs to specify the keys it wishes to override, inheriting everything else from the layer beneath it.

## Integration Points

LayeredConfigMerge is not an independent entity but a pattern realized inside HookConfigLoader, which "contains" it per the entity relationship. This means any consumer of HookConfigLoader implicitly relies on this merge behavior — the loader's public interface is expected to return a single, fully-resolved configuration object rather than exposing the individual layers. The two external integration points are the filesystem paths themselves:

- `~/.coding-tools/hooks.json` — a user-scoped, cross-project configuration file.
- `.coding/hooks.json` — a project-scoped configuration file, presumably located at the project root or within a `.coding` directory.

Any tooling that needs to influence hook behavior must target one of these two files, since the defaults baked into `hook-config.js` are not intended to be edited directly by end users.

## Usage Guidelines

Developers and users customizing hook behavior should understand the precedence order to avoid confusion: project-level `.coding/hooks.json` always wins over user-level `~/.coding-tools/hooks.json`, which always wins over the built-in defaults. When debugging unexpected hook behavior, check the project-level file first, then the user-level file, then fall back to assumptions about defaults. Since the merge is additive/overriding rather than replacing, partial configuration files are safe — only specify the keys you want to change, and rely on inheritance for the rest.

**Key architectural takeaways:**
- **Pattern**: Cascading/layered configuration merge (defaults → user → project), a well-established, low-risk approach for scoped configuration systems.
- **Trade-off**: Simplicity and predictability are favored over flexibility — there's no indication of arbitrary numbers of layers or plugin-injected layers, only the fixed three-tier hierarchy.
- **Structure**: Tight coupling between HookConfigLoader and this merge logic, all centralized in a single file (`hook-config.js`), which aids maintainability by keeping the resolution logic in one place but could become a bottleneck if configuration sources grow more complex.
- **Scalability**: The fixed three-layer model scales well for typical user/project use cases, but adding new layers (e.g., team-level or environment-level configs) would require modifying `hook-config.js` directly, since no plugin/extensibility mechanism is mentioned.
- **Maintainability**: The clear, linear precedence order and single-file implementation make this pattern easy to reason about and audit, though the lack of separate code symbols/classes suggests the logic may be procedural rather than encapsulated in dedicated abstractions.


## Hierarchy Context

### Parent
- [HookConfigLoader](./HookConfigLoader.md) -- hook-config.js implements a layered merge pattern: defaults are loaded first, then user-level ~/.coding-tools/hooks.json, then project-level .coding/hooks.json, each layer overriding the previous


---

*Generated from 3 observations*
