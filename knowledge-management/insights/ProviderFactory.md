# ProviderFactory

**Type:** Detail

The providers.json file contains the configuration settings for each registered provider, including their modes, endpoints, and authentication details, which are used by the ProviderFactory to create provider instances

## What It Is  

`ProviderFactory` lives in **ProviderFactory.java** and is the concrete implementation of the factory that creates concrete provider objects. The factory’s single public entry point is the `createProvider` method, which receives a **provider configuration** (the JSON fragment that describes a particular provider) and returns a fully‑initialised provider instance that matches the configuration’s **type** field. The configuration data that drives the factory comes from the **providers.json** file, a central catalogue that enumerates every registered provider together with its mode, endpoint URLs, and authentication credentials. `ProviderFactory` is not a stand‑alone component – it is owned by **ProviderRegistry**, which delegates the creation of providers to the factory whenever a new provider is requested.

## Architecture and Design  

The design revolves around a **Factory pattern** coupled with a **configuration‑driven registry**. `ProviderFactory` encapsulates the logic that maps a configuration’s *type* to a concrete provider class, thereby isolating the construction details from callers. This is evident from the observation that “the createProvider method … returns a provider instance based on the configuration type.” Because the mapping is driven by entries in **providers.json**, the system achieves *open‑for‑extension, closed‑for‑modification*: new provider types can be introduced simply by adding a new JSON entry, without touching Java code.  

`ProviderRegistry` acts as a higher‑level façade that holds the factory and likely maintains a lookup table of already‑created provider instances. Its relationship to `ProviderFactory` is explicit – “ProviderRegistry contains ProviderFactory” – indicating a **Registry‑Factory composition** where the registry coordinates lifecycle concerns while the factory handles instantiation. The sibling components, **ProviderConfigurationManager** (presumed to be implemented in `ProviderConfiguration.java`) and **ProviderInstanceLifecycleManager** (presumed to be `ProviderInstanceManager.java`), share the same tier of responsibility: configuration parsing/validation and lifecycle handling, respectively. Together they form a cohesive subsystem that isolates configuration, creation, and lifecycle management.

## Implementation Details  

The core of the implementation is the `createProvider` method in **ProviderFactory.java**. At runtime the method receives a configuration object that has been deserialized from **providers.json**. Internally, the method likely performs a conditional or reflective lookup based on the configuration’s `type` field, instantiating the matching provider class (e.g., `AwsProvider`, `RestProvider`, etc.). After construction, the method injects the remaining configuration values – such as `mode`, `endpoint`, and authentication credentials – into the provider instance, ensuring it is ready for immediate use.  

`providers.json` serves as the single source of truth for all provider metadata. Each entry contains keys for **mode**, **endpoint**, and **authentication**, which the factory consumes. Because the file is external to the compiled code, changes to provider definitions can be deployed without rebuilding the application, provided the JSON schema remains compatible.  

`ProviderRegistry` holds a reference to the factory and probably exposes methods such as `getProvider(String id)` that first consult an internal cache and, if absent, call `ProviderFactory.createProvider` with the appropriate configuration slice from **providers.json**. The sibling `ProviderConfigurationManager` is responsible for loading and validating the JSON file, while `ProviderInstanceLifecycleManager` deals with start/stop, health‑check, and disposal of provider objects after they are created.

## Integration Points  

- **ProviderConfigurationManager** (`ProviderConfiguration.java`): Loads **providers.json**, validates its schema, and supplies the raw configuration objects that `ProviderFactory.createProvider` consumes. This manager is the entry point for any external system that wishes to modify provider definitions.  
- **ProviderRegistry**: Acts as the consumer of `ProviderFactory`. Any component that needs a provider (e.g., request routing, data ingestion pipelines) asks the registry for an instance, thereby indirectly invoking the factory.  
- **ProviderInstanceLifecycleManager** (`ProviderInstanceManager.java`): Takes the provider instances produced by the factory and applies lifecycle hooks (initialisation, health monitoring, shutdown). The lifecycle manager may register callbacks with the provider objects, assuming they implement a common lifecycle interface.  
- **External Systems**: Because the factory’s behaviour is driven by **providers.json**, external deployment pipelines can update this file to add or reconfigure providers without touching the Java codebase. The registry will pick up the changes on the next reload cycle orchestrated by the configuration manager.

## Usage Guidelines  

When adding a new provider, developers should **only modify** **providers.json**. The entry must include a unique identifier, a `type` that matches a concrete provider class already present on the classpath, and all required fields (`mode`, `endpoint`, authentication). After committing the JSON change, the `ProviderConfigurationManager` should be triggered to reload the file so that the registry can recognise the new provider. Direct instantiation of provider classes outside the factory is discouraged; always obtain providers through `ProviderRegistry` to guarantee that configuration is applied consistently and that lifecycle hooks are correctly attached.  

If a new provider type is required that does not yet have a Java implementation, the appropriate class must be added to the codebase and registered with the factory’s internal type‑to‑class map. This is the only circumstance where code changes are needed; once the class exists, future providers of that type can be added purely via JSON.  

When updating authentication credentials or endpoint URLs, prefer editing **providers.json** rather than hard‑coding values. Ensure that any changes respect the JSON schema enforced by `ProviderConfigurationManager` to avoid runtime factory failures.  

Finally, when deprecating a provider, remove its entry from **providers.json** and, if necessary, clean up any lingering instances via `ProviderInstanceLifecycleManager` to prevent resource leaks.

---

### Architectural patterns identified  
1. **Factory Pattern** – encapsulated in `ProviderFactory.createProvider`.  
2. **Registry Pattern** – embodied by `ProviderRegistry` that stores and retrieves provider instances.  
3. **Configuration‑Driven Extensibility** – the JSON‑based provider catalogue that drives factory behaviour.

### Design decisions and trade‑offs  
- **Configuration‑only extension** reduces code churn but shifts validation responsibility to the JSON schema and the configuration manager.  
- **Centralised factory** simplifies client code but introduces a single point of failure if the type‑to‑class mapping is incorrect.  
- **Lazy creation via registry** conserves resources but may add latency on first‑use lookups.

### System structure insights  
The provider subsystem is layered:  
1. **Configuration Layer** (`ProviderConfigurationManager`) → loads JSON.  
2. **Factory Layer** (`ProviderFactory`) → creates concrete providers from config.  
3. **Registry Layer** (`ProviderRegistry`) → caches and supplies providers.  
4. **Lifecycle Layer** (`ProviderInstanceLifecycleManager`) → manages runtime state.

### Scalability considerations  
Because provider creation is driven by a flat JSON file, the system can scale to many providers as long as the file size remains manageable and parsing remains efficient. The factory’s instantiation logic is lightweight, so adding hundreds of providers does not significantly impact performance. However, extremely large configuration files may increase start‑up latency; in such cases, consider paging the JSON or sharding configurations per domain.  

### Maintainability assessment  
The design scores high on maintainability: adding or removing providers requires only JSON edits, and the factory logic remains untouched. Centralising configuration reduces duplication, and the clear separation of concerns (configuration, creation, registry, lifecycle) makes each component independently testable. The main maintenance risk lies in keeping the JSON schema synchronized with provider class expectations; robust schema validation in `ProviderConfigurationManager` mitigates this risk.


## Hierarchy Context

### Parent
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses a factory pattern in ProviderFactory.java to create instances of different provider classes based on their configurations in providers.json

### Siblings
- [ProviderConfigurationManager](./ProviderConfigurationManager.md) -- The ProviderConfigurationManager is likely implemented in a separate module or class, such as ProviderConfiguration.java, which defines the configuration settings for each provider
- [ProviderInstanceLifecycleManager](./ProviderInstanceLifecycleManager.md) -- The ProviderInstanceLifecycleManager is likely implemented in a separate module or class, such as ProviderInstanceManager.java, which defines the lifecycle methods for provider instances


---

*Generated from 3 observations*
