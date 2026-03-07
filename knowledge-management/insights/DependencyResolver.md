# DependencyResolver

**Type:** Detail

The resolver is likely to utilize the ComponentRegistry to retrieve the required components, ensuring that the dependencies are correctly resolved.

## What It Is  

**DependencyResolver** is the core routine that turns the declarative wiring described in *dependency‑injection‑config.json* into concrete, runnable objects. It lives inside the **DependencyInjector** package (the parent component) and is invoked whenever the injector needs to materialise a component that itself depends on other components. Although the source repository does not expose a concrete file path for the resolver, the surrounding hierarchy makes it clear that the resolver is tightly coupled with two sibling services: **ComponentRegistry**, which stores already‑created component instances, and **DependencyConfiguration**, which parses the JSON configuration that describes the dependency graph.

The resolver’s primary responsibility is to walk the dependency graph, locate each required component in the **ComponentRegistry**, and, if a component is missing, recursively resolve its own prerequisites before finally constructing the requested object. Because the resolver must cope with missing or circular dependencies, robust error handling is baked into its workflow.

---

## Architecture and Design  

The design of **DependencyResolver** follows a *recursive resolution* strategy. When a component A is requested, the resolver queries the **ComponentRegistry** to see whether A already exists. If not, the resolver reads the dependency list for A from **DependencyConfiguration** (the JSON file) and, for each declared prerequisite B, invokes the same resolution routine. This depth‑first traversal continues until leaf nodes—components with no further dependencies—are reached, at which point concrete instances are created and stored back in the **ComponentRegistry**.

From an architectural standpoint the resolver embodies the **Resolver** pattern (a specialized form of the Service Locator) by acting as a mediator between the declarative configuration and the runtime component store. The interaction flow can be summarised as:

1. **DependencyInjector** receives a request for a component.  
2. It delegates the request to **DependencyResolver**.  
3. **DependencyResolver** consults **ComponentRegistry** for an existing instance.  
4. If the instance is absent, it asks **DependencyConfiguration** for the component’s dependency list.  
5. It recursively resolves each listed dependency (steps 3‑5).  
6. Once all prerequisites are available, it creates the target component, registers it in **ComponentRegistry**, and returns it to the caller.

Error handling is a first‑class concern: any failure to locate a component definition in the JSON, an inability to instantiate a component, or detection of a circular dependency triggers a controlled exception that propagates up to **DependencyInjector**, allowing the application to react (e.g., by logging or falling back to a default implementation).

---

## Implementation Details  

Although the code base does not expose concrete symbols for the resolver, the observations allow us to infer the essential members and flow:

* **Recursive Resolve Method** – Likely named something akin to `resolve(componentId)` or `resolveDependencies(component)`. This method checks the **ComponentRegistry** (`registry.get(componentId)`) and, if the result is `null`, reads the component’s dependency list from **DependencyConfiguration** (`config.getDependencies(componentId)`). It then iterates over that list, invoking itself for each entry. After all child components are resolved, the resolver constructs the target component (perhaps via a factory or constructor injection) and registers the new instance (`registry.register(componentId, instance)`).

* **ComponentRegistry Interaction** – The resolver treats the registry as a map‑like structure (`Dictionary<string, object>`). The registry’s contract is simple: `get(id)` returns an existing instance or `null`; `register(id, instance)` stores a newly created object. Because the registry is shared across the injector, it guarantees that each component is instantiated only once (singleton semantics) unless the configuration explicitly requests a different lifecycle.

* **Error Handling Pathways** – The resolver must detect three primary error conditions: (a) missing component definition in the JSON, (b) failure during component construction (e.g., constructor throws), and (c) circular dependency detection. The latter can be handled by maintaining a call‑stack set (`HashSet<string> resolving`) that records component IDs currently being resolved; encountering an ID already in the set signals a cycle and raises a `CircularDependencyException`. All exceptions are wrapped or re‑thrown with context that includes the component name and the stage of resolution.

* **Integration with DependencyInjector** – The parent **DependencyInjector** likely exposes a high‑level API such as `getComponent<T>()`. Internally it forwards the request to the resolver, which returns a concrete instance. The injector may also expose lifecycle hooks (e.g., `initializeAll()`) that trigger a bulk resolution of all components defined in the configuration, leveraging the same recursive logic.

---

## Integration Points  

**DependencyResolver** sits at the nexus of three major subsystems:

1. **DependencyConfiguration** – Provides the static definition of what each component depends on. The resolver reads this JSON file (`dependency‑injection‑config.json`) via the configuration service, translating it into an in‑memory dependency map. Any change to the configuration (addition, removal, or re‑ordering of dependencies) directly influences the resolver’s traversal order.

2. **ComponentRegistry** – Acts as the mutable store for instantiated components. The resolver both queries (`registry.get`) and populates (`registry.register`) this registry. Because the registry is shared with the broader injector, any component retrieved elsewhere will be the same instance that the resolver placed there, ensuring consistency.

3. **DependencyInjector (Parent)** – The injector orchestrates the overall injection process and presents the public API. It invokes the resolver whenever a component is requested, and it may also invoke the resolver during application bootstrap to pre‑populate the registry. The injector may also supply additional services (e.g., logging, metrics) that the resolver can use when reporting errors.

The only outward interface the resolver exposes is the recursive resolve method; all other interactions are internal to the injector‑registry‑configuration triad. This tight coupling simplifies the call graph but also means that changes to the configuration format or registry implementation will require corresponding updates in the resolver.

---

## Usage Guidelines  

* **Never call the resolver directly** – All component requests should go through **DependencyInjector**. The injector guarantees that the resolver is invoked with the correct context (e.g., proper logging, error wrapping).

* **Keep the JSON configuration authoritative** – Adding, removing, or renaming component IDs in *dependency‑injection‑config.json* is the primary way to influence resolution. After any change, run the application’s startup sequence to allow the resolver to rebuild the registry; stale entries can cause mismatched types or unresolved dependencies.

* **Avoid circular dependencies** – Although the resolver detects cycles and throws a clear exception, designing components without circular references reduces runtime overhead and simplifies debugging. If a cycle is unavoidable, consider refactoring the involved components into separate services or introducing an intermediate factory.

* **Leverage singleton semantics wisely** – Because the resolver registers each created component exactly once in **ComponentRegistry**, the default lifecycle is singleton. If a component must be transient, the configuration or a dedicated factory should be used; otherwise, shared state may unintentionally persist across calls.

* **Handle resolution errors at the injector level** – When the resolver cannot locate a dependency, it throws a descriptive exception. The calling code (typically the injector or higher‑level bootstrap) should catch these exceptions, log the missing component name, and decide whether to abort startup or fall back to a default implementation.

---

### Architectural patterns identified
1. **Resolver (Service Locator) pattern** – Centralised logic that translates declarative dependency definitions into concrete instances.  
2. **Recursive depth‑first traversal** – Implements graph resolution without explicit iteration structures.  
3. **Singleton registry** – Guarantees one instance per component via **ComponentRegistry**.

### Design decisions and trade‑offs
* **Recursion vs. iterative resolution** – Recursion offers a clear, concise expression of dependency graphs but may risk stack overflow on extremely deep graphs; however, typical DI graphs are shallow, making recursion a pragmatic choice.  
* **Single shared registry** – Simplifies instance sharing but couples all components to a global state, limiting per‑request lifecycles unless additional factories are introduced.  
* **Error‑centric design** – Prioritising early detection of missing components and cycles improves robustness at the cost of additional runtime checks (e.g., maintaining a “currently resolving” set).

### System structure insights
* The system is organised around a **parent‑child** hierarchy: **DependencyInjector** (parent) → **DependencyResolver** (child) → **ComponentRegistry** & **DependencyConfiguration** (siblings).  
* The JSON configuration is the sole source of truth for the dependency graph, while the registry is the sole source of truth for instantiated objects. The resolver bridges the two.

### Scalability considerations
* **Component count** – Because resolution is O(N) with respect to the number of components (each component visited once), the resolver scales linearly.  
* **Concurrency** – The current design, inferred from the observations, does not mention thread‑safety. If the application resolves components in parallel, the **ComponentRegistry** must be made concurrent (e.g., using a thread‑safe map) to avoid race conditions during registration.  
* **Memory footprint** – Storing all instantiated components in a single registry can increase memory usage; for very large systems, a scoped registry or lazy‑loading strategy may be needed.

### Maintainability assessment
* **High cohesion** – The resolver’s responsibilities are narrowly focused on dependency traversal and instance creation, making the codebase easy to understand.  
* **Low coupling** – Interaction points are limited to well‑defined interfaces (`ComponentRegistry.get/register`, `DependencyConfiguration.getDependencies`). Changes to one sibling are unlikely to ripple unexpectedly.  
* **Extensibility** – Adding new lifecycle strategies (e.g., transient, scoped) will require extending the resolver’s creation logic and possibly augmenting the registry, but the core recursive algorithm remains unchanged.  
* **Potential technical debt** – Lack of explicit cycle‑detection mechanisms in the observations suggests that future developers must be vigilant about introducing circular dependencies; adding a dedicated cycle‑check utility would improve long‑term maintainability.


## Hierarchy Context

### Parent
- [DependencyInjector](./DependencyInjector.md) -- DependencyInjector uses a configuration file (dependency-injection-config.json) to define the dependencies between components

### Siblings
- [DependencyConfiguration](./DependencyConfiguration.md) -- The dependency-injection-config.json file defines the dependencies between components, allowing for flexible and modular configuration.
- [ComponentRegistry](./ComponentRegistry.md) -- The ComponentRegistry is expected to be implemented using a data structure such as a dictionary or a map, allowing for efficient registration and retrieval of components.


---

*Generated from 3 observations*
