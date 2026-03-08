# ModeRouter

**Type:** Detail

The LLMServiceManager sub-component uses the LLMService class in lib/llm/llm-service.ts to handle mode routing, indicating a strong dependency on this class for routing functionality.

## What It Is  

**ModeRouter** is a dedicated sub‑component that lives inside **LLMServiceManager**.  The manager imports the **LLMService** class from `lib/llm/llm-service.ts` and delegates all mode‑routing concerns to ModeRouter.  In practice, ModeRouter is the piece that decides which “mode” of an LLM (e.g., inference, fine‑tuning, evaluation) should be used for a given request and orchestrates the hand‑off to the appropriate service implementation.  Because ModeRouter is encapsulated within LLMServiceManager, its public surface is limited to the manager’s internal API, keeping the routing logic hidden from the rest of the code base.

## Architecture and Design  

The observations reveal a **modular, separation‑of‑concerns** architecture.  LLMServiceManager acts as a façade that aggregates lower‑level services, while ModeRouter is the specialized module responsible for routing decisions.  This mirrors a classic **Facade + Router** pattern: the façade simplifies external interaction, and the router isolates decision‑making logic.  

The dependency chain is explicit: `LLMServiceManager → LLMService (lib/llm/llm-service.ts) → ModeRouter`.  By routing through ModeRouter, the manager avoids hard‑coding mode logic, which makes it straightforward to add or replace modes without touching the manager itself.  The mention of **DockerizedServices** suggests that ModeRouter may also coordinate with container‑based service instances, ensuring that the selected mode is backed by the correct Docker image or runtime environment.  This reinforces a **layered** design where each layer (manager, router, service implementation) has a single responsibility.

## Implementation Details  

Although the source code is not directly visible, the observations give us the key structural pieces:

1. **LLMService class (`lib/llm/llm-service.ts`)** – Provides the core interface for interacting with LLM back‑ends.  It likely exposes methods such as `runInference`, `startFineTune`, etc., and contains the logic for launching or communicating with Dockerized containers.

2. **ModeRouter (child of LLMServiceManager)** – Encapsulated inside the manager, it receives a request context (e.g., a payload indicating the desired mode) and maps it to a concrete LLMService operation.  The router probably maintains a simple lookup table or strategy object that pairs mode identifiers with LLMService method calls.

3. **LLMServiceManager** – Serves as the orchestrator.  When a client asks for an LLM operation, the manager forwards the request to ModeRouter, which then invokes the appropriate method on the LLMService instance.  Because ModeRouter is a child component, its lifecycle is managed by the manager (instantiation, configuration, and disposal).

The tight coupling between ModeRouter and LLMService means that any change in the service’s public API will directly affect routing logic, but this coupling is intentional to keep routing decisions close to the service capabilities they govern.

## Integration Points  

- **LLMService (`lib/llm/llm-service.ts`)** – The primary dependency.  ModeRouter calls into this class to execute the selected mode.  The interface exposed by LLMService defines the contract ModeRouter must satisfy.

- **DockerizedServices** – While not a concrete file, the observation that ModeRouter “likely interacts closely with … DockerizedServices” indicates that routing may involve selecting the correct Docker container (e.g., a container running a specific model version or hardware configuration).  The integration point is therefore the container orchestration layer, which LLMService probably abstracts.

- **External callers** – Any component that uses LLMServiceManager (e.g., API endpoints, CLI tools) indirectly interacts with ModeRouter.  They do not call ModeRouter directly; instead, they supply a request that includes a mode identifier, and the manager handles the rest.

## Usage Guidelines  

1. **Always go through LLMServiceManager** – ModeRouter is not intended to be instantiated or called directly.  Use the manager’s public methods; it will delegate to the router automatically.

2. **Specify the mode explicitly** – When invoking an LLM operation, include a clear mode flag (e.g., `mode: "inference"`).  The manager will forward this to ModeRouter, which will select the correct LLMService path.

3. **Keep mode identifiers stable** – Since ModeRouter maps identifiers to service calls, changing a string literal without updating the router will break routing.  Document any new modes in the router’s configuration.

4. **Do not modify LLMService without updating ModeRouter** – Because the router tightly depends on LLMService’s API, any signature change requires a corresponding update in the routing logic.

5. **Leverage DockerizedServices through the manager** – If a new Docker image is required for a mode, add the container definition to the DockerizedServices layer and expose the necessary method on LLMService; ModeRouter will then be able to route to it without further changes.

---

### Architectural Patterns Identified
- **Facade Pattern** – LLMServiceManager presents a simplified interface to the rest of the system.
- **Router / Strategy Pattern** – ModeRouter selects the appropriate LLMService operation based on a mode key.
- **Layered Architecture** – Clear separation between manager (orchestration), router (decision), and service (execution).

### Design Decisions and Trade‑offs
- **Explicit Separation of Concerns** – Routing logic is isolated, improving readability and testability, but introduces a dependency on LLMService that must be kept in sync.
- **Tight Coupling to LLMService** – Guarantees that routing decisions are always based on the latest service capabilities; however, it reduces the ability to swap out the service implementation without touching the router.
- **Implicit Docker Integration** – By delegating container concerns to LLMService, ModeRouter stays lightweight, but any Docker‑related failure surfaces through the service layer, requiring robust error handling at the manager level.

### System Structure Insights
- The hierarchy is **LLMServiceManager → ModeRouter → LLMService**.
- ModeRouter acts as the sole child of the manager, implying a one‑to‑one relationship; there are no sibling routers observed.
- DockerizedServices sit “laterally” to LLMService, providing runtime assets that the service consumes.

### Scalability Considerations
- Adding new modes is straightforward: extend the router’s mapping and ensure LLMService implements the corresponding method.  This linear growth does not impact existing routes.
- If the number of modes or the complexity of routing decisions grows substantially, the router may need to evolve into a more sophisticated strategy registry or plugin system to avoid a monolithic switch‑case.

### Maintainability Assessment
- **High maintainability** for the current scope because routing logic is isolated and clearly documented via the manager‑router relationship.
- **Potential risk** lies in the tight coupling to LLMService; any breaking change in the service forces a coordinated update in the router.
- The modular layout (separate files, distinct responsibilities) supports unit testing of each layer, further enhancing long‑term maintainability.


## Hierarchy Context

### Parent
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager uses the LLMService class in lib/llm/llm-service.ts to handle mode routing, demonstrating a clear separation of concerns.


---

*Generated from 3 observations*
