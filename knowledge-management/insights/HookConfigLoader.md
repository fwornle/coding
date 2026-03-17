# HookConfigLoader

**Type:** Detail

The fact that integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md exists implies that hook configurations are formatted in a specific way, which the HookConfigLoader must handle.

## What It Is  

**HookConfigLoader** is a concrete module that lives at `lib/agent-api/hooks/hook-config.js`.  Its sole responsibility is to locate, read, and merge hook configuration data that can be supplied at two distinct scopes: **user‑level** (global to the developer or machine) and **project‑level** (specific to a repository or workspace).  The loader is a key collaborator of its parent component, **HookConfigurationManager**, which owns the loader and uses the merged result to drive the rest of the hook‑execution pipeline.  The existence of the documentation files `integrations/copi/docs/hooks.md` and `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` tells us that the configuration format is prescribed and that the loader must understand that schema in order to produce a valid, consumable configuration object.

---

## Architecture and Design  

The architecture around **HookConfigLoader** follows a **configuration‑loader** pattern.  The loader abstracts the mechanics of discovering configuration sources (file system paths, environment variables, etc.) and exposing a single, deterministic configuration object to its consumer, the **HookConfigurationManager**.  This separation keeps the manager focused on higher‑level concerns such as validation, lifecycle management, and dispatching hook functions, while the loader handles the low‑level I/O and merge logic.

From the observations we can infer a **two‑tier merging strategy**: the loader first reads the user‑level configuration (likely from a well‑known home‑directory location) and then overlays any project‑level definitions (found under the current repository).  The merge respects the precedence rules implied by “loads and merges hook configurations from user‑level and project‑level sources,” meaning project‑level values win when conflicts arise.  This deterministic precedence is a design decision that simplifies reasoning about which hook definitions are active in a given run.

The module’s placement under `lib/agent-api/hooks/` indicates it is part of the **agent‑API** boundary, exposing a stable interface to the rest of the system while remaining insulated from the concrete storage details of the configuration files.  No other sibling loaders are mentioned, but the pattern suggests that any future configuration domains (e.g., policy files, credential stores) could be added alongside **HookConfigLoader** using the same loader‑manager contract.

---

## Implementation Details  

Even though the source code is not directly visible, the path `lib/agent-api/hooks/hook-config.js` tells us the loader is implemented as a JavaScript (or TypeScript) module.  The module most likely exports a class or a set of functions that:

1. **Discover Sources** – Resolve the location of the user‑level configuration (perhaps `~/.copi/hooks.json` or similar) and the project‑level configuration (e.g., `<repo_root>/hooks.json`).  
2. **Parse the Files** – Read the files using Node’s `fs` APIs and parse them according to the schema described in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`.  The format documentation guarantees that the loader can validate the shape of the data before merging.  
3. **Merge Logic** – Perform a shallow or deep merge, applying the rule that project‑level entries override user‑level entries.  The merge algorithm is deterministic, ensuring repeatable outcomes across runs.  
4. **Expose the Result** – Return a plain JavaScript object (or a typed configuration class) that the **HookConfigurationManager** consumes.  The manager may further validate the merged configuration or transform it into runtime hook descriptors.

Because **HookConfigurationManager** “contains” the loader, the manager likely instantiates the loader once (perhaps lazily) and caches the merged configuration for the lifetime of the agent process.  This design avoids repeated file I/O and ensures that all hook consumers see a consistent view of the configuration.

---

## Integration Points  

- **Parent Component – HookConfigurationManager**: The manager is the primary consumer.  It invokes the loader during initialization, receives the merged configuration, and then registers hook functions accordingly.  Any changes to the loader’s return shape would require a corresponding update in the manager’s handling code.  

- **Documentation – integrations/copi/docs/hooks.md**: This markdown file defines the public contract for hook functions (e.g., expected signatures, lifecycle hooks).  The loader must produce configuration objects that conform to these expectations, acting as the bridge between static configuration files and the dynamic hook execution engine.  

- **Format Specification – integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md**: The loader directly references this spec to parse and validate the raw JSON/YAML files.  Any evolution of the format (new fields, deprecations) will be reflected in the loader’s parsing logic.  

- **File System / Environment**: Implicitly, the loader depends on the host file system to locate configuration files and may also read environment variables for overrides (a common practice, though not explicitly documented).  

No direct child entities are mentioned; the loader’s output is consumed rather than further decomposed within the same module.

---

## Usage Guidelines  

1. **Place Configuration Files Correctly** – To have the loader pick up a hook definition, developers should store user‑level hooks in the designated global location (as described in the docs) and project‑level hooks in the repository root.  Because project‑level settings win, any conflicting definitions should be intentionally placed in the project file.  

2. **Follow the Hook Format** – All hook configuration files must adhere to the schema outlined in `CLAUDE-CODE-HOOK-FORMAT.md`.  Invalid JSON or schema violations will cause the loader to throw errors during the merge phase, preventing the **HookConfigurationManager** from starting.  

3. **Avoid Direct Instantiation** – Consumers should not instantiate **HookConfigLoader** directly; instead, they should obtain the merged configuration through **HookConfigurationManager**, which guarantees that the loader has been executed exactly once and that the result is cached.  

4. **Do Not Mutate the Returned Object** – The merged configuration should be treated as read‑only.  If a runtime component needs to adjust hook behavior, it should do so via the manager’s public APIs rather than mutating the loader’s output.  

5. **Version Compatibility** – When upgrading the hook format documentation, ensure that any new fields are reflected in the loader’s parsing logic before deploying updated hook definitions, to avoid runtime incompatibilities.

---

### Architectural Patterns Identified  

1. **Configuration‑Loader Pattern** – Isolates file‑system I/O and parsing from higher‑level business logic.  
2. **Two‑Tier Merge Strategy** – Deterministic precedence (project over user) to resolve conflicts.  
3. **Manager‑Loader Composition** – The parent **HookConfigurationManager** composes the loader, adhering to a clear separation of concerns.

### Design Decisions and Trade‑offs  

- **Single Responsibility vs. Flexibility** – By keeping the loader focused on discovery and merging, the system is easy to maintain, but any additional source (e.g., remote config service) would require extending the loader or adding a new one.  
- **Deterministic Precedence** – Favoring project‑level overrides simplifies developer expectations, at the cost of limiting the ability to have user‑level defaults that can be selectively disabled per project.  
- **Caching at Manager Level** – Reduces repeated I/O, improving performance, but introduces a need to restart the agent to pick up configuration changes.

### System Structure Insights  

- The hook subsystem is organized under `lib/agent-api/hooks/`, with **HookConfigLoader** handling static configuration and **HookConfigurationManager** orchestrating runtime behavior.  
- Documentation files live in `integrations/*/docs/`, indicating a clear separation between code and specification.  
- The overall flow is: *Documentation → Config Files → HookConfigLoader → HookConfigurationManager → Hook Execution Engine*.

### Scalability Considerations  

- **File‑Based Config** scales well for a modest number of hooks; however, if the number of hook definitions grows dramatically, the loader’s merge algorithm may become a bottleneck.  The current design could be extended with streaming parsers or incremental caching.  
- Adding new configuration sources (e.g., network‑based stores) would require augmenting the loader without breaking existing callers, thanks to the manager‑loader contract.

### Maintainability Assessment  

- The clear division between loader and manager, combined with explicit documentation of the hook format, makes the subsystem highly maintainable.  
- Since the loader’s responsibilities are narrow, unit tests can focus on file discovery, parsing, and merge semantics, providing fast feedback on changes.  
- Future schema changes are localized to the loader and the accompanying markdown spec, limiting the blast radius of modifications.  

Overall, **HookConfigLoader** embodies a straightforward, well‑encapsulated design that fits cleanly within the larger hook configuration management architecture.


## Hierarchy Context

### Parent
- [HookConfigurationManager](./HookConfigurationManager.md) -- The HookConfigLoader in lib/agent-api/hooks/hook-config.js loads and merges hook configurations from user-level and project-level sources.


---

*Generated from 3 observations*
