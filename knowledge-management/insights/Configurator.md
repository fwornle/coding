# Configurator

**Type:** SubComponent

Configurator provides a centralized location for configuration settings, making it easier to manage and update settings

## What It Is  

The **Configurator** is a dedicated sub‑component of the **Trajectory** module that centralises all configuration concerns for the trajectory‑related logic.  Although the exact source file is not enumerated in the observations, it lives inside the *Trajectory* hierarchy (e.g., alongside `ConnectionManager`, `LoggerModule`, `RetryMechanism`, `SpecstoryApiClient`, and `SpecstoryAdapter`).  Its primary responsibilities are to load configuration data from a persistent store (a configuration file or a database), expose a programmable API for reading and updating those settings, validate every change for internal consistency, and emit structured log entries whenever a configuration operation occurs.  By acting as the single source of truth for configuration, the Configurator removes the need for scattered hard‑coded values throughout the Trajectory code‑base.

## Architecture and Design  

The Configurator follows a **modular, centralized‑configuration** architectural style.  Rather than scattering configuration logic across multiple files, the design isolates it behind a well‑defined interface that the rest of Trajectory can depend upon.  This modularity is mirrored in the sibling components: for example, `ConnectionManager` delegates transport‑specific concerns to `SpecstoryAdapter`, while `LoggerModule` supplies a separate logger instance via `createLogger` (see `../logging/Logger.js`).  The Configurator similarly provides its own logger (observed as “logging functionality provides insight into configuration changes”) which keeps its diagnostics independent yet consistent with the system‑wide logging strategy.

Key design patterns that emerge from the observations are:

* **Facade / Wrapper** – the Configurator hides the underlying persistence mechanism (file vs. database) behind a uniform API, allowing callers to request or update settings without knowing where they are stored.  
* **Validation Guard** – before any setting is persisted, a validation step checks that the new value respects domain rules, guaranteeing that the configuration remains “valid and consistent.”  
* **Observer‑like Logging** – each mutation triggers a log entry, giving operators visibility into configuration drift and supporting audit trails.  

Interactions are straightforward: the Trajectory component queries the Configurator for values needed by connection methods (e.g., HTTP endpoint URLs used by `connectViaHTTP` in `SpecstoryAdapter`), while the Configurator may be invoked by higher‑level orchestration tools or UI panels that allow runtime re‑configuration.

## Implementation Details  

Although the concrete file path for the Configurator is not disclosed, the observations outline its functional building blocks:

1. **Configuration Store Access** – a module reads from either a JSON/YAML file or a database table.  The choice is abstracted so that swapping the store does not affect callers.  
2. **Centralised Logger** – the Configurator creates its own logger instance (likely via the same `createLogger` factory used by `LoggerModule`) to record every read, write, and validation event.  This mirrors the logging approach employed by `SpecstoryAdapter` and other siblings, ensuring uniform log formatting and destination handling.  
3. **Customisable Settings API** – public functions such as `getSetting(key)`, `setSetting(key, value)`, and `resetToDefaults()` expose a programmable surface.  Because the settings are “customizable,” developers can extend the schema without touching core logic, simply by adding new entries to the underlying store.  
4. **Validation Mechanism** – before persisting a change, a validator function checks type constraints, range limits, and cross‑field dependencies.  If validation fails, the Configurator rejects the update and logs an error, preventing inconsistent states from propagating to dependent modules like `ConnectionManager`.  
5. **Change‑Tracking & Auditing** – every successful update is logged with a timestamp, the user or process that performed the change, and the before/after values.  This aligns with the system‑wide logging strategy and aids debugging of configuration‑related issues.

The Configurator therefore acts as a thin, well‑encapsulated layer that mediates between persistent storage, runtime consumers, and the logging subsystem.

## Integration Points  

* **Trajectory (Parent)** – The Trajectory component queries the Configurator during initialization to obtain parameters such as retry limits, connection endpoints, and feature toggles.  Because Trajectory also owns siblings like `ConnectionManager` and `SpecstoryAdapter`, those modules indirectly depend on the Configurator for the values they need to operate.  
* **ConnectionManager & SpecstoryAdapter (Siblings)** – When a connection method (e.g., `connectViaHTTP` in `lib/integrations/specstory-adapter.js`) requires an endpoint URL or timeout, it calls the Configurator’s getter.  Conversely, if a connection failure triggers a dynamic re‑configuration (e.g., adjusting back‑off intervals), the Configurator’s setter is invoked to persist the new policy.  
* **LoggerModule (Sibling)** – The Configurator re‑uses the logger factory (`../logging/Logger.js`) to stay consistent with the rest of the system’s logging approach.  This ensures that configuration logs appear alongside connection and retry logs in a unified stream.  
* **External Tools** – Any administrative UI or CLI that wishes to modify trajectory behaviour can call the Configurator’s public API.  Because validation is built‑in, external callers are protected from introducing illegal settings.  

The only explicit dependency visible is on the shared logging facility; the persistence layer (file or DB) is abstracted away, allowing the Configurator to be swapped without affecting its consumers.

## Usage Guidelines  

1. **Always use the provided API** – Direct file or database manipulation bypasses validation and logging, risking inconsistent configuration states.  Access settings through the Configurator’s `getSetting` / `setSetting` methods.  
2. **Leverage validation** – When adding new configuration keys, extend the validator to capture type and range constraints.  This keeps the “valid and consistent” guarantee intact.  
3. **Prefer defaults over hard‑coding** – The Configurator supports default values; rely on these defaults rather than embedding literals in connection code.  This improves maintainability and aligns with the modular approach highlighted in the Trajectory architecture.  
4. **Monitor logs** – Because every change is logged, operators should watch the Configurator’s log channel for unexpected updates, especially in production environments.  
5. **Treat the Configurator as a single source of truth** – Do not replicate configuration values elsewhere in the code‑base; always retrieve the current value from the Configurator to avoid drift.

---

### 1. Architectural patterns identified  
* Facade/Wrapper around persistent configuration store  
* Validation Guard (pre‑commit validation)  
* Centralised logging (observer‑like pattern for change events)  

### 2. Design decisions and trade‑offs  
* **Centralisation vs. flexibility** – Centralising settings simplifies management but introduces a single point of failure; the modular validator mitigates this by preventing bad data.  
* **File vs. DB storage** – Abstracting the store gives flexibility to switch back‑ends, at the cost of a thin abstraction layer that must be kept in sync with both storage mechanisms.  
* **Logging integration** – Re‑using the system logger ensures consistency but couples the Configurator to the logging implementation; any change to the logger API would ripple to the Configurator.  

### 3. System structure insights  
The Configurator sits directly under the **Trajectory** component, acting as a shared service for its siblings (`ConnectionManager`, `SpecstoryAdapter`, etc.).  Its API is the contract through which all trajectory‑related modules obtain runtime parameters, reinforcing the “modular approach to configuration management” described in the observations.

### 4. Scalability considerations  
Because configuration reads are typically cheap, the Configurator can be instantiated as a singleton without performance concerns.  Scaling challenges arise only if the underlying store becomes a bottleneck (e.g., a heavily contended database).  In such cases, caching the configuration in memory and refreshing on change events would preserve responsiveness while retaining centralised control.

### 5. Maintainability assessment  
The modular, validated, and logged design strongly supports maintainability: new settings can be added without touching consumer code, validation guarantees stability, and logs provide traceability.  The primary maintenance burden lies in keeping the validator and persistence abstraction up‑to‑date as the configuration schema evolves, but this is a bounded and well‑encapsulated effort.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's modular architecture is evident in its use of separate connection methods, such as connectViaHTTP, connectViaIPC, and connectViaFileWatch, each with its own implementation in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js). This design decision allows for flexibility and maintainability, as individual connection methods can be updated or modified without affecting the overall system. For instance, the connectViaHTTP function (lib/integrations/specstory-adapter.js) implements a retry mechanism to handle connection failures, demonstrating a robust approach to error handling. The use of a separate logger instance, created via the createLogger function (../logging/Logger.js), further enhances the system's reliability by providing a centralized logging mechanism.

### Siblings
- [ConnectionManager](./ConnectionManager.md) -- ConnectionManager leverages the SpecstoryAdapter class (lib/integrations/specstory-adapter.js) for implementing connection methods
- [LoggerModule](./LoggerModule.md) -- LoggerModule creates a separate logger instance via the createLogger function (../logging/Logger.js) for the Trajectory component
- [RetryMechanism](./RetryMechanism.md) -- RetryMechanism is implemented in the connectViaHTTP function (lib/integrations/specstory-adapter.js) to handle connection failures
- [SpecstoryApiClient](./SpecstoryApiClient.md) -- SpecstoryApiClient is responsible for providing an API client for interacting with the Specstory extension
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter is responsible for adapting the Specstory extension to the Trajectory component's architecture


---

*Generated from 7 observations*
