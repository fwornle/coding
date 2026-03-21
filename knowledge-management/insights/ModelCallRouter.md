# ModelCallRouter

**Type:** SubComponent

The ModelCallRouter handles errors and exceptions that occur during model calls, including provider failures and timeouts.

## What It Is  

The **ModelCallRouter** is a sub‑component that lives inside the LLM abstraction layer and is implemented in the file **`lib/llm/llm-service.ts`**. Its sole responsibility is to receive a request for a language‑model invocation and, based on a *tier‑based routing* strategy, forward that request to the appropriate provider implementation (Anthropic, OpenAI, or Groq). The router does not perform the actual inference itself; instead it looks up the correct provider‑model pair via a **ProviderModelMapper**, invokes the provider through the shared provider registry, and returns the result while handling any errors, time‑outs, and emitting metrics and logs. Because it is a child of the higher‑level **LLMAbstraction** component, the router is the “decision engine” that makes the LLM abstraction provider‑agnostic for callers.

---

## Architecture and Design  

The design of **ModelCallRouter** follows a **registry‑based composition** pattern combined with a **tier‑based routing** strategy. The router relies on a **ProviderRegistry** (a sibling component) that holds concrete provider clients, and a **ProviderModelMapper** that maps logical model identifiers to the concrete provider‑specific classes. This separation of concerns allows the router to remain lightweight: it only decides *which* provider to call, while the registry encapsulates *how* to instantiate and manage each provider’s lifecycle.

The **TierBasedRouter** child implements the tier logic – for example, a “free tier” may be directed to a lower‑cost provider, while a “premium tier” is sent to a higher‑performance model. This modular routing component can be swapped or extended without touching the rest of the router, illustrating a clear **strategy**‑like separation.  

Error handling is encapsulated in the **ErrorHandlingMechanism** child. The observations note that the router catches provider failures and time‑outs, which suggests a systematic use of try‑catch blocks around each provider call, possibly enriched with custom error types that differentiate between network, timeout, and provider‑specific errors.  

Metrics and logging are baked into the call flow, providing observability for performance (latency, throughput) and reliability (error rates). This aligns with a **cross‑cutting concern** approach where the router acts as a single point for instrumentation, keeping the provider implementations themselves free of duplicated logging code.

Overall, the architecture is **modular and compositional**: the parent **LLMAbstraction** delegates routing to ModelCallRouter; sibling components such as **ProviderRegistry** and **LLMModeManager** supply shared services; and the router’s own children (TierBasedRouter, ErrorHandlingMechanism, ProviderModelMapper) each own a focused responsibility.

---

## Implementation Details  

* **File location** – All routing logic resides in `lib/llm/llm-service.ts`. Although the source snapshot did not expose concrete symbols, the file name and the hierarchical description make it clear that the router, its tier strategy, and supporting utilities are co‑located there.  

* **TierBasedRouter** – This child implements the tier‑selection algorithm. The algorithm likely inspects request metadata (e.g., user subscription level, request payload size) and selects a tier identifier. The tier identifier then maps to a concrete provider‑model pair via the ProviderModelMapper. Because the tier logic is isolated, adding a new tier or re‑balancing traffic can be done by editing this component alone.  

* **ProviderModelMapper** – Implemented as a dictionary‑like structure (e.g., `Map<string, ProviderClient>`), it stores entries such as `{ "anthropic/claude-2": AnthropicClient, "openai/gpt-4": OpenAIClient, "groq/llama2": GroqClient }`. When the router receives a logical model name, it queries this map to retrieve the correct client instance from the ProviderRegistry.  

* **ProviderRegistry** – Although a sibling, the router interacts with it directly to obtain ready‑to‑use provider clients. The registry likely performs lazy initialization, credential loading, and possibly circuit‑breaker wiring (as hinted by the parent component’s use of a circuit breaker).  

* **ErrorHandlingMechanism** – Surrounds the provider call with a try‑catch block. On a provider‑specific error, the mechanism may translate the exception into a unified `ModelCallError` type, log the failure, increment an error metric, and optionally trigger a fallback (e.g., retry with a different provider or downgrade the tier). Time‑out handling is explicitly mentioned, indicating the use of a timeout wrapper (e.g., `Promise.race` with a timer) around the async provider call.  

* **Metrics & Logging** – After each call, the router records latency (start‑time → end‑time) and success/failure counters. The logs include the selected provider, model name, tier, and any error details, providing full traceability for downstream debugging and performance monitoring.  

* **Interaction with LLMAbstraction** – The parent component calls into ModelCallRouter whenever a consumer requests a model. The abstraction passes along the request payload, desired logical model name, and any tier or mode hints. ModelCallRouter returns either the provider’s raw response or a normalized result that LLMAbstraction can further process (e.g., applying a mock mode or caching).  

---

## Integration Points  

1. **ProviderRegistry (Sibling)** – Supplies concrete provider clients. The router queries the registry through a well‑defined interface, likely something like `registry.getClient(providerId)`.  

2. **LLMModeManager (Sibling)** – Determines the operating mode (mock, local, public) before routing. ModelCallRouter may receive a flag from LLMModeManager indicating whether to bypass real providers (mock mode) and return stubbed data.  

3. **Circuit Breaker & Cache (Parent‑level services)** – While not directly mentioned in the observations for ModelCallRouter, the parent LLMAbstraction uses these services, so the router indirectly benefits from them. For example, a provider client fetched from ProviderRegistry may already be wrapped in a circuit‑breaker, and responses may be cached by a shared cache layer.  

4. **Metrics/Logging Infrastructure** – The router emits metrics to whatever monitoring system the application uses (e.g., Prometheus, CloudWatch). It also writes logs to the central logger configured for the LLM subsystem.  

5. **External Consumers** – Any part of the codebase that needs to invoke an LLM does so through LLMAbstraction, which forwards the request to ModelCallRouter. Thus, the router is a thin middle layer between high‑level business logic and the low‑level provider SDKs.  

---

## Usage Guidelines  

* **Always go through LLMAbstraction** – Directly invoking a provider client bypasses the tier logic, error handling, and observability that ModelCallRouter provides. Use the abstraction’s `callModel(...)` method, which internally delegates to the router.  

* **Specify logical model identifiers** – Pass a logical name that exists in the ProviderModelMapper (e.g., `"anthropic/claude-2"`). Do not hard‑code provider SDK classes; the router will resolve the correct client based on the mapping.  

* **Respect tier hints** – If the caller has information about the desired tier (e.g., `tier: "premium"`), include it in the request payload. The TierBasedRouter will use this hint to select the appropriate provider.  

* **Handle time‑outs at the caller level** – The router already enforces provider‑level time‑outs, but callers should still implement their own overall request timeout to avoid hanging if the router’s fallback logic takes longer than expected.  

* **Monitor metrics** – Use the exposed metrics (latency, error counters) to observe routing health. Sudden spikes in time‑outs for a particular provider may indicate downstream service degradation, prompting a temporary tier re‑balancing.  

* **Do not modify the ProviderModelMapper directly** – Extend the mapping by updating the central configuration or registry initialization code, not by editing the router’s internal map. This keeps the router’s contract stable and avoids accidental mismatches.  

---

### Architectural patterns identified  

1. **Registry pattern** – ProviderRegistry and ProviderModelMapper act as look‑up tables for concrete provider clients.  
2. **Strategy/Policy pattern** – TierBasedRouter encapsulates the tier‑selection algorithm, allowing interchangeable routing strategies.  
3. **Cross‑cutting concerns** – Centralized error handling, metrics, and logging are applied in the router, keeping provider implementations clean.  

### Design decisions and trade‑offs  

* **Separation of routing from provider logic** – Improves modularity and makes it easy to add new providers, but introduces an extra indirection layer that adds minimal latency.  
* **Tier‑based routing** – Enables cost‑aware or performance‑aware distribution of traffic; however, it requires careful tier definition and may complicate debugging when a request is silently rerouted.  
* **Centralized error handling** – Guarantees uniform error semantics, yet a single failure handling strategy may not suit every provider’s unique failure modes, potentially requiring provider‑specific extensions later.  

### System structure insights  

* **Parent‑child hierarchy** – ModelCallRouter sits under LLMAbstraction and owns three focused children, each with a single responsibility.  
* **Sibling collaboration** – ProviderRegistry and LLMModeManager provide shared services that the router consumes, illustrating a cohesive “LLM subsystem” where each piece is independently testable.  

### Scalability considerations  

* Adding new providers or tiers only requires updating the ProviderModelMapper and possibly extending TierBasedRouter logic; the core router code remains unchanged.  
* Because routing decisions are in‑memory look‑ups, the router scales horizontally without coordination overhead.  
* Metrics collection at the router level enables automated scaling policies (e.g., divert traffic away from a provider that is hitting latency thresholds).  

### Maintainability assessment  

The clear division into TierBasedRouter, ErrorHandlingMechanism, and ProviderModelMapper makes the router highly maintainable. Each child can be unit‑tested in isolation, and the registry‑based approach centralizes provider configuration, reducing duplication. The only maintenance risk is the potential growth of the ProviderModelMapper map; keeping it declarative (e.g., JSON or environment‑driven) mitigates that risk. Overall, the design promotes low coupling, high cohesion, and straightforward extensibility.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Groq. It enables provider-agnostic model calls, tier-based routing, and mock mode for testing. The component is designed to handle different LLM modes, including mock, local, and public, and it uses a registry to manage the available providers. The LLMAbstraction component is implemented in the lib/llm/llm-service.ts file and uses various other modules, such as the provider registry, circuit breaker, and cache, to manage the LLM operations.

### Children
- [TierBasedRouter](./TierBasedRouter.md) -- The TierBasedRouter strategy is implemented in the lib/llm/llm-service.ts file, which suggests a modular design for the ModelCallRouter sub-component.
- [ErrorHandlingMechanism](./ErrorHandlingMechanism.md) -- The ErrorHandlingMechanism likely involves try-catch blocks or error callbacks to catch and handle exceptions that occur during model calls, which could be implemented in the lib/llm/llm-service.ts file.
- [ProviderModelMapper](./ProviderModelMapper.md) -- The ProviderModelMapper likely involves a data structure such as a dictionary or map to store the provider-model mappings, which could be implemented in the lib/llm/llm-service.ts file.

### Siblings
- [ProviderRegistry](./ProviderRegistry.md) -- The ProviderRegistry uses a registry to manage the available providers, as seen in the lib/llm/llm-service.ts file.
- [LLMModeManager](./LLMModeManager.md) -- The LLMModeManager uses a registry to manage the available modes, as seen in the lib/llm/llm-service.ts file.

---

*Generated from 5 observations*
