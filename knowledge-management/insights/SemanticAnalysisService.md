# SemanticAnalysisService

**Type:** SubComponent

SemanticAnalysisService leverages the LLMService class in lib/llm/llm-service.ts to route semantic analysis requests to different modes, such as training or inference, based on input parameters.

## What It Is  

**SemanticAnalysisService** is a sub‑component that lives in the codebase under  
`lib/llm/semantic-analysis-service.ts`.  Its responsibility is to perform semantic analysis of coding services – notably the API server and the dashboard – by delegating the heavy‑lifting LLM work to the shared **LLMService** class (`lib/llm/llm-service.ts`).  The service is part of the larger **DockerizedServices** component, which treats LLMService as the single façade for all language‑model interactions.  Inside its own implementation the service also owns an **LLMRouter** child component that decides, based on incoming parameters, which operational mode (training vs. inference) the request should follow.

---

## Architecture and Design  

The architecture that emerges from the observations is a **centralised façade with routing and resilience layers**.  
- **LLMService** (`lib/llm/llm-service.ts`) acts as the high‑level façade for every LLM‑related operation across the DockerizedServices family.  It encapsulates three cross‑cutting concerns: **mode routing**, **in‑memory caching**, and **circuit breaking**.  By exposing a single entry point, it eliminates duplicated logic in each sibling service.  
- **SemanticAnalysisService** leverages this façade rather than implementing its own routing or caching.  It therefore follows a **Facade‑Consumer** relationship: the consumer (SemanticAnalysisService) delegates to the façade (LLMService) for all LLM interactions.  
- The presence of an **LLMRouter** child component inside SemanticAnalysisService indicates a **Router** pattern scoped to this sub‑component.  The router’s sole job is to interpret the request parameters and invoke the appropriate mode on LLMService (training or inference).  This mirrors the pattern used by the sibling services (ConstraintMonitoringService, CodeGraphAnalysisService) and the shared **ModeRouter** component, reinforcing a consistent routing strategy across the system.  

The design also embeds **Resilience** (circuit breaking) and **Performance** (caching) concerns directly within the façade, rather than scattering them across each consumer.  This centralisation reduces the surface area for bugs and makes the system’s fault‑tolerance behaviour easier to reason about.

---

## Implementation Details  

The concrete implementation can be inferred from the file locations and class names supplied:  

1. **SemanticAnalysisService (lib/llm/semantic-analysis-service.ts)**  
   - Declares a class named `SemanticAnalysisService`.  
   - Holds a reference to an **LLMRouter** instance, which it uses to decide the operational mode for each incoming request.  
   - Calls into `LLMService` (imported from `lib/llm/llm-service.ts`) for the actual LLM invocation. The call includes the mode determined by the router (e.g., `train` or `infer`).  

2. **LLMService (lib/llm/llm-service.ts)**  
   - Provides methods that accept a request payload and a mode flag.  
   - Internally checks an **in‑memory cache** before forwarding the request to the underlying LLM endpoint, thereby reducing latency for frequently accessed semantic analysis data.  
   - Wraps each outbound request with a **circuit‑breaker** guard: if a downstream LLM endpoint repeatedly fails, the circuit opens, short‑circuiting further calls and protecting the rest of DockerizedServices from cascading failures.  

3. **LLMRouter (child of SemanticAnalysisService)**  
   - Implements the routing logic specific to semantic analysis. It examines request metadata (e.g., a `mode` field) and returns the appropriate routing instruction to LLMService.  
   - Because the router is a child component, its logic can be tuned independently of the generic **ModeRouter** used by other services, while still relying on the same underlying LLMService façade.  

The sibling components (ConstraintMonitoringService, CodeGraphAnalysisService) follow the same pattern: each has its own service class, each delegates to LLMService for routing, caching, and circuit breaking, and each may have a specialised router if needed.

---

## Integration Points  

- **Parent Integration (DockerizedServices)** – DockerizedServices treats LLMService as the unified entry point for all LLM work.  SemanticAnalysisService is instantiated by DockerizedServices and receives the shared LLMService instance (or a dependency‑injected proxy).  This allows DockerizedServices to control lifecycle, configuration (e.g., cache size, circuit‑breaker thresholds), and deployment (Docker containers).  

- **Sibling Interaction** – While there is no direct call‑graph between SemanticAnalysisService and its siblings, they all depend on the same LLMService façade.  Any change to LLMService’s API, caching strategy, or circuit‑breaker policy will affect all sibling services uniformly, ensuring consistent behaviour across the platform.  

- **Child Component (LLMRouter)** – LLMRouter is the only internal integration point unique to SemanticAnalysisService.  It translates the semantic‑analysis‑specific request shape into the generic mode‑based call expected by LLMService.  Because the router is encapsulated, other components do not need to know its existence.  

- **External Dependencies** – The only external dependency explicitly mentioned is the underlying LLM provider (e.g., an OpenAI or custom model endpoint).  All interactions with that provider are mediated by LLMService, which handles retries, circuit‑breaker state, and caching.  

---

## Usage Guidelines  

1. **Always route through LLMService** – When extending or calling SemanticAnalysisService, never bypass LLMService for LLM operations.  Doing so would skip the built‑in caching and circuit‑breaker safeguards and could introduce latency spikes or cascading failures.  

2. **Respect the mode contract** – The request payload must contain a clear mode indicator (`training` vs. `inference`).  The LLMRouter expects this field to decide which path to take; omitting it will cause the router to fall back to a default (typically inference) and may lead to unexpected behaviour.  

3. **Cache‑friendly payloads** – Because LLMService caches “frequently accessed semantic analysis data,” structuring request identifiers (e.g., using stable hash keys) improves cache hit rates.  Avoid embedding volatile timestamps or random tokens in the payload if you want to benefit from caching.  

4. **Monitor circuit‑breaker state** – The DockerizedServices monitoring stack should expose the circuit‑breaker metrics (open/half‑open/closed) exposed by LLMService.  When the circuit is open, SemanticAnalysisService will return fast‑fail responses; developers should design fallback UI or retry logic accordingly.  

5. **Do not modify LLMRouter directly** – If routing rules need to change (e.g., adding a new mode), extend the router’s logic rather than editing the parent service.  This keeps the separation between request interpretation (LLMRouter) and LLM interaction (LLMService).  

---

### Architectural Patterns Identified  

1. **Facade Pattern** – LLMService provides a unified façade for all LLM‑related concerns (routing, caching, circuit breaking).  
2. **Router Pattern** – Both the generic ModeRouter (shared) and the specialised LLMRouter (child of SemanticAnalysisService) implement routing based on request parameters.  
3. **Circuit Breaker** – Implemented inside LLMService to protect the system from downstream LLM failures.  
4. **Cache‑Aside / In‑Memory Cache** – LLMService checks an internal cache before invoking the external model, reducing latency for repeat requests.  

### Design Decisions and Trade‑offs  

- **Centralising cross‑cutting concerns** (caching, circuit breaking) in LLMService reduces duplication but creates a single point of failure; any bug in LLMService propagates to all consumers.  
- **Separate routers per service** allow fine‑grained control (semantic‑analysis‑specific routing) while still sharing the same underlying façade; however, this introduces a small maintenance overhead when adding new global routing modes.  
- **In‑memory caching** improves latency but consumes container memory; the cache size must be tuned to avoid OOM in the Dockerized environment.  

### System Structure Insights  

- The hierarchy is **DockerizedServices → SemanticAnalysisService → LLMRouter**, with **LLMService** sitting alongside as a sibling to all service components.  
- Sibling services (ConstraintMonitoringService, CodeGraphAnalysisService) mirror the same structural pattern, indicating a deliberately uniform architecture across the LLM‑enabled domain.  

### Scalability Considerations  

- Because LLMService is the bottleneck for all LLM traffic, scaling the Docker container that hosts LLMService (or horizontally replicating it behind a load balancer) will directly increase the throughput of SemanticAnalysisService and its siblings.  
- The in‑memory cache is per‑process; scaling out to multiple replicas will fragment the cache unless a distributed cache layer is introduced.  
- Circuit‑breaker thresholds should be configured per replica to avoid coordinated tripping that could amplify downtime.  

### Maintainability Assessment  

The design promotes **high maintainability** through:  
- **Clear separation of concerns** – SemanticAnalysisService focuses on domain‑specific semantics, while LLMService handles generic LLM mechanics.  
- **Consistent patterns** – All sibling services adopt the same façade‑router model, making onboarding and code reviews straightforward.  
- **Encapsulation of resilience** – Circuit‑breaker logic lives in one place, simplifying updates to failure‑handling policies.  

Potential maintenance risks stem from the **centralised nature of LLMService**; any invasive change requires careful regression testing across all dependent services.  Overall, the current architecture balances reuse and isolation, supporting both evolution and reliable operation.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes the LLMService (lib/llm/llm-service.ts) as a high-level facade for all LLM operations. This design decision allows for a centralized management of mode routing, caching, and circuit breaking. For instance, the LLMService class in lib/llm/llm-service.ts handles the routing of LLM requests to different modes, such as training or inference, based on the input parameters. The caching mechanism in LLMService also ensures that frequently accessed data is stored in memory, reducing the latency of subsequent requests. Furthermore, the circuit breaking feature in LLMService prevents cascading failures by detecting and preventing requests to faulty services. The implementation of these features in LLMService demonstrates a thoughtful approach to managing the complexity of LLM operations in the DockerizedServices component.

### Children
- [LLMRouter](./LLMRouter.md) -- The LLMRouter utilizes the LLMService class in lib/llm/llm-service.ts to determine the routing of semantic analysis requests.

### Siblings
- [ConstraintMonitoringService](./ConstraintMonitoringService.md) -- ConstraintMonitoringService leverages the LLMService class in lib/llm/llm-service.ts to route constraint monitoring requests to different modes, such as training or inference, based on input parameters.
- [CodeGraphAnalysisService](./CodeGraphAnalysisService.md) -- CodeGraphAnalysisService leverages the LLMService class in lib/llm/llm-service.ts to route code graph analysis requests to different modes, such as training or inference, based on input parameters.
- [ModeRouter](./ModeRouter.md) -- ModeRouter utilizes the lib/llm/llm-service.ts file to handle the routing of LLM requests to different modes.
- [CacheManager](./CacheManager.md) -- CacheManager utilizes the lib/llm/llm-service.ts file to handle the caching of frequently accessed data.


---

*Generated from 7 observations*
