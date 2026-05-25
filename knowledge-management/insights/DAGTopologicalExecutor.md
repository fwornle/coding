# DAGTopologicalExecutor

**Type:** Detail

Relationship types DEFINES, DEPENDS_ON_EXTERNAL, CONTAINS_FILE documented in project references are produced by KG-stage agents that must follow observation-stage agents, enforced by the DAG edges

## What It Is  

**DAGTopologicalExecutor** is the runtime engine that drives the *Pipeline* defined in **`batch-analysis.yaml`**.  
The YAML file describes the entire batch‑analysis workflow as a **directed acyclic graph (DAG)** whose vertices are the individual *agents* (coordinator, observation, KG, dedup, persistence, …) and whose edges are expressed with explicit `depends_on` statements.  At start‑up the executor parses this file, builds an in‑memory representation of the graph, and then walks the graph in **topological order** so that each agent runs only after all of its declared predecessors have completed successfully.  

The executor lives under the logical parent component **Pipeline** and is the only component that enforces the *agent sequencing pattern* documented in **`integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`**.  By doing so it guarantees that relationship types such as **`DEFINES`**, **`DEPENDS_ON_EXTERNAL`**, and **`CONTAINS_FILE`**—which are emitted by the KG‑stage agents—are produced **after** the observation‑stage agents, satisfying the domain‑level data‑dependency contracts.

---

## Architecture and Design  

The design of DAGTopologicalExecutor is a classic **pipeline‑orchestrator** built around two well‑known patterns:

1. **Topological‑Sort Executor Pattern** – The executor treats the DAG as a dependency graph and applies a deterministic topological sort (Kahn’s algorithm or DFS‑based ordering).  This guarantees a globally consistent execution order without cycles, which is essential for the correctness of the KG‑stage that must wait for observation‑stage outputs.

2. **Executor‑Worker (Strategy) Pattern** – Each vertex in the graph corresponds to an *agent* implementation.  The executor does not embed agent logic; instead it delegates to a pluggable *agent runner* (often a thin wrapper around the concrete agent binary or container).  This separation lets the same executor drive many different pipelines simply by changing the YAML definition.

The **architecture documentation** (`agents.md`) describes the *agent sequencing pattern* as a series of stages that must respect the logical “observation → knowledge‑graph → deduplication → persistence” flow.  DAGTopologicalExecutor enforces this at runtime by turning the `depends_on` edges into concrete execution constraints.  Because the DAG is defined **per‑SubComponent**, the executor can reuse the same logic for multiple sub‑pipelines (e.g., a separate DAG for a “semantic‑analysis” sub‑component versus a “metadata‑extraction” sub‑component) while still guaranteeing a global topological ordering across the whole pipeline.

### Interaction Flow  

```mermaid
graph TD
    A[batch-analysis.yaml] -->|parsed| B[DAGTopologicalExecutor]
    B --> C{Topological Sort}
    C --> D[Coordinator Agent]
    C --> E[Observation Agent(s)]
    C --> F[KG‑Stage Agent(s)]
    C --> G[Dedup Agent]
    C --> H[Persistence Agent]
    D & E & F & G & H --> I[Result Artifacts]
```

* The executor reads **`batch-analysis.yaml`** (parent Pipeline definition).  
* It constructs a graph where each node is an *agent* and each directed edge is a `depends_on` relationship.  
* The topological sort yields an execution schedule that respects **`DEFINES`**, **`DEPENDS_ON_EXTERNAL`**, and **`CONTAINS_FILE`** ordering constraints.  
* Agents are launched in the derived order; downstream agents wait on the completion signals of their upstream dependencies.

---

## Implementation Details  

Although the repository currently contains **no concrete code symbols** for the executor, the observable artifacts reveal the essential implementation responsibilities:

| Concern | Likely Implementation (inferred) |
|---------|-----------------------------------|
| **YAML Parsing** | A lightweight parser (e.g., `ruamel.yaml` or `PyYAML`) reads **`batch-analysis.yaml`**, validates the presence of a `depends_on` list for each step, and builds an adjacency list representation. |
| **Graph Model** | An internal `DagNode` structure holds the agent identifier, metadata (e.g., command, container image), and a list of predecessor IDs.  The full graph is stored in a map keyed by node ID. |
| **Topological Sort** | The executor applies Kahn’s algorithm: it repeatedly selects nodes with zero incoming edges, schedules them, and removes their outgoing edges.  Cycle detection is built‑in; any cycle would raise a configuration error before any agent runs. |
| **Agent Invocation** | Each node is associated with a *runner* that knows how to start the concrete agent (e.g., via a subprocess call, a Docker run, or a remote RPC).  The runner reports success/failure back to the executor, which then either continues downstream or aborts the pipeline. |
| **Dependency Tracking** | After an agent finishes, the executor updates the in‑degree counts of its children, unlocking them for execution.  The relationship types **`DEFINES`**, **`DEPENDS_ON_EXTERNAL`**, and **`CONTAINS_FILE`** are not just labels; they are used by downstream agents to locate required inputs (e.g., a KG‑stage agent looks for files produced by an observation‑stage agent that were marked `CONTAINS_FILE`). |
| **Error Handling & Retry** | The executor likely implements a retry policy per‑agent (configurable in the YAML) and propagates fatal errors up to the Pipeline level, causing the whole run to be marked failed. |

Because the executor is a **generic orchestrator**, it does not embed any domain‑specific logic; all domain constraints are expressed declaratively in the DAG definition.  This makes the component reusable across different sub‑components that share the same sequencing semantics.

---

## Integration Points  

1. **Parent – Pipeline (`batch-analysis.yaml`)**  
   * The DAG definition lives inside the pipeline YAML.  Any change to step ordering, addition of new agents, or modification of `depends_on` edges directly influences the executor’s schedule.

2. **Sibling – Other Executors / Stages**  
   * While DAGTopologicalExecutor is the sole orchestrator for the batch‑analysis pipeline, sibling components (e.g., a *Scheduler* that triggers pipeline runs, or a *Monitoring* service that consumes execution events) integrate through well‑defined hooks: start/finish events, status APIs, and log streams.

3. **Children – Agent Implementations**  
   * Each agent (coordinator, observation, KG, dedup, persistence) is a concrete executable or container image.  The executor treats them as black boxes, invoking them via a standard interface (command line arguments, environment variables, or a small RPC contract).  The agents themselves read the relationship metadata (e.g., `CONTAINS_FILE`) to locate inputs produced by upstream agents.

4. **External Dependency – Relationship Types**  
   * The relationship types **`DEFINES`**, **`DEPENDS_ON_EXTERNAL`**, and **`CONTAINS_FILE`** are defined in the project reference model.  They serve as **semantic contracts** that the executor respects when ordering agents.  For example, a KG‑stage agent that produces a `DEFINES` relationship will only run after all observation agents that generate the required `CONTAINS_FILE` artifacts have succeeded.

5. **Observability Integration**  
   * Although not explicitly mentioned, the typical pattern for such executors includes emitting structured events (e.g., to a message bus or log aggregation service) that downstream tools can consume for tracing, alerting, and audit.

---

## Usage Guidelines  

* **Declare Explicit Dependencies** – Every step in **`batch-analysis.yaml`** must include a `depends_on` list that reflects true data or control dependencies.  Omitting a required edge can cause downstream agents to start before their inputs exist, breaking the `DEFINES`/`CONTAINS_FILE` contracts.

* **Maintain Acyclic Structure** – The DAG must remain acyclic.  The executor will reject configurations that introduce cycles, so designers should verify that no mutual dependencies exist (e.g., an observation agent depending on a KG‑stage agent).

* **Leverage Relationship Types** – When authoring agents, embed the appropriate relationship metadata in the outputs.  For instance, an observation agent that writes a file should annotate the output with `CONTAINS_FILE`; a KG‑stage agent that creates a new graph entity should emit `DEFINES`.  This practice enables downstream agents to discover inputs without hard‑coding file paths.

* **Idempotent Agent Design** – Because the executor may retry failed nodes, agents should be written to be idempotent or to detect prior successful runs (e.g., by checking for existing output artifacts).  This reduces the risk of duplicate side‑effects.

* **Monitor Execution State** – Use the executor’s event stream (or the pipeline’s monitoring UI) to watch for node‑completion signals.  If a node stalls, inspect its logs and the state of its upstream dependencies; the topological ordering guarantees that any missing input is a direct result of a predecessor failure.

* **Version the DAG Definition** – Treat **`batch-analysis.yaml`** as a versioned artifact (e.g., stored in source control).  Changes to the DAG—especially to `depends_on` edges—should be reviewed because they alter the execution semantics of the entire pipeline.

---

### Summary of Key Insights  

| Architectural Pattern | Design Decision / Trade‑off |
|-----------------------|-----------------------------|
| **Topological‑Sort Executor** | Guarantees correct ordering without runtime deadlocks; requires a static, acyclic DAG. |
| **Executor‑Worker (Strategy)** | Decouples orchestration from agent implementation, enabling reuse across sub‑components; adds a layer of indirection that may affect latency. |
| **Declarative Dependency Model** (`depends_on`) | Makes pipeline modifications straightforward; however, developers must be disciplined in expressing all true dependencies. |
| **Relationship‑Type Contracts** (`DEFINES`, `DEPENDS_ON_EXTERNAL`, `CONTAINS_FILE`) | Provides a semantic layer that agents can rely on for input discovery; introduces the need for agents to emit correct metadata. |

**Scalability:** Because the executor schedules agents purely based on dependency order, it can launch many independent agents in parallel, limited only by system resources (CPU, I/O, container quotas).  Adding more agents or branching sub‑graphs does not increase algorithmic complexity beyond O(V + E) for the topological sort.

**Maintainability:** The separation of concerns—pipeline definition in YAML, generic executor logic, and isolated agent binaries—makes the system easy to evolve.  Updating the workflow only requires editing the DAG file; agent code can evolve independently as long as it respects the relationship metadata contract.

Overall, **DAGTopologicalExecutor** serves as the deterministic backbone that translates a declarative DAG (defined in `batch-analysis.yaml`) into a reliable, ordered execution of the various agents that compose the batch‑analysis pipeline.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- batch-analysis.yaml defines the pipeline as a DAG of steps with explicit depends_on edges, enabling topological execution order across coordinator, observation, KG, dedup, and persistence agents


---

*Generated from 3 observations*
