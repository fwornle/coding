# ProtocolManager

**Type:** SubComponent

The ProtocolManager sub-component is crucial for a robust and fault-tolerant system, as it enables the Trajectory component to connect to external services via multiple protocols.

## What It Is  

ProtocolManager is a **sub‑component** that lives inside the **Trajectory** component. Its implementation is centred around the file **`lib/integrations/specstory-adapter.js`**, where it relies on the **`SpecstoryAdapter`** class. The primary responsibility of ProtocolManager is to decide which communication protocol should be used for a given connection and to invoke the corresponding method on the adapter (e.g., `connectViaHTTP`). By doing so, it enables the Trajectory component—and its sibling sub‑components such as **SpecstoryIntegration**, **LoggerManager**, **ConnectionHandler**, and **EnvironmentManager**—to reach external services through a variety of transports (HTTP, IPC, file‑watch, etc.). In short, ProtocolManager acts as the gate‑keeper that translates high‑level connection requirements into concrete adapter calls.

## Architecture and Design  

The observations reveal an **adapter‑centric architecture**. The `SpecstoryAdapter` class abstracts the low‑level details of each transport mechanism (HTTP, IPC, file‑watch) behind a uniform interface. ProtocolManager sits on top of this adapter and performs **protocol selection** based on the current environment and functional requirements. This selection logic is effectively a **strategy**: at runtime the component picks the “HTTP strategy” (`connectViaHTTP`), the “IPC strategy” (`connectViaIPC`), or the “file‑watch strategy” (`connectViaFileWatch`).  

Interaction flows are straightforward: higher‑level components (Trajectory, LoggerManager, ConnectionHandler, EnvironmentManager) request a connection; ProtocolManager evaluates context (environment, requirements) and delegates the call to the appropriate method on `SpecstoryAdapter`. The hierarchy context emphasises that the same adapter is shared across siblings, promoting **code reuse** and **consistent error handling**. Because the adapter lives in a single file (`lib/integrations/specstory-adapter.js`), any change to a transport implementation propagates automatically to all consumers, reinforcing a **single‑source‑of‑truth** design.

## Implementation Details  

* **`SpecstoryAdapter` (lib/integrations/specstory-adapter.js)** – This class encapsulates the concrete connection mechanisms. The observed methods include:
  * `connectViaHTTP` – establishes HTTP‑based communication with external services.
  * `connectViaIPC` – (mentioned in the hierarchy) enables inter‑process communication.
  * `connectViaFileWatch` – (mentioned in the hierarchy) watches file changes as a transport signal.  

* **ProtocolManager (sub‑component of Trajectory)** – It does not expose its own source file in the observations, but its behaviour is described as:
  * **Protocol selection** – determines the appropriate transport by inspecting the environment (e.g., development vs. production) and functional requirements (e.g., latency‑sensitive vs. bulk data).  
  * **Delegation** – once a protocol is chosen, it calls the matching method on `SpecstoryAdapter`. For HTTP connections the call is `SpecstoryAdapter.connectViaHTTP`.  

* **Error handling & fault tolerance** – The manager is described as “crucial for a robust and fault‑tolerant system,” implying that it likely wraps adapter calls with retry logic, fallback to alternative transports, and propagates structured error reports to the **SpecstoryIntegration** sub‑component for logging and monitoring.  

* **Shared usage** – Sibling components such as **SpecstoryIntegration** and **ConnectionHandler** also invoke `connectViaHTTP` directly via the adapter, while **LoggerManager** uses the adapter for conversation entry logging. This shared usage indicates that ProtocolManager’s primary value is the *decision‑making* layer rather than the transport implementation itself.

## Integration Points  

1. **Parent – Trajectory**: ProtocolManager is embedded within Trajectory, meaning any Trajectory operation that requires external communication first passes through ProtocolManager. This creates a clear vertical integration path: Trajectory → ProtocolManager → SpecstoryAdapter → external service.  

2. **Siblings – SpecstoryIntegration, LoggerManager, ConnectionHandler, EnvironmentManager**: All these components import `SpecstoryAdapter` from the same path (`lib/integrations/specstory-adapter.js`). While they can call adapter methods directly (e.g., `connectViaHTTP`), they also benefit from the protocol‑selection logic that ProtocolManager provides, especially when the environment changes at runtime.  

3. **External Services**: The actual endpoints are reached via the transports implemented in the adapter. For HTTP, `connectViaHTTP` likely builds request objects, handles headers, and processes responses. For IPC and file‑watch, analogous mechanisms apply.  

4. **Configuration / Environment**: The EnvironmentManager sibling supplies the contextual data (environment variables, feature flags) that ProtocolManager consumes to decide which protocol to employ. This creates a **configuration‑driven** integration point that decouples deployment specifics from business logic.

## Usage Guidelines  

* **Always route connection requests through ProtocolManager** when the calling code resides in Trajectory or any component that needs environment‑aware protocol selection. Direct calls to `SpecstoryAdapter` should be limited to cases where the transport is explicitly forced (e.g., testing a specific protocol).  

* **Do not hard‑code protocol names** in consumer code. Instead, describe the requirement (e.g., “low latency”, “cross‑process”) and let ProtocolManager map it to `connectViaHTTP`, `connectViaIPC`, or `connectViaFileWatch`.  

* **Handle errors at the ProtocolManager level**. Because ProtocolManager is positioned as the fault‑tolerance layer, callers should expect it to surface a unified error object that includes the underlying transport error and any fallback actions taken.  

* **Keep the adapter implementation isolated**. When adding a new transport (e.g., WebSocket), extend `SpecstoryAdapter` with a new method (e.g., `connectViaWebSocket`) and update ProtocolManager’s selection logic accordingly. This preserves the existing contract for all siblings.  

* **Synchronise configuration**: Ensure that EnvironmentManager’s settings (e.g., `USE_IPC=true`) are refreshed before ProtocolManager makes a selection. Stale configuration can lead to mismatched protocol choices.

---

### Architectural patterns identified  
* **Adapter pattern** – `SpecstoryAdapter` abstracts multiple transport mechanisms behind a common interface.  
* **Strategy‑like selection** – ProtocolManager chooses a concrete transport at runtime based on environment and requirements.  
* **Facade** – ProtocolManager presents a simplified, protocol‑agnostic API to its parent (Trajectory) and siblings.

### Design decisions and trade‑offs  
* **Centralised protocol decision** improves consistency and fault tolerance but adds a single point of logic that must be kept up‑to‑date with new transports.  
* **Sharing a single adapter** reduces code duplication and eases maintenance, yet couples all consumers to the same version of the transport implementation.  
* **Environment‑driven selection** enables flexibility across deployment contexts but requires reliable configuration propagation (handled by EnvironmentManager).

### System structure insights  
* The hierarchy is shallow: Trajectory → ProtocolManager → SpecstoryAdapter.  
* Sibling components interact directly with the adapter, indicating a **horizontal reuse** of transport code.  
* ProtocolManager acts as the vertical “glue” that aligns environment data with transport capabilities.

### Scalability considerations  
* Adding new protocols scales linearly: implement a new method in `SpecstoryAdapter` and extend the selection logic in ProtocolManager.  
* Because the adapter lives in a single file, concurrent modifications may need coordination (e.g., PR reviews) to avoid merge conflicts as the system grows.  
* The runtime selection mechanism can be extended with a registry or plug‑in map if the number of protocols becomes large, preserving O(1) lookup time.

### Maintainability assessment  
* **High maintainability** for transport code due to the single‑source adapter.  
* **Moderate maintainability** for selection logic: as more criteria (security, performance tiers) are added, ProtocolManager’s decision matrix may become complex and benefit from refactoring into a rule‑engine or configuration file.  
* Documentation should clearly state the contract of each adapter method and the expected input from EnvironmentManager to keep the system robust as it evolves.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's utilization of the SpecstoryAdapter class, located in lib/integrations/specstory-adapter.js, enables seamless connections to the Specstory extension via multiple protocols, including HTTP, IPC, and file watch. This adaptability is crucial for a robust and fault-tolerant system, as it allows the component to adjust its connection strategy based on the environment and requirements. For instance, the connectViaHTTP method in specstory-adapter.js facilitates HTTP-based connections, while the connectViaIPC method enables Inter-Process Communication. Furthermore, the connectViaFileWatch method allows the component to monitor file changes, demonstrating a flexible and modular design.

### Siblings
- [SpecstoryIntegration](./SpecstoryIntegration.md) -- SpecstoryIntegration uses the connectViaHTTP method in specstory-adapter.js to facilitate HTTP-based connections to the Specstory extension.
- [LoggerManager](./LoggerManager.md) -- LoggerManager utilizes the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to log conversation entries and manage logging activities.
- [ConnectionHandler](./ConnectionHandler.md) -- ConnectionHandler uses the connectViaHTTP method in specstory-adapter.js to facilitate HTTP-based connections to external services.
- [EnvironmentManager](./EnvironmentManager.md) -- EnvironmentManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to manage the environment and requirements for the Trajectory component.

---

*Generated from 6 observations*
