# DMRProviderModule

**Type:** SubComponent

The DMRProviderModule uses a circuit breaker pattern to prevent cascading failures when the Model Runner is experiencing issues, as implemented in lib/llm/dmr-circuit-breaker.ts.

## What It Is  

The **DMRProviderModule** is the concrete implementation of an LLM (large‑language‑model) provider that talks to a *Model Runner* container via the Docker API. Its source lives under the `lib/llm/` directory, most notably in the files  

* `lib/llm/dmr-provider-module.ts` – the entry point that orchestrates model selection, loading, inference, and error handling.  
* `lib/llm/dmr-model-loader.ts` – encapsulates the logic for pulling LLM artefacts from a model repository.  
* `lib/llm/dmr-model-cache.ts` – provides an in‑process cache for expensive load operations.  
* `lib/llm/dmr-model-fallback.ts` – defines the fallback strategy when the preferred model cannot be used.  
* `lib/llm/dmr-circuit-breaker.ts` – implements a circuit‑breaker guard around Docker‑based calls to the Model Runner.  
* `lib/llm/dmr-logger.ts` – centralises audit and debug logging for model lifecycle events.  
* `lib/llm/dmr-validator.ts` – validates request payloads and response shapes against expected schemas.  

Within the broader **LLMAbstraction** component, the DMRProviderModule is one of several possible providers. It is instantiated by the sibling **ProviderRegistryModule** (via a factory in `lib/llm/provider-registry-module.ts`) and is ultimately selected by the **LLMServiceModule** through dependency injection (`lib/llm/llm-service.ts`). Its only direct child is the **ModelRunnerClient**, which abstracts the Docker API calls used to start, stop, and query the Model Runner container.

---

## Architecture and Design  

The DMRProviderModule follows a **layered, responsibility‑segregated** architecture. Each concern—loading, caching, validation, logging, fallback, and resilience—is isolated in its own file, making the module easy to reason about and test. The design leans heavily on well‑known patterns that are explicitly present in the code base:

* **Factory Pattern** – The sibling ProviderRegistryModule uses a factory (`provider-registry-module.ts`) to create the DMRProviderModule instance, allowing the system to swap providers (e.g., MockServiceModule) without touching the consumer code.  
* **Dependency Injection (DI)** – The LLMServiceModule injects the provider (DMRProviderModule) and also injects the functions that resolve the current LLM mode. This decouples the provider from the mode‑resolution logic and enables per‑agent overrides defined in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`.  
* **Circuit Breaker** – Implemented in `dmr-circuit-breaker.ts`, this pattern protects the rest of the system from cascading failures when the Docker‑based Model Runner becomes unhealthy. The breaker tracks failure counts and opens the circuit, causing subsequent requests to short‑circuit to the fallback path.  
* **Cache‑Aside** – The `dmr-model-cache.ts` file follows a cache‑aside strategy: the loader first checks the cache, and on a miss it loads the model from the repository and then populates the cache. This reduces repeated I/O and speeds up inference warm‑starts.  
* **Fallback Strategy** – Defined in `dmr-model-fallback.ts`, the module can automatically switch to an alternate model (or a mock) when the primary model is unavailable, ensuring graceful degradation.  
* **Validation & Logging** – `dmr-validator.ts` guarantees that inputs/outputs respect the contract before they reach the Model Runner, while `dmr-logger.ts` records every load and inference event for auditability.  

Interaction flow: the **LLMService** receives a request, resolves the active LLM mode, and forwards the call to the injected DMRProviderModule. The provider first validates the payload, checks the cache, possibly loads a model via the loader, then uses **ModelRunnerClient** (Docker API) to perform inference. If the circuit breaker is open, the request is routed to the fallback module; otherwise, results are logged and returned.

---

## Implementation Details  

### Core Orchestration (`dmr-provider-module.ts`)  
The module exports a class (or a set of functions) that expose two public APIs: `loadModel()` and `runInference()`. Internally it composes the following collaborators:

* **ModelLoader** (`dmr-model-loader.ts`) – Pulls model binaries or configuration from a remote repository (e.g., S3, artifact store). It returns a handle that can be handed to the Model Runner.  
* **ModelCache** (`dmr-model-cache.ts`) – A simple in‑memory map keyed by model identifier and version. The cache stores the loaded model handle, allowing subsequent inferences to skip the loader step.  
* **CircuitBreaker** (`dmr-circuit-breaker.ts`) – Wraps every call to **ModelRunnerClient**. It maintains state (`CLOSED`, `OPEN`, `HALF_OPEN`) and a failure threshold defined in the module’s configuration. When the breaker is `OPEN`, the provider invokes the fallback path directly.  
* **FallbackHandler** (`dmr-model-fallback.ts`) – Contains a list of alternative models and the logic to select one based on priority, availability, or cost constraints. In the extreme case it may delegate to the **MockServiceModule**.  
* **Validator** (`dmr-validator.ts`) – Uses JSON schema or TypeScript type guards to ensure that the request payload (prompt, temperature, etc.) and the response from the Model Runner conform to the expected contract. Validation errors are surfaced as typed exceptions.  
* **Logger** (`dmr-logger.ts`) – Emits structured logs (timestamp, model id, request id, outcome) to the central logging pipeline. The logger is also used by the circuit breaker to record state transitions.

### ModelRunnerClient (Child)  
Although not listed as a separate source file, the **ModelRunnerClient** encapsulates Docker‑API interactions: creating a container from a model image, streaming STDIN/STDOUT for inference, monitoring container health, and tearing down the container after use. The client is invoked only after the circuit breaker grants permission, ensuring that a misbehaving Docker daemon does not bring down the entire service.

### Configuration & Extensibility  
All of the above components read their operational parameters (cache TTL, circuit‑breaker thresholds, fallback order) from a configuration object supplied by the parent **LLMAbstraction** component. Because the provider is created through the ProviderRegistry’s factory, swapping in a different implementation (e.g., a cloud‑hosted model) only requires providing a new set of concrete classes that respect the same interface contracts.

---

## Integration Points  

* **Parent – LLMAbstraction** – The abstraction layer treats DMRProviderModule as one concrete provider among others. It relies on the provider exposing a uniform interface (`loadModel`, `runInference`) so that the higher‑level **LLMService** can remain agnostic of the underlying execution environment.  
* **Sibling – ProviderRegistryModule** – The registry’s factory method (`createProvider`) decides at runtime whether to instantiate `DMRProviderModule` or `MockServiceModule` based on configuration flags or feature toggles. This decouples the selection logic from the service consumer.  
* **Sibling – MockServiceModule** – Provides a lightweight alternative used when the fallback mechanism in `dmr-model-fallback.ts` selects a mock response. The mock module shares the same validation and logging contracts, ensuring consistent observability.  
* **Sibling – LLMServiceModule** – Performs dependency injection (`LLMService` constructor) to inject the chosen provider. It also injects the mode‑resolution function (e.g., `getLLMMode` from `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`) which determines whether the request should be routed to DMRProviderModule or another provider.  
* **Child – ModelRunnerClient** – Directly communicates with Docker through the official Docker SDK. The client is the only piece that knows about container lifecycle; everything else interacts with it via a clean, promise‑based API.  

All integration points are defined by TypeScript interfaces (not shown in the observations but implied by the DI usage), which enforce compile‑time compatibility between modules.

---

## Usage Guidelines  

1. **Prefer the Cached Path** – When invoking `runInference`, let the provider handle cache checks automatically. Manually loading a model before each request defeats the cache‑aside design and can cause unnecessary Docker container churn.  
2. **Respect Circuit‑Breaker Limits** – Do not bypass the circuit breaker by calling the Docker client directly. If a high volume of failures is expected (e.g., during a rollout), consider adjusting the breaker thresholds in the provider’s configuration rather than suppressing it.  
3. **Provide Valid Payloads** – The validator (`dmr-validator.ts`) is strict; malformed prompts or missing required fields will raise runtime errors that are logged as failures. Use the TypeScript types exported from the module (or the JSON schema) to construct requests.  
4. **Configure Fallbacks Thoughtfully** – The fallback order defined in `dmr-model-fallback.ts` should prioritize models that meet latency and cost requirements for the given use‑case. Over‑relying on the mock fallback can mask real model availability problems.  
5. **Log Correlation IDs** – When calling the provider, include a request‑level correlation identifier (e.g., `requestId`) in the payload. The logger (`dmr-logger.ts`) will propagate this ID through model load and inference logs, making end‑to‑end tracing feasible.  
6. **Do Not Modify Internal Cache Directly** – The cache implementation is intentionally encapsulated. If you need to evict a model (e.g., after a security patch), use the public `clearCache()` method exposed by the provider rather than reaching into `dmr-model-cache.ts`.  

Following these conventions ensures that the DMRProviderModule operates within its designed resilience and performance envelope.

---

### 1. Architectural patterns identified  

* Factory pattern (ProviderRegistryModule)  
* Dependency injection (LLMServiceModule)  
* Circuit breaker (dmr‑circuit‑breaker.ts)  
* Cache‑aside / in‑memory caching (dmr‑model‑cache.ts)  
* Fallback / graceful degradation (dmr‑model‑fallback.ts)  
* Validation layer (dmr‑validator.ts)  
* Structured logging (dmr‑logger.ts)  

### 2. Design decisions and trade‑offs  

* **Docker‑based execution** – isolates model runtime but adds container‑startup latency; mitigated by caching and the circuit breaker.  
* **In‑process cache** – fast look‑ups, but limited by the host memory footprint; suitable for a moderate number of concurrently active models.  
* **Circuit breaker granularity** – applied per‑provider rather than per‑model, simplifying state management but potentially throttling all models if a single one misbehaves.  
* **Explicit fallback hierarchy** – guarantees service continuity at the cost of occasional reduced fidelity when falling back to mocks.  

### 3. System structure insights  

The DMRProviderModule sits in a *provider* tier beneath the high‑level **LLMAbstraction** façade. It shares a common contract with sibling providers (MockServiceModule) and is discovered via the ProviderRegistry’s factory. Its child, ModelRunnerClient, is the only component that knows about Docker, keeping container concerns isolated. The overall system forms a clean vertical stack: **LLMService** (DI & mode resolution) → **ProviderRegistry** (factory) → **DMRProviderModule** (or other provider) → **ModelRunnerClient** (Docker).  

### 4. Scalability considerations  

* **Horizontal scaling** – Because each inference request spins up a Docker container (or reuses one via the cache), scaling out the service horizontally simply adds more host machines with Docker installed. The cache is per‑process, so a distributed cache (e.g., Redis) would be needed for cross‑instance sharing.  
* **Circuit breaker tuning** – Proper threshold configuration is essential when traffic spikes; too low a threshold could open the circuit unnecessarily, while too high a threshold may allow failures to cascade.  
* **Model size** – Large models increase container memory usage; the cache‑aside pattern helps by keeping only actively used models resident.  

### 5. Maintainability assessment  

The module’s **single‑responsibility** split across dedicated files makes the codebase approachable: each file has a clear purpose and can be unit‑tested in isolation. The reliance on well‑known patterns (factory, DI, circuit breaker) aligns with common TypeScript/Node.js practices, lowering the learning curve for new developers. The main maintenance burden lies in the Docker integration; any change to the Model Runner’s image or API requires updates to **ModelRunnerClient** and possibly the validator schema. Overall, the design is **moderately maintainable**, with clear extension points (e.g., adding new fallback models) and limited coupling to external services.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a high-level facade, LLMService, which is defined in the file lib/llm/llm-service.ts. This facade is responsible for handling mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback. The LLMService class employs dependency injection to set functions that resolve the current LLM mode, allowing for flexibility in determining the mode. For instance, the getLLMMode function in integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts is used to determine the LLM mode for a specific agent, considering global mode, per-agent overrides, and legacy mock flags.

### Children
- [ModelRunnerClient](./ModelRunnerClient.md) -- The DMRProviderModule uses a Docker API client to interact with the Model Runner, as implied by the parent context.

### Siblings
- [ProviderRegistryModule](./ProviderRegistryModule.md) -- The ProviderRegistryModule uses a factory pattern in lib/llm/provider-registry-module.ts to create instances of different LLM providers, such as the DMRProviderModule and MockServiceModule.
- [MockServiceModule](./MockServiceModule.md) -- The MockServiceModule uses a mocking library to generate mock LLM responses, as seen in integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts.
- [LLMServiceModule](./LLMServiceModule.md) -- The LLMServiceModule uses a dependency injection mechanism to resolve the current LLM provider, as seen in lib/llm/llm-service.ts.

---

*Generated from 7 observations*
