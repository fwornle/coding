# Agents

**Type:** SubComponent

Each agent has its own file, such as integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts.

## What It Is  

The **Agents** sub‑component lives under the **SemanticAnalysis** module of the MCP server.  All source files are located in the directory  

```
integrations/mcp-server-semantic-analysis/src/agents/
```  

The cornerstone of this sub‑component is the `BaseAgent` class defined in `base‑agent.ts`.  Every concrete agent – for example `OntologyClassificationAgent` (`ontology‑classification‑agent.ts`), `InsightGenerationAgent` (`insight‑generation‑agent.ts`), and `SemanticAnalysisAgent` (`semantic‑analysis‑agent.ts`) – extends this base class.  The agents are therefore grouped together in a single folder, each with its own file, and they share common functionality supplied by `BaseAgent`, such as the creation of response envelopes and the calculation of confidence levels.

## Architecture and Design  

The observed structure follows a **modular, inheritance‑based architecture**.  The module’s parent, **SemanticAnalysis**, treats each agent as an isolated unit that performs a single, well‑defined task (ontology classification, insight generation, etc.).  By placing every agent in its own file, the codebase enforces **single‑responsibility** at the file‑level and makes the overall system easy to navigate.

The primary design pattern evident from the observations is **class inheritance** (a classic “base‑class” pattern).  `BaseAgent` supplies a reusable API – notably `calculateConfidenceLevel` and envelope‑creation helpers – that concrete agents inherit and optionally extend.  This pattern eliminates duplication and guarantees that all agents expose a consistent interface to the rest of the system.  Because the agents are all children of the same base, they can be treated polymorphically by any consumer that works with the **SemanticAnalysis** component, enabling the parent to iterate over a collection of agents without needing to know each agent’s concrete type.

No other patterns (e.g., micro‑services, event‑driven messaging) are mentioned in the observations, so the architecture should be understood as a **single‑process, library‑style** composition where agents are loaded and invoked directly by the SemanticAnalysis pipeline.

## Implementation Details  

`BaseAgent` (`integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`) encapsulates two core responsibilities:

1. **Response Envelope Creation** – a helper method (name not supplied but referenced) that builds the standardized wrapper object returned to callers.  By centralising this logic, every derived agent returns data in a uniform shape, simplifying downstream processing.

2. **Confidence Calculation** – the `calculateConfidenceLevel` method computes a numeric confidence score for the agent’s output.  The exact algorithm is not described, but its presence in the base class means every concrete agent can invoke it directly or override it if a specialized calculation is required.

Concrete agents such as `OntologyClassificationAgent` (`ontology‑classification‑agent.ts`) and `InsightGenerationAgent` (`insight‑generation‑agent.ts`) extend `BaseAgent`.  Each file contains the agent’s specific business logic – for example, ontology classification or insight extraction – while relying on the inherited utilities for envelope construction and confidence scoring.  Because the agents share the same parent, they inherit any future enhancements made to `BaseAgent` automatically, ensuring consistent behavior across the sub‑component.

The **agents directory** (`integrations/mcp-server-semantic-analysis/src/agents/`) therefore acts as a self‑contained package: it houses the abstract `BaseAgent` and all concrete implementations, making the codebase straightforward to explore and modify.

## Integration Points  

Agents are integrated into the broader **SemanticAnalysis** component, which orchestrates their execution as part of a larger processing pipeline.  The sibling component **Pipeline** also references the same agent files, indicating that the pipeline dynamically loads or invokes agents to process batches of data.  For instance, the pipeline may instantiate `OntologyClassificationAgent` to enrich incoming documents with ontology tags before passing the enriched payload to `InsightGenerationAgent`.

Because each agent inherits from `BaseAgent`, they expose a common interface that the **SemanticAnalysis** parent can rely on.  This interface likely includes methods such as `run` or `process` (not explicitly named in the observations) together with the envelope‑creation and confidence utilities.  The agents therefore act as plug‑in modules: swapping one agent for another or adding a new one simply requires placing a new file in the `agents` folder that extends `BaseAgent`.

No external libraries or services are mentioned, so the integration points are limited to internal imports within the `integrations/mcp-server-semantic-analysis` code tree.  The agents do not appear to depend on external APIs; they operate on data supplied by the pipeline or other components of **SemanticAnalysis**.

## Usage Guidelines  

1. **Extend `BaseAgent`** – When creating a new agent, always subclass `BaseAgent`.  This guarantees that the new agent can generate response envelopes and compute confidence levels in the same manner as existing agents.

2. **One File per Agent** – Follow the established convention of placing each concrete agent in its own file inside `integrations/mcp-server-semantic-analysis/src/agents/`.  Naming should mirror the existing pattern (`<purpose>-agent.ts`) to keep the directory discoverable.

3. **Leverage Shared Helpers** – Use the envelope‑creation utilities and `calculateConfidenceLevel` provided by `BaseAgent` rather than re‑implementing them.  If a specialized confidence algorithm is needed, override `calculateConfidenceLevel` while still calling `super` where appropriate.

4. **Maintain Consistent Return Types** – All agents should return the standardized response envelope defined in the base class.  This ensures downstream components (e.g., the Pipeline or Insight generation stages) can handle results uniformly.

5. **Avoid Direct File Coupling** – Interact with agents through their shared base‑class interface rather than importing concrete implementations unless a specific behavior is required.  This preserves the ability to replace or reorder agents without modifying the calling code.

---

### Architectural patterns identified
1. **Inheritance‑based shared base class** (BaseAgent) – provides common behavior to all agents.  
2. **Modular file organization** – each agent lives in its own file, supporting single‑responsibility and easy discovery.  
3. **Polymorphic interaction** – the parent component can treat all agents uniformly through the BaseAgent interface.

### Design decisions and trade‑offs
- **Decision:** Centralise envelope creation and confidence calculation in `BaseAgent`.  
  **Trade‑off:** Tight coupling of agents to the base class; any change to the base affects all agents, requiring careful versioning.  
- **Decision:** One‑file‑per‑agent layout.  
  **Trade‑off:** Simplicity and clarity versus potential proliferation of files as the number of agents grows.  
- **Decision:** No external service boundaries; agents run in‑process.  
  **Trade‑off:** Lower latency and easier sharing of in‑memory data, but limits independent scaling of heavy‑weight agents.

### System structure insights
- **SemanticAnalysis** is the parent module that aggregates agents, exposing a cohesive API to the **Pipeline** and sibling components (**Ontology**, **Insights**).  
- The **agents** folder is a self‑contained sub‑package: `base-agent.ts` defines the contract, while concrete agents implement domain‑specific logic.  
- Sibling components reference the same agents, indicating a shared‑library model rather than duplicated implementations.

### Scalability considerations
- Because agents run in the same process, scaling is tied to the overall server resources.  Adding more agents or heavier processing may require horizontal scaling of the MCP server rather than independent scaling of individual agents.  
- The inheritance model makes it easy to introduce new agents without touching existing code, supporting functional scaling (more capabilities) with minimal risk.  
- If a future need arises for isolated execution (e.g., heavy ML models), the current design would need to be refactored toward a service‑oriented approach.

### Maintainability assessment
- **High maintainability** for small‑to‑medium numbers of agents: the clear file‑per‑agent convention and shared `BaseAgent` reduce duplication and simplify onboarding.  
- **Potential risk** lies in the monolithic nature of the base class; extensive changes to shared utilities could have ripple effects.  Maintaining comprehensive unit tests for `BaseAgent` mitigates this risk.  
- The modular layout aids code navigation and encourages adherence to the single‑responsibility principle, which is favorable for long‑term upkeep.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component follows a modular architecture, with each agent, such as the OntologyClassificationAgent and SemanticAnalysisAgent, responsible for a specific task. This modularity is reflected in the code organization, with each agent having its own file, such as integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts. The use of a BaseAgent class, defined in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, provides a standard way for all agents to create response envelopes and calculate confidence levels.

### Siblings
- [Pipeline](./Pipeline.md) -- The batch processing pipeline uses a modular architecture, with each agent having its own file, such as integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts.
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent uses the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file to classify ontologies.
- [Insights](./Insights.md) -- The InsightGenerationAgent uses the integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts file to generate insights.


---

*Generated from 6 observations*
