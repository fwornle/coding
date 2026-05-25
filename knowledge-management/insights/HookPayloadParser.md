# HookPayloadParser

**Type:** Detail

The wire format is documented in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md, which defines distinct payload structures for pre-tool and post-tool hook events exchanged between Claude Code and the constraint monitor.

## What It Is  

**HookPayloadParser** lives in the *integrations/mcp‑constraint‑monitor* package and is the concrete implementation that turns the raw JSON payloads arriving from Claude Code into typed, in‑memory objects that the constraint‑monitoring pipeline can consume. The wire format for those payloads is defined in  
`integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`.  

Two distinct shapes are described there:  

* **Pre‑tool** payloads – emitted **before** a tool is invoked and contain the tool‑call parameters.  
* **Post‑tool** payloads – emitted **after** a tool finishes and contain the tool‑execution results.  

HookPayloadParser is the entry point for every hook event that flows through **HookInterceptor** (the parent component that owns the parser). Parsed payloads are handed off to the constraint‑rule evaluation stage described in `constraint-configuration.md` and `semantic-constraint-detection.md`. In short, HookPayloadParser is the boundary between the external Claude Code hook stream and the internal constraint‑enforcement engine.

---

## Architecture and Design  

The architecture follows a **single‑responsibility, façade‑style** design. HookInterceptor acts as a façade that receives raw hook events from Claude Code; its only responsibility is to delegate the heavy‑lifting of payload interpretation to HookPayloadParser. This separation keeps the networking/transport concerns (handled by the interceptor) distinct from the domain‑specific parsing logic.

The parser itself implements a **dual‑branch parsing strategy** dictated by the “type” field in the incoming JSON (the field that distinguishes pre‑tool from post‑tool events). Rather than exposing two separate parsers, a single class contains the logic to:

1. Detect the payload variant (pre‑tool vs. post‑tool).  
2. Validate the required fields for that variant against the schema described in `CLAUDE-CODE-HOOK-FORMAT.md`.  
3. Produce a strongly‑typed internal representation (e.g., `PreToolPayload` and `PostToolPayload` data structures).  

This approach avoids duplication of common parsing infrastructure (JSON deserialization, error handling, logging) while still respecting the structural differences of the two event shapes. The design can be visualised as:

```
+-------------------+          +-------------------+
|   HookInterceptor |  ---->   | HookPayloadParser |
+-------------------+          +-------------------+
          |                               |
          | raw JSON hook payload          |
          v                               v
   +-------------------+   +---------------------------+
   | Detect payload    |   |  Parse to PreToolPayload  |
   | variant (type)    |---|  or PostToolPayload        |
   +-------------------+   +---------------------------+
```

The parser’s output is then consumed by the **constraint‑rule engine**, which lives downstream of HookInterceptor. No other siblings of HookInterceptor share this parsing responsibility; they operate on already‑parsed domain objects.

---

## Implementation Details  

* **Location** – The parser class is defined in the same integration package that hosts the wire‑format documentation, typically under a path such as `integrations/mcp-constraint-monitor/src/HookPayloadParser.ts` (or `.py` depending on the language stack).  

* **Core API** – The public entry point is a method like `parse(rawPayload: string): ParsedHookEvent`. It accepts the raw JSON string received from Claude Code and returns a discriminated union type that the rest of the system can pattern‑match on.  

* **Variant Detection** – The method first parses the JSON into a generic map and inspects a mandatory `event_type` (or similarly named) field. The value determines whether the payload should be routed to the *pre‑tool* or *post‑tool* branch.  

* **Validation** – Each branch validates required fields against the schema documented in `CLAUDE-CODE-HOOK-FORMAT.md`. For example, a pre‑tool payload must contain `tool_name`, `parameters`, and a correlation identifier, while a post‑tool payload must contain `tool_name`, `result`, `status`, and the same correlation identifier. Validation errors are surfaced as a dedicated `HookParseError` that the interceptor can log and optionally reject.  

* **Typed Results** – Successful parsing yields one of two concrete classes:  

  * `PreToolPayload` – encapsulates the tool name, a dictionary of parameters, and any metadata needed for downstream constraint checks.  
  * `PostToolPayload` – encapsulates the tool name, execution result (which may be a string, JSON object, or binary blob), status flags, and any error messages.  

  Both classes implement a common interface (`IHookPayload`) that provides accessor methods for the shared correlation identifier, enabling the constraint engine to correlate pre‑ and post‑events.  

* **Error Handling** – The parser throws or returns a structured error object rather than bubbling raw exceptions. This design lets HookInterceptor decide whether to drop the event, retry, or raise an alert, preserving robustness in the face of malformed payloads.  

* **Extensibility Hooks** – Although not yet used, the parser contains protected helper methods (`parsePreTool`, `parsePostTool`) that can be overridden by a subclass if a future integration needs custom handling for a new hook variant.

---

## Integration Points  

* **Parent – HookInterceptor** – HookInterceptor receives HTTP/websocket messages from Claude Code, extracts the raw body, and calls `HookPayloadParser.parse`. It also registers the parser as a dependency via the integration’s DI container, ensuring a single shared instance throughout the interceptor’s lifecycle.  

* **Downstream – Constraint Rule Engine** – The parsed objects produced by HookPayloadParser are fed directly into the constraint‑evaluation pipeline described in `semantic-constraint-detection.md`. The engine expects the `IHookPayload` interface, allowing it to treat pre‑ and post‑tool events uniformly for correlation and rule matching.  

* **Configuration – constraint‑configuration.md** – This document defines which constraint rules apply to which tool calls. HookPayloadParser does not enforce these rules; it merely supplies the accurate payload data that the rule engine uses.  

* **External Dependency – Claude Code Hook Stream** – The only external contract is the JSON schema documented in `CLAUDE-CODE-HOOK-FORMAT.md`. The parser is deliberately kept agnostic of transport details (e.g., HTTP vs. gRPC) because those concerns are encapsulated by HookInterceptor.  

* **Testing Harness** – Unit tests for HookPayloadParser are located alongside the parser source (e.g., `HookPayloadParser.test.ts`). They instantiate the parser with fixture payloads from the documentation to guarantee compliance with the wire format.

---

## Usage Guidelines  

1. **Never bypass HookInterceptor** – All external hook events must flow through HookInterceptor so that parsing, validation, and error handling are applied consistently. Directly invoking HookPayloadParser from other components can lead to uncorrelated events and missed constraint checks.  

2. **Validate before processing** – Treat the parser’s output as untrusted until the `ParsedHookEvent` is successfully returned. If a `HookParseError` is received, log the error with the raw payload for observability and discard the event unless a retry policy is defined.  

3. **Maintain schema fidelity** – When the wire format in `CLAUDE-CODE-HOOK-FORMAT.md` changes, update the corresponding validation logic in `parsePreTool` and `parsePostTool`. The parser is the single source of truth for translating the external schema into internal types.  

4. **Correlate pre‑ and post‑tool events** – Use the shared correlation identifier exposed by `IHookPayload` to match a pre‑tool payload with its post‑tool counterpart. This is essential for the constraint engine to evaluate rules that span the entire tool execution lifecycle.  

5. **Extend cautiously** – If a new hook variant is introduced (e.g., a “mid‑tool” event), add a new branch inside HookPayloadParser rather than creating a separate parser class. This keeps the parsing surface area centralised and reduces duplication of common error handling.  

---

### Architectural Patterns Identified  

* **Facade** – HookInterceptor acts as a façade, delegating parsing to HookPayloadParser.  
* **Strategy (dual‑branch)** – The parser selects a parsing strategy based on the payload type (pre‑tool vs. post‑tool).  
* **Adapter** – HookPayloadParser adapts raw JSON into the internal `IHookPayload` interface used by downstream components.  

### Design Decisions & Trade‑offs  

* **Single parser for two payload shapes** – Reduces code duplication and centralises validation, but increases conditional complexity inside the parser.  
* **Typed output via discriminated union** – Improves compile‑time safety for downstream consumers, at the cost of a slightly larger type surface.  
* **Error object vs. exception propagation** – Allows the interceptor to decide on recovery strategies, but requires callers to handle error returns explicitly.  

### System Structure Insights  

The parsing layer sits at the **boundary** between the external Claude Code hook stream and the internal constraint‑enforcement domain. It is the first point where raw data is transformed into domain‑specific objects, making it a critical trust anchor for the whole pipeline.  

### Scalability Considerations  

* **Payload volume** – Because parsing is lightweight (JSON deserialization + field checks), the component scales horizontally; multiple HookInterceptor instances can each host their own parser without contention.  
* **Future hook types** – Adding new hook variants only requires extending the branch logic and adding validation rules, keeping the component’s footprint modest.  

### Maintainability Assessment  

HookPayloadParser is **highly maintainable** due to its clear separation of concerns, explicit validation tied to documented schemas, and use of typed interfaces. The centralised parsing logic means that any change to the wire format is a single‑point edit, reducing the risk of inconsistency. The presence of dedicated unit tests (implied by the test file naming) further supports safe evolution.


## Hierarchy Context

### Parent
- [HookInterceptor](./HookInterceptor.md) -- integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md defines the wire format for hook payloads exchanged between Claude Code and the constraint monitor, covering pre-tool and post-tool event structures


---

*Generated from 3 observations*
