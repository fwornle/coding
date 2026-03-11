# SpecstoryConnector

**Type:** SubComponent

SpecstoryConnector utilizes the connectViaHTTP() function in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js) to send HTTP requests to the Specstory extension and handle responses.

## What It Is  

The **SpecstoryConnector** is a sub‑component that lives inside the *Trajectory* hierarchy and is responsible for communicating with the external **Specstory** extension. Its implementation is spread across the integration layer found at `lib/integrations/specstory-adapter.js`. Within this file the `SpecstoryAdapter` class exposes three distinct asynchronous entry points – `connectViaHTTP()`, `connectViaIPC()` and `connectViaFileWatch()` – that the connector can invoke depending on the runtime environment. In the HTTP‑based path the connector calls the shared utility `httpRequest()` to issue the actual request and to process the response payload. The connector therefore acts as a thin façade that delegates the low‑level transport concerns to the adapter while exposing a stable API to its parent component **Trajectory** and to sibling components such as **ConversationLogger**.

## Architecture and Design  

The observed code demonstrates a **modular, separation‑of‑concerns** architecture. The `SpecstoryAdapter` class encapsulates all transport‑specific logic, while the `SpecstoryConnector` focuses on higher‑level orchestration. This division is evident in the way the connector simply invokes `connectViaHTTP()` (or the IPC / file‑watch alternatives) and lets the adapter handle the details of request construction, socket handling, or file‑system monitoring. The asynchronous nature of each connection method (all returning promises) reflects an **asynchronous I/O** design that allows the surrounding system – notably the parent *Trajectory* component – to remain responsive regardless of which transport is in use.

The three connection functions (`connectViaHTTP()`, `connectViaIPC()`, `connectViaFileWatch()`) form a **strategy‑like** set of alternatives: the runtime can select the most appropriate strategy based on environment capabilities (e.g., a server with HTTP access, a desktop process that can use IPC, or a constrained environment that only permits file‑watch signaling). The connector does not embed any conditional logic for choosing the strategy; that responsibility is delegated upward to *Trajectory*, which, according to the hierarchy context, “handles multiple connection methods” and therefore can decide which adapter method to call.

## Implementation Details  

`lib/integrations/specstory-adapter.js` houses the `SpecstoryAdapter` class. Its public API consists of three async methods:

* **`connectViaHTTP()`** – builds an HTTP request using the shared `httpRequest()` helper, sends it to the Specstory extension’s HTTP endpoint, and returns the parsed response. The helper abstracts away low‑level node/http or fetch details, ensuring that the adapter remains focused on request semantics rather than transport plumbing.  

* **`connectViaIPC()`** – opens an inter‑process channel (likely via Node’s `net` or `child_process` modules) to the Specstory extension, exchanges messages, and resolves with the extension’s reply. The method’s asynchronous signature lets callers await completion without blocking the event loop.  

* **`connectViaFileWatch()`** – watches a predefined file or directory for changes (using `fs.watch` or similar), writes a request payload to a trigger file, and reads the response once the extension writes back. This approach provides a fallback where network or IPC mechanisms are unavailable.

The **SpecstoryConnector** itself does not expose its own transport code; instead, it invokes the appropriate `SpecstoryAdapter` method and forwards the result to its callers. The connector also re‑uses the `httpRequest()` function directly when the HTTP path is selected, reinforcing the adapter’s role as a thin wrapper rather than a duplicated implementation.

## Integration Points  

* **Parent – Trajectory**: The *Trajectory* component owns the SpecstoryConnector and orchestrates which connection method to employ. By abstracting the transport behind the adapter, *Trajectory* can switch between HTTP, IPC, or file‑watch without altering its own logic, satisfying the “multiple connection methods” requirement described in the hierarchy context.  

* **Sibling – ConversationLogger**: The **ConversationLogger** component “uses the connected API to log conversations with the Specstory extension.” It therefore depends on the same transport layer exposed by the connector. Because the connector’s API is transport‑agnostic, the logger can log regardless of whether the underlying channel is HTTP, IPC, or file‑watch, promoting reuse across siblings.  

* **External – Specstory extension**: The ultimate consumer of the connector’s requests is the Specstory extension. The adapter’s three methods map directly to the extension’s supported communication mechanisms, ensuring a contract that the extension can honor.  

* **Utility – httpRequest()**: This function is a shared low‑level HTTP client used by both the adapter’s `connectViaHTTP()` and the connector itself. It represents the only explicit external dependency referenced in the observations.

## Usage Guidelines  

When integrating a new feature that needs to talk to the Specstory extension, developers should first ask *Trajectory* which transport is appropriate for the target environment. The recommended practice is to call the corresponding method on the **SpecstoryConnector** (e.g., `await connector.connectViaHTTP(payload)`) and handle the returned promise. Direct use of `httpRequest()` is reserved for cases where only the HTTP path is needed and the higher‑level adapter is intentionally bypassed—for example, in low‑level testing.  

Because the connection methods are asynchronous, callers must use `await` or proper promise chaining to avoid unhandled rejections. Errors emitted by the adapter (network failures, IPC socket errors, file‑watch timeouts) should be caught at the *Trajectory* level where a fallback strategy can be selected (e.g., falling back from HTTP to file‑watch).  

Do not mix transport strategies within a single logical operation; pick one method per request to keep the interaction model simple and deterministic. When extending the connector, preserve the existing separation: add new transport strategies as additional methods on `SpecstoryAdapter` rather than modifying the connector’s core logic.

---

### Architectural patterns identified  
* **Separation of concerns / modularity** – transport logic lives in `SpecstoryAdapter`, orchestration lives in `SpecstoryConnector` and *Trajectory*.  
* **Strategy‑like transport selection** – three interchangeable async methods (`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`).  
* **Asynchronous I/O** – all public methods return promises, enabling non‑blocking operation.

### Design decisions and trade‑offs  
* **Flexibility vs. complexity** – supporting three transports makes the system adaptable to varied environments but adds maintenance overhead for each transport implementation.  
* **Thin façade** – the connector delegates to the adapter, reducing duplication but requiring clear contracts between them.  
* **Reliance on shared `httpRequest`** – centralizes HTTP handling but creates a single point of failure if the helper changes.

### System structure insights  
The hierarchy forms a clear stack: *Trajectory* → **SpecstoryConnector** → **SpecstoryAdapter** → transport (HTTP/IPC/FileWatch) → **Specstory extension**. Sibling components like **ConversationLogger** consume the same connector API, reinforcing a shared communication layer.

### Scalability considerations  
Because each connection method is async and non‑blocking, the system can handle many concurrent requests without saturating the event loop. Adding additional parallel transports (e.g., a pool of HTTP connections) would be straightforward within the existing adapter pattern. However, the file‑watch approach may become a bottleneck on high‑throughput workloads due to filesystem latency.

### Maintainability assessment  
The explicit modular boundary between connector and adapter promotes maintainability: transport changes are isolated to `SpecstoryAdapter`. The clear naming (`connectViaHTTP`, etc.) and reuse of `httpRequest()` aid readability. The main risk is keeping the three transport implementations in sync; any change to the Specstory extension’s protocol must be reflected across all three methods, which can be mitigated by extracting shared protocol logic into helper modules.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's architecture is designed to handle multiple connection methods, including HTTP API, IPC, and file watch, to ensure reliable communication with the Specstory extension. This is evident in the connectViaHTTP(), connectViaIPC(), and connectViaFileWatch() functions in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js). The use of these asynchronous connection methods allows the component to adapt to different environments and connection scenarios, providing a robust and flexible communication mechanism. For instance, the connectViaHTTP() function utilizes the httpRequest() function to send HTTP requests to the Specstory extension and handle responses, demonstrating a clear separation of concerns and modularity in the code.

### Siblings
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger uses the connected API to log conversations with the Specstory extension.


---

*Generated from 7 observations*
