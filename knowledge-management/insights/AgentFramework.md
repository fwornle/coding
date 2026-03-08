# AgentFramework

**Type:** SubComponent

The AgentFramework component follows a pattern of constructor initialization and execute method invocation, as seen in the SemanticAnalysisAgent and other agents.

## What It Is  

The **AgentFramework** lives inside the SemanticAnalysis component under the directory  

```
integrations/mcp-server-semantic-analysis/src/agents/
```  

Its core artifact is the abstract `BaseAgent` class (`base‑agent.ts`).  All concrete agents – for example `OntologyClassificationAgent` (`ontology-classification-agent.ts`) and `SemanticAnalysisAgent` – inherit from this base class, gaining a **standard response envelope** and a common life‑cycle that consists of constructor‑time initialization followed by an `execute()` call.  By centralising these behaviours, AgentFramework supplies a uniform programming model for any agent that participates in the SemanticAnalysis pipeline, while also exposing execution‑graph metadata (e.g., `depends_on` edges) that the surrounding batch‑analysis orchestration can consume.

## Architecture and Design  

AgentFramework adopts a **lightweight, constructor‑initialisation + execute** pattern.  Each agent’s constructor receives its configuration and any required services, stores them as immutable fields, and then the orchestrator invokes `execute()` when the agent’s turn arrives.  This mirrors the execution model described in *batch‑analysis.yaml*, where agents are linked together with explicit `depends_on` edges; the orchestration engine performs a **topological sort** on those edges to guarantee that an agent only runs after all its declared prerequisites have completed.  

The framework also embeds a **work‑stealing scheduler** built around shared atomic counters.  Idle workers poll these counters and instantly “steal” pending tasks, which keeps the thread pool saturated without a central dispatcher.  This design is deliberately simple – it avoids heavyweight queue structures and leverages lock‑free primitives that are already present in the runtime.  

To minimise unnecessary LLM calls, AgentFramework **pre‑populates** fields such as `entityType` and `metadata.ontologyClass`.  When an observation already carries the correct ontology metadata, downstream agents can skip re‑classification, reducing latency and cost.  This optimisation is tightly coupled to the Ontology component: the ontology‑classification agent writes those metadata fields, and any later agent (including those in the Insights component) can trust their presence.

## Implementation Details  

* **BaseAgent (`base-agent.ts`)** – an abstract class that defines the response envelope (status, payload, diagnostics) and declares the abstract `execute(): Promise<Response>` method.  It also provides helper utilities for logging and for accessing the shared work‑stealing counters.  

* **Concrete agents** – each lives in its own file under the same directory (e.g., `ontology-classification-agent.ts`).  Their constructors call `super()` to register with the framework, set up any agent‑specific services (LLM client, ontology service, etc.), and optionally declare `depends_on` relationships via a static metadata object that the orchestrator reads.  

* **Execution graph** – the batch‑analysis YAML files enumerate agents and their `depends_on` edges.  At runtime the orchestrator reads these edges, builds a DAG, and runs a topological sort.  The sorted list drives the sequential `execute()` calls, while the work‑stealing scheduler allows parallel execution of independent branches.  

* **Pre‑population logic** – before an LLM call, agents inspect `observation.metadata.ontologyClass`.  If the class matches the desired classification, the agent short‑circuits and returns the existing envelope.  This check is implemented as a small utility method in `BaseAgent`, ensuring every subclass benefits without duplicate code.  

* **Work‑stealing counters** – a pair of `AtomicInteger` counters (`pendingTasks` and `completedTasks`) are stored in a shared module.  Workers atomically decrement `pendingTasks` to claim work; when a task finishes they increment `completedTasks`.  Because the counters are lock‑free, contention remains low even under high concurrency.

## Integration Points  

AgentFramework sits directly beneath the **SemanticAnalysis** parent component.  SemanticAnalysis orchestrates the end‑to‑end flow: it loads observations, hands them to the AgentFramework DAG, and finally forwards classified observations to the **Insights** component for downstream processing.  The **Pipeline** sibling also re‑uses `BaseAgent`; its own agents follow the same constructor + execute contract, enabling the pipeline to plug into the same execution engine without additional adapters.  

The **Ontology** sibling is the source of the metadata fields that AgentFramework checks to avoid redundant LLM work.  The OntologyClassificationAgent writes `entityType` and `metadata.ontologyClass`; subsequent agents (including those in Insights) read those fields to make fast decisions.  Because the dependencies are expressed through explicit `depends_on` edges, the system can safely assume that any agent that needs ontology data will only run after the OntologyClassificationAgent has completed.  

External services such as the LLM provider, database connectors, and logging infrastructure are injected via the agents’ constructors, keeping the framework agnostic to particular implementations.  This design enables the same AgentFramework codebase to be reused across different deployment environments (e.g., on‑prem vs. cloud) simply by swapping the injected dependencies.

## Usage Guidelines  

1. **Always extend `BaseAgent`.**  Do not duplicate response‑envelope logic; inherit the provided helpers for logging and metadata checks.  
2. **Declare dependencies explicitly.**  Add a static `depends_on` array (or the equivalent YAML entry) so the orchestrator can correctly order execution.  Missing dependencies can lead to race conditions where an agent attempts to read ontology metadata that has not yet been written.  
3. **Leverage pre‑population.**  Before invoking any LLM or heavy computation, inspect `observation.metadata.ontologyClass`.  If the required classification already exists, return early with the existing envelope.  This pattern is baked into `BaseAgent` as `skipIfClassified()`.  
4. **Prefer work‑stealing over manual queuing.**  Submit tasks to the shared counter rather than creating per‑agent queues; this ensures the scheduler can balance load across all workers automatically.  
5. **Keep constructors lightweight.**  Heavy initialisation should be deferred to `execute()` or to lazy‑loaded services, because the orchestrator may instantiate many agents upfront during DAG construction.  

Following these conventions guarantees that new agents integrate seamlessly with the existing execution graph, benefit from the built‑in scalability mechanisms, and respect the metadata contracts that prevent redundant processing.

---

### Architectural patterns identified  
* Constructor‑initialisation + execute method (simple command‑style pattern)  
* Explicit DAG execution via `depends_on` edges (topological‑sort orchestration)  
* Work‑stealing scheduler using shared atomic counters (lock‑free parallelism)  
* Metadata‑driven short‑circuiting to avoid redundant LLM calls (cache‑aside style)

### Design decisions and trade‑offs  
* **Uniform base class** – simplifies maintenance but couples all agents to a single response envelope format.  
* **Explicit dependencies** – provides deterministic ordering but requires developers to maintain the `depends_on` list manually.  
* **Work‑stealing via counters** – yields low‑overhead parallelism but limits task granularity to units that can be represented by a simple counter; more complex scheduling would need a richer work‑queue.  
* **Pre‑populated ontology fields** – reduces LLM cost at the expense of tighter coupling between Ontology and downstream agents.

### System structure insights  
AgentFramework is the central execution engine for SemanticAnalysis, acting as a bridge between the Ontology classification step and the downstream Insights generation.  Its sibling components (Pipeline, Ontology) share the same base class, reinforcing a cohesive “agent” ecosystem across the codebase.

### Scalability considerations  
The work‑stealing counter model scales linearly with the number of workers, provided the underlying hardware can support the atomic operations.  Because agents are independent once their `depends_on` constraints are satisfied, the DAG can be partitioned for massive parallelism.  The pre‑population of ontology metadata further caps the number of expensive LLM invocations, making the system cost‑effective at scale.

### Maintainability assessment  
Having a single `BaseAgent` class centralises common logic, which eases bug fixes and feature roll‑outs.  However, any change to the base class propagates to every agent, so the API must remain stable.  The explicit dependency graph is human‑readable (YAML) and therefore easy to audit, though it does place a documentation burden on developers to keep it accurate.  Overall, the design strikes a good balance between simplicity, extensibility, and performance, making the AgentFramework component straightforward to extend and maintain.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent having its own specific responsibilities and interfaces. For instance, the OntologyClassificationAgent, defined in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, is responsible for classifying observations against the ontology system. This agent utilizes the BaseAgent class, found in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, as its abstract base class, providing common functionality and a standard response envelope. The use of this base class allows for a consistent interface across all agents, making it easier to develop and maintain new agents. Furthermore, the OntologyClassificationAgent follows a pattern of constructor initialization and execute method invocation, as seen in the SemanticAnalysisAgent and other agents, which helps to simplify the process of creating and executing new agents.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses the BaseAgent class, found in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, as its abstract base class, providing common functionality and a standard response envelope.
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent, defined in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes the BaseAgent class as its abstract base class.
- [Insights](./Insights.md) -- The Insights component utilizes the classified observations from the Ontology system to generate insights.


---

*Generated from 7 observations*
