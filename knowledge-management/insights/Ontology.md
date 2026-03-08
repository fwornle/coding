# Ontology

**Type:** SubComponent

The OntologyClassificationAgent, located in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file, uses a confidence calculation mechanism to determine the accuracy of its classifications.

## What It Is  

**Ontology** is the sub‑component that supplies the semantic backbone for the **SemanticAnalysis** platform. Its source lives under the `integrations/mcp‑server‑semantic‑analysis/src/ontology/` directory, split into two concrete definition files:  

* `upper-ontology.ts` – a high‑level, abstract taxonomy that establishes the broad categories used throughout the system.  
* `lower-ontology.ts` – a fine‑grained, domain‑specific extension that adds detailed classes and properties required for precise classification.  

The ontology is consumed by a family of agents located in `integrations/mcp‑server‑semantic‑analysis/src/agents/`. The most prominent consumer is the **OntologyClassificationAgent** (`ontology-classification-agent.ts`), which matches incoming observations against the upper and lower ontologies and produces a confidence‑scored classification result. Supporting agents such as **EntityTypeResolutionAgent** (`entity-type-resolution-agent.ts`) and **ValidationAgent** (`validation-agent.ts`) rely on the same ontology definitions to resolve entity types and enforce rule‑based constraints. All agents wrap their output in a **standard response envelope**, guaranteeing a uniform contract for downstream components.

---

## Architecture and Design  

The ontology subsystem follows a **modular, agent‑centric architecture**. Each agent is a self‑contained unit that performs a single responsibility and communicates with other agents through well‑defined data structures (the response envelope). This mirrors the overall design of the parent **SemanticAnalysis** component, which orchestrates a pipeline of agents (e.g., the **CoordinatorAgent** in `coordinator-agent.ts`) to achieve end‑to‑end processing.

* **Separation of Concerns** – Upper‑ontology and lower‑ontology files are isolated, allowing developers to evolve the high‑level taxonomy without immediately impacting detailed classifications.  
* **Strategy‑like Confidence Calculation** – The **OntologyClassificationAgent** inherits the confidence calculation logic from `BaseAgent` (`base-agent.ts`). By delegating the scoring to a shared base class, the system enforces a consistent metric across all classification‑related agents.  
* **Hybrid Rule‑ML Resolution** – The **EntityTypeResolutionAgent** combines deterministic rule‑sets with machine‑learning models, reflecting a **hybrid decision‑making pattern** that balances explainability (rules) with adaptability (ML).  
* **Standard Response Envelope** – Every agent produces output wrapped in a common envelope, an implicit **template method** that standardises success/failure fields, metadata, and payload shape. This pattern simplifies downstream consumption by siblings such as **ObservationClassifier** and **InsightGenerationAgent**.  

Interaction flows are linear for most use‑cases: an observation enters the system, the **ObservationClassifier** calls the **OntologyClassificationAgent**, which consults the upper and lower ontology files, computes confidence, and returns the envelope. The **EntityTypeResolutionAgent** may then refine the type, and the **ValidationAgent** finally checks rule compliance before the result is handed off to higher‑level components like **Insights** or **KnowledgeGraphConstructor**.

---

## Implementation Details  

1. **Ontology Definitions**  
   * `upper-ontology.ts` defines abstract classes (e.g., *Entity*, *Process*, *Asset*) and their relationships.  
   * `lower-ontology.ts` extends these with concrete subclasses (e.g., *ServerInstance*, *DatabaseSchema*) and adds property constraints. The split enables incremental enrichment without breaking existing classifications.  

2. **OntologyClassificationAgent (`ontology-classification-agent.ts`)**  
   * Extends `BaseAgent`, inheriting the `calculateConfidence` method. The confidence algorithm likely weighs factors such as lexical similarity, ontology depth, and historical accuracy, although the exact formula is encapsulated in the base class.  
   * Implements a `classify(observation)` routine that queries both ontology files, selects the best‑matching class, and packages the result in the standard response envelope.  

3. **EntityTypeResolutionAgent (`entity-type-resolution-agent.ts`)**  
   * Executes a two‑step pipeline: first, a rule engine evaluates deterministic conditions (e.g., presence of specific keywords). Second, a trained ML model refines the prediction, possibly using feature vectors derived from the observation text.  
   * Returns a resolved type together with a confidence score, again wrapped in the envelope.  

4. **ValidationAgent (`validation-agent.ts`)**  
   * Holds a catalogue of validation rules (e.g., mandatory fields, value ranges) that are applied against the classified entity payload.  
   * Emits validation outcomes (pass/fail, error messages) within the same envelope, enabling upstream agents to react uniformly.  

5. **BaseAgent (`base-agent.ts`)** – Though not listed in the observations, its mention in the parent hierarchy confirms that common utilities (logging, error handling, envelope creation) are centralized, reducing duplication across agents.  

6. **Standard Response Envelope** – Though the concrete schema is not shown, the pattern ensures every agent returns an object with at least: `status`, `payload`, `metadata`, and `confidence`. This uniformity is crucial for the **Pipeline** coordinator and downstream consumers like **KnowledgeGraphConstructor**.  

---

## Integration Points  

* **Parent – SemanticAnalysis** – The ontology sub‑component is a child of **SemanticAnalysis**, which supplies the orchestration layer (CoordinatorAgent) and the overall processing pipeline. All ontology‑related agents are registered with the coordinator, allowing dynamic activation based on the incoming data type.  

* **Sibling – ObservationClassifier** – This agent directly invokes the **OntologyClassificationAgent** to obtain the primary class label for each observation. The close coupling means any change to the classification confidence algorithm will ripple to the classifier’s behaviour.  

* **Sibling – Insights** – The **InsightGenerationAgent** consumes the classified and validated entities to produce higher‑level analytical insights. Because the ontology guarantees a stable taxonomy, insights can rely on consistent entity semantics.  

* **Sibling – KnowledgeGraphConstructor** – After validation, the classified entities are transformed into graph nodes/edges using the **GraphDatabaseAdapter**. The ontology’s hierarchical structure maps naturally onto graph relationships, simplifying the graph construction logic.  

* **Sibling – Pipeline** – The **CoordinatorAgent** in the Pipeline component schedules the execution order: classification → type resolution → validation → downstream processing. The pipeline’s modular nature means additional agents (e.g., a future enrichment agent) can be inserted without touching the ontology core.  

* **External – GraphDatabase** – While not part of the ontology codebase, the graph database receives data shaped by the ontology’s taxonomy, ensuring that persisted knowledge respects the same schema used during analysis.  

---

## Usage Guidelines  

1. **Never modify upper‑ontology without reviewing lower‑ontology dependencies.** Because lower‑ontology extends the upper definitions, a change at the abstract level can invalidate many concrete classes.  

2. **Prefer the BaseAgent’s confidence utilities.** When extending or creating new agents that need confidence scoring, inherit from `BaseAgent` rather than re‑implementing the algorithm. This preserves envelope consistency and centralises future adjustments to the scoring logic.  

3. **Respect the response envelope contract.** All agents must return an object that adheres to the envelope schema (status, payload, metadata, confidence). Downstream components assume this shape; deviating will cause runtime failures in the Pipeline coordinator.  

4. **Leverage the hybrid rule‑ML approach responsibly.** When adding new rules to **EntityTypeResolutionAgent**, ensure they are deterministic and documented, as they will be evaluated before the ML model. This ordering aids debugging and auditability.  

5. **Run validation after every classification change.** The **ValidationAgent** should be invoked immediately after the **OntologyClassificationAgent** (or any custom classifier) to catch schema violations early, preventing polluted data from reaching the KnowledgeGraphConstructor.  

6. **Coordinate through the Pipeline coordinator.** Direct calls between agents are discouraged; instead, register the agent with the coordinator and let the pipeline manage execution order and error handling.  

---

### Summary of Architectural Insights  

| Item | Insight |
|------|---------|
| **Architectural patterns identified** | Modular agent‑centric design, inheritance‑based shared utilities (BaseAgent), hybrid rule‑plus‑ML decision pattern, standard response envelope (template method). |
| **Design decisions and trade‑offs** | *Separation of upper vs. lower ontology* improves extensibility but introduces coupling that requires careful versioning. *Hybrid rule‑ML* offers explainability and adaptability but adds complexity in model maintenance. *Standard envelope* simplifies integration at the cost of a rigid output contract. |
| **System structure insights** | Ontology sits as a child of **SemanticAnalysis**, providing taxonomy to multiple sibling agents. Agents are loosely coupled through the envelope and coordinated by the **Pipeline**. The hierarchy mirrors a classic “pipeline of responsibility” where each stage refines the data. |
| **Scalability considerations** | Because classification and type‑resolution are stateless and encapsulated in agents, they can be horizontally scaled (multiple agent instances) behind the coordinator. The split ontology files enable incremental loading; however, deep taxonomy look‑ups could become a bottleneck if the lower ontology grows dramatically—caching strategies may be required. |
| **Maintainability assessment** | High maintainability thanks to clear separation of concerns and centralized utilities (BaseAgent, envelope). The explicit file boundaries (upper vs. lower ontology) aid domain experts in updating taxonomy without touching code. The main risk is the hidden complexity of the confidence algorithm and ML model versioning, which should be documented and version‑controlled alongside the agents. |

This document captures the concrete, observation‑driven view of the **Ontology** sub‑component, its place within the broader **SemanticAnalysis** ecosystem, and the practical considerations for developers who will extend, maintain, or scale the system.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent for classifying observations against the ontology system, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file. This agent utilizes a confidence calculation mechanism, as defined in the BaseAgent class, located in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, to determine the accuracy of its classifications. Furthermore, the OntologyClassificationAgent follows a standard response envelope creation pattern, ensuring consistency in its output.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses a coordinator agent, as seen in the integrations/mcp-server-semantic-analysis/src/agents/coordinator-agent.ts file, to manage the execution of other agents.
- [Insights](./Insights.md) -- The InsightGenerationAgent, located in the integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts file, uses a combination of natural language processing and machine learning algorithms to generate insights.
- [KnowledgeGraphConstructor](./KnowledgeGraphConstructor.md) -- The KnowledgeGraphConstructor, located in the integrations/mcp-server-semantic-analysis/src/agents/knowledge-graph-constructor.ts file, uses the GraphDatabaseAdapter to interact with the graph database.
- [ObservationClassifier](./ObservationClassifier.md) -- The ObservationClassifier, located in the integrations/mcp-server-semantic-analysis/src/agents/observation-classifier.ts file, uses the OntologyClassificationAgent to classify observations.
- [CodeAnalyzer](./CodeAnalyzer.md) -- The CodeAnalyzer, located in the integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts file, uses the SemanticAnalysisAgent to analyze code files.
- [ContentValidator](./ContentValidator.md) -- The ContentValidator, located in the integrations/mcp-server-semantic-analysis/src/agents/content-validator.ts file, uses the ContentValidationAgent to validate entity content.
- [GraphDatabase](./GraphDatabase.md) -- The GraphDatabase, located in the integrations/mcp-server-semantic-analysis/src/adapters/graph-database-adapter.ts file, uses a graph-based data structure to store and manage the knowledge graph.


---

*Generated from 6 observations*
