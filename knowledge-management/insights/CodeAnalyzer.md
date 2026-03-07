# CodeAnalyzer

**Type:** SubComponent

The CodeAnalyzer sub-component is designed to be extensible, allowing for the addition of new code analysis and insight generation capabilities, as demonstrated by the inclusion of the CodeAnalyzer agent (integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts).

## What It Is  

The **CodeAnalyzer** sub‑component lives inside the *semantic‑analysis* integration at  
`integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts`.  It is an **agent** whose responsibility is to ingest source code, parse it, run analysis routines, and emit structured insights.  The parsing logic is encapsulated in `CodeParser` (`integrations/mcp-server-semantic-analysis/src/model/code-parser.ts`) while the transformation of raw analysis results into human‑readable or machine‑consumable insight objects is performed by `CodeInsightGenerator` (`integrations/mcp-server-semantic-analysis/src/model/code-insight-generator.ts`).  Together these classes implement the functional contract defined by the shared `BaseAgent` interface (`integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`).  The agent also collaborates with the broader **LLMService** (`integrations/mcp-server-semantic-analysis/src/model/llm-service.ts`) through the `SemanticAnalysisAgent` (`integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts`) when large‑language‑model‑driven reasoning is required.

## Architecture and Design  

The observed codebase follows a **modular, agent‑centric architecture**.  Each discrete piece of work—code parsing, insight generation, ontology classification, batch scheduling, etc.—is represented by a dedicated *agent* class that implements the common `BaseAgent` interface.  This standardised contract (Observation 4) guarantees that all agents expose the same lifecycle methods (e.g., `execute`, `initialize`, `shutdown`) and can be orchestrated uniformly by higher‑level components such as the **Pipeline** (which uses a DAG‑based execution model, see the sibling description).  

Within the CodeAnalyzer sub‑component, the **agent** (`CodeAnalyzer`) delegates to two specialised collaborators:  
* `CodeParser` – responsible for syntactic and structural parsing of the supplied source files.  
* `CodeInsightGenerator` – consumes the parser’s abstract syntax representation and produces insight payloads (patterns, trends, recommendations).  

When deeper semantic reasoning is needed, the `SemanticAnalysisAgent` injects the **LLMService** (Observation 5) to obtain large‑language‑model‑based analysis, showing a clear separation between deterministic parsing logic and probabilistic LLM inference.  The design therefore mixes **composition** (agents composed of parsers/generators) with **interface‑based polymorphism** (all agents share `BaseAgent`).  Extensibility is baked in: adding a new analysis capability merely requires a new agent that adheres to `BaseAgent` and registers itself in the execution pipeline (Observation 6).

## Implementation Details  

* **`CodeAnalyzer` (agents/code-analyzer.ts)** – Implements `BaseAgent`. Its `execute` method receives a code bundle, forwards it to `CodeParser`, then hands the parsed model to `CodeInsightGenerator`. The class also contains hooks for logging and error handling that are common across agents.  

* **`CodeParser` (model/code-parser.ts)** – Parses raw source strings into an intermediate representation (likely an AST or custom model). The class exposes methods such as `parseFile(path: string)` and `extractMetrics()`. It isolates language‑specific parsing concerns, making the rest of the system language‑agnostic.  

* **`CodeInsightGenerator` (model/code-insight-generator.ts)** – Takes the parsed model and runs rule‑based or pattern‑matching algorithms to detect code smells, architectural anti‑patterns, and usage trends. It builds insight objects that conform to a shared schema used by the **Insights** sibling component.  

* **`BaseAgent` (agents/base-agent.ts)** – Defines the core interface (`initialize(config)`, `execute(input)`, `shutdown()`). All agents, including `SemanticAnalysisAgent` and `OntologyClassificationAgent`, inherit from this file, guaranteeing uniform orchestration.  

* **`SemanticAnalysisAgent` (agents/semantic-analysis-agent.ts)** – Demonstrates how the CodeAnalyzer sub‑component can be augmented with LLM capabilities. It calls `LLMService` (`model/llm-service.ts`) to obtain natural‑language explanations or to enrich the raw insights with higher‑level context.  

The interplay is straightforward: the pipeline schedules `CodeAnalyzer` as one node in its DAG, the agent runs its deterministic parsing pipeline, optionally enriches results via LLM, and finally emits insight objects that downstream components (e.g., **Insights** or **InsightGenerator**) consume.

## Integration Points  

1. **Parent – SemanticAnalysis** – The parent component orchestrates the whole semantic analysis workflow. It registers `CodeAnalyzer` alongside other agents (e.g., `OntologyClassificationAgent`) and ensures they run in the correct order via the DAG defined in `batch-analysis.yaml`.  

2. **Sibling – LLMService** – When CodeAnalyzer needs probabilistic reasoning, it invokes the `LLMService` through `SemanticAnalysisAgent`. This dependency is explicit in Observation 5 and keeps LLM calls isolated from pure parsing code.  

3. **Sibling – Pipeline** – The DAG‑based execution engine (see the Pipeline sibling description) treats `CodeAnalyzer` as a node with defined `depends_on` edges, guaranteeing that code parsing occurs after any prerequisite steps (e.g., source retrieval) and before downstream insight aggregation.  

4. **Sibling – Ontology & InsightGenerator** – After `CodeInsightGenerator` produces raw insights, the **Ontology** component may classify them against a domain ontology via `OntologyClassificationAgent`. Subsequently, the **InsightGenerator** agent formats or aggregates these classified insights for presentation or storage.  

All interactions are mediated through the common `BaseAgent` contract, which simplifies wiring new agents into the existing pipeline without bespoke adapters.

## Usage Guidelines  

* **Instantiate via the pipeline** – Developers should not invoke `CodeAnalyzer` directly; instead, add it to the pipeline configuration (`batch-analysis.yaml`) so that its lifecycle (initialisation, execution, shutdown) is managed consistently with other agents.  

* **Provide well‑formed source inputs** – The agent expects file paths or raw source strings that `CodeParser` can understand. Supplying unsupported languages may cause parsing failures; extend `CodeParser` if new language support is required.  

* **Leverage LLM only when needed** – Because LLM calls incur latency and cost, the recommended pattern is to let the deterministic parsing and rule‑based insight generation run first, then optionally enable the LLM enrichment path via a configuration flag passed to `SemanticAnalysisAgent`.  

* **Respect the `BaseAgent` contract** – Custom extensions (new analysis agents) must implement the same methods (`initialize`, `execute`, `shutdown`). This ensures they can be dropped into the DAG without breaking orchestration.  

* **Register new insight types** – If `CodeInsightGenerator` is extended to emit new insight schemas, update the downstream **Insights** and **InsightGenerator** agents to recognise and process the new payloads, preserving the end‑to‑end flow.

---

### 1. Architectural patterns identified  
* **Agent‑based modular architecture** – each functional unit is an agent implementing a shared `BaseAgent` interface.  
* **Composition over inheritance** – `CodeAnalyzer` composes `CodeParser` and `CodeInsightGenerator`.  
* **Interface‑driven polymorphism** – uniform interaction via `BaseAgent`.  
* **Pipeline orchestration with DAG** – agents are scheduled as nodes in a directed‑acyclic graph (sibling Pipeline description).  

### 2. Design decisions and trade‑offs  
* **Standardised agent interface** – simplifies orchestration but forces all agents to conform to the same lifecycle, which may be overkill for trivial utilities.  
* **Separation of deterministic parsing and probabilistic LLM analysis** – preserves performance for the common case while allowing richer insights when needed; however, it introduces an extra integration point (LLMService) and potential latency.  
* **Extensibility via new agents** – encourages growth without touching existing code, at the cost of a larger surface area to test and maintain.  

### 3. System structure insights  
* The **CodeAnalyzer** sub‑component sits one level below **SemanticAnalysis**, acting as a concrete implementation of code‑focused analysis.  
* Its children (`CodeParser`, `CodeInsightGenerator`) are pure‑logic classes without direct knowledge of the pipeline, reinforcing a clean separation of concerns.  
* Sibling agents (e.g., `OntologyClassificationAgent`, `InsightGenerator`) consume the output of `CodeAnalyzer`, illustrating a clear data‑flow direction from parsing → insight generation → classification → final presentation.  

### 4. Scalability considerations  
* **Horizontal scaling** – Because agents are stateless and interact through well‑defined inputs/outputs, multiple instances of `CodeAnalyzer` can run in parallel across a distributed executor, scaling with the number of codebases to analyse.  
* **LLM bottleneck** – Calls to `LLMService` are the primary scalability limiter; caching or batch‑ing LLM requests can mitigate latency spikes.  
* **Pipeline DAG** – The DAG model naturally supports concurrent execution of independent agents, allowing the overall semantic analysis pipeline to scale as more agents are added.  

### 5. Maintainability assessment  
* **High maintainability** – The clear separation between parsing, insight generation, and orchestration, combined with the shared `BaseAgent` contract, makes each piece easy to understand, test, and replace.  
* **Extensible contract** – Adding new analysis capabilities does not require changes to existing agents, reducing regression risk.  
* **Potential drift** – As the number of agents grows, keeping the DAG configuration in sync with code changes becomes a maintenance responsibility; automated validation of the pipeline graph is advisable.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for classifying observations against the ontology system. This modularity allows for easier maintenance and extension of the component, as new agents can be added or existing ones modified without affecting the overall system. For instance, the SemanticAnalysisAgent (integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts) utilizes the LLMService for large language model-based analysis and generation, demonstrating the flexibility of the component's design. The use of a standardized agent interface, as defined in the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts), ensures consistency across the different agents and facilitates communication between them.

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges, as seen in the BatchScheduler class (integrations/mcp-server-semantic-analysis/src/agents/batch-scheduler.ts).
- [Ontology](./Ontology.md) -- The Ontology sub-component utilizes the OntologyClassificationAgent for classifying observations against the ontology system, as seen in the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts).
- [Insights](./Insights.md) -- The Insights sub-component utilizes the InsightGenerator agent for generating insights from analyzed data, as seen in the InsightGenerator class (integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts).
- [InsightGenerator](./InsightGenerator.md) -- The InsightGenerator sub-component utilizes the InsightGenerator agent for generating insights from analyzed data, as seen in the InsightGenerator class (integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts).
- [LLMService](./LLMService.md) -- The LLMService sub-component utilizes the LLMService class for providing large language model-based analysis and generation, as seen in the LLMService class (integrations/mcp-server-semantic-analysis/src/model/llm-service.ts).


---

*Generated from 7 observations*
