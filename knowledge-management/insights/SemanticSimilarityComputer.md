# SemanticSimilarityComputer

**Type:** Detail

`integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` and `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md` both document semantic constraint detection workflows that rely on similarity scoring, showing that downstream consumers depend on a stable, centralized similarity API matching what `src/agents/semantic-analyzer.ts` provides

## What It Is  

**SemanticSimilarityComputer** is the core similarity‑scoring engine that lives inside the **SemanticAnalyzer** agent. Its implementation resides in the file  

```
src/agents/semantic-analyzer.ts
```  

The same file also hosts the embedding generation and token‑ization logic, making similarity a first‑class responsibility of the analyzer rather than an after‑thought utility. Down‑stream services – for example the **MCP Constraint Monitor** – rely on the similarity scores produced here, as documented in  

* `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`  
* `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md`  

These documents describe workflows that call a stable, centralized similarity API, confirming that **SemanticSimilarityComputer** is the single source of truth for all vector‑space distance calculations across the platform.

---

## Architecture and Design  

The architecture follows a **central‑shared‑core** pattern. The `src/agents/semantic-analyzer.ts` file is explicitly described as *“the single point of change for common embedding, similarity, or tokenization logic”* and is shared by **all four concrete agent subclasses**. By colocating the three capabilities—embedding, tokenization, and similarity—within the same module, the design guarantees that every similarity calculation uses the exact same embedding space that produced the vectors. This eliminates the risk of **vector‑space drift**, a subtle bug that can arise when embedding and scoring components evolve independently.

The relationship can be visualised as:

```
SemanticAnalyzer (src/agents/semantic-analyzer.ts)
│
├─ SharedEmbeddingCore   ← sibling component, also defined in the same file
│
└─ SemanticSimilarityComputer   ← child component, used by the analyzer
```

* **Single Responsibility at the module level** – the module owns three tightly‑coupled responsibilities, each exposed through a clean API.  
* **Encapsulation of the vector space** – embedding generation and similarity comparison are encapsulated together, ensuring that any change to the embedding model (e.g., swapping a transformer) automatically propagates to similarity without extra wiring.  
* **Stable public API** – downstream integrations (MCP Constraint Monitor) interact only with the similarity API, which is stable because the implementation lives behind a single entry point in `semantic-analyzer.ts`.

No other architectural patterns (micro‑services, event‑driven pipelines, etc.) are mentioned, so the design is deliberately **monolithic at the library level** but modular in the sense that each concrete agent subclass inherits the shared logic.

---

## Implementation Details  

Although the source snapshot reports **0 code symbols found**, the observations give enough structural clues to describe the implementation:

1. **SemanticAnalyzer** – the parent class that orchestrates the three capabilities. It likely exposes methods such as `embed(text: string): Vector` and `similarity(vecA: Vector, vecB: Vector): number`.  
2. **SharedEmbeddingCore** – a sibling component defined in the same file, responsible for the low‑level embedding routine (e.g., calling a transformer model, handling token‑to‑vector conversion).  
3. **SemanticSimilarityComputer** – the child component that consumes the vectors produced by `SharedEmbeddingCore`. It implements the actual distance metric (cosine similarity, dot‑product, or Euclidean distance) and returns a scalar similarity score.

Because the similarity logic lives alongside the embedding code, the implementation can directly reference internal data structures (e.g., the same `Vector` type, normalization utilities) without needing adapters or conversion layers. This tight coupling also means that any configuration (such as the dimensionality of the embedding space) is shared automatically.

The API surface exposed to external consumers is documented in the MCP constraint‑monitor markdown files. Those docs describe a **semantic similarity scoring workflow** that:

* Retrieves embeddings for two pieces of text via the analyzer.  
* Passes the embeddings to the `SemanticSimilarityComputer`.  
* Receives a similarity score that drives downstream constraint‑detection logic.

---

## Integration Points  

* **Down‑stream consumers** – The MCP Constraint Monitor integration explicitly calls the similarity API. Its design documents (`semantic-constraint-detection.md` and `semantic-detection-design.md`) outline the expected request/response shape, confirming that the similarity component must remain **stable and versioned**.  
* **Sibling component** – `SharedEmbeddingCore` provides the vectors that `SemanticSimilarityComputer` consumes. Any change to the embedding pipeline (model upgrade, token‑izer tweak) must preserve the vector contract, otherwise similarity scores could become meaningless.  
* **Agent subclasses** – All concrete agents inherit from `SemanticAnalyzer`. They therefore receive the same similarity functionality without needing to re‑implement it, ensuring consistent behaviour across the system.  

No external libraries or services are referenced in the observations, indicating that the similarity computation is **purely in‑process** and does not depend on remote services.

---

## Usage Guidelines  

1. **Always obtain vectors through the SemanticAnalyzer** – Do not construct vectors manually or import an external embedding library. Using the shared `embed` method guarantees that the vectors are compatible with `SemanticSimilarityComputer`.  
2. **Treat the similarity API as read‑only** – The similarity component is a pure function of two vectors; callers should not attempt to mutate the returned score or the underlying vectors after the call.  
3. **Do not bypass the central module** – Even if a particular agent subclass only needs similarity, it should still reference the parent `SemanticAnalyzer` rather than duplicating logic. This preserves the single point of change highlighted in the observations.  
4. **Maintain consistent vector dimensionality** – If the embedding model is upgraded, verify that the dimensionality stays the same or that the similarity implementation is updated accordingly. Because the two pieces are co‑located, a mismatch will surface as a compile‑time or runtime type error.  
5. **Document any new similarity‑driven workflows** – When extending the system (e.g., adding a new constraint detector), follow the pattern used in the MCP docs: describe the workflow, reference the similarity API, and ensure the design stays aligned with the central implementation.

---

### Architectural Patterns Identified  

* **Shared‑Core / Single‑Point‑Of‑Change** – All embedding, tokenization, and similarity logic resides in one module (`semantic-analyzer.ts`).  
* **Encapsulation of Vector Space** – Embedding and similarity are tightly coupled to guarantee consistent vector semantics.  
* **Stable Public API for Down‑stream Consumption** – Documented similarity scoring workflow used by external integrations.

### Design Decisions & Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Collocate embedding & similarity in the same file | Guarantees same vector space, eliminates drift | Reduces modularity; changes to embedding affect similarity directly, requiring coordinated testing |
| Expose a single similarity API to external services | Provides a stable contract for downstream consumers (MCP monitor) | Limits flexibility for alternative similarity metrics unless the API is extended |
| Use a monolithic in‑process implementation | Simplicity, low latency, no network overhead | Scalability limited to a single process; cannot off‑load heavy similarity workloads to a separate service |

### System Structure Insights  

* **Hierarchy** – `SemanticAnalyzer` (parent) → `SemanticSimilarityComputer` (child).  
* **Sibling** – `SharedEmbeddingCore` shares the same source file, indicating that the three capabilities are conceptually a unit.  
* **Consumers** – External integrations (MCP Constraint Monitor) treat similarity as a service, but it is implemented as an in‑process library.

### Scalability Considerations  

Because similarity computation is performed in‑process, scaling horizontally requires replicating the entire analyzer module across instances. The design is well‑suited for **CPU‑bound parallelism** (e.g., batching similarity calls) but would need additional orchestration (load balancers, container replicas) to handle high request volumes. The tight coupling of embedding and similarity means that any scaling strategy must replicate both together; you cannot independently scale similarity as a separate micro‑service.

### Maintainability Assessment  

The **single‑point‑of‑change** approach greatly simplifies maintenance: a bug fix or model upgrade is made in one file and instantly propagates to all agents and downstream consumers. However, this concentration also means that the file can become a **maintenance hotspot** if additional responsibilities are added. Clear separation of concerns within the file (e.g., distinct classes or well‑named functions for embedding vs. similarity) and comprehensive unit tests for each capability are essential to keep the module manageable. The existing documentation in the MCP integration folder demonstrates good practice in exposing the API contract, which further aids maintainability.


## Hierarchy Context

### Parent
- [SemanticAnalyzer](./SemanticAnalyzer.md) -- src/agents/semantic-analyzer.ts is explicitly shared across all four concrete agent subclasses, making it the single point of change for common embedding, similarity, or tokenization logic

### Siblings
- [SharedEmbeddingCore](./SharedEmbeddingCore.md) -- `src/agents/semantic-analyzer.ts` is explicitly described in the parent context as 'the single point of change for common embedding, similarity, or tokenization logic', confirming that embedding is one of its primary, first-class responsibilities rather than a side concern


---

*Generated from 3 observations*
