# TranscriptManager

**Type:** SubComponent

The TranscriptAdapter class utilizes the LSLConverter class in lib/agent-api/transcripts/lsl-converter.js for converting between agent-native transcript formats and the unified LSL format.

## What It Is  

**TranscriptManager** is the sub‑component responsible for normalising all agent‑generated conversation logs into a single, system‑wide representation.  The core implementation lives under the **LiveLoggingSystem** hierarchy and directly references two concrete files:  

* `lib/agent‑api/transcript‑api.js` – houses the **TranscriptAdapter** class that mediates between an agent’s native transcript format and the internal representation.  
* `lib/agent‑api/transcripts/lsl‑converter.js` – provides the **LSLConverter** used by the adapter to translate to and from the unified **LSL** (Live‑Logging Standard) format.  

By converting every incoming transcript to the LSL format, TranscriptManager enables downstream services—such as the **OntologyClassifier** and **LoggingService**—to treat logs uniformly, regardless of whether they originated from Claude, Copilot, or any future agent.

---

## Architecture and Design  

The design follows a classic **Adapter** pattern anchored by the **TranscriptAdapter** interface.  Each agent supplies its own concrete adapter that implements the interface, while the shared **LSLConverter** supplies the actual format‑translation logic.  This separation of concerns yields two distinct layers:

1. **Agent‑specific adapters** (e.g., a ClaudeAdapter, CopilotAdapter) that understand the peculiarities of a given agent’s native transcript schema.  
2. **Unified conversion engine** (`LSLConverter`) that knows how to map any native schema onto the LSL canonical model.

The **TranscriptManager** itself is a thin orchestration layer that holds a **TranscriptConverter** child component.  The converter delegates the heavy lifting to the appropriate adapter, which in turn calls `LSLConverter`.  Because **LiveLoggingSystem** contains TranscriptManager, the manager sits at the entry point for all logging data, feeding a standardised stream into sibling components such as **LoggingService** (for persistence) and **OntologyClassifier** (for semantic categorisation).

The architecture is deliberately **modular**: new agents are integrated by adding a new adapter implementation without touching existing conversion code.  This aligns with the **Open/Closed Principle**—the system is open for extension (new adapters) but closed for modification (core conversion pipeline remains unchanged).

---

## Implementation Details  

* **TranscriptAdapter (lib/agent‑api/transcript‑api.js)** – defines the contract that every agent‑specific adapter must fulfil (e.g., `toLSL(transcript)`, `fromLSL(lslObject)`).  The class itself may be abstract, with concrete subclasses supplied by the **AgentIntegrationManager** when a new agent is registered.  

* **LSLConverter (lib/agent‑api/transcripts/lsl‑converter.js)** – implements the bidirectional mapping between native transcript structures and the LSL JSON schema.  It encapsulates all field‑level transformations (timestamps, speaker identifiers, message payloads) and guarantees that the resulting LSL object satisfies the schema expected by downstream services.  

* **TranscriptManager** – holds a reference to **TranscriptConverter**, which is responsible for selecting the correct adapter based on the agent identifier attached to each incoming transcript.  The manager’s workflow is roughly:  
  1. Receive raw transcript from an agent via the **AgentIntegrationManager**.  
  2. Resolve the appropriate **TranscriptAdapter** implementation.  
  3. Invoke the adapter’s `toLSL` method, which internally calls **LSLConverter**.  
  4. Store the resulting LSL object in the unified log store, making it available to **LoggingService** and **OntologyClassifier**.  

Because the observations do not expose concrete method signatures, the description stays at the class‑level but remains faithful to the documented file locations and responsibilities.

---

## Integration Points  

* **Parent – LiveLoggingSystem**: TranscriptManager is embedded within LiveLoggingSystem, acting as the gateway for all transcript data before it reaches the broader logging pipeline.  Any configuration or lifecycle management performed by LiveLoggingSystem (e.g., start‑up ordering) directly impacts TranscriptManager.  

* **Sibling Components**:  
  * **LoggingService** consumes the unified LSL logs produced by TranscriptManager for persistence and audit trails.  
  * **OntologyClassifier** reads the same LSL objects to perform semantic categorisation, relying on the consistency guaranteed by the adapter‑converter chain.  
  * **AgentIntegrationManager** is the orchestrator that registers new agents and supplies the concrete **TranscriptAdapter** implementations that TranscriptManager will later invoke.  

* **Child – TranscriptConverter**: This internal component encapsulates the lookup logic for adapters and the invocation of **LSLConverter**.  It abstracts the selection mechanism away from TranscriptManager, keeping the manager’s responsibilities focused on high‑level orchestration.  

* **External Dependency – LSLConverter**: Although listed as a sibling, the **LSLConverter** is effectively a shared library used by every adapter.  Its stable API is a critical contract; any change to the LSL schema would ripple through all adapters and must be coordinated with the OntologyClassifier and LoggingService.

---

## Usage Guidelines  

1. **Implement the TranscriptAdapter Interface** – When adding a new agent, developers must create a class that implements the methods defined in `lib/agent-api/transcript-api.js`.  The implementation should delegate all format‑specific logic to `LSLConverter` to avoid duplicating conversion rules.  

2. **Register the Adapter with AgentIntegrationManager** – The new adapter must be wired into the system via the AgentIntegrationManager so that TranscriptManager can resolve it at runtime.  Failure to register will result in transcripts being dropped or logged as “unsupported format”.  

3. **Maintain LSL Schema Compatibility** – Any alteration to the LSL format must be reflected in `lsl-converter.js`.  Because OntologyClassifier and LoggingService depend on the schema, changes should be versioned and communicated across those components.  

4. **Prefer Stateless Adapters** – Adapters should avoid retaining mutable state between calls.  Stateless design simplifies scaling (multiple instances of TranscriptManager can run in parallel) and reduces the risk of cross‑talk between concurrent transcript streams.  

5. **Leverage TranscriptConverter for Adapter Lookup** – Directly invoking adapters from outside the manager bypasses the conversion pipeline and can lead to inconsistent logging.  All external callers should route transcripts through TranscriptManager’s public API, which internally uses TranscriptConverter.

---

### Architectural Patterns Identified  

* **Adapter Pattern** – realised through the `TranscriptAdapter` interface and concrete per‑agent adapters.  
* **Facade (lightweight)** – `TranscriptManager` acts as a façade that hides the complexity of adapter selection and LSL conversion from callers.  
* **Strategy‑like Selection** – `TranscriptConverter` chooses the appropriate adapter at runtime based on agent metadata, embodying a simple strategy mechanism.

### Design Decisions and Trade‑offs  

* **Extensibility vs. Boilerplate** – By requiring a full adapter per agent, the system gains clear extension points but introduces repetitive boiler‑plate code.  The trade‑off is justified by the need for agent‑specific handling (e.g., unique metadata).  
* **Single Unified Format (LSL)** – Centralising on LSL simplifies downstream processing but creates a single point of failure; any schema drift must be managed carefully.  
* **Thin Orchestration Layer** – Keeping TranscriptManager lightweight improves testability and allows independent scaling of the conversion logic, at the cost of an extra indirection layer (TranscriptConverter).

### System Structure Insights  

* **Hierarchical Nesting** – LiveLoggingSystem → TranscriptManager → TranscriptConverter → TranscriptAdapter → LSLConverter.  
* **Sibling Collaboration** – Shared reliance on LSL format creates a tight coupling between TranscriptManager, LoggingService, and OntologyClassifier, encouraging coordinated schema evolution.  
* **Clear Separation of Concerns** – Adapters handle agent‑specific quirks; LSLConverter handles universal mapping; the manager orchestrates flow, preserving modularity.

### Scalability Considerations  

* **Stateless Converters** enable horizontal scaling of TranscriptManager instances behind a load balancer.  
* **Adapter Registry** can be cached to minimise lookup overhead in high‑throughput scenarios.  
* **Unified LSL Payload Size** should be monitored; if agents produce very large transcripts, streaming or chunked conversion may be required to avoid memory pressure.

### Maintainability Assessment  

The adapter‑centric design yields high maintainability for adding new agents: developers only need to implement a small, well‑defined interface.  The centralised `LSLConverter` reduces duplicated conversion logic, making schema updates easier.  However, the tight coupling to the LSL schema means that any change propagates to multiple siblings, demanding disciplined versioning and thorough integration testing.  Overall, the architecture balances extensibility with manageable complexity, provided that the LSL contract is guarded vigilantly.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component's modular architecture is notable, with the TranscriptAdapter class (lib/agent-api/transcript-api.js) serving as a key adapter for converting between different transcript formats. This enables support for multiple agents, such as Claude and Copilot, and facilitates standardized logging and analysis. The TranscriptAdapter class, for instance, utilizes the LSLConverter class (lib/agent-api/transcripts/lsl-converter.js) for converting between agent-native transcript formats and the unified LSL format. This design decision allows for flexibility and extensibility in the system, as new agents can be integrated by implementing the TranscriptAdapter interface.

### Children
- [TranscriptConverter](./TranscriptConverter.md) -- The TranscriptManager sub-component uses the TranscriptAdapter class in lib/agent-api/transcript-api.js to convert between different transcript formats, indicating a design decision to leverage adapters for format compatibility.

### Siblings
- [LoggingService](./LoggingService.md) -- LoggingService logs system activities, including errors, warnings, and informational messages, to facilitate debugging and system monitoring.
- [OntologyClassifier](./OntologyClassifier.md) -- OntologyClassifier uses an ontology system to classify observations and categorize logged data.
- [AgentIntegrationManager](./AgentIntegrationManager.md) -- AgentIntegrationManager handles the integration of new agents into the system.
- [LSLConverter](./LSLConverter.md) -- LSLConverter uses the LSL format to convert between agent-native transcript formats.


---

*Generated from 7 observations*
