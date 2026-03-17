# RequestRouter

**Type:** Detail

The lack of source code files limits the ability to provide more specific observations, but the RequestRouter is a crucial component in the LLMService sub-component.

## What It Is  

The **RequestRouter** is the dedicated routing component that lives inside the **LLMService** sub‑system. The parent entry point for all language‑model operations is the `LLMService` class located at **`lib/llm/llm-service.ts`**. Within that component, the RequestRouter is responsible for examining an incoming LLM request, consulting the service’s provider registry, and delegating the call to the appropriate concrete provider implementation. In other words, RequestRouter is the “traffic cop” that ensures each request reaches the right backend (e.g., OpenAI, Anthropic, a self‑hosted model, etc.) without the caller needing to know the details of the underlying provider.

Because the only concrete observation we have is that **LLMService routes requests to the appropriate provider based on the registry**, the RequestRouter’s purpose can be inferred directly from that description: it encapsulates the routing logic, isolates it from the higher‑level API exposed by `LLMService`, and provides a single place where routing rules can be maintained or extended.

---

## Architecture and Design  

The presence of a distinct RequestRouter signals a **routing / dispatcher architectural pattern** within the LLMService module. The pattern separates concerns: `LLMService` offers a clean, provider‑agnostic façade, while RequestRouter contains the decision‑making logic that maps a request to a concrete provider. This separation aligns with the **Single Responsibility Principle**—the service class does not become bloated with provider‑selection code, and the router can evolve independently.

The description that routing is performed “based on the registry” suggests an **internal registry (or lookup table)** that maps request characteristics (such as model name, capability flags, or configuration options) to provider instances. The router likely queries this registry at runtime, which is reminiscent of the **Strategy pattern**: each provider implements a common interface, and the router selects the appropriate strategy (provider) for the given request. Although the source code is not present, the observed behavior (choosing a provider from a registry) is a classic implementation of that pattern.

Interaction flow can be visualised as:

1. A consumer calls a method on `LLMService` (e.g., `generateText`).
2. `LLMService` forwards the request object to **RequestRouter**.
3. RequestRouter consults the **provider registry** held by LLMService (or a shared module) to locate the matching provider.
4. The selected provider’s concrete implementation is invoked, and the response is returned up the chain to the original caller.

This layered interaction keeps the system **modular** and **extensible**: adding a new provider only requires registering it; the router does not need to be rewritten.

---

## Implementation Details  

While the concrete source files for RequestRouter are not enumerated, the observations make clear that it is a **child component of `LLMService`**. The router likely exposes a single public method (e.g., `route(request): Provider`) that accepts a request descriptor and returns a provider instance or directly forwards the call. Internally, the router would:

* **Read the provider registry** – a data structure (perhaps a `Map<string, Provider>` or a configuration object) that lists all available providers and the criteria for their selection.
* **Match request attributes** – compare the request’s desired model, version, or capability against the registry entries.
* **Select and return** the matching provider, possibly falling back to a default or raising an error if no match is found.

Because the router is invoked by `LLMService`, the service class probably holds a reference to the router (e.g., `private router: RequestRouter`) that is instantiated during service construction. The router may also be responsible for **caching** provider lookups if the registry lookup is expensive, though such details are not observable from the provided notes.

Given the emphasis on “routing requests to the appropriate provider based on the registry,” the implementation is expected to be **declarative**: the registry is the source of truth, and the router’s algorithm is a straightforward lookup rather than a complex decision tree. This keeps the codebase simple and readable.

---

## Integration Points  

The RequestRouter sits directly **between `LLMService` and the concrete provider implementations**. Its primary dependency is the **provider registry**, which is likely maintained by the parent `LLMService` component. The router does not appear to interact with external systems directly; instead, it acts as an internal conduit. Consequently, the integration surface is limited to:

* **LLMService → RequestRouter**: LLMService calls the router for every public operation that requires a provider.
* **RequestRouter → Provider Instances**: The router retrieves or invokes the provider that satisfies the request. Providers themselves may have their own dependencies (HTTP clients, authentication tokens, etc.), but those are encapsulated within the provider modules, not the router.

Because the router’s responsibility is confined to selection, it can be **mocked or stubbed** in unit tests of `LLMService`, allowing the service’s higher‑level logic to be verified without invoking real LLM back‑ends. This clear contract also makes it straightforward to plug in alternative routing strategies (e.g., load‑balancing across multiple instances of the same provider) without touching the rest of the system.

---

## Usage Guidelines  

Developers working with the LLM subsystem should treat **RequestRouter as an internal implementation detail**; they interact with the system through the `LLMService` façade. When extending the platform:

1. **Register new providers** in the LLMService’s provider registry rather than modifying the router’s code. The router will automatically pick up the new entry on the next request.
2. **Maintain consistent request descriptors** – the fields used by the router (model name, version, capability flags) should be documented and kept stable, because the router’s matching logic depends on them.
3. **Avoid direct calls to provider instances**; always go through `LLMService`. This ensures the router can enforce routing rules, perform validation, and apply future enhancements (e.g., request throttling) centrally.
4. **Unit‑test routing logic** by supplying mock request objects and verifying that the expected provider is selected. Because the router’s algorithm is deterministic, tests can be simple lookup assertions.

Following these conventions keeps the routing layer clean, reduces coupling between callers and providers, and preserves the extensibility promised by the design.

---

### Architectural Patterns Identified
* **Routing / Dispatcher pattern** – separates request handling from provider selection.
* **Strategy (or Provider) pattern** – providers implement a common interface; the router selects the appropriate strategy at runtime.
* **Registry‑based lookup** – a central map of providers that drives routing decisions.

### Design Decisions and Trade‑offs
* **Explicit router component** vs. embedding routing logic in `LLMService`: improves separation of concerns but adds a thin indirection layer.
* **Registry‑driven selection**: simple and extensible; however, complex routing rules (e.g., weighted load‑balancing) would require augmenting the registry or router logic.
* **Single point of routing**: easy to audit and test, but becomes a bottleneck if the router performs heavyweight computation (unlikely given the observed simple lookup).

### System Structure Insights
* **Parent‑child hierarchy**: `LLMService` (parent) → `RequestRouter` (child) → concrete providers (grandchildren).
* **Siblings** (if any) would be other internal helpers of LLMService (e.g., request validators, response formatters) that share the same parent but have distinct responsibilities.

### Scalability Considerations
* Because routing is a lightweight lookup, the router scales well with the number of providers; the primary limitation would be the size of the registry and the cost of any additional matching criteria.
* Adding more providers does not affect the router’s performance linearly if the registry is implemented as a hash map; however, more complex matching (e.g., regex or semantic criteria) could introduce latency.

### Maintainability Assessment
* The clear separation of routing logic into its own component makes the codebase **highly maintainable**: routing changes are localized, and provider additions only touch the registry.
* The lack of deep coupling between `LLMService` and individual providers reduces the risk of ripple effects when a provider’s API changes.
* The design encourages **testability** (router can be unit‑tested in isolation) and **future extensibility** (new routing strategies can be introduced without rewriting the service façade).


## Hierarchy Context

### Parent
- [LLMService](./LLMService.md) -- The LLMService class (lib/llm/llm-service.ts) serves as the main entry point for all LLM operations, routing requests to the appropriate provider based on the registry.


---

*Generated from 3 observations*
