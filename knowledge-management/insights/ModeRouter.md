# ModeRouter

**Type:** Detail

Although no source files are available, the parent analysis suggests that ModeRouter plays a crucial role in handling incoming requests.

## What It Is  

**ModeRouter** is a logical component that lives inside the **LLMService** sub‑system. The only concrete location we can reference is the parent class `LLMService` defined in `lib/llm/llm-service.ts`. Within that file the service “handles incoming requests and delegates the work to the corresponding provider,” and the documentation explicitly calls out **ModeRouter** as a suggested *L3 node* of the LLMService. In practice, ModeRouter therefore acts as the routing layer that decides, for each incoming request, which concrete LLM provider (e.g., OpenAI, Anthropic, local model) should process the call. Because no source files for ModeRouter are present, the description is built entirely on the parent‑child relationship that the observations expose.

---

## Architecture and Design  

The architecture surrounding ModeRouter follows a **router‑delegation** style. The parent `LLMService` receives raw requests (HTTP, RPC, or internal calls) and immediately forwards them to ModeRouter, which then selects the appropriate provider implementation. This is a classic *Router* pattern: a thin, decision‑making façade that isolates request handling from the business logic of each provider.  

From the observation that ModeRouter is a “suggested L3 node,” we can infer a **layered architecture**:  
* **L1 – Transport layer** (network or message‑bus handling) – not described but implied by “incoming requests.”  
* **L2 – Service façade** – the `LLMService` class that centralises entry points.  
* **L3 – Routing layer** – ModeRouter, which maps request characteristics (model name, mode flag, configuration) to a concrete provider.  

The delegation from LLMService to ModeRouter also hints at a **Strategy**‑like decision point: each provider implements a common interface (e.g., `generate`, `chat`, `embed`), and ModeRouter picks the concrete strategy at runtime. This keeps the service open for extension (adding new providers) while remaining closed for modification of the routing logic.

Because the only concrete file path we have is `lib/llm/llm-service.ts`, the design keeps the router tightly coupled to the service’s public API but decoupled from the provider implementations themselves. This separation supports independent evolution of routing rules and provider code.

---

## Implementation Details  

The observations do not provide a concrete class definition for ModeRouter, so the implementation details are inferred from its role in the LLMService hierarchy:

1. **Entry Point** – `LLMService` likely calls a method such as `this.modeRouter.route(request)` after initial validation. The router receives a request object that contains at least a *mode* identifier (e.g., “chat”, “completion”, “embedding”) and possibly a *provider* hint.  

2. **Routing Logic** – Inside ModeRouter, a lookup table or a series of conditional branches maps the mode/provider pair to a concrete provider instance. The provider instances are probably registered during application bootstrap (e.g., via a dependency‑injection container or a simple registry object).  

3. **Provider Delegation** – Once the correct provider is identified, ModeRouter forwards the request to the provider’s implementation, returning the provider’s response back up to LLMService. This hand‑off is likely a thin `await provider.handle(request)` call, preserving async flow.  

4. **Error Handling** – Because ModeRouter sits at the decision boundary, it is a natural place for “unknown mode” or “unsupported provider” errors. The router would raise a domain‑specific exception that LLMService can translate into an appropriate HTTP status or RPC error code.  

5. **Extensibility Hooks** – The router may expose a registration API (e.g., `register(mode: string, provider: Provider)`) that other modules can call to plug in new providers without touching the core service code. This aligns with the “suggested L3 node” phrasing, indicating that ModeRouter is intended to be a stable extension point.

No concrete symbols are listed in the “Code Structure” section, so the above mechanics remain speculative but are fully consistent with the documented relationship between LLMService and ModeRouter.

---

## Integration Points  

ModeRouter sits directly beneath **LLMService** (`lib/llm/llm-service.ts`). Its primary integration points are:

* **Upstream – LLMService**: LLMService hands off the request object after initial parsing. The router therefore depends on the request schema defined by LLMService (fields like `mode`, `modelId`, `payload`).  

* **Downstream – Provider Implementations**: Each provider (e.g., `OpenAIProvider`, `AnthropicProvider`, `LocalModelProvider`) implements a shared interface that ModeRouter expects. The router does not need to know provider internals; it only requires the interface contract.  

* **Configuration / Registry**: Somewhere in the startup code (likely a module that wires the application) provider instances are registered with ModeRouter. This registration is the only external dependency ModeRouter has beyond the request object.  

* **Error Propagation**: Exceptions generated by providers travel back through ModeRouter to LLMService, which then formats them for the client layer (HTTP response, gRPC status, etc.).  

Because no additional files are listed, we cannot point to exact import statements, but the integration flow is clear from the hierarchy: request → LLMService → ModeRouter → Provider → response.

---

## Usage Guidelines  

1. **Do not bypass ModeRouter** – All LLM‑related calls should be funneled through `LLMService`. Directly invoking a provider circumvents the routing logic and can lead to inconsistent behavior.  

2. **Register providers at application start** – If you add a new LLM provider, use the router’s registration API (if exposed) during the bootstrapping phase. This ensures the router can resolve the new mode/provider pair.  

3. **Respect the request contract** – The request object passed to LLMService must contain the fields expected by ModeRouter (e.g., `mode`). Missing or malformed fields will trigger routing errors.  

4. **Handle routing errors gracefully** – When ModeRouter cannot find a matching provider, it will raise an error that propagates up to LLMService. Consumers should be prepared to catch these errors and translate them into user‑friendly messages.  

5. **Keep routing rules simple** – Because ModeRouter is the single point of decision, complex conditional logic should be avoided. If routing becomes sophisticated (e.g., feature flags, A/B testing), consider extracting that logic into a separate policy module that the router can call, preserving the router’s thin façade role.

---

### Summary of Requested Items  

1. **Architectural patterns identified**  
   * Router (request‑to‑provider delegation)  
   * Layered architecture (L1 transport → L2 LLMService → L3 ModeRouter)  
   * Strategy (provider as interchangeable algorithm)  

2. **Design decisions and trade‑offs**  
   * Centralising routing in ModeRouter isolates provider selection, improving extensibility but adds a single point of failure if routing logic is buggy.  
   * Thin delegation keeps LLMService simple, but any routing complexity must be managed inside ModeRouter, which could grow large if not modularised.  

3. **System structure insights**  
   * `lib/llm/llm-service.ts` is the entry façade; ModeRouter is the immediate child responsible for mode‑based dispatch.  
   * Providers are sibling components to ModeRouter (not children) that implement a common contract.  

4. **Scalability considerations**  
   * Adding new providers does not affect LLMService or existing routing paths; only the registration table grows.  
   * If routing decisions become computationally heavy (e.g., evaluating feature flags), caching the resolution per request type can keep latency low.  

5. **Maintainability assessment**  
   * The clear separation between request handling (LLMService) and provider selection (ModeRouter) promotes maintainability.  
   * Lack of concrete source files limits static analysis, so documentation and tests around the routing table become critical to avoid regression.  

*All statements above are directly grounded in the provided observations and the explicit parent‑child relationship between **LLMService** and **ModeRouter**.*


## Hierarchy Context

### Parent
- [LLMService](./LLMService.md) -- The LLMService class in lib/llm/llm-service.ts handles incoming requests and delegates the work to the corresponding provider.


---

*Generated from 3 observations*
