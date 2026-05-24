# HookPayloadFormat

**Type:** Detail

The constraint-configuration.md and semantic-constraint-detection.md files in the same integrations/mcp-constraint-monitor/docs/ directory depend downstream on this payload format — constraint rules and semantic detection logic both reference the fields that CLAUDE-CODE-HOOK-FORMAT.md defines, so changes to the payload schema have cascading effects across those modules.

## What It Is  

**HookPayloadFormat** is the canonical JSON payload specification that underpins the *hook* mechanism of the **HookExtensionSystem**. The definitive definition lives in the file  

```
integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
```  

and is referenced throughout the MCP Constraint Monitor documentation (e.g., `integrations/mcp-constraint-monitor/README.md`). This format is the *contract* between **agents** (the code‑generating side) and **monitors** (the constraint‑evaluation side). Every tool invocation emits a payload that conforms to this schema, and the monitor parses the payload to enforce constraints, collect metrics, and drive semantic‑detection logic.

The format is deliberately dual‑phased: for each tool call the system emits **two** payloads—one at *entry* (pre‑tool‑use) and one at *exit* (post‑tool‑use). The payload therefore either contains a discriminator field (e.g., `event_type: "entry"` / `"exit"`) or follows two closely‑related sub‑schemas. Down‑stream documentation files—`constraint-configuration.md` and `semantic-constraint-detection.md`—rely on the field definitions in this format, making it the single source of truth for any component that consumes hook data.

---

## Architecture and Design  

The architecture surrounding **HookPayloadFormat** is *contract‑driven* and *schema‑centric*. Rather than embedding the payload definition in code, the project stores the JSON contract in a markdown‑documented specification. This design yields several architectural characteristics:

1. **Explicit Interface Boundary** – The payload acts as a *boundary object* between the **agents** that emit hooks and the **MCP Constraint Monitor** that consumes them. By treating the format as an immutable contract, both sides can evolve independently as long as they honor the schema.

2. **Dual‑Lifecycle Event Model** – The specification states that hooks fire on *each tool call entry and exit*. This creates a *two‑stage pipeline* where the monitor receives a “pre‑execution” payload, can decide to allow/modify the call, and later receives a “post‑execution” payload to evaluate outcomes. The design encourages stateless processing of each event while still permitting correlation via a shared identifier (e.g., `call_id`).

3. **Documentation‑Centric Source of Truth** – All downstream modules (`constraint-configuration.md`, `semantic-constraint-detection.md`) reference the same markdown file. This eliminates duplicated schema definitions in code and enforces a *single source of truth* discipline.

4. **Loose Coupling via JSON** – By using JSON as the transport format, the system remains language‑agnostic. Agents written in any language can emit the payload, and the monitor (implemented in the repository’s primary language) can deserialize it with standard JSON parsers.

The only “pattern” observable from the documentation is the **Contract/Interface pattern**—the payload is a contract that both producer and consumer agree to. No other architectural patterns (e.g., microservices, event‑sourcing) are explicitly mentioned.

```
+-------------------+        emit HookPayloadFormat        +----------------------+
|   Agent (Producer) |  ----------------------------->   |  MCP Constraint Monitor |
|  (any language)    |                                   |   (consumer)            |
+-------------------+                                   +----------------------+
        ^                                                       |
        |                                                       |
        |   reads same schema from CLAUDE-CODE-HOOK-FORMAT.md   |
        +-------------------------------------------------------+
```

---

## Implementation Details  

The repository does **not** contain code symbols that directly implement the payload; instead, the implementation is driven by the **documented schema**. The key implementation considerations inferred from the observations are:

* **Schema Definition** – The markdown file (`CLAUDE-CODE-HOOK-FORMAT.md`) enumerates each JSON field (e.g., `tool_name`, `arguments`, `timestamp`, `event_type`, `call_id`, `result`, `error`). Because no code symbols were found, developers are expected to manually map these fields to data structures in their language of choice (e.g., a TypeScript interface or a Python dataclass).

* **Parsing Logic in the Monitor** – The MCP Constraint Monitor (`integrations/mcp-constraint-monitor/README.md`) parses incoming hook payloads according to the contract. The monitor likely uses a generic JSON deserializer followed by validation against the documented field list. Validation errors would surface as malformed‑payload warnings, ensuring that only compliant data proceeds to constraint evaluation.

* **Dual‑Event Handling** – The monitor must differentiate entry vs. exit payloads. The contract probably includes an `event_type` field (or similar) that the monitor checks to route the payload to the appropriate processing pipeline (pre‑execution checks vs. post‑execution analysis). Correlation between the two events is achieved via a shared identifier (`call_id`).

* **Down‑stream Consumption** – Both `constraint-configuration.md` and `semantic-constraint-detection.md` reference specific fields (e.g., `arguments`, `result`). These documents describe how constraint rules are expressed and how semantic detection algorithms interpret the payload. Consequently, any change to the payload schema would require synchronized updates to those markdown files.

Because there are **zero code symbols** in the repository that directly implement the payload, the implementation is effectively *declarative*: the schema lives in documentation, and concrete code in various agents and the monitor must be manually aligned with it.

---

## Integration Points  

**HookPayloadFormat** sits at the nexus of three logical groups:

1. **Agents / Producers** – Any component that invokes a tool must construct a JSON payload that adheres to the contract. This includes external services, internal tool wrappers, or test harnesses. The agents read the specification from `CLAUDE-CODE-HOOK-FORMAT.md` and serialize the required fields.

2. **MCP Constraint Monitor (Consumer)** – The monitor reads the payload, validates it, and then applies constraint rules (as defined in `constraint-configuration.md`) and semantic detection logic (`semantic-constraint-detection.md`). The monitor’s parsing code is the only runtime consumer of the contract within the repository.

3. **Constraint & Detection Modules** – The two markdown files downstream (`constraint-configuration.md`, `semantic-constraint-detection.md`) are *design‑time* integration points. They reference fields from the payload to express rules such as “disallow tool X with argument Y” or “detect semantic drift when result contains pattern Z.” These modules do not contain executable code but define the semantics that the monitor enforces.

No other sibling components are mentioned, but the parent **HookExtensionSystem** encapsulates the entire hook infrastructure, of which **HookPayloadFormat** is the schema definition. Any future sibling extensions that emit hooks must also adopt this format, ensuring a uniform contract across the system.

---

## Usage Guidelines  

1. **Treat the Markdown as Source of Truth** – Always refer to `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` when creating or modifying hook payloads. Do not hard‑code field names elsewhere; instead, copy or import the definition to keep it in sync.

2. **Emit Both Entry and Exit Payloads** – For every tool invocation, produce two JSON messages: one with `event_type: "entry"` (or the equivalent discriminator) before the tool runs, and one with `event_type: "exit"` after completion. Include a stable `call_id` to allow the monitor to correlate the pair.

3. **Validate Before Sending** – Implement a lightweight validation step (e.g., JSON schema validation) against the documented fields. This prevents malformed payloads from reaching the monitor and causing downstream rule‑evaluation failures.

4. **Respect Downstream Dependencies** – Any change to the payload (adding, renaming, or removing fields) must be propagated to `constraint-configuration.md` and `semantic-constraint-detection.md`. Because those documents drive the monitor’s rule engine, unsynchronized changes will break constraint enforcement.

5. **Keep Payloads Minimal and Stable** – Only include fields that are required for constraint evaluation or semantic detection. Extraneous data inflates network traffic and may introduce unnecessary coupling.

6. **Versioning Strategy** – While the repository does not currently expose a version field, consider adding a non‑breaking `schema_version` field if future extensions are anticipated. This would allow the monitor to gracefully handle older payloads.

---

### Architectural Patterns Identified  

* **Contract/Interface Boundary** – The payload acts as an explicit contract between producers and consumers.  
* **Dual‑Event (Entry/Exit) Pipeline** – A two‑stage processing model that separates pre‑execution and post‑execution concerns.  
* **Documentation‑Centric Source of Truth** – Schema lives in markdown, not code, ensuring a single authoritative definition.

### Design Decisions & Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Store schema in markdown (`CLAUDE‑CODE‑HOOK‑FORMAT.md`) | Easy to read, version‑controlled, language‑agnostic | No compile‑time validation; developers must manually keep code in sync |
| Use JSON as transport format | Universally supported, human‑readable | Verbose payloads; no binary efficiency |
| Emit both entry and exit events | Enables pre‑validation and post‑analysis | Requires correlation logic and double the network traffic |
| No embedded schema validation library | Keeps repository lightweight | Increases risk of mismatched payloads if developers forget validation |

### System Structure Insights  

* **Parent Component – HookExtensionSystem**: Provides the overall hook infrastructure; the payload format is its contract layer.  
* **Sibling Components** (if any) would share the same contract, guaranteeing interoperability.  
* **Children**: There are no direct child code artifacts; downstream markdown files (`constraint-configuration.md`, `semantic-constraint-detection.md`) act as logical children that interpret the payload.

### Scalability Considerations  

* **Horizontal Scaling** – Because payloads are plain JSON, they can be streamed through message brokers (e.g., Kafka) without custom serialization logic, supporting high‑throughput hook emission.  
* **Schema Evolution** – Adding optional fields is safe, but removing or renaming fields requires coordinated updates across all consumers, limiting aggressive schema changes.  
* **Payload Size** – Keeping the payload minimal helps maintain low latency as the number of concurrent tool calls grows.

### Maintainability Assessment  

The **single‑source‑of‑truth** approach simplifies maintenance: any change is made in one markdown file and reflected everywhere. However, the lack of programmatic schema enforcement means that human error can introduce drift. Introducing an automated schema validation step (e.g., JSON Schema generation from the markdown) would improve maintainability without breaking the current design. Overall, the design is **moderately maintainable**—clear documentation and explicit contracts aid understanding, but the reliance on manual synchronization is the primary maintenance risk.


## Hierarchy Context

### Parent
- [HookExtensionSystem](./HookExtensionSystem.md) -- integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md specifies the exact JSON payload format that hooks emit on each tool call entry and exit, defining the contract between agents and monitors


---

*Generated from 4 observations*
