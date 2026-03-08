# Ontology

**Type:** SubComponent

The OntologyClassificationAgent uses the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file to classify ontologies.

## What It Is  

The **Ontology** sub‑component lives inside the **SemanticAnalysis** integration at  
`integrations/mcp-server-semantic-analysis/src/ontology/`.  
Its concrete artefacts are split across four dedicated files:  

* `upper-ontology.ts` – defines the **upper ontology** model.  
* `lower-ontology.ts` – defines the **lower ontology** model.  
* `entity-type-resolution.ts` – contains the logic that resolves an entity’s type against the ontology definitions.  
* `validation.ts` – implements validation rules that ensure ontology instances are well‑formed.  

The **OntologyClassificationAgent**, located at  
`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`, is the only agent that directly consumes these ontology artefacts. It inherits from the shared `BaseAgent` (found in `.../agents/base-agent.ts`) to build response envelopes and compute confidence scores for its classification results. In short, Ontology is the data‑model and rule‑engine layer that enables the SemanticAnalysis system to recognise, validate, and classify domain concepts.

---

## Architecture and Design  

### Modular, file‑per‑concern organization  
All ontology‑related concerns are isolated in their own source files. This **modular architecture** is echoed throughout the parent component *SemanticAnalysis* (e.g., each agent – `ontology-classification-agent.ts`, `semantic-analysis-agent.ts`, `insight-generation-agent.ts` – lives in its own file). The design deliberately avoids monolithic blobs; each file has a single responsibility: upper‑ontology definition, lower‑ontology definition, type‑resolution, or validation.

### Inheritance from a common BaseAgent  
`OntologyClassificationAgent` extends `BaseAgent`. The base class supplies two cross‑cutting services used by every agent in the *Agents* sibling group:  

1. **Response envelope creation** – a standardized wrapper for results that downstream consumers (e.g., the *Pipeline* batch processor) expect.  
2. **Confidence‑level calculation** – a reusable algorithm that turns raw classification scores into a normalized confidence metric.  

This inheritance implements a **template‑method‑like pattern**: the concrete agent supplies domain‑specific logic (ontology classification) while delegating envelope and confidence handling to the base class.

### Separation of data model and processing logic  
The ontology definitions (`upper-ontology.ts`, `lower-ontology.ts`) are pure data structures, while the processing logic lives in separate modules (`entity-type-resolution.ts`, `validation.ts`). This clear **separation of concerns** enables the *OntologyClassificationAgent* to compose behaviour by importing only the pieces it needs, without being tightly coupled to the data representation.

### Interaction flow  
1. **OntologyClassificationAgent** receives a request (originating from the *Pipeline* or an API).  
2. It loads the upper and lower ontology definitions.  
3. It invokes the **entity‑type‑resolution** routine to map incoming entities to ontology classes.  
4. The **validation** module checks the resulting mapping for rule compliance.  
5. Using the BaseAgent utilities, the agent packages the outcome into a response envelope and attaches a confidence score.  

The flow is linear and deterministic, reflecting the system’s emphasis on predictability over asynchronous or event‑driven complexity (no such patterns were observed).

---

## Implementation Details  

### Core files  

| File | Primary Role |
|------|--------------|
| `integrations/mcp-server-semantic-analysis/src/ontology/upper-ontology.ts` | Declares the high‑level, abstract concepts that form the backbone of the domain model. |
| `integrations/mcp-server-semantic-analysis/src/ontology/lower-ontology.ts` | Provides concrete, fine‑grained concepts that extend the upper ontology. |
| `integrations/mcp-server-semantic-analysis/src/ontology/entity-type-resolution.ts` | Exposes a function (e.g., `resolveEntityType(entity)`) that walks the ontology hierarchy to find the most specific matching type. |
| `integrations/mcp-server-semantic-analysis/src/ontology/validation.ts` | Implements validation functions (e.g., `validateOntologyInstance(instance)`) that enforce constraints such as required properties, type compatibility, and hierarchy integrity. |
| `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` | Implements `OntologyClassificationAgent` which orchestrates the above modules, inherits from `BaseAgent`, and produces classification results. |
| `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts` | Supplies `createResponseEnvelope(payload)` and `calculateConfidence(rawScore)` utilities shared across all agents. |

### Mechanics of classification  

1. **Loading definitions** – The agent imports the upper and lower ontology modules, which export TypeScript interfaces or classes describing the ontology graph.  
2. **Resolution** – `entity-type-resolution.ts` walks the graph using depth‑first or breadth‑first traversal (the exact algorithm is not exposed in the observations but the file name indicates a dedicated resolution step). The result is a concrete ontology node that best matches the input entity.  
3. **Validation** – The `validation.ts` module runs a series of rule checks; any violation results in a classification failure that the agent can surface in its response envelope.  
4. **Response construction** – `BaseAgent`’s `createResponseEnvelope` wraps the classification payload (matched ontology node, validation status, any diagnostics) together with metadata such as timestamps and request identifiers.  
5. **Confidence scoring** – `BaseAgent`’s `calculateConfidence` converts internal scoring (perhaps based on similarity metrics from the resolution step) into a normalized confidence value that downstream components (e.g., *Insights* or *Pipeline*) can rank.

### Shared infrastructure  

All agents, including **OntologyClassificationAgent**, rely on the same `BaseAgent` implementation. This ensures a uniform API surface across the sibling components *Pipeline*, *Insights*, and *Agents*. The shared base also reduces duplicated code and simplifies future enhancements (e.g., changing the envelope schema in a single location).

---

## Integration Points  

1. **Parent – SemanticAnalysis** – Ontology is a child of the *SemanticAnalysis* component. The parent orchestrates agents (including the classification agent) and supplies configuration (e.g., which ontology files to load). The modular design means *SemanticAnalysis* can plug in additional agents without touching the ontology core.  

2. **Sibling – Pipeline** – The batch processing pipeline consumes the response envelopes produced by `OntologyClassificationAgent`. Because the envelope format is standardized by `BaseAgent`, the pipeline can treat classification results identically to those from other agents (e.g., `InsightGenerationAgent`).  

3. **Sibling – Insights** – The *InsightGenerationAgent* may use ontology validation outcomes to filter or enrich generated insights. Since both agents share the same base class, they can exchange confidence scores and metadata without translation.  

4. **Sibling – Agents (BaseAgent)** – `BaseAgent` is the common ancestor that provides the envelope and confidence utilities. Any change to these utilities propagates uniformly across all agents, guaranteeing compatibility.  

5. **External callers** – Although not directly observed, typical entry points would be HTTP handlers or message‑queue consumers that instantiate `OntologyClassificationAgent` and feed it raw entity data. The agent’s reliance on pure TypeScript modules (ontology definitions, resolution, validation) makes it straightforward to unit‑test in isolation.

---

## Usage Guidelines  

* **Import only what you need** – When building a new agent that requires ontology information, import the specific files (`upper-ontology.ts`, `lower-ontology.ts`, etc.) rather than pulling the entire `ontology` folder. This keeps bundle size low and respects the modular boundary.  

* **Extend BaseAgent, don’t duplicate** – All custom agents should subclass `BaseAgent`. Re‑using `createResponseEnvelope` and `calculateConfidence` guarantees that downstream consumers (Pipeline, Insights) receive a consistent payload.  

* **Validate before publishing** – Always invoke the functions from `validation.ts` after type resolution. Failing to validate can produce malformed classification results that break downstream processing.  

* **Respect the hierarchy** – The upper ontology defines abstract concepts; the lower ontology refines them. When extending the ontology, add new concepts to the appropriate layer to preserve the intended separation of concerns.  

* **Keep resolution deterministic** – `entity-type-resolution.ts` should remain a pure function (no side effects) so that classification is repeatable. This is critical for batch pipelines that may re‑run the same data for auditing.  

* **Monitor confidence scores** – Consumers often filter on confidence thresholds. If you adjust the scoring algorithm inside `BaseAgent`, review any threshold logic in the *Pipeline* and *Insights* components to avoid unintended data loss.  

---

### Architectural patterns identified  

1. **Modular file‑per‑concern architecture** – each logical piece (upper ontology, lower ontology, resolution, validation, agents) resides in its own file.  
2. **Template method / inheritance** – agents inherit from `BaseAgent` to reuse envelope and confidence logic.  
3. **Separation of concerns** – data models are isolated from processing (resolution, validation).  

### Design decisions and trade‑offs  

* **Decision:** Use a shared `BaseAgent` for envelope and confidence handling.  
  *Trade‑off:* Guarantees uniformity but introduces a single point of change; any bug in `BaseAgent` affects all agents.  

* **Decision:** Keep ontology definitions as static TypeScript modules.  
  *Trade‑off:* Simplicity and compile‑time safety versus flexibility; updating the ontology requires a code change and redeploy rather than a dynamic data load.  

* **Decision:** Place validation in a dedicated module.  
  *Trade‑off:* Cleaner agent code but adds an extra import and runtime step for every classification request.  

### System structure insights  

The system follows a **layered hierarchy**:  
* **SemanticAnalysis** (parent) orchestrates agents.  
* **Agents** (siblings) each encapsulate a distinct processing step, all inheriting from `BaseAgent`.  
* **Ontology** (child) supplies the domain model and rule engine used by the `OntologyClassificationAgent`.  

This hierarchy makes the codebase easy to navigate: developers can locate a specific concern by following the file path conventions (`src/agents/…` for agents, `src/ontology/…` for ontology artefacts).

### Scalability considerations  

* **Horizontal scaling of agents** – Because each agent is a self‑contained class with no shared mutable state, multiple instances can be run in parallel (e.g., in a distributed worker pool).  
* **Ontology size** – Adding many concepts to the upper or lower ontology will increase the in‑memory graph that `entity-type-resolution.ts` traverses. If the ontology grows substantially, consider profiling the resolution algorithm and possibly introducing indexing or caching.  
* **Pipeline throughput** – The standardized response envelope means the *Pipeline* can process classification results at line speed, provided confidence calculation remains lightweight.  

### Maintainability assessment  

The **modular layout** and **clear separation** between data definitions, resolution, validation, and agent orchestration make the codebase highly maintainable. Adding a new ontology concept or a new validation rule only touches the respective file, leaving agents untouched. The shared `BaseAgent` reduces duplication, but it also concentrates envelope logic; a well‑documented test suite for `BaseAgent` is essential to safeguard against regressions. Overall, the architecture encourages **low coupling** and **high cohesion**, supporting straightforward evolution of the Ontology sub‑component.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component follows a modular architecture, with each agent, such as the OntologyClassificationAgent and SemanticAnalysisAgent, responsible for a specific task. This modularity is reflected in the code organization, with each agent having its own file, such as integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts. The use of a BaseAgent class, defined in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, provides a standard way for all agents to create response envelopes and calculate confidence levels.

### Siblings
- [Pipeline](./Pipeline.md) -- The batch processing pipeline uses a modular architecture, with each agent having its own file, such as integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts.
- [Insights](./Insights.md) -- The InsightGenerationAgent uses the integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts file to generate insights.
- [Agents](./Agents.md) -- The BaseAgent class is defined in the integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts file.


---

*Generated from 7 observations*
