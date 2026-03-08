# AgentManagement

**Type:** SubComponent

The AgentManager utilizes the WaveController.runWithConcurrency() function to implement work-stealing via shared nextIndex counter, allowing idle workers to pull tasks immediately.

## What It Is  

The **AgentManagement** sub‑component lives inside the **SemanticAnalysis** module of the MCP server. Its core implementation is anchored in the file  
`integrations/mcp-server-semantic-analysis/src/agents/agent-manager.ts`.  The `AgentManager` class defined there is responsible for orchestrating the lifecycle of individual agents (e.g., *OntologyClassificationAgent*, *InsightGenerationAgent*) that each have their own configuration files under the same `src/agents` folder.  The sub‑component supplies a single, well‑defined entry point – the `execute` method – that every concrete agent inherits from the base class located at `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`.  By pulling in ontology metadata that the `PersistenceAgent` pre‑populates, the manager can make informed decisions about which agents to run and in what order.

## Architecture and Design  

AgentManagement follows a **modular, plug‑in architecture**.  Each agent is a self‑contained unit with its own configuration (e.g., `ontology-classification-agent.ts`, `insight-generation-agent.ts`).  This modularity is explicitly called out in observations 2 and 6 and is reinforced by the shared `execute` contract in the base‑agent class.  The design therefore encourages independent development, testing, and replacement of agents without touching the surrounding pipeline.

Two concrete architectural mechanisms are evident:

1. **Work‑stealing concurrency** – The manager delegates actual work to the `WaveController.runWithConcurrency()` function.  The function uses a shared `nextIndex` counter so that idle workers can immediately “steal” the next pending task, reducing idle time and improving throughput.  This pattern is highlighted in observation 5.

2. **DAG‑based scheduling** – The `BatchScheduler` provides a directed‑acyclic‑graph (DAG) execution model that orders agent execution based on dependencies.  Observation 7 notes that the manager leverages this model, ensuring that agents whose inputs depend on the output of others are run in a topologically sorted sequence.  The sibling component **Pipeline** also uses a DAG‑based batch analysis (`batch-analysis.yaml`), showing a consistent scheduling strategy across the broader system.

Together, these mechanisms give AgentManagement a clear separation of concerns: the **modular agent layer** defines *what* to run, while the **concurrency controller** and **batch scheduler** dictate *how* and *when* to run them.

## Implementation Details  

The central class, `AgentManager`, resides in `integrations/mcp-server-semantic-analysis/src/agents/agent-manager.ts`.  Its public `execute` method is the canonical entry point for all agents.  Internally, `execute` performs the following steps:

1. **Metadata ingestion** – It reads ontology metadata fields that the `PersistenceAgent` has already populated.  This metadata drives selection and configuration of downstream agents (observation 4).

2. **Task graph construction** – Using the `BatchScheduler`, the manager builds a DAG that captures inter‑agent dependencies.  The DAG is later fed to the scheduler’s topological sort routine, guaranteeing that prerequisite agents finish before dependents start (observation 7).

3. **Concurrent dispatch** – The manager hands the sorted task list to `WaveController.runWithConcurrency()`.  The WaveController maintains a shared `nextIndex` counter; each worker thread repeatedly reads and increments this counter to claim the next available task, achieving work‑stealing without a central queue (observation 5).

4. **Agent execution** – For each claimed task, the worker invokes the concrete agent’s `execute` implementation (inherited from `base-agent.ts`).  Because every agent adheres to the same method signature, the manager can treat them uniformly, reinforcing the standardized interface noted in observation 3.

The modularity is further emphasized by the presence of per‑agent configuration files such as `ontology-classification-agent.ts` and `insight-generation-agent.ts`.  These files declare each agent’s specific dependencies, allowing the manager to instantiate and wire them at runtime without hard‑coded references.

## Integration Points  

AgentManagement sits directly under the **SemanticAnalysis** parent component, which itself adopts the same modular agent philosophy.  It consumes ontology metadata produced by the **PersistenceAgent** (a sibling within the same domain) and feeds its results downstream to other high‑level components such as **Pipeline**, **Ontology**, and **Insights**.  The **Pipeline** sibling also relies on a DAG‑based batch coordinator, meaning that both Pipeline and AgentManagement can share the same `BatchScheduler` implementation without duplication.

External integration occurs through the following interfaces:

| Integration | Path / Interface | Role |
|-------------|------------------|------|
| `PersistenceAgent` | Provides pre‑populated ontology metadata fields | Supplies input data for agent selection |
| `WaveController` | `runWithConcurrency()` (invoked from `agent-manager.ts`) | Handles parallel execution and work‑stealing |
| `BatchScheduler` | DAG construction & topological sort (used in `agent-manager.ts`) | Orders agent execution based on dependencies |
| Individual agents | Config files (`ontology-classification-agent.ts`, `insight-generation-agent.ts`, etc.) | Define concrete behavior and dependencies |

These points illustrate a tightly‑coupled yet well‑abstracted ecosystem: each component knows only the contracts it needs (metadata, DAG, concurrency API) and does not depend on internal implementation details of its peers.

## Usage Guidelines  

1. **Add a new agent** – Create a dedicated configuration file under `src/agents/` (mirroring the pattern used by `ontology-classification-agent.ts`).  Extend `BaseAgent` and implement the `execute` method.  Register the new class in the manager’s configuration so that the DAG builder can discover its dependencies.

2. **Define dependencies** – Populate the agent’s configuration with explicit input‑output relationships.  The `BatchScheduler` will automatically incorporate these edges into the execution DAG, preserving correct ordering.

3. **Leverage concurrency** – When an agent’s workload is CPU‑bound or I/O‑heavy, rely on the existing `WaveController.runWithConcurrency()` path rather than implementing custom threading.  The shared `nextIndex` work‑stealing mechanism ensures optimal utilization of worker threads.

4. **Maintain metadata contracts** – Ensure that any changes to the ontology metadata schema (produced by `PersistenceAgent`) are reflected in the manager’s metadata ingestion logic.  Breaking this contract will cause incorrect agent selection or scheduling failures.

5. **Testing** – Because each agent is isolated, unit‑test it against the `BaseAgent` contract.  Integration tests should verify that the DAG is constructed as expected and that concurrent execution does not introduce race conditions (the `nextIndex` counter is the sole shared mutable state).

---

### Architectural Patterns Identified  

* **Modular plug‑in architecture** – each agent is a self‑contained module with its own config.  
* **Standardized interface pattern** – a common `execute` method defined in `BaseAgent`.  
* **Work‑stealing concurrency** – implemented via `WaveController.runWithConcurrency()` and a shared `nextIndex`.  
* **DAG‑based scheduling** – orchestrated by `BatchScheduler` to respect inter‑agent dependencies.

### Design Decisions & Trade‑offs  

* **Modularity vs. runtime overhead** – The plug‑in model eases development and testing but introduces a configuration parsing step at start‑up.  
* **Work‑stealing vs. centralized queue** – Work‑stealing reduces contention and improves load balance, at the cost of a single atomic counter that must be thread‑safe.  
* **DAG scheduling vs. linear pipelines** – DAGs enable parallelism for independent agents but require careful dependency definition to avoid cycles.

### System Structure Insights  

AgentManagement is the orchestration layer for the agent ecosystem within **SemanticAnalysis**.  It bridges metadata providers (`PersistenceAgent`), scheduling infrastructure (`BatchScheduler`), and concurrency primitives (`WaveController`).  Its sibling components share the same DAG‑based execution model, indicating a system‑wide commitment to dependency‑driven parallelism.

### Scalability Considerations  

* **Horizontal scaling** – Adding more worker threads (or processes) automatically benefits from the work‑stealing algorithm, as idle workers can continue pulling tasks from the shared `nextIndex`.  
* **Task graph size** – The DAG approach scales linearly with the number of agents; however, very large graphs may increase topological sort time, suggesting the need for incremental DAG updates if the agent set grows dramatically.  
* **Metadata volume** – Since the manager relies on pre‑populated ontology metadata, the size of that metadata should remain bounded; otherwise, ingestion could become a bottleneck.

### Maintainability Assessment  

The modular configuration files and the unified `execute` contract make the codebase highly maintainable.  Adding, removing, or updating an agent does not require changes to the core manager logic, only to the agent’s own file and its dependency declarations.  The clear separation between concurrency (`WaveController`), scheduling (`BatchScheduler`), and business logic (individual agents) further isolates concerns, simplifying debugging and future refactoring.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a modular approach to agent development, with each agent having its own configuration and initialization logic. For instance, the OntologyClassificationAgent has its own configuration file (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) that defines its behavior and dependencies. This modular approach allows for easier maintenance and extension of the agents, as each agent can be developed and tested independently. The execute method in the base-agent.ts file (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) serves as the entry point for each agent's execution, providing a standardized interface for agent interactions.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline's batch processing is orchestrated by the coordinator agent, which utilizes a DAG-based execution model with topological sort in batch-analysis.yaml steps.
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent utilizes a configuration file in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts to define its behavior and dependencies.
- [Insights](./Insights.md) -- The InsightGenerationAgent utilizes a configuration file in integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts to define its behavior and dependencies.


---

*Generated from 7 observations*
