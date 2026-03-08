# LLMRouter

**Type:** Detail

Given the lack of specific source files, the LLMRouter's implementation details remain speculative, yet its function is inferred from the parent context.

## What It Is  

`LLMRouter` is the routing component that lives inside the **LLMServiceModule**. The only concrete location we can point to from the observations is the parent class **`LLMService`** defined in `lib/llm/llm-service.ts`. That file makes it clear that the module is responsible for *mode routing, caching, and circuit‑breaking* for every LLM operation. While the source file that declares `LLMRouter` itself is not explicitly listed, the observation *“LLMServiceModule contains LLMRouter”* tells us that the router is a sibling class or sub‑module that the `LLMService` delegates to when it needs to decide which operational mode (e.g., *chat*, *completion*, *embedding*, etc.) should handle a given request. In practice, `LLMRouter` is the decision‑making engine that maps a request’s characteristics to the appropriate downstream LLM handler.

## Architecture and Design  

The architecture exposed by the observations is a **router‑centric** design. The parent `LLMService` acts as a façade that centralises cross‑cutting concerns—caching and circuit breaking—while delegating the *mode selection* responsibility to `LLMRouter`. This separation reflects a classic **Facade + Router** pattern: the façade offers a simple, uniform API to callers, and the router encapsulates the policy for dispatching calls to concrete mode implementations.  

Because the router must handle multiple mutually exclusive modes, the design implicitly follows a **Strategy‑like** approach: each mode can be thought of as a concrete strategy that implements a common interface (e.g., `ILLMOperation`). `LLMRouter` selects the appropriate strategy at runtime based on request metadata. The observations do not mention an event‑driven or micro‑service architecture, so the design remains monolithic within the `llm` package, favouring in‑process routing over inter‑process communication.  

Interaction flow: a client invokes a method on `LLMService`; `LLMService` first checks the cache and circuit‑breaker state, then hands the request to `LLMRouter`. `LLMRouter` evaluates the request’s mode flag, selects the matching strategy object, and returns control to `LLMService`, which finally forwards the response back to the caller. This clear separation of concerns keeps the routing logic isolated from resilience and performance concerns.

## Implementation Details  

Even though the concrete source of `LLMRouter` is not provided, the surrounding code in `lib/llm/llm-service.ts` gives us strong clues about its mechanics. The `LLMService` class likely contains a private member such as `private router: LLMRouter;` that is instantiated during construction. The router’s public API probably includes a method like `route(request: LLMRequest): LLMHandler` or `selectMode(request): ModeIdentifier`.  

Inside `LLMRouter`, the core implementation would consist of a **mode‑to‑handler map**—for example, a `Map<Mode, ILLMOperation>`—populated at startup with the concrete handler classes for each supported mode. The routing algorithm would read a field (e.g., `request.mode`) and perform a lookup, falling back to a default handler if the mode is unknown. Because the parent `LLMService` already handles caching and circuit breaking, `LLMRouter` can stay lightweight, focusing solely on deterministic dispatch without side‑effects.  

The router may also expose helper methods for validating mode compatibility or for registering new modes at runtime, which would enable extensibility without touching the façade. Any error handling (e.g., “unsupported mode”) would be thrown back to `LLMService`, which can then apply its circuit‑breaker policy.

## Integration Points  

`LLMRouter` integrates tightly with three parts of the system:

1. **LLMService (parent)** – The façade that creates, owns, and calls the router. All public entry points into the LLM subsystem pass through `LLMService`, which first invokes caching/circuit‑breaker logic and then delegates to `LLMRouter`.  
2. **Mode Handlers (siblings/children)** – Concrete implementations that perform the actual LLM calls (e.g., `ChatHandler`, `CompletionHandler`). `LLMRouter` holds references to these handlers, typically via dependency injection in the module’s initialization code.  
3. **External Request Objects** – The request payloads that contain a `mode` identifier. The router’s contract expects these objects to conform to a known shape, otherwise it will reject the request.

Because the router is purely in‑process, its dependencies are limited to the handler classes and any shared type definitions (e.g., `LLMRequest`, `Mode`). No external services or message queues are referenced in the observations, reinforcing the design’s simplicity.

## Usage Guidelines  

When extending the LLM subsystem, developers should treat `LLMRouter` as the *single source of truth* for mode dispatch. Adding a new mode requires registering the corresponding handler with the router—preferably in the module’s initialization block—so that `LLMService` can automatically route to it. Do **not** bypass the router; direct calls to a handler would skip the façade’s caching and circuit‑breaker safeguards.  

If a request’s mode is ambiguous or missing, the router should raise a clear, typed error (e.g., `UnsupportedModeError`) that `LLMService` can translate into a user‑friendly response. When writing unit tests, mock the router to return a deterministic handler, allowing the façade’s resilience logic to be exercised in isolation.  

Finally, because the router’s responsibilities are limited to mode selection, keep its implementation free of side‑effects such as network I/O or state mutation. Any future performance optimisations (e.g., memoising mode look‑ups) should remain confined within the router to avoid leaking concerns into the higher‑level service.

---

### 1. Architectural patterns identified  
* Facade pattern – `LLMService` provides a unified API while encapsulating caching and circuit‑breaking.  
* Router / Dispatcher – `LLMRouter` isolates mode‑selection logic.  
* Strategy‑like selection – each mode is a concrete strategy implementing a shared interface.

### 2. Design decisions and trade‑offs  
* **Separation of concerns** – routing is decoupled from resilience logic, improving readability and testability.  
* **In‑process dispatch** – avoids the overhead of inter‑process communication but limits horizontal scaling to a single runtime instance.  
* **Extensibility via registration** – new modes can be added without modifying the façade, at the cost of a slightly larger initialization surface.

### 3. System structure insights  
* The `llm` package is organized around a central service (`LLMService`) that owns a router (`LLMRouter`) and a set of mode handlers.  
* All external callers interact only with `LLMService`; the router is an internal implementation detail.

### 4. Scalability considerations  
* Because routing is performed in‑process, scaling the overall LLM capability will rely on scaling the host process (e.g., multiple Node.js workers or container replicas). The router itself introduces negligible latency, so it does not become a bottleneck.  
* Adding more modes only grows the router’s internal map, a linear‑time lookup that remains O(1) with a hash map.

### 5. Maintainability assessment  
* High maintainability: routing logic is isolated, small, and deterministic.  
* Adding or deprecating modes is a matter of updating the registration map, without touching caching or circuit‑breaker code.  
* The lack of an explicit source file for `LLMRouter` in the observations suggests developers should document its location clearly to avoid future ambiguity.


## Hierarchy Context

### Parent
- [LLMServiceModule](./LLMServiceModule.md) -- The LLMService class in lib/llm/llm-service.ts handles mode routing, caching, and circuit breaking for all LLM operations.


---

*Generated from 3 observations*
