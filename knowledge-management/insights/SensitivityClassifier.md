# SensitivityClassifier

**Type:** SubComponent

The classifier applies a sensitivity estimation strategy to predict the sensitivity of input prompts, as seen in the sensitivity-estimation-strategy.ts file

## What It Is  

**SensitivityClassifier** is a TypeScript sub‑component that lives under the **LLMAbstraction** hierarchy. The primary source files that define its behavior are:

* `src/sensitivity-classifier.ts` – the main class that orchestrates classification.  
* `src/classification-algorithm.ts` – encapsulates the concrete algorithm used to label prompts.  
* `src/sensitivity-estimation-strategy.ts` – implements the strategy for estimating how “sensitive” a given prompt is.  
* `src/classification-updates.ts` – contains the asynchronous update flow that refreshes classification results.  

Together these files provide a focused service that receives a user prompt, runs a sensitivity‑estimation routine, applies a classification algorithm, and then surfaces the result to the rest of the LLM pipeline. The classifier is deliberately decoupled from concrete LLM providers; instead it collaborates with **LLMProviderManager** (see `src/llm-provider-manager.ts`) to influence which provider or mode should be used based on the classification outcome.

---

## Architecture and Design  

The design of **SensitivityClassifier** follows a **modular, dependency‑injection** architecture that mirrors the broader patterns used in its parent component **LLMAbstraction**.  

* **Dependency Injection (DI)** – `SensitivityClassifier` receives a *mode resolver* (and, by extension, the `LLMProviderManager`) through its constructor, as observed in `sensitivity-classifier.ts`. This enables the classifier to remain agnostic of the concrete resolver implementation and makes unit testing straightforward.  

* **Strategy Pattern** – Two child components embody interchangeable strategies:  
  * `ClassificationAlgorithm` (defined in `classification-algorithm.ts`) supplies the core logic for turning a prompt into a categorical label.  
  * `SensitivityEstimationStrategy` (in `sensitivity-estimation-strategy.ts`) encapsulates the heuristic or ML‑based method used to gauge a prompt’s sensitivity.  
  By treating these as pluggable strategies, the system can evolve the algorithm or estimation technique without touching the classifier’s orchestration code.  

* **Asynchronous Flow** – Classification updates are performed with `async/await` (see `classification-updates.ts`). This reflects the inherent latency of LLM calls and aligns with the asynchronous programming style already present in sibling components such as **LLMProviderManager**, **BudgetTracker**, and **ModeResolver**.  

* **Typed Contracts** – All public interfaces are typed using TypeScript’s type system, a design decision highlighted in `sensitivity-classifier.ts`. Strong typing provides compile‑time guarantees about the shape of inputs, outputs, and injected dependencies, reinforcing maintainability across the whole LLM stack.

The component sits in a **tree** where **LLMAbstraction** injects the classifier alongside other siblings (e.g., **BudgetTracker**, **ModeResolver**). The classifier, in turn, delegates to its children (**ClassificationAlgorithm**, **SensitivityEstimationStrategy**) and to the external **LLMProviderManager** for provider selection. This layered interaction keeps responsibilities clean and promotes single‑responsibility adherence.

---

## Implementation Details  

### Core Class – `SensitivityClassifier` (`sensitivity-classifier.ts`)  
The class exposes a public method (e.g., `classifyPrompt(prompt: string): Promise<ClassificationResult>`) that is marked `async`. Inside, the flow is roughly:

1. **Inject Mode Resolver** – The constructor stores a reference to a `ModeResolver` (injected via DI).  
2. **Estimate Sensitivity** – Calls `SensitivityEstimationStrategy.estimate(prompt)` to obtain a numeric or categorical sensitivity score.  
3. **Select Algorithm** – Based on the estimated sensitivity and possibly the current mode, the classifier picks a concrete `ClassificationAlgorithm` implementation.  
4. **Run Classification** – Executes `algorithm.classify(prompt)`; this step may be asynchronous if the algorithm relies on external services.  
5. **Update LLM Provider** – Uses `LLMProviderManager` (imported from `llm-provider-manager.ts`) to adjust the provider or mode according to the classification outcome.  

All interactions are typed, ensuring that the method signatures of `estimate` and `classify` are enforced at compile time.

### Child Strategy – `ClassificationAlgorithm` (`classification-algorithm.ts`)  
This file defines an interface (e.g., `IClassificationAlgorithm`) and one or more concrete classes that implement the actual labeling logic. Because the algorithm is isolated, developers can swap a rule‑based classifier for a machine‑learning model without altering the classifier’s orchestration code.

### Child Strategy – `SensitivityEstimationStrategy` (`sensitivity-estimation-strategy.ts`)  
Similar to the algorithm, this module provides an interface (e.g., `ISensitivityEstimationStrategy`) and a default implementation that may combine NLP heuristics, token‑level analysis, or a lightweight ML model. The strategy returns a standardized sensitivity metric that the parent classifier consumes.

### Asynchronous Updates – `classification-updates.ts`  
This helper module encapsulates the logic for propagating classification results to downstream consumers (e.g., logging, telemetry, or dynamic re‑routing). It uses `async/await` to await the completion of provider updates and ensures that any failure is caught and surfaced as a rejected promise, preserving the overall async contract of the classifier.

---

## Integration Points  

* **LLMAbstraction (Parent)** – The parent injects `SensitivityClassifier` alongside other services (BudgetTracker, ModeResolver). It expects the classifier to expose an async classification API that can be called before any LLM request is dispatched.  

* **LLMProviderManager (Sibling)** – The classifier calls into `LLMProviderManager` to influence provider selection. This coupling is intentional: the classifier decides *what* sensitivity level a prompt has, and the manager decides *which* LLM should handle it based on that decision.  

* **ModeResolver (Sibling)** – Through DI, the classifier receives a mode resolver that may map sensitivity levels to operational modes (e.g., “strict”, “lenient”).  

* **BudgetTracker (Sibling)** – While not directly referenced, the classifier’s outcome can affect budgeting decisions (e.g., higher‑sensitivity prompts might be routed to a more expensive, higher‑quality provider).  

* **ProviderRegistry (Sibling via LLMProviderManager)** – The provider manager ultimately queries the provider registry to locate the concrete LLM implementation that matches the chosen mode.

All integration contracts are expressed via TypeScript interfaces, ensuring that any future replacement of a sibling component must satisfy the same type signatures.

---

## Usage Guidelines  

1. **Inject via Constructor** – When constructing a `SensitivityClassifier`, always provide a concrete `ModeResolver` (or mock for tests). This preserves the DI pattern and allows the classifier to remain testable.  

2. **Prefer the Async API** – Call `classifyPrompt` with `await` to guarantee that provider selection and any downstream updates have completed before proceeding with the LLM request.  

3. **Do Not Bypass Strategies** – If you need to change the classification behavior, implement a new `IClassificationAlgorithm` or `ISensitivityEstimationStrategy` and register it via the classifier’s configuration rather than editing the core class. This respects the strategy pattern and keeps the component modular.  

4. **Handle Errors Gracefully** – Since classification updates are asynchronous, wrap calls in try/catch blocks. The classifier propagates errors as rejected promises, allowing the calling code (often within **LLMAbstraction**) to decide whether to fall back to a default provider or abort the request.  

5. **Observe TypeScript Types** – The public methods and injected dependencies are strongly typed. Adding or removing properties without updating the corresponding interfaces will cause compile‑time failures, which is the intended safeguard.

---

## Summary of Key Insights  

| Architectural Pattern | Where Observed | Rationale / Trade‑off |
|-----------------------|----------------|-----------------------|
| **Dependency Injection** | `sensitivity-classifier.ts` (constructor injection of mode resolver) | Decouples classifier from concrete mode resolver and eases testing; slight runtime overhead of wiring. |
| **Strategy Pattern** | Child components `ClassificationAlgorithm` and `SensitivityEstimationStrategy` | Enables interchangeable algorithms without modifying the orchestrator; adds an extra layer of indirection. |
| **Asynchronous Programming (async/await)** | `classification-updates.ts`, async methods in `sensitivity-classifier.ts` | Aligns with latency of LLM calls; requires careful error handling. |
| **Strong Typing (TypeScript)** | Throughout all files | Improves compile‑time safety and refactorability; requires maintaining accurate type definitions. |

### Design Decisions & Trade‑offs  
* **Modularity vs. Indirection** – By extracting the algorithm and estimation into separate strategy modules, the system gains extensibility at the cost of additional abstraction layers.  
* **DI vs. Global Singletons** – DI was chosen to avoid hidden dependencies; however, it necessitates a wiring layer (often in the parent `LLMAbstraction`).  
* **Async Flow vs. Simplicity** – Embracing async/await matches the real‑world latency of LLM providers but introduces complexity in error propagation and testing.

### System Structure Insights  
The component sits in a **tree‑like hierarchy**: `LLMAbstraction` → `SensitivityClassifier` → (`ClassificationAlgorithm`, `SensitivityEstimationStrategy`). Sibling components share similar architectural motifs (DI, strategy, async), indicating a coherent design language across the LLM stack.

### Scalability Considerations  
* **Algorithm Swappability** – New, more compute‑intensive classification algorithms can be introduced without touching the orchestration logic, supporting scaling of accuracy versus performance.  
* **Parallel Classification** – Because the classifier’s API is async, multiple prompts can be classified concurrently, limited only by the underlying provider’s throughput.  
* **Provider Routing** – By delegating provider choice to `LLMProviderManager`, the system can scale horizontally across multiple LLM back‑ends as demand grows.

### Maintainability Assessment  
Strong TypeScript typing, clear separation of concerns, and explicit DI make the codebase **highly maintainable**. Adding new sensitivity heuristics or swapping out an algorithm requires only new strategy implementations and registration changes. The primary maintenance burden lies in keeping the interfaces synchronized across modules; however, TypeScript’s compile‑time checks mitigate this risk.

--- 

**In short**, `SensitivityClassifier` is a well‑structured, TypeScript‑native sub‑component that leverages dependency injection and the strategy pattern to provide flexible, asynchronous sensitivity classification. Its design aligns tightly with the surrounding LLM ecosystem, fostering extensibility, testability, and scalable operation.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- Key patterns observed in the LLMAbstraction component include dependency injection, used to set the mode resolver, budget tracker, and sensitivity classifier, and the strategy pattern, applied in the provider registry to manage the different LLM providers. The component's architecture is also characterized by the use of asynchronous programming, promises, and async/await syntax to handle the inherently asynchronous nature of LLM operations. Furthermore, the code utilizes TypeScript, benefiting from its type system to ensure better code maintainability and scalability.

### Children
- [ClassificationAlgorithm](./ClassificationAlgorithm.md) -- The classification algorithm is implemented in the classification-algorithm.ts file, which suggests a modular design for the classification logic.
- [SensitivityEstimationStrategy](./SensitivityEstimationStrategy.md) -- The SensitivityEstimationStrategy may employ various techniques, such as natural language processing or machine learning, to analyze input prompts and estimate their sensitivity, as seen in the classification-algorithm.ts file.

### Siblings
- [LLMProviderManager](./LLMProviderManager.md) -- LLMProviderManager uses a provider registry to manage the different LLM providers, as seen in the provider-registry.ts file
- [BudgetTracker](./BudgetTracker.md) -- BudgetTracker uses a budgeting algorithm to track and manage the budget, as seen in the budgeting-algorithm.ts file
- [ModeResolver](./ModeResolver.md) -- ModeResolver uses a mode registry to manage the different modes, as seen in the mode-registry.ts file
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses a registry-based approach to manage the different LLM providers, as seen in the provider-registry.ts file


---

*Generated from 6 observations*
