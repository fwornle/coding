# AgentManager

**Type:** SubComponent

The AgentManager uses the agent life cycle management algorithm from agent-life-cycle-management.ts to manage agent life cycle

## What It Is  

The **AgentManager** lives inside the *SemanticAnalysis* component of the multi‑agent system (see `integrations/mcp-server-semantic-analysis/src/agents/agent-manager.ts` – the exact file name is not listed in the observations but the manager is referenced from that directory). It is a **SubComponent** whose responsibility is to orchestrate the lifecycle of the various agents that the SemanticAnalysis pipeline employs, most notably the **OntologyClassificationAgent**. By re‑using the **BaseAgent** contract (`integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`) and the **AgentFactory** (`integrations/mcp-server-semantic-analysis/src/agents/agent-factory.ts`), the manager guarantees that every spawned agent conforms to a common request/response envelope and that agents are created only when needed. The manager also pre‑populates immutable metadata fields for each agent, holds a shared `nextIndex` counter that enables idle workers to pull work immediately, and relies on the **agent‑life‑cycle‑management** algorithm (`integrations/mcp-server-semantic-analysis/src/agents/agent‑life‑cycle‑management.ts`) to transition agents through creation, execution, and termination phases.

---

## Architecture and Design  

The architecture around **AgentManager** is deliberately **modular and pattern‑driven**. The core design pattern is the **BaseAgent pattern**: every concrete agent (e.g., `ontology-classification-agent.ts`) extends the abstract behavior defined in `base-agent.ts`. This pattern enforces a uniform interface for handling inputs, producing a response envelope, and exposing lifecycle hooks. By centralising that contract, the manager can treat all agents as interchangeable workers, which simplifies scheduling and monitoring logic.

Agent creation is delegated to the **AgentFactory** (`agent-factory.ts`). This is a classic **Factory** pattern that abstracts the instantiation details (including dependency injection of the ontology system, LLM services, etc.) from the manager. The manager therefore does not need to know the concrete class names or constructor signatures; it merely asks the factory for an agent of a given type.

The **agent‑life‑cycle‑management** module supplies a deterministic algorithm for moving agents through states such as *initialized*, *idle*, *working*, and *terminated*. The manager invokes this algorithm whenever it updates the `nextIndex` counter or when it pre‑populates metadata, ensuring that state transitions are consistent across the whole system.

Finally, the **shared `nextIndex` counter** acts as a lightweight coordination primitive. Rather than a heavyweight message queue, idle workers read the counter to discover the next task index, allowing them to “pull” work immediately. This design mirrors a **pull‑based work distribution** model and avoids the need for explicit push notifications.

---

## Implementation Details  

1. **BaseAgent Integration** – All agents, including the manager’s workers, inherit from the abstract class in `base-agent.ts`. This base class defines methods such as `prepareResponseEnvelope()`, `handleInput()`, and `finalize()`. The manager relies on these methods to wrap raw agent outputs into a standard envelope before they are consumed by downstream components (e.g., the **SemanticInsightGenerator**).

2. **Metadata Pre‑population** – Before an agent is handed to the factory, the manager fills out immutable fields (e.g., `agentId`, `creationTimestamp`, `ontologyVersion`). By doing this once, the system avoids redundant writes and guarantees that every agent carries the same provenance information, which is crucial for debugging and audit trails.

3. **Shared `nextIndex` Counter** – Implemented as a simple numeric variable (likely stored in a shared in‑memory object or a lightweight Redis key), the counter is incremented atomically each time a new task is queued. Workers poll this counter, compare it with their own local index, and start processing as soon as they see a higher value. This eliminates the need for a separate task queue and reduces latency.

4. **AgentFactory Usage** – The manager calls a method such as `AgentFactory.createAgent(type, metadata)` to obtain a fully‑wired agent instance. The factory encapsulates the import of `ontology-classification-agent.ts`, wiring of the ontology system, and any LLM client configuration. This separation keeps the manager’s code focused on orchestration rather than construction details.

5. **Lifecycle Management** – The algorithm from `agent‑life‑cycle‑management.ts` is invoked at key points: after creation (to move the agent to *idle*), when a worker pulls a task (transition to *working*), and on completion or error (transition to *terminated*). The manager records these state changes, possibly updating a central registry that other components (e.g., **Insights** or **Pipeline**) can query.

---

## Integration Points  

* **Parent – SemanticAnalysis** – The manager is a child of the `SemanticAnalysis` component, which defines the overall multi‑agent workflow. `SemanticAnalysis` delegates the classification of observations to the **OntologyClassificationAgent**, which the manager creates and schedules. Consequently, any change in the manager’s scheduling logic directly influences the throughput of the entire semantic analysis pipeline.

* **Sibling – OntologyClassificationAgent** – This agent lives in `ontology-classification-agent.ts` and follows the same BaseAgent contract. Because both the manager and the OntologyClassificationAgent share the BaseAgent pattern, they can be swapped or extended without breaking the orchestration layer.

* **Sibling – Pipeline** – The `Pipeline` component uses a DAG‑based execution model (see `batch-analysis.yaml`). While the pipeline schedules high‑level steps, the AgentManager handles the fine‑grained parallelism within a step, pulling tasks via the shared `nextIndex`. The two layers complement each other: the pipeline decides *what* should run, the manager decides *how* individual observations are processed concurrently.

* **Sibling – Insights & SemanticInsightGenerator** – Once agents finish their work, the response envelopes are consumed by the `SemanticInsightGenerator`, which uses LLMs and the code‑graph context to produce higher‑level insights. The manager’s responsibility is to ensure that the envelopes are correctly formed and delivered in a timely fashion.

* **External – Ontology System** – The manager indirectly uses the ontology classification logic provided by `ontology-classification-agent.ts`. The ontology system itself is likely a separate service or module that the agent queries; the manager does not interact with it directly but must ensure agents have the correct configuration (e.g., ontology version) through the pre‑populated metadata.

---

## Usage Guidelines  

1. **Always obtain agents through AgentFactory** – Direct instantiation of agents bypasses the metadata pre‑population step and can lead to inconsistent envelopes. Developers should call `AgentFactory.createAgent()` and pass the metadata that the manager expects.

2. **Do not modify the shared `nextIndex` directly** – The counter is the coordination point for all idle workers. Any manual adjustment risks race conditions and lost tasks. Use the manager’s public methods (`incrementTaskIndex()`, `getCurrentIndex()`) if they exist.

3. **Respect the BaseAgent contract** – When extending the system with new agents, inherit from `base-agent.ts` and implement the required lifecycle hooks. This ensures the manager can schedule the new agent without additional code changes.

4. **Keep metadata immutable after creation** – The manager pre‑populates fields such as `agentId` and `ontologyVersion`. Changing these after the agent has been handed to the factory can break audit trails and downstream debugging tools.

5. **Handle lifecycle events** – If an agent encounters an error, invoke the lifecycle management API to transition the agent to a *terminated* state. This guarantees that the manager’s internal registry stays accurate and that idle workers can continue pulling new tasks.

---

### Architectural Patterns Identified  
* **BaseAgent pattern** – a shared abstract class defining a uniform agent interface.  
* **Factory pattern** – `AgentFactory` abstracts concrete agent construction.  
* **Pull‑based work distribution** – the shared `nextIndex` counter enables workers to self‑schedule.  
* **Lifecycle management algorithm** – deterministic state‑transition logic from `agent‑life‑cycle‑management.ts`.

### Design Decisions & Trade‑offs  
* **Uniform contract vs. flexibility** – Enforcing the BaseAgent interface simplifies orchestration but can limit agents that need radically different APIs.  
* **Factory abstraction vs. runtime overhead** – Centralising creation adds a thin indirection layer; the cost is negligible compared with the benefit of consistent metadata handling.  
* **Shared counter vs. message queue** – The counter is lightweight and low‑latency but lacks built‑in durability; a crash could lose pending tasks, whereas a queue would persist them.

### System Structure Insights  
AgentManager sits at the heart of the *SemanticAnalysis* sub‑system, bridging the high‑level DAG execution of the `Pipeline` with the concrete classification work performed by agents. Its reliance on shared utilities (`base-agent.ts`, `agent-factory.ts`, `agent-life-cycle-management.ts`) creates a tightly‑coupled but well‑encapsulated module that can be reasoned about in isolation.

### Scalability Considerations  
Because work distribution is driven by a simple atomic counter, scaling to many concurrent workers is straightforward—each worker only needs read access to the counter and can proceed independently. However, the counter becomes a contention point under extreme load; moving it to a distributed atomic store (e.g., Redis with `INCR`) would mitigate bottlenecks. The BaseAgent pattern also allows horizontal scaling: adding more agent instances does not require changes to the manager.

### Maintainability Assessment  
The use of explicit patterns (BaseAgent, Factory, lifecycle algorithm) yields high maintainability. New agents can be added by extending the base class and registering them with the factory, without touching the manager’s orchestration code. The pre‑populated metadata approach centralises provenance data, aiding debugging. The only maintenance risk is the shared `nextIndex` counter; developers must ensure its atomicity and monitor for race conditions as the system grows. Overall, the design promotes clear separation of concerns and predictable behavior, making future extensions and bug fixes relatively low‑effort.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a multi-agent system architecture, which allows for the integration of various agents, each with its own specific responsibilities. For instance, the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) is responsible for classifying observations against the ontology system. This agent follows the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) pattern, which standardizes agent behavior and response envelope creation. The use of this pattern ensures consistency across all agents, making it easier for new developers to understand and contribute to the codebase.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent uses the BaseAgent pattern from base-agent.ts to standardize agent behavior and response envelope creation
- [Insights](./Insights.md) -- The SemanticInsightGenerator uses the LLM and code graph context to generate semantic insights
- [SemanticInsightGenerator](./SemanticInsightGenerator.md) -- The SemanticInsightGenerator uses the LLM and code graph context to generate semantic insights
- [GitHistoryAnalyzer](./GitHistoryAnalyzer.md) -- The GitHistoryAnalyzer uses the GitHistory class from git-history.ts to analyze git history
- [KnowledgeGraph](./KnowledgeGraph.md) -- The KnowledgeGraph uses the GraphDatabase class from graph-database.ts to store and manage knowledge graph data


---

*Generated from 7 observations*
