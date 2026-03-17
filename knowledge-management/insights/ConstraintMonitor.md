# ConstraintMonitor

**Type:** SubComponent

The constraint monitoring system enables easier modification and extension of the agent's functionality, as demonstrated in the implementation of the SemanticAnalysisAgent in integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts.

## What It Is  

**ConstraintMonitor** is a sub‑component that lives inside the **SemanticAnalysis** stack and is responsible for tracking, reporting, and managing constraint violations that arise during semantic processing. The core of the implementation lives under the `integrations/mcp-constraint-monitor/` directory. Its public documentation is spread across several markdown files:

* **Dashboard** – `integrations/mcp-constraint-monitor/dashboard/README.md` describes a UI that visualises constraint violations in real time.  
* **Claude Code Hook Data Format** – `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` defines the JSON payload structure used when agents emit constraint‑related events.  
* **Constraint Configuration** – `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` explains how constraints are declared and loaded.  
* **Semantic Constraint Detection** – `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` details the detection logic that runs inside the monitoring agents.  

Together these files describe a **modular, agent‑centric system** that can be extended without touching the core monitor. The component also contains a child entity, **ConstraintConfigurationLoader**, which is the concrete loader that parses the configuration described in the docs.

---

## Architecture and Design  

The observations repeatedly point to a **modular architecture** built around **agents**. The high‑level README (`integrations/mcp-constraint-monitor/README.md`) states that the monitor “uses a modular architecture, with multiple agents responsible for specific tasks.” Each agent follows a **standardised structure** (the “BaseAgent pattern”) that is also used by sibling components such as the **SemanticAnalysisAgent** (`integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts`). This pattern provides a common lifecycle (initialisation → execution → reporting) and a shared interface for emitting events in the Claude Code Hook format.

The **ConstraintConfigurationLoader** child component is responsible for ingesting the declarative constraint definitions described in `docs/constraint-configuration.md`. By separating configuration loading from detection, the design isolates I/O concerns from the runtime agents, making it straightforward to swap out the source of constraints (e.g., JSON file, database, remote service) without altering detection logic.

Interaction flow (derived from the docs):

1. **Configuration Load** – At start‑up, the `ConstraintConfigurationLoader` reads the structured constraint definitions.  
2. **Detection Agents** – The **Semantic Constraint Detection Agent** (`docs/semantic-constraint-detection.md`) consumes the loaded constraints and analyses incoming semantic payloads (produced by other agents in the SemanticAnalysis pipeline).  
3. **Event Emission** – When a violation is found, the agent emits a payload that conforms to the **Claude Code Hook Data Format** (`docs/CLAUDE-CODE-HOOK-FORMAT.md`).  
4. **Dashboard Consumption** – The dashboard component (`dashboard/README.md`) subscribes to those events and renders a live view of violations.

Because the same BaseAgent pattern is used across the **OntologyClassificationAgent**, **InsightGenerationAgent**, and other sibling agents, the ConstraintMonitor shares a common development contract with its siblings, promoting reuse and reducing cognitive load for developers moving between Pipeline, Ontology, and Insights modules.

---

## Implementation Details  

* **Agent Standardisation** – All agents, including those in ConstraintMonitor, inherit from a base class defined in `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`. This base class supplies methods such as `initialize()`, `process(input)`, and `emit(event)`. The **SemanticAnalysisAgent** demonstrates the pattern in practice, and the same scaffold is applied to the constraint detection agent.

* **ConstraintConfigurationLoader** – Although the source code is not listed, the documentation (`docs/constraint-configuration.md`) indicates a loader that parses a well‑structured configuration file (likely JSON or YAML). The loader exposes an API like `loadConstraints(): ConstraintSet` that downstream agents query.

* **Claude Code Hook Format** – The monitor’s event contract is defined in `docs/CLAUDE-CODE-HOOK-FORMAT.md`. The format includes fields such as `constraintId`, `severity`, `location`, and a human‑readable `message`. Agents serialize violations into this shape before publishing, ensuring that downstream consumers (e.g., the dashboard) have a stable schema.

* **Dashboard UI** – The dashboard README describes a web‑based view that pulls violation events from a message broker or API endpoint. It visualises each violation with its severity, source location, and a link back to the offending semantic element. The UI is decoupled from the detection logic; it merely consumes the standardized hook payload.

* **Modularity & Extensibility** – Adding a new type of constraint simply requires extending the configuration schema and implementing a new detection routine inside the existing agent framework. No changes to the dashboard or the base agent are necessary, because they rely solely on the Claude Code Hook contract.

---

## Integration Points  

* **Parent – SemanticAnalysis** – ConstraintMonitor sits inside the **SemanticAnalysis** component, which orchestrates a suite of agents (OntologyClassificationAgent, SemanticAnalysisAgent, ContentValidationAgent). The monitor receives the same semantic payloads that these agents produce, allowing it to validate constraints against the enriched data.

* **Sibling – Pipeline, Ontology, Insights** – Because all sibling components adopt the BaseAgent pattern, they can emit or consume events using the same Claude Code Hook format. For example, the **InsightGenerationAgent** can generate an insight when a particular constraint violation reaches a critical severity, leveraging the same event bus.

* **Child – ConstraintConfigurationLoader** – The loader is the bridge between static configuration files and the runtime detection agents. It is invoked during system start‑up and may also be refreshed on‑demand (e.g., via a hot‑reload endpoint) to accommodate evolving business rules.

* **External Interfaces** – The dashboard consumes the violation stream, likely via a WebSocket or REST endpoint defined elsewhere in the system. The Claude Code Hook format serves as the contract for any external consumer that wishes to react to constraint events (e.g., alerting services, audit logs).

* **Data Flow** – The overall flow can be visualised as: **SemanticAnalysis agents → ConstraintConfigurationLoader (static rules) → Semantic Constraint Detection Agent → Claude‑formatted event → Dashboard / downstream services**.

---

## Usage Guidelines  

1. **Follow the BaseAgent contract** – When creating a new constraint‑related agent, extend the `BaseAgent` class located at `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`. Implement `initialize()`, `process(input)`, and use `emit(event)` to publish violations in the Claude Code Hook format.

2. **Declare constraints using the documented schema** – All constraints must be defined according to the structure described in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. Keep the configuration file version‑controlled and validate it with the `ConstraintConfigurationLoader` before deployment.

3. **Emit events that conform exactly to the Claude format** – The fields and data types specified in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` are the only ones the dashboard recognises. Missing or extra fields will cause the UI to ignore the event.

4. **Test detection logic in isolation** – Because the detection agent is decoupled from the dashboard, unit tests should focus on the agent’s `process` method and verify that the emitted payload matches the Claude schema. Integration tests can then verify that the dashboard correctly renders a sample payload.

5. **Leverage existing configuration loading** – Do not re‑implement configuration parsing. Instead, call the public API of `ConstraintConfigurationLoader` to obtain the active constraint set. This ensures consistency across agents and reduces duplication.

6. **Consider hot‑reload for rapid iteration** – If the system supports dynamic reloading of constraints, use the loader’s refresh capability rather than restarting the entire monitor. This keeps the dashboard view up‑to‑date with minimal disruption.

---

### Summary of Key Architectural Insights  

1. **Architectural patterns identified** – Modular agent‑based architecture, BaseAgent standardisation, configuration‑loader pattern, event‑driven communication via Claude Code Hook format.  

2. **Design decisions and trade‑offs** – Separation of configuration (loader) from detection improves extensibility but introduces an extra initialization step; using a single event schema simplifies downstream consumption at the cost of requiring strict adherence to the format.  

3. **System structure insights** – ConstraintMonitor is a child of SemanticAnalysis, shares the BaseAgent contract with sibling components (Pipeline, Ontology, Insights), and owns a child loader component that bridges static rules to runtime agents.  

4. **Scalability considerations** – Adding new constraint types or detection agents scales horizontally because each agent operates independently and publishes to a common event bus. The dashboard can handle increased event volume as long as the Claude payload remains lightweight.  

5. **Maintainability assessment** – High maintainability due to the standardized BaseAgent pattern, clear documentation of configuration and event formats, and modular separation of concerns. The primary maintenance burden lies in keeping the Claude schema and configuration docs in sync with any schema evolution.

## Diagrams

### Relationship

![ConstraintMonitor Relationship](images/constraint-monitor-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/constraint-monitor-relationship.png)


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component utilizes a modular architecture with multiple agents, each responsible for a specific task, such as the OntologyClassificationAgent, SemanticAnalysisAgent, and ContentValidationAgent. For instance, the OntologyClassificationAgent, defined in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, is used for classifying observations against the ontology system. This agent follows the BaseAgent pattern, providing a standardized structure for agent development, as seen in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts. The use of this pattern enables easier modification and extension of the agent's functionality, as demonstrated in the implementation of the SemanticAnalysisAgent in integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts.

### Children
- [ConstraintConfigurationLoader](./ConstraintConfigurationLoader.md) -- The integrations/mcp-constraint-monitor/docs/constraint-configuration.md file provides guidance on configuring constraints, indicating a structured approach to constraint setup.

### Siblings
- [Pipeline](./Pipeline.md) -- The batch processing pipeline follows a DAG-based execution model, with each step declaring explicit depends_on edges in batch-analysis.yaml.
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent uses a BaseAgent pattern, providing a standardized structure for agent development, as seen in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts.
- [Insights](./Insights.md) -- The insight generation system uses a pattern catalog to extract insights, as implemented in integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts.


---

*Generated from 7 observations*
