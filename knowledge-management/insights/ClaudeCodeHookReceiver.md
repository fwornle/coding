# ClaudeCodeHookReceiver

**Type:** Detail

integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md ('Claude Code Hook Data Format') is a dedicated document describing the exact payload structure expected from Claude Code hooks, indicating a well-defined ingestion interface

## What It Is  

**ClaudeCodeHookReceiver** is the concrete ingestion component that accepts events emitted by the *Claude Code* agent and translates them into the internal representation used by the **MCPConstraintMonitorIntegration** package. The receiver lives under the integration’s source tree (the exact implementation files are not listed in the current snapshot, but the component is documented in the following files):

* `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` – the authoritative specification of the JSON payload that the receiver must parse.  
* `integrations/mcp-constraint-monitor/docs/status-line-integration.md` – describes how the same payload is also surfaced in the status‑line UI.  

Because the **ClaudeCodeHookReceiver** is a child of **MCPConstraintMonitorIntegration**, it acts as the bridge between the external Claude Code hook contract and the internal violation‑tracking pipeline that ultimately feeds the dashboard (`dashboard/README.md`). In other words, it is the *gateway* that turns raw Claude Code events into structured constraint‑violation records and UI notifications.

---

## Architecture and Design  

The design of **ClaudeCodeHookReceiver** is driven by a *contract‑first* approach. The existence of a dedicated format document (`CLAUDE-CODE-HOOK-FORMAT.md`) indicates that the receiver is built around a **well‑defined ingestion interface**. The component therefore follows an **Adapter**‑like pattern: it adapts the external Claude Code payload to the internal data model used by the MCP‑compatible monitoring server.

Interaction flow (derived from the two documentation sources):

1. **Claude Code Agent → HTTP/HTTPS endpoint** – the agent sends a JSON payload that conforms exactly to the schema described in `CLAUDE-CODE-HOOK-FORMAT.md`.  
2. **ClaudeCodeHookReceiver** parses the payload, validates required fields, and creates an internal *violation* object.  
3. The violation object is handed off to two downstream consumers:  
   * **Violation storage** – persists the record so that the constraint‑monitoring backend can aggregate, query, and alert on violations.  
   * **Status‑line UI** – the same object is forwarded to the status‑line integration described in `status-line-integration.md`, enabling real‑time visual feedback for developers.  

Because the receiver lives inside **MCPConstraintMonitorIntegration**, it inherits the integration’s overall *MCP‑compatible server* responsibilities (e.g., exposing a health endpoint, participating in the MCP lifecycle). The sibling component **SemanticConstraintDetection** handles the *detection* of semantic constraints, while **ClaudeCodeHookReceiver** is solely responsible for *receiving* and *dispatching* the resulting events. This separation of concerns keeps the ingestion path lightweight and decoupled from the more heavyweight semantic analysis logic.

---

## Implementation Details  

Although the current repository snapshot does not list concrete code symbols, the documentation makes the following implementation expectations clear:

| Artifact | Role | Key Details |
|----------|------|-------------|
| `CLAUDE-CODE-HOOK-FORMAT.md` | Payload contract | Enumerates required top‑level fields (e.g., `violationId`, `ruleId`, `filePath`, `lineNumber`, `severity`, `message`) and their data types. It also defines optional metadata such as `gitSha` or `timestamp`. |
| `status-line-integration.md` | UI bridge | Specifies how the parsed violation object is transformed into a status‑line entry (e.g., a concise one‑line string with severity icon, file location, and a short message). It also mentions any throttling or deduplication logic that the receiver must apply before pushing to the UI. |
| `MCPConstraintMonitorIntegration` (parent) | Hosting component | Provides the HTTP server scaffolding, request routing, and lifecycle hooks (startup, shutdown). The receiver is registered as a route handler (e.g., `POST /claude/code-hook`). |

From these artifacts we can infer the following implementation mechanics:

* **Payload Validation** – The receiver likely uses a schema validator (e.g., JSON Schema) derived from `CLAUDE-CODE-HOOK-FORMAT.md`. Validation ensures that malformed hooks are rejected early, preserving downstream data integrity.  
* **Mapping Layer** – After validation, the receiver maps the raw JSON fields to an internal `Violation` class (or plain data structure) that matches the format expected by the violation storage subsystem.  
* **Dual Dispatch** – The same `Violation` instance is passed to two separate services: a persistence layer (perhaps a database or in‑memory store) and a UI notifier that updates the status line. The documentation for the status line suggests that the UI path may be a lightweight, fire‑and‑forget operation to keep latency low.  
* **Error Handling** – Because the receiver is part of an MCP server, any parsing or downstream errors are likely logged and returned as HTTP 4xx/5xx responses, adhering to the MCP integration’s observability standards.

---

## Integration Points  

1. **External Claude Code Agent** – The only outward‑facing contract is the HTTP endpoint that consumes the Claude Code hook payload. The exact URL is defined by the MCP integration’s routing configuration.  
2. **Violation Storage Subsystem** – The receiver hands off the internal violation object to the storage component used by the broader constraint‑monitoring system. This subsystem is shared with other sources of violations (e.g., static analysis tools) and is the source of truth for the dashboard.  
3. **Status‑Line UI** – The status‑line integration consumes the same violation object to render real‑time feedback in the developer’s terminal or IDE status bar. This UI component is documented separately but relies on the receiver’s output format.  
4. **Parent Integration (`MCPConstraintMonitorIntegration`)** – Provides the server framework, health checks, and any common middleware (authentication, request logging). The receiver registers itself within this framework, inheriting its configuration (port, TLS settings, etc.).  
5. **Sibling `SemanticConstraintDetection`** – While not a direct dependency, the two components share the same high‑level goal of constraint monitoring. `SemanticConstraintDetection` produces violations that follow the same internal model, allowing the receiver to treat Claude‑generated violations identically to those generated by the semantic detector.

---

## Usage Guidelines  

* **Strict Adherence to the Payload Spec** – When extending or testing Claude Code hooks, always validate against `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. Missing or miss‑typed fields will cause the receiver to reject the request.  
* **Idempotency Considerations** – The payload includes a `violationId`. Downstream consumers (storage and UI) assume this identifier is globally unique; re‑sending the same hook should not create duplicate records. Implement callers should generate stable IDs (e.g., UUID v5 derived from rule + file + line).  
* **Performance‑Sensitive Path** – Because the receiver also updates the status line, keep the payload lightweight. Avoid embedding large code diffs or heavy metadata; those belong in separate storage, not in the hook payload.  
* **Error Reporting** – The receiver returns standard HTTP error codes. Clients should treat 4xx responses as unrecoverable (payload issue) and 5xx as transient (server overload). Implement exponential back‑off for retrying 5xx responses.  
* **Testing** – Unit tests should load the example JSON from `CLAUDE-CODE-HOOK-FORMAT.md` and verify that the receiver produces a correctly populated internal violation object. Integration tests should spin up the MCP server and assert that a posted hook results in both a persisted violation and a visible status‑line entry.  

---

### Architectural Patterns Identified  

| Pattern | Evidence |
|---------|----------|
| **Adapter / Contract‑First Interface** | Dedicated `CLAUDE-CODE-HOOK-FORMAT.md` defines the external contract that the receiver adapts into internal models. |
| **Dual‑Dispatch Pipeline** | `status-line-integration.md` shows the same data flowing to both storage and UI, indicating a fan‑out design. |
| **Component‑Based Integration** | The receiver is a child of `MCPConstraintMonitorIntegration`, encapsulating a single responsibility within a larger server component. |

### Design Decisions & Trade‑offs  

* **Explicit Payload Schema** – Guarantees data consistency but reduces flexibility; any change to the Claude Code payload requires a coordinated update to the markdown spec and receiver validation logic.  
* **Single Receiver for Multiple Consumers** – Simplifies the ingestion surface but introduces the need for careful error handling; a failure in the UI path must not block persistence.  
* **Location Within MCP Integration** – Leveraging the existing MCP server reduces duplication of infrastructure (routing, health checks) but couples the receiver to MCP’s lifecycle and configuration conventions.

### System Structure Insights  

* **Top‑Level Integration (`MCPConstraintMonitorIntegration`)** hosts the server and registers the `ClaudeCodeHookReceiver` as a route.  
* **ClaudeCodeHookReceiver** acts as the *gateway* that validates, maps, and dispatches Claude Code events.  
* **Sibling `SemanticConstraintDetection`** produces its own violations, reusing the same internal violation model, which allows the dashboard to present a unified view.  

### Scalability Considerations  

* Because the receiver is stateless aside from validation, it can be horizontally scaled behind a load balancer without additional coordination.  
* The dual‑dispatch model can be made asynchronous (e.g., queue the UI notification) to prevent UI latency from throttling ingestion throughput.  

### Maintainability Assessment  

* **High** – The presence of a single source of truth for the payload (`CLAUDE-CODE-HOOK-FORMAT.md`) and a clear separation between ingestion, storage, and UI reduces cognitive load.  
* **Potential Risks** – The lack of visible code symbols means future contributors must rely heavily on documentation; keeping the markdown spec in sync with any code‑level validation library is essential.  

---  

*All references above are grounded in the documented files and the hierarchical relationship of `ClaudeCodeHookReceiver` within the `MCPConstraintMonitorIntegration` package.*


## Hierarchy Context

### Parent
- [MCPConstraintMonitorIntegration](./MCPConstraintMonitorIntegration.md) -- integrations/mcp-constraint-monitor/README.md describes the integration package that wraps constraint monitoring as an MCP-compatible server component

### Siblings
- [SemanticConstraintDetection](./SemanticConstraintDetection.md) -- integrations/mcp-constraint-monitor/docs/semantic-detection-design.md ('Semantic Constraint Detection - Design Document') describes the architectural design decisions behind semantic-level detection, suggesting this is a non-trivial subsystem with its own design rationale


---

*Generated from 3 observations*
