# ComponentRegistry

**Type:** Detail

The ComponentRegistry is expected to be implemented using a data structure such as a dictionary or a map, allowing for efficient registration and retrieval of components.

## What It Is  

The **ComponentRegistry** is the core catalogue that stores the concrete component types that can be injected throughout the application.  According to the observations, the registry is realised as a simple associative container—most commonly a **dictionary** or **map**—that maps a component’s **unique identifier** (often a string name or type key) to the concrete implementation or a factory capable of producing it.  It lives inside the **DependencyInjector** package (the parent component) and is therefore instantiated and owned by the `DependencyInjector`.  No concrete file paths were supplied in the observations, so the exact location on disk cannot be cited; however, the registry is conceptually co‑located with the other injection‑related classes such as `DependencyConfiguration` and `DependencyResolver`.

## Architecture and Design  

The design of **ComponentRegistry** follows a **centralised registry** pattern.  By exposing a single, globally‑accessible map, the system guarantees that any part of the codebase can request a component by its identifier without needing to know the concrete construction details.  This aligns with the **Service Locator** style, albeit the registry is intended to be used *internally* by the `DependencyInjector` rather than as a public API.  

Interaction flow:  

1. **DependencyConfiguration** reads *dependency‑injection‑config.json* and populates the registry with the mappings declared in that file.  
2. **DependencyResolver** queries the registry while recursively walking the dependency graph, fetching the required component definitions.  
3. **DependencyInjector** orchestrates the whole process, delegating registration to the registry and resolution to the resolver.  

The registry’s reliance on a dictionary/map gives **O(1)** lookup time, which is crucial for performance when resolving deep or frequently‑used dependency trees.  The unique‑identifier convention (e.g., fully‑qualified type name or explicit alias) eliminates naming collisions and enables deterministic resolution.

## Implementation Details  

Although the source code was not enumerated, the observations describe the essential mechanics:  

* **Data Structure** – The registry is a key‑value store (`Dictionary<string, ComponentEntry>` or `Map<ComponentKey, ComponentFactory>`).  The key represents the component’s identifier; the value holds either the concrete instance (for singleton scopes) or a factory/lazy‑loader (for transient scopes).  

* **Registration API** – A typical method signature would be `register(id: string, factory: () => object): void` or `registerSingleton(id: string, instance: object): void`.  The registry validates that the identifier is unique before inserting, throwing an error on duplicate registration.  

* **Retrieval API** – Consumers call something akin to `get(id: string): object`.  The method looks up the identifier, executes the stored factory if necessary, and returns the resulting component.  Because the registry is a centralised object, the `DependencyInjector` can expose a thin façade (`inject<T>(key: string): T`) that forwards to the registry.  

* **Scope Management** – While not explicitly mentioned, a common extension is to store metadata (lifetime, dependencies) alongside each entry, enabling the resolver to decide whether to reuse an instance or create a new one.  

* **Error Handling** – The registry must surface clear diagnostics when a requested identifier is missing or when circular dependencies are detected (the latter typically handled by the `DependencyResolver`).  

## Integration Points  

* **DependencyInjector (Parent)** – Instantiates the `ComponentRegistry` and passes it to the `DependencyResolver`.  The injector’s public API (`inject`, `register`, `configure`) is essentially a façade over the registry’s capabilities.  

* **DependencyConfiguration (Sibling)** – Reads the JSON configuration file and invokes the registry’s registration methods.  The configuration file defines the mapping from identifiers to concrete class names or factory functions, providing the flexibility to swap implementations without code changes.  

* **DependencyResolver (Sibling)** – Consumes the registry during the resolution phase.  When a component declares dependencies, the resolver looks up each required identifier in the registry, recursively resolves their own dependencies, and assembles the final object graph.  

* **External Consumers** – Application code typically never talks directly to the `ComponentRegistry`.  Instead, it asks the `DependencyInjector` for a component, which internally queries the registry.  This encapsulation preserves the registry’s internal invariants and prevents accidental mutation.  

## Usage Guidelines  

1. **Register Early, Resolve Late** – All components should be registered during application start‑up (often in a bootstrap module) before any injection occurs.  This guarantees that the resolver can find every identifier when building the object graph.  

2. **Use Stable, Unique Identifiers** – Adopt a naming convention that mirrors the fully‑qualified type name or a clear alias.  Consistency prevents accidental collisions and makes configuration files easier to read.  

3. **Prefer Factories for Transient Components** – Register a factory function rather than a pre‑instantiated object when the component should be created anew for each injection.  This keeps the registry’s storage lightweight and respects component lifetimes.  

4. **Leverage the Configuration File** – Keep the mapping logic in *dependency‑injection‑config.json* whenever possible.  This separates wiring from implementation, allowing environment‑specific overrides without code changes.  

5. **Avoid Direct Registry Access** – Treat the registry as an internal implementation detail of the `DependencyInjector`.  Interacting through the injector’s façade preserves encapsulation and future‑proofs the system against changes in the registry’s internal representation.  

---

### 1. Architectural patterns identified  
* **Centralised Registry / Service Locator** – a single dictionary‑based store for component look‑ups.  
* **Factory Pattern** – registration can accept factory functions to defer instantiation.  
* **Configuration‑Driven Wiring** – external JSON file (`dependency‑injection‑config.json`) drives the population of the registry.  

### 2. Design decisions and trade‑offs  
* **Dictionary for O(1) lookup** gives fast resolution but requires careful handling of key collisions.  
* **Centralised store simplifies access** but introduces a global mutable state; encapsulating it behind the `DependencyInjector` mitigates risk.  
* **Configuration file adds flexibility** at the cost of runtime parsing overhead and the need for validation logic.  

### 3. System structure insights  
* **Parent‑Child relationship:** `DependencyInjector` owns the `ComponentRegistry`.  
* **Sibling collaboration:** `DependencyConfiguration` populates the registry; `DependencyResolver` reads from it.  
* **No direct children** are described; the registry’s entries (component definitions) act as logical children.  

### 4. Scalability considerations  
* The dictionary scales linearly with the number of components; look‑up time remains constant, making the approach suitable for large applications.  
* For extremely large registries, lazy loading of configuration sections or sharding the map by module could be introduced without breaking the existing API.  

### 5. Maintainability assessment  
* **High maintainability** – the registry’s simple key/value contract is easy to understand and test.  
* Centralising registration logic in the JSON file and a single registration method reduces duplication.  
* Encapsulation behind the `DependencyInjector` façade limits the surface area for accidental misuse, further supporting long‑term maintainability.


## Hierarchy Context

### Parent
- [DependencyInjector](./DependencyInjector.md) -- DependencyInjector uses a configuration file (dependency-injection-config.json) to define the dependencies between components

### Siblings
- [DependencyConfiguration](./DependencyConfiguration.md) -- The dependency-injection-config.json file defines the dependencies between components, allowing for flexible and modular configuration.
- [DependencyResolver](./DependencyResolver.md) -- The DependencyResolver may employ a recursive approach to resolve dependencies, handling cases where components have multiple dependencies.


---

*Generated from 3 observations*
