# MockModeManager

**Type:** SubComponent

The MockModeManager provides a control interface to enable or disable mock mode, facilitating the transition between testing and production environments.

## What It Is  

The **MockModeManager** is a sub‑component of the **LLMAbstraction** layer that supplies an in‑process mock‑data generation service for LLM‑related testing. It lives inside the same code‑base as the other LLM abstraction pieces (e.g., `lib/llm/llm‑service.ts`, `lib/llm/provider‑registry.js`), although the exact source‑file location is not enumerated in the observations. Its primary purpose is to replace calls to external large‑language‑model providers with locally generated, deterministic data, thereby enabling fast, reliable unit‑ and integration‑tests without incurring network latency or usage costs.

The manager exposes a **control interface** that lets developers toggle mock mode on or off, registers custom mock data generators supplied by the test suite, caches generated payloads for reuse, validates the shape of the mock output, and broadcasts configuration changes to any dependent component. In short, it acts as the “sandbox” that mimics the behaviour of real LLM services while keeping the rest of the system oblivious to whether the data is real or simulated.

---

## Architecture and Design  

From the observations we can infer a **modular, plug‑in architecture** centred on the MockModeManager. Its responsibilities are clearly separated:

1. **Mock Service Configuration** – The manager “configures mock services to mimic the behavior of actual LLM services.” This suggests a **facade‑like entry point** that presents the same API surface as a real LLM provider, allowing the rest of the system (e.g., `LLMService`, `ProviderRegistryManager`) to remain unchanged whether mock mode is active.

2. **Custom Generator Registration** – By “supporting the registration of custom mock data generators,” the component follows a **strategy‑style extensibility point**: each generator implements a common contract (e.g., a `generate()` method) and can be swapped at runtime. This design enables test authors to tailor mock responses for particular prompts or edge cases.

3. **Caching and Validation** – The “mock data caching mechanism” and the “validation mechanism” together form a **cache‑with‑integrity guard** pattern. Cached results reduce the cost of repeated generation, while validation guarantees that cached payloads still satisfy the schema expected by downstream consumers.

4. **Notification of Configuration Changes** – The “notification mechanism to inform dependent components of changes to the mock mode configuration” is analogous to an **observer pattern**: any component that subscribes to the manager receives a signal when mock mode is enabled, disabled, or re‑configured, allowing it to re‑initialise its provider bindings.

These design choices dovetail with the broader LLMAbstraction architecture, which already employs **dependency injection** (see `LLMService`), a **provider registry**, and **circuit‑breaker** and **budget‑tracking** siblings. MockModeManager fits cleanly into that ecosystem by providing a drop‑in replacement for real providers without requiring changes to the injection graph.

---

## Implementation Details  

Although the source files are not listed, the observations give a clear picture of the internal building blocks:

| Concern | Likely Implementation Artifact | Description |
|---------|--------------------------------|-------------|
| **Control Interface** | `MockModeManager.toggleMockMode(enable: boolean)` (or similar) | A public method that flips an internal flag and triggers the notification system. |
| **Mock Service Configuration** | `MockModeManager.configureMockProvider(providerId: string, config: MockConfig)` | Populates a registry that maps logical LLM provider identifiers to mock‑service stubs. |
| **Custom Generator Registration** | `MockModeManager.registerGenerator(name: string, generator: MockGenerator)` | Stores the generator in a map; the generator conforms to a contract such as `generate(prompt: string): MockResponse`. |
| **Data Generation & Caching** | `MockModeManager.getMockData(request: MockRequest): MockResponse` – internally checks a `Map<key, MockResponse>` cache before invoking the appropriate generator. |
| **Validation** | `MockModeManager.validate(response: MockResponse): boolean` – runs schema checks (e.g., JSON‑Schema or TypeScript type guards) and throws or logs if malformed. |
| **Notification** | `MockModeManager.subscribe(listener: (state: MockModeState) => void)` – maintains a list of listeners and calls them on state changes. |

The **caching mechanism** likely uses an in‑memory store (e.g., a `Map` or a lightweight LRU cache) because the mock data is transient and scoped to the test run. The **validation step** prevents downstream components from receiving malformed payloads that could hide bugs in the mock generator itself. By keeping these concerns isolated, the manager remains lightweight and test‑oriented.

---

## Integration Points  

1. **Parent – LLMAbstraction**  
   The MockModeManager lives under the umbrella of **LLMAbstraction**, which already separates concrete LLM providers (`LLMServiceProvider`) from the service façade (`LLMService`). When mock mode is active, the `LLMService`’s injected provider resolves to the mock implementation supplied by MockModeManager, preserving the same dependency‑injection contract used for real providers.

2. **Sibling Components**  
   * **ProviderRegistryManager** – The registry of real providers is mirrored by MockModeManager’s own internal registry of mock providers. Both expose a registration API, enabling a consistent developer experience.  
   * **CachingMechanism** – While the generic caching sibling stores API results, MockModeManager’s cache is specialised for generated mock payloads. The two caches can be configured independently, preventing interference.  
   * **CircuitBreakerManager** – In production, the circuit breaker guards external LLM endpoints. In mock mode, the circuit breaker is effectively bypassed, but the manager still respects the same error‑handling contract, allowing the rest of the system to stay agnostic.  
   * **BudgetTracker & SensitivityClassifier** – These remain active regardless of mock mode, but they may receive mock‑generated usage statistics or content classifications, which the manager ensures are structurally valid.

3. **External Consumers**  
   Any component that consumes LLM responses (e.g., downstream business logic, UI layers) simply calls the `LLMService` API. The MockModeManager’s notification system ensures that when the mode flips, those consumers can re‑resolve their provider bindings without additional code.

---

## Usage Guidelines  

* **Enable/Disable Explicitly** – Use the control interface (`toggleMockMode(true/false)`) at the start of a test suite or CI job. Avoid leaving mock mode on in production builds; the notification system will alert any component that the environment is not using real providers.  
* **Register Generators Early** – Custom generators should be registered before any mock requests are made. This prevents fallback to a default generator that may not produce the required data shape.  
* **Leverage Caching Wisely** – The built‑in cache is ideal for deterministic tests that reuse the same prompt. For tests that need fresh data on each run, either clear the cache between tests or configure the manager with a “no‑cache” flag if available.  
* **Validate Mock Schemas** – Although the manager validates output automatically, test authors should still write schema assertions for their custom generators to catch mismatches early.  
* **Subscribe to Mode Changes** – If a component holds long‑lived references to an LLM provider, subscribe to the MockModeManager’s notification channel so it can re‑bind when the mode toggles. This prevents stale references from leaking real‑service calls into a mock‑only test run.  

---

### Architectural Patterns Identified  

* **Facade / Adapter** – MockModeManager presents the same provider interface as real LLM services.  
* **Strategy (Pluggable Generators)** – Custom mock data generators can be swapped at runtime.  
* **Observer (Notification Mechanism)** – Dependent components are notified of mock‑mode state changes.  
* **Cache‑Aside** – Generated mock data is cached and validated before reuse.

### Design Decisions & Trade‑offs  

* **In‑process Mocking vs. External Stub Server** – By generating data inside the process, latency is minimized and test environments stay self‑contained, but the approach relies on accurate generator implementations to faithfully mimic provider behaviour.  
* **Caching vs. Freshness** – Caching reduces generation cost but can hide nondeterministic bugs; the manager therefore exposes a validation step and, presumably, a cache‑clear API to balance performance with test fidelity.  
* **Validation Overhead** – Adding a validation step incurs a small runtime cost, but it protects the system from malformed mock payloads that could cause false‑positive test failures.  

### System Structure Insights  

MockModeManager is a **leaf sub‑component** that plugs into the larger LLMAbstraction dependency‑injection graph. It mirrors the responsibilities of its siblings (registry, caching, circuit‑breaker) but focuses exclusively on test‑time data. The component’s public API (control, registration, subscription) forms a thin contract that other parts of the system rely on, keeping the overall architecture clean and interchangeable.

### Scalability Considerations  

* **Generator Scalability** – Because custom generators run in‑process, their CPU and memory usage scale with the number of concurrent mock requests. Heavy‑weight generators should be written efficiently or off‑loaded to worker threads.  
* **Cache Size** – The in‑memory cache must be bounded (e.g., LRU with a max entry count) to avoid unbounded memory growth in large test suites.  
* **Notification Fan‑out** – The observer list should be kept modest; excessive subscribers could introduce latency when toggling mock mode.  

### Maintainability Assessment  

The component’s responsibilities are **well‑encapsulated**: generation, caching, validation, and notification are each isolated behind clear methods. This separation simplifies unit testing of MockModeManager itself and reduces coupling with siblings. Because the manager follows the same dependency‑injection patterns as the rest of LLMAbstraction, adding new mock providers or swapping generators requires minimal code changes. The primary maintenance burden lies in keeping custom generators aligned with any schema changes to real LLM responses; the built‑in validation mitigates this risk by surfacing mismatches early. Overall, MockModeManager is a maintainable, test‑focused piece that enhances the robustness of the LLM abstraction layer.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's architecture is designed with modularity in mind, as seen in the separation of concerns between the LLMService (lib/llm/llm-service.ts) and the provider registry (lib/llm/provider-registry.js). This modular design allows for the easy addition or removal of LLM providers, such as Anthropic and DMR, without affecting the core functionality of the component. Furthermore, the use of dependency injection in the LLMService enables the injection of various dependencies, including budget trackers, sensitivity classifiers, and quota trackers, which enhances the flexibility and customizability of the component.

### Siblings
- [LLMServiceProvider](./LLMServiceProvider.md) -- LLMServiceProvider uses dependency injection in lib/llm/llm-service.ts to enable the injection of various dependencies, such as budget trackers and sensitivity classifiers.
- [ProviderRegistryManager](./ProviderRegistryManager.md) -- The ProviderRegistryManager class in lib/llm/provider-registry.js maintains a registry of available LLM providers, facilitating the addition or removal of providers.
- [CachingMechanism](./CachingMechanism.md) -- The CachingMechanism utilizes a cache storage mechanism to store recent results, reducing the overhead of frequent API calls.
- [CircuitBreakerManager](./CircuitBreakerManager.md) -- The CircuitBreakerManager utilizes a failure detection mechanism to identify failing services, preventing cascading failures.
- [BudgetTracker](./BudgetTracker.md) -- The BudgetTracker utilizes a budget tracking mechanism to monitor and report on budget usage, facilitating cost management and optimization.
- [SensitivityClassifier](./SensitivityClassifier.md) -- The SensitivityClassifier utilizes a sensitivity classification mechanism to categorize and report on sensitive data, facilitating data protection and compliance.

---

*Generated from 7 observations*
