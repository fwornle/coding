# ErrorManager

**Type:** SubComponent

The ErrorManager handles errors and exceptions within the component, providing a centralized mechanism for error handling

## What It Is  

The **ErrorManager** is a sub‑component that lives inside the **Trajectory** component. Although the exact source file is not listed in the observations, it can be inferred that its implementation resides somewhere within the Trajectory module hierarchy (e.g., `lib/trajectory/…`). Its sole responsibility is to provide a **centralized, asynchronous error‑handling service** for the whole component. When an exception or error occurs anywhere inside Trajectory, the ErrorManager captures the event, formats the payload through the **DataFormatter** sub‑component, and forwards the resulting record to the **Specstory** extension via the **ConnectionManager**. By encapsulating this logic in a dedicated class, the rest of the codebase can simply raise or forward errors without needing to know the details of logging, formatting, or transport.

## Architecture and Design  

The design of ErrorManager follows a **modular, class‑based architecture** that emphasizes **encapsulation** and **reusability**. It is a distinct class that collaborates with two sibling sub‑components: **ConnectionManager** (which knows how to open and maintain a link to Specstory) and **DataFormatter** (which knows Specstory’s data schema). This separation of concerns mirrors the pattern used by other siblings such as **SpecstoryConnector** and **ConversationLogger**, all of which rely on the shared **SpecstoryAdapter** implementation (found in `lib/integrations/specstory-adapter.js`).  

ErrorManager’s internal workflow is **asynchronous** and **promise‑based**. When an error is reported, the manager invokes an async method that first calls DataFormatter to transform the raw error object, then awaits the ConnectionManager to push the formatted payload to Specstory. The use of promises guarantees that error logging does not block the main execution path of Trajectory, preserving the component’s overall responsiveness. This mirrors the asynchronous initialization pattern described for the Trajectory class itself, where promises are used to keep startup non‑blocking.

## Implementation Details  

Although concrete symbols are not enumerated, the observations describe the key interactions that define ErrorManager’s implementation:

1. **Class Structure** – ErrorManager is implemented as a class, enabling instantiation and encapsulation of state such as a reference to the ConnectionManager instance and the DataFormatter instance. This aligns with the “encapsulation and reuse of code through the use of classes and objects” noted in the observations.  

2. **Dependency Injection** – At construction time, ErrorManager receives (or creates) a ConnectionManager object that handles the low‑level Specstory connection, and a DataFormatter object that knows how to shape error payloads. This mirrors the pattern used by other components (e.g., SpecstoryConnector) that also depend on the shared SpecstoryAdapter.  

3. **Asynchronous Error Reporting** – The primary public method (e.g., `logError(error)`) is declared `async`. Inside, it calls `await this.dataFormatter.format(error)` to obtain a Specstory‑compatible object, then `await this.connectionManager.send(formattedError)`. The method returns a promise, allowing callers to `await` the logging operation or ignore it if fire‑and‑forget semantics are acceptable.  

4. **Promise‑Based Concurrency** – Because the method returns a promise, multiple error reports can be in flight simultaneously. The underlying ConnectionManager likely queues or batches these requests, though the observations do not detail that behavior.  

5. **Integration with Specstory** – The final step of the workflow is a call to the Specstory extension. The sibling components all use the **SpecstoryAdapter** (found in `lib/integrations/specstory-adapter.js`) for this purpose, so ErrorManager indirectly relies on the same adapter through ConnectionManager, ensuring a consistent communication contract across the system.

## Integration Points  

ErrorManager sits at the crossroads of three major integration surfaces:

* **Parent – Trajectory**: As a child of Trajectory, ErrorManager is invoked by any part of Trajectory that needs to surface an exception. The parent component can simply call `errorManager.logError(err)` without worrying about formatting or transport, trusting the sub‑component to handle the rest.  

* **Sibling – ConnectionManager**: This sub‑component abstracts the network or IPC details required to reach the Specstory extension. ErrorManager delegates all transport responsibilities to ConnectionManager, keeping its own code focused on error semantics.  

* **Sibling – DataFormatter**: Before sending data, ErrorManager hands the raw error object to DataFormatter, which applies the Specstory‑specific schema (e.g., adding timestamps, error codes, stack traces). This mirrors the way **ConversationLogger** also uses DataFormatter, highlighting a shared formatting contract.  

* **External – Specstory Extension**: The ultimate consumer of the error logs is the Specstory extension. Because both ConnectionManager and other siblings (SpecstoryConnector, TrajectoryInitializer) use the same **SpecstoryAdapter**, ErrorManager benefits from a unified API surface and can rely on existing connection handling logic.  

The only explicit dependency chain revealed by the observations is: **ErrorManager → DataFormatter → ConnectionManager → SpecstoryAdapter → Specstory**.

## Usage Guidelines  

1. **Always use the async API** – Call `await errorManager.logError(err)` (or fire‑and‑forget with `.catch()` handling) to ensure that the logging operation does not block the caller thread. The promise‑based design guarantees non‑blocking behavior, which is essential for maintaining the responsiveness of Trajectory.  

2. **Pass raw error objects** – ErrorManager expects the original `Error` instance (or a plain object containing `message`, `stack`, etc.). Do not pre‑format the payload; let DataFormatter perform the canonical transformation.  

3. **Do not instantiate ConnectionManager or DataFormatter manually** – Rely on the constructor injection pattern used throughout the codebase. This ensures that the shared SpecstoryAdapter configuration (e.g., authentication tokens, endpoint URLs) remains consistent across all components.  

4. **Handle promise rejections** – While ErrorManager strives to log errors reliably, network failures or formatting issues can still cause promise rejections. Consumers should attach a `.catch()` handler or wrap calls in `try / await` blocks to avoid unhandled promise warnings.  

5. **Avoid heavy processing inside the error handler** – Since ErrorManager already runs asynchronously, any additional synchronous work (e.g., intensive parsing) should be moved out of the error path to keep latency low.  

---

### Architectural Patterns Identified
* **Modular class‑based encapsulation** – each concern (error handling, connection, formatting) lives in its own class.
* **Dependency injection** – ErrorManager receives ConnectionManager and DataFormatter instances.
* **Asynchronous, promise‑based flow** – non‑blocking error logging.

### Design Decisions and Trade‑offs
* **Centralized error handling** improves consistency but adds a single point of failure; the async design mitigates impact on the main workflow.
* **Separation of formatting and transport** enables reuse (e.g., ConversationLogger also uses DataFormatter) but introduces an extra hop in the call chain.
* **Reliance on shared SpecstoryAdapter** reduces duplication but couples all siblings to the same external contract.

### System Structure Insights
* ErrorManager is a leaf sub‑component under **Trajectory**, mirroring the parent’s modular pattern.
* It shares dependencies with siblings **ConnectionManager** and **DataFormatter**, forming a small collaboration cluster around Specstory integration.
* The overall hierarchy follows a **parent‑child‑sibling** model where each sub‑component focuses on a single responsibility.

### Scalability Considerations
* Because logging is asynchronous and promise‑based, the system can handle many concurrent error reports without blocking critical paths.
* If error volume spikes, the underlying ConnectionManager must be able to queue or batch requests; otherwise, network saturation could delay logs.
* The modular design allows scaling each piece independently (e.g., swapping ConnectionManager for a more robust transport layer).

### Maintainability Assessment
* High maintainability stems from clear separation of concerns: formatting, transport, and error capture are isolated.
* Shared adapters and formatter logic reduce code duplication, simplifying updates to the Specstory contract.
* The lack of concrete file paths in the observations suggests documentation gaps; adding explicit module locations (e.g., `lib/trajectory/error-manager.js`) would further improve traceability.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's modular design pattern is evident in its use of classes and objects, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which enables encapsulation and reuse of code. This modularity is further enhanced by the component's asynchronous programming model, which allows for efficient and concurrent execution of tasks. For instance, the initialize method in the Trajectory class utilizes asynchronous programming to initialize the component without blocking other tasks. The use of promises in this method, as seen in the return statement, ensures that the component's initialization is non-blocking and efficient.

### Siblings
- [SpecstoryConnector](./SpecstoryConnector.md) -- SpecstoryConnector uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to establish a connection to the Specstory extension
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger uses the DataFormatter sub-component to format data according to Specstory's requirements
- [ConnectionManager](./ConnectionManager.md) -- ConnectionManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to establish a connection to the Specstory extension
- [DataFormatter](./DataFormatter.md) -- DataFormatter uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to format data according to Specstory's requirements
- [TrajectoryInitializer](./TrajectoryInitializer.md) -- TrajectoryInitializer uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to initialize the Trajectory component


---

*Generated from 7 observations*
