# ConnectionManager

**Type:** Detail

ConnectionManager (connection-manager.ts:10) prioritizes connection methods in the order of HTTP, IPC, and file watch, as specified in the ConnectionPriorityEnum defined in the adapter-pattern.ts file.

## What It Is  

**ConnectionManager** is the orchestration component that decides how the application reaches the Specstory service. The concrete implementation lives in `connection-manager.ts` (line 10) and is part of the **AdapterPattern** package. It does not contain the low‑level transport code itself; instead it delegates to the **SpecstoryAdapter** located in `lib/integrations/specstory-adapter.js`. The adapter exposes three private‑ish helper methods—`connectViaHTTP`, `connectViaIPC`, and `connectViaFileWatch`—each implementing a distinct transport mechanism. The overall behaviour is a prioritized, fallback‑driven connection strategy: HTTP is tried first, then IPC, and finally file‑watch, as dictated by the `ConnectionPriorityEnum` defined in `adapter-pattern.ts`.

---

## Architecture and Design  

The observed code follows a classic **adapter** arrangement. The parent component, **AdapterPattern**, aggregates the `ConnectionManager` and the `SpecstoryAdapter`, positioning the manager as the façade that external callers use while the adapter encapsulates the concrete transport details.  

The connection selection logic is expressed as a **priority‑ordered fallback**. `ConnectionManager` reads the ordering from `ConnectionPriorityEnum` (HTTP → IPC → FileWatch) and attempts each method in turn. This mirrors a *chain‑of‑responsibility* style flow: each attempt is made, and on failure the next link in the chain is invoked. The fallback is explicitly implemented inside `SpecstoryAdapter`—the three `connectVia*` methods are called sequentially, and the adapter proceeds to the next method only when the previous one signals failure.  

Because the priority list is defined in a shared enum (`adapter-pattern.ts`), the ordering can be altered centrally without touching the manager or the adapter, illustrating a **configuration‑driven design**. The manager therefore remains thin: it merely reads the enum, initiates the first connection attempt, and relies on the adapter’s internal fallback to handle the rest.

---

## Implementation Details  

1. **ConnectionPriorityEnum (adapter-pattern.ts)** – Enumerates the supported transports in the exact order the system prefers them: `HTTP`, `IPC`, `FILE_WATCH`. This enum is the single source of truth for priority, ensuring consistency between `ConnectionManager` and `SpecstoryAdapter`.  

2. **ConnectionManager (connection-manager.ts)** – At line 10 the manager imports the enum and, when a connection request arrives, invokes the adapter’s entry point (likely a public `connect()` method). It passes the prioritized list so the adapter knows which transports to try first. The manager does not contain any network‑oriented code; its responsibility is limited to coordination and error propagation.  

3. **SpecstoryAdapter (lib/integrations/specstory-adapter.js)** – Implements three concrete connection routines:
   * `connectViaHTTP` – Opens an HTTP client to the Specstory endpoint.
   * `connectViaIPC` – Falls back to an inter‑process communication channel when HTTP is unavailable.
   * `connectViaFileWatch` – As a last resort, watches a file system location for messages.
   
   The adapter’s internal flow checks the result of each method; on failure it automatically calls the next one, respecting the order defined in the enum. The fallback mechanism is deterministic and linear, guaranteeing that only one transport is active at any moment.

4. **Error handling** – Although not explicitly described, the fallback pattern implies that each `connectVia*` method returns a success flag or throws an exception that the adapter catches to decide whether to continue down the chain.

---

## Integration Points  

* **Parent – AdapterPattern**: `ConnectionManager` is a child of the `AdapterPattern` module, meaning any consumer of the adapter pattern will obtain a connection through this manager. The parent likely provides shared utilities (logging, configuration loading) that both the manager and the adapter reuse.  

* **Sibling – Other adapters**: While not listed, the architecture suggests that additional adapters could exist alongside `SpecstoryAdapter`, each exposing a similar set of `connectVia*` methods. They would all be orchestrated by their own `ConnectionManager` instances, sharing the same priority enum.  

* **External services** – The three transports connect to the same logical service (Specstory) but via different protocols. HTTP may target a remote REST endpoint, IPC may communicate with a locally spawned process, and file watch may interact with a shared directory used by another component.  

* **Configuration** – The enum in `adapter-pattern.ts` is the integration contract. Changing the order or adding new transports requires only modifications to this file, after which `ConnectionManager` and `SpecstoryAdapter` automatically respect the new policy.  

* **Testing hooks** – Because the fallback logic is encapsulated inside the adapter, unit tests can mock each `connectVia*` method to verify that the manager correctly proceeds to the next method on failure.

---

## Usage Guidelines  

1. **Prefer the manager API** – Callers should request a connection through `ConnectionManager` rather than invoking the adapter’s private methods directly. This guarantees that the defined priority and fallback logic are applied consistently.  

2. **Do not reorder transports in code** – The ordering lives in `ConnectionPriorityEnum`. If a different preference is required (e.g., IPC before HTTP), modify the enum in `adapter-pattern.ts` only; avoid hard‑coding a different sequence in consumer code.  

3. **Handle connection failures centrally** – Since the adapter will try all three methods before giving up, the manager should be prepared to receive a final failure response and surface a single, aggregated error to the caller.  

4. **Extend with caution** – Adding a new transport (e.g., WebSocket) requires:
   * Adding a new entry to `ConnectionPriorityEnum`.
   * Implementing a `connectViaWebSocket` method in `SpecstoryAdapter`.
   * Updating the fallback sequence inside the adapter to include the new method.
   Directly modifying the manager is unnecessary if the enum is respected.  

5. **Logging and observability** – Because the fallback chain can obscure which transport succeeded, it is advisable to log the outcome of each `connectVia*` attempt inside the adapter. This aids debugging when the preferred transport repeatedly fails.

---

### Architectural patterns identified  

* **Adapter pattern** – `SpecstoryAdapter` translates the generic connection request into concrete transport calls.  
* **Chain‑of‑Responsibility (fallback)** – The sequential try‑fallback approach across HTTP → IPC → FileWatch.  
* **Configuration‑driven priority** – Use of `ConnectionPriorityEnum` to dictate behavior without code changes.

### Design decisions and trade‑offs  

* **Explicit priority vs. dynamic selection** – By fixing the order in an enum, the system gains predictability and simplicity, at the cost of flexibility for runtime‑based selection.  
* **Single point of fallback logic** – Centralising the fallback in the adapter reduces duplication but makes the adapter responsible for both transport implementation and orchestration, which could increase its size.  
* **Transport independence** – Each `connectVia*` method can be developed and tested in isolation, supporting modularity.

### System structure insights  

The hierarchy is clear: `AdapterPattern` → `ConnectionManager` → `SpecstoryAdapter` → transport methods. The manager acts as a façade, while the adapter holds the concrete implementation and fallback chain. The enum provides a shared contract across the hierarchy.

### Scalability considerations  

* **Adding new transports** scales linearly: a new enum entry and a corresponding method suffice.  
* **Concurrent connections** – The current design appears sequential; if high‑throughput scenarios require parallel attempts, the fallback mechanism would need redesign.  
* **Performance** – The fallback adds latency only when earlier transports fail; in the common case (HTTP works) the overhead is minimal.

### Maintainability assessment  

* **High maintainability** – The separation of concerns (manager vs. adapter) and the single source of truth for priority simplify updates.  
* **Potential risk** – The adapter’s fallback chain is a single function; as more transports are added, the method could become cumbersome. Refactoring into a loop over an ordered list of strategy objects would preserve readability.  
* **Testability** – Clear boundaries allow unit tests to mock each transport, ensuring the fallback behaves as expected.  

Overall, the current architecture delivers a straightforward, deterministic connection strategy while keeping the codebase organized around well‑defined responsibilities.


## Hierarchy Context

### Parent
- [AdapterPattern](./AdapterPattern.md) -- The SpecstoryAdapter class in lib/integrations/specstory-adapter.js employs connection methods in order of preference, starting with HTTP, then IPC, and finally file watch, as seen in the connectViaHTTP, connectViaIPC, and connectViaFileWatch methods.


---

*Generated from 3 observations*
