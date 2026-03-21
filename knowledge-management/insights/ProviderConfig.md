# ProviderConfig

**Type:** Detail

The ProviderConfig class in provider-config.ts defines the configuration structure for each LLM provider, allowing the ProviderRegistry in provider-registry.ts to manage providers in a flexible and provider-agnostic manner.

## What It Is  

**ProviderConfig** is the concrete type‑level definition that describes how an individual Large Language Model (LLM) provider is configured inside the codebase. The class lives in **`provider-config.ts`**, and its shape is consumed by the **`ProviderRegistry`** implementation found in **`lib/llm/provider-registry.js`**. The registry treats each provider as a pluggable unit; the configuration object supplied by **ProviderConfig** supplies the provider‑specific credentials (for example the `ANTHROPIC_API_KEY` documented in the project’s README) and any other options required to initialise the underlying client. Because the registry is provider‑agnostic, **ProviderConfig** is the single source of truth for the “what” each provider needs, while the registry is the “how” those configurations are managed at runtime.

## Architecture and Design  

The architecture follows a **registry‑based, provider‑agnostic composition** pattern. The **ProviderRegistry** acts as a central catalogue that maps a provider identifier (e.g., “anthropic”, “openai”, “copi”) to a concrete implementation. Each entry in that catalogue is described by an instance of **ProviderConfig**. This separation of concerns mirrors a classic **Factory**‑style design: the registry knows *when* to create a provider, but the **ProviderConfig** tells the registry *what* data is required for that creation.

Observations of multiple integration READMEs (e.g., `integrations/browser-access/README.md`, `integrations/copi/README.md`) indicate that the system is expected to support a heterogeneous set of providers, each with its own set of environment variables or secret keys. By centralising those details in **ProviderConfig**, the code avoids scattering provider‑specific logic throughout the codebase. The design also encourages **extensibility**: adding a new provider only requires defining a new **ProviderConfig** shape and registering it with the **ProviderRegistry**, without touching the core registry logic.

## Implementation Details  

The **`provider-config.ts`** file declares a TypeScript class (or interface) named **ProviderConfig**. Its fields capture the minimal configuration required for a provider to operate—most notably API keys such as `ANTHROPIC_API_KEY`. Because the source observation mentions “the ProviderConfig class … defines the configuration structure for each LLM provider,” we can infer that the class likely contains properties like `apiKey: string`, `endpoint?: string`, and possibly a `providerName: string` identifier.  

The **`lib/llm/provider-registry.js`** module imports **ProviderConfig** and stores a collection (e.g., a `Map` or plain object) keyed by provider name. When a consumer requests a provider instance, the registry looks up the corresponding **ProviderConfig**, validates that required fields are present (e.g., ensuring `ANTHROPIC_API_KEY` is defined for the Anthropic provider), and then forwards that configuration to the concrete provider implementation (which may reside in sibling modules not listed in the observations). The registry’s “provider‑agnostic” phrasing suggests that it does not contain provider‑specific branching logic; instead, it delegates to provider factories that each understand how to consume a **ProviderConfig**.

## Integration Points  

**ProviderConfig** sits at the intersection of three major system zones:

1. **Environment / Secrets Layer** – The presence of `ANTHROPIC_API_KEY` in documentation signals that the configuration class reads values from environment variables or a secret store. This makes **ProviderConfig** the bridge between external credential management and internal provider usage.  

2. **ProviderRegistry (Parent)** – As the parent component, the registry consumes **ProviderConfig** instances to populate its internal catalogue. The registry’s API likely exposes methods such as `register(providerName, config)` and `getProvider(providerName)`.  

3. **Integration Modules (Siblings/Children)** – Integration READMEs (browser‑access, copi, etc.) describe concrete use‑cases that rely on a particular provider. Those integration modules import the registry, which in turn supplies a ready‑to‑use provider instance configured via **ProviderConfig**. Thus, any new integration only needs to reference the registry; the underlying configuration details remain encapsulated.

No additional external libraries are mentioned, so the integration surface appears limited to standard Node.js/TypeScript mechanisms for environment handling and module resolution.

## Usage Guidelines  

When adding or updating a provider, developers should create or modify a **ProviderConfig** definition in `provider-config.ts`. All required keys (e.g., `ANTHROPIC_API_KEY`) must be documented in the project’s README and sourced from a secure location (environment variable, secret manager). After defining the configuration, the provider should be registered with **ProviderRegistry** using a clear, unique identifier. Because the registry is provider‑agnostic, avoid embedding provider‑specific conditionals inside the registry; instead, keep such logic inside the provider’s own factory or client wrapper.

Consistent naming conventions are important: the provider name used in the registry key should match the identifier referenced in integration READMEs to avoid mismatches. When writing new integration modules (e.g., a new `integrations/xyz/README.md`), reference the registry’s `getProvider` method rather than constructing a provider directly; this ensures that any future changes to configuration handling remain transparent to the integration.

---

### Architectural patterns identified  
* Registry / Service Locator pattern – central catalogue (`ProviderRegistry`) that resolves providers.  
* Factory‑like separation – **ProviderConfig** supplies data; provider factories consume it.  

### Design decisions and trade‑offs  
* **Provider‑agnostic registry** improves extensibility but places the burden of accurate configuration on the **ProviderConfig** definition.  
* Centralising API keys in **ProviderConfig** simplifies secret management but requires disciplined environment handling to avoid leaking credentials.  

### System structure insights  
* Hierarchy: `ProviderRegistry` (parent) → `ProviderConfig` (child) → concrete provider implementations (grandchildren).  
* Sibling integrations consume the registry, not the config directly, preserving a clean separation of concerns.  

### Scalability considerations  
* Adding new providers scales linearly: only a new **ProviderConfig** entry and registration step are needed.  
* Because the registry stores configurations in memory, the approach remains performant for the typical number of LLM providers (single‑digit to low‑double‑digit).  

### Maintainability assessment  
* High maintainability: configuration schema lives in a single file, making updates straightforward.  
* The explicit link between environment variables (e.g., `ANTHROPIC_API_KEY`) and the config class reduces hidden dependencies, aiding code reviews and audits.  

*No diagram images were provided in the source observations; therefore none are embedded.*

## Hierarchy Context

### Parent
- [ProviderRegistry](./ProviderRegistry.md) -- The ProviderRegistry class (lib/llm/provider-registry.js) uses a provider-agnostic approach to manage LLM providers.

---

*Generated from 3 observations*
