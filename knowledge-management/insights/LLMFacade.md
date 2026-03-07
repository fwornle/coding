# LLMFacade

**Type:** SubComponent

LLMFacadeConfiguration.yaml defines the LLM configuration, including provider and model definitions

## What It Is  

**LLMFacade** is a *sub‑component* that lives inside the **SemanticAnalysis** module. All of its concrete artefacts are defined in the same repository hierarchy as the rest of the SemanticAnalysis code base, for example the YAML file `LLMFacadeConfiguration.yaml` that holds the provider and model definitions, and the Java/Scala (or equivalent) classes `LLMFacade`, `LLMFacadeManager`, `LLMFacadeUtils` and `LLMFacadeLogger`. The façade is also packaged together with the other Docker‑ready services under the **DockerizedServices** umbrella, which means it can be started as a container alongside the other agents that make up the multi‑agent pipeline.

The primary purpose of LLMFacade is to hide the complexity of interacting with one or more large‑language‑model (LLM) providers.  Callers request a model via `LLMFacade.getLLMModel()`, execute it with `LLMFacade.runLLM()`, and retrieve the result through the helper `LLMFacadeUtils.getLLMResult()`.  All operational events—successful runs, time‑outs, and errors—are funneled through `LLMFacadeLogger.logLLM()`.  Initialization is performed by `LLMFacadeManager.loadFacade()`, which reads `LLMFacadeConfiguration.yaml` and wires the appropriate provider implementation.

---

## Architecture and Design  

The design of LLMFacade follows a **Facade pattern**: a thin, purpose‑built API (`LLMFacade.*` methods) that shields the rest of the system from provider‑specific SDKs, authentication details, and request formatting.  The façade is *configuration‑driven*; the YAML file (`LLMFacadeConfiguration.yaml`) declares which provider (e.g., OpenAI, Anthropic) and which model (e.g., `gpt‑4`, `claude‑2`) should be instantiated.  This decouples the selection of the underlying LLM from compile‑time code, enabling the parent **SemanticAnalysis** component to swap models without recompilation.

A concrete **CircuitBreakerPattern** is attached as a child component of LLMFacade.  The circuit‑breaker logic is invoked whenever `LLMFacade.runLLM()` contacts an external provider.  By tracking failure rates and opening the circuit when a threshold is exceeded, it prevents cascading failures that could otherwise bring down the whole multi‑agent pipeline.  The presence of a dedicated logger (`LLMFacadeLogger`) further reinforces the *observability* concern, ensuring that every request and error is recorded for downstream monitoring.

Interaction flow:  

1. `LLMFacadeManager.loadFacade()` reads `LLMFacadeConfiguration.yaml` and creates a concrete LLM client instance.  
2. A consumer (e.g., the **SemanticAnalysis** agent that performs ontology classification) calls `LLMFacade.getLLMModel()` to obtain the model reference.  
3. The consumer passes input data and execution parameters to `LLMFacade.runLLM()`.  
4. Inside `runLLM()`, the circuit‑breaker wrapper checks the health of the provider; if the circuit is closed, the request is forwarded, otherwise a fallback response is generated.  
5. The raw provider response is handed to `LLMFacadeUtils.getLLMResult()` for any post‑processing (e.g., JSON parsing, trimming).  
6. Throughout the process, `LLMFacadeLogger.logLLM()` records start, success, and error events.

Because **SemanticAnalysis** also contains other agents such as **Pipeline**, **Ontology**, and **Insights**, LLMFacade shares the same configuration‑centric philosophy and logging conventions with its siblings, fostering a uniform architectural language across the component tree.

---

## Implementation Details  

- **`LLMFacadeConfiguration.yaml`** – The sole source of truth for provider selection.  Its schema lists keys like `provider: openai` and `model: gpt‑4`, together with optional credentials and timeout settings.  The file is read at start‑up by `LLMFacadeManager.loadFacade()`.

- **`LLMFacadeManager`** – A bootstrap class that parses the YAML, resolves the correct provider SDK, and constructs the concrete model object.  It also registers the circuit‑breaker instance that will guard subsequent calls.

- **`LLMFacade.getLLMModel()`** – Returns the already‑instantiated model object (or a lightweight wrapper) so that callers do not need to know about the underlying SDK.  The method caches the model after the first load, avoiding repeated configuration parsing.

- **`LLMFacade.runLLM(input, params)`** – Core execution entry point.  It first invokes the circuit‑breaker check; if the circuit is open, it either throws a `CircuitOpenException` or returns a predefined fallback.  When the circuit is closed, it forwards the request to the provider client, applying any runtime parameters (temperature, max tokens, etc.) that may have been supplied by the caller.

- **`LLMFacadeUtils.getLLMResult(rawResponse)`** – A thin utility that normalises the provider’s raw payload into a consistent internal representation (e.g., a `String` or a domain‑specific `LLMResult` object).  This step abstracts away provider‑specific response formats such as OpenAI’s `choices[0].message.content` versus Anthropic’s `completion`.

- **`LLMFacadeLogger.logLLM(event, details)`** – Centralised logging that tags each entry with the façade name, request identifiers, timestamps, and error stack traces.  The logger is used by both the manager (during load) and the run method (during execution).

- **CircuitBreakerPattern** – Implemented as a separate class (or module) that tracks success/failure counts, open/half‑open states, and reset timers.  LLMFacade calls into this component before each external request, ensuring that a misbehaving provider does not propagate latency or exceptions to the rest of the system.

All of these pieces are packaged together in the Docker image produced by **DockerizedServices**, which means the façade can be scaled independently if needed.

---

## Integration Points  

- **Parent – SemanticAnalysis**: The SemanticAnalysis orchestrator invokes LLMFacade whenever a language‑model operation is required, such as generating natural‑language summaries of git history or enriching ontology entities.  Because the façade hides provider details, the parent component can remain agnostic of which LLM is used.

- **Siblings**:  
  - **Pipeline** – May schedule LLMFacade calls as steps in its DAG, using the same configuration loading mechanism as other steps.  
  - **Ontology** – Uses LLMFacade to obtain classification suggestions, feeding the results into `OntologyClassifier`.  
  - **Insights** – Calls `LLMFacade.runLLM()` to generate pattern‑based insights, then passes the normalized output from `LLMFacadeUtils` to `InsightGenerator.generateInsights()`.  

  The shared use of `LLMFacadeLogger` ensures that logs from all these agents are consolidated, simplifying troubleshooting across the system.

- **Child – CircuitBreakerPattern** – Directly wrapped around each LLM request.  The façade exposes no circuit‑breaker API to callers; the pattern is an internal resilience mechanism.

- **External Dependencies** – The façade depends on the provider SDKs (e.g., `openai-java`, `anthropic-sdk`) and on the YAML parsing library used by `LLMFacadeManager`.  It also relies on the container runtime (Docker) for environment variables that may hold API keys, as defined in the Docker compose files of **DockerizedServices**.

---

## Usage Guidelines  

1. **Never instantiate a provider client directly** – Always obtain the model through `LLMFacade.getLLMModel()` after `LLMFacadeManager.loadFacade()` has run.  This guarantees that the circuit‑breaker and logging are correctly wired.

2. **Keep configuration in `LLMFacadeConfiguration.yaml`** – Adding a new provider or swapping models should be done by editing this file and redeploying the Docker container; no code changes are required.

3. **Respect the circuit‑breaker contract** – Do not catch `CircuitOpenException` inside business logic unless you have a meaningful fallback (e.g., a cached response).  Allow the exception to propagate so that higher‑level orchestration (e.g., the Pipeline DAG) can decide whether to retry or skip the step.

4. **Log contextual information** – When calling `LLMFacade.runLLM()`, pass a correlation ID (e.g., the git commit hash being analysed) in the `params` map so that `LLMFacadeLogger.logLLM()` can attach it to the log entry.  This greatly aids post‑mortem analysis.

5. **Avoid heavy post‑processing in the façade** – Keep `LLMFacadeUtils.getLLMResult()` focused on format normalisation.  Any domain‑specific parsing or entity extraction should be performed by the caller (e.g., the Ontology or Insights agents) to keep the façade lightweight and reusable.

---

### Architectural patterns identified  

1. **Facade pattern** – Centralised API (`LLMFacade.*`) that abstracts provider details.  
2. **Circuit Breaker pattern** – Implemented as a child component to protect against provider failures.  
3. **Configuration‑driven design** – YAML file (`LLMFacadeConfiguration.yaml`) drives provider/model selection.  
4. **Utility/helper pattern** – `LLMFacadeUtils` for result normalisation.  
5. **Logging/Observability pattern** – `LLMFacadeLogger` provides consistent event recording.

### Design decisions and trade‑offs  

- **Decoupling vs. flexibility** – By using a façade and YAML configuration, the system gains the ability to switch providers without code changes, at the cost of an extra indirection layer that developers must learn.  
- **Resilience** – Embedding a circuit breaker improves stability but introduces latency when the circuit is half‑open (additional probe requests).  
- **Dockerisation** – Packaging LLMFacade as a container enables independent scaling, yet it adds operational overhead (container orchestration, secret management).  

### System structure insights  

LLMFacade sits at the intersection of **SemanticAnalysis** and its sibling agents, acting as the sole gateway to external LLM services.  Its child **CircuitBreakerPattern** ensures that failures are isolated, while shared utilities (`LLMFacadeUtils`, `LLMFacadeLogger`) promote consistency across the entire multi‑agent ecosystem.

### Scalability considerations  

- **Horizontal scaling** is straightforward: spin up additional Docker containers of LLMFacade behind a load balancer.  
- **Provider limits** (rate‑limits, token quotas) are mitigated by the circuit breaker, which can throttle requests when thresholds are approached.  
- **Configuration‑centric model selection** allows scaling out to multiple providers simultaneously, distributing load based on cost or latency considerations.

### Maintainability assessment  

The clear separation of concerns—initialisation (`LLMFacadeManager`), execution (`LLMFacade.runLLM`), result handling (`LLMFacadeUtils`), and observability (`LLMFacadeLogger`)—makes the codebase easy to navigate and extend.  Because all provider‑specific details live behind the façade, updates to SDKs or credential handling are confined to a small, well‑defined area.  The reliance on a single YAML file for configuration reduces duplication and the risk of drift between environments.  Overall, LLMFacade exhibits a high degree of maintainability, provided that developers adhere to the usage guidelines and keep the configuration file in sync with deployment pipelines.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It features a modular architecture with various agents, each responsible for a specific task, such as ontology classification, semantic analysis, and content validation. The system utilizes a range of technologies, including GraphDatabaseAdapter for persistence, LLMService for language model integration, and Wave agents for concurrent execution.

### Children
- [CircuitBreakerPattern](./CircuitBreakerPattern.md) -- The LLMFacade sub-component uses the CircuitBreaker.pattern to prevent cascading failures when interacting with LLM providers, as mentioned in the parent context.

### Siblings
- [Pipeline](./Pipeline.md) -- PipelineController uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- OntologyClassifier uses a hierarchical classification approach, with upper and lower ontology definitions in ontology-definitions.yaml
- [Insights](./Insights.md) -- InsightGenerator.generateInsights() uses a pattern-based approach to generate insights from knowledge entities
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraphBuilder.buildGraph() constructs the code knowledge graph using AST parsing and Memgraph
- [EntityValidator](./EntityValidator.md) -- EntityValidator.validateEntity() implements a validation strategy based on entity metadata and definitions
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- WorkflowOrchestrator.runWorkflow() executes the workflow with the given input and parameters
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter.persistEntity() persists the entity to the graph database
- [MemgraphAdapter](./MemgraphAdapter.md) -- MemgraphAdapter.persistCodeEntity() persists the code entity to Memgraph


---

*Generated from 6 observations*
