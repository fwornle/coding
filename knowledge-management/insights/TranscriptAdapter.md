# TranscriptAdapter

**Type:** SubComponent

The TranscriptAdapter's adapter logic is likely defined in a separate file or module, allowing for easy modification and extension of the adapter pipeline.

## What It Is  

The **TranscriptAdapter** is an abstract base class that lives in the file **`lib/agent-api/transcript-api.js`**.  Its sole purpose is to define a contract – the `adaptTranscript` method – that concrete, agent‑specific adapters must implement.  By converting the raw, agent‑dependent transcript format into a **standardized representation**, the adapter enables downstream components (most notably the **TranscriptProcessor** and the **OntologyClassificationAgent**) to work with a uniform data shape.  The adapter is a child of the **LiveLoggingSystem** component, which orchestrates logging, classification, and formatting for live conversational sessions.  

## Architecture and Design  

The design of the TranscriptAdapter follows a classic **Adapter pattern** combined with **polymorphic inheritance**.  An abstract class defines the required interface (`adaptTranscript`), while each agent supplies its own concrete subclass that knows how to translate that agent’s native transcript structure.  This approach isolates agent‑specific parsing logic from the rest of the system, allowing the **TranscriptProcessor** to treat every transcript uniformly.  

Because the adapter logic “is likely defined in a separate file or module” (Observation 4), the system encourages a **plug‑in style architecture**.  New adapters can be added by dropping a new subclass into the appropriate module and, if the optional registration/discovery feature is implemented (Observation 5), the adapter can self‑register with a central registry.  This keeps the **LiveLoggingSystem** loosely coupled to any particular agent implementation and makes the classification pipeline extensible.  

Interaction flow:  
1. An agent produces a raw transcript.  
2. The **LiveLoggingSystem** (or a downstream **TranscriptProcessor**) selects the matching concrete TranscriptAdapter.  
3. The adapter’s `adaptTranscript` method converts the raw data into the system‑wide transcript schema.  
4. The standardized transcript is handed to the **OntologyClassificationAgent** (found in `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`) for ontology‑based classification.  

Thus, the TranscriptAdapter sits at the **boundary** between heterogeneous external agents and the internal processing chain, acting as a translator and a registration point.

## Implementation Details  

The abstract class in `lib/agent-api/transcript-api.js` declares the method signature:

```javascript
class TranscriptAdapter {
  /**
   * Convert an agent‑specific transcript into the standard format.
   * @param {Object} rawTranscript – the native transcript payload
   * @returns {StandardTranscript}
   */
  adaptTranscript(rawTranscript) {
    throw new Error('adaptTranscript must be implemented by subclass');
  }
}
```

Concrete adapters extend this class, for example `ZoomTranscriptAdapter` or `SlackTranscriptAdapter`, each overriding `adaptTranscript` with logic that maps native fields (timestamps, speaker IDs, message bodies, etc.) onto the **StandardTranscript** schema expected by the rest of the system.  

The **TranscriptProcessor** (a sibling component) imports the base class and, at runtime, resolves the appropriate concrete adapter—either via a hard‑coded map or through a registration API if the system implements discovery.  Once resolved, the processor invokes `adapter.adaptTranscript(raw)` and forwards the result to the **OntologyClassificationAgent** for downstream analysis.  

The optional **adapter registration/discovery** mechanism hinted at in Observation 5 could be a simple static registry:

```javascript
const registry = new Map();
function registerAdapter(agentName, AdapterClass) {
  registry.set(agentName, new AdapterClass());
}
function getAdapter(agentName) {
  return registry.get(agentName);
}
```

Such a registry would allow the **LiveLoggingSystem** to dynamically locate the correct adapter without hard‑coded conditionals, supporting future agents with minimal code changes.

## Integration Points  

- **Parent – LiveLoggingSystem**: The LiveLoggingSystem owns the transcript pipeline. It creates or receives raw transcripts from various agents, then delegates conversion to a TranscriptAdapter instance.  
- **Sibling – TranscriptProcessor**: Directly consumes the abstract `TranscriptAdapter`. It is responsible for selecting the right concrete adapter and passing the standardized transcript downstream.  
- **Sibling – OntologyClassificationAgent** (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`): Receives the standardized transcript from the processor and performs ontology‑based classification. The quality of the adapter’s output directly influences classification accuracy.  
- **Sibling – Logger & LSLFormatter**: While not directly tied to the adapter, they operate on the same processing flow. The Logger may record adapter selection events, and the LSLFormatter may format the final classified output.  

The only explicit dependency of the TranscriptAdapter is on the **standard transcript schema** used throughout the system; it does not depend on any external services, making it a pure transformation layer.

## Usage Guidelines  

1. **Implement the Interface Exactly** – Every concrete adapter must extend `TranscriptAdapter` and provide a synchronous (or promise‑based) `adaptTranscript` that returns a fully populated `StandardTranscript`.  Throwing or returning incomplete objects will break the downstream classification pipeline.  

2. **Register New Adapters Early** – If the system uses the optional registration API, call `registerAdapter('agentName', ConcreteAdapter)` during application bootstrap (e.g., in the LiveLoggingSystem initialization code).  This ensures the **TranscriptProcessor** can locate the adapter when a new agent is introduced.  

3. **Keep Adapter Logic Pure** – Since adapters are pure translators, avoid side effects such as network calls or logging inside `adaptTranscript`.  Side effects belong to higher‑level components (e.g., the Logger).  

4. **Unit Test Against the Standard Schema** – Write tests that feed representative raw transcripts into the adapter and assert that the output matches the `StandardTranscript` contract.  This guards against regressions when the schema evolves.  

5. **Document Agent‑Specific Edge Cases** – If an agent’s transcript contains ambiguous fields (e.g., missing speaker IDs), document how the adapter resolves them (default values, error handling, etc.) so that downstream components have predictable behavior.  

---

### Architectural Patterns Identified  

1. **Adapter Pattern** – Provides a uniform interface (`adaptTranscript`) for heterogeneous agent transcript formats.  
2. **Strategy/Polymorphism** – Concrete adapters are interchangeable strategies selected at runtime.  
3. **Plug‑in / Registry (optional)** – Potential registration/discovery mechanism enables dynamic extension without modifying core code.  

### Design Decisions and Trade‑offs  

- **Abstract Base Class vs. Interface**: Choosing an abstract class gives a concrete place for shared utilities (e.g., default validation) but ties adapters to a JavaScript inheritance chain.  An interface‑only approach would be more language‑agnostic but would forgo any common implementation.  
- **Separate Module for Adapter Logic**: Isolating adapters in their own files promotes **single‑responsibility** and makes the system easier to extend, at the cost of an extra import indirection.  
- **Optional Registration Mechanism**: Adding a registry improves extensibility but introduces a small runtime lookup cost and requires careful initialization ordering.  

### System Structure Insights  

- The **LiveLoggingSystem** sits at the top of the hierarchy, orchestrating logging, transcript adaptation, classification, and formatting.  
- **TranscriptAdapter** is the bridge between external agent data and internal processing, positioned directly under LiveLoggingSystem and above the **TranscriptProcessor**.  
- Sibling components (**OntologyManager**, **Logger**, **LSLFormatter**) operate on the same pipeline but focus on classification, observability, and output formatting respectively.  

### Scalability Considerations  

- **Horizontal Scaling of Adapters**: Because adapters are pure functions, they can be executed in parallel across multiple worker threads or services, enabling the system to handle high‑throughput streams of transcripts.  
- **Adding New Agents**: The plug‑in style registration means new agents can be onboarded without redeploying the entire LiveLoggingSystem—only the new adapter module needs to be deployed.  
- **Potential Bottleneck**: If `adaptTranscript` performs heavy computation (e.g., deep parsing of large transcript blobs), it could become a CPU bottleneck; profiling and, if needed, offloading to background workers would mitigate this.  

### Maintainability Assessment  

The use of an abstract base class and a clear, single‑method contract makes the **TranscriptAdapter** highly maintainable.  Adding or modifying adapters does not affect other parts of the system, provided the output adheres to the standard schema.  The optional registration mechanism, if implemented cleanly, further isolates changes.  However, maintainers must ensure that the **StandardTranscript** definition remains stable; any schema change will ripple through all adapters and downstream consumers, requiring coordinated updates.  Overall, the design promotes low coupling and high cohesion, which are favorable for long‑term upkeep.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This is evident in the way the agent is instantiated and used within the LiveLoggingSystem's classification layer. The OntologyClassificationAgent's classify method is called with the session transcript as an argument, allowing the system to categorize the conversation based on predefined ontology rules. Furthermore, the use of the TranscriptAdapter, defined in lib/agent-api/transcript-api.js, as an abstract base class for agent-specific transcript adapters, enables the system to handle transcripts from various agents in a unified manner. The TranscriptAdapter's adaptTranscript method is responsible for converting agent-specific transcripts into a standardized format, which is then passed to the OntologyClassificationAgent for classification.

### Siblings
- [OntologyManager](./OntologyManager.md) -- The OntologyManager uses the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system.
- [TranscriptProcessor](./TranscriptProcessor.md) -- The TranscriptProcessor uses the TranscriptAdapter, defined in lib/agent-api/transcript-api.js, to handle transcripts from various agents in a unified manner.
- [Logger](./Logger.md) -- The Logger is expected to provide a logging API for the LiveLoggingSystem component to log events and errors.
- [LSLFormatter](./LSLFormatter.md) -- The LSLFormatter uses a templating engine or formatting library to generate the output format.


---

*Generated from 5 observations*
