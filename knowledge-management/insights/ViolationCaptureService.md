# ViolationCaptureService

**Type:** SubComponent

The sub-component supports customizable violation handling through its configure function in violation-capture-service.ts, allowing users to define custom responses to different types of violations

## What It Is  

The **ViolationCaptureService** lives in the *violation‑capture‑service.ts* file of the ConstraintSystem repository. It is a dedicated sub‑component whose sole responsibility is to **capture, persist, encrypt, and expose queryable history of constraint violations** that are raised by the surrounding constraint enforcement pipeline.  The service works against the `Violation` interface defined in *violation.ts* and stores the resulting records through the persistence layer in *violation‑persistence.ts*.  Its public API is centred around three high‑level operations:  

1. **captureViolation** – receives a violation payload (type, severity, context) and decides how to react.  
2. **configure** – lets callers register custom handlers for particular violation categories.  
3. **query** – provides a read‑only view of the stored violation history for downstream analysis (e.g., by the sibling *StatisticsCalculator*).  

All data that traverses the service is encrypted in‑flight and at rest, guaranteeing that sensitive violation details cannot be exposed inadvertently.

---

## Architecture and Design  

The observations point to an **event‑driven architecture** inside *violation‑capture‑service.ts*.  When a constraint check fails, an event is raised that the service consumes via `captureViolation`.  The function treats the event as a *command* that carries metadata (type, severity, context) and routes it to the appropriate handling path.  This routing logic is configurable through the `configure` method, which registers callbacks or strategies for distinct violation types – a classic **Strategy pattern** realized at runtime.  

Persisting violations is delegated to a separate module, *violation‑persistence.ts*.  By isolating storage concerns, the design follows the **Single Responsibility Principle** and creates a thin **persistence façade** that can swap underlying stores (database, file system) without affecting the capture logic.  The encryption step is performed before the persistence façade is invoked, indicating a **Decorator‑like** step that augments the raw violation object with security guarantees.  

The service also exposes a **query interface** that other components (e.g., *StatisticsCalculator*) can call to retrieve historical data.  This read‑only contract is consistent with the **CQRS (Command Query Responsibility Segregation)** idea: commands (`captureViolation`) mutate state, while queries only read it.  Although the broader system does not explicitly label itself as CQRS, the separation is evident in the code organization.

Within the parent **ConstraintSystem**, ViolationCaptureService sits alongside peers such as *WorkflowLayoutComputer* and *ContentValidationAgent*.  All three share the same modular philosophy: each sub‑component encapsulates a distinct aspect of constraint enforcement (layout computation, content validation, violation handling) and can be evolved independently.  This modularity is reinforced by the parent’s “clear separation of concerns” description.

---

## Implementation Details  

### Core Types  
* `Violation` (defined in *violation.ts*) – a typed contract that carries `type`, `severity`, `context`, and any additional metadata required for downstream processing.  

### Capture Path – `captureViolation` (violation‑capture‑service.ts)  
The function receives a `Violation` instance, inspects its `type` and `severity`, and then looks up a handler in an internal registry populated by `configure`.  If a custom handler exists, it is invoked; otherwise a default response (e.g., logging and persisting) is applied.  The decision matrix is explicitly based on the three attributes highlighted in the observations, ensuring that each violation can be treated uniquely.  

### Customization – `configure` (violation‑capture‑service.ts)  
`configure` accepts a mapping from violation identifiers to handler functions.  This enables clients of the ConstraintSystem to inject domain‑specific logic (such as escalation to an external ticketing system) without modifying the service’s core code.  The registration is stored in a private map, which `captureViolation` consults at runtime.  

### Encryption Layer  
Before any persistence call, the service runs the violation payload through an encryption routine (still located in *violation‑capture‑service.ts*).  The encrypted blob is then handed to the persistence façade, guaranteeing that both storage and transmission are protected.  The exact algorithm is not disclosed in the observations, but its placement indicates a **defense‑in‑depth** approach.  

### Persistence – *violation‑persistence.ts*  
This module abstracts the underlying store.  Its public API likely includes `save(encryptedViolation)` and `fetch(queryParams)`.  Because the observations mention “database or file system,” the implementation probably contains conditional logic or interchangeable adapters, allowing the system to run in environments with different durability requirements.  

### Query Mechanism – `query` (violation‑capture‑service.ts)  
`query` pulls data from the persistence layer, decrypts it, and returns a collection of `Violation` objects.  The sibling *StatisticsCalculator* can consume this output to compute aggregates such as violation frequency, severity distribution, or trend analysis.  The query interface is read‑only, reinforcing the separation between mutation (capture) and observation (query).  

---

## Integration Points  

1. **Parent – ConstraintSystem**  
   The ConstraintSystem orchestrates the overall constraint enforcement workflow.  When a rule violation is detected (for example, by the *ContentValidationAgent*), the system forwards the event to ViolationCaptureService’s `captureViolation`.  This tight coupling is limited to the well‑defined `Violation` contract, keeping the interaction surface small.  

2. **Siblings**  
   *StatisticsCalculator* consumes the query API to generate reports on violation trends, while *WorkflowLayoutComputer* and *ContentValidationAgent* do not directly interact with ViolationCaptureService but share the same modular design language.  The common use of typed interfaces (e.g., `Violation`) and similar configuration patterns suggests a shared architectural vocabulary across siblings.  

3. **Persistence Layer**  
   The service depends on *violation‑persistence.ts* for durable storage.  Because the persistence module abstracts the concrete store, ViolationCaptureService can be deployed in environments ranging from in‑memory testing rigs to production databases, without code changes.  

4. **External Consumers**  
   Any component that needs to react to violations—such as alerting pipelines, audit logs, or compliance dashboards—can register custom handlers via `configure`.  This extension point is the primary way the service integrates with external systems while preserving its core responsibilities.  

---

## Usage Guidelines  

- **Always define a `Violation` object** that fully populates `type`, `severity`, and `context` before invoking `captureViolation`.  Missing fields may cause the default handler to be used, which might not meet domain‑specific requirements.  
- **Leverage `configure` early in application startup** to register all needed custom handlers.  Because the registry is consulted at runtime, adding handlers after violations have been captured will not retroactively affect already stored records.  
- **Prefer the query API for read‑only analysis**; do not attempt to mutate returned violation objects, as they are snapshots of encrypted data that have already been persisted.  Use the query results as input to the sibling *StatisticsCalculator* or other reporting tools.  
- **Treat the persistence layer as a black box**; if you need to change the underlying storage (e.g., switch from a file system to a relational database), modify *violation‑persistence.ts* only.  The rest of the service will continue to operate unchanged thanks to the façade pattern.  
- **Maintain encryption keys securely** and rotate them according to your organization’s security policy.  Since encryption is performed inside the service, any compromise of the key material will affect all stored violations.  

---

### Summary of Requested Items  

1. **Architectural patterns identified** – Event‑driven processing, Strategy (runtime handler registration), Single Responsibility (persistence façade), Decorator‑style encryption, CQRS‑like separation of command and query.  
2. **Design decisions and trade‑offs** – Decoupling capture from persistence enables flexible storage choices; configurable handlers give extensibility at the cost of runtime lookup overhead; encryption adds security but introduces key‑management complexity.  
3. **System structure insights** – ViolationCaptureService sits as a leaf sub‑component under ConstraintSystem, interacting with sibling modules via shared contracts (`Violation`) and providing a query surface for analytics (used by StatisticsCalculator).  
4. **Scalability considerations** – Because capture is event‑driven and persistence is abstracted, the service can scale horizontally by adding more instances behind a load balancer; the encryption step is stateless, allowing parallel processing.  Bottlenecks may appear in the persistence backend, so choosing a scalable store (e.g., a clustered DB) is advisable.  
5. **Maintainability assessment** – High maintainability: clear separation of concerns, small public API, and isolated persistence.  The configuration mechanism centralizes custom logic, reducing code duplication.  The primary maintenance risk lies in the encryption subsystem and ensuring that key rotation does not disrupt ongoing capture operations.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes a modular design, with sub-components such as the ContentValidationAgent and the ViolationCaptureService, each responsible for a specific aspect of constraint enforcement. For instance, the ContentValidationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts, uses filePathPatterns and commandPatterns to extract references from entity content, demonstrating a clear separation of concerns. This modular approach allows for easier maintenance and updates, as each sub-component can be modified or extended independently without affecting the overall system.

### Siblings
- [WorkflowLayoutComputer](./WorkflowLayoutComputer.md) -- WorkflowLayoutComputer uses a graph-based data structure in workflow-layout-computer.ts to model workflow dependencies and compute layouts
- [StatisticsCalculator](./StatisticsCalculator.md) -- StatisticsCalculator uses a data aggregation approach in statistics-calculator.ts to compute statistics from violation history
- [ContentValidationAgent](./ContentValidationAgent.md) -- ContentValidationAgent uses a rules-based approach in content-validation-agent.ts to validate entity content against predefined constraints


---

*Generated from 7 observations*
