# DependencyInjector

**Type:** SubComponent

DependencyInjector uses a configuration file (dependency-injection-config.json) to define the dependencies between components

## What It Is  

`DependencyInjector` is a **sub‑component** that lives under the `LLMAbstraction` umbrella. Its concrete implementation resides in the file **`dependency-injector.py`**, while the wiring information is kept in the JSON file **`dependency-injection-config.json`**. The injector’s sole responsibility is to read the declarative configuration, resolve the required component graph, and inject the resolved instances into target objects at runtime. By exposing a single, globally‑available instance (implemented as a singleton), the injector guarantees a consistent dependency graph across the whole LLM‑abstraction stack, including sibling sub‑components such as `CircuitBreaker`, `CachingMechanism`, `TierBasedRouter`, and `MockMode`.

## Architecture and Design  

The design follows a **configuration‑driven dependency‑injection** approach. The JSON file (`dependency-injection-config.json`) defines the relationships between components, allowing the injector to remain agnostic of concrete classes. This decouples component creation from component usage, a classic inversion‑of‑control (IoC) technique.  

Two well‑known patterns are explicitly evident:  

1. **Singleton** – The `DependencyInjector` class ensures that only one injector object exists throughout the process lifetime. This eliminates the risk of divergent registries and simplifies global access for all consumers inside `LLMAbstraction`.  
2. **Reflection‑based injection** – The `injectDependencies` method leverages Python’s reflection capabilities (e.g., `setattr`, `inspect`) to assign resolved objects to the appropriate attributes of a target component at runtime. This dynamic wiring eliminates the need for compile‑time wiring code.  

The injector collaborates with three child entities:  

* **DependencyConfiguration** – Represents the parsed JSON configuration and provides a structured view of declared dependencies.  
* **ComponentRegistry** – Acts as a lookup table (most likely a dictionary) that stores instantiated components keyed by their identifiers, enabling O(1) retrieval during resolution.  
* **DependencyResolver** – Implements the actual graph traversal, recursively resolving each component’s own dependencies before returning a fully‑constructed instance.  

Together these pieces form a lightweight IoC container that sits alongside the other LLM‑abstraction mechanisms (circuit breaking, caching, routing, mock mode), each of which also consumes the injector to obtain their own collaborators.

## Implementation Details  

* **Singleton enforcement** – Inside `dependency-injector.py` the class likely holds a private class‑level attribute (e.g., `_instance`) and overrides `__new__` or provides a `get_instance()` factory method. The first call creates the injector; subsequent calls return the stored reference.  
* **Configuration loading** – Upon first instantiation, the injector reads `dependency-injection-config.json`. The file’s schema defines component identifiers, their concrete class paths, and the list of required dependencies for each. This data is materialised into the **`DependencyConfiguration`** object, which validates the JSON structure and may raise early errors for malformed entries.  
* **Component registration** – As components are created, they are placed into the **`ComponentRegistry`**. The registry is a simple map (`dict`) where keys are component names (or fully‑qualified class identifiers) and values are the instantiated objects. This enables constant‑time lookup for already‑resolved singletons or shared services.  
* **Recursive resolution** – The **`DependencyResolver`** walks the dependency graph defined in the configuration. For each component, it checks the registry; if absent, it loads the class via reflection (`importlib.import_module` + `getattr`), resolves its own dependencies first, constructs the object (often by calling the class constructor with resolved arguments), stores it in the registry, and returns the instance. The resolver must detect circular dependencies and raise a descriptive exception.  
* **Injection mechanics** – `injectDependencies(target)` inspects the target object for annotated fields or naming conventions (e.g., attributes ending with `_dep`). For each such field, the resolver fetches the appropriate instance from the registry and assigns it using `setattr`. Because this occurs at runtime, developers can add new injectable attributes without changing the injector code, provided they are described in the JSON configuration.

## Integration Points  

`DependencyInjector` is a core service for the entire **`LLMAbstraction`** component hierarchy. All sibling sub‑components—`CircuitBreaker`, `CachingMechanism`, `TierBasedRouter`, and `MockMode`—request their own collaborators through the injector, ensuring a unified component graph. For example, `CircuitBreaker` may depend on a logging service, while `CachingMechanism` needs a storage backend; both obtain those services via the same singleton injector, guaranteeing consistent configuration.  

The injector’s public API is likely limited to two methods: `get_instance()` (or similar) and `injectDependencies(target)`. Consumers import the singleton, then either call `injectDependencies(self)` within their `__init__` or rely on the injector to construct them directly via the resolver. The JSON configuration acts as the contract between the injector and the rest of the system, meaning any addition of a new component (e.g., a new provider) only requires an entry in `dependency-injection-config.json` and an optional registration in the registry if manual instantiation is needed.  

Because the injector sits beneath `LLMAbstraction`, any higher‑level orchestration (e.g., a request‑handling pipeline) can assume that all required services are already wired, simplifying testing: the `MockMode` sibling can supply mock implementations in the configuration, and the injector will transparently inject those mocks instead of real services.

## Usage Guidelines  

1. **Never instantiate `DependencyInjector` directly** – always retrieve the global instance via the provided factory (e.g., `DependencyInjector.get_instance()`). This preserves the singleton guarantee and avoids divergent registries.  
2. **Declare every injectable dependency in `dependency-injection-config.json`** – the JSON file is the single source of truth for wiring. Missing entries will cause resolution failures at startup, which is preferable to silent runtime errors.  
3. **Prefer constructor injection when possible** – although `injectDependencies` can set attributes post‑construction, defining required dependencies as constructor parameters lets the resolver build fully‑initialized objects in one step, reducing the chance of partially‑wired instances.  
4. **Avoid circular dependencies** – the recursive resolver cannot break cycles; design components so that dependency graphs are acyclic. If a cycle is unavoidable, consider refactoring the shared functionality into a separate service that both parties depend on.  
5. **Leverage the registry for shared singletons** – once a component is resolved, it is cached in `ComponentRegistry`. Re‑requesting the same component returns the existing instance, which is essential for stateful services (e.g., a cache store).  
6. **Use mock entries for testing** – the `MockMode` sibling demonstrates that swapping real implementations for test doubles is as simple as editing the JSON configuration. Ensure test configurations mirror production keys to avoid mismatches.  

---

### Summary of Requested Items  

1. **Architectural patterns identified**  
   * Singleton (global injector instance)  
   * Reflection‑based dependency injection (runtime attribute wiring)  
   * Configuration‑driven IoC container (JSON‑defined component graph)  

2. **Design decisions and trade‑offs**  
   * Centralised singleton simplifies access but introduces a global state that must be carefully managed in multi‑process scenarios.  
   * Reflection provides flexibility at the cost of runtime overhead and reduced static type safety.  
   * JSON configuration enables easy re‑wiring without code changes, but places responsibility on the configuration’s correctness and can be harder to validate statically.  

3. **System structure insights**  
   * `DependencyInjector` sits under `LLMAbstraction` and serves as the backbone for all sibling sub‑components.  
   * Child entities (`DependencyConfiguration`, `ComponentRegistry`, `DependencyResolver`) encapsulate distinct responsibilities: parsing, storage, and graph resolution respectively.  
   * The injector’s registry acts as a shared service locator for the entire abstraction layer.  

4. **Scalability considerations**  
   * Because resolution is performed lazily and cached, the injector scales well for large numbers of components; the primary bottleneck is the initial configuration parse and first‑time resolution.  
   * The singleton model may need adaptation (e.g., per‑process or per‑thread instances) if the system is deployed across multiple workers or containers.  
   * Reflection overhead is negligible for typical LLM‑abstraction workloads but should be profiled if the injector is invoked at high frequency.  

5. **Maintainability assessment**  
   * High maintainability thanks to the clear separation of concerns (configuration, registry, resolver) and the declarative wiring model.  
   * Adding or modifying components requires only JSON edits and, optionally, new class implementations—no changes to injector code.  
   * Potential maintenance risk lies in circular dependencies and configuration drift; automated validation of `dependency-injection-config.json` (schema checks, graph cycle detection) is advisable to keep the system robust.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- Key patterns and architectural decisions in the LLMAbstraction component include the use of dependency injection, the implementation of a circuit breaker pattern for handling provider failures, and the utilization of a caching mechanism to optimize performance. The component also employs a tier-based routing strategy, allowing for flexible and scalable management of LLM providers and their respective models. Furthermore, the LLMAbstraction component supports a mock mode for testing and development purposes, enabling the simulation of LLM responses without actual API calls.

### Children
- [DependencyConfiguration](./DependencyConfiguration.md) -- The dependency-injection-config.json file defines the dependencies between components, allowing for flexible and modular configuration.
- [ComponentRegistry](./ComponentRegistry.md) -- The ComponentRegistry is expected to be implemented using a data structure such as a dictionary or a map, allowing for efficient registration and retrieval of components.
- [DependencyResolver](./DependencyResolver.md) -- The DependencyResolver may employ a recursive approach to resolve dependencies, handling cases where components have multiple dependencies.

### Siblings
- [CircuitBreaker](./CircuitBreaker.md) -- CircuitBreaker uses a state machine (circuit-breaker-state-machine.py) to manage the state of the circuit
- [CachingMechanism](./CachingMechanism.md) -- CachingMechanism uses a cache store (cache-store.py) to store cached data
- [TierBasedRouter](./TierBasedRouter.md) -- TierBasedRouter uses a routing table (routing-table.json) to define the routing rules
- [MockMode](./MockMode.md) -- MockMode uses a mock provider (mock-provider.py) to simulate provider responses


---

*Generated from 3 observations*
