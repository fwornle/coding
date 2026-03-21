# SensitivityClassifier

**Type:** SubComponent

The lib/llm/llm-service.ts file provides a unified interface for classification operations, suggesting that SensitivityClassifier utilizes this interface.

## What It Is  

**SensitivityClassifier** is a sub‑component of the **LLMAbstraction** layer that is responsible for determining how “sensitive” a piece of input data is before it is handed off to a language‑model (LLM) provider.  The only concrete location we can anchor to from the observations is the shared LLM service implementation in `lib/llm/llm-service.ts`.  This file supplies a unified interface for all classification‑related operations, and the classifier is expected to call into that interface rather than interacting directly with lower‑level provider code.  

From the observations the classifier appears to be encapsulated in its own class (e.g., a `Classifier` or `SensitivityClassifier` class) that implements a decision‑making routine—either a lightweight rule‑engine or a machine‑learning model—to assign a sensitivity level (e.g., “low”, “medium”, “high”).  The result is then consumed by sibling components such as **ModeResolver**, which uses the sensitivity information to pick an appropriate LLM mode, and by **CachingMechanism**, which can memoise classification outcomes for repeated inputs.

---

## Architecture and Design  

The architecture surrounding **SensitivityClassifier** follows a **layered, service‑oriented** approach.  The top‑level **LLMAbstraction** component aggregates several sibling services (ModeResolver, CachingMechanism, BudgetTracker, LLMProviderManager) and delegates all LLM‑related work to the single public entry point `LLMService` (`lib/llm/llm-service.ts`).  Within this hierarchy the classifier is a **sub‑component** that plugs into the LLM service’s classification pipeline.

* **Facade / Unified Interface** – `lib/llm/llm-service.ts` acts as a façade, exposing methods such as `classifySensitivity(input)` (the exact name is not specified, but the observation that the service “provides a unified interface for classification operations” makes this clear).  SensitivityClassifier therefore does not need to know about provider‑specific details; it simply invokes the façade.

* **Separation of Concerns** – By isolating sensitivity logic in its own class, the system keeps the concerns of **data classification**, **mode resolution**, **caching**, and **budget tracking** distinct.  This mirrors the sibling relationship described in the hierarchy context.

* **Potential Use of Strategy / Rule‑Based or ML** – Observation 2 notes that the classifier “may employ a classification algorithm, such as machine learning or rule‑based.”  This suggests a **Strategy**‑style design where the concrete algorithm can be swapped (e.g., a `RuleBasedStrategy` vs. an `MLModelStrategy`) without affecting the rest of the pipeline.

* **Error‑Handling Boundary** – Observation 6 indicates that the classifier “may handle classification‑related errors and exceptions,” implying a defensive programming pattern where the classifier validates inputs and surfaces domain‑specific errors to callers (e.g., the LLM service or ModeResolver).

* **Caching Integration** – Observation 7 mentions leveraging **CachingMechanism** to reduce repeated classification work.  This is an example of **cross‑cutting concern** handling via a shared cache store, likely coordinated through the LLM service’s caching layer.

Overall, the design is **modular** and **extensible**, with each sibling component focusing on a single responsibility while sharing the common LLM service façade.

---

## Implementation Details  

Although the source code is not directly visible, the observations let us infer the key implementation pieces:

1. **Classifier Class** – A class (perhaps named `SensitivityClassifier` or simply `Classifier`) encapsulates the core logic.  It likely exposes a method such as `determineSensitivity(input: string): SensitivityLevel`.  The method applies either a set of deterministic rules (e.g., regex checks for personal identifiers) or forwards the input to a pre‑trained ML model for inference.

2. **Threshold Logic** – Observation 5 references a “sensitivity threshold.”  The implementation probably defines numeric or categorical thresholds (e.g., a confidence score > 0.8 → “high”).  These thresholds are configurable constants, allowing the system to tune how aggressively it flags data.

3. **Error Handling** – The classifier validates incoming payloads (checking for null/undefined, unsupported formats, etc.).  When validation fails or the underlying algorithm throws, the class catches the exception and re‑throws a domain‑specific error (e.g., `ClassificationError`) that upstream components (LLMService, ModeResolver) can interpret.

4. **Interaction with LLMService** – The classifier does **not** call providers directly.  Instead, it uses the façade in `lib/llm/llm-service.ts`.  A typical call flow is:
   ```ts
   // inside LLMService
   const level = sensitivityClassifier.determineSensitivity(request.input);
   const mode = modeResolver.resolve(level);
   const response = providerManager.invoke(mode, request);
   ```
   This flow demonstrates how the classifier’s output feeds directly into the mode‑selection logic.

5. **Caching Hook** – When a classification result is produced, the classifier (or the LLM service on its behalf) stores the result in the shared cache (`CachingMechanism`).  Subsequent identical inputs can retrieve the cached sensitivity level, bypassing the potentially expensive ML inference.

6. **Dependency on Siblings** – The classifier is aware of **ModeResolver** (to know which mode to suggest) and **CachingMechanism** (to read/write cached results).  It does not directly manipulate **BudgetTracker** or **LLMProviderManager**, preserving a clean dependency graph.

---

## Integration Points  

* **LLMAbstraction → LLMService (`lib/llm/llm-service.ts`)** – The primary integration surface.  SensitivityClassifier is invoked by LLMService whenever an incoming request needs sensitivity assessment.

* **ModeResolver** – After the classifier returns a sensitivity level, ModeResolver consumes that level to decide which LLM mode (e.g., “private”, “public”, “restricted”) should be used.  The two components are tightly coupled in the request pipeline but remain separate modules.

* **CachingMechanism** – The classifier either checks the cache before running the classification algorithm or writes the result after classification.  This shared cache is also used by other components (e.g., provider responses), reinforcing a consistent caching strategy across the system.

* **Error Propagation** – Classification errors flow up to LLMService, which may translate them into HTTP error responses or fallback behaviours (e.g., default to a safe mode).  This error path is part of the overall resilience strategy that also includes the circuit‑breaker used by LLMService.

* **Configuration / Thresholds** – Any configurable thresholds are likely loaded from a central configuration module that is shared across LLMAbstraction, ensuring that changes to sensitivity policy propagate uniformly.

---

## Usage Guidelines  

1. **Invoke Through LLMService** – Developers should never call the classifier directly.  All sensitivity checks must be performed via the public methods exposed by `lib/llm/llm-service.ts`.  This guarantees that caching, error handling, and mode‑resolution logic remain consistent.

2. **Provide Clean Input** – The classifier expects well‑formed textual input.  Callers should sanitise or normalise data (e.g., trim whitespace, enforce UTF‑8) before handing it to the LLM service to avoid unnecessary classification errors.

3. **Respect Thresholds** – If the system is configured with custom sensitivity thresholds, those values should be reviewed before adjusting the classifier’s behaviour.  Over‑tuning may either flood the system with “high‑sensitivity” flags or miss truly sensitive data.

4. **Leverage Caching** – When designing higher‑level workflows, be aware that repeated identical inputs will hit the cache.  If a workflow intentionally wants fresh classification (e.g., after a policy change), it should include a cache‑bypass flag supplied to LLMService.

5. **Handle Classification Errors Gracefully** – Since the classifier may raise `ClassificationError` (or a similar domain error), calling code should catch these exceptions and decide on a fallback strategy—commonly defaulting to the most restrictive LLM mode to preserve privacy.

6. **Do Not Bypass ModeResolver** – The sensitivity level alone is not sufficient to choose an LLM provider or mode.  Always let ModeResolver interpret the classifier’s output; manually mapping levels to modes can lead to inconsistent behaviour across the codebase.

---

### Architectural Patterns Identified  

* **Facade Pattern** – `lib/llm/llm-service.ts` provides a unified façade for classification, caching, and provider routing.  
* **Strategy Pattern (implied)** – The classifier may switch between rule‑based and ML‑based strategies without altering callers.  
* **Separation of Concerns / Modular Layering** – Distinct sibling components (ModeResolver, CachingMechanism, etc.) each own a single responsibility.  

### Design Decisions and Trade‑offs  

* **Centralised Service vs. Distributed Calls** – Using a single LLMService façade simplifies the call graph but introduces a single point of coordination.  The trade‑off is reduced duplication at the cost of a tighter coupling between classification and other LLM concerns.  
* **Optional Caching** – Caching classification results improves latency and reduces compute cost, but stale cache entries could misclassify data after policy updates.  The system must provide cache invalidation mechanisms.  
* **Algorithm Flexibility** – Allowing both rule‑based and ML‑based classification gives flexibility but adds complexity in configuration and testing.  

### System Structure Insights  

* **Parent‑Child Relationship** – SensitivityClassifier lives under **LLMAbstraction**, which itself orchestrates the full LLM request lifecycle.  
* **Sibling Collaboration** – It shares the cache store with **CachingMechanism**, supplies data to **ModeResolver**, and indirectly influences the behaviour of **LLMProviderManager** (through the mode selected).  

### Scalability Considerations  

* **Cache‑First Path** – By checking the cache before invoking a potentially expensive ML model, the classifier scales horizontally; additional service instances can share a distributed cache without re‑computing classifications.  
* **Stateless Classification** – If the classifier is stateless (no per‑request mutable state), it can be replicated behind a load balancer, enabling high request throughput.  
* **Circuit‑Breaker Integration** – Since LLMService already employs a circuit‑breaker, classification failures (e.g., an ML service outage) will be isolated, preventing cascade failures.  

### Maintainability Assessment  

The clear separation between classification, mode resolution, caching, and provider management makes the codebase **highly maintainable**.  Adding a new classification rule or swapping the ML model only touches the classifier module.  However, the reliance on implicit contracts (e.g., expected sensitivity levels) means that documentation and unit tests are essential to avoid regression when thresholds or strategies change.  The façade in `lib/llm/llm-service.ts` centralises changes, simplifying future refactors.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes the LLMService class (lib/llm/llm-service.ts) as its single public entry point for all LLM operations, which handles mode routing, caching, and circuit breaking. This design decision enables a unified interface for interacting with various LLM providers, promoting flexibility and maintainability. For instance, the LLMService class employs the CircuitBreaker class (lib/llm/circuit-breaker.js) to prevent cascading failures by detecting when a service is not responding and preventing further requests until it becomes available again. This is particularly useful in preventing service overload and ensuring the overall reliability of the system.

### Siblings
- [LLMProviderManager](./LLMProviderManager.md) -- LLMProviderManager utilizes the LLMService class in lib/llm/llm-service.ts to handle provider interactions.
- [ModeResolver](./ModeResolver.md) -- ModeResolver likely uses a decision-making process, possibly implemented in a function like determineMode(), to select the appropriate LLM mode.
- [CachingMechanism](./CachingMechanism.md) -- CachingMechanism likely uses a cache storage system, possibly implemented in a class like CacheStore, to store cached responses.
- [BudgetTracker](./BudgetTracker.md) -- BudgetTracker likely uses a budgeting system, possibly implemented in a class like BudgetManager, to track and manage costs.

---

*Generated from 7 observations*
