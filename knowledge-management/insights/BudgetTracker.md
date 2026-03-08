# BudgetTracker

**Type:** SubComponent

The BudgetTracker sub-component is designed to support multiple modes, including the mock provider in integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts, which allows for testing and development without incurring actual costs.

## What It Is  

The **BudgetTracker** sub‑component lives inside the LLM abstraction layer and is responsible for monitoring and controlling the monetary spend of Large‑Language‑Model (LLM) calls. Its core implementation is spread across a handful of concrete files:  

* `lib/llm/llm-service.ts` – the façade that exposes budget‑related operations to the rest of the system.  
* `lib/llm/providers/anthropic-provider.ts` – a concrete provider‑specific class that implements the `BudgetTracker` interface for Anthropic.  
* `lib/llm/providers/dmr-provider.ts` – another provider‑specific implementation, this time for the DMR service.  
* `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` – a mock provider used in integration tests and local development, exercising the same BudgetTracker contract without incurring real costs.  

Together these files give the system a **provider‑agnostic** way to fetch the current budget, cache it, and react when the budget limit is reached. The sub‑component is a child of the higher‑level **LLMAbstraction** component, which itself coordinates multiple LLM‑related siblings such as **SensitivityClassifier**, **ProviderManager**, and **MODEngine**. All of those siblings also rely on the façade in `llm-service.ts`, which means BudgetTracker shares the same entry point and lifecycle as the rest of the LLM stack.

---

## Architecture and Design  

The observations point to three primary architectural choices:

1. **Facade Pattern** – `lib/llm/llm-service.ts` acts as a façade, exposing a single, unified API for budget‑related operations (e.g., `getCurrentBudget()`, `registerBudgetExceededCallback()`). This façade hides the diversity of underlying providers (Anthropic, DMR, mock) and allows the rest of the system (including the sibling components) to remain oblivious to provider‑specific details.  

2. **Provider‑Specific Implementations** – Each concrete provider (Anthropic, DMR) ships its own class (`AnthropicProvider`, `DMRProvider`) that implements the BudgetTracker contract. The contract is deliberately lightweight: it knows how to query the provider’s billing endpoint, update the cached budget, and fire callbacks when the limit is breached. This design gives the system **extensibility** – new providers can be added by dropping a new class that adheres to the same interface without touching the façade or any sibling component.  

3. **Callback‑Based Notification & Caching** – BudgetTracker uses a callback mechanism to broadcast a “budget exceeded” event to any interested consumer. This is evident from the observation that the class “implements a callback‑based system to notify other components when the budget is exceeded.” The same component also caches the current budget value, reducing the number of remote billing queries and improving performance. The cache lives inside the provider implementation and is refreshed on a configurable interval or on explicit cache‑misses.

The overall interaction flow is:

* A consumer (e.g., **MODEngine**) asks the façade (`llm-service.ts`) for the current budget.  
* The façade delegates to the active provider implementation (Anthropic, DMR, or mock).  
* The provider checks its local cache; if stale, it fetches the latest budget from the external service.  
* If the fetched amount exceeds the configured limit, the provider triggers the registered callbacks.  
* Callbacks can be registered by any component that needs to react (e.g., abort a request, log an alert, switch to a cheaper model).

Because the façade is shared across siblings, the same budget‑state is visible to **SensitivityClassifier**, **ProviderManager**, and **MODEngine**, ensuring consistent spend enforcement across the whole LLM stack.

---

## Implementation Details  

### Facade (`lib/llm/llm-service.ts`)  
The file defines a thin wrapper exposing methods such as `getBudget()`, `setBudgetLimit(limit)`, and `onBudgetExceeded(callback)`. Internally it holds a reference to the currently selected provider class (injected at runtime by **ProviderManager**). All budget‑related calls are funneled through this façade, guaranteeing that adding or removing a provider does not ripple through the codebase.

### Provider Implementations  

* **Anthropic Provider (`lib/llm/providers/anthropic-provider.ts`)** – Implements the BudgetTracker contract for Anthropic’s billing API. The class contains a private cache field (`private cachedBudget: number | null`) and a method `fetchBudgetFromProvider()` that performs the HTTP request. After a successful fetch, it updates the cache and checks the limit; if the limit is crossed, it invokes the façade‑registered callbacks.  

* **DMR Provider (`lib/llm/providers/dmr-provider.ts`)** – Mirrors the Anthropic implementation but targets DMR’s billing endpoint. The observation that “the BudgetTracker sub‑component can be used to track budget for a specific provider” is demonstrated here; the same interface is reused, confirming the sub‑component’s **versatility**.  

* **Mock Provider (`integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`)** – Supplies a deterministic, in‑memory budget value (often a high or unlimited amount) and respects the same callback contract. This enables unit and integration tests to run without real API calls or cost accrual.  

### Callback System  
Each provider maintains a list of callbacks (`private budgetExceededHandlers: Array<() => void>`). The façade’s `onBudgetExceeded` method simply forwards the supplied handler to the active provider. When the provider’s `checkBudget()` method discovers that `cachedBudget > limit`, it iterates over `budgetExceededHandlers` and executes them synchronously (or asynchronously if the implementation chooses). This design decouples the detection logic from the remediation logic, allowing any component—such as **MODEngine**—to decide how to handle overspend.

### Caching Mechanism  
The cache is refreshed based on either a TTL (time‑to‑live) value or an explicit invalidation request. By storing the most recent budget locally, the system avoids repetitive network calls, which is especially valuable when the provider’s billing endpoint has rate limits or latency concerns. The cache also reduces the probability of false “budget exceeded” alerts caused by transient request failures.

---

## Integration Points  

* **Parent – LLMAbstraction** – The parent component aggregates the façade (`llm-service.ts`) and thus indirectly owns the BudgetTracker sub‑component. Any configuration change at the abstraction level (e.g., switching the active provider) propagates down to BudgetTracker through the façade’s provider injection.  

* **Siblings** –  
  * **SensitivityClassifier**, **ProviderManager**, and **MODEngine** all import `lib/llm/llm-service.ts` to obtain budget information or to register callbacks. For example, **MODEngine** may register a callback that pauses model inference when the budget is exhausted.  
  * Because the façade is the single source of truth, all siblings see a consistent view of spend, preventing scenarios where one component thinks the budget is available while another already throttles.  

* **External Consumers** – Any module that needs to enforce cost limits (e.g., a rate‑limiting middleware, an audit logger) can call `llm-service.ts`’s `onBudgetExceeded` to be notified. The mock provider ensures that during CI/CD pipelines the same hooks fire without real monetary impact.  

* **Configuration** – Provider selection and budget limits are likely supplied via environment variables or a central config file read by **ProviderManager**. Changing the active provider merely swaps the concrete class used by the façade, leaving the rest of the system untouched.

---

## Usage Guidelines  

1. **Never bypass the façade** – All budget queries and registrations must go through `lib/llm/llm-service.ts`. Directly invoking provider‑specific methods defeats the provider‑agnostic contract and makes future migrations harder.  

2. **Register callbacks early** – Components that need to react to a budget breach (e.g., **MODEngine**) should register their handlers during initialization, ideally before any LLM request is issued. This guarantees that overspend events are not missed.  

3. **Respect the cache** – The provider’s cache is authoritative for a short period. If an operation requires the *most up‑to‑date* budget (e.g., a high‑value transaction), invoke a cache‑bypass method if one exists (often a `forceRefresh` flag).  

4. **Use the mock provider for testing** – When writing unit or integration tests, configure the system to use the mock implementation located at `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`. This avoids real charges and provides deterministic budget values.  

5. **Handle callbacks idempotently** – Because the callback list may be invoked multiple times (e.g., if the budget remains exceeded across successive checks), callback implementations should be idempotent or guard against repeated execution.  

6. **Monitor cache TTL** – The default cache TTL should be tuned based on provider response latency and billing update frequency. A TTL that is too long may delay detection of a budget breach; a TTL that is too short may increase request load on the provider’s billing endpoint.

---

### Architectural patterns identified  
* Facade pattern (`llm-service.ts`)  
* Provider‑specific strategy (individual provider classes implement a common BudgetTracker contract)  
* Callback/Observer pattern for budget‑exceeded notifications  
* Caching (in‑memory cache within each provider)

### Design decisions and trade‑offs  
* **Facade vs. direct calls** – Centralising budget logic in a façade simplifies consumer code but adds an indirection layer; the trade‑off is worth it for provider‑agnostic flexibility.  
* **Provider‑specific implementations** – Enables optimal use of each provider’s billing API but requires a new class for every new provider, increasing surface area.  
* **Callback notification** – Decouples detection from remediation, allowing many independent responders, but introduces the need for careful management of handler lifecycles to avoid memory leaks.  
* **Caching** – Improves performance and reduces external API load, yet introduces a window where the cached budget may be stale; TTL must be chosen wisely.

### System structure insights  
BudgetTracker sits as a child of **LLMAbstraction**, sharing the same façade (`llm-service.ts`) with sibling components. All LLM‑related functionality (sensitivity classification, provider management, mode execution) relies on the same entry point, guaranteeing a consistent view of budget state across the subsystem. Provider classes are modular plug‑ins that can be swapped by **ProviderManager** without touching the façade or any sibling.

### Scalability considerations  
* **Horizontal scaling** – Because each instance holds its own in‑memory cache, a cluster of services will each maintain a copy of the budget value. For strict global spend enforcement, a shared cache (e.g., Redis) could be introduced, but the current design assumes that occasional drift is acceptable.  
* **Provider addition** – Adding a new LLM provider is a linear effort: implement the BudgetTracker contract and register the class with **ProviderManager**. The façade requires no changes, supporting scalable growth of provider ecosystem.  
* **Cache invalidation** – With many concurrent requests, the cache TTL must be short enough to reflect rapid spend changes but not so short that it overloads the provider’s billing endpoint.

### Maintainability assessment  
The clear separation of concerns—facade, provider implementations, and callback handling—makes the sub‑component highly maintainable. The use of explicit file paths and class names (e.g., `anthropic-provider.ts`, `dmr-provider.ts`) provides a straightforward mental map for developers. However, the reliance on in‑process caching means that any change to cache policy requires coordinated updates across all provider classes. The callback registration API should be well‑documented to avoid accidental duplicate handlers. Overall, the design balances extensibility with simplicity, yielding a maintainable budget‑tracking solution within the LLMAbstraction ecosystem.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM operations. This design decision allows for provider-agnostic model calls, enabling the addition or removal of providers without affecting the rest of the system. For instance, the Anthropic provider (lib/llm/providers/anthropic-provider.ts) and the DMR provider (lib/llm/providers/dmr-provider.ts) can be easily integrated or removed without modifying the core component. The facade pattern also enables the component to support multiple modes, including the mock provider (integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts) for testing purposes.

### Siblings
- [SensitivityClassifier](./SensitivityClassifier.md) -- SensitivityClassifier utilizes the lib/llm/llm-service.ts file to fetch the sensitivity classification for LLM requests, enabling provider-agnostic sensitivity classification.
- [ProviderManager](./ProviderManager.md) -- ProviderManager utilizes the lib/llm/llm-service.ts file to manage and integrate different LLM providers, enabling provider-agnostic operations.
- [MODEngine](./MODEngine.md) -- MODEngine utilizes the lib/llm/llm-service.ts file to manage and execute LLM operations in different modes, enabling mode-agnostic operations.


---

*Generated from 7 observations*
