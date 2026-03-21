# LoggerManager

**Type:** SubComponent

LoggerManager uses the createLogger function from logging/Logger.js to establish a logger instance, providing a standardized logging mechanism for various components.

## What It Is  

`LoggerManager` is a **SubComponent** that lives inside the **Trajectory** component.  Its implementation is centred around the **`logging/Logger.js`** module – every logger instance that `LoggerManager` creates is obtained by calling the exported **`createLogger`** function from that file.  By delegating logger creation and configuration to this shared module, `LoggerManager` supplies a **standardised, configurable logging mechanism** for the rest of the system (e.g., `SpecstoryConnector`, `LoggingGateway`, `ConversationFormatter`, and any other component that needs to emit diagnostic information).

The primary responsibilities of `LoggerManager` are:

* invoking `createLogger` to obtain a logger object,  
* configuring that logger (log level, output destinations such as console or file), and  
* exposing the configured logger to downstream components that require logging services.

Because `LoggerManager` is a child of **Trajectory**, it inherits the broader logging strategy that the parent component adopts – the same `createLogger` factory is referenced by the parent’s own code and by several sibling sub‑components, ensuring a **unified logging approach** across the whole feature set.

---

## Architecture and Design  

The observations reveal a **modular architecture** built around a shared logging library:

1. **Factory Pattern** – `logging/Logger.js` exports a `createLogger` function that encapsulates the construction of logger objects.  `LoggerManager` calls this factory rather than instantiating loggers directly, guaranteeing that every logger conforms to the same interface and default configuration.

2. **Singleton Pattern** – The same `logging/Logger.js` module is described as implementing a Singleton, meaning that the underlying logger implementation maintains a single, globally‑accessible instance.  This design ensures that configuration changes (e.g., adjusting the log level) propagate consistently throughout the process, eliminating divergent logger states.

3. **Modular / Shared‑Component Design** – `LoggerManager` does not embed logging logic itself; it **uses** the external `logging/Logger.js` module.  This separation of concerns makes the logging capability a reusable building block for all siblings (`LoggingGateway`, `ConversationFormatter`, etc.) and for the parent `Trajectory`.

Interaction flow:

* A component (e.g., `SpecstoryConnector`) requests a logger from `LoggerManager`.  
* `LoggerManager` calls `createLogger` (from `logging/Logger.js`).  
* The factory either returns the existing singleton logger or creates a new one if the singleton has not yet been instantiated.  
* `LoggerManager` applies configuration (log level, destination) and returns the ready‑to‑use logger to the caller.

Because the singleton lives inside `logging/Logger.js`, any component that directly imports `createLogger` (such as `LoggingGateway`) will receive the same underlying logger instance, reinforcing a **shared logging approach** across the subsystem.

---

## Implementation Details  

### Core Functions  

* **`logging/Logger.js → createLogger`** – This is the sole entry point for logger creation.  The function encapsulates the construction of a logger object, applying default formatting rules and wiring output transports.  Internally it checks whether a logger instance already exists; if so, it returns that instance (Singleton behaviour), otherwise it creates and stores a new one (Factory behaviour).

### `LoggerManager` Behaviour  

* **Invocation of the factory** – `LoggerManager` imports `createLogger` and calls it each time a logger is needed.  Because `createLogger` returns the singleton, repeated calls do not create duplicate resources.  
* **Configuration handling** – After obtaining the logger, `LoggerManager` sets **log levels** (e.g., `debug`, `info`, `warn`, `error`) and **output destinations** (console, file, or potentially remote sinks).  These settings are derived from configuration objects passed to `LoggerManager` or from environment variables, although the exact source is not detailed in the observations.  
* **Exposure to callers** – The configured logger is either returned directly from a `getLogger()`‑style method or injected into other components during their construction.  This pattern allows sibling components such as `SpecstoryConnector` and `ConversationFormatter` to log without needing to know the details of logger creation.

### Relationship to Parent and Siblings  

* **Parent (`Trajectory`)** – The parent component also references `createLogger` (as noted in the hierarchy context).  This indicates that `Trajectory` either delegates logger creation to `LoggerManager` or uses the same factory independently, reinforcing a **consistent logging contract** across the parent‑child boundary.  
* **Siblings** – `LoggingGateway` directly uses `createLogger`, while `ConversationFormatter` relies on a **standardized logging format** that `LoggerManager` helps enforce.  The shared use of the same logger instance means that log entries from different siblings appear in a uniform structure and are routed to the same destinations.

---

## Integration Points  

1. **`logging/Logger.js` (Factory / Singleton)** – The sole external dependency of `LoggerManager`.  All configuration and output plumbing is defined inside this module.  

2. **Parent Component – `Trajectory`** – `Trajectory` may instantiate `LoggerManager` or call its API to obtain a logger for its own internal operations.  The parent’s reliance on the same `createLogger` function guarantees that logs emitted from the parent and its children are co‑located.  

3. **Sibling Sub‑components** –  
   * **`LoggingGateway`**: Calls `createLogger` directly, receiving the same singleton logger.  
   * **`ConversationFormatter`**: Consumes the *standardized logging format* that `LoggerManager` helps enforce, ensuring conversation‑related logs are consistent.  
   * **`SpecstoryConnector`, `RetryPolicyManager`, `ConnectionMonitor`**: All obtain a logger via `LoggerManager` (or indirectly through the shared factory) to record connection attempts, retry events, and monitoring data.  

4. **Configuration Sources** – While not explicitly listed, the observations mention “setting log levels and output destinations”.  This suggests that `LoggerManager` reads configuration from a central settings object, environment variables, or a configuration file, and then applies those values to the logger returned by `createLogger`.

---

## Usage Guidelines  

* **Always obtain a logger through `LoggerManager`** (or the `createLogger` factory) rather than constructing a logger manually.  This guarantees that the singleton instance and the agreed‑upon format are used.  
* **Configure log level early** – Set the desired log level as soon as `LoggerManager` is instantiated.  Because the logger is a singleton, changing the level later will affect all components that share the same instance.  
* **Prefer the shared logger for cross‑component diagnostics** – If a component needs to correlate its logs with those of other siblings (e.g., tracing a request through `SpecstoryConnector` → `ConnectionMonitor`), use the logger supplied by `LoggerManager` to keep the output unified.  
* **Do not duplicate output destinations** – Adding extra transports (file, remote) inside a component that already receives the shared logger can lead to duplicated log entries.  Instead, configure destinations centrally via `LoggerManager`.  
* **Respect the standardized format** – When emitting structured logs (JSON payloads, timestamps, component identifiers), follow the format defined in `logging/Logger.js`.  This ensures that downstream log aggregators or the `ConversationFormatter` can parse entries correctly.

---

### Architectural patterns identified  

* **Factory Pattern** – `createLogger` abstracts logger construction.  
* **Singleton Pattern** – `logging/Logger.js` maintains a single logger instance across the process.  
* **Modular Architecture** – Logging concerns are isolated in a dedicated module (`logging/Logger.js`) and consumed by multiple components.

### Design decisions and trade‑offs  

* **Centralised singleton logger** simplifies configuration propagation but couples all components to a single logging instance, which can limit per‑component customisation.  
* **Factory abstraction** provides a clean entry point and allows future replacement of the underlying logging library without touching each consumer.  
* **Modular separation** keeps logging logic out of business components, enhancing testability, but introduces an additional import dependency that must be kept in sync across the codebase.

### System structure insights  

* `LoggerManager` sits as a leaf under `Trajectory`, acting as the **gateway** to the shared logging facility.  
* Sibling components either call `LoggerManager` or the factory directly, forming a **star‑topology** around the singleton logger.  
* The hierarchy demonstrates a **single source of truth** for logging configuration, reducing duplication across the subsystem.

### Scalability considerations  

* Because the logger is a singleton, scaling the process horizontally (multiple Node.js instances) will result in **independent logger instances per process**; any cross‑process aggregation must rely on external log collectors rather than the in‑process singleton.  
* Adding new destinations (e.g., a remote log aggregation service) can be done centrally in `logging/Logger.js` without modifying each consumer, supporting **vertical scalability** of log volume.  

### Maintainability assessment  

* The clear separation of concerns (factory + singleton in `logging/Logger.js`, configuration in `LoggerManager`) makes the logging subsystem **easy to maintain**; changes to format or transport affect only one file.  
* However, the heavy reliance on a global singleton means that **unintended side effects** (e.g., a component changing the log level globally) can impact unrelated parts of the system, requiring disciplined usage guidelines.  
* Overall, the design balances **reusability** and **simplicity**, yielding a maintainable logging foundation for the `Trajectory` component and its siblings.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js demonstrates a modular architecture, allowing for the management of connections and logging in a flexible and adaptable manner. This class implements a retry mechanism for connection establishment, showcasing a RetryPolicy pattern. The connectViaHTTP method in this class attempts to connect to the Specstory extension via HTTP on multiple ports, highlighting a flexible connection establishment approach. Furthermore, the createLogger function from logging/Logger.js is used to establish a logger instance, providing a standardized logging mechanism.

### Siblings
- [SpecstoryConnector](./SpecstoryConnector.md) -- SpecstoryConnector uses the connectViaHTTP method in SpecstoryAdapter to attempt connections to the Specstory extension on multiple ports, demonstrating a flexible connection establishment approach.
- [RetryPolicyManager](./RetryPolicyManager.md) -- RetryPolicyManager implements a retry mechanism with limited retries, demonstrating a fault-tolerant approach to handling failures and retries.
- [ConversationFormatter](./ConversationFormatter.md) -- ConversationFormatter uses a standardized logging format to format conversation entries, ensuring a unified logging approach for conversation-related events.
- [ConnectionMonitor](./ConnectionMonitor.md) -- ConnectionMonitor uses the SpecstoryAdapter class to monitor the status of connections to the Specstory extension, demonstrating a real-time feedback mechanism.
- [LoggingGateway](./LoggingGateway.md) -- LoggingGateway uses the createLogger function from logging/Logger.js to establish a logger instance, providing a standardized logging mechanism for various components.

---

*Generated from 7 observations*
