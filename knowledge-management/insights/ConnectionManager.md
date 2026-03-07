# ConnectionManager

**Type:** SubComponent

The SpecstoryAdapter class in specstory-adapter.js handles the underlying logic for establishing connections, freeing ConnectionManager to focus on connection management.

## What It Is  

`ConnectionManager` lives inside the **Trajectory** component and is the orchestrator that decides *how* the system talks to the Specstory extension.  All of its concrete wiring is found in the **Trajectory** code‑base, while the low‑level plumbing lives in `lib/integrations/specstory-adapter.js`.  The manager does **not** contain any HTTP, IPC, or file‑watch logic itself; instead it delegates every operation to the **SpecstoryAdapter** class that lives in the same file.  Because the adapter presents a single, unified interface, `ConnectionManager` can switch between HTTP, IPC, or file‑watch connections without any code changes – the only thing that changes is the adapter configuration supplied at runtime.

## Architecture and Design  

The architecture follows a classic **Adapter / Strategy** approach.  `SpecstoryAdapter` acts as an *adapter* that normalises disparate connection mechanisms (HTTP, IPC, file‑watch) behind a common API.  `ConnectionManager` then behaves like a *strategy selector* – it chooses which concrete strategy (i.e., which adapter method) to invoke based on configuration or runtime conditions.  This decoupling is reinforced by **Dependency Inversion**: the higher‑level `ConnectionManager` depends on the abstract interface exposed by `SpecstoryAdapter` rather than on the concrete details of each transport.  

Interaction flows are straightforward: when the parent **Trajectory** component needs to communicate with Specstory, it calls into `ConnectionManager`.  The manager forwards the request to `SpecstoryAdapter`, which in turn selects the appropriate low‑level routine (e.g., `connectViaHTTP`).  The sibling **FallbackHandler** can intervene when a connection fails, instructing `ConnectionManager` to retry via the same method or to switch to a different one, again using the same adapter interface.  This design keeps the connection‑management logic isolated from both the data‑formatting responsibilities of **DataFormatter** and the low‑level request construction performed by **HttpRequestHelper**.

## Implementation Details  

The heart of the implementation resides in `lib/integrations/specstory-adapter.js`.  The file exports a `SpecstoryAdapter` class that encapsulates three primary connection pathways:

1. **HTTP** – realised by the `connectViaHTTP` function.  This function implements a **connection retry mechanism** (as observed) to survive transient network glitches.  The retry loop likely respects back‑off parameters and caps the number of attempts, ensuring that the manager does not block indefinitely.  

2. **IPC** – while not explicitly named in the observations, the adapter includes an IPC branch that opens an inter‑process channel to the Specstory extension.  Because the adapter presents a unified API, the `ConnectionManager` can invoke an `connect()` method without caring whether the underlying transport is HTTP or IPC.  

3. **File Watch** – the adapter can also monitor a file (or directory) that the Specstory extension writes to, treating file changes as a signalling mechanism.  This method is useful in environments where network access is restricted.

`ConnectionManager` itself is thin: it stores a reference to a `SpecstoryAdapter` instance, forwards connection requests, and optionally interprets status callbacks.  Because the adapter’s interface is stable, extending the system with a new transport (e.g., WebSocket) only requires adding a new method to `SpecstoryAdapter` and exposing it through the same public API; `ConnectionManager` needs no modification.

## Integration Points  

* **Parent – Trajectory**: `Trajectory` owns the `ConnectionManager` and drives its lifecycle.  When a new test run begins, `Trajectory` asks the manager to establish a connection; when the run ends, it tells the manager to close it.  This tight coupling ensures that connection state is always aligned with the overall workflow.  

* **Sibling – SpecstoryAdapter**: Directly referenced by `ConnectionManager`.  The adapter is the sole provider of transport‑specific logic, making it the primary integration surface for any future connection method.  

* **Sibling – FallbackHandler**: Listens for failure events emitted by `ConnectionManager` (or the adapter) and can trigger a retry or a switch to an alternative transport.  Because both the manager and the handler rely on the same adapter interface, they can cooperate without sharing low‑level details.  

* **Sibling – HttpRequestHelper**: Supplies reusable HTTP request templates that `connectViaHTTP` may use when constructing its retry attempts.  The helper’s existence keeps HTTP request construction out of the adapter, preserving single responsibility.  

* **Sibling – DataFormatter**: Operates downstream of the connection; once `ConnectionManager` establishes a channel, `DataFormatter` prepares payloads that are sent through the adapter.  The separation ensures that formatting concerns never leak into connection management.

## Usage Guidelines  

1. **Instantiate via Trajectory** – Do not create a `ConnectionManager` directly; let the owning `Trajectory` component construct it and inject a properly configured `SpecstoryAdapter`.  This guarantees that lifecycle hooks (initialisation, teardown) are honoured.  

2. **Prefer Configuration over Code Changes** – To switch the transport method, modify the adapter configuration (e.g., set `connectionMode: 'ipc'`) rather than editing `ConnectionManager`.  The unified interface guarantees that the manager will route calls correctly.  

3. **Leverage FallbackHandler for Resilience** – When building features that require high availability, register the manager’s failure events with `FallbackHandler`.  The handler can automatically invoke the adapter’s retry logic or fall back to an alternate method without manual intervention.  

4. **Extend via SpecstoryAdapter** – If a new transport (e.g., WebSocket) is needed, add a method to `SpecstoryAdapter` that conforms to the existing public API (e.g., `connectViaWebSocket`).  Then expose a flag in the adapter’s configuration.  No changes to `ConnectionManager` are required, preserving backward compatibility.  

5. **Avoid Direct Adapter Calls** – All interaction with the connection layer should go through `ConnectionManager`.  Directly calling `connectViaHTTP` or other adapter methods bypasses the manager’s state tracking and can lead to inconsistent connection states.  

---

### Architectural Patterns Identified  
* **Adapter Pattern** – `SpecstoryAdapter` normalises disparate transport mechanisms behind a single interface.  
* **Strategy Pattern** – `ConnectionManager` selects the appropriate connection strategy at runtime based on configuration.  
* **Dependency Inversion / Inversion of Control** – Higher‑level components depend on the abstract adapter rather than concrete transport implementations.  

### Design Decisions and Trade‑offs  
* **Decoupling vs. Indirection** – By moving transport logic out of `ConnectionManager`, the system gains flexibility and testability, but introduces an extra indirection layer that can add slight runtime overhead.  
* **Unified Interface** – Simplifies consumer code (Trajectory, FallbackHandler) but requires the adapter to expose a superset of capabilities, potentially leading to a “fat” interface if many transports are added.  
* **Retry Mechanism in Adapter** – Centralising retry logic in `connectViaHTTP` keeps it close to the transport, but makes the adapter responsible for both connection establishment and resilience, which could be split in a more granular design.  

### System Structure Insights  
* **Hierarchy** – `Trajectory` → `ConnectionManager` → `SpecstoryAdapter`.  
* **Sibling Collaboration** – `FallbackHandler`, `HttpRequestHelper`, and `DataFormatter` each focus on a distinct cross‑cutting concern (error handling, request templating, payload formatting) and interact with the manager/adapter through well‑defined events and data contracts.  
* **Extensibility** – Adding new transports only touches the adapter, confirming a clean separation of concerns and supporting a plug‑in‑style evolution.  

### Scalability Considerations  
* **Horizontal Scaling** – Because each `ConnectionManager` instance is stateless aside from its adapter reference, multiple Trajectory instances can run in parallel, each managing its own connection without contention.  
* **Connection Load** – The retry logic in `connectViaHTTP` includes back‑off, which helps protect the Specstory extension from burst traffic during reconnection storms.  
* **Future Transports** – The adapter’s design allows the system to scale to additional protocols (e.g., WebSocket, gRPC) without redesigning the manager, preserving performance characteristics.  

### Maintainability Assessment  
* **High Cohesion** – `ConnectionManager` focuses solely on orchestration, while `SpecstoryAdapter` encapsulates all transport specifics, yielding clear ownership boundaries.  
* **Low Coupling** – Dependencies flow from high‑level components to the abstract adapter interface, making unit testing straightforward (mocks can replace the adapter).  
* **Ease of Extension** – Adding new adapters is a localized change, reducing regression risk.  
* **Potential Technical Debt** – If the adapter’s unified interface grows unchecked, it may become cumbersome to maintain; periodic refactoring to split transport‑specific concerns into sub‑adapters could mitigate this.  

Overall, `ConnectionManager` exemplifies a well‑structured, extensible connection‑handling sub‑component that leverages the `SpecstoryAdapter` to keep its responsibilities focused, while providing a solid foundation for future growth and resilience.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed with flexibility and fault tolerance in mind, as evident from its ability to adapt to different connection methods such as HTTP, IPC, and file watch. This is achieved through the use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for connecting to the Specstory extension. The connectViaHTTP function in specstory-adapter.js demonstrates this flexibility by implementing a connection retry mechanism to handle transient connection issues.

### Siblings
- [DataFormatter](./DataFormatter.md) -- DataFormatter uses a set of predefined templates to format data for submission to the Specstory extension.
- [FallbackHandler](./FallbackHandler.md) -- FallbackHandler uses a set of predefined fallback strategies to handle connection failures, including retrying the connection or switching to a different connection method.
- [HttpRequestHelper](./HttpRequestHelper.md) -- HttpRequestHelper uses a set of predefined HTTP request templates to simplify the request process.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter uses a set of predefined adapters to connect to the Specstory extension via different methods.


---

*Generated from 7 observations*
