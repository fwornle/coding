# LLMModeResolver

**Type:** SubComponent

In lib/llm/llm-mode-resolver.ts, the LLMModeResolver uses dependency injection to resolve the current LLM provider, supporting various LLM modes and making it easier to switch between different providers or modes.

## What It Is  

`LLMModeResolver` is a **sub‑component** that lives in the file **`lib/llm/llm-mode-resolver.ts`**. Its sole responsibility is to determine which LLM “mode” the application should use at runtime – whether the system should operate against a **mock** implementation, a **local** LLM server, or a **public** cloud‑based provider. The resolver is invoked by its parent, **`LLMAbstraction`**, and works hand‑in‑hand with sibling components such as **`LLMProviderFactory`** and **`LLMService`** to route calls to the correct concrete provider.

The class is deliberately thin: it reads a configuration object, uses a **factory** to instantiate the appropriate mode implementation, caches the result for subsequent calls, and exposes a small, well‑defined interface that the rest of the codebase can rely on for “current mode” information.

---

## Architecture and Design  

The observations reveal a **modular architecture** anchored around clear separation of concerns. `LLMModeResolver` embodies three primary design patterns:

1. **Factory Pattern** – The resolver “creates instances of different LLM modes based on the provided configuration” (Obs 2). The actual construction logic is delegated to a factory‑style method inside the class, mirroring the approach taken by its sibling `LLMProviderFactory` (which builds concrete provider objects such as Anthropic, OpenAI, Groq). This pattern makes the addition of new modes straightforward: a new mode class only needs to be registered with the factory.

2. **Dependency Injection (DI)** – The resolver “uses dependency injection to resolve the current LLM provider” (Obs 3). Rather than hard‑coding any provider, the class receives a configuration object (or a DI container) that supplies the concrete implementation. This decouples the resolver from specific provider libraries and enables easy swapping of providers without touching the resolver’s internal logic.

3. **Caching** – A simple in‑memory cache stores the resolved mode after the first lookup (Obs 7). By remembering the resolved mode, the system avoids repeated configuration parsing and factory instantiation, which improves performance for high‑frequency LLM calls.

The component also follows a **configuration‑based approach** (Obs 4). The mode is selected by reading a predefined set of mode identifiers (`mock`, `local`, `public`) defined in the same file (Obs 5). This design gives operators the ability to change behavior through configuration files or environment variables rather than code changes, supporting dynamic deployment scenarios.

Interaction flow (simplified):

1. **`LLMService`** (parent sibling) receives an LLM request and asks **`LLMModeResolver`** for the active mode.  
2. **`LLMModeResolver`** reads the configuration, checks its cache, and if needed uses its internal factory logic (mirroring `LLMProviderFactory`) to instantiate the concrete mode class.  
3. The resolved mode object implements a shared **interface** defined by the resolver (Obs 6), guaranteeing that `LLMService` can call the same methods regardless of the underlying provider.

---

## Implementation Details  

### Core Class – `LLMModeResolver`  

*Location*: `lib/llm/llm-mode-resolver.ts`  

- **Constructor / DI entry point** – Accepts a configuration object (or a DI container) that contains a key such as `llmMode`. This is the entry point for the configuration‑based selection (Obs 4).  
- **Predefined mode map** – Inside the file a constant map enumerates the supported modes: `{ mock: MockMode, local: LocalMode, public: PublicMode }` (Obs 5). Each entry points to a class that implements the shared mode interface.  
- **Factory method** – `createModeInstance(modeKey: string)` (conceptual name) checks the map and returns a new instance of the corresponding class. This mirrors the factory pattern used elsewhere in the codebase (Obs 2).  
- **Caching layer** – A private member, e.g., `_cachedMode?: LLMModeInterface`, stores the resolved instance. The public `resolve()` method first returns the cached value if present; otherwise it runs the factory method, caches the result, and returns it (Obs 7).  
- **Interface contract** – The resolver “provides a set of interfaces for different LLM modes” (Obs 6). All mode classes implement a common TypeScript interface (e.g., `LLMModeInterface`) exposing methods such as `generate(prompt: string): Promise<string>` or `healthCheck(): Promise<boolean>`. This ensures that downstream consumers (like `LLMService`) can interact with any mode uniformly.

### Interaction with Siblings  

- **`LLMProviderFactory`** – While `LLMModeResolver` decides *which* mode to use, `LLMProviderFactory` decides *which concrete provider* (Anthropic, OpenAI, Groq) to instantiate **inside** a given mode. Both components employ a factory style, reinforcing a consistent creation strategy across the LLM stack.  
- **`LLMService`** – The service acts as the façade for the rest of the application. It calls `LLMModeResolver.resolve()` to obtain the active mode, then forwards LLM requests to that mode’s implementation. Because `LLMService` also handles caching, circuit breaking, and routing, the resolver’s cache is a secondary performance boost focused solely on mode resolution.

---

## Integration Points  

1. **Configuration Source** – The resolver pulls its mode selection from a configuration file or environment variable that is injected at application start‑up. Changing the value of `llmMode` (e.g., from `mock` to `public`) instantly redirects all LLM traffic without a code redeploy.  

2. **DI Container / Provider Registry** – The resolver expects its dependencies (configuration, possibly logger instances) to be supplied via the same DI framework used by `LLMService` and `LLMProviderFactory`. This keeps the wiring centralized and testable.  

3. **Mode Interfaces** – Each concrete mode class implements the shared interface defined by the resolver. Any new mode must conform to this contract, ensuring compatibility with `LLMService`.  

4. **Caching Layer** – The resolver’s internal cache is transparent to callers; however, if an application needs to force a mode switch at runtime (e.g., during integration tests), it must clear the resolver’s cache or re‑instantiate the resolver.  

5. **Parent Component – `LLMAbstraction`** – The parent aggregates the resolver, provider factory, and service into a cohesive abstraction that higher‑level modules import. The resolver’s public API is thus exposed through `LLMAbstraction`, making it the canonical entry point for mode selection.

---

## Usage Guidelines  

- **Configure before first use** – Ensure the `llmMode` configuration key is set early in the application bootstrap. The resolver caches the result on first call, so later changes to the configuration will not take effect unless the resolver instance is recreated or its cache cleared.  

- **Add new modes via the factory map** – To introduce a new mode (e.g., `sandbox`), create a class that implements the shared mode interface, add it to the predefined mode map in `llm-mode-resolver.ts`, and update any relevant configuration documentation. No changes are required in `LLMService` or `LLMProviderFactory`.  

- **Do not bypass the resolver** – All LLM calls should be routed through `LLMService`, which in turn obtains the active mode from `LLMModeResolver`. Directly instantiating a mode class circumvents the caching and DI benefits and can lead to inconsistent behavior.  

- **Testing** – For unit tests, inject a mock configuration that selects the `mock` mode, or provide a stubbed resolver that returns a pre‑constructed mock mode instance. Because the resolver uses DI, swapping implementations in tests is straightforward.  

- **Cache invalidation** – If an application scenario requires hot‑reloading of the mode (rare in production), provide a utility method on the resolver to clear its internal cache, then call `resolve()` again to re‑evaluate the configuration.  

---

## Architectural Patterns Identified  

| Pattern | Where It Appears | Purpose |
|---------|------------------|---------|
| **Factory** | `LLMModeResolver` (mode creation) and `LLMProviderFactory` (provider creation) | Decouples concrete mode/provider classes from calling code; enables easy extension. |
| **Dependency Injection** | Resolver receives configuration/DI container (Obs 3) | Removes hard‑coded dependencies, promotes testability and configurability. |
| **Caching** | Internal `_cachedMode` in resolver (Obs 7) | Reduces repeated mode resolution overhead, improves request latency. |
| **Configuration‑Based Selection** | Resolver reads `llmMode` from config (Obs 4) | Allows runtime switching of behavior without code changes. |
| **Interface‑Based Polymorphism** | Shared mode interfaces (Obs 6) | Guarantees a consistent API across all mode implementations. |

---

## Design Decisions and Trade‑offs  

1. **Configuration‑Driven Mode Selection** – *Decision*: Use a simple config key to choose the mode.  
   *Trade‑off*: Extremely flexible for operators, but puts the onus on correct configuration management; a mis‑typed value could lead to runtime errors unless guarded by validation logic.

2. **Factory + DI Combination** – *Decision*: Combine a factory method with DI to instantiate modes.  
   *Trade‑off*: Provides high extensibility (new modes/providers can be added without touching callers) at the cost of a slightly more complex initialization path and the need for a well‑maintained registration map.

3. **In‑Memory Caching of Resolved Mode** – *Decision*: Cache the resolved mode after the first lookup.  
   *Trade‑off*: Gains performance for hot paths but introduces stale‑state risk if the configuration is expected to change at runtime. The design mitigates this by keeping the cache private and offering a clear‑cache hook for rare hot‑reload scenarios.

4. **Predefined Mode Set** – *Decision*: Enumerate supported modes (`mock`, `local`, `public`) directly in the file.  
   *Trade‑off*: Guarantees that only vetted modes are used, simplifying validation, yet it requires a code change to add any new mode, which may be a minor friction point for very dynamic environments.

---

## System Structure Insights  

- **Hierarchical Placement** – `LLMModeResolver` sits under the **`LLMAbstraction`** component, acting as the decision layer for mode selection. Its siblings, `LLMProviderFactory` and `LLMService`, occupy complementary roles: the former builds concrete provider objects, while the latter orchestrates request flow, caching, and circuit breaking.  

- **Modular Cohesion** – Each sub‑component has a single, well‑defined responsibility, which aligns with the modular design highlighted in the parent component’s description. This separation makes the LLM stack easy to reason about and to test in isolation.  

- **Shared Interfaces** – The mode interface defined by the resolver is a contract that both `LLMService` and any future consumer can rely on, reinforcing loose coupling across the module boundary.

---

## Scalability Considerations  

- **Horizontal Scaling** – Because mode resolution is performed once per process and cached, scaling the service horizontally (multiple instances behind a load balancer) does not increase per‑request overhead. Each instance resolves its mode independently, which is acceptable given that mode selection is a global configuration rather than a per‑request decision.  

- **Adding New Modes or Providers** – The factory pattern ensures that extending the system to support additional LLM providers (e.g., a new cloud vendor) or new operational modes (e.g., “sandbox”) does not require changes to `LLMService` or the broader abstraction. This encourages growth without architectural refactoring.  

- **Cache Size** – The cache holds only a single resolved mode instance, so memory impact is negligible even at massive scale. However, if future enhancements introduce per‑user or per‑tenant mode resolution, the current cache design would need to evolve (e.g., using an LRU map).  

- **Configuration Propagation** – In a distributed deployment, configuration must be consistent across all instances. The resolver’s reliance on a single config key makes this straightforward but also means that any inconsistency can cause divergent behavior across nodes.

---

## Maintainability Assessment  

`LLMModeResolver` is **highly maintainable** due to several factors:

- **Clear Separation of Concerns** – The resolver focuses only on mode determination; provider creation, request handling, and resilience are delegated to sibling components.  

- **Explicit Interfaces** – By enforcing a shared mode interface, developers can modify or replace a concrete mode implementation without touching callers.  

- **DI Friendly** – Dependency injection makes unit testing trivial; mocks can be injected for both configuration and logger dependencies.  

- **Simple Caching Logic** – The cache is a straightforward private field with a single responsibility, reducing the surface area for bugs.  

- **Documentation‑Ready Structure** – The predefined mode map and factory method are self‑documenting; adding a new entry is a single line change, which encourages accurate, up‑to‑date documentation.

Potential maintenance challenges are limited to **configuration validation** (ensuring only supported mode strings are accepted) and **cache invalidation** (if hot‑reloading becomes a requirement). Both can be addressed with small utility additions without disturbing the core design.

--- 

**In summary**, `LLMModeResolver` exemplifies a clean, modular approach to runtime mode selection within the LLM abstraction layer. Its use of factory creation, dependency injection, configuration‑driven logic, and lightweight caching yields a component that is extensible, performant, and straightforward to maintain, while fitting neatly into the broader LLM architecture alongside `LLMProviderFactory` and `LLMService`.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a modular design, with its codebase organized into multiple modules and files, each with its own specific responsibilities and functions. For instance, the LLMService (lib/llm/llm-service.ts) serves as the primary entry point for all LLM operations, handling mode routing, caching, and circuit breaking. This modular design promotes code reusability and maintainability, as seen in the use of design patterns such as dependency injection and factory patterns. The dependency injection in LLMService (lib/llm/llm-service.ts) enables the resolution of the current LLM provider and supports various LLM modes, making it easier to switch between different providers or modes without affecting the rest of the codebase.

### Siblings
- [LLMProviderFactory](./LLMProviderFactory.md) -- LLMProviderFactory uses a factory pattern in lib/llm/llm-provider-factory.ts to create instances of different LLM providers, such as Anthropic, OpenAI, and Groq.
- [LLMService](./LLMService.md) -- LLMService uses a modular design in lib/llm/llm-service.ts to handle LLM operations, including mode routing, caching, and circuit breaking.


---

*Generated from 7 observations*
