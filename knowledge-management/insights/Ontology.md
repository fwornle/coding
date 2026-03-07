# Ontology

**Type:** SubComponent

The Ontology sub-component utilizes the OntologyClassificationAgent for classifying observations against the ontology system, as seen in the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts).

## What It Is  

The **Ontology** sub‑component lives in the *semantic‑analysis* integration of the MCP server and is materialised by a set of TypeScript classes under the path `integrations/mcp-server-semantic-analysis/src`.  Its core artefacts are:  

* `ontology-definition.ts` – defines the upper‑ and lower‑ontology model, enumerating entity types and the relationships that bind them.  
* `entity-type-resolver.ts` – implements the logic that maps raw observations to the concrete ontology entity categories.  
* `ontology-validator.ts` – supplies validation routines that guarantee the internal consistency of the ontology definition and the results of classification.  
* `ontology-classification-agent.ts` – an agent that consumes the above models to classify incoming observations against the ontology.  

All of these pieces sit inside the **SemanticAnalysis** parent component, which orchestrates a family of agents (e.g., `semantic-analysis-agent.ts`, `code-analyzer.ts`) through a common contract defined in `agents/base-agent.ts`.  The Ontology sub‑component therefore represents the knowledge‑representation layer of the SemanticAnalysis pipeline, exposing a reusable, extensible ontology service to the rest of the system.

---

## Architecture and Design  

The Ontology sub‑component follows a **modular, agent‑based architecture**.  Each functional responsibility is encapsulated in its own class and wired together through the `BaseAgent` interface (`integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`).  This interface enforces a uniform lifecycle (`init`, `process`, `shutdown`‑style methods) that all agents—including `OntologyClassificationAgent`—adhere to, allowing the parent `SemanticAnalysis` component to treat them as interchangeable processing blocks.  

The design also exhibits an **extensibility‑through‑composition** pattern.  New entity types or relationships can be added by extending `OntologyDefinition` and updating `EntityTypeResolver`; the `CodeAnalyzer` agent (`integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts`) demonstrates this by plugging additional analysis capabilities into the same agent pipeline without altering existing ontology code.  

Validation is treated as a first‑class concern: `OntologyValidator` runs consistency checks after any mutation of the ontology model, ensuring that the classification logic in `OntologyClassificationAgent` never operates on a malformed definition.  This defensive design reduces runtime errors at the cost of added processing overhead during ontology updates.  

Finally, the Ontology sub‑component is **integrated with the LLM‑driven pipeline**.  The `SemanticAnalysisAgent` (`integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts`) leverages `LLMService` (`integrations/mcp-server-semantic-analysis/src/model/llm-service.ts`) to enrich raw observations before they reach the ontology layer, illustrating a clear separation between language‑model processing and deterministic ontology classification.

---

## Implementation Details  

At the heart of the sub‑component is `OntologyDefinition` (`ontology-definition.ts`).  It declares two hierarchical layers—*upper* and *lower*—each containing a set of `EntityType` objects and a relationship map.  The definition is a plain data model, deliberately kept free of business logic to make it serialisable and easy to version.  

`EntityTypeResolver` (`entity-type-resolver.ts`) implements a deterministic matching algorithm.  It receives an observation (typically a structured payload produced by the `SemanticAnalysisAgent`) and walks the ontology graph, applying a series of predicate functions (e.g., name matching, attribute similarity) until it resolves the observation to a concrete `EntityType`.  The resolver is stateless, enabling it to be reused across multiple classification runs without side effects.  

`OntologyValidator` (`ontology-validator.ts`) performs two categories of checks: structural (e.g., no circular relationships, required fields present) and semantic (e.g., entity type names are unique, relationship cardinalities are respected).  Validation is invoked automatically by `OntologyClassificationAgent` during its `init` phase and again whenever the ontology definition is reloaded, ensuring that any dynamic updates introduced by sibling agents such as `CodeAnalyzer` do not corrupt the model.  

`OntologyClassificationAgent` (`ontology-classification-agent.ts`) extends `BaseAgent`.  Its `process` method receives a batch of observations, forwards each to `EntityTypeResolver`, and annotates the observation with the resolved ontology entity.  The agent then emits the enriched observations downstream to other agents (e.g., `InsightGenerator`) via the standardized messaging contract defined in `BaseAgent`.  Because it inherits the base interface, the agent can be scheduled by the DAG‑based `Pipeline` sibling without bespoke glue code.  

The `SemanticAnalysisAgent` (`semantic-analysis-agent.ts`) sits upstream, calling `LLMService` (`model/llm-service.ts`) to generate a richer textual representation of raw data.  The output of the LLM is fed into `OntologyClassificationAgent`, illustrating a clear **pipeline flow**: LLM enrichment → ontology resolution → insight generation.

---

## Integration Points  

The Ontology sub‑component interacts with several other parts of the system:  

* **Parent – SemanticAnalysis**: The parent component loads the ontology classes and registers `OntologyClassificationAgent` as part of its agent collection.  Because all agents conform to `BaseAgent`, the parent can orchestrate them uniformly, start/stop them, and pass messages through a shared event bus.  

* **Sibling – Pipeline**: The `Pipeline` component (see `agents/batch-scheduler.ts`) executes agents in a DAG defined in `batch-analysis.yaml`.  `OntologyClassificationAgent` can be placed anywhere in that DAG, benefitting from the topological sort and explicit `depends_on` edges.  This enables downstream agents such as `InsightGenerator` to safely assume that observations are already ontology‑annotated.  

* **Sibling – LLMService**: The LLM service is injected into `SemanticAnalysisAgent`, which precedes the ontology step.  The contract between `SemanticAnalysisAgent` and `OntologyClassificationAgent` is purely data‑centric: a JSON payload with a `text` field enriched by the LLM.  

* **Sibling – CodeAnalyzer**: `CodeAnalyzer` demonstrates extensibility by augmenting the ontology definition with code‑specific entity types.  It does so by importing `OntologyDefinition` and invoking `OntologyValidator` after modifications, ensuring that the ontology remains coherent.  

* **Child – OntologyClassificationAgent**: As the sole child agent, it implements the concrete classification logic and publishes results that downstream agents (e.g., `InsightGenerator` in `agents/insight-generator.ts`) consume to produce user‑facing insights.  

All interactions are mediated through the shared `BaseAgent` interface and simple JSON messages, avoiding tight coupling and allowing new agents to be added with minimal friction.

---

## Usage Guidelines  

1. **Instantiate via the SemanticAnalysis bootstrap** – Do not create `OntologyClassificationAgent` directly; let the parent `SemanticAnalysis` component load it from the agent registry so that the `BaseAgent` lifecycle hooks are honoured.  

2. **Keep the ontology definition immutable at runtime** – If you need to extend the ontology (as `CodeAnalyzer` does), perform the change in a dedicated initialization step, then call `OntologyValidator.validate()` before any classification runs.  This prevents race conditions where concurrent agents see a partially updated model.  

3. **Leverage the resolver statelessly** – `EntityTypeResolver` is designed to be reusable; instantiate it once and reuse the same instance across multiple `process` calls to minimise object churn.  

4. **Respect the DAG ordering** – When adding new agents that depend on ontology‑annotated data, declare an explicit `depends_on` edge to `OntologyClassificationAgent` in `batch-analysis.yaml`.  This guarantees that the pipeline’s topological sort will schedule the agents in the correct order.  

5. **Monitor validation performance** – Validation runs on every ontology reload; for large ontologies, consider caching the validation result and only re‑validating when the definition file changes.  

6. **Do not bypass the LLM enrichment step** – The ontology is tuned to work with the richer textual context produced by `LLMService`.  Supplying raw observations directly to `OntologyClassificationAgent` may lead to lower classification accuracy.  

Following these conventions ensures that the Ontology sub‑component remains consistent, performant, and easy to evolve alongside its sibling agents.

---

### Architectural patterns identified  
* **Agent‑based modular architecture** – each functional unit is an agent conforming to `BaseAgent`.  
* **Interface‑driven design** – `BaseAgent` provides a common contract for lifecycle and messaging.  
* **Extensibility through composition** – new entity types or analysis capabilities (e.g., `CodeAnalyzer`) plug into the existing ontology model without altering core logic.  
* **Pipeline/DAG execution** – the sibling `Pipeline` schedules agents based on explicit dependency edges.

### Design decisions and trade‑offs  
* **Separation of concerns** (ontology definition, resolution, validation, classification) improves readability and testability but introduces more classes to maintain.  
* **Stateless resolver** enables reuse and parallelism at the cost of requiring the ontology definition to be globally accessible and immutable during processing.  
* **Strict validation** guarantees consistency but adds runtime overhead whenever the ontology is updated.  
* **Dependency on LLMService** enriches data quality but creates an external performance and reliability dependency.

### System structure insights  
* The Ontology sub‑component is a self‑contained knowledge layer within the larger **SemanticAnalysis** component, exposing a clean API via `OntologyClassificationAgent`.  
* All agents share the same `BaseAgent` contract, enabling the **Pipeline** sibling to treat them uniformly in its DAG scheduler.  
* Sibling components (Insights, CodeAnalyzer, InsightGenerator, LLMService) interact with Ontology through well‑defined data contracts, not through direct method calls, reinforcing loose coupling.

### Scalability considerations  
* Because agents are stateless or maintain minimal internal state, they can be instantiated multiple times and run in parallel, supporting horizontal scaling of classification workloads.  
* Validation may become a bottleneck for very large ontologies; caching validation results or incremental validation could mitigate this.  
* The reliance on `LLMService` introduces latency that scales with the size of the input batch; batching requests or using asynchronous calls can help maintain throughput.

### Maintainability assessment  
* **High** – modular agent design, clear interface (`BaseAgent`), and isolated responsibilities make the codebase easy to navigate and extend.  
* **Medium** – the need to keep the ontology definition synchronized across agents and the overhead of validation require disciplined change‑management processes.  
* Overall, the architecture promotes clean separation, testability, and straightforward onboarding for new developers, provided the validation and LLM integration points are monitored and documented.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for classifying observations against the ontology system. This modularity allows for easier maintenance and extension of the component, as new agents can be added or existing ones modified without affecting the overall system. For instance, the SemanticAnalysisAgent (integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts) utilizes the LLMService for large language model-based analysis and generation, demonstrating the flexibility of the component's design. The use of a standardized agent interface, as defined in the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts), ensures consistency across the different agents and facilitates communication between them.

### Children
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- The OntologyClassificationAgent class is defined in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file, indicating its role in the SemanticAnalysis component.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges, as seen in the BatchScheduler class (integrations/mcp-server-semantic-analysis/src/agents/batch-scheduler.ts).
- [Insights](./Insights.md) -- The Insights sub-component utilizes the InsightGenerator agent for generating insights from analyzed data, as seen in the InsightGenerator class (integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts).
- [CodeAnalyzer](./CodeAnalyzer.md) -- The CodeAnalyzer sub-component utilizes the CodeAnalyzer agent for analyzing code and generating insights, as seen in the CodeAnalyzer class (integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts).
- [InsightGenerator](./InsightGenerator.md) -- The InsightGenerator sub-component utilizes the InsightGenerator agent for generating insights from analyzed data, as seen in the InsightGenerator class (integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts).
- [LLMService](./LLMService.md) -- The LLMService sub-component utilizes the LLMService class for providing large language model-based analysis and generation, as seen in the LLMService class (integrations/mcp-server-semantic-analysis/src/model/llm-service.ts).


---

*Generated from 7 observations*
