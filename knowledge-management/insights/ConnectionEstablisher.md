# ConnectionEstablisher

**Type:** Detail

The SpecstoryConnector sub-component's ability to attempt connections on multiple ports implies the presence of a loop or recursive function call in the ConnectionEstablisher implementation.

## What It Is  

**ConnectionEstablisher** is the core sub‑component that lives inside **SpecstoryConnector**.  Although the concrete file path is not disclosed in the observations, the naming and its placement within the *SpecstoryConnector* hierarchy make it clear that this class (or module) is responsible for the low‑level mechanics of opening a link to the Specstory extension.  The surrounding context tells us that the connector ultimately calls `connectViaHTTP` on **SpecstoryAdapter**, so **ConnectionEstablisher** must prepare the necessary parameters—most notably the target host and a set of candidate ports—before delegating the actual HTTP handshake to the adapter.  

The design goal, explicitly called out in the observations, is **extensibility**: the establisher should be able to accommodate new transport protocols without requiring a rewrite of the surrounding connector logic.  At the same time, it must support trying several ports in succession, a behavior that is hinted at by the “multiple ports” capability of **SpecstoryConnector**.  In practice, **ConnectionEstablisher** therefore acts as a thin orchestration layer that iterates over possible endpoints, selects an appropriate protocol handler, and invokes the corresponding adapter method (currently `connectViaHTTP`).  

Because no source files are listed, the exact location of the implementation cannot be quoted verbatim, but the logical placement is within the same package or directory that houses **SpecstoryConnector** and **SpecstoryAdapter**, preserving a tight coupling among these three entities.

---

## Architecture and Design  

The observations reveal a **layered, protocol‑agnostic architecture**.  At the top sits **SpecstoryConnector**, which owns a **ConnectionEstablisher** instance.  Below that, protocol‑specific adapters such as **SpecstoryAdapter** expose concrete connection primitives (e.g., `connectViaHTTP`).  This separation mirrors a **Strategy pattern**: the establisher selects a “connection strategy” (currently HTTP) at runtime and hands off the work to the appropriate adapter.  While the term “Strategy” is not explicitly used in the source, the behavior—choosing a method based on protocol capability—matches the pattern’s intent.  

The multi‑port probing requirement implies a **loop‑or‑recursive control flow** inside **ConnectionEstablisher**.  The component likely iterates over a list of candidate ports, invoking the selected protocol strategy for each until a successful handshake occurs or the list is exhausted.  This loop is a simple, deterministic algorithm that keeps the establisher’s responsibilities focused on *when* to try a connection rather than *how* to perform the low‑level socket work.  

Because the only observed protocol is HTTP, the current implementation probably hard‑codes a call to `SpecstoryAdapter.connectViaHTTP`.  However, the design decision to keep the establisher protocol‑agnostic suggests that future extensions (e.g., WebSocket, gRPC, or custom binary protocols) can be added by introducing new adapter methods and registering them with the establisher’s strategy map.  No other architectural styles—such as micro‑services, event‑driven messaging, or dependency injection containers—are mentioned, so the analysis stays within the observed scope.

---

## Implementation Details  

The **ConnectionEstablisher** implementation can be inferred to contain three logical parts:

1. **Port Enumeration** – A collection (array, list, or configuration‑driven set) of integer ports that the Specstory extension might be listening on.  The observations that *SpecstoryConnector* “attempts connections on multiple ports” point to a loop such as `for (int port : candidatePorts) { … }`.  This loop lives inside **ConnectionEstablisher**, ensuring the connector does not need to duplicate the iteration logic.

2. **Protocol Selection** – Although only HTTP is currently used, the establisher likely holds a mapping from protocol identifiers to adapter method references.  The decision point would look like `if (protocol == HTTP) { adapter.connectViaHTTP(host, port); }`.  The presence of a *flexible connection establishment approach* signals that this mapping is designed for easy extension.

3. **Result Handling** – After each `connectViaHTTP` invocation, the establisher must interpret the outcome (success, timeout, error).  On success it returns a live connection object or a success flag to **SpecstoryConnector**; on failure it proceeds to the next port.  The loop terminates early on success, which is a typical “first‑successful‑connection” strategy.

Because no concrete code symbols were discovered, the exact class name (e.g., `class ConnectionEstablisher`) and method signatures are not listed, but the above responsibilities are directly derived from the three observations.  The implementation is deliberately lightweight: it does not embed any HTTP logic itself, delegating that to **SpecstoryAdapter**’s `connectViaHTTP` method, thereby respecting the *single‑responsibility principle*.

---

## Integration Points  

**ConnectionEstablisher** sits at the intersection of three entities:

* **Parent – SpecstoryConnector**: The connector creates or owns an instance of the establisher and passes configuration data (host, list of ports, desired protocol).  It relies on the establisher to report back whether a viable connection was found.  

* **Sibling – SpecstoryAdapter** (and any future adapters): The establisher calls `SpecstoryAdapter.connectViaHTTP`.  This is the only observed external interface, so the establisher’s contract with the adapter is a simple method call that takes a host and port and returns a connection result.  Adding a new protocol would require a sibling adapter exposing a method with a comparable signature.  

* **Children – None observed**: The current design does not indicate that **ConnectionEstablisher** has its own sub‑components.  If future protocols demand richer handling (e.g., TLS handshakes), new internal helper classes could be introduced without breaking the existing parent–sibling contracts.

The dependency direction is clear: **SpecstoryConnector → ConnectionEstablisher → SpecstoryAdapter**.  This linear flow keeps the system loosely coupled; changes in the adapter’s internals (e.g., switching from a raw `HttpURLConnection` to an async client) do not affect the establisher as long as the method signature remains stable.

---

## Usage Guidelines  

1. **Do not embed protocol logic in the establisher** – Keep the establisher’s role limited to iterating over ports and selecting the appropriate adapter method.  All transport‑specific details must remain inside the adapter (e.g., `connectViaHTTP`).  

2. **Configure the port list centrally** – Because the multi‑port loop lives inside **ConnectionEstablisher**, any change to the set of ports should be made in the configuration supplied by **SpecstoryConnector** rather than hard‑coding values inside the establisher.  

3. **Register new protocols through a strategy map** – When extending the system, add a new entry that maps a protocol identifier to a method on a new adapter (e.g., `connectViaWebSocket`).  Do not modify the looping logic; the establisher will automatically pick up the new strategy.  

4. **Handle failure gracefully** – The establisher should return a clear status (success flag, exception, or nullable connection object) to the parent.  The parent can then decide whether to retry, log, or abort.  Avoid swallowing exceptions inside the loop; surface them to aid debugging.  

5. **Keep the public API stable** – Since **SpecstoryConnector** depends on the establisher’s contract, any change to method signatures (e.g., adding extra parameters) must be coordinated across both components to prevent breakage.

---

### Architectural patterns identified  

* **Strategy (protocol‑selection)** – The establisher chooses a connection method based on the desired protocol.  
* **Template Method / Loop** – A fixed iteration over candidate ports, delegating the variable part (the actual connection) to the adapter.  

### Design decisions and trade‑offs  

* **Protocol agnosticism vs. current simplicity** – By abstracting the protocol, the system is future‑proof but introduces an indirection layer that adds a tiny runtime overhead.  
* **Port‑scanning loop inside the establisher** – Centralising the retry logic simplifies the parent component but couples the establisher to the notion of “multiple ports,” which may be unnecessary for single‑port protocols.  

### System structure insights  

The system follows a **vertical slice** organization: the high‑level connector, the middle‑level establisher, and the low‑level adapter each own a distinct responsibility, enabling clear ownership and easier testing of each slice in isolation.

### Scalability considerations  

* Adding more ports or protocols scales linearly; the loop will simply iterate over a larger list, and new adapters can be plugged in without touching existing code.  
* If the number of ports grows dramatically, the sequential loop could become a bottleneck; a future optimization might be to parallelise connection attempts, but that would require redesigning the establisher’s control flow.  

### Maintainability assessment  

The current separation of concerns yields high maintainability: changes to HTTP handling stay within **SpecstoryAdapter**, while changes to port‑selection logic stay within **ConnectionEstablisher**.  The lack of hard‑coded protocol logic inside the establisher further reduces the risk of regression when new protocols are added.  The main maintenance risk is the implicit contract between the establisher and the adapter; documenting the expected method signatures and return types is essential to keep the two components in sync.


## Hierarchy Context

### Parent
- [SpecstoryConnector](./SpecstoryConnector.md) -- SpecstoryConnector uses the connectViaHTTP method in SpecstoryAdapter to attempt connections to the Specstory extension on multiple ports, demonstrating a flexible connection establishment approach.


---

*Generated from 3 observations*
