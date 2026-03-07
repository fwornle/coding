# DatabaseManager

**Type:** SubComponent

DatabaseManager logs database interactions using LoggingAgent.logDatabaseInteraction(), providing visibility into database usage

## What It Is  

**DatabaseManager** is the dedicated sub‑component that orchestrates all interactions with persistent storage inside the **DockerizedServices** container.  The implementation lives alongside its configuration file **`DatabaseManager.config.json`**, which is the single source of truth for runtime behavior such as selected database type, connection pools, and retry policies.  At runtime DatabaseManager delegates the low‑level connection work to **`DatabaseConnector.class`**, chooses the appropriate driver through **`DatabaseFactory.class`**, records every operation with **`LoggingAgent.logDatabaseInteraction()`**, and isolates failures by invoking **`DatabaseErrorHandler.class`**.  For the rest of the code‑base it presents a clean façade to the data‑access layer via **`DataAccessAdapter.class`**, allowing higher‑level services (e.g., the LLM‑driven agents in DockerizedServices) to read and write data without needing to know the underlying database technology.

---

## Architecture and Design  

The design of DatabaseManager is a textbook example of **separation of concerns** expressed through well‑known object‑oriented patterns that are explicitly referenced in the observations:

1. **Factory Pattern** – `DatabaseFactory.class` abstracts the creation of concrete database connectors (e.g., PostgreSQLConnector, MySQLConnector).  This enables the component to support *multiple database types* without hard‑coding any one driver, fulfilling the flexibility requirement described in observation 2.  

2. **Adapter Pattern** – `DataAccessAdapter.class` acts as a bridge between the generic data‑access contracts used by the rest of the system and the concrete operations offered by the selected connector.  This “seamless data access” (observation 6) lets sibling services such as **ServiceStarter** or **ConstraintMonitor** consume data without coupling to a specific DB API.  

3. **Logging/Observer Concern** – `LoggingAgent.logDatabaseInteraction()` is injected wherever DatabaseManager performs a query or transaction, providing centralized visibility (observation 3).  The logging agent can be considered an implicit observer that records each interaction for debugging, auditing, or performance monitoring.  

4. **Error‑Handling Strategy** – `DatabaseErrorHandler.class` encapsulates all exception translation and recovery logic, preventing raw database errors from bubbling up to the application layer (observation 4).  This mirrors the circuit‑breaker approach used by the sibling **LLMFacade**, reinforcing a consistent resilience posture across the DockerizedServices ecosystem.  

The component is configured through a JSON file (`DatabaseManager.config.json`), a lightweight but expressive mechanism that allows operators to change the selected factory, connection pool sizes, or logging verbosity without recompiling code.  This configuration‑driven approach dovetails with the parent **DockerizedServices** philosophy of runtime‑tunable services deployed in containers.

---

## Implementation Details  

### Core Classes  

| Class | Responsibility | Key Interaction |
|-------|----------------|-----------------|
| **DatabaseManager** (entry point) | Provides the public API for CRUD operations, transaction handling, and health checks. | Calls `DatabaseFactory` to obtain a `DatabaseConnector`; forwards calls to `DataAccessAdapter`; logs via `LoggingAgent`; catches exceptions and forwards them to `DatabaseErrorHandler`. |
| **DatabaseFactory.class** | Determines which concrete connector to instantiate based on configuration (e.g., `type: "postgres"`). | Reads `DatabaseManager.config.json`; returns an instance of `DatabaseConnector` (or subclass). |
| **DatabaseConnector.class** | Encapsulates the low‑level driver (JDBC, async driver, etc.) and connection lifecycle. | Exposes `connect()`, `executeQuery()`, `close()`; used exclusively by DatabaseManager. |
| **DataAccessAdapter.class** | Translates generic data‑access requests (e.g., `saveEntity`, `fetchById`) into concrete SQL or NoSQL commands understood by the connector. | Receives calls from DatabaseManager; invokes `DatabaseConnector` methods; returns domain objects. |
| **LoggingAgent.logDatabaseInteraction()** | Centralized logger that records query strings, execution time, and outcome. | Invoked before and after each database operation. |
| **DatabaseErrorHandler.class** | Normalizes exceptions (e.g., turning SQLIntegrityConstraintViolationException into a domain‑specific `DuplicateKeyError`). | Wrapped around all connector calls; decides whether to retry, fallback, or surface a clean error. |

### Configuration  

`DatabaseManager.config.json` holds entries such as:

```json
{
  "databaseType": "postgres",
  "connectionPoolSize": 20,
  "retryPolicy": { "maxAttempts": 3, "backoffMs": 200 },
  "loggingLevel": "INFO"
}
```

During container startup, DockerizedServices loads this file and passes the parsed values to `DatabaseFactory`, which in turn configures the `DatabaseConnector`.  Because the parent component already provides a Docker‑level environment (networking, volume mounts), the config file can be externalized as a volume mount, enabling rapid reconfiguration without rebuilding the image.

### Error Flow  

When a query fails, the sequence is:

1. `DatabaseManager` calls `DataAccessAdapter`.
2. `DataAccessAdapter` invokes the appropriate method on `DatabaseConnector`.
3. The connector throws a low‑level exception.
4. Control returns to `DatabaseManager`, which catches the exception and forwards it to `DatabaseErrorHandler`.
5. `DatabaseErrorHandler` evaluates the exception type, applies the retry policy from the config, logs the incident via `LoggingAgent`, and finally either retries or throws a sanitized domain exception back to the caller.

---

## Integration Points  

- **Parent – DockerizedServices**: DatabaseManager is packaged as part of the Docker image that also contains semantic analysis, constraint monitoring, and LLM facades.  The parent component supplies the container runtime, networking, and shared environment variables that the manager uses to locate the database host (e.g., via `DB_HOST` env var).  

- **Sibling Components**:  
  * **ServiceStarter** may rely on DatabaseManager during its health‑check phase to verify that the underlying DB is reachable before declaring the service “started”.  
  * **LLMFacade** uses the same logging and circuit‑breaker concepts that DatabaseManager employs via `LoggingAgent` and `DatabaseErrorHandler`, ensuring a uniform failure‑handling strategy across the stack.  
  * **MockLLMService** and **ConstraintMonitor** both read configuration data stored in the database (e.g., mock response templates or constraint definitions) through the `DataAccessAdapter`, illustrating how the adapter provides a common contract for diverse consumers.  

- **Child – DatabaseConnector**: The connector is the only class that directly knows about the concrete driver libraries (JDBC, async client, etc.).  All higher‑level code interacts with it indirectly through DatabaseManager, preserving encapsulation and allowing the connector implementation to be swapped without affecting callers.  

- **External Services**: Because DatabaseManager is containerized, it can be linked to external database services (managed PostgreSQL, MySQL, etc.) via Docker networking.  The configuration JSON defines the endpoint, credentials, and TLS settings, making the integration point explicit and version‑controlled.

---

## Usage Guidelines  

1. **Initialize via Configuration** – Always ensure that `DatabaseManager.config.json` is present in the container’s filesystem (or mounted as a volume) before the service starts.  Missing or malformed configuration will cause `DatabaseFactory` to abort, preventing the component from starting.  

2. **Prefer the Public API** – Callers should interact only with the methods exposed by `DatabaseManager`.  Direct use of `DatabaseConnector` or `DataAccessAdapter` is discouraged, as it bypasses logging and error handling.  

3. **Respect Transaction Boundaries** – When performing multiple related writes, wrap them in a transaction provided by `DatabaseManager`.  The manager will coordinate commit/rollback via the underlying connector and ensure that `DatabaseErrorHandler` can apply retry logic where appropriate.  

4. **Monitor Logs** – `LoggingAgent.logDatabaseInteraction()` emits structured logs (timestamp, query, duration, status).  Integrate these logs with the DockerizedServices observability stack (e.g., ELK or Prometheus) to detect latency spikes or error bursts early.  

5. **Handle Domain Exceptions** – After a database call, catch only the high‑level exceptions defined by `DatabaseErrorHandler` (e.g., `DuplicateKeyError`, `ConnectionUnavailableError`).  Do not attempt to parse low‑level driver messages; the handler already normalizes them.  

6. **Testing Strategy** – For unit tests, replace `DatabaseFactory` with a mock that returns an in‑memory `DatabaseConnector` (e.g., SQLite) and verify that `LoggingAgent` receives the expected calls.  Integration tests should spin up a real database container and point `DatabaseManager.config.json` to it via Docker compose overrides.

---

### 1. Architectural patterns identified  
* **Factory Pattern** – `DatabaseFactory.class` creates concrete connectors based on configuration.  
* **Adapter Pattern** – `DataAccessAdapter.class` maps generic data‑access requests to specific driver calls.  
* **Centralized Logging (Observer‑like)** – `LoggingAgent.logDatabaseInteraction()` records every DB operation.  
* **Error‑Handling Strategy** – `DatabaseErrorHandler.class` encapsulates exception translation and retry logic.  

### 2. Design decisions and trade‑offs  
* **Flexibility vs. Complexity** – Using a factory and adapter makes it easy to support new databases, but adds an extra indirection layer that can impact performance and increase the learning curve for new developers.  
* **Configuration‑Driven Behavior** – JSON‑based config enables runtime tuning without code changes, at the cost of requiring disciplined configuration management and validation.  
* **Explicit Error Isolation** – Centralizing error handling prevents leaks of low‑level exceptions, improving robustness, but may mask underlying driver‑specific diagnostics if not logged thoroughly.  

### 3. System structure insights  
DatabaseManager sits as a **SubComponent** inside the DockerizedServices container, with a clear parent‑child relationship to **DockerizedServices** (container orchestration) and **DatabaseConnector** (low‑level driver).  Its siblings each address orthogonal concerns (service startup, LLM interaction, mocking, constraint evaluation) but share common resilience mechanisms (circuit breaking, logging).  The component’s internal modules (factory, adapter, error handler, logger) each have a single responsibility, reinforcing modularity.  

### 4. Scalability considerations  
* **Horizontal Scaling** – Because DatabaseManager is stateless aside from connection pooling, multiple container instances can be deployed behind a load balancer, each pulling the same `DatabaseManager.config.json`.  
* **Connection Pooling** – Configurable pool size in the JSON allows the system to handle increased concurrent traffic without exhausting DB resources.  
* **Logging Overhead** – High‑frequency logging may become a bottleneck; the logging level can be tuned via config to balance observability with throughput.  

### 5. Maintainability assessment  
The component exhibits **high maintainability** thanks to:
* Clear separation of concerns via well‑known patterns.  
* Centralized configuration that isolates environment‑specific details.  
* Dedicated error‑handling and logging modules that localize cross‑cutting concerns.  
* Minimal coupling to sibling components; interactions occur through stable contracts (e.g., the adapter).  
Potential maintenance challenges include keeping the configuration schema in sync with code changes and ensuring that any new database driver adheres to the `DatabaseConnector` contract.  Regular automated tests that validate factory selection, adapter translation, and error handling will mitigate these risks.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component serves as the Docker containerization layer for various coding services, including semantic analysis, constraint monitoring, and code-graph-rag, along with supporting databases. Its architecture involves a multi-agent system, utilizing a range of classes and functions to manage the different services and their interactions. The component is built around a high-level facade for interacting with LLM providers, implementing circuit breaking, caching, and budget checks to ensure efficient and controlled operation.

### Children
- [DatabaseConnector](./DatabaseConnector.md) -- The DatabaseConnector is used by the DatabaseManager to connect to databases, as mentioned in the parent context.

### Siblings
- [ServiceStarter](./ServiceStarter.md) -- ServiceStarter utilizes a retry mechanism with exponential backoff in ServiceStarter.py, handling transient service start failures
- [LLMFacade](./LLMFacade.md) -- LLMFacade uses CircuitBreaker.pattern to prevent cascading failures when interacting with LLM providers, protecting the system from overload
- [MockLLMService](./MockLLMService.md) -- MockLLMService uses MockLLMResponseGenerator.class to generate mock LLM responses, simulating real LLM behavior
- [ConstraintMonitor](./ConstraintMonitor.md) -- ConstraintMonitor uses ConstraintEvaluator.class to evaluate code against defined constraints, detecting violations


---

*Generated from 6 observations*
