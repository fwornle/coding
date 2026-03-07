# ModeResolverStrategy

**Type:** Detail

The ModeResolverStrategy would be implemented as a separate module or class, potentially utilizing a factory pattern to create instances of different mode resolver implementations.

## What It Is  

The **ModeResolverStrategy** is a dedicated component that encapsulates the logic for determining which *mode* (for example, “standard”, “experimental”, “debug”, etc.) should be used for a particular LLM provider at runtime.  Although the observations do not list an exact source‑file location, they describe the strategy as being implemented as a **separate module or class** that is owned by the **LLMProviderManager**.  In the overall hierarchy, the manager‑level entity (LLMProviderManager) holds a reference to the strategy so that every time a provider is requested the manager can ask the strategy to resolve the appropriate mode before delegating further work.

The strategy is not a monolithic, hard‑coded switch.  Instead, it is designed to be **configurable** – it can read external configuration files or environment variables to decide which mode applies to a given provider.  Moreover, it can **cache or memoize** the results of a resolution, thereby avoiding repeated look‑ups for frequently accessed providers and keeping the resolution overhead low.

---

## Architecture and Design  

The observations point to a **factory‑style approach**: the ModeResolverStrategy is likely constructed via a small factory that decides which concrete resolver implementation to instantiate based on configuration.  This aligns with the classic *Factory* pattern, where the client (LLMProviderManager) does not need to know the exact class that performs the resolution; it only depends on the abstract Strategy interface.

Because the strategy may need to read **external configuration files or environment variables**, it follows a **configuration‑driven design**.  The configuration source becomes a dependency of the strategy, allowing operators to change provider‑mode mappings without touching code.  This design also supports **override semantics** – environment variables can supersede file‑based defaults, giving administrators a quick way to tweak behavior in different deployment contexts.

The mention of **caching or memoization** introduces an **optimization layer** that sits inside the strategy implementation.  The cache can be a simple in‑memory map keyed by provider identifier, storing the resolved mode for the lifetime of the process.  This choice trades a small amount of memory for a reduction in I/O (reading config files) and CPU cycles (re‑evaluating rules).

Within the broader system, the ModeResolverStrategy shares its *parent* (LLMProviderManager) with two sibling managers:

* **ProviderRegistryManager** – responsible for registering and retrieving provider instances.  
* **ProviderLifecycleManager** – orchestrates the initialization and activation hooks of providers.

All three managers collaborate: the registry supplies the concrete provider object, the lifecycle manager ensures the provider is ready to be used, and the mode resolver decides *how* the provider should behave for the current request.  This separation of concerns keeps each manager focused on a single responsibility while allowing them to be composed together.

---

## Implementation Details  

Even though no concrete symbols were listed, the observations give a clear picture of the internal structure:

1. **Strategy Interface** – an abstract contract (e.g., `IModeResolverStrategy`) exposing a method such as `resolveMode(providerId: string): Mode`.  LLMProviderManager depends only on this interface.

2. **Concrete Implementations** – one or more classes that implement the interface.  A typical implementation might be `ConfigBasedModeResolver` which:
   * Loads a JSON/YAML configuration file at startup (or lazily on first use).  
   * Reads environment variables (e.g., `PROVIDER_<ID>_MODE`) to allow runtime overrides.  
   * Merges the two sources, applying precedence rules (env > file > default).

3. **Factory** – a static or injectable factory (e.g., `ModeResolverFactory.create()`) that inspects the current environment and returns the appropriate concrete resolver.  The factory abstracts away the decision of whether to use a simple in‑process resolver, a remote configuration service, or a mock resolver for tests.

4. **Caching Layer** – the concrete resolver can wrap its core resolution logic with a memoization map.  The first call for a given `providerId` computes the mode and stores it; subsequent calls return the cached value.  The cache can be invalidated on configuration reload events, ensuring that updates are eventually reflected without a full restart.

5. **Error Handling** – the resolver should surface a clear exception or fallback mode when a provider’s configuration is missing or malformed, allowing the LLMProviderManager to degrade gracefully.

All of these pieces are encapsulated within the dedicated module, keeping the public surface minimal (the strategy interface) while allowing internal flexibility.

---

## Integration Points  

* **LLMProviderManager** – owns an instance of the strategy and invokes `resolveMode` each time a provider is fetched from the **ProviderRegistryManager**.  The resolved mode may dictate which endpoint, model variant, or request‑level flags the manager passes downstream.

* **ProviderRegistryManager** – supplies the raw provider objects but does not concern itself with mode selection.  The registry and the resolver are loosely coupled; the resolver only needs the provider’s identifier, not the provider instance itself.

* **ProviderLifecycleManager** – may need to know the resolved mode when triggering lifecycle hooks (e.g., a provider might need to load a different model checkpoint in “experimental” mode).  The lifecycle manager can query the resolver directly or receive the mode from the manager as part of the activation payload.

* **Configuration Sources** – external files (commonly located under a `config/` directory) and environment variables are the primary data feeds for the resolver.  Any change to these sources should trigger a reload mechanism, which the resolver can listen to (e.g., via a file‑watcher or a signal from a configuration service).

* **Testing Utilities** – because the resolver is abstracted behind an interface, unit tests for LLMProviderManager can inject a mock resolver that returns deterministic modes, enabling isolated testing of higher‑level logic.

---

## Usage Guidelines  

1. **Prefer the Factory** – when constructing an LLMProviderManager, always obtain the ModeResolverStrategy through the provided factory rather than instantiating a concrete class directly.  This guarantees that the correct configuration source and caching behavior are applied consistently across the codebase.

2. **Keep Configuration Centralized** – store provider‑mode mappings in a single configuration file (e.g., `mode-config.yaml`) and document the environment‑variable overrides.  Avoid scattering mode decisions across multiple places; the resolver should be the sole authority.

3. **Cache Awareness** – be mindful that the resolver caches results.  If you modify the configuration at runtime, invoke the resolver’s `invalidateCache()` (or an equivalent API) or trigger a full reload event so that the new settings are respected.

4. **Handle Missing Modes Gracefully** – always anticipate that `resolveMode` could return `undefined` or throw an error if a provider is misconfigured.  LLMProviderManager should define a sensible default mode (such as “standard”) to maintain service continuity.

5. **Testing** – inject a stub implementation of the strategy in unit tests.  The stub should implement the same interface but return a predetermined mode, allowing you to verify that higher‑level components react correctly without relying on external files or environment variables.

---

### Architectural patterns identified  

* **Factory Pattern** – for creating concrete resolver instances based on configuration.  
* **Strategy Pattern** – the resolver itself is a strategy that can be swapped out.  
* **Configuration‑Driven Design** – external files and env vars drive behavior.  
* **Caching / Memoization** – internal optimization to avoid repeated resolution work.

### Design decisions and trade‑offs  

* **Separation of concerns** (manager vs. resolver) improves testability but adds an extra indirection layer.  
* **Config‑first approach** gives flexibility at the cost of runtime validation complexity.  
* **In‑process caching** reduces latency but consumes memory; cache invalidation logic must be carefully managed to avoid stale modes.

### System structure insights  

The system is organized around three manager‑level components under the **LLMProviderManager** umbrella: a registry for locating providers, a lifecycle manager for bootstrapping them, and the ModeResolverStrategy for determining operational mode.  This triad enables clear responsibilities and easy extension (e.g., adding new resolver implementations without touching the registry).

### Scalability considerations  

* **Horizontal scaling** – because the resolver caches per‑process, each instance of the service maintains its own cache; this is acceptable for modest traffic but may lead to duplicated work across many pods.  A shared cache (e.g., Redis) could be introduced if cross‑instance consistency becomes a requirement.  
* **Configuration size** – the resolver’s performance is linear in the number of provider entries; using a map keyed by provider ID keeps look‑ups O(1).  Large configuration files should be parsed once at startup.

### Maintainability assessment  

The clear interface and factory abstraction make the ModeResolverStrategy easy to evolve: new resolution rules or data sources can be added by implementing a new concrete class.  The reliance on external configuration keeps the codebase small and declarative, but it also introduces a maintenance burden to keep configuration files and environment variables synchronized.  The caching layer is straightforward, but developers must remember to expose cache‑clear hooks to avoid stale data after configuration changes.  Overall, the design balances flexibility with simplicity, supporting maintainable growth as the set of providers or modes expands.


## Hierarchy Context

### Parent
- [LLMProviderManager](./LLMProviderManager.md) -- LLMProviderManager uses a provider registry to manage the different LLM providers, as seen in the provider-registry.ts file

### Siblings
- [ProviderRegistryManager](./ProviderRegistryManager.md) -- The provider-registry.ts file is expected to contain the implementation of the ProviderRegistryManager, which would define the interface for provider registration and retrieval.
- [ProviderLifecycleManager](./ProviderLifecycleManager.md) -- The ProviderLifecycleManager would be responsible for invoking the initialization and activation methods of registered providers, potentially using a template method pattern to standardize the lifecycle hooks.


---

*Generated from 3 observations*
