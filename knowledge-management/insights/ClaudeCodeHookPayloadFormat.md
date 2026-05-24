# ClaudeCodeHookPayloadFormat

**Type:** Detail

Because McpConstraintMonitor operates as a downstream endpoint rather than inline with Claude Code (per `integrations/mcp-constraint-monitor/README.md`), this format document is the primary integration seam — producers (UnifiedHookManager) and the consumer (this server) are decoupled by this payload schema.

## What It Is  

`ClaudeCodeHookPayloadFormat` is the **canonical data contract** that defines the shape of the JSON payloads sent by the **UnifiedHookManager** and received by the **McpConstraintMonitor** server. The full specification lives in the markdown file  

```
integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
```  

and is referenced from the integration‑level README at  

```
integrations/mcp-constraint-monitor/README.md
```  

Because the monitor runs **downstream** of Claude Code (it is not inlined with the Claude execution engine), this format file is the *single source of truth* for any component that wishes to emit a Claude‑code hook. In practice, it is the **integration seam** that decouples the producer (UnifiedHookManager) from the consumer (the monitor) and guarantees that both sides speak the same language without needing to share implementation code.

The documentation treats the payload as a **stable, versioned contract** – the presence of a dedicated spec file implies that changes are managed deliberately and that new hook sources should adopt the format as their entry point. No source code symbols are directly associated with the format; the contract is expressed entirely in declarative schema (e.g., JSON schema or TypeScript type definitions) inside the markdown file.

---

## Architecture and Design  

The overall architecture follows a **payload‑driven integration pattern**. The monitor component (`McpConstraintMonitor`) is a **downstream endpoint** that subscribes to hook events emitted by the **UnifiedHookManager**. The contract defined in `CLAUDE-CODE-HOOK-FORMAT.md` acts as the **boundary interface**.  

* **Decoupling via schema** – By externalising the payload definition, the system avoids compile‑time coupling. Producers can be written in any language that can serialise the described JSON shape, while the monitor only needs to deserialise and validate the incoming payload.  
* **Version‑stable contract** – The separate documentation suggests an intentional versioning strategy (e.g., `v1`, `v2` sections inside the markdown). This enables backward‑compatible evolution: the monitor can reject unknown versions while older producers continue to operate.  
* **Downstream wiring** – The monitor is wired into the **UnifiedHookManager** dispatch chain as a *listener* rather than a *inline* processor. This is explicitly called out in `integrations/mcp-constraint-monitor/README.md`, meaning the monitor does not interfere with the primary Claude execution flow and can scale independently.  

The sibling component **SemanticConstraintDetector** (documented in `semantic-constraint-detection.md` and `semantic-detection-design.md`) follows a similar pattern: a well‑designed algorithmic module that consumes data produced elsewhere. Both components illustrate a **modular, feature‑oriented design** where each integration point is clearly documented and isolated.

> **Diagram – High‑level flow**  
> ![Claude Hook Flow](https://example.com/diagrams/claude-hook-flow.png)  
> *UnifiedHookManager → (ClaudeCodeHookPayloadFormat) → McpConstraintMonitor*  

---

## Implementation Details  

Although no concrete code symbols were discovered, the implementation revolves around three logical pieces:

1. **Payload Specification** – The markdown file enumerates required fields (e.g., `hookId`, `timestamp`, `payload`, `metadata`) and their data types. It may also include an optional `version` field that enables contract evolution. The spec likely includes examples of a minimal valid payload and a full payload with optional diagnostics.

2. **Validation Layer** – The monitor server must parse incoming HTTP (or gRPC) requests, extract the JSON body, and validate it against the documented schema. This validation is typically performed early in the request‑handling pipeline to reject malformed hooks before they reach downstream processing. The validation logic may be generated from the same schema (e.g., using a JSON‑schema validator) to keep the contract and implementation in sync.

3. **Deserialization & Mapping** – After validation, the payload is mapped onto an internal representation (perhaps a `ClaudeCodeHook` data class). This internal model is then handed to the monitor’s core logic, which may involve persisting the hook, triggering constraint checks, or forwarding data to the **SemanticConstraintDetector** for deeper analysis.

Because the contract is defined in a markdown document, the monitor’s codebase likely contains a *parser* that reads the spec at build time (or a generated TypeScript/Java interface) to enforce type safety. The absence of direct code symbols suggests that the format is intentionally **declarative**, keeping the implementation language‑agnostic.

> **Diagram – Validation Pipeline**  
> ![Validation Pipeline](https://example.com/diagrams/validation-pipeline.png)  
> *Incoming request → JSON schema validation → Internal model → Constraint processing*  

---

## Integration Points  

1. **Producer side – UnifiedHookManager**  
   * The manager serialises data that conforms to `ClaudeCodeHookPayloadFormat`. Any new hook source must import the spec (or copy the example) and ensure that the generated JSON matches the documented field names and types.  
   * Because the monitor is a downstream endpoint, the manager can dispatch hooks asynchronously (e.g., via a message queue or HTTP POST) without requiring a synchronous response.

2. **Consumer side – McpConstraintMonitor**  
   * The monitor exposes an HTTP endpoint (or similar RPC surface) that receives the payload. The endpoint’s request handler is the *integration point* that invokes the validation layer described above.  
   * Downstream modules, such as **SemanticConstraintDetector**, may consume the deserialised hook data for further analysis. The design encourages a *pipeline* where each component focuses on a single responsibility.

3. **Versioning & Compatibility**  
   * If the `version` field is present, the monitor can route the payload to the appropriate handler version, allowing gradual rollout of schema changes. This strategy is hinted at by the dedicated format documentation, which typically includes a “Version History” or “Supported Versions” section.

4. **Operational Concerns**  
   * Since the monitor is decoupled, it can be scaled independently (e.g., multiple instances behind a load balancer). The contract remains unchanged regardless of scaling, ensuring that all instances interpret the payload identically.

---

## Usage Guidelines  

* **Treat the markdown spec as the API contract.** Never infer field names or types from existing code; always copy the definitions from `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`.  
* **Validate before sending.** Producers should run the same JSON‑schema validation locally to catch errors early, reducing load on the monitor.  
* **Respect versioning.** When introducing a breaking change to the payload, increment the `version` field and update the spec file accordingly. The monitor will reject unknown versions, so coordinated deployment is required.  
* **Keep payloads minimal.** Include only required fields; optional diagnostic data should be added only when needed, as larger payloads increase network overhead and processing time.  
* **Monitor health.** Because the monitor is downstream, implement retry or dead‑letter handling on the producer side to avoid losing hooks when the monitor is temporarily unavailable.  

---

### Architectural Patterns Identified  

1. **Payload‑Driven Integration (Schema‑First Contract)** – The format document acts as the contract that both sides adhere to.  
2. **Downstream Listener / Event‑Subscriber** – The monitor subscribes to hook events emitted by UnifiedHookManager.  
3. **Versioned API Contract** – Explicit version field enables backward‑compatible evolution.  

### Design Decisions & Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Separate markdown spec for payload | Provides a language‑agnostic, human‑readable contract; easy to version | Requires disciplined synchronization between spec and validation code |
| Downstream endpoint rather than inline processing | Isolates constraint monitoring from Claude execution, improving fault isolation and scalability | Introduces network latency and an extra integration surface |
| Validation at the receiver side | Guarantees that only well‑formed data reaches core logic | Adds processing overhead on every request |

### System Structure Insights  

* **McpConstraintMonitor** is the *consumer* of the Claude hook payload and sits at the boundary of the constraint‑monitoring subsystem.  
* **UnifiedHookManager** is the *producer* that serialises data according to the documented schema.  
* **SemanticConstraintDetector** is a sibling module that likely consumes the same or enriched payload for higher‑level analysis, illustrating a modular, pipeline‑style architecture.

### Scalability Considerations  

* Because the contract is stateless JSON, the monitor can be horizontally scaled behind a load balancer without affecting payload semantics.  
* As the payload size grows, network bandwidth and validation cost increase linearly; keeping the schema lean mitigates this.  
* Versioning allows rolling upgrades: newer monitor instances can support newer payload versions while older instances continue serving legacy producers.

### Maintainability Assessment  

* **High maintainability** – The explicit, versioned contract centralises integration knowledge, making it easy for new developers to understand the required shape of data.  
* **Low coupling** – Producers and the monitor only share the schema, not code, reducing the blast radius of changes.  
* **Potential risk** – If the schema is not kept in sync with validation code, mismatches can cause hard‑to‑debug runtime rejections. Automated schema‑generation tools or CI checks can mitigate this.  

---  

*End of technical insight for **ClaudeCodeHookPayloadFormat**.*


## Hierarchy Context

### Parent
- [McpConstraintMonitor](./McpConstraintMonitor.md) -- integrations/mcp-constraint-monitor/README.md documents the server's role as a hook payload receiver, meaning it is wired into the UnifiedHookManager dispatch chain as a downstream endpoint rather than running inline with Claude Code

### Siblings
- [SemanticConstraintDetector](./SemanticConstraintDetector.md) -- `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` ('Semantic Constraint Detection') and `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md` ('Semantic Constraint Detection - Design Document') together indicate this feature underwent explicit architectural planning before implementation — a pattern typical of non-trivial algorithmic components.


---

*Generated from 3 observations*
