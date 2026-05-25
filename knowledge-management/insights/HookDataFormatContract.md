# HookDataFormatContract

**Type:** Detail

This contract is referenced by the semantic detection pipeline documented in integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md and integrations/mcp-constraint-monitor/docs/semantic-detection-design.md

## What It Is  

**HookDataFormatContract** is the formal contract that defines the JSON payload emitted by Claude Code at each *hook point* and consumed by the **constraint‑monitor** integration. The authoritative specification lives in the markdown file  

```
integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
```  

This document describes every field, required vs. optional attributes, and the expected data types. It is the single source of truth for both the **hook producer** (Claude Code) and the **hook consumer** (the constraint‑monitor pipeline). The contract is a child of the broader **HookExtensionPattern** (documented alongside it in the same markdown file) and is referenced by the semantic detection components documented in  

```
integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md
integrations/mcp-constraint-monitor/docs/semantic-detection-design.md
```  

In practice, any component that wishes to emit a Claude Code hook must serialize its data to match this contract, and any component that wishes to evaluate architectural constraints must deserialize the same structure.

---

## Architecture and Design  

The architecture surrounding **HookDataFormatContract** follows a **contract‑first, producer‑consumer** model. The contract is defined *up‑front* in a markdown specification, which then drives implementation in two orthogonal directions:

1. **Producer side (Claude Code)** – serializes runtime context into the JSON shape described in the contract.  
2. **Consumer side (constraint‑monitor)** – parses the incoming JSON, validates it against the contract, and feeds the data into the **SemanticConstraintHook** pipeline for constraint evaluation.

This pattern mirrors a **message‑based integration** where the payload format is the stable interface. Because the contract lives in a *documentation‑only* file, the design relies on **implicit code generation or runtime validation** rather than a compiled interface (e.g., a TypeScript type). The sibling component **SemanticConstraintHook** shares the same contract, reinforcing a **shared‑schema** approach: multiple downstream processors can read the same payload without needing bespoke adapters.

Interaction flow (high‑level):

```
Claude Code  ──►  HookDataFormatContract (JSON)  ──►  Constraint‑Monitor
                                                          │
                                                          ▼
                                                SemanticConstraintHook
```

The **HookExtensionPattern** acts as the logical parent, encapsulating the idea that any “hook” in the system must conform to a defined data format. By placing the contract under this pattern, the architecture enforces a *uniform hook contract* across the platform, simplifying onboarding of new hook producers and consumers.

---

## Implementation Details  

Although the repository contains **zero code symbols** directly referencing the contract, the implementation details are captured in the specification file:

* **Field definitions** – each top‑level key (e.g., `hookId`, `timestamp`, `sourceFile`, `language`, `astSnapshot`) is explicitly listed with its type (string, integer, object) and whether it is required.  
* **Nested structures** – complex data such as an abstract‑syntax‑tree (AST) snapshot is described as a nested JSON object with its own sub‑schema.  
* **Versioning hints** – the spec includes a `contractVersion` field, allowing future extensions while preserving backward compatibility.  

The **constraint‑monitor** integration (see `integrations/mcp-constraint-monitor/README.md`) implements the consumer side. It reads the raw HTTP POST body, parses the JSON, and runs a **schema validation step** (likely using a JSON‑schema validator or a custom validator derived from the markdown). After validation, the data is handed to the **semantic detection pipeline** (documented in `semantic-constraint-detection.md` and `semantic-detection-design.md`). Those pipelines treat the payload as a read‑only data source; they do not mutate it, reinforcing immutability.

Because there are no concrete classes or functions listed, the contract’s “implementation” is effectively **declarative**: developers must manually keep their serialization logic aligned with the markdown. The absence of generated code means the contract is language‑agnostic and can be consumed by any runtime capable of JSON parsing.

---

## Integration Points  

1. **Claude Code Hook Producer** – any module that emits a Claude Code hook must import the specification from `CLAUDE-CODE-HOOK-FORMAT.md` and ensure its output matches the defined schema. This is the *upstream* integration point.  

2. **Constraint‑Monitor Consumer** – the `integrations/mcp-constraint-monitor/README.md` describes how the monitor subscribes to hook events (typically via an HTTP endpoint). It validates incoming payloads against the contract before invoking downstream analysis.  

3. **SemanticConstraintHook** – documented alongside the contract, this sibling component consumes the same payload to perform **semantic constraint detection**. It relies on the same field names and structures, allowing the two consumers to operate in parallel without duplication of parsing logic.  

4. **Semantic Detection Pipeline** – the detection design documents (`semantic-constraint-detection.md`, `semantic-detection-design.md`) reference the contract to explain how AST snapshots and language metadata are used to evaluate architectural rules. The pipeline expects the contract to be stable; any change to field names would require coordinated updates across these documents.

All integration points are *loose* (HTTP/JSON) and therefore agnostic to language or deployment environment. The only hard dependency is the **schema agreement** defined in the markdown contract.

---

## Usage Guidelines  

* **Strict adherence to the schema** – before emitting a hook, run the payload through a validation step that mirrors the rules in `CLAUDE-CODE-HOOK-FORMAT.md`. Missing required fields or type mismatches will cause the constraint‑monitor to reject the event.  

* **Version management** – include the `contractVersion` field in every payload. When the contract evolves, increment this version and maintain backward‑compatible parsing in the consumer. Consumers should reject unknown versions unless explicitly supported.  

* **Immutability** – treat the hook payload as immutable once emitted. Downstream components (semantic detection, constraint evaluation) should never modify the original JSON; instead, derive new objects if transformation is needed.  

* **Minimal payload** – only populate optional fields when the information is truly available. This reduces bandwidth and keeps the contract lean, which is important for scalability when many hooks are emitted in rapid succession.  

* **Documentation sync** – any change to the payload structure must be reflected immediately in `CLAUDE-CODE-HOOK-FORMAT.md`. Because the markdown file is the single source of truth, out‑of‑sync documentation will break both producer and consumer implementations.  

* **Testing** – include unit tests that serialize a representative data object, validate against the contract, and deserialize it on the consumer side. This ensures both sides stay aligned as the contract evolves.

---

### Architectural Patterns Identified  

1. **Contract‑First Message Passing** – the payload contract is defined before any code, guiding both producer and consumer.  
2. **Shared Schema / Sibling Consumer** – multiple downstream components (SemanticConstraintHook) share the same contract, promoting reuse.  
3. **Loose Coupling via HTTP/JSON** – integration is performed through language‑agnostic JSON over HTTP, enabling independent deployment.  

### Design Decisions & Trade‑offs  

* **Documentation‑Only Contract** – choosing a markdown specification avoids language‑specific interface files, increasing flexibility but requiring manual validation or external tooling.  
* **Version Field** – embedding a version number provides forward compatibility at the cost of added payload size and the need for version‑aware parsers.  
* **No Generated Code** – reduces build‑time complexity but places the burden of schema fidelity on developers.  

### System Structure Insights  

The system is organized around a **hierarchical hook pattern**: the parent **HookExtensionPattern** defines the concept of a hook, the child **HookDataFormatContract** specifies the concrete payload, and siblings like **SemanticConstraintHook** consume that payload. This hierarchy enforces a clear separation between *definition* (contract) and *behavior* (semantic detection).  

### Scalability Considerations  

Because the contract is lightweight JSON and the integration uses standard HTTP, the system can scale horizontally by adding more consumer instances behind a load balancer. The **contractVersion** field allows rolling upgrades without downtime. However, the lack of binary schema enforcement means validation must be performed at runtime, which could become a bottleneck under extremely high event rates; caching compiled validators can mitigate this.  

### Maintainability Assessment  

Maintainability is high for teams disciplined about keeping the markdown contract synchronized with code. The single source of truth reduces duplication, and the shared‑schema approach means new consumers can be added with minimal effort. The primary risk is **drift** between documentation and implementation; automated tests that compare generated JSON against the markdown schema are essential to preserve integrity over time.


## Hierarchy Context

### Parent
- [HookExtensionPattern](./HookExtensionPattern.md) -- integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md documents the data format Claude Code emits at hook points, defining the contract between the hook producer and constraint-monitor consumer

### Siblings
- [SemanticConstraintHook](./SemanticConstraintHook.md) -- integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md documents the semantic detection hook behavior and its role in evaluating constraints at hook points


---

*Generated from 3 observations*
