# LLMModeResolver

**Type:** SubComponent

The LLMModeResolver provides a callback mechanism for notifying listeners of mode changes, as implemented in the mode-listener.js module.

## What It Is  

**LLMModeResolver** is a sub‑component that lives inside the **LLMAbstraction** hierarchy. Its concrete implementation can be traced through a handful of dedicated artefacts that sit alongside the rest of the LLM stack:  

* `mode-config.json` – the static configuration file that enumerates the available LLM operating modes and the default selection.  
* `mode-transitions.ts` – a TypeScript definition of the state‑machine that governs how the resolver moves from one mode to another.  
* `logger.ts` – the shared **LLMLogger** implementation that the resolver uses to emit diagnostic events.  
* `mode-listener.js` – a JavaScript module that implements the callback (listener) registration and notification plumbing.  
* `cache-mode.js` – a lightweight caching layer that stores the most‑recently resolved mode for fast subsequent look‑ups.  

Together these files give the resolver the ability to read a declarative mode definition, apply context‑aware rules (environment variables, user preferences), transition safely between modes, broadcast changes to interested parties, and do so with minimal latency thanks to caching. The component is therefore the “decision engine” that determines which LLM behaviour should be active at any point in time.

---

## Architecture and Design  

The observations reveal a **modular, context‑aware architecture** built on several well‑known design idioms that are explicitly manifested in the code base.  

1. **State‑Machine (State Pattern)** – The `mode-transitions.ts` file encodes a finite‑state machine that defines permissible mode transitions. By externalising the transition table, the resolver can enforce valid state changes without scattering conditional logic throughout the code. This makes the mode‑transition logic both testable and extensible.  

2. **Observer (Publish‑Subscribe) Pattern** – The `mode-listener.js` module supplies a callback mechanism. Consumers register listeners, and the resolver notifies them whenever a mode change occurs. This decouples the resolver from downstream components (e.g., UI adapters, analytics) that need to react to mode updates.  

3. **Caching (Cache‑Aside) Strategy** – The `cache-mode.js` implementation stores the resolved mode after the first computation. Subsequent calls first consult the cache, falling back to the full resolution path only on a cache miss or explicit invalidation. This reduces I/O to `mode-config.json` and avoids repeated state‑machine evaluation.  

4. **Configuration‑Driven Behaviour** – The `mode-config.json` file provides a declarative source of truth for available modes, default selections, and possibly mode‑specific parameters. This separates policy from code, enabling operators to tweak behaviour without recompiling.  

5. **Centralised Logging** – By delegating all log output to the shared **LLMLogger** (via `logger.ts`), the resolver aligns with the logging strategy used by sibling components such as **LLMProviderManager** and **LLMHealthChecker**. This creates a uniform observability surface across the LLM stack.  

These patterns are woven together through **dependency injection** that is evident in the broader **LLMAbstraction** design (the parent component relies on inversion‑of‑control to supply concrete implementations of logging, caching, and configuration). The resolver therefore fits cleanly into a highly modular ecosystem where each sibling component (e.g., **LLMCachingLayer**, **LLMConfigManager**) supplies a specialised service that the resolver consumes.

---

## Implementation Details  

The resolver’s workflow can be broken down into four logical stages, each anchored to a concrete artefact:  

1. **Configuration Load** – On start‑up the resolver reads `mode-config.json`. The JSON schema defines each mode (e.g., “standard”, “debug”, “high‑throughput”) and may include metadata such as required environment variables or user‑preference keys. The loader is lightweight and runs once per process, populating an in‑memory map that the state machine later queries.  

2. **Context Evaluation** – Before deciding which mode to activate, the resolver inspects the current runtime context. This includes environment variables (e.g., `NODE_ENV`) and user‑level preferences stored elsewhere in the system. The context‑aware pattern is implemented as a series of predicate functions that annotate the configuration entries with a “score” or eligibility flag.  

3. **State‑Machine Transition** – With the candidate mode identified, the resolver consults `mode-transitions.ts`. This file exports a transition table (source‑mode → target‑mode → allowed‑conditions). The resolver validates that the requested transition complies with the table; illegal transitions trigger an error logged via **LLMLogger**. Successful transitions update an internal state holder and optionally persist the new mode back to a durable store (not shown, but implied by the need for consistency).  

4. **Notification & Caching** – After a successful transition, the resolver invokes the callback registry defined in `mode-listener.js`. All registered listeners receive the old and new mode identifiers, enabling downstream components to reconfigure themselves instantly. Simultaneously, `cache-mode.js` writes the resolved mode into a short‑lived cache (likely an in‑memory map with TTL). Subsequent `resolveMode()` calls first check this cache, bypassing steps 1‑3 unless the cache is stale or a forced refresh is requested.  

Throughout this pipeline, any anomalies—missing configuration entries, invalid transitions, cache failures—are reported through **LLMLogger** (`logger.ts`). The logger’s consistent API across the LLM ecosystem ensures that operational teams can correlate mode‑related events with provider‑level logs from **LLMProviderManager** or health checks from **LLMHealthChecker**.

---

## Integration Points  

**LLMModeResolver** sits at the intersection of several system boundaries:  

* **Parent – LLMAbstraction** – The parent component aggregates multiple sub‑components (providers, caching, logging). It injects the resolver into higher‑level services that need to know the active LLM mode, such as request routers or feature‑flag evaluators.  

* **Siblings – LLMProviderManager & LLMCachingLayer** – Provider selection often depends on the current mode (e.g., a “debug” mode might route to a mock provider). The resolver therefore supplies the active mode to **LLMProviderManager**, which can switch its registry accordingly. Likewise, **LLMCachingLayer** may adjust cache‑expiry policies based on mode, reading the resolver’s output via the listener callback.  

* **LLMLogger** – All logging calls are funneled through the shared **LLMLogger** implementation (`logger.ts`). This ensures that mode‑related logs appear alongside provider logs, health‑check logs, and configuration‑manager logs, providing a unified observability stream.  

* **LLMConfigManager** – While **LLMConfigManager** handles the broader `llm-config.json`, the resolver consumes the more focused `mode-config.json`. Both components use a similar configuration‑driven approach, which makes it straightforward to align their reload mechanisms (e.g., hot‑reloading on file change).  

* **External Listeners** – Any component that cares about mode changes can register a listener through `mode-listener.js`. Typical consumers include UI dashboards (to display the current mode), telemetry agents (to tag metrics), or security modules (to enforce stricter policies in “high‑risk” modes).  

The resolver’s public API is therefore minimal: a `resolveMode()` method, a `transitionTo(targetMode)` method, and listener registration functions. All dependencies (configuration loader, state‑machine definition, cache, logger) are injected at construction time, preserving testability and allowing alternative implementations (e.g., a mock cache) in unit tests.

---

## Usage Guidelines  

1. **Never bypass the cache** – Callers should always use the resolver’s `getCurrentMode()` (or equivalent) method rather than reading `mode-config.json` directly. The cache guarantees O(1) look‑ups and ensures that listeners are kept in sync.  

2. **Register listeners early** – Components that need to react to mode changes should subscribe via `mode-listener.js` during their initialization phase. This guarantees they receive the first transition event (including the initial mode load).  

3. **Respect the transition table** – Attempting to move to a mode that is not permitted by `mode-transitions.ts` will raise an error logged by **LLMLogger**. Developers should consult the transition definition before invoking `transitionTo()`.  

4. **Handle logging consistently** – When extending the resolver (e.g., adding custom validation), use the injected **LLMLogger** instance. This keeps mode‑related diagnostics aligned with logs from **LLMProviderManager**, **LLMHealthChecker**, and other siblings.  

5. **Prefer configuration‑driven changes** – To add a new mode or modify transition rules, edit `mode-config.json` and `mode-transitions.ts` rather than hard‑coding values. After a file change, trigger a reload through the resolver’s `reloadConfig()` method (if exposed) to pick up the new definitions without restarting the whole service.  

6. **Test with mock cache and logger** – Because the resolver’s dependencies are injected, unit tests should provide stubbed versions of `cache-mode.js` and `logger.ts`. This isolates the state‑machine logic and ensures deterministic test outcomes.  

---

### Architectural patterns identified  

1. **State Machine (State Pattern)** – defined in `mode-transitions.ts`.  
2. **Observer / Publish‑Subscribe** – callback mechanism in `mode-listener.js`.  
3. **Cache‑Aside / Lazy Caching** – implemented by `cache-mode.js`.  
4. **Configuration‑Driven Design** – `mode-config.json` supplies declarative mode definitions.  
5. **Centralised Logging** – shared **LLMLogger** via `logger.ts`.  

### Design decisions and trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| External JSON for mode definitions | Enables ops to tweak modes without code changes | Requires runtime parsing and potential cache invalidation logic |
| Explicit state‑machine file | Guarantees valid transitions and isolates policy | Adds maintenance overhead when adding new modes |
| Listener callbacks rather than polling | Immediate propagation, low latency | Slightly more complex lifecycle management for listeners |
| In‑memory cache of resolved mode | Fast reads, reduces file I/O | Cache must be invalidated on config change; risk of stale data if not handled |
| Shared logger instance | Uniform observability across LLM stack | Coupling to a global logger may hinder independent logging configurations |

### System structure insights  

* **LLMAbstraction** acts as the composition root, wiring together **LLMModeResolver**, **LLMProviderManager**, **LLMCachingLayer**, **LLMLogger**, and other siblings via dependency injection.  
* Each sibling follows a single‑responsibility focus (provider registry, response caching, health checking). **LLMModeResolver** supplies the “mode” context that many of these responsibilities depend on.  
* The file‑level separation (`*.json`, `*.ts`, `*.js`) reflects a clear boundary between static data (configuration), type‑safe transition logic (TypeScript), and runtime glue code (JavaScript listeners and cache).  

### Scalability considerations  

* **Horizontal scaling** – Because the resolved mode is cached locally, each instance of the service maintains its own cache. If mode changes must be propagated across a fleet, the listener mechanism can be extended to broadcast via a message bus (e.g., Redis Pub/Sub). The current design does not include such cross‑instance sync, so large deployments should augment it.  
* **Configuration size** – `mode-config.json` is expected to remain small (a handful of modes). If the number of modes grows dramatically, parsing overhead could increase, suggesting a move to a more performant store (e.g., a key‑value DB).  
* **Transition latency** – State‑machine evaluation is O(1) given a pre‑computed transition map, so even high‑frequency mode changes will not become a bottleneck. The cache further shields the system from repeated evaluations.  

### Maintainability assessment  

* **High maintainability** – The separation of concerns (config, state machine, cache, listeners, logging) makes each piece independently testable and replaceable.  
* **Clear contract** – The resolver exposes a small, well‑defined API (resolve, transition, register listener). This limits surface area for bugs.  
* **Documentation‑friendly** – All critical behaviour is declared in JSON or TypeScript files, which are easy to read and version‑control.  
* **Potential risk** – The reliance on file‑based configuration means that deployment pipelines must ensure the latest `mode-config.json` and `mode-transitions.ts` are packaged together. Missing or mismatched files could cause runtime errors that are only visible through **LLMLogger**.  

Overall, **LLMModeResolver** is a well‑encapsulated, context‑aware decision component that leverages proven patterns (state machine, observer, caching) to provide fast, reliable mode resolution within the broader, modular **LLMAbstraction** ecosystem.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The component's architecture is designed to be highly modular and extensible, with a range of interfaces and abstract classes that enable easy integration of new providers and services. The use of dependency injection and inversion of control patterns further enhances the component's flexibility and maintainability, making it an essential part of the larger Coding project ecosystem.

### Siblings
- [LLMProviderManager](./LLMProviderManager.md) -- LLMProviderManager uses a provider registry to store and manage available LLM providers, as seen in the provider-registry.yaml file.
- [LLMCachingLayer](./LLMCachingLayer.md) -- The LLMCachingLayer class uses a caching library (cache-lib.js) to store and retrieve LLM responses.
- [LLMLogger](./LLMLogger.md) -- The LLMLogger class uses a logging library (logger-lib.js) to log LLM-related events and errors.
- [LLMProviderRegistry](./LLMProviderRegistry.md) -- The LLMProviderRegistry class uses a registry file (providers.json) to store and manage available LLM providers.
- [LLMConfigManager](./LLMConfigManager.md) -- The LLMConfigManager class uses a configuration file (llm-config.json) to store and manage LLM configuration settings.
- [LLMHealthChecker](./LLMHealthChecker.md) -- The LLMHealthChecker class uses a health checking mechanism to monitor the status of LLM components, as defined in the health-checking.ts file.


---

*Generated from 6 observations*
