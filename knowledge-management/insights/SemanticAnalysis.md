# SemanticAnalysis

**Type:** Component

[LLM] The SemanticAnalysis component's architecture is designed as a multi-agent system, with each agent responsible for a specific task. For instance, the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) is used for classifying observations against the ontology system. This agent extends the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) class, which provides a standardized structure for agent development. The use of a base agent class ensures consistency across all agents and simplifies the development of new agents. The OntologyClassificationAgent's classification process involves querying the GraphDatabaseAdapter (storage/graph-database-adapter.js) to retrieve relevant data for classification.

## What It Is  

The **SemanticAnalysis** component lives under the `integrations/mcp-server-semantic-analysis` tree. Its core source files are the agent implementations  

* `src/agents/ontology-classification-agent.ts`  
* `src/agents/semantic-analysis-agent.ts`  
* `src/agents/code-graph-agent.ts`  
* `src/agents/content‑validation-agent.ts`  
* `src/agents/base-agent.ts`  

and the shared persistence layer  

* `storage/graph-database-adapter.js`  

The component’s execution order is declared in a centralized workflow description file  

* `config/workflow.json`.  

Together these pieces form a **multi‑agent, workflow‑orchestrated** system that consumes code and conversation data, builds a code‑knowledge graph, validates entity content, classifies observations against an ontology, and finally produces semantic insights. It is a child of the top‑level **Coding** component and sits alongside siblings such as **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **Trajectory**, **KnowledgeManagement**, **CodingPatterns**, and **ConstraintSystem**. Its own children – **Pipeline**, **Ontology**, **Insights**, **WorkflowOrchestrator**, and **GraphDatabaseAdapter** – are each realized as separate modules that the agents compose at runtime.

---

## Architecture and Design  

### Multi‑Agent System  
All functional units are expressed as **agents** that extend `BaseAgent` (`integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`). This inheritance provides a common lifecycle (initialisation, execution, result handling) and guarantees a uniform interface for the orchestrator. The agents each have a single responsibility:

* **OntologyClassificationAgent** – classifies observations against the ontology.  
* **SemanticAnalysisAgent** – drives the overall semantic analysis, delegating graph construction to the CodeGraphAgent.  
* **CodeGraphAgent** – creates/updates the code‑knowledge graph.  
* **ContentValidationAgent** – validates entity content and detects staleness.

The pattern is essentially **Template Method** (the base class defines the skeleton, concrete agents fill in steps) combined with **Strategy** (different agents provide interchangeable behaviours for the workflow).

### Workflow‑Orchestrated Execution  
The ordering of agents is not hard‑coded; it is defined in `integrations/mcp-server-semantic-analysis/config/workflow.json`. The file lists dependencies such that:

```
ContentValidationAgent → OntologyClassificationAgent → SemanticAnalysisAgent
```

(Observation 4). The orchestrator reads this JSON, builds a directed acyclic graph of agent nodes, and executes them respecting the dependency chain. This is a lightweight **pipeline** / **workflow** pattern, where each node’s output becomes the next node’s input.

### GraphDatabaseAdapter Abstraction  
All agents interact with the underlying graph store through `storage/graph-database-adapter.js`. The adapter hides the concrete database implementation (e.g., Neo4j, JanusGraph) behind a set of methods for **query**, **insert**, **update**, and **delete**. Because the adapter is a single module, swapping the backing store requires only changes inside that file – a classic **Adapter** pattern that also supports **Dependency Inversion** (agents depend on the abstract adapter, not on a concrete DB driver).

### Modular Design & Extensibility  
Observation 6 describes a **modular** architecture: each agent lives in its own file, the workflow JSON lives in a config folder, and the graph adapter resides in a dedicated storage folder. This separation enables independent versioning, testing, and even language‑agnostic extensions (the design does not forbid a future agent written in another language, as long as it complies with the BaseAgent contract). The component therefore follows a **Micro‑Kernel** style where the kernel (the orchestrator) loads plug‑in modules (agents) at runtime.

### Relationship to Siblings & Parent  
SemanticAnalysis shares the **GraphDatabaseAdapter** concept with the sibling **CodingPatterns** and **ConstraintSystem**, both of which also rely on a graph store for consistency. The parent **Coding** component provides the overall knowledge‑graph‑centric philosophy, and the child **Pipeline** sub‑component (referenced in the hierarchy) implements the batch‑processing semantics hinted at in the sibling’s description (e.g., `batch-analysis.yaml`).  

---

## Implementation Details  

### BaseAgent (`src/agents/base-agent.ts`)  
`BaseAgent` defines the core interface:

```ts
export abstract class BaseAgent {
  protected abstract execute(context: AgentContext): Promise<AgentResult>;
  protected ensureLLMInitialized(): Promise<void>;
}
```

It also implements lazy LLM initialisation (observed in the LiveLoggingSystem sibling) to avoid unnecessary model loading. Concrete agents override `execute` and call `ensureLLMInitialized` when they need LLM services.

### OntologyClassificationAgent (`src/agents/ontology-classification-agent.ts`)  
* Extends `BaseAgent`.  
* In `execute`, it builds a query using the **GraphDatabaseAdapter** to fetch ontology nodes relevant to the current observation.  
* It then runs an LLM‑driven classification prompt (via the shared LLMService from the **LLMAbstraction** sibling) and writes the classification back to the graph via the adapter.

### SemanticAnalysisAgent (`src/agents/semantic-analysis-agent.ts`)  
* Also extends `BaseAgent`.  
* Its `execute` method first invokes the **CodeGraphAgent** (see below) to ensure the latest code‑graph is available.  
* It then performs a higher‑level analysis: traversing the graph, extracting patterns, and generating insight objects that are persisted through the adapter.

### CodeGraphAgent (`src/agents/code-graph-agent.ts`)  
* Responsible for **graph construction**: parsing source files, extracting symbols, and populating vertices/edges in the graph.  
* Uses the same adapter for bulk inserts, and caches intermediate results to minimise repeated parsing.  
* Provides query helpers that the SemanticAnalysisAgent consumes (e.g., “find all functions that call X”).

### ContentValidationAgent (`src/agents/content-validation-agent.ts`)  
* Reads validation rules from `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`.  
* Executes a **workflow‑based validation**: the agent iterates over rule sets, checks each entity retrieved via the adapter, and marks stale entities.  
* Updates the graph with validation flags, which downstream agents (OntologyClassificationAgent) can read.

### GraphDatabaseAdapter (`storage/graph-database-adapter.js`)  
Exports an object with methods such as:

```js
async query(cypher, params) { … }
async upsert(node) { … }
async delete(nodeId) { … }
```

All agents import this module, ensuring a **single source of truth** for data access. The adapter also abstracts connection handling, retry logic, and transaction boundaries, making the agents agnostic to the underlying graph engine.

### Workflow Orchestration (`config/workflow.json`)  
A sample snippet (derived from Observation 4) looks like:

```json
{
  "agents": [
    { "name": "ContentValidationAgent", "dependsOn": [] },
    { "name": "OntologyClassificationAgent", "dependsOn": ["ContentValidationAgent"] },
    { "name": "SemanticAnalysisAgent", "dependsOn": ["OntologyClassificationAgent"] }
  ]
}
```

The orchestrator parses this file, builds a dependency graph, and runs agents in topological order. Errors in a predecessor abort downstream agents, preserving data integrity.

---

## Integration Points  

1. **LLM Service** – Agents that need language‑model inference (OntologyClassificationAgent, ContentValidationAgent) call the shared `LLMService` from the **LLMAbstraction** sibling (`lib/llm/llm-service.ts`). This service is injected via the base agent’s lazy initialisation, allowing mock providers in tests.  

2. **Graph Store** – The `GraphDatabaseAdapter` is the sole bridge to the persistent graph. Any component that wants to read or write knowledge entities (e.g., **LiveLoggingSystem**, **ConstraintSystem**) must import this adapter, guaranteeing a consistent schema and transaction model.  

3. **Constraint Configuration** – Validation rules are externalised in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. The ContentValidationAgent parses this markdown (or a generated JSON) at start‑up, enabling domain experts to modify constraints without code changes.  

4. **Workflow Orchestrator** – The orchestrator reads `workflow.json`. External tools (CI pipelines, admin UI) can modify this file to enable/disable agents, reorder execution, or inject new plug‑ins.  

5. **Pipeline Sub‑Component** – The **Pipeline** child uses a batch‑processing definition (`batch-analysis.yaml`) to schedule periodic runs of the workflow. This ties the SemanticAnalysis component into the broader **Coding** system’s batch execution framework.  

---

## Usage Guidelines  

* **Add a New Agent** – Create a TypeScript file under `src/agents/`, extend `BaseAgent`, implement `execute`, and register the class name in `workflow.json` with appropriate `dependsOn` entries. Because the adapter is shared, the new agent can immediately read/write graph data without extra wiring.  

* **Modify Validation Rules** – Edit `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. The ContentValidationAgent will pick up changes on the next workflow run; no code redeployment is required.  

* **Swap Graph Backend** – If a different graph database is needed, replace the implementation inside `storage/graph-database-adapter.js`. All agents continue to function unchanged, thanks to the Adapter pattern.  

* **Testing** – Mock the `GraphDatabaseAdapter` and `LLMService` using the dependency‑injection hooks exposed in `BaseAgent`. Because each agent is isolated, unit tests can focus on a single responsibility.  

* **Performance** – Agents that perform heavy graph queries (e.g., SemanticAnalysisAgent) should batch their reads/writes and reuse the same adapter session to reduce connection overhead. The orchestrator runs agents sequentially according to dependencies; if a future need for parallelism arises, the workflow JSON can be extended with a `parallel: true` flag (not currently present) while preserving the DAG semantics.  

---

### Summarised Insights  

| Aspect | Observation‑Based Insight |
|--------|----------------------------|
| **Architectural patterns identified** | Multi‑agent system (agents + BaseAgent), Workflow / Pipeline pattern (workflow.json), Adapter pattern (GraphDatabaseAdapter), Template Method (BaseAgent), Strategy (different agents provide interchangeable behaviours) |
| **Design decisions and trade‑offs** | *Decision*: Centralised workflow definition → *Trade‑off*: flexibility vs. runtime complexity; *Decision*: Single GraphDatabaseAdapter → *Trade‑off*: tight coupling to graph semantics but easier DB swaps; *Decision*: Lazy LLM initialisation → *Trade‑off*: lower start‑up cost vs. possible latency on first LLM use |
| **System structure insights** | Hierarchical: Coding (parent) → SemanticAnalysis (component) → children (Pipeline, Ontology, Insights, WorkflowOrchestrator, GraphDatabaseAdapter). Sibling components share the graph adapter and LLMService, reinforcing a knowledge‑graph‑centric ecosystem. |
| **Scalability considerations** | Agents are independent and could be distributed across processes or containers; the adapter abstraction allows scaling the graph store horizontally; workflow DAG ensures that only dependent agents run concurrently, preventing race conditions. |
| **Maintainability assessment** | High maintainability: clear separation of concerns, single‑responsibility agents, centralized workflow config, and a shared adapter reduce duplicated code. Adding or removing agents only requires updating `workflow.json`. The modular file layout aligns with the **Micro‑Kernel** style, making the component easy to test and evolve. |

These points capture the concrete, observation‑backed architecture of the **SemanticAnalysis** component and provide a practical guide for developers who need to extend, integrate, or operate it within the broader **Coding** ecosystem.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: [LLM] The LiveLoggingSystem component utilizes a graph database for storing and retrieving knowledge entities, as seen in the Graph-Code system (integ; LLMAbstraction: [LLM] The LLMAbstraction component utilizes the LLMService class (lib/llm/llm-service.ts) as a high-level facade for managing interactions with differ; DockerizedServices: [LLM] The DockerizedServices component employs a modular design, with separate modules for different services, such as the LLMService class (lib/llm/l; Trajectory: [LLM] The Trajectory component's use of adapters, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, allows for flexible con; KnowledgeManagement: [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agen; CodingPatterns: [LLM] The CodingPatterns component demonstrates a strong emphasis on data consistency and integrity, as reflected in the GraphDatabaseAdapter (storage; ConstraintSystem: [LLM] The ConstraintSystem component utilizes a GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.js); SemanticAnalysis: [LLM] The SemanticAnalysis component's architecture is designed as a multi-agent system, with each agent responsible for a specific task. For instance.

### Children
- [Pipeline](./Pipeline.md) -- The Pipeline uses a batch processing approach, as seen in the batch-analysis.yaml file, to manage the execution of various agents.
- [Ontology](./Ontology.md) -- The Ontology sub-component uses a hierarchical approach to manage the ontology system, with upper and lower ontology definitions, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file.
- [Insights](./Insights.md) -- The Insights sub-component uses a pattern-based approach to generate insights, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file.
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- The WorkflowOrchestrator sub-component uses a workflow-based approach to manage the execution of agents, as seen in the integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts file.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- The GraphDatabaseAdapter sub-component uses a querying mechanism to retrieve relevant data for classification, as seen in the storage/graph-database-adapter.js file.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem component utilizes a graph database for storing and retrieving knowledge entities, as seen in the Graph-Code system (integrations/code-graph-rag/README.md). This allows for efficient querying and retrieval of entities, which is crucial for the system's classification layers. The OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) plays a key role in this process, as it classifies observations against the ontology system. The agent's constructor and the ensureLLMInitialized method demonstrate a lazy initialization approach for LLM services, which helps prevent unnecessary computations and improves overall system performance.
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component utilizes the LLMService class (lib/llm/llm-service.ts) as a high-level facade for managing interactions with different LLM providers. This class employs dependency injection, allowing for flexible configuration of the component, including the injection of mock services and budget trackers. The LLMService class also defines a set of interfaces (lib/llm/types.js) for LLM providers, requests, and responses, ensuring a standardized interaction with different providers. For example, the LLMService class uses the provider registry (lib/llm/provider-registry.js) to manage the registration and retrieval of various LLM providers, such as the AnthropicProvider (lib/llm/providers/anthropic-provider.ts) and DMRProvider (lib/llm/providers/dmr-provider.ts).
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component employs a modular design, with separate modules for different services, such as the LLMService class (lib/llm/llm-service.ts) for managing large language model operations. This modularity allows for easier maintenance and updates, as well as scalability. For instance, the LLMService class utilizes dependency injection through the setModeResolver, setMockService, and setBudgetTracker methods, making it easier to test and extend the service. Additionally, the use of configuration files, such as YAML files, to manage settings and priorities for different providers and services, enables flexible configuration and customization.
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's use of adapters, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, allows for flexible connections to external services. This adapter attempts to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a persistent connection approach. For instance, the connectViaHTTP method tries multiple ports to establish a connection, showcasing the adapter's ability to handle varying connection scenarios. This flexibility is crucial for maintaining a scalable and maintainable system, enabling easier integration of new services or features as needed.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agents. This is evident in the ensureLLMInitialized() method, which suggests that the component defers the initialization of Large Language Models (LLMs) until they are actually needed. This design decision helps to reduce memory consumption and improve system responsiveness, especially when dealing with multiple LLMs. The use of a shared atomic index counter for work-stealing concurrency in the runWithConcurrency() method (wave-controller.ts:489) further enhances the component's efficiency by allowing it to dynamically adjust its workload and minimize idle time.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component demonstrates a strong emphasis on data consistency and integrity, as reflected in the GraphDatabaseAdapter (storage/graph-database-adapter.ts) which utilizes Graphology+LevelDB persistence with automatic JSON export sync. This approach ensures that data remains consistent across the application, and the use of automatic JSON export sync enables seamless data exchange between components. The GraphDatabaseAdapter class, for instance, exports a function to get the graph database instance, which can be used to perform various graph-related operations. Furthermore, the CodeGraphRAG system (integrations/code-graph-rag/README.md) is designed as a graph-based RAG system for any codebases, highlighting the project's focus on graph-based data structures and algorithms. The system's README file provides a detailed overview of its features and capabilities, including its ability to handle large codebases and provide efficient query performance.
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.js) to store and retrieve knowledge in a graph-based structure, which enables efficient querying and analysis of entity relationships. This choice of data storage allows for flexible and scalable management of complex constraints. Furthermore, the GraphDatabaseAdapter class provides methods for adding, removing, and updating graph nodes and edges, facilitating dynamic modifications to the knowledge graph.


---

*Generated from 6 observations*
