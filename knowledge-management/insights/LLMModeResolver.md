# LLMModeResolver

**Type:** SubComponent

LLMModeResolver utilizes a caching mechanism in lib/llm/llm-cache.ts to improve performance by reducing the number of requests made to the LLM providers.

## What It Is  

`LLMModeResolver` is a **sub‑component** that lives in the `lib/llm` package of the code‑base. Its primary source files are  

* `lib/llm/llm-mode-config.ts` – defines the **global LLM mode** configuration that applies when no overrides are present.  
* `lib/llm/llm-mode-resolver.ts` – the concrete `LLMModeResolver` class that performs mode resolution for a given agent.  
* `lib/llm/llm-legacy‑flags.ts` – implements handling of **legacy flag** values that may still be supplied by older callers.  
* `lib/llm/llm‑agent‑config.ts` – supplies per‑agent configuration data that the resolver consults when an override is required.  
* `lib/llm/llm‑cache.ts` – provides a **caching layer** used by the resolver to avoid unnecessary LLM provider calls.  
* `lib/llm/llm‑logging.ts` – offers a **logging facility** for tracing mode‑resolution events.  

Together, these files give `LLMModeResolver` the responsibility of determining which LLM “mode” (e.g., `standard`, `fast`, `high‑quality`, etc.) should be used for a particular request, respecting a hierarchy of defaults, per‑agent overrides, and legacy flag compatibility, while also optimizing performance through caching and observability via logging.

---

## Architecture and Design  

The design of `LLMModeResolver` follows a **layered, composition‑based architecture** anchored in the broader `LLMAbstraction` component. The resolver does not stand alone; it is a child of `LLMAbstraction`, which itself is built around the `LLMService` façade (`lib/llm/llm-service.ts`). `LLMService` orchestrates **mode routing**, **caching**, **circuit breaking**, **budget checks**, and **provider fallback**, exposing a single entry point for all LLM interactions.  

`LLMModeResolver` adopts a **configuration‑driven strategy**: a global mode (`llm-mode-config.ts`) supplies the default, while `llm-agent-config.ts` allows agents to declare explicit overrides. The resolver therefore implements a **strategy selection pattern** where the effective mode is chosen based on the most specific configuration available.  

Legacy compatibility is handled through a dedicated module (`llm-legacy-flags.ts`). By isolating legacy flag translation, the resolver keeps the main resolution logic clean and future‑proofs the component against deprecation.  

Performance and observability are injected via **decorator‑style composition**: the resolver calls into `llm-cache.ts` before performing any expensive computation or remote request, and it records each decision through `llm-logging.ts`. This mirrors the responsibilities of the sibling components—`LLMCachingMechanism` and `LLMLoggingMechanism`—which also rely on the same cache and logging libraries, ensuring a consistent cross‑cutting concern implementation across the `LLMAbstraction` family.  

Overall, the architecture emphasizes **separation of concerns**, **configurability**, and **reuse of shared infrastructure** (caching, logging) without introducing unnecessary coupling.

---

## Implementation Details  

The core class, `LLMModeResolver` (found in `lib/llm/llm-mode-resolver.ts`), exposes a public method—typically something like `resolveMode(agentId: string): LLMMode`. The method follows these steps:

1. **Legacy Flag Normalization** – It first checks `llm-legacy-flags.ts` for any legacy flag values attached to the request. If present, those flags are mapped to the modern mode identifiers, ensuring backward compatibility.  

2. **Cache Lookup** – Before computing the mode, the resolver queries `llm-cache.ts`. The cache key is derived from the agent identifier and any relevant request metadata. A cache hit short‑circuits the resolution path, returning the stored mode instantly.  

3. **Agent‑Specific Override** – If the cache misses, the resolver reads the agent’s configuration from `llm-agent-config.ts`. This file contains a map of agent identifiers to explicit mode settings. When an entry exists, it takes precedence over the global default.  

4. **Global Default Fallback** – Absent an agent override, the resolver falls back to the global configuration defined in `llm-mode-config.ts`. This file typically exports a constant or a simple getter that supplies the system‑wide default mode.  

5. **Logging** – Regardless of the source (legacy flag, cache, agent config, or global default), the resolver logs the resolution event via `llm-logging.ts`. The log entry includes the agent ID, the resolved mode, and the resolution path (e.g., “cache hit”, “agent override”, “global default”).  

6. **Cache Population** – After a successful resolution (when the result was not retrieved from cache), the resolver stores the computed mode back into `llm-cache.ts` for future requests.  

Because `LLMModeResolver` is a child of `LLMAbstraction`, it is instantiated and injected by the `LLMService` façade. `LLMService` may pass in shared instances of the cache and logger, enabling **dependency injection** and allowing the resolver to be swapped or mocked in tests without altering its internal logic.

---

## Integration Points  

`LLMModeResolver` sits at the intersection of several system concerns:

* **Parent Integration** – It is invoked by `LLMService` (`lib/llm/llm-service.ts`), which acts as the high‑level façade for all LLM operations. `LLMService` delegates mode‑routing decisions to the resolver, then proceeds with provider selection, circuit‑breaker checks, and budget enforcement.  

* **Sibling Collaboration** – Both `LLMCachingMechanism` and `LLMLoggingMechanism` expose the same caching (`llm-cache.ts`) and logging (`llm-logging.ts`) libraries that the resolver consumes. This shared usage guarantees that cache invalidation policies and log formatting remain consistent across the entire LLM stack.  

* **Provider Manager** – `LLMProviderManager` (a sibling component) relies on the mode resolved by `LLMModeResolver` to decide which provider implementation (Anthropic, OpenAI, Groq, etc.) should handle the request. The resolved mode can influence provider‑specific parameters such as temperature or token limits.  

* **Configuration Sources** – The resolver reads from two configuration files: the global mode config (`llm-mode-config.ts`) and the per‑agent config (`llm-agent-config.ts`). These files are typically generated or updated by deployment scripts or admin UI tools, meaning that the resolver’s behavior can be altered without code changes.  

* **Legacy Compatibility Layer** – Calls that still pass old flag names are automatically translated by `llm-legacy-flags.ts`, allowing legacy clients to continue operating while newer code uses the modern mode API.  

Through these integration points, `LLMModeResolver` acts as a **thin, deterministic decision engine** that feeds higher‑level orchestration components with the correct operational mode while staying insulated from provider‑specific logic.

---

## Usage Guidelines  

1. **Prefer Agent‑Level Overrides** – When a specific agent requires a non‑default mode (e.g., a research‑heavy bot needing `high‑quality`), define the override in `llm-agent-config.ts`. The resolver will automatically prioritize this over the global setting.  

2. **Do Not Bypass Caching** – The resolver’s internal cache dramatically reduces repeated mode lookups for the same agent. Custom code should rely on the resolver’s public API rather than re‑implementing mode selection, to keep cache semantics intact.  

3. **Maintain Legacy Flag Compatibility** – If you must support older callers, continue to supply legacy flags; the resolver will map them appropriately. However, plan to migrate to the modern mode API to avoid future deprecation.  

4. **Log Interpretation** – The logs emitted by `llm-logging.ts` include the resolution path. Use these logs for troubleshooting mode‑selection issues; a “cache miss” followed by “global default” indicates that no agent‑specific configuration exists.  

5. **Dependency Injection** – When testing components that depend on `LLMModeResolver`, inject mock implementations of the cache and logger. This keeps unit tests fast and deterministic while still exercising the resolution logic.  

6. **Configuration Updates** – Changes to `llm-mode-config.ts` or `llm-agent-config.ts` take effect on the next resolver invocation; no service restart is required. Ensure that configuration files are version‑controlled and validated before deployment to avoid inconsistent mode states.

---

### Architectural patterns identified
* **Configuration‑driven strategy selection** – global defaults + per‑agent overrides.  
* **Decorator‑style composition** – caching and logging are layered around the core resolution logic.  
* **Legacy‑flag adaptation** – a façade that translates older inputs to the current model.  
* **Dependency injection** – `LLMService` injects shared cache and logger instances into the resolver.  

### Design decisions and trade‑offs
* **Explicit override hierarchy** provides clear precedence but adds a small lookup cost (agent config → global config).  
* **Separate legacy flag module** isolates backward‑compatibility concerns, at the expense of an extra translation step.  
* **In‑process caching** improves latency but requires careful cache invalidation policies; the design assumes mode decisions are relatively static per agent.  
* **Centralized logging** aids observability but can generate high log volume in high‑throughput environments; log levels should be configurable.  

### System structure insights
* `LLMModeResolver` is a child of `LLMAbstraction` and is invoked by the façade `LLMService`.  
* It shares cross‑cutting concerns (cache, logging) with sibling components `LLMCachingMechanism` and `LLMLoggingMechanism`.  
* The resolver’s output directly influences `LLMProviderManager`, tying mode decisions to provider selection.  

### Scalability considerations
* The cache (`llm-cache.ts`) is the primary scalability lever; a well‑tuned cache can keep mode‑resolution latency sub‑millisecond even under heavy load.  
* Because resolution is read‑only and stateless beyond the cache, the resolver can be instantiated in multiple service instances without coordination, supporting horizontal scaling.  
* Legacy flag handling adds negligible overhead; however, if legacy usage spikes, the translation step could become a minor bottleneck, suggesting the need for deprecation.  

### Maintainability assessment
* **High maintainability** – clear separation of concerns (config, legacy handling, caching, logging) makes each piece testable and replaceable.  
* **Configuration‑centric** – most behavior changes are driven by data files, reducing the need for code changes.  
* **Shared infrastructure** – reliance on common cache and logging libraries ensures consistent behavior but also means changes to those libraries affect all siblings, requiring coordinated updates.  
* **Documentation focus** – because the resolver’s logic is spread across several small modules, comprehensive documentation of the precedence rules and cache key schema is essential to avoid misuse.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's architecture is designed with flexibility and maintainability in mind, utilizing dependency injection to manage the various Large Language Model (LLM) providers, including Anthropic, OpenAI, and Groq. This is evident in the LLMService class, located in lib/llm/llm-service.ts, which acts as a high-level facade for handling mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback. The use of dependency injection allows for easy swapping of providers, making it simpler to add or remove providers as needed. Furthermore, the LLMService class provides a single public entry point for all LLM operations, making it easier for developers to interact with the component.

### Siblings
- [LLMProviderManager](./LLMProviderManager.md) -- LLMProviderManager uses the LLMService class in lib/llm/llm-service.ts to handle mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback.
- [LLMCachingMechanism](./LLMCachingMechanism.md) -- LLMCachingMechanism uses a caching library in lib/llm/llm-cache.ts to store and retrieve cached responses.
- [LLMLoggingMechanism](./LLMLoggingMechanism.md) -- LLMLoggingMechanism uses a logging library in lib/llm/llm-logging.ts to log events and errors.


---

*Generated from 6 observations*
