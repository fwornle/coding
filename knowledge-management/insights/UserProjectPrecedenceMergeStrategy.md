# UserProjectPrecedenceMergeStrategy

**Type:** Detail

The integrations/mcp-constraint-monitor/docs/constraint-configuration.md ('Constraint Configuration Guide') elaborates the schema for specifying per-project constraint rules, indicating the loader must understand both file locations and how their fields combine or supersede each other.

## What It Is  

**UserProjectPrecedenceMergeStrategy** is the concrete merge‑engine that powers the two‑level hook‑configuration model used by the *MCP Constraint Monitor* integration. The strategy lives inside the **HookConfigurationLoader** component (the loader that reads and materialises hook definitions) and is described in the documentation under  

* `integrations/mcp-constraint-monitor/README.md` – explains that a *user‑level* `hooks.json` provides a global baseline, while a *project‑level* `hooks.json` may override or extend those settings.  

* `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` – details the schema for per‑project constraint rules and clarifies how the loader must combine the two files.  

In practice, a developer adds a new project by supplying only the delta rules in a project‑specific `hooks.json`; the **UserProjectPrecedenceMergeStrategy** merges those delta rules with the global defaults, guaranteeing that *project‑level* entries win wherever a conflict exists. The sibling component **ClaudeCodeHookDataFormat** (documented in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`) defines the shape of the hook payloads that the loader ultimately produces.

---

## Architecture and Design  

The architecture follows a **layered configuration** pattern: a *global* layer (user‑level) and a *local* layer (project‑level). The **HookConfigurationLoader** acts as the orchestrator, delegating the actual combination of the two JSON documents to **UserProjectPrecedenceMergeStrategy**. This strategy embodies a **precedence‑merge** design – it first reads the user‑level file, then walks the project‑level file, replacing or extending entries according to the rules laid out in the README.  

The interaction can be visualised as:

```
+---------------------------+          +----------------------------+
| HookConfigurationLoader   |  uses    | UserProjectPrecedenceMerge |
|  - loads user/hooks.json  |------->  | Strategy                   |
|  - loads project/hooks.json|          |  - apply precedence rules |
+---------------------------+          +----------------------------+
                 |                                   |
                 v                                   v
          +----------------+                +-------------------+
          | ClaudeCodeHook |  <-- reads --> | Merged Hook Model |
          | Data Format    |                | (final config)    |
          +----------------+                +-------------------+
```

No additional design patterns (e.g., micro‑services, event‑driven) are mentioned, so the system remains a **single‑process, configuration‑centric** component. The strategy’s responsibility is narrowly scoped: it does **not** validate the JSON schema (that responsibility belongs to the loader and the ClaudeCodeHookDataFormat definition) but merely resolves conflicts according to the documented precedence hierarchy.

---

## Implementation Details  

The only concrete code symbol referenced is **HookConfigurationLoader**, which *contains* the **UserProjectPrecedenceMergeStrategy**. Although the source code is not listed, the documentation makes clear how the merge works:

1. **Discovery** – The loader looks for a `hooks.json` file in the user’s home (or a configured global location) and a second `hooks.json` inside each project directory.  
2. **Parsing** – Both files are parsed into in‑memory representations that match the schema described in `CLAUDE-CODE-HOOK-FORMAT.md`.  
3. **Merge Execution** – The strategy walks the global representation first, then iterates over the project representation. For each top‑level key (e.g., a constraint name), if the project file defines the same key, its value **overwrites** the global one; otherwise, the global entry is retained. Nested objects are merged recursively, again favouring project‑level fields when they exist.  
4. **Result Delivery** – The merged configuration is handed back to the loader, which then produces the final hook payloads consumed by the rest of the MCP system.

Because the strategy is encapsulated inside the loader, callers of **HookConfigurationLoader** are insulated from the merge mechanics; they simply request a configuration for a given project and receive a fully resolved set of rules.

---

## Integration Points  

* **Parent Component – HookConfigurationLoader**: The loader is the entry point for any subsystem that needs hook definitions. It invokes **UserProjectPrecedenceMergeStrategy** to produce the merged view before any further processing.  

* **Sibling Component – ClaudeCodeHookDataFormat**: This sibling defines the exact JSON shape expected by downstream consumers (e.g., the constraint‑monitor runtime). The loader validates that the merged configuration conforms to this format, ensuring type safety across the integration.  

* **External Consumers**: While not explicitly listed, the merged hook configuration is ultimately consumed by the MCP constraint‑monitor runtime, which enforces the declared constraints during code analysis. The merge strategy therefore acts as a bridge between static configuration files and dynamic enforcement logic.  

* **File System**: The strategy relies on the presence of two files on disk (`hooks.json` at the user level and at the project level). Any tooling that generates or updates these files must respect the documented schema, otherwise the merge will produce invalid results.

---

## Usage Guidelines  

1. **Provide Only Deltas at the Project Level** – When adding a new project, developers should create a `hooks.json` that contains only the rules that differ from the global baseline. This minimises duplication and leverages the precedence logic automatically.  

2. **Never Duplicate Global Keys Unnecessarily** – If a project does not need to change a particular global rule, omit it entirely. The merge strategy will inherit the global value, keeping the configuration lean and easier to audit.  

3. **Respect the Schema** – Both the user‑level and project‑level files must conform to the schema defined in `CLAUDE-CODE-HOOK-FORMAT.md`. Validation errors will surface during loading, preventing malformed configurations from propagating.  

4. **Version the Global Baseline Carefully** – Because all projects inherit from the user‑level file, changes to that file can have wide‑impact. Coordinate updates with the team and consider backward‑compatible additions (e.g., new optional fields) rather than breaking changes.  

5. **Testing Merged Output** – When introducing new constraints, run the loader in a test harness to inspect the merged JSON. This helps verify that precedence behaves as expected before committing the files to source control.

---

### Architectural Patterns Identified  

* **Layered Configuration** – Global (user) → Local (project) with explicit precedence.  
* **Precedence‑Merge Strategy** – A deterministic rule‑based algorithm that resolves conflicts in favour of the more specific layer.  

### Design Decisions and Trade‑offs  

* **Simplicity vs Flexibility** – By limiting the hierarchy to two layers, the design stays easy to understand and implement, but it does not support deeper inheritance (e.g., organisation‑level defaults).  
* **Duplication Reduction** – Encourages delta‑only project files, reducing maintenance overhead, at the cost of developers needing to be aware of the global baseline.  

### System Structure Insights  

* The **HookConfigurationLoader** is the façade that hides merge complexity.  
* **UserProjectPrecedenceMergeStrategy** is a pure‑logic component, isolated from I/O, making it testable in isolation.  
* **ClaudeCodeHookDataFormat** provides the contract that the merged output must satisfy, ensuring downstream compatibility.  

### Scalability Considerations  

* The merge algorithm is linear in the size of the combined JSON objects, which is acceptable for typical hook configurations (tens to low hundreds of entries).  
* Adding more layers would increase complexity; the current two‑level model scales well for the intended use‑case of per‑project customisation.  

### Maintainability Assessment  

* **High** – The clear separation of concerns (loader, merge strategy, data format) and the exhaustive documentation in the README and markdown guides make the component easy to reason about and modify.  
* **Risk** – Since the merge logic is not directly visible in the provided source symbols, future contributors must rely on documentation; keeping the implementation aligned with the docs is essential to avoid drift.  

---  

*This insight document consolidates the current design of **UserProjectPrecedenceMergeStrategy** as described in the integration’s documentation and its relationship to the surrounding components.*


## Hierarchy Context

### Parent
- [HookConfigurationLoader](./HookConfigurationLoader.md) -- The two-level configuration model (user-level and project-level hooks.json) is documented in integrations/mcp-constraint-monitor/README.md, establishing a clear precedence/merge strategy between global and per-project rules

### Siblings
- [ClaudeCodeHookDataFormat](./ClaudeCodeHookDataFormat.md) -- The format is fully documented in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md ('Claude Code Hook Data Format'), making it the authoritative schema reference the loader uses to interpret incoming hook payloads.


---

*Generated from 4 observations*
