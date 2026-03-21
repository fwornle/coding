# LocalLLM

**Type:** SubComponent

The LocalLLMProvider implements a caching mechanism using the CacheManager in lib/llm/cache-manager.ts to reduce the number of duplicate inference requests

## What It Is  

LocalLLM is the concrete implementation that enables on‑device large‑language‑model (LLM) inference within the **LLMAbstraction** hierarchy. Its core code lives in the following files:  

* `lib/llm/providers/local-llm-provider.ts` – the `LocalLLMProvider` class that implements the `Provider` interface.  
* `lib/llm/docker-model-runner.ts` – the `DockerModelRunner` class that actually launches a model inside a Docker container.  
* `lib/llm/model-registry.ts`, `lib/llm/process-manager.ts`, `lib/llm/cache-manager.ts`, and `lib/llm/subscription-manager.ts` – supporting services that the provider composes to manage models, processes, caching, and subscription‑based usage.  

Together these pieces let a consumer (typically the high‑level `LLMService` façade) request inference from a locally‑hosted model, optionally override the model per‑agent via files in `config/agents`, and benefit from caching and resource‑efficient execution.

---

## Architecture and Design  

The design follows a **provider‑registry** architecture that is explicitly described in the parent component *LLMAbstraction*. Each provider—whether remote (e.g., `AnthropicProvider`) or local (`LocalLLMProvider`)—conforms to a common `Provider` contract, allowing the `ProviderRegistry` (found in `lib/llm/provider-registry.js`) to treat them uniformly.  

`LocalLLMProvider` extends this contract and composes several specialist helpers:

| Helper | File | Role |
|--------|------|------|
| **ModelRegistry** | `lib/llm/model-registry.ts` | Holds the catalogue of Docker‑based LLM images that can be invoked. |
| **ProcessManager** | `lib/llm/process-manager.ts` | Spawns a separate OS process for each inference request, isolating CPU/GPU usage and preventing a single runaway request from starving the rest of the system. |
| **CacheManager** | `lib/llm/cache-manager.ts` | Stores recent inference results keyed by request payload to avoid duplicate work. |
| **SubscriptionManager** | `lib/llm/subscription-manager.ts` | Enables subscription‑based billing or quota enforcement for local models, mirroring the capability offered to remote providers. |

The **DockerModelRunner** (`lib/llm/docker-model-runner.ts`) is the child component that encapsulates the Docker‑run logic. By delegating container orchestration to this class, the provider remains agnostic of the underlying container runtime details, adhering to the **single‑responsibility principle**.

Configuration is externalised: per‑agent overrides live in `config/agents/*.json` (or similar). This makes the model selection dynamic without code changes, a pattern often called **configuration‑driven extensibility**.

Overall, the architecture can be visualised as a layered stack:

```
LLMService (facade) → ProviderRegistry → LocalLLMProvider (Provider)
   ├─ ModelRegistry
   ├─ ProcessManager
   ├─ CacheManager
   ├─ SubscriptionManager
   └─ DockerModelRunner (child)
```

No micro‑service or event‑bus patterns are introduced; the system is deliberately kept in‑process with explicit process isolation only for heavy inference work.

---

## Implementation Details  

### LocalLLMProvider (`lib/llm/providers/local-llm-provider.ts`)  
* Extends the abstract `Provider` base class, inheriting methods such as `infer`, `supportsModel`, and lifecycle hooks.  
* On construction it injects the four manager instances listed above, establishing clear composition rather than inheritance.  
* The `infer` method first checks `CacheManager` for a cached response; if a miss occurs, it resolves the target model (taking into account any per‑agent override from `config/agents`) via `ModelRegistry`.  

### DockerModelRunner (`lib/llm/docker-model-runner.ts`)  
* Provides a `runModel(containerId, input)` API that builds the Docker command line, streams input to the container, and captures stdout as the model’s response.  
* It is deliberately stateless; each call creates a fresh container (or re‑uses a pooled one) and then hands control back to `ProcessManager`.  

### ProcessManager (`lib/llm/process-manager.ts`)  
* Wraps Node’s `child_process` APIs to launch the Docker runner in its own OS process.  
* Implements a simple pool to limit concurrent processes, protecting the host machine from resource exhaustion.  

### CacheManager (`lib/llm/cache-manager.ts`)  
* Uses an in‑memory LRU map (or optionally a persistent store) keyed by a hash of the request payload.  
* Exposes `get`, `set`, and `invalidate` methods; the provider calls `set` after a successful inference.  

### SubscriptionManager (`lib/llm/subscription-manager.ts`)  
* Tracks usage counters per‑agent or per‑user, checking against subscription limits before permitting an inference request.  
* Returns a “quota exceeded” error that bubbles up to `LLMService`, which can then surface a user‑friendly message.  

### Model Overrides (`config/agents/`)  
* Each agent directory may contain a JSON file specifying `model: "<docker-image>"`.  
* `LocalLLMProvider` reads this file at runtime, allowing different agents to run different local models without code changes.  

All of these pieces are wired together at application start‑up by the `LLMService` façade (located in `lib/llm/llm-service.ts`). The service registers `LocalLLMProvider` alongside other providers in the `ProviderRegistry`, ensuring that request routing, caching, and circuit‑breaking are applied uniformly.

---

## Integration Points  

* **Parent – LLMAbstraction**: `LocalLLM` lives inside the broader `LLMAbstraction` component, which defines the overall provider contract and the `LLMService` façade. The abstraction guarantees that any consumer (e.g., an agent orchestrator) can request inference without knowing whether the model runs locally or remotely.  

* **Sibling – MockLLM & ProviderRegistry**: `MockLLMProvider` offers a lightweight stub for testing; it shares the same `Provider` interface and is also registered in `ProviderRegistry`. This uniform registration means that swapping a real `LocalLLMProvider` for a mock is a configuration change only.  

* **Child – DockerModelRunner**: The provider delegates the low‑level Docker execution to this child class. If the team later decides to replace Docker with another container runtime (e.g., Podman or a bare‑metal binary), only `DockerModelRunner` needs to be rewritten, leaving the provider logic untouched.  

* **External Dependencies**: The provider depends on the Docker CLI (or Docker Engine API) for container management, on the file system for reading per‑agent config, and optionally on a persistent cache store if the default in‑memory cache is insufficient.  

* **Runtime Interfaces**: The primary public method exposed to the rest of the system is `Provider.infer(request)`. Internally, the provider interacts with `ProcessManager.run(() => DockerModelRunner.run(...))`, `CacheManager.get/set`, and `SubscriptionManager.checkQuota`.  

---

## Usage Guidelines  

1. **Prefer Configuration Over Code** – When an agent needs a different local model, place a JSON file in `config/agents/<agent-id>.json` with a `model` field. The provider will automatically pick up the override at the next inference request.  

2. **Respect Process Limits** – The `ProcessManager` caps concurrent Docker processes (default configurable). Heavy workloads should be throttled at the caller level (e.g., by queuing requests in the agent logic) to avoid hitting the limit and causing back‑pressure errors.  

3. **Leverage Caching** – Repeated prompts with identical payloads will be served from `CacheManager`. For deterministic workloads, ensure that the request hash includes all relevant parameters (temperature, max tokens, etc.) so that cached results remain valid.  

4. **Monitor Subscription Quotas** – The `SubscriptionManager` will reject requests that exceed allocated usage. Integrate its error codes into UI feedback so users understand why a request was denied.  

5. **Testing with MockLLM** – During unit testing, replace `LocalLLMProvider` with the `MockLLMProvider` in the `ProviderRegistry`. Because both implement the same interface, the rest of the system (including `LLMService`) remains unchanged.  

6. **Container Image Management** – Add new Docker images to the catalogue in `ModelRegistry`. Ensure that each image is tagged consistently and that the registry entry includes any required runtime flags (e.g., GPU device mappings).  

---

### Architectural patterns identified  

* **Provider/Strategy pattern** – `LocalLLMProvider` implements the `Provider` contract alongside other providers.  
* **Registry pattern** – `ProviderRegistry` and `ModelRegistry` maintain collections of providers and model descriptors, respectively.  
* **Facade pattern** – `LLMService` offers a simplified interface that hides provider routing, caching, and circuit‑breaking.  
* **Composition over inheritance** – `LocalLLMProvider` composes `ProcessManager`, `CacheManager`, `SubscriptionManager`, and `DockerModelRunner` rather than inheriting their behavior.  
* **Configuration‑driven extensibility** – Per‑agent model overrides are driven by files under `config/agents`.  

### Design decisions and trade‑offs  

* **Process isolation** (via `ProcessManager`) improves stability and resource control but adds latency for container startup.  
* **Docker as the execution sandbox** provides portability across host OSes but introduces a dependency on Docker being installed and correctly configured.  
* **In‑memory cache** yields fast look‑ups; however, it does not survive restarts, so cache warm‑up may be needed after a crash.  
* **Subscription enforcement** adds a business‑logic layer directly into the provider, coupling usage tracking with inference logic; this simplifies enforcement but can make the provider harder to reuse in contexts without subscription concepts.  

### System structure insights  

* The **modular provider hierarchy** enables clean separation between remote and local inference paths.  
* Child components (`DockerModelRunner`) encapsulate platform‑specific concerns, keeping the provider logic platform‑agnostic.  
* Shared managers (`CacheManager`, `SubscriptionManager`) are reused across all providers, ensuring consistent behaviour (e.g., caching policy) system‑wide.  

### Scalability considerations  

* **Horizontal scaling** can be achieved by running multiple instances of the service, each with its own `ProcessManager`. Because inference runs in isolated Docker containers, additional host machines can be added behind a load balancer without code changes.  
* **Cache sharding** would be required if the in‑memory cache becomes a bottleneck; the design permits swapping `CacheManager` for a distributed store (Redis, Memcached) without touching provider code.  
* **Process pool tuning** allows administrators to balance concurrency against GPU/CPU availability, making the system adaptable to a range of hardware profiles.  

### Maintainability assessment  

* **High cohesion** – each class has a single, well‑defined responsibility, making the codebase approachable for new developers.  
* **Explicit composition** – dependencies are injected rather than hidden, simplifying unit testing (mocks can replace `ProcessManager`, `CacheManager`, etc.).  
* **Configuration‑first overrides** reduce the need for code modifications when adding new agents or models.  
* **Potential pain points** – the tight coupling of subscription logic inside the provider could complicate future reuse of `LocalLLMProvider` in a purely experimental or internal context. Refactoring that concern into a separate middleware layer would improve separation.  

Overall, the LocalLLM component demonstrates a disciplined, modular architecture that aligns with the broader **LLMAbstraction** design philosophy, offering clear extension points, predictable resource management, and a solid foundation for scaling on‑device LLM inference.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a modular design, with each provider having its own implementation, such as the AnthropicProvider (lib/llm/providers/anthropic-provider.ts) and the DMRProvider (lib/llm/providers/dmr-provider.ts). This design allows for easy addition or removal of providers, making the system more flexible and scalable. The LLMService (lib/llm/llm-service.ts) acts as a high-level facade, handling mode routing, caching, and circuit breaking, which helps to decouple the provider implementations from the rest of the system. For example, the LLMService uses the ProviderRegistry (lib/llm/provider-registry.js) to manage a chain of LLM providers, including local and public providers, with support for subscription-based providers.

### Children
- [DockerModelRunner](./DockerModelRunner.md) -- The DockerModelRunner class is defined in lib/llm/docker-model-runner.ts, which suggests a modular design for running local LLM models.

### Siblings
- [MockLLM](./MockLLM.md) -- MockLLM uses a mock implementation of the Provider interface in lib/llm/providers/mock-llm-provider.ts to generate mock LLM responses
- [LLMService](./LLMService.md) -- LLMService uses the ProviderRegistry in lib/llm/provider-registry.js to manage a chain of LLM providers
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses a registry data structure to store a list of available LLM providers

---

*Generated from 7 observations*
