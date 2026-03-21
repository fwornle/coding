# SessionManager

**Type:** SubComponent

SessionManager uses the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) to classify observations and entities against the ontology system.

## What It Is  

**SessionManager** is the core sub‑component responsible for orchestrating the live‑session logging workflow inside the **LiveLoggingSystem**. It lives in the same repository as the other logging modules and works directly with the **OntologyClassificationAgent** (`integrations/mcp‑server‑semantic‑analysis/src/agents/ontology‑classification‑agent.ts`) and the **LSLConfigValidator** (`scripts/validate‑lsl‑config.js`). Its primary responsibilities are to ingest raw observation and entity streams, apply ontology‑based classification rules (driven by an external configuration file), enrich the payloads with ontology metadata, and route the resulting data through a windowing layer to downstream consumers. By delegating transcript conversion to the **TranscriptProcessor**, SessionManager presents a unified abstraction that hides the heterogeneity of agent‑specific transcript formats and delivers a consistent LSL (Live Session Logging) representation.

The component is deliberately configuration‑centric: classification rules are not hard‑coded but expressed in a JSON/YAML file that can be edited without recompiling. This design choice enables rapid adaptation to evolving ontology schemas and business‑rule changes while keeping the runtime code stable. Validation of that configuration is performed, when needed, by the LSLConfigValidator script before any classification work begins, guaranteeing that malformed rules do not corrupt the logging pipeline.

In addition to classification, SessionManager implements “windowing and routing” – a logical partitioning of the continuous log stream into manageable chunks (time‑based or event‑based windows) and the dispatch of those windows to persistence layers or downstream analytics. Although the exact windowing implementation is not disclosed, the observation that it “potentially uses a modular architecture for easier maintenance and updates” suggests that the windowing logic is encapsulated in separate, replaceable modules.

---

## Architecture and Design  

The architecture surrounding SessionManager is **modular** and **configuration‑driven**. The parent component, **LiveLoggingSystem**, adopts a modular approach where each functional concern (ontology classification, configuration validation, transcript processing, and session management) lives in its own module. SessionManager sits at the hub of this modular mesh, pulling in services from its siblings:

* **OntologyClassificationAgent** supplies the classification algorithm and ontology lookup logic. SessionManager invokes this agent to map raw observations/entities to ontology concepts, relying on the same configuration file that drives its own rule engine.  
* **LSLConfigValidator** acts as a guardrail, ensuring that the classification configuration file conforms to expected schemas before SessionManager begins processing.  
* **TranscriptProcessor** provides a normalized transcript stream that SessionManager can treat uniformly, regardless of the originating agent format.

The primary design pattern evident is **configuration‑driven processing**, where business rules (classification mappings) are externalized. This pattern reduces code churn and aligns with the “rules engine” concept without introducing a full‑blown engine. A secondary pattern is **pipeline / chain‑of‑responsibility**, where raw data flows through a sequence: validation → transcript normalization → classification → enrichment → windowing → routing. Each stage is encapsulated, allowing individual replacement or extension.

Interaction between components is explicit and file‑path based. SessionManager imports the OntologyClassificationAgent from its TypeScript source location, and when it needs to verify configuration integrity it calls the LSLConfigValidator script. This tight coupling to concrete file paths reflects a **co‑located module** strategy, where related source files are kept together to simplify navigation and build tooling.

---

## Implementation Details  

1. **Configuration File Handling**  
   SessionManager reads a dedicated configuration file (likely JSON or YAML) that defines classification rules. The file is parsed at startup and cached for fast lookup. Because the same file is also consumed by the OntologyClassificationAgent, both components share a common rule set, guaranteeing consistent ontology mapping across the system. The configuration may contain mappings such as `"observationType → ontologyClass"` and conditional rules that dictate how to enrich entities.

2. **Validation via LSLConfigValidator**  
   Before any classification begins, SessionManager optionally invokes `scripts/validate-lsl-config.js`. This script checks the syntax, required fields, and possibly cross‑references against the ontology schema. If validation fails, SessionManager aborts the session start, preventing downstream errors. The use of a separate validator script keeps validation logic isolated from the main processing code, adhering to the **single‑responsibility principle**.

3. **Classification Flow with OntologyClassificationAgent**  
   For each incoming observation or entity, SessionManager calls into the `OntologyClassificationAgent` (found at `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`). The agent receives the raw payload and the applicable rule set, performs a lookup against the ontology service, and returns enriched metadata (e.g., `ontologyId`, `confidenceScore`). SessionManager then attaches this metadata to the entity before persisting it, satisfying the observation that “classification process adds ontology metadata to entities before persistence.”

4. **Windowing and Routing**  
   While the exact implementation is not disclosed, SessionManager’s “windowing” likely partitions the continuous stream into fixed‑size or sliding windows. Each window is then routed to a persistence adapter (database, file store) or a downstream analytics pipeline. Because the architecture is described as modular, the windowing logic is probably encapsulated in its own class or function, making it replaceable without touching classification or validation code.

5. **Collaboration with TranscriptProcessor**  
   SessionManager does not directly parse raw transcript files. Instead, it consumes the normalized output produced by **TranscriptProcessor**, which itself validates its configuration via LSLConfigValidator. This separation allows SessionManager to remain agnostic of transcript format intricacies and focus solely on classification and windowing.

---

## Integration Points  

* **Parent – LiveLoggingSystem**: SessionManager is a child of LiveLoggingSystem and inherits the system‑wide modular philosophy. Any system‑level configuration (e.g., logging level, global ontology cache) propagates down to SessionManager.  
* **Sibling – OntologyClassificationAgent**: Directly imported from `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`. SessionManager passes raw observations and the shared classification config to this agent and receives enriched entities.  
* **Sibling – LSLConfigValidator**: Executed via the Node.js script `scripts/validate-lsl-config.js`. SessionManager may invoke this validator synchronously during initialization or asynchronously when configuration files are hot‑reloaded.  
* **Sibling – TranscriptProcessor**: Provides the pre‑processed transcript stream. SessionManager subscribes to the output events (e.g., `onTranscriptChunk`) and treats them as input for classification.  
* **External – Ontology Service**: Though not listed as a sibling, the OntologyClassificationAgent likely communicates with an external ontology service (REST or gRPC) to resolve concept identifiers. SessionManager indirectly depends on this service through the agent.  
* **Persistence / Routing Targets**: Not explicitly named, but the windowing layer routes enriched windows to downstream stores. These targets are pluggable modules, consistent with the modular architecture.

---

## Usage Guidelines  

1. **Never modify classification logic in code** – always adjust the external configuration file. After editing the file, run `scripts/validate-lsl-config.js` to ensure the changes are syntactically correct before restarting SessionManager.  
2. **Keep the configuration file version‑controlled** so that changes can be audited and rolled back if a rule set introduces regressions.  
3. **When extending the windowing behavior**, create a new module rather than editing the existing windowing code. Register the new module in SessionManager’s initialization routine to preserve modularity.  
4. **If you need to add a new ontology concept**, update the ontology service first, then extend the configuration file accordingly. The OntologyClassificationAgent will automatically pick up the new concept without code changes.  
5. **Monitor validation failures** – the system will abort session startup on config validation errors. Ensure CI pipelines include a step that runs `validate-lsl-config.js` against any configuration changes.  
6. **Do not bypass TranscriptProcessor** – always feed SessionManager with transcripts that have been normalized by this sibling component, as it guarantees format consistency required for downstream classification.

---

### Architectural patterns identified  

1. **Modular Architecture** – each functional concern (validation, classification, transcript processing, windowing) is isolated in its own module.  
2. **Configuration‑Driven Processing** – classification rules reside in external files, enabling runtime rule changes without code recompilation.  
3. **Pipeline / Chain‑of‑Responsibility** – data flows through a sequence of distinct stages (validation → transcript normalization → classification → enrichment → windowing → routing).  
4. **Single‑Responsibility Principle** – each sibling component focuses on a single domain (e.g., OntologyClassificationAgent only classifies, LSLConfigValidator only validates).

### Design decisions and trade‑offs  

* **Externalizing classification rules** trades a small runtime overhead (parsing the config) for massive flexibility and reduced deployment friction.  
* **Separate validator script** adds an extra step in the startup path but isolates validation logic, making it easier to test and evolve independently.  
* **Relying on a shared configuration between SessionManager and OntologyClassificationAgent** ensures consistency but creates a tight coupling to the file format; any breaking change to the config schema requires coordinated updates across both modules.  
* **Modular windowing** enables swapping algorithms (e.g., fixed vs. sliding windows) without touching classification code, at the cost of needing a well‑defined interface contract between SessionManager and the windowing module.

### System structure insights  

* The **LiveLoggingSystem** acts as a container orchestrating multiple modular sub‑components.  
* **SessionManager** sits centrally, bridging input (transcripts) and output (persisted, enriched windows).  
* Sibling components share common utilities (configuration files, validation scripts), reinforcing a cohesive ecosystem.  
* The absence of direct database calls in SessionManager suggests that persistence is delegated to downstream routing modules, preserving SessionManager’s focus on data preparation.

### Scalability considerations  

* Because classification rules are read once and cached, scaling the number of concurrent sessions does not increase validation overhead.  
* The windowing layer can be scaled horizontally by instantiating multiple SessionManager instances, each handling a subset of session streams, provided the routing targets are stateless or support sharding.  
* External ontology lookups could become a bottleneck; caching results inside OntologyClassificationAgent or introducing a bulk‑lookup mechanism would mitigate latency as session volume grows.  
* Configuration‑driven logic simplifies scaling deployments – new instances automatically inherit the latest rule set without code redeployment.

### Maintainability assessment  

* **High maintainability** stems from the clear separation of concerns and the use of configuration files for business rules.  
* The modular design allows developers to work on a single concern (e.g., improving the validator) without risking regressions in classification or windowing.  
* Shared configuration introduces a potential point of failure; rigorous validation and version control are essential to keep the system stable.  
* Documentation should emphasize the contract between SessionManager and its siblings (expected config schema, event interfaces) to prevent accidental breaking changes.  

Overall, SessionManager exemplifies a well‑structured, configuration‑centric sub‑component that leverages the modular foundations of LiveLoggingSystem to deliver flexible, maintainable, and scalable live‑session logging.

## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component employs a modular architecture, with classes such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) and the LSLConfigValidator (scripts/validate-lsl-config.js) working together to provide a unified abstraction for reading and converting transcripts from different agent formats into the Live Session Logging (LSL) format. This modular approach allows for easier maintenance and updates, as individual modules can be modified or replaced without affecting the entire system. For example, the OntologyClassificationAgent uses a configuration file to classify observations and entities against the ontology system, adding ontology metadata to entities before persistence. The use of a configuration file allows for easy modification of the classification rules without requiring changes to the code.

### Siblings
- [TranscriptProcessor](./TranscriptProcessor.md) -- TranscriptProcessor uses the LSLConfigValidator (scripts/validate-lsl-config.js) to validate configuration files before processing transcripts.
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- OntologyClassificationAgent uses a configuration file to classify observations and entities against the ontology system.
- [LSLConfigValidator](./LSLConfigValidator.md) -- LSLConfigValidator uses a modular architecture for easier maintenance and updates.

---

*Generated from 7 observations*
