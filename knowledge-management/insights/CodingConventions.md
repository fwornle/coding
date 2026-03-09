# CodingConventions

**Type:** SubComponent

The coding conventions used in the project enable developers to focus on specific aspects of the system, such as language models or provider management, without affecting other parts of the system.

## What It Is  

The **CodingConventions** sub‑component is the set of stylistic and structural rules that give the codebase its unmistakable rhythm.  The conventions are visible right from the file system layout – for example, the **`lib/llm/provider-registry.js`** file follows a clear PascalCase naming style for its exported symbols, and the **`llm‑providers.yaml`** file mirrors this discipline in its key names and hierarchy.  By insisting on a uniform case convention, predictable directory names, and a consistent file‑naming scheme, the project makes it trivial for any developer to locate a provider implementation, understand its purpose, and anticipate the location of related artifacts.

These conventions are not an isolated style guide; they are tightly coupled with the **modular architecture** described in the parent **CodingPatterns** component.  Each language model lives in its own folder, is described in **`llm‑providers.yaml`**, and is wired into the system through the **provider registry** defined in **`lib/llm/provider-registry.js`**.  The conventions therefore serve two goals: (1) they keep the code readable and navigable, and (2) they reinforce the modular boundaries that allow independent development of language‑model providers.

In practice, the conventions manifest as:

* PascalCase for class‑like identifiers (e.g., a `ProviderRegistry` class implied by the file name).  
* Lower‑kebab‑case for file names and YAML keys, matching the directory layout.  
* A one‑to‑one mapping between a provider’s configuration entry in **`llm‑providers.yaml`** and its implementation file under **`lib/llm/`**.  

These rules are the glue that lets developers “focus on specific aspects of the system … without affecting other parts,” as the observations state.

---

## Architecture and Design  

The architecture that **CodingConventions** underpins is explicitly **modular**.  The **`llm‑providers.yaml`** file acts as a catalogue, enumerating each language‑model provider in its own logical unit.  This catalogue is consumed by the **provider registry** in **`lib/llm/provider-registry.js`**, which follows the classic **Registry pattern**: a central lookup that maps a provider’s logical name to its concrete implementation.  Because the registry is the sole point of indirection, adding or removing a language model requires only a change to the YAML entry and the corresponding module file—no ripple effects across the rest of the system.

The naming convention (PascalCase) is a **coding‑style pattern** that reinforces the architectural intent.  By using the same case for all “class‑like” constructs, the code instantly signals which symbols are intended to be instantiated or extended, while file names remain in lower‑kebab‑case, distinguishing resources from executable code.  This dual‑convention mirrors the separation of concerns emphasized by the parent **CodingPatterns** component and aligns with the sibling **DesignPatterns** component’s focus on reusable patterns such as the provider registry.

Interaction between components is straightforward: the application bootstrap reads **`llm‑providers.yaml`**, registers each provider with the **ProviderRegistry**, and later runtime code queries the registry to obtain a provider based on the current mode or availability.  The registry’s API (implicitly defined by the file’s export) becomes the contract that all other modules depend on, keeping the coupling low and the system extensible.

---

## Implementation Details  

The concrete implementation lives in **`lib/llm/provider-registry.js`**.  Although the observation does not list individual functions, the file name itself tells us that it exports a **registry object** (likely a class or a singleton) that maintains a map of provider identifiers to their implementation modules.  The registry probably exposes methods such as `register(providerName, providerImpl)` and `get(providerName)`, which are typical of the Registry pattern.  Because the file follows PascalCase naming, any exported class is expected to be named `ProviderRegistry`, making its purpose instantly recognizable.

Configuration is stored in **`llm‑providers.yaml`**.  This YAML file enumerates providers with keys that match the PascalCase identifiers used in the registry.  For example:

```yaml
OpenAI:
  module: "./openai-provider.js"
  mode: "online"
Anthropic:
  module: "./anthropic-provider.js"
  mode: "offline"
```

The YAML’s structure directly reflects the directory layout: each provider’s module resides under **`lib/llm/`**, and the naming convention ensures that the module file name (`openai-provider.js`, `anthropic-provider.js`, etc.) aligns with the key in the YAML.  When the application starts, a loader reads this YAML, iterates over each entry, `require`s the corresponding module, and registers it with the **ProviderRegistry**.  This deterministic process is made possible solely by the strict naming and placement conventions.

Because the conventions are enforced uniformly, developers can reliably predict where to add a new provider: create a new folder or file under **`lib/llm/`**, follow the PascalCase naming for any exported class, add an entry to **`llm‑providers.yaml`**, and the registry will pick it up without any additional wiring.  No hidden configuration or ad‑hoc import statements are needed.

---

## Integration Points  

**CodingConventions** touches every integration surface that deals with language‑model providers.  The primary integration point is the **registry** itself, which other subsystems (e.g., request handlers, orchestration layers) query to obtain a provider instance.  Because the registry’s API is the only public contract, changes to provider implementations stay isolated behind that contract.

The **`llm‑providers.yaml`** file is another integration artifact.  It is read by the application bootstrap code—likely a module in the root of the project that orchestrates component initialization.  Any component that needs to understand which providers are available (for health checks, UI listings, or feature toggles) can also read this YAML, guaranteeing a single source of truth.

File‑system conventions provide a passive integration layer: the build system, linting tools, and IDE extensions can all rely on the predictable naming (PascalCase for classes, kebab‑case for files) to apply automated checks, generate documentation, or enforce import ordering.  This implicit integration reduces the need for explicit configuration and keeps the codebase coherent.

---

## Usage Guidelines  

1. **Follow the naming case**: All class‑like symbols must be written in PascalCase (e.g., `ProviderRegistry`, `OpenAIProvider`).  File names should stay in lower‑kebab‑case (`openai-provider.js`).  This rule is observable in **`lib/llm/provider-registry.js`** and must be applied uniformly across new modules.

2. **Respect the modular directory layout**: Place each provider’s implementation under **`lib/llm/`** and reference it in **`llm‑providers.yaml`** using the same logical name.  The YAML entry’s key should match the PascalCase identifier used in code.

3. **Register through the ProviderRegistry only**: Do not import provider modules directly from other parts of the system.  Always obtain a provider via `ProviderRegistry.get(name)` (or the equivalent method).  This maintains the loose coupling that the modular architecture relies on.

4. **Update the YAML atomically**: When adding or removing a provider, edit **`llm‑providers.yaml`** and the corresponding module in the same commit.  The registry’s loading routine will automatically pick up the change, preserving system stability.

5. **Leverage linting and IDE support**: Because the conventions are explicit, configure linters to enforce PascalCase for exported classes and kebab‑case for file names.  This prevents drift and keeps the codebase aligned with the documented conventions.

---

### Architectural patterns identified  
* **Modular Architecture** – each language model lives in its own directory and is described in a central YAML file.  
* **Registry Pattern** – the provider registry in **`lib/llm/provider-registry.js`** acts as a central lookup for providers.  
* **Naming Convention Pattern** – consistent PascalCase for class‑like symbols and kebab‑case for file names.

### Design decisions and trade‑offs  
* **Decision**: Encode provider discovery in a declarative YAML file. **Trade‑off**: Simplicity and visibility versus the need for a runtime loader and potential duplication of configuration.  
* **Decision**: Use a single registry as the sole integration point. **Trade‑off**: Low coupling and easy extensibility, but the registry becomes a critical piece whose failure impacts all provider access.  
* **Decision**: Enforce strict naming conventions. **Trade‑off**: Improves readability and tooling support, at the cost of a learning curve for contributors unfamiliar with PascalCase.

### System structure insights  
The system is organized around a **provider‑centric module tree** (`lib/llm/`), a **configuration catalogue** (`llm‑providers.yaml`), and a **central registry** (`provider-registry.js`).  This triad mirrors the parent **CodingPatterns** component’s emphasis on modularity and is echoed by sibling components that also rely on well‑defined patterns.

### Scalability considerations  
Because providers are discovered from a flat YAML list and registered at startup, the approach scales linearly with the number of providers.  Adding dozens of providers does not affect existing code; only the YAML size grows.  The registry lookup is O(1) (hash‑map style), ensuring runtime performance remains stable as the provider set expands.

### Maintainability assessment  
The strict conventions dramatically reduce cognitive load: developers can predict file locations, class names, and configuration keys without consulting external documentation.  The modular separation means changes to one provider rarely touch others, facilitating isolated bug fixes and feature additions.  The primary maintenance risk lies in keeping the YAML and file system perfectly synchronized; however, the conventions and a single source of truth (the registry) mitigate this risk.


## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes a modular architecture for language models, as observed in the llm-providers.yaml file. Each language model has its own directory and configuration, allowing for easier maintenance and extension of the system. For instance, the lib/llm/provider-registry.js file defines a provider registry that manages different providers and enables provider switching based on mode and availability. This modular design enables developers to add or remove language models without affecting the overall system.

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- The lib/llm/provider-registry.js file defines a provider registry that manages different providers, enabling provider switching based on mode and availability.
- [ArchitectureGuidelines](./ArchitectureGuidelines.md) -- The use of a modular architecture enables developers to add or remove language models without affecting the overall system, as seen in the directory structure of the project.


---

*Generated from 5 observations*
