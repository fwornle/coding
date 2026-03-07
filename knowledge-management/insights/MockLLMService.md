# MockLLMService

**Type:** SubComponent

MockLLMService handles mock LLM errors using MockErrorHandler.class, preventing errors from propagating to the application

## What It Is  

MockLLMService is a **sub‑component** that lives inside the **DockerizedServices** containerization layer.  It provides a fully‑controlled, programmable stand‑in for real large‑language‑model (LLM) providers, allowing downstream services—such as the **LLMFacade**, **ConstraintMonitor**, and any test harnesses—to exercise LLM‑dependent logic without incurring external API calls or cost.  The service is instantiated from the files that belong to the *MockLLMService* directory (the exact file‑system path is not enumerated in the observations, but it is packaged together with its sibling services under DockerizedServices).  Configuration is driven by two JSON artefacts:  

* **MockLLMService.config.json** – global toggles that tailor the overall mock behaviour (e.g., latency injection, response size limits).  
* **ScenarioConfig.json** – a catalogue of named mock scenarios that define the exact response patterns the service should emit for a given test case.  

Together with a small set of supporting classes—**MockLLMResponseGenerator**, **MockErrorHandler**, **LoggingAgent**, and **TestAdapter**—MockLLMService delivers deterministic, observable, and isolated LLM simulations for the broader system.

---

## Architecture and Design  

The architecture of MockLLMService follows a **composition‑based modular design**.  The core service delegates distinct responsibilities to dedicated helper classes, each encapsulated behind a well‑defined interface:

1. **Response generation** is performed by **MockLLMResponseGenerator**.  This class reads the active scenario from *ScenarioConfig.json* and builds a synthetic LLM payload that mimics the shape of a real provider response.  
2. **Error handling** is isolated in **MockErrorHandler**, which intercepts any simulated failure (e.g., time‑outs, malformed payloads) and converts them into controlled exceptions that never leak into the calling application.  
3. **Observability** is provided by **LoggingAgent.logMockLLMInteraction()**, a dedicated logger that records every request/response pair, scenario selection, and any injected latency.  
4. **Testing integration** is achieved through **TestAdapter**, an adapter‑style façade that presents the mock service through the same entry points used by production LLM clients (e.g., the same request objects expected by **LLMFacade**).  

Because MockLLMService lives inside DockerizedServices, it shares the same container lifecycle and resource constraints as its siblings (**ServiceStarter**, **LLMFacade**, **ConstraintMonitor**, **DatabaseManager**).  This co‑location enables rapid in‑process calls without network hops, while still preserving the isolation guarantees that Docker provides.  The design does not introduce a separate micro‑service or event‑driven pipeline; instead, it follows a **library‑style** approach that can be swapped in place of a real LLM client at runtime.

---

## Implementation Details  

### Core Configuration  
* **MockLLMService.config.json** supplies top‑level switches (e.g., `enableLatency`, `maxTokens`).  The service reads this file at startup and caches the settings for the lifetime of the container.  

* **ScenarioConfig.json** is a map of scenario identifiers to response templates.  Each template may include placeholders for dynamic fields (e.g., timestamps, request IDs) that **MockLLMResponseGenerator** resolves on the fly.

### Response Generation  
The **MockLLMResponseGenerator** class exposes a method such as `generateResponse(request, scenarioId)`.  Internally it:

* Looks up the scenario definition in *ScenarioConfig.json*.  
* Applies any runtime substitutions (e.g., inserting the user prompt into a predefined answer).  
* Wraps the result in the same envelope (status code, headers, JSON body) that the real LLM provider would return, ensuring downstream parsers see no difference.

### Error Handling  
When a scenario is marked as “error” or when the generator encounters an unexpected condition, **MockErrorHandler** creates a controlled exception (e.g., `MockLLMTimeoutException`).  The handler guarantees that the exception hierarchy mirrors that of the real provider, allowing callers such as **LLMFacade** to trigger the same circuit‑breaker logic already present in the parent component.

### Logging  
Every interaction passes through **LoggingAgent.logMockLLMInteraction()**, which records:

* Timestamp, request payload, selected scenario, and generated response.  
* Any injected latency or error flags.  

These logs are emitted to the container’s standard output, making them visible to Docker’s logging drivers and any centralized log aggregation tooling used by the platform.

### Test Adapter  
**TestAdapter** implements the same interface that production code uses to talk to an LLM (e.g., a `callLLM(request)` method).  It internally forwards the request to **MockLLMService**, selects the appropriate scenario (often based on test metadata), and returns the mock response.  Because the adapter adheres to the production contract, test suites can replace the real LLM client with the mock with a single configuration change.

---

## Integration Points  

MockLLMService is tightly coupled with several surrounding components:

* **DockerizedServices (parent)** – provides the container runtime, shared environment variables, and the overall orchestration that starts and stops the mock alongside other services.  
* **LLMFacade (sibling)** – when the system is in “mock mode”, LLMFacade routes its calls through **TestAdapter**, thereby invoking MockLLMService instead of a live provider.  The same circuit‑breaker and caching layers that protect real LLM calls remain active, because the mock mimics the provider’s error surface.  
* **ConstraintMonitor and DatabaseManager (siblings)** – may consume mock LLM outputs during integration tests to verify constraint evaluation logic or persistence pipelines without external dependencies.  
* **MockLLMResponseGenerator (child)** – is the only concrete child component; its implementation is the engine that turns scenario definitions into realistic payloads.  

The only external dependencies are the JSON configuration files and the standard logging framework.  No network sockets, third‑party SDKs, or database connections are required, which keeps the mock lightweight and fast to start.

---

## Usage Guidelines  

1. **Select a Scenario Explicitly** – Test code should reference a scenario name defined in *ScenarioConfig.json* via the **TestAdapter**.  This makes the expected behaviour clear and prevents accidental reliance on a default scenario.  

2. **Configure Global Behaviour** – Adjust *MockLLMService.config.json* to reflect the performance characteristics you wish to emulate (e.g., enable artificial latency to test timeout handling).  Remember that changes require a container restart to take effect.  

3. **Do Not Mix Real and Mock Calls** – Ensure that the environment variable or configuration flag that toggles mock mode is applied consistently across all services.  Mixing real LLM calls with mock responses can lead to nondeterministic test results.  

4. **Leverage Logging** – Review the output of **LoggingAgent.logMockLLMInteraction()** when debugging failing tests.  The logs contain the exact request, scenario, and response, making it easy to pinpoint mismatches.  

5. **Handle Simulated Errors** – When a scenario is designed to raise an error, write test assertions that expect the same exception types that the real LLM client would surface.  This validates that higher‑level error‑recovery paths (e.g., the circuit‑breaker in **LLMFacade**) function correctly.  

---

### Architectural Patterns Identified  

* **Adapter Pattern** – embodied by **TestAdapter**, which presents the mock service through the same interface as a real LLM client.  
* **Strategy / Configuration‑Driven Behavior** – the use of *ScenarioConfig.json* and *MockLLMService.config.json* to swap response generation strategies at runtime.  
* **Composition over Inheritance** – the service composes distinct helper classes (response generator, error handler, logger) rather than inheriting a monolithic implementation.  

### Design Decisions and Trade‑offs  

* **Deterministic Testing vs. Real‑World Fidelity** – By generating responses from static JSON scenarios, tests become repeatable, but they may miss nuances of a live LLM (e.g., stochastic token sampling).  The trade‑off favours speed and predictability for CI pipelines.  
* **In‑Process Mock vs. Separate Service** – Keeping the mock inside the DockerizedServices container eliminates network latency and simplifies deployment, but it also means the mock shares the same resource pool as other services, potentially affecting isolation under heavy load.  
* **Explicit Error Simulation** – Providing a dedicated **MockErrorHandler** allows fine‑grained control over failure modes, at the cost of requiring test authors to maintain a catalogue of error scenarios.  

### System Structure Insights  

MockLLMService sits as a leaf node under **DockerizedServices**, with a single child (**MockLLMResponseGenerator**) that does the heavy lifting.  Its sibling services each address a different cross‑cutting concern (service startup, LLM façade, constraint evaluation, database access), and all of them can be exercised against the same mock LLM to achieve end‑to‑end test coverage without external dependencies.

### Scalability Considerations  

Because the mock runs in‑process and does not perform I/O beyond reading JSON files, it scales linearly with the number of concurrent test threads.  The primary limitation is the container’s CPU and memory allocation; if a test suite spawns a very large number of parallel LLM calls, artificial latency injection may become a bottleneck.  Scaling horizontally (running multiple DockerizedServices containers) is straightforward, as the mock has no state that must be shared across instances.

### Maintainability Assessment  

The separation of concerns—configuration, response generation, error handling, logging, and test adaptation—makes the codebase easy to extend.  Adding a new scenario is a matter of editing *ScenarioConfig.json*; introducing a new error type only requires a small addition to **MockErrorHandler**.  The reliance on plain JSON for configuration keeps the surface area low and approachable for non‑engineers (e.g., QA teams).  However, the lack of a formal schema for the JSON files could lead to malformed scenarios slipping through; introducing validation would improve robustness without significant overhead.  

Overall, MockLLMService provides a lightweight, well‑encapsulated mock layer that aligns with the architectural goals of DockerizedServices—fast, isolated, and observable testing of LLM‑driven features.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component serves as the Docker containerization layer for various coding services, including semantic analysis, constraint monitoring, and code-graph-rag, along with supporting databases. Its architecture involves a multi-agent system, utilizing a range of classes and functions to manage the different services and their interactions. The component is built around a high-level facade for interacting with LLM providers, implementing circuit breaking, caching, and budget checks to ensure efficient and controlled operation.

### Children
- [MockLLMResponseGenerator](./MockLLMResponseGenerator.md) -- The MockLLMResponseGenerator is mentioned in the parent context as a key component of the MockLLMService, indicating its importance in the overall architecture.

### Siblings
- [ServiceStarter](./ServiceStarter.md) -- ServiceStarter utilizes a retry mechanism with exponential backoff in ServiceStarter.py, handling transient service start failures
- [LLMFacade](./LLMFacade.md) -- LLMFacade uses CircuitBreaker.pattern to prevent cascading failures when interacting with LLM providers, protecting the system from overload
- [ConstraintMonitor](./ConstraintMonitor.md) -- ConstraintMonitor uses ConstraintEvaluator.class to evaluate code against defined constraints, detecting violations
- [DatabaseManager](./DatabaseManager.md) -- DatabaseManager uses DatabaseConnector.class to connect to databases, handling database interactions


---

*Generated from 6 observations*
