# SharedEmbeddingCore

**Type:** Detail

The architecture documentation at `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` covers agent architecture that depends on shared semantic analysis capabilities, corroborating that embedding is a cross-cutting concern deliberately extracted into this shared file rather than duplicated per agent

## What It Is  

**SharedEmbeddingCore** is the reusable embedding engine that lives inside the **SemanticAnalyzer** component defined at `src/agents/semantic-analyzer.ts`. The file `semantic-analyzer.ts` is explicitly documented as *“the single point of change for common embedding, similarity, or tokenization logic”* and is shared by all four concrete agent subclasses in the system. Consequently, any configuration or algorithmic change made to **SharedEmbeddingCore**—such as swapping the underlying vector model, adjusting dimensionality, or altering a normalization step—automatically propagates to every agent that relies on semantic analysis. In the architecture documentation (`integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`) the embedding capability is listed alongside similarity and tokenization as one of the three first‑class responsibilities of the Semantic Analyzer, confirming that **SharedEmbeddingCore** is a cross‑cutting, first‑order concern rather than a peripheral utility.

## Architecture and Design  

The overall design follows a **shared‑core composition** pattern. `src/agents/semantic-analyzer.ts` composes three distinct capabilities:

1. **SharedEmbeddingCore** – responsible for turning raw text or tokens into dense vector representations.  
2. **SemanticSimilarityComputer** – a sibling component that consumes the vectors produced by the embedding core to compute similarity scores.  
3. **Tokenization logic** – prepares input for embedding.

By centralising these capabilities in a single module, the architecture eliminates duplication across the four concrete agent subclasses. Each subclass simply *inherits* or *references* the `SemanticAnalyzer` and thereby gains a consistent embedding pipeline. This design yields **high leverage**: a single change in `SharedEmbeddingCore` ripples through the entire agent ecosystem, ensuring uniform behavior and reducing the risk of divergent implementations.

The documentation also indicates that the agents are **plug‑in style**: the concrete agents depend on the shared analyzer but do not embed their own vector logic. This separation of concerns mirrors a **Facade**‑like abstraction where `SemanticAnalyzer` offers a clean API (e.g., `embed(text)`) while delegating the heavy lifting to the internal core. The sibling `SemanticSimilarityComputer` demonstrates a **coordinator** role, pulling embeddings from the core and applying similarity algorithms, reinforcing the modular decomposition of responsibilities.

## Implementation Details  

Although the source snapshot contains no explicit symbols, the observed hierarchy tells us that **SharedEmbeddingCore** is instantiated or referenced inside `src/agents/semantic-analyzer.ts`. The core likely exposes at least one public method—conceptually `embed(input: string | Token[]): EmbeddingVector`—that encapsulates the following steps:

1. **Model Selection** – a configurable reference to a pretrained embedding model (e.g., OpenAI, Sentence‑Transformers). Because the file is the *single point of change* for model selection, the implementation probably reads from a central configuration object or environment variable.
2. **Dimensionality Handling** – the core must enforce a fixed vector size that matches downstream consumers (e.g., similarity computation, storage). Any change to dimensionality would be made here, guaranteeing consistency.
3. **Normalization** – optional L2 or cosine‑norm scaling is performed before the vector leaves the core, ensuring that similarity metrics operate on a common scale.

The surrounding `SemanticAnalyzer` likely wraps these mechanics in higher‑level methods such as `analyze(text)` that orchestrate tokenization → embedding → similarity (via `SemanticSimilarityComputer`). Because the embedding core is shared, the concrete agents do not need to re‑implement any of these steps; they simply call into the analyzer’s public API.

## Integration Points  

**SharedEmbeddingCore** sits at the heart of the semantic processing pipeline:

* **Upstream** – Receives raw textual input from the concrete agents (the four subclasses) or from any external request that requires semantic understanding. The agents pass the text to `SemanticAnalyzer`, which forwards it to the embedding core.
* **Downstream** – Supplies dense vectors to `SemanticSimilarityComputer`, which lives as a sibling component in the same `src/agents/` package. The similarity computer consumes these vectors to calculate cosine similarity, dot product, or other distance measures.
* **Configuration** – The core reads its model and hyper‑parameter settings from a central configuration file or environment, making it easy to swap models without touching agent code.
* **External Services** – If the embedding model is hosted remotely (e.g., an API call), the core abstracts that network interaction, presenting a synchronous `embed` interface to the rest of the system.

Because the core is the only place where embedding logic resides, any integration with new agents, external micro‑services, or batch processing jobs will simply import `src/agents/semantic-analyzer.ts` and invoke its embedding API.

## Usage Guidelines  

1. **Never duplicate embedding logic** – All new agents or utilities that need vector representations must route their requests through `SemanticAnalyzer`. Directly invoking a model library elsewhere defeats the purpose of the shared core and introduces inconsistency.
2. **Configure centrally** – Adjust model choice, dimensionality, or normalization only in the configuration consumed by `semantic-analyzer.ts`. After a change, run the full test suite to verify that all agents still produce expected similarity scores.
3. **Treat the core as immutable at call‑site** – The `embed` method should be considered a pure function: given the same input, it must always return the same vector (barring intentional stochastic models). This expectation enables caching layers downstream.
4. **Handle errors at the analyzer level** – Network failures, model loading errors, or malformed input should be caught and transformed into domain‑specific exceptions by `SemanticAnalyzer`. Agents should not need to know the failure mode of the embedding provider.
5. **Performance awareness** – Because every agent funnels through the same core, high‑throughput scenarios should consider pooling or async batching inside the core. Any change that impacts latency (e.g., switching to a larger model) will affect all agents uniformly.

---

### Architectural Patterns Identified  

* **Shared‑Core Composition** – A single module (`SharedEmbeddingCore`) provides a common service to multiple consumers.  
* **Facade / Wrapper** – `SemanticAnalyzer` offers a simplified API while delegating to the core.  
* **Coordinator** – `SemanticSimilarityComputer` acts as a collaborator that consumes the core’s output.

### Design Decisions and Trade‑offs  

* **Centralisation vs. Flexibility** – Placing all embedding logic in one file maximises maintainability and consistency but reduces the ability for a single agent to use a specialised model without modifying the core.  
* **Cross‑cutting Concern Extraction** – By extracting embedding, similarity, and tokenization into a shared layer, the design avoids code duplication and eases future refactors. The trade‑off is a tighter coupling between agents; any breaking change in the core must be vetted against all agents.  
* **Configuration‑Driven Model Selection** – Allows rapid experimentation (swap models, change dimensionality) without code changes, at the cost of requiring robust validation of configuration values.

### System Structure Insights  

The system is organised around a **semantic analysis tier** (`src/agents/semantic-analyzer.ts`) that sits above concrete agents and below downstream similarity utilities. This tier is the sole authority on vector creation, ensuring that all downstream components (similarity computer, storage, ranking) operate on a uniform representation. The hierarchy is shallow: agents → analyzer → embedding core → similarity computer, which simplifies reasoning about data flow.

### Scalability Considerations  

Because every request passes through a single embedding core, scaling the embedding service (e.g., horizontal scaling of a model server, caching of frequent embeddings, async batch processing) directly benefits the entire agent ecosystem. However, the design also creates a **potential bottleneck**: a slow model or network latency will affect all agents simultaneously. Anticipating high load, the core should support connection pooling, request batching, and optional in‑process caching.

### Maintainability Assessment  

The shared‑core approach yields **high maintainability**: a change to model version, dimensionality, or normalization is made once and instantly propagates to all agents, eliminating divergent code paths. The clear separation of responsibilities (embedding vs. similarity vs. tokenization) makes the codebase easier to understand and test. The main maintenance risk is the **tight coupling**—any regression in the core can break multiple agents, so comprehensive integration tests around `SemanticAnalyzer` are essential. Overall, the architecture favours consistency and low‑technical‑debt at the expense of per‑agent customisation, a trade‑off that aligns with the system’s emphasis on uniform semantic analysis.


## Hierarchy Context

### Parent
- [SemanticAnalyzer](./SemanticAnalyzer.md) -- src/agents/semantic-analyzer.ts is explicitly shared across all four concrete agent subclasses, making it the single point of change for common embedding, similarity, or tokenization logic

### Siblings
- [SemanticSimilarityComputer](./SemanticSimilarityComputer.md) -- The parent context names 'similarity' as one of three explicit responsibilities of `src/agents/semantic-analyzer.ts` (alongside embedding and tokenization), indicating it is a discrete, named capability rather than an incidental utility


---

*Generated from 3 observations*
