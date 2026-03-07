# LLMModeManager

**Type:** SubComponent

The LLMModeManager supports mock mode for testing, allowing for mock providers to be registered and used in place of real providers.

## What It Is  

`LLMModeManager` is the sub‑component that governs **which LLM provider implementation is active** for a given request.  All of its code lives in the same file that houses the high‑level LLM façade – **`lib/llm/llm-service.ts`** – and it is instantiated by its parent, **`LLMAbstraction`**.  The manager does not perform any model inference itself; instead it maintains a **registry of available “modes”** (mock, local, public) and a **switcher** that selects the appropriate mode at runtime.  By exposing a deterministic way to toggle between a mock provider used for test harnesses, a locally‑hosted model for on‑premise workloads, and a remote public provider for production, `LLMModeManager` gives the rest of the system a single, mode‑agnostic entry point for LLM calls.

## Architecture and Design  

The design of `LLMModeManager` is built around a **registry‑based architecture**.  The **`ModeRegistry`** (a child of the manager) acts as a central catalogue where each mode’s provider implementation is registered under a well‑known key.  This mirrors the pattern used by the sibling **`ProviderRegistry`**, which tracks individual LLM providers (Anthropic, OpenAI, Groq).  By separating *modes* from *providers*, the system cleanly distinguishes **“where the request is routed”** (mode) from **“which concrete service fulfills the request”** (provider).  

Switching logic is encapsulated in the **`ModeSwitcher`**.  The switcher consults the `ModeRegistry` to retrieve the currently active mode and returns the corresponding provider instance.  The switcher also observes **environment variables** to perform automatic mode selection – for example, a `LLM_MODE=mock` variable will cause the manager to activate the mock implementation without any code change.  This reflects an **environment‑driven configuration pattern**, allowing the same binary to operate in development, CI, or production simply by altering its environment.  

The **`MockModeProvider`** is a concrete implementation that satisfies the same interface as any real provider, enabling the rest of the codebase to remain oblivious to whether it is talking to a stub or a live service.  This is effectively a **Strategy pattern**: each mode supplies a strategy object (the provider) that the switcher can invoke interchangeably.  Because the manager, registry, and switcher are all located in `lib/llm/llm-service.ts`, the design remains **module‑scoped**, avoiding cross‑package dependencies while still being discoverable from the parent `LLMAbstraction`.

## Implementation Details  

* **`ModeRegistry`** – a simple in‑memory map keyed by mode name (`"mock"`, `"local"`, `"public"`).  During application start‑up, each mode registers its provider via a call such as `ModeRegistry.register('mock', new MockModeProvider())`.  The registry exposes `get(modeName)` and `list()` methods that the `ModeSwitcher` consumes.  

* **`ModeSwitcher`** – a thin façade that reads the current mode from an environment variable (e.g., `process.env.LLM_MODE`) and falls back to a default (typically `"public"`).  It invokes `ModeRegistry.get(activeMode)` and returns the provider instance.  The switcher also exposes an explicit `setMode(modeName)` API for programmatic overrides, useful in test suites that need to flip between mock and real providers on the fly.  

* **`MockModeProvider`** – implements the same public contract as the real LLM providers (e.g., a `complete(prompt: string): Promise<Response>` method).  Its implementation returns deterministic, pre‑canned responses, allowing unit tests to assert on output without network latency or quota concerns.  

* **`LLMModeManager`** – orchestrates the above pieces.  Its constructor creates a `ModeRegistry` instance, registers the three built‑in modes, and wires a `ModeSwitcher`.  It then exposes a single `getProvider(): ProviderInterface` method that downstream code (including the `LLMAbstraction` façade) calls to obtain the active provider.  Because the manager lives inside `lib/llm/llm-service.ts`, it can directly import sibling modules such as `ProviderRegistry` and `ModelCallRouter` when needed, for example to combine mode‑level routing with tier‑based routing.  

No additional symbols were discovered in the repository snapshot, but the observed file path and class names provide a clear picture of the internal wiring.

## Integration Points  

`LLMModeManager` sits directly beneath **`LLMAbstraction`**, which is the public façade exposed to the rest of the application.  When a consumer asks `LLMAbstraction` to perform a model call, the abstraction delegates to `LLMModeManager.getProvider()` to obtain the correct provider for the current mode.  The provider returned may be a **local model** (e.g., an on‑device transformer), a **public cloud endpoint** (OpenAI, Anthropic, Groq), or the **mock implementation** used in tests.  

The manager also shares the **registry concept** with its sibling **`ProviderRegistry`**, which is responsible for cataloguing the individual LLM services themselves.  In practice, a mode may reference one or more entries from `ProviderRegistry`; for instance, the *public* mode could map to the “OpenAI” provider while the *local* mode maps to a “LocalTransformer” entry.  The **`ModelCallRouter`** sibling consumes the provider returned by the mode manager and applies tier‑based routing logic (e.g., choosing a higher‑tier model for premium requests).  Thus, the mode manager provides the **first decision layer** (mock vs. local vs. public), and the router provides the **second decision layer** (which specific model within that mode).  

Environment variables constitute the primary external configuration hook.  Changing `LLM_MODE` or related flags (`LLM_LOCAL_PATH`, `LLM_PUBLIC_API_KEY`) influences the manager’s behavior without code changes, making it straightforward to integrate with CI pipelines, Docker containers, or Kubernetes ConfigMaps.

## Usage Guidelines  

1. **Prefer the façade** – Application code should never import `MockModeProvider` or interact with `ModeRegistry` directly.  Always go through `LLMAbstraction`, which internally calls `LLMModeManager.getProvider()`.  This guarantees that mode‑selection logic remains centralized.  

2. **Control mode via environment** – Set `LLM_MODE` to `mock`, `local`, or `public` at process start‑up to select the desired mode.  For automated tests, explicitly call `ModeSwitcher.setMode('mock')` before the first LLM call to avoid reliance on external environment configuration.  

3. **Register custom modes carefully** – If a new mode (e.g., “staging”) is required, extend `ModeRegistry` during application bootstrapping: `ModeRegistry.register('staging', new StagingProvider())`.  Ensure the provider implements the same interface as existing providers to keep the switcher agnostic.  

4. **Avoid mixing mode logic with routing** – Keep tier‑based routing inside `ModelCallRouter`.  The mode manager’s responsibility is solely to decide *which* provider class to use; it should not embed any business‑level routing rules.  

5. **Test with the mock provider** – Unit tests should set the mode to `mock` and rely on the deterministic responses from `MockModeProvider`.  This eliminates flaky network calls and speeds up the test suite.  When integration tests need to hit a real service, switch to `local` or `public` explicitly.  

---

### Architectural patterns identified
1. **Registry pattern** – `ModeRegistry` (and sibling `ProviderRegistry`) maintain a lookup table of named implementations.  
2. **Strategy pattern** – Each mode supplies a provider object that conforms to a common interface, allowing interchangeable execution.  
3. **Environment‑driven configuration** – Mode selection is driven by environment variables, enabling seamless deployment‑time toggling.  

### Design decisions and trade‑offs
* **Centralised mode switching** simplifies the call path but introduces a single point of failure; if the registry is mis‑configured, all downstream calls break.  
* **Mock mode as a first‑class mode** encourages testability but requires developers to maintain deterministic mock responses that stay in sync with real provider output shapes.  
* **Local vs. public separation** allows on‑premise deployments without code changes, at the cost of duplicated provider implementations (e.g., authentication handling differs between local and cloud).  

### System structure insights
* `LLMModeManager` is a **child** of `LLMAbstraction` and a **parent** to `ModeRegistry`, `ModeSwitcher`, and `MockModeProvider`.  
* It **shares the registry concept** with the sibling `ProviderRegistry`, indicating a consistent architectural language across the LLM subsystem.  
* The manager’s placement in `lib/llm/llm-service.ts` keeps all LLM‑related concerns co‑located, reducing cross‑module coupling.  

### Scalability considerations
* Adding new modes or providers scales linearly: register a new entry in `ModeRegistry` and ensure the provider implements the shared interface.  
* Because mode selection is a simple map lookup, the runtime overhead is negligible even under high request volumes.  
* If the number of providers grows dramatically, the registry could be refactored into a lazy‑loading factory to avoid loading unused providers at start‑up.  

### Maintainability assessment
* **High cohesion** – `LLMModeManager` focuses exclusively on mode selection, making the code easy to understand and modify.  
* **Low coupling** – Interaction with other subsystems occurs through well‑defined interfaces (`ProviderInterface`, environment variables), facilitating independent evolution of providers, routers, or the manager itself.  
* **Extensibility** – The registry‑based approach makes adding or removing modes straightforward, and the explicit `MockModeProvider` encourages a test‑first workflow.  
* **Potential risk** – Since the manager relies on environment variables, misconfiguration can silently select the wrong mode; adding validation at start‑up mitigates this risk.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Groq. It enables provider-agnostic model calls, tier-based routing, and mock mode for testing. The component is designed to handle different LLM modes, including mock, local, and public, and it uses a registry to manage the available providers. The LLMAbstraction component is implemented in the lib/llm/llm-service.ts file and uses various other modules, such as the provider registry, circuit breaker, and cache, to manage the LLM operations.

### Children
- [ModeRegistry](./ModeRegistry.md) -- The ModeRegistry is implemented in the lib/llm/llm-service.ts file, which suggests a modular design for mode management.
- [ModeSwitcher](./ModeSwitcher.md) -- The ModeSwitcher likely relies on the ModeRegistry to retrieve available modes, as suggested by the parent component analysis.
- [MockModeProvider](./MockModeProvider.md) -- The MockModeProvider is likely used in conjunction with the ModeRegistry and ModeSwitcher to test mode switching and management functionality.

### Siblings
- [ProviderRegistry](./ProviderRegistry.md) -- The ProviderRegistry uses a registry to manage the available providers, as seen in the lib/llm/llm-service.ts file.
- [ModelCallRouter](./ModelCallRouter.md) -- The ModelCallRouter uses a tier-based routing strategy, as seen in the lib/llm/llm-service.ts file.


---

*Generated from 5 observations*
