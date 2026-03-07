# MockMode

**Type:** SubComponent

The MockMode class (mock-mode.py) implements a decorator pattern to mock provider calls

## What It Is  

**MockMode** is a sub‑component that lives under the *LLMAbstraction* layer of the system. Its source files are located in the repository at  

* `mock-mode.py` – defines the **MockMode** class that wraps real provider calls.  
* `mock-provider.py` – implements the **MockProvider** used by MockMode to generate synthetic responses.  

Together these files enable the application to replace live Large‑Language‑Model (LLM) provider interactions with deterministic, pre‑defined replies. The feature is primarily intended for testing, development, and any scenario where real API calls are either undesirable or unavailable.  

MockMode is explicitly listed as a child of *LLMAbstraction* and a parent of two concrete children: **MockProvider** and **MockResponseStore** (the latter is the data‑store that holds the mock responses).  

---

## Architecture and Design  

The observations reveal a **decorator pattern** at the heart of MockMode. The `MockMode` class in `mock-mode.py` wraps (decorates) provider‑call methods, intercepting them and delegating to the **MockProvider** when mock mode is active. By doing so, the original provider interface remains unchanged for callers; the only difference is the runtime wiring of the decorator.  

The decorator works in concert with a **data‑store component** (the *MockResponseStore*) that holds the mapping between request signatures and the canned responses. The `mockResponse` method in `mock-mode.py` queries this store to retrieve the appropriate payload. This separation of concerns—*behavior* (MockProvider) versus *state* (MockResponseStore)—keeps the mock logic stateless from the perspective of the decorator, simplifying testing and reuse.  

Within the broader *LLMAbstraction* hierarchy, MockMode shares the same **dependency‑injection** philosophy that the parent component employs. Although the observations do not explicitly show injection code, the parent’s documented use of a configuration file (`dependency-injection-config.json`) suggests that MockMode can be swapped in or out by the injector in the same way as the real provider implementation. This aligns MockMode with its sibling components—*DependencyInjector*, *CircuitBreaker*, *CachingMechanism*, and *TierBasedRouter*—which all expose well‑defined interfaces that the injector can resolve at runtime.  

Because MockMode does not introduce its own asynchronous or event‑driven mechanisms, the architectural footprint remains lightweight: a synchronous decorator that forwards calls to either the real provider or the mock provider based on a simple flag or configuration. This design minimizes performance overhead while providing a clear interception point for testing.  

---

## Implementation Details  

### Core Classes  

* **`MockMode` (mock-mode.py)** – Implements the decorator. Its public API mirrors the provider’s contract, allowing client code to call methods such as `generate_text`, `embed`, etc., without awareness of the underlying mock. The class holds references to two collaborators: an instance of **`MockProvider`** and an instance of **`MockResponseStore`**.  

* **`MockProvider` (mock-provider.py)** – Supplies the logic that fabricates responses. The file likely contains functions like `simulate_completion(request)` that construct a response object matching the shape of a real provider’s output. Because it is a child of MockMode, it is invoked only when the decorator decides to mock a particular call.  

* **`MockResponseStore`** – Though not directly listed in the file system, the hierarchy indicates a module (e.g., `mock-response-store.py`) that maintains a dictionary or lightweight database mapping request identifiers to response payloads. The `mockResponse` method in `MockMode` queries this store:  

  ```python
  def mockResponse(self, request):
      return self.response_store.get(request.id)
  ```  

  This method abstracts persistence details, enabling future extensions (e.g., JSON files, SQLite) without altering the decorator.  

### Workflow  

1. **Invocation** – Client code calls a provider method on an instance that has been wrapped by `MockMode`.  
2. **Decoration Check** – Inside `MockMode`, the decorator examines a configuration flag (likely supplied by the parent *LLMAbstraction* via dependency injection) to decide whether to mock.  
3. **Mock Path** – If mocking is enabled, `MockMode` calls `self.mockResponse(request)`. This method looks up the request in `MockResponseStore`.  
4. **Response Generation** – If a stored response exists, it is returned directly. If not, `MockProvider` is invoked to synthesize a fallback response, which may also be persisted back into the store for repeatability.  
5. **Real Path** – When mocking is disabled, the decorator forwards the call to the actual provider implementation, preserving normal runtime behavior.  

The implementation stays deliberately thin: no complex state machines or external services are introduced, which keeps the codebase approachable for developers writing tests or extending mock behavior.  

---

## Integration Points  

MockMode sits at the intersection of several system layers:  

* **Parent – LLMAbstraction** – The parent component orchestrates provider selection, routing, and resilience (circuit breaker, caching). MockMode is registered as one of the possible provider implementations, enabling the parent’s tier‑based router to direct traffic to the mock path when the configuration selects the “mock” tier.  

* **Siblings – DependencyInjector, CircuitBreaker, CachingMechanism, TierBasedRouter** – Because the parent relies on a dependency‑injection container, MockMode is instantiated and wired through the same JSON configuration used for real providers. This guarantees that any cross‑cutting concerns (e.g., logging, metrics) applied by the injector are also applied to the mock path. The circuit breaker and caching layers are typically bypassed when mocking, but the architecture permits them to remain in the call chain if desired (e.g., caching mock responses).  

* **Children – MockProvider, MockResponseStore** – These two concrete modules are internal to MockMode. `MockProvider` may be swapped out for alternative mock strategies (e.g., rule‑based vs. static fixtures) without impacting the decorator. `MockResponseStore` provides a pluggable persistence point; it could be replaced with an in‑memory store for unit tests or a file‑based store for integration tests.  

* **External Interfaces** – The only outward‑facing interface of MockMode is the provider contract defined by *LLMAbstraction*. Consumers of the LLM abstraction (e.g., higher‑level application services) remain oblivious to whether they are talking to a real or mocked provider, preserving loose coupling.  

---

## Usage Guidelines  

1. **Enable MockMode via Dependency Injection** – Add an entry for `MockMode` in `dependency-injection-config.json` under the provider key used by *LLMAbstraction*. Ensure the flag that selects the mock tier is set (e.g., `"providerMode": "mock"`).  

2. **Populate the MockResponseStore** – Before running tests, seed the store with deterministic responses that match the expected request signatures. This can be done programmatically via the store’s API or by loading a JSON fixture file.  

3. **Prefer Static Fixtures for Predictability** – When possible, store concrete response objects rather than relying on `MockProvider` to generate them on‑the‑fly. Static fixtures make test outcomes repeatable and reduce hidden variability.  

4. **Do Not Mix Real and Mock Calls in a Single Test** – Because the decorator decides globally whether to mock, toggling the mode mid‑test can lead to confusing results. Create separate test suites for mock‑based and live‑provider scenarios.  

5. **Leverage the Same Provider Interface** – Write client code against the abstract provider interface defined in *LLMAbstraction*. This guarantees that swapping between real and mock providers does not require code changes.  

6. **Monitor Performance Overhead** – Although the decorator adds minimal latency, extremely high‑frequency test loops should verify that the mock path does not become a bottleneck, especially if the `MockResponseStore` is backed by a slower persistence mechanism.  

---

### Architectural Patterns Identified  

* **Decorator Pattern** – `MockMode` wraps provider calls, adding conditional mock behavior without altering the original interface.  
* **Dependency Injection** – Integration with the parent’s injector configuration enables runtime selection of the mock implementation.  
* **Facade‑like Separation** – `MockProvider` and `MockResponseStore` act as separate subsystems behind the `MockMode` facade, adhering to single‑responsibility principles.  

### Design Decisions and Trade‑offs  

* **Simplicity vs. Extensibility** – By keeping the mock path synchronous and lightweight, developers gain fast, easy‑to‑understand test scaffolding. The trade‑off is limited support for asynchronous or streaming mock responses, which may be required for advanced LLM features.  
* **Centralized Store vs. Inline Generation** – Storing mock responses centrally (`MockResponseStore`) improves repeatability but introduces a persistence dependency. Inline generation via `MockProvider` reduces storage needs but can lead to nondeterministic test outcomes if the generation logic is complex.  
* **Shared Interface** – Maintaining the same method signatures as the real provider eliminates duplication but forces the mock to implement the full contract, even for rarely used endpoints.  

### System Structure Insights  

MockMode is a leaf node in the component hierarchy but plays a pivotal role in the testing pipeline. Its children (`MockProvider`, `MockResponseStore`) are modular, allowing independent evolution. The component’s placement alongside siblings that address resilience and performance (circuit breaker, caching) illustrates a **cross‑cutting concerns** strategy: each sibling contributes a distinct non‑functional capability that can be composed via the injector.  

### Scalability Considerations  

* **Response Store Size** – As the number of distinct request signatures grows, the in‑memory dictionary approach may exhaust memory. Switching `MockResponseStore` to a lightweight database (e.g., SQLite) would scale storage without altering the decorator.  
* **Concurrent Access** – In multi‑threaded test runners, the store must be thread‑safe. Adding a lock or using a concurrent data structure would preserve correctness.  
* **Parallel Test Execution** – Because the mock path is deterministic, scaling out test execution horizontally does not introduce contention, provided each test process uses an isolated store instance or read‑only fixtures.  

### Maintainability Assessment  

The design is highly maintainable:  

* **Clear Separation** – The decorator, provider, and store are each responsible for a single concern, making unit testing straightforward.  
* **Low Coupling** – Interaction occurs through well‑defined interfaces, and the parent’s dependency‑injection mechanism isolates MockMode from concrete implementations.  
* **Extensible Store** – The abstracted `MockResponseStore` can be replaced without touching `MockMode` or `MockProvider`.  
* **Documentation Alignment** – The observations directly map to file paths and class names, reducing ambiguity for future contributors.  

Potential maintenance risks include:  

* **Configuration Drift** – If the injector configuration diverges from the actual class names, the mock may fail silently.  
* **Mock Provider Evolution** – Adding new provider methods requires parallel updates in `MockProvider` and possibly new fixtures, which can be mitigated by automated test generation.  

Overall, MockMode’s architecture balances testability, simplicity, and integration coherence within the *LLMAbstraction* ecosystem.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- Key patterns and architectural decisions in the LLMAbstraction component include the use of dependency injection, the implementation of a circuit breaker pattern for handling provider failures, and the utilization of a caching mechanism to optimize performance. The component also employs a tier-based routing strategy, allowing for flexible and scalable management of LLM providers and their respective models. Furthermore, the LLMAbstraction component supports a mock mode for testing and development purposes, enabling the simulation of LLM responses without actual API calls.

### Children
- [MockProvider](./MockProvider.md) -- MockProvider likely utilizes a mock-provider.py file to define the mock provider's behavior, which would contain functions that simulate provider responses.
- [MockResponseStore](./MockResponseStore.md) -- MockResponseStore would require a data storage mechanism, such as a dictionary or a database, to store and retrieve mock responses, which could be implemented using a file like mock-response-store.py.

### Siblings
- [DependencyInjector](./DependencyInjector.md) -- DependencyInjector uses a configuration file (dependency-injection-config.json) to define the dependencies between components
- [CircuitBreaker](./CircuitBreaker.md) -- CircuitBreaker uses a state machine (circuit-breaker-state-machine.py) to manage the state of the circuit
- [CachingMechanism](./CachingMechanism.md) -- CachingMechanism uses a cache store (cache-store.py) to store cached data
- [TierBasedRouter](./TierBasedRouter.md) -- TierBasedRouter uses a routing table (routing-table.json) to define the routing rules


---

*Generated from 3 observations*
