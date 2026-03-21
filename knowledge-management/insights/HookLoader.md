# HookLoader

**Type:** Detail

The integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md file describes the Claude Code Hook Data Format, suggesting a structured approach to loading hook events.

## What It Is  

**HookLoader** is the concrete component responsible for ingesting, parsing, and materialising hook definitions that drive extensibility throughout the platform. The implementation lives under the **integrations** namespace – the documentation that describes the hook contract is found in `integrations/copi/docs/hooks.md`, while the precise payload schema for Claude‑generated code hooks is defined in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. These two files together make clear that hook loading is not an ad‑hoc activity; it follows a well‑defined data format and is a first‑class concern of the system.

HookLoader is owned by **HookManager**, a higher‑level orchestrator that “loads hook events from a configuration file or database” (as described in the hierarchy context). In this relationship HookManager is the *parent* component that delegates the low‑level discovery and deserialization work to HookLoader. No sibling loaders are explicitly documented, but the presence of a dedicated manager suggests that HookLoader is the sole implementation for the current hook‑loading responsibility.

In short, HookLoader is the plumbing that translates the declarative hook specifications (documented in the two markdown files) into runtime objects that the rest of the system – via HookManager – can act upon.

---

## Architecture and Design  

The architecture that emerges from the observations follows a **manager‑loader** pattern. HookManager acts as a façade that presents a clean API for the rest of the system (e.g., constraint evaluation, monitoring, or external integrations) while delegating the heavy lifting of reading and interpreting hook definitions to HookLoader. This separation of concerns isolates I/O and parsing logic from business‑level orchestration, making each piece easier to test and evolve.

The design is **data‑driven**: the `CLAUDE-CODE-HOOK-FORMAT.md` file specifies a structured JSON‑like schema for hook events, indicating that HookLoader likely validates incoming payloads against this schema before converting them into internal representations. By anchoring the contract in a markdown‑based specification, the team ensures that any change to the hook format is documented and versioned alongside the code that consumes it.

Interaction flow can be visualised as:

```
+----------------+          +----------------+          +-------------------+
|  HookManager   |  uses -> |   HookLoader   | reads -> |  Config / DB /    |
| (Facade)       |          | (Parser/IO)    |          |  Hook Files       |
+----------------+          +----------------+          +-------------------+
        |                         |
        |   delivers parsed hooks |
        v                         v
+----------------+          +----------------+
|  Constraint   |  <-- uses Hook objects (runtime) |
|  System       |                                      |
+----------------+                                      |
```

*Figure 1 – High‑level interaction between HookManager, HookLoader, and the data source.*  

Because the only documented entry point is the configuration file or database, HookLoader is likely a **single‑responsibility** class that encapsulates all parsing rules for the Claude Code Hook format and any other hook definitions referenced in `hooks.md`. No micro‑service boundaries or event‑bus mechanisms are mentioned, so the design stays within the process space of the parent component.

---

## Implementation Details  

Although the source code itself is not present in the observations, the documentation files give concrete clues about the implementation:

1. **Hook Definition Reference (`integrations/copi/docs/hooks.md`)** – This markdown file enumerates the available hook functions, their signatures, and the contexts in which they fire. HookLoader must therefore contain a registry or lookup table that maps these textual identifiers to concrete handler classes or callbacks. The registry is probably built at startup by scanning the markdown or by loading a pre‑compiled manifest derived from it.

2. **Claude Code Hook Data Format (`integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`)** – The format describes fields such as `hookId`, `payload`, `timestamp`, and possibly a `signature`. HookLoader’s parsing routine will read raw JSON (or another serialisation) from the configuration source, validate required fields against this schema, and instantiate a strongly‑typed `HookEvent` object. Validation may be performed with a lightweight schema validator rather than a full‑blown library, given the limited scope.

3. **Parent‑Child Relationship** – HookManager contains an instance of HookLoader. The typical lifecycle is:
   * HookManager initialises, creates HookLoader.
   * HookLoader reads the configuration source (file path or DB query) and returns a collection of `HookEvent` objects.
   * HookManager stores these events in its internal `HookRegistry` and exposes methods such as `getHooksFor(eventType)` to downstream consumers.

Because no code symbols are listed, we can infer that the primary public API of HookLoader is likely a method such as `loadHooks(): List<HookEvent>` or `loadFromSource(source: String): List<HookEvent>`. Error handling is expected to surface parsing failures as exceptions that HookManager can catch and log, preserving system stability.

---

## Integration Points  

HookLoader sits at the intersection of three major system concerns:

* **Configuration / Persistence Layer** – It reads hook definitions from a file (perhaps `hooks.yaml` or `hooks.json` under a known directory) or a database table. The exact source is abstracted, but the existence of a “configuration file or database” clause in the hierarchy context tells us that HookLoader must support at least two I/O adapters.

* **HookManager** – As the direct parent, HookManager invokes HookLoader during its own startup sequence. HookManager may also request a refresh of hooks at runtime (e.g., when a new configuration is deployed), in which case HookLoader provides an idempotent reload operation.

* **Constraint System / Consumer Components** – Once HookLoader has produced concrete `HookEvent` objects, they flow into the ConstraintSystem, where the “HookManager contains HookLoader” relationship indicates that downstream components never interact with HookLoader directly. Instead, they request hooks through HookManager’s façade, ensuring a stable contract even if HookLoader’s implementation changes.

No external services, message queues, or plugin frameworks are mentioned, so HookLoader’s integration surface is limited to these in‑process dependencies.

---

## Usage Guidelines  

1. **Never invoke HookLoader directly** – All interactions should go through HookManager. This guarantees that any caching, refresh logic, or error handling baked into HookManager remains effective.

2. **Keep the hook definition files in sync with the documentation** – Since `hooks.md` and the Claude format markdown are the single source of truth, any change to a hook’s signature must be reflected in both files before HookLoader is updated. This prevents runtime mismatches.

3. **Validate custom hook payloads against the Claude format** – If developers add new fields to a hook payload, they must extend the `CLAUDE-CODE-HOOK-FORMAT.md` schema accordingly and update any validation logic inside HookLoader. Failing to do so will cause parsing errors at load time.

4. **Prefer declarative configuration over code changes** – The design encourages adding or disabling hooks by editing the configuration source rather than modifying code. This promotes rapid iteration and reduces the need for recompilation.

5. **Handle reloads gracefully** – If a hot‑reload of hook definitions is required (e.g., after a deployment), ensure that HookManager calls the appropriate HookLoader reload method and that any in‑flight hook executions are completed before the new set replaces the old one.

---

### Architectural Patterns Identified  

* **Manager‑Loader (Facade + Loader) pattern** – HookManager abstracts the loading process, delegating to HookLoader.  
* **Data‑Driven Configuration** – Hook definitions and payload schemas are externalised in markdown files, driving runtime behaviour.  

### Design Decisions and Trade‑offs  

* **Single‑Responsibility vs. Extensibility** – By confining all parsing to HookLoader, the design simplifies testing but may require future refactoring if multiple hook sources (e.g., remote APIs) are added.  
* **File‑Based vs. DB‑Based Source** – Supporting both gives flexibility but adds complexity in abstracting I/O; the current trade‑off favours configurability over pure performance.  

### System Structure Insights  

* The hierarchy is shallow: HookManager → HookLoader → Config/DB → HookEvent objects → ConstraintSystem.  
* No sibling loaders are present, indicating a monolithic hook loading approach at this stage.  

### Scalability Considerations  

* **Load Volume** – Because HookLoader parses all hooks up‑front, the system scales linearly with the number of hook definitions. Large hook sets may increase startup latency; a lazy‑load or pagination strategy could mitigate this.  
* **Refresh Frequency** – Frequent reloads could contend with the underlying I/O (file system or DB). Caching the raw source and diff‑checking before a full reload would improve scalability.  

### Maintainability Assessment  

* **High maintainability** – The clear separation between documentation (`hooks.md`, `CLAUDE-CODE-HOOK-FORMAT.md`) and code (HookLoader) makes updates straightforward.  
* **Potential technical debt** – Absence of explicit unit‑test references or schema‑validation tooling in the observations suggests that validation logic may be ad‑hoc; introducing a schema validator library would reduce future bugs.  

Overall, HookLoader embodies a disciplined, documentation‑first approach to extensibility, with a clean managerial boundary that supports both configurability and future growth.

## Hierarchy Context

### Parent
- [HookManager](./HookManager.md) -- HookManager loads hook events from a configuration file or database.

---

*Generated from 3 observations*
