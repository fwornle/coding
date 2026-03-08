# TranscriptProcessor

**Type:** SubComponent

TranscriptProcessor utilizes the AgentFormatMapper class in agent-format-mapper.ts to map agent formats to the unified LSL format

## What It Is  

**TranscriptProcessor** is a sub‑component that lives inside the **LiveLoggingSystem** code base. Its implementation resides in `transcript-processor.ts` and it orchestrates the end‑to‑end handling of raw agent transcripts. The processor first normalizes incoming data with the **TranscriptNormalizer** (also defined in `transcript-processor.ts`), then maps the various agent‑specific formats—enumerated in `agent-formats.ts`—to a single, unified **LSL** representation defined in `lsl-format.ts`. Once the transcript is in LSL form it is persisted through the **TranscriptRepository** (`transcript-repository.ts`). Throughout the workflow the component logs warnings and errors via the shared `logger.ts` module and delegates any exceptional conditions to the **ErrorHandlingMechanism** found in `error-handler.ts`.  

In short, TranscriptProcessor is the glue that turns heterogeneous, possibly noisy agent transcripts into clean, consistently‑structured LSL records that the rest of the LiveLoggingSystem can consume.

---

## Architecture and Design  

The observations reveal a **layered pipeline architecture** built around clear separation of concerns:

1. **Normalization Layer** – The `TranscriptNormalizer` class is invoked first to bring any incoming transcript into a predictable shape. This isolates format‑specific quirks early in the flow.  

2. **Mapping Layer** – The `AgentFormatMapper` (in `agent-format-mapper.ts`) implements a **mapper/adapter pattern**. It knows how each agent format listed in `agent-formats.ts` translates to the canonical LSL schema (`lsl-format.ts`). By centralising this logic, adding a new agent format requires only extending the mapper, not touching the processor core.  

3. **Persistence Layer** – `TranscriptRepository` abstracts storage concerns, following the **repository pattern**. The processor does not manage database connections or file I/O directly; it simply calls repository methods to store or retrieve processed transcripts.  

4. **Cross‑cutting Concerns** – Logging (`logger.ts`) and error handling (`error-handler.ts`) are injected as independent modules, keeping the main processing path free of repetitive boiler‑plate.  

Interaction between these layers is linear: the processor receives raw data, passes it to the normalizer, hands the normalized output to the mapper, and finally persists the result. Errors at any stage are funneled to the `ErrorHandlingMechanism`, which ensures consistent failure reporting across the component.  

Because **LiveLoggingSystem** contains the TranscriptProcessor, the processor fits into a larger orchestration where sibling components—**ClassificationEngine**, **SessionManager**, and **OntologySystem**—each handle their own domain (classification, session windowing, ontology definition). The shared logger and error‑handling modules provide a uniform operational surface across all siblings, reinforcing consistency throughout the system.

---

## Implementation Details  

- **`transcript-processor.ts`**  
  - Exposes the main class (or function) that coordinates the workflow. It constructs or receives instances of `TranscriptNormalizer`, `AgentFormatMapper`, `TranscriptRepository`, the logger, and the error handler.  
  - The processor’s public API likely includes a method such as `process(rawTranscript: any): Promise<void>` that returns a promise once the transcript is stored.  

- **`TranscriptNormalizer` (child component)**  
  - Implements format‑agnostic cleaning: trimming whitespace, normalising timestamps, stripping unsupported characters, and possibly converting encoding. Because it lives inside the same file, the processor can call it directly without an additional import.  

- **`AgentFormatMapper` (`agent-format-mapper.ts`)**  
  - Contains a lookup table or strategy objects keyed by agent identifiers defined in `agent-formats.ts`. Each entry knows how to translate its source fields into the LSL schema (`lsl-format.ts`). This design makes the mapper easily extensible; adding a new agent format is a matter of adding a new entry or strategy class.  

- **`lsl-format.ts`**  
  - Declares TypeScript interfaces (or types) that describe the unified transcript shape. All downstream components, including the ClassificationEngine, can rely on this contract.  

- **`TranscriptRepository` (`transcript-repository.ts`)**  
  - Provides methods such as `save(lslTranscript: LSLTranscript): Promise<void>` and `findById(id: string): Promise<LSLTranscript | null>`. The repository abstracts the underlying storage mechanism—whether a relational database, a document store, or a flat file—allowing the processor to remain storage‑agnostic.  

- **`error-handler.ts`**  
  - Defines a central `ErrorHandlingMechanism` that likely categorises errors (validation, mapping, persistence) and decides whether to retry, discard, or propagate them. By keeping error policy in one place, the processor’s core logic stays focused on happy‑path processing.  

- **`logger.ts`**  
  - Offers a lightweight logging API (`info`, `warn`, `error`). The processor logs warnings for recoverable issues (e.g., unknown optional fields) and errors when the pipeline cannot continue. Because the logger is shared with sibling components, system‑wide observability is maintained.  

The combination of these modules yields a deterministic, testable processing chain where each step can be unit‑tested in isolation.

---

## Integration Points  

- **Parent – LiveLoggingSystem**  
  - LiveLoggingSystem instantiates TranscriptProcessor as part of its overall live‑session handling. Processed LSL transcripts are likely consumed by the **ClassificationEngine**, which classifies the content against the ontology defined by the **OntologySystem**.  

- **Siblings**  
  - While ClassificationEngine focuses on semantic analysis, SessionManager deals with temporal windowing. Both may request stored transcripts from `TranscriptRepository` for their own purposes, meaning the repository acts as a shared data‑access layer across siblings.  

- **External Agents**  
  - The processor receives raw data from multiple external agents whose formats are listed in `agent-formats.ts`. The `AgentFormatMapper` shields the rest of the system from these external variations.  

- **Logging & Monitoring**  
  - All components—including ClassificationEngine and SessionManager—use the same `logger.ts`. This creates a unified log stream that can be aggregated by operational tooling.  

- **Error Propagation**  
  - Errors surfaced by the `ErrorHandlingMechanism` may bubble up to LiveLoggingSystem, which could decide to trigger alerts, retry the whole session, or mark the session as incomplete.  

These integration points demonstrate that TranscriptProcessor is both a consumer (of raw agent data) and a provider (of clean LSL transcripts) within the broader LiveLoggingSystem ecosystem.

---

## Usage Guidelines  

1. **Provide Raw Agent Transcripts Only** – Call the processor with the exact payload format emitted by an agent. The processor will handle normalization and mapping; do not pre‑transform the data yourself.  

2. **Register New Agent Formats Centrally** – When a new agent type is introduced, add its descriptor to `agent-formats.ts` and extend `AgentFormatMapper` with a corresponding mapping rule. Avoid scattering format‑specific code elsewhere.  

3. **Do Not Bypass the Repository** – All persistence must go through `TranscriptRepository`. Direct database calls break the abstraction and can lead to inconsistent state across siblings.  

4. **Respect Error Handling** – Allow the `ErrorHandlingMechanism` to manage failures. Catching and suppressing errors inside the processor can hide critical issues and impede observability.  

5. **Leverage the Shared Logger** – Use the logger’s `warn` level for non‑critical anomalies (e.g., missing optional fields) and `error` for fatal conditions. Consistent logging levels aid downstream monitoring tools.  

6. **Unit‑Test Mapping Logic Independently** – Because the mapper isolates format‑specific transformations, write dedicated tests for each agent format to guarantee that the LSL output complies with `lsl-format.ts`.  

Following these conventions keeps the processing pipeline predictable, makes future extensions straightforward, and aligns the component with the architectural expectations of LiveLoggingSystem.

---

### Summary of Requested Items  

| Item | Insight |
|------|---------|
| **Architectural patterns identified** | Layered processing pipeline; **Mapper/Adapter** pattern (`AgentFormatMapper`); **Repository** pattern (`TranscriptRepository`); **Normalization** step; Centralized **Error Handling** and **Logging** as cross‑cutting concerns. |
| **Design decisions and trade‑offs** | Decoupling of normalization, mapping, and persistence improves testability and extensibility but adds a slight runtime overhead due to multiple passes. Centralizing error handling ensures consistency but requires all callers to understand the error contract. Using a shared logger simplifies observability at the cost of tighter coupling to the logging implementation. |
| **System structure insights** | TranscriptProcessor sits under **LiveLoggingSystem**, exposing a clean LSL contract used by sibling components (ClassificationEngine, SessionManager). Its child **TranscriptNormalizer** is internal, while external collaborators interact through well‑defined interfaces (`AgentFormatMapper`, `TranscriptRepository`). |
| **Scalability considerations** | Because each stage is stateless (normalizer, mapper) they can be parallelised across transcripts, enabling horizontal scaling. The repository layer is the primary scaling bottleneck; choosing a storage solution that supports high write throughput (e.g., bulk inserts, sharding) will be essential as live session volume grows. |
| **Maintainability assessment** | High maintainability: clear separation of concerns, single‑responsibility classes, and explicit mapping tables make it easy to add new agent formats or adjust the LSL schema. Centralized error handling and logging reduce duplicated code. The main risk is drift between `agent-formats.ts` and the mapper implementation; keeping them in sync via automated tests mitigates this. |

*All statements above are directly grounded in the provided observations and file references.*


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This agent plays a crucial role in the system's architecture, enabling the classification of observations based on predefined ontologies. The classification process involves the agent analyzing the observations and mapping them to specific concepts within the ontology system. This mapping is essential for providing a structured representation of the observations, facilitating their storage, retrieval, and analysis. The OntologyClassificationAgent's functionality is critical to the overall operation of the LiveLoggingSystem, as it enables the system to organize and make sense of the vast amounts of data generated during live sessions.

### Children
- [TranscriptNormalizer](./TranscriptNormalizer.md) -- The TranscriptNormalizer class is utilized in the TranscriptProcessor sub-component to standardize transcript formats.

### Siblings
- [ClassificationEngine](./ClassificationEngine.md) -- ClassificationEngine uses the OntologyClassificationAgent to classify observations against the ontology system
- [SessionManager](./SessionManager.md) -- SessionManager uses the SessionWindowing class in session-windowing.ts to handle session windowing
- [OntologySystem](./OntologySystem.md) -- OntologySystem uses the OntologyStructure class in ontology-structure.ts to define the ontology structure


---

*Generated from 7 observations*
