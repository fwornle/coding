# AgentAdapter

**Type:** SubComponent

AgentAdapter utilizes the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for ontology-based classification of observations and entities.

## What It Is  

`AgentAdapter` is a **sub‑component** that lives inside the **LiveLoggingSystem** (see the hierarchy context).  Its source code is spread across the `integrations/mcp-server-semantic-analysis/src` tree, most notably:  

* the **factory** that creates concrete adapters – `integrations/mcp-server-semantic-analysis/src/factories/agent-adapter-factory.ts`  
* the **interface** that defines the public contract – `integrations/mcp-server-semantic-analysis/src/interfaces/agent-adapter.ts`  
* the concrete **agent implementations** such as `ClaudeCodeAgent` (`integrations/mcp-server-semantic-analysis/src/agents/claude-code-agent.ts`) and `CopilotAgent` (`integrations/mcp-server-semantic-analysis/src/agents/copilot-agent.ts`)  

`AgentAdapter` supplies a **standardized façade** for all downstream agents, handling concerns such as conversation analysis, entity extraction, ontology‑based classification (via `OntologyClassificationAgent` in `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`), and unified logging (through `LoggingService` at `integrations/mcp-server-semantic-analysis/src/services/logging-service.ts`).  The sub‑component is also the parent of the **OntologyClassificationAgentUtilizer**, which encapsulates the logic that wires the classification agent into the adapter’s workflow.

---

## Architecture and Design  

The design of `AgentAdapter` is deliberately **modular** and **extensible**.  Each concrete agent lives in its own module (e.g., `claude-code-agent.ts`, `copilot-agent.ts`), allowing new agents to be added without touching existing code.  This modularity is reinforced by a **factory pattern** (`AgentAdapterFactory`) that abstracts the construction logic: callers request an adapter by name or capability, and the factory returns an instance that conforms to `IAgentAdapter`.  Because the factory returns the interface type, the rest of the system interacts with agents **polymorphically**, enabling the LiveLoggingSystem to treat Copilot, Claude, or any future agent uniformly.

Dependency injection is evident in the way the factory (or the LiveLoggingSystem) supplies dependencies such as `LoggingService` and the `OntologyClassificationAgent`.  The adapter does not instantiate these services directly; instead they are passed in, which decouples the adapter from concrete implementations and eases testing.  The **unified logging mechanism** (via `LoggingService`) provides a single source of truth for tracing agent activity, reinforcing the cross‑cutting concern of observability.

The relationship to sibling components is also architectural: `AgentAdapter` sits alongside `OntologyClassificationAgent`.  While the ontology agent focuses on graph‑based ontology representation (`OntologyGraph` in `models/ontology-graph.ts`), the adapter **utilizes** it through the `OntologyClassificationAgentUtilizer` child, keeping the classification logic separate from the generic agent façade.

---

## Implementation Details  

At the heart of the adapter is the **`IAgentAdapter` interface** (`src/interfaces/agent-adapter.ts`).  It declares methods such as `processMessage`, `extractEntities`, and `classifyObservation`.  Concrete agents—`ClaudeCodeAgent` and `CopilotAgent`—implement this contract, each providing agent‑specific parsing, code‑analysis, or suggestion logic while adhering to the same method signatures.

The **factory** (`src/factories/agent-adapter-factory.ts`) contains a static `create` method (or a similar builder) that maps a requested agent type to its concrete class.  Internally it resolves required services (e.g., `LoggingService`, `OntologyClassificationAgent`) from the DI container and injects them into the new agent instance.  This centralised construction guarantees that every adapter is equipped with the same logging and classification utilities.

`AgentAdapter` delegates ontology work to **`OntologyClassificationAgent`** (`src/agents/ontology-classification-agent.ts`).  The `OntologyClassificationAgentUtilizer` (the child component) encapsulates calls such as `classifyObservation(observation)` and returns a structured classification that the adapter can attach to the conversation payload.  Because the classification agent is designed to be **extensible** (it can accept custom ontology models and algorithms), the adapter can evolve its semantic capabilities without altering its own code.

All interactions are logged through **`LoggingService`** (`src/services/logging-service.ts`).  The adapter invokes methods like `logAgentRequest` and `logAgentResponse`, ensuring that each step—from inbound message receipt to outbound classification result—is captured.  This unified approach simplifies downstream analysis, debugging, and audit trails.

---

## Integration Points  

`AgentAdapter` is embedded within the **LiveLoggingSystem**.  The LiveLoggingSystem holds a reference to an `IAgentAdapter` implementation and calls its public methods whenever a new conversation event arrives.  Because the adapter follows a common interface, the LiveLoggingSystem can switch agents at runtime (e.g., from Copilot to Claude) simply by requesting a different instance from `AgentAdapterFactory`.

The adapter also **depends** on two key services:  

* **`LoggingService`** – provides the centralized logging API used by every agent implementation.  
* **`OntologyClassificationAgent`** – supplies the ontology‑based classification capability, accessed through the `OntologyClassificationAgentUtilizer` child.  

These dependencies are injected, meaning the LiveLoggingSystem (or the DI container) supplies concrete instances, keeping the adapter loosely coupled.  The modular agent modules (`copilot-agent.ts`, `claude-code-agent.ts`, etc.) expose only the `IAgentAdapter` contract, allowing other subsystems (e.g., analytics, UI layers) to interact without knowledge of the underlying agent logic.

---

## Usage Guidelines  

1. **Obtain adapters via the factory** – never instantiate a concrete agent directly.  Call `AgentAdapterFactory.create('copilot')` (or the appropriate key) and work with the returned `IAgentAdapter`.  This guarantees that logging and ontology services are correctly wired.  

2. **Pass dependencies through DI** – when configuring the application, register `LoggingService` and `OntologyClassificationAgent` as singletons (or scoped as required) so that every adapter receives the same instances.  This avoids duplicated log streams and inconsistent classification models.  

3. **Respect the interface contract** – developers should only call the methods defined in `IAgentAdapter`.  Adding ad‑hoc methods to a concrete agent will break polymorphism and prevent the LiveLoggingSystem from treating all agents uniformly.  

4. **Leverage the unified logging** – any custom logic added to a new agent must invoke `LoggingService` for request/response tracing.  Consistent log keys and payload structures are essential for the LiveLoggingSystem’s aggregation pipelines.  

5. **Extend classification via the utilizer** – if a new ontology model is required, extend `OntologyClassificationAgent` (or provide a new implementation) and ensure the `OntologyClassificationAgentUtilizer` is updated to call the new methods.  The adapter itself does not need to change because it only interacts through the utilizer’s stable API.

---

### Architectural patterns identified  
1. **Factory pattern** – `AgentAdapterFactory` centralises creation of concrete adapters.  
2. **Strategy/Polymorphism** – `IAgentAdapter` enables interchangeable agent behaviours.  
3. **Dependency Injection** – services (`LoggingService`, `OntologyClassificationAgent`) are supplied externally.  
4. **Modular design** – each agent lives in its own module, facilitating independent development.  
5. **Facade/Adapter pattern** – `AgentAdapter` presents a uniform façade over heterogeneous agents.  

### Design decisions and trade‑offs  
* **Factory vs. direct instantiation** – using a factory adds a small indirection layer but guarantees consistent wiring of cross‑cutting concerns.  
* **Interface‑driven polymorphism** – enforces a stable contract, at the cost of limiting agents to the predefined method set; extending functionality requires interface evolution.  
* **Dependency injection** – improves testability and decoupling, yet requires a DI container or manual wiring, adding configuration overhead.  
* **Modular per‑agent files** – simplifies adding new agents, but may lead to duplication of common logic unless shared utilities (e.g., logging) are correctly abstracted.  

### System structure insights  
* **Parent‑child hierarchy** – LiveLoggingSystem → AgentAdapter → OntologyClassificationAgentUtilizer → OntologyClassificationAgent.  
* **Sibling relationship** – AgentAdapter and OntologyClassificationAgent share the same parent (LiveLoggingSystem) but focus on different concerns (agent façade vs. ontology graph handling).  
* **Cross‑cutting services** – `LoggingService` is the single point for observability, reinforcing a horizontal layer across all agents.  

### Scalability considerations  
* Adding new agents is a **linear operation**: create a new module, implement `IAgentAdapter`, register it in the factory.  Because the factory returns the interface, the LiveLoggingSystem’s load does not increase with the number of agents.  
* **Logging throughput** may become a bottleneck if every agent logs heavily; the unified `LoggingService` can be scaled independently (e.g., async batching, external log sink).  
* The **ontology classification** component is shared; scaling its internal graph processing (e.g., caching `OntologyGraph`) will benefit all adapters.  

### Maintainability assessment  
* **High cohesion** – each agent module focuses on a single responsibility, and the adapter itself merely orchestrates.  
* **Low coupling** – dependencies are injected, and the adapter interacts through well‑defined interfaces, making refactoring straightforward.  
* **Extensibility** – the factory and interface make it easy to plug in future agents or replace the classification service without rippling changes.  
* **Potential technical debt** – if the `IAgentAdapter` interface grows unchecked, implementations may diverge; disciplined versioning of the interface is required.  

Overall, `AgentAdapter` exemplifies a clean, interface‑driven architecture that balances extensibility with observable, maintainable code.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for ontology-based classification of observations and entities. This agent is responsible for categorizing and mapping entities to their respective ontologies, enabling the system to capture and analyze conversations from various agents, including Claude Code. The classification process is crucial for the system's overall functionality, as it allows for the identification and grouping of related concepts and entities. Furthermore, the OntologyClassificationAgent class is designed to be extensible, allowing for the integration of custom ontology models and classification algorithms.

### Children
- [OntologyClassificationAgentUtilizer](./OntologyClassificationAgentUtilizer.md) -- The AgentAdapter sub-component utilizes the OntologyClassificationAgent class for ontology-based classification, as indicated by the parent context.

### Siblings
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- OntologyClassificationAgent utilizes a graph-based data structure to represent ontologies, as seen in the OntologyGraph class (integrations/mcp-server-semantic-analysis/src/models/ontology-graph.ts).


---

*Generated from 7 observations*
