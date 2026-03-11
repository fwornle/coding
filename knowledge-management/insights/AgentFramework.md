# AgentFramework

**Type:** SubComponent

The AgentFramework sub-component uses the classify method in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts as an example of an agent's specific task

## What It Is  

The **AgentFramework** sub‑component lives inside the **SemanticAnalysis** module and is implemented under the `integrations/mcp-server-semantic-analysis/src/agents/` directory. Its core abstraction is the `BaseAgent` abstract class defined in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`. Every concrete agent—such as the `OntologyClassificationAgent` (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`)—inherits from `BaseAgent` and supplies a task‑specific method (e.g., `classify`). The framework therefore provides a reusable scaffold for building agents that can be plugged into the larger **Pipeline** execution engine.  

## Architecture and Design  

AgentFramework follows a **modular, inheritance‑based architecture**. The central design pattern is **Template Method**: `BaseAgent` defines the common lifecycle (e.g., the `initialize` method at line 20 of `base-agent.ts`) that prepares dependencies, while subclasses implement the concrete work (e.g., `classify` in `ontology-classification-agent.ts`). This pattern guarantees that all agents share a consistent initialization sequence while still allowing each agent to focus on its domain‑specific logic.

The framework also exhibits **composition via dependency injection**. The `initialize` routine pulls in required services (persistence, ontology metadata, etc.) and stores them on the agent instance. For example, the `PersistenceAgent`—though not shown directly—relies on the ontology metadata fields supplied during initialization, illustrating that agents are composed of reusable services rather than hard‑coded implementations.

Interaction with other system parts is explicit. Agents are **children of SemanticAnalysis** and are **consumed by the Pipeline** component, which orchestrates their execution using a DAG‑based model (as described for the sibling Pipeline). The modularity enables each agent to be swapped or extended without affecting the pipeline’s scheduling logic, reinforcing loose coupling between the agent layer and the execution engine.

## Implementation Details  

1. **`BaseAgent` (abstract)** – Located in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`. It declares the `initialize` method (line 20) that receives a dependency container and stores references such as persistence services, ontology clients, or logging utilities. Because it is abstract, it cannot be instantiated directly; instead, it forces concrete agents to implement their own public methods (e.g., `classify`).  

2. **`OntologyClassificationAgent`** – Implemented in `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`. This class extends `BaseAgent` and provides a `classify` method (starting around line 35). The method accepts raw observation data, invokes the ontology client (injected during `initialize`), and returns a classification result that aligns the observation with the system’s ontology schema.  

3. **Task‑Specific Agents** – While only the OntologyClassificationAgent is explicitly mentioned, the observations note the existence of a `PersistenceAgent` that uses ontology metadata fields. By inheriting from `BaseAgent`, it also benefits from the shared initialization logic, ensuring that all agents have a uniform way to access required services.  

4. **Modular Design** – The framework’s folder layout groups all agents together, making it straightforward to locate, add, or replace agents. Each agent file contains a single class that adheres to the `BaseAgent` contract, reinforcing the single‑responsibility principle.  

## Integration Points  

- **SemanticAnalysis (Parent)** – AgentFramework is a child of SemanticAnalysis, meaning that any semantic analysis workflow can instantiate agents via the `BaseAgent` contract. The parent component likely provides the dependency container that `initialize` consumes.  

- **Pipeline (Sibling)** – The Pipeline component executes agents as steps in its DAG‑based workflow. Because agents expose well‑defined methods (`classify`, `persist`, etc.) and share a common initialization contract, the Pipeline can treat them as interchangeable nodes, wiring `depends_on` edges without needing to know each agent’s internal details.  

- **Ontology (Sibling)** – The Ontology sub‑component defines the schema against which agents like `OntologyClassificationAgent` operate. The agent’s `classify` method directly consumes ontology services, illustrating a tight but purposeful coupling: agents are the consumers of ontology definitions, while the ontology remains a stable provider.  

- **Insights (Sibling)** – Though not directly referenced in the observations, the Insights sub‑component is expected to consume outputs from agents (e.g., classified observations) to generate higher‑level insights. This downstream relationship reinforces the pipeline‑to‑insights data flow.  

## Usage Guidelines  

1. **Always call `initialize`** – Before invoking any task‑specific method, a concrete agent must be initialized with the appropriate dependency container. Skipping this step will leave required services (persistence, ontology client) undefined and cause runtime failures.  

2. **Extend `BaseAgent` for new tasks** – When adding a new agent, inherit from `BaseAgent` and implement only the methods that represent the agent’s purpose. Do not duplicate initialization logic; rely on the inherited `initialize` implementation.  

3. **Keep agents single‑purpose** – The observations highlight that agents like `OntologyClassificationAgent` focus on a specific domain (classification). Maintaining this granularity simplifies testing, encourages reuse, and aligns with the modular design emphasized by the framework.  

4. **Register agents with the Pipeline** – To have an agent participate in the overall analysis flow, declare it as a step in the Pipeline’s DAG configuration (e.g., in `batch-analysis.yaml`). Ensure that any `depends_on` edges respect the data dependencies (e.g., classification must precede persistence).  

5. **Leverage injected services** – Use the services provided during `initialize` rather than importing modules directly. This practice preserves the decoupled nature of the framework and makes unit testing easier by allowing mocks to be injected.  

---

### Architectural patterns identified  
1. **Template Method** – `BaseAgent` defines the lifecycle (`initialize`) while subclasses provide concrete behavior (`classify`).  
2. **Dependency Injection / Composition** – Agents receive external services during initialization, avoiding hard‑coded dependencies.  

### Design decisions and trade‑offs  
- **Inheritance vs. composition** – Choosing an abstract base class enforces a uniform API but can limit multiple inheritance scenarios. The trade‑off favors consistency and easier onboarding over maximal flexibility.  
- **Modular granularity** – Designing each agent for a single task improves testability and scalability but may increase the number of components to manage.  

### System structure insights  
- AgentFramework sits under **SemanticAnalysis**, serving as the functional core for domain‑specific processing.  
- Sibling components (Pipeline, Ontology, Insights) interact through well‑defined contracts: agents consume ontology data, the pipeline schedules agents, and insights consume agent outputs.  

### Scalability considerations  
- Because agents are independent units with injected dependencies, the system can horizontally scale by running multiple agent instances in parallel, provided the underlying services (e.g., persistence store) are also scalable.  
- The DAG‑based Pipeline can add new agents without re‑architecting the execution engine, supporting growth in analysis capabilities.  

### Maintainability assessment  
- **High maintainability** – The abstract `BaseAgent` centralizes common code, reducing duplication.  
- Clear file organization and single‑responsibility agents simplify code navigation and future extensions.  
- The reliance on explicit initialization and dependency injection makes unit testing straightforward, further supporting long‑term maintainability.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component utilizes a modular design, with each agent responsible for a specific task, allowing for flexibility and scalability in the system's architecture. This is evident in the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts), which is designed to classify observations against the ontology system. The agent's classify method (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts:35) demonstrates this modularity, as it takes in observation data and returns a classified result. Furthermore, the use of the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) abstract class provides common functionality for all agents, such as the initialize method (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts:20), which sets up the agent's dependencies.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent in the Ontology sub-component uses the classify method in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts to classify observations against the ontology system
- [Insights](./Insights.md) -- The Insights sub-component uses the generateInsights method in a hypothetical integrations/mcp-server-semantic-analysis/src/agents/insights-agent.ts to generate insights from the processed data


---

*Generated from 7 observations*
