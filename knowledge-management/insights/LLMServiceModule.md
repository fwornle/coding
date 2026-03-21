# LLMServiceModule

**Type:** SubComponent

The docker-compose.yml file specifies the services and their dependencies, making it easy to manage the lifecycle of LLM services.

## What It Is  

The **LLMServiceModule** is a sub‑component that lives inside the **DockerizedServices** parent. Its core implementation resides in the file **`lib/llm/llm-service.ts`**, where the `LLMService` class is defined. This class acts as a high‑level façade for all interactions with the underlying large‑language‑model (LLM) services. The module’s lifecycle is managed through Docker Compose – the **`docker‑compose.yml`** file (found at the repository root) enumerates the individual LLM containers, their inter‑dependencies, and the means by which they are started, stopped, or scaled. Within the module, a child component named **LLMRouter** is responsible for routing requests to the appropriate LLM mode, while the parent **DockerizedServices** component provides the overall container orchestration framework.

## Architecture and Design  

The architecture of the LLMServiceModule is deliberately **modular** and **container‑centric**. By leveraging Docker Compose, each LLM instance runs in its own isolated container, and the `docker‑compose.yml` file defines the service graph, making addition or removal of a model a matter of editing a declarative YAML file. This reflects a **composition‑over‑inheritance** approach where the system’s capabilities are assembled from interchangeable Dockerized services.

Inside the module, the `LLMService` class implements a **Facade pattern**: it presents a simple, unified API to the rest of the codebase while encapsulating the complexities of mode selection, caching, and fault tolerance. The **Router** sub‑component (`LLMRouter`) embodies a **Routing pattern** that decides, based on the requested mode (e.g., chat, completion, embeddings), which container endpoint should handle the call.  

Fault tolerance is achieved through a **Circuit‑Breaker** strategy embedded in `LLMService`. When a downstream LLM container becomes unresponsive or repeatedly fails, the circuit breaker temporarily halts traffic to that instance, protecting the overall system from cascading failures. Caching, also handled inside `LLMService`, reduces redundant calls to the same LLM for identical inputs, improving latency and cost efficiency.

The module shares its Docker‑Compose‑driven lifecycle management with sibling components **ServiceStarterModule** and **DockerComposeManager**. While `ServiceStarterModule` contributes a retry‑on‑failure start‑up mechanism, `DockerComposeManager` provides higher‑level commands (up, down, restart) that the LLMServiceModule indirectly relies on for container orchestration.

## Implementation Details  

- **`lib/llm/llm-service.ts` – `LLMService`**  
  - **Mode Routing:** The class delegates incoming requests to `LLMRouter`, which examines request metadata (e.g., a “mode” field) and selects the correct Docker service name defined in `docker‑compose.yml`.  
  - **Caching Layer:** Before forwarding a request, `LLMService` checks an in‑memory (or optionally persistent) cache keyed by request payload. A cache hit returns the stored LLM response instantly; a miss proceeds to the router.  
  - **Circuit Breaking:** A lightweight state machine tracks success/failure counts per LLM container. Upon crossing a failure threshold, the circuit opens, causing `LLMService` to short‑circuit calls and optionally fall back to a secondary model or return an error. After a cool‑down period the circuit attempts to close, re‑enabling traffic.  

- **`docker-compose.yml`**  
  - Lists each LLM container (e.g., `llm‑gpt‑3`, `llm‑bert`) with explicit `depends_on` clauses, ensuring that prerequisite services (such as a shared Redis cache or a monitoring sidecar) start first.  
  - Provides environment variables that `LLMService` reads to build endpoint URLs (e.g., `LLM_GPT3_URL`).  

- **`LLMRouter` (child component)**  
  - Implements a simple dispatch table mapping mode identifiers to Docker service hostnames/ports. The router is stateless, making it easy to replace or extend with additional modes without touching `LLMService`’s core logic.  

- **Interaction with Siblings**  
  - The **ServiceStarterModule**’s retry logic is invoked when `DockerComposeManager` issues a `docker compose up` for the LLM services. If a container fails to become healthy, the starter retries according to its policy, ensuring that `LLMService` always sees a ready endpoint.  

Overall, the implementation isolates concerns: orchestration lives in Docker Compose, start‑up reliability lives in ServiceStarter, routing lives in LLMRouter, and the façade (LLMService) handles business‑level concerns like caching and resilience.

## Integration Points  

1. **DockerizedServices (Parent)** – The parent component supplies the Docker Compose definition that spins up the LLM containers. Any change to the container image version or resource limits is made at this level, automatically propagating to LLMServiceModule.  

2. **DockerComposeManager (Sibling)** – Provides programmatic control (via CLI wrappers or API calls) to bring the LLM services up or down. LLMService does not call Docker directly; instead, it relies on the manager to have the containers running and reachable.  

3. **ServiceStarterModule (Sibling)** – Guarantees that containers are healthy before LLMService begins processing traffic. Its retry mechanism is crucial when a new LLM image introduces longer warm‑up times.  

4. **LLMRouter (Child)** – Exposes a method such as `route(request): Endpoint` that LLMService invokes. The router’s contract is a simple function signature, making it easy for other modules (e.g., a future “LLMAnalyticsModule”) to reuse the routing logic.  

5. **Cache Store (Implicit Dependency)** – While not explicitly listed, the caching behavior in `LLMService` assumes an underlying store (in‑memory map or external Redis). This store is typically provisioned by DockerizedServices as a shared service, and its configuration lives in the same `docker‑compose.yml`.  

6. **External Clients** – Any higher‑level application component that needs LLM capabilities calls the public methods of `LLMService`. Because `LLMService` presents a uniform façade, callers remain agnostic to the number or type of underlying LLM containers.

## Usage Guidelines  

- **Initialize Once** – Instantiate `LLMService` after the Docker Compose stack is confirmed healthy (e.g., after `DockerComposeManager.up()` completes). Re‑initializing the façade while containers are restarting can cause transient routing errors.  

- **Prefer Cached Calls** – When possible, use the same request payload for repeated queries to benefit from the built‑in cache. If deterministic responses are required, ensure the cache key includes all relevant request parameters (prompt, temperature, etc.).  

- **Handle Circuit‑Breaker Errors** – Calls to `LLMService` may throw a specific `CircuitOpenError` when a model is temporarily unavailable. Client code should catch this exception and either retry after a back‑off period or fall back to an alternative LLM mode.  

- **Add New Modes via LLMRouter** – To introduce a new LLM mode, extend the routing table in `LLMRouter` and add the corresponding service definition to `docker‑compose.yml`. No changes to `LLMService` are needed, preserving the façade’s stability.  

- **Monitor Service Health** – Leverage the health‑check facilities defined in `docker‑compose.yml`. The `ServiceStarterModule` will automatically retry failed starts, but long‑term health monitoring should be added at the orchestration level (e.g., Prometheus alerts) to pre‑empt circuit‑breaker trips.  

- **Resource Constraints** – Because each LLM runs in its own container, allocate CPU and memory limits in `docker‑compose.yml` according to model size. Over‑provisioning can lead to unnecessary cost, while under‑provisioning may trigger frequent circuit‑breaker openings.  

---

### Architectural Patterns Identified
1. **Facade Pattern** – `LLMService` abstracts the complexity of multiple LLM containers.  
2. **Router/Dispatcher Pattern** – `LLMRouter` directs requests based on mode.  
3. **Circuit‑Breaker Pattern** – Protects the system from failing LLM instances.  
4. **Caching Pattern** – Reduces duplicate LLM calls.  
5. **Container‑Based Modular Composition** – Docker Compose defines a modular service graph.

### Design Decisions and Trade‑offs  
- **Modularity via Docker** gives isolation and easy scaling but adds operational overhead (container orchestration, networking).  
- **Facade + Router separation** keeps the public API stable while allowing internal routing logic to evolve; however, it introduces an extra indirection layer that can affect latency.  
- **Circuit‑breaker thresholds** balance availability against rapid failover; setting them too low may cause unnecessary trips, too high may delay detection of real failures.  
- **In‑process caching** is simple and fast but may not survive process restarts; using an external cache (e.g., Redis) would improve durability at the cost of added complexity.

### System Structure Insights  
The LLMServiceModule sits in a clear hierarchy: DockerizedServices → LLMServiceModule → LLMRouter. Sibling modules share the same Docker‑Compose‑driven lifecycle, promoting a consistent operational model across the codebase. The module’s responsibilities are cleanly split between orchestration (handled upstream), routing (LLMRouter), and business logic (LLMService).

### Scalability Considerations  
Because each LLM runs in its own container, horizontal scaling is as simple as adding replica entries in `docker‑compose.yml` or moving to a swarm/k8s deployment. The caching layer reduces load on the LLM containers, and the circuit‑breaker prevents a single failing replica from overwhelming the system. However, the façade must be aware of multiple replicas (e.g., via load‑balancing DNS) to fully exploit horizontal scaling.

### Maintainability Assessment  
The separation of concerns (orchestration, routing, façade, resilience) yields high maintainability: changes to one aspect (e.g., swapping a model image) rarely affect others. The declarative Docker Compose file serves as a single source of truth for service topology, simplifying onboarding for new developers. The only maintenance burden lies in keeping the circuit‑breaker thresholds and cache eviction policies aligned with evolving model performance characteristics. Overall, the design promotes easy extensibility, clear ownership, and predictable operational behavior.

## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component implements a modular design, with each service being a separate Docker container. This is evident in the use of Docker Compose files, which define the services and their dependencies. For example, the docker-compose.yml file in the root directory defines the services and their dependencies. The LLMService class, located in lib/llm/llm-service.ts, is a high-level facade that handles mode routing, caching, and circuit breaking for all LLM operations. This modular design allows for easy addition or removal of services, making the system highly scalable and maintainable.

### Children
- [LLMRouter](./LLMRouter.md) -- The LLMServiceModule's mode routing is a critical aspect of its operation, allowing it to adapt to different LLM modes.

### Siblings
- [ServiceStarterModule](./ServiceStarterModule.md) -- The ServiceStarterModule uses a retry mechanism to ensure that services are properly started, as seen in the implementation of the ServiceStarter class.
- [DockerComposeManager](./DockerComposeManager.md) -- The docker-compose.yml file defines the services and their dependencies, making it easy to manage the lifecycle of services.

---

*Generated from 7 observations*
