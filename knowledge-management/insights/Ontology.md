# Ontology

**Type:** SubComponent

The OntologyClassificationAgent, defined in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes the BaseAgent class as its abstract base class.

## What It Is  

The **Ontology** sub‑component lives inside the **SemanticAnalysis** domain of the MCP server. Its concrete implementation is anchored in the file  
`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`, which defines the **OntologyClassificationAgent**. This agent inherits from the abstract **BaseAgent** class located at `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`. The Ontology layer supplies two complementary definition sets: an **upper ontology** that standardises the response envelope returned by every agent, and a **lower ontology** that encodes explicit `depends_on` edges to drive the execution order of downstream tasks. Together they enable the system to classify incoming observations against a shared semantic model while avoiding unnecessary re‑classification of entities that already carry the required ontology metadata (`entityType`, `metadata.ontologyClass`).

## Architecture and Design  

The Ontology sub‑component follows a **template‑method inheritance pattern**: concrete agents such as **OntologyClassificationAgent** extend **BaseAgent**, inheriting common plumbing (logging, error handling, response‑envelope construction) and overriding the `execute` method that contains the domain‑specific logic. This mirrors the pattern used by the sibling **SemanticAnalysisAgent** and the **Pipeline** component, reinforcing a uniform agent contract across the entire **AgentFramework** sibling.

Execution is orchestrated as a **dependency‑graph (DAG) model**. The lower‑ontology definitions explicitly declare `depends_on` edges, which the runtime scheduler respects when invoking agents. This guarantees that prerequisite agents (e.g., entity‑type resolution) complete before dependent agents (e.g., classification) start, eliminating race conditions and ensuring deterministic results.

Concurrency is handled via a **work‑stealing scheduler**. Validation steps inside the Ontology system maintain a shared counter; idle workers can atomically pull the next task, keeping CPU utilisation high without centralised task queues. This design choice reduces latency for high‑throughput workloads, especially when many observations arrive simultaneously.

Finally, the system employs **field pre‑population and metadata gating** as optimisation shortcuts. When an observation already contains `entityType` or `metadata.ontologyClass`, the OntologyClassificationAgent short‑circuits the LLM re‑classification step, preventing duplicate expensive calls. This is a form of **idempotent processing** that improves throughput and cost efficiency.

## Implementation Details  

- **BaseAgent (`base-agent.ts`)** supplies the abstract contract: a constructor that receives a context object, a protected `prepare()` hook, and an abstract `execute()` method. It also builds the **standard response envelope** defined by the upper ontology, guaranteeing that every agent returns a payload with the same shape (status, data, diagnostics).  
- **OntologyClassificationAgent (`ontology-classification-agent.ts`)** overrides `execute()` to perform three logical stages:  
  1. **Entity‑type resolution** – reads the incoming observation, checks for existing `entityType` and `metadata.ontologyClass`, and populates them if missing.  
  2. **Dependency check** – consults the lower‑ontology graph to verify that any `depends_on` edges are satisfied before proceeding.  
  3. **Classification** – invokes the LLM only when metadata is absent, then writes the resulting ontology class back into the observation.  
- **Upper ontology definitions** (not a separate file in the observations but conceptually present) dictate the fields of the response envelope (`response.status`, `response.payload`, `response.metadata`). All agents, including **Pipeline** and **Insights**, rely on this envelope to exchange data.  
- **Lower ontology definitions** embed the `depends_on` relationships; the scheduler reads these edges to build the execution order.  
- **Work‑stealing validation** uses a shared atomic counter (likely a `SharedArrayBuffer` or similar construct) that workers decrement to claim a task. When the counter reaches zero, workers automatically poll for new work, ensuring minimal idle time.  

The combination of inheritance, DAG‑based scheduling, and concurrency primitives creates a tightly coupled yet modular processing pipeline that can be extended by adding new agents that simply extend **BaseAgent** and declare their dependencies.

## Integration Points  

Ontology is tightly coupled to its **parent component**, **SemanticAnalysis**, which provides the overall orchestration framework and injects the shared context (configuration, logger, LLM client). The **Pipeline** sibling also extends **BaseAgent**, meaning it can be composed in the same execution graph and share the same response envelope conventions. The **Insights** component consumes the classified observations produced by the Ontology sub‑system to generate higher‑level business insights; it therefore expects the envelope fields defined by the upper ontology.  

From an interface perspective, the OntologyClassificationAgent receives its input via the standard agent contract (a JSON payload wrapped in the response envelope) and returns the same envelope after classification. The explicit `depends_on` edges expose a clear contract for any downstream consumer: they must declare their dependencies in the lower‑ontology definition file so that the scheduler can respect ordering.  

The **AgentFramework** sibling provides the abstract base class and the scheduler implementation; any new agent that wishes to participate in the Ontology workflow must import `BaseAgent` from `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts` and register its dependencies accordingly.

## Usage Guidelines  

1. **Extend BaseAgent** – When creating a new Ontology‑related agent, inherit from `BaseAgent` and implement only the `execute()` method. Re‑use the constructor pattern shown in `ontology-classification-agent.ts` to receive the shared context.  
2. **Declare Dependencies** – Add explicit `depends_on` entries in the lower‑ontology definition for any prerequisite work (e.g., entity‑type resolution) so the scheduler can order execution correctly.  
3. **Leverage Metadata Guarding** – Always check `entityType` and `metadata.ontologyClass` before invoking an LLM. This prevents redundant classification and aligns with the optimisation strategy already baked into the Ontology system.  
4. **Respect the Response Envelope** – Return data wrapped in the upper‑ontology envelope (`status`, `payload`, `metadata`). This ensures downstream components like **Insights** can parse results without custom adapters.  
5. **Design for Concurrency** – If the agent performs heavy computation, rely on the existing work‑stealing mechanism by updating the shared counter rather than implementing a bespoke thread‑pool. This preserves the system’s scalability characteristics.

---

### Summary of Key Architectural Insights  

1. **Architectural patterns identified**  
   * Template‑method inheritance via `BaseAgent`  
   * DAG‑based execution driven by explicit `depends_on` edges (lower ontology)  
   * Work‑stealing concurrency with shared counters (validation phase)  
   * Idempotent processing through metadata pre‑population  

2. **Design decisions and trade‑offs**  
   * Centralising common agent behaviour in `BaseAgent` reduces duplication but couples all agents to a single inheritance hierarchy.  
   * Explicit dependency edges give deterministic ordering at the cost of requiring careful maintenance of the lower‑ontology graph.  
   * Work‑stealing improves throughput for bursty loads but introduces complexity in debugging task allocation.  
   * Skipping LLM calls when metadata exists saves cost, yet relies on the correctness of upstream metadata population.  

3. **System structure insights**  
   * Ontology sits as a child of **SemanticAnalysis**, sharing the same agent framework with siblings **Pipeline**, **Insights**, and **AgentFramework**.  
   * The upper ontology enforces a uniform contract across all agents, while the lower ontology orchestrates execution order.  
   * The **OntologyClassificationAgent** is the primary consumer of the ontology definitions, acting as the bridge between raw observations and downstream insight generation.  

4. **Scalability considerations**  
   * The work‑stealing scheduler allows the system to scale horizontally across many worker threads or processes, keeping CPU utilisation high.  
   * Dependency‑graph execution can become a bottleneck if a critical upstream agent (e.g., entity‑type resolution) slows down; careful profiling and possible parallelisation of independent sub‑graphs are advisable.  
   * Metadata‑based short‑circuiting reduces LLM load, which is a major scalability factor given the cost and latency of external language models.  

5. **Maintainability assessment**  
   * The clear inheritance hierarchy and standard response envelope make it straightforward for new developers to add agents.  
   * However, the explicit `depends_on` declarations require diligent documentation; missing or circular dependencies could cause subtle runtime failures.  
   * Centralising concurrency logic in the validation step means changes to the work‑stealing mechanism propagate automatically to all agents, aiding maintainability but also increasing the impact radius of bugs in that subsystem.  

By adhering to the patterns and guidelines outlined above, developers can extend the Ontology sub‑component confidently while preserving the consistency, performance, and maintainability that the current architecture provides.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent having its own specific responsibilities and interfaces. For instance, the OntologyClassificationAgent, defined in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, is responsible for classifying observations against the ontology system. This agent utilizes the BaseAgent class, found in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, as its abstract base class, providing common functionality and a standard response envelope. The use of this base class allows for a consistent interface across all agents, making it easier to develop and maintain new agents. Furthermore, the OntologyClassificationAgent follows a pattern of constructor initialization and execute method invocation, as seen in the SemanticAnalysisAgent and other agents, which helps to simplify the process of creating and executing new agents.

### Children
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- The OntologyClassificationAgent utilizes the BaseAgent class as its abstract base class, indicating a modular design approach.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses the BaseAgent class, found in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, as its abstract base class, providing common functionality and a standard response envelope.
- [Insights](./Insights.md) -- The Insights component utilizes the classified observations from the Ontology system to generate insights.
- [AgentFramework](./AgentFramework.md) -- The AgentFramework component provides a standard interface for all agents through the BaseAgent class.


---

*Generated from 7 observations*
