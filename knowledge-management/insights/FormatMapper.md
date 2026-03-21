# FormatMapper

**Type:** Detail

The integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file implements the mapping-based approach used by the LSLConverter.

## What It Is  

**FormatMapper** is the core conversion engine inside the **LSLConverter** that translates transcript data from one format to another. The mapping‑based strategy that drives this conversion is implemented in the file  

```
integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts
```  

as part of the *ontology‑classification‑agent* logic. In the broader LSLConverter component, FormatMapper is the dedicated sub‑module that holds the format‑to‑format translation tables and the logic that applies them. Its purpose is purely functional – it does not contain business rules or external service calls – and it exists to keep the conversion process deterministic and easy to extend when new transcript schemas appear.

## Architecture and Design  

The observations point to a **mapping‑based architectural approach**. Rather than writing procedural code for each source‑target pair, the system stores a declarative map that describes how fields in one transcript format correspond to fields in another. The **ontology‑classification‑agent** (located at `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`) demonstrates this approach: it reads a predefined map and applies it to incoming data, effectively acting as a thin adapter.  

Within the LSLConverter hierarchy, **FormatMapper** is a child component that encapsulates this map and the algorithm that walks it. The parent, **LSLConverter**, delegates all format‑translation responsibilities to FormatMapper, keeping the higher‑level conversion workflow (e.g., orchestration, error handling, logging) separate from the low‑level field mapping. This separation mirrors a classic **Adapter** pattern, where FormatMapper adapts one data contract to another without exposing the internal mapping mechanics to its callers.

Because the mapping tables are likely static or configuration‑driven, the design favors **configuration‑driven extensibility** over code‑level branching. Adding a new transcript format or adjusting an existing mapping can be done by updating the map definition rather than altering procedural conversion code.

## Implementation Details  

The only concrete implementation artifact we have is the **ontology‑classification‑agent** source file. That file implements the same mapping‑based conversion logic that LSLConverter relies on, indicating that FormatMapper probably reuses the same helper utilities or even the same class definitions. The agent likely performs the following steps:

1. **Load Mapping Definition** – a JSON/YAML/TS object that lists source‑field → target‑field pairs, possibly with transformation functions (e.g., type casts, concatenations).  
2. **Iterate Over Input Transcript** – for each key in the source transcript, look up the corresponding target key in the map.  
3. **Apply Transformations** – if the map includes a function reference (e.g., `toUpperCase`, date parsing), invoke it; otherwise copy the value directly.  
4. **Assemble Output Transcript** – build a new object that conforms to the destination schema.

Because FormatMapper is described as “crucial” to LSLConverter, it is reasonable to infer that the class exposes a small public API such as `convert(source: Transcript, targetFormat: string): Transcript`. The parent LSLConverter would call this method, passing the raw transcript and the desired output format identifier. The actual mapping tables are probably stored alongside the agent or within a dedicated `mappings/` directory, but the observations do not specify their location.

## Integration Points  

The integration surface for FormatMapper is the **LSLConverter** component, which *contains* FormatMapper. LSLConverter likely constructs an instance of FormatMapper during its initialization phase and injects any required configuration (e.g., path to the mapping files). The **ontology‑classification‑agent** demonstrates how other agents within the *semantic‑analysis* integration can also leverage the same mapping logic, suggesting a shared library or utility module that both the agent and LSLConverter import.  

No explicit external dependencies are mentioned, but given the nature of transcript conversion, FormatMapper may depend on:

* **Type definitions** for the various transcript schemas (e.g., TypeScript interfaces).  
* **Utility functions** for data transformation (e.g., date parsing, string sanitization).  

The mapping tables themselves act as a contract between FormatMapper and any consumer that expects a particular transcript shape. Consequently, any change to a mapping file directly influences both the ontology‑classification‑agent and any other component that uses LSLConverter.

## Usage Guidelines  

1. **Treat FormatMapper as a pure function** – it should receive immutable input and return a new transcript object without side effects. This ensures predictability when LSLConverter orchestrates multiple conversion steps.  
2. **Update mappings, not code** – when a new transcript format is introduced, add the corresponding mapping definition rather than extending conversion logic. This keeps the codebase small and the conversion behavior transparent.  
3. **Validate mappings before deployment** – because the conversion relies entirely on the mapping tables, run schema validation tests to guarantee that every required field in the target format is covered.  
4. **Avoid coupling business logic to FormatMapper** – any domain‑specific processing (e.g., sentiment analysis) should be performed outside of FormatMapper, preferably in higher‑level LSLConverter workflows or dedicated agents.  
5. **Version mapping files** – if multiple services consume different versions of a transcript format, version the mapping definitions and pass the version identifier to FormatMapper via the `targetFormat` argument.

---

### 1. Architectural patterns identified  
* **Mapping‑based (configuration‑driven) conversion** – declarative field‑to‑field maps replace procedural branching.  
* **Adapter pattern** – FormatMapper adapts source transcript contracts to target contracts for the LSLConverter.  

### 2. Design decisions and trade‑offs  
* **Decision:** Centralize all format translation in a single, reusable mapper.  
  * *Trade‑off:* Simplicity and reusability versus potential performance overhead when maps become large.  
* **Decision:** Keep mapping definitions external to code.  
  * *Trade‑off:* Easy extensibility but requires rigorous validation to avoid runtime mismatches.  

### 3. System structure insights  
* **Parent‑child relationship:** LSLConverter (parent) delegates conversion to FormatMapper (child).  
* **Sibling reuse:** The ontology‑classification‑agent (sibling) reuses the same mapping logic, indicating a shared utility module.  

### 4. Scalability considerations  
* Adding new transcript formats scales linearly with the size of mapping files; no code changes are required.  
* For very large maps, consider lazy‑loading or chunked processing to keep memory usage bounded.  

### 5. Maintainability assessment  
* High maintainability due to the declarative nature of mappings; developers can adjust conversion behavior without touching core logic.  
* The single point of truth (the mapping tables) simplifies testing but introduces a risk: a malformed map can break all conversions, so automated schema‑validation pipelines are essential.

## Hierarchy Context

### Parent
- [LSLConverter](./LSLConverter.md) -- LSLConverter uses a mapping-based approach to convert between transcript formats, as implemented in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file

---

*Generated from 3 observations*
