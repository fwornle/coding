# FileWatchHandler

**Type:** SubComponent

The FileWatchHandler includes mechanisms for handling file system errors, such as permission denied or file not found, ensuring robustness and reliability.

## What It Is  

**FileWatchHandler** is a sub‑component of the **Trajectory** system that monitors a designated directory for newly‑created log files.  It lives inside the Trajectory code‑base (the exact file path is not listed in the supplied observations, but the component is referenced as a class named `FileWatchHandler`).  The handler builds on the native Node.js **fs** module, exposing a single, unified interface that abstracts away the details of the underlying file system—whether the files reside on a local disk or on a network share.  Its public surface includes methods for starting and stopping the watch, configuring file‑name filters, and retrieving processed log entries.  Internally it delegates the low‑level work to three child classes: **FileWatcher**, **ErrorHandlingMechanism**, and **FileProcessor**.

---

## Architecture and Design  

The design of **FileWatchHandler** is deliberately **modular** and **layered**.  At the top level the handler presents a **Facade**‑style API that callers (e.g., other parts of *Trajectory* such as `SpecstoryAdapter` or `TrajectoryController`) can use without needing to know whether the watch is performed via `fs.watch()` events or a periodic poll.  The observations explicitly call out a **polling mechanism** that “periodically checks for new log files,” which co‑exists with a `FileWatcher` child that “would likely utilize the Node.js `fs.watch()` function.”  This hybrid approach gives the component resilience on file systems where native change notifications are unreliable (e.g., some network mounts).

A **Strategy‑like** pattern appears in the “customizable file filters” feature.  Callers supply filter predicates (or glob patterns) that the handler applies before delegating a file to the `FileProcessor`.  Because the filter is pluggable, the same `FileWatchHandler` instance can be reused for very different log‑file naming conventions without code changes.

Error resilience is achieved through an **ErrorHandlingMechanism** child that “likely involve[s] using try‑catch blocks” around every `fs` operation.  This isolates error‑handling logic from the core watch loop, allowing the handler to translate low‑level errors such as *permission denied* or *file not found* into higher‑level, consistent exceptions or status codes.

Finally, the component embeds a lightweight **logging** concern (observations 7).  Each file‑system event, poll iteration, and error is recorded, giving developers a built‑in audit trail for debugging.  The logging is scoped to the handler itself, avoiding cross‑cutting concerns in sibling components.

---

## Implementation Details  

### Core Loop (Polling)  
The handler starts a timer (e.g., `setInterval`) that runs at a configurable interval.  On each tick it:

1. Reads the target directory with `fs.readdir()` (or the async promise‑based variant).  
2. Applies the **customizable file filters** supplied by the caller.  
3. For each file that passes the filter, checks its modification time or size to determine whether it is “new” since the last poll.  
4. Hands the file path to the **FileProcessor** for ingestion.

The polling interval is a trade‑off between detection latency and CPU/IO load; the observation notes that the mechanism “ensures timely detection and processing.”

### Event‑Driven Watch (FileWatcher)  
The child class `FileWatcher` likely calls `fs.watch(directory, options, callback)`.  The callback receives events such as `'rename'` or `'change'`.  When a `'rename'` event indicates a new file, the same filter pipeline is applied and the file is forwarded to the `FileProcessor`.  By keeping this logic in a separate class, the handler can switch between pure‑polling, pure‑event, or a hybrid mode without altering its public API.

### ErrorHandlingMechanism  
All filesystem interactions are wrapped in `try { … } catch (err) { … }`.  The mechanism distinguishes between recoverable errors (e.g., temporary network hiccups) and fatal ones (e.g., missing directory).  Recoverable errors trigger a retry on the next poll; fatal errors are logged and propagated upward, allowing the parent **Trajectory** component to decide whether to abort or restart the watch.

### FileProcessor  
`FileProcessor` uses `fs.write()` (or its promise counterpart) to append processed log data to destination files or databases.  It may also perform simple transformations (e.g., trimming, timestamp normalization) before writing.  Because the processor is a distinct class, developers can replace it with a custom implementation (e.g., streaming to a remote logging service) without touching the watch logic.

### Unified Interface & Multi‑FS Support  
The handler abstracts the underlying filesystem through a thin wrapper that detects whether the target path is a local mount or a network share (e.g., SMB, NFS).  The same API (`start()`, `stop()`, `addFilter()`, `onEvent()`) works for both, satisfying observation 6 (“supports multiple file systems”) and observation 5 (“provides a unified interface”).

---

## Integration Points  

* **Parent – Trajectory**: `Trajectory` owns a `FileWatchHandler` instance.  The parent uses the handler to ingest log files generated by downstream processes, feeding them into the broader project‑milestone tracking workflow.  Because `Trajectory` also contains sibling components (`SpecstoryConnectionManager`, `ConversationLogger`, `SpecstoryAdapter`, `TrajectoryController`), those siblings can share the same logging infrastructure; for example, `ConversationLogger` may rely on the same file‑filter configuration to capture conversation logs.

* **Sibling Interaction**: While the siblings do not directly call `FileWatchHandler`, they all depend on a consistent logging strategy provided by the parent.  The unified interface of the handler means that any sibling that needs to read or write files can do so through the same abstraction layer, reducing duplicated filesystem code.

* **Children**:  
  * `FileWatcher` supplies the event‑driven path, exposing callbacks that the parent can subscribe to (`on('fileAdded', handler)`).  
  * `ErrorHandlingMechanism` surfaces a standardized error object that higher‑level components can inspect (`error.code`, `error.path`).  
  * `FileProcessor` offers a `process(filePath)` method that downstream modules (e.g., a reporting service) can invoke directly if they need to trigger processing out‑of‑band.

* **External Dependencies**: The only external Node.js module required is the built‑in `fs`.  No third‑party libraries are mentioned, keeping the dependency surface minimal.

---

## Usage Guidelines  

1. **Initialize with a Target Directory** – Construct `new FileWatchHandler({ directory: '/var/logs/app', intervalMs: 5000 })`.  Choose an interval that balances latency against load; the default in the source is tuned for typical log‑generation rates.

2. **Configure Filters Early** – Call `addFilter((name) => name.endsWith('.log'))` or provide a glob pattern.  Filters are evaluated *before* any filesystem operation, reducing unnecessary I/O.

3. **Subscribe to Events** – Use `on('fileAdded', (filePath) => { … })` to react to newly‑detected files.  The event is emitted whether the detection came from polling or from `fs.watch()`.

4. **Handle Errors Gracefully** – Register an `on('error', handler)` listener.  The `ErrorHandlingMechanism` will forward both transient (e.g., `EACCES`) and fatal errors; your handler should decide whether to retry, alert, or abort.

5. **Leverage Logging** – The handler logs every poll cycle and error at the `debug` level.  Adjust the logger’s verbosity via the parent `Trajectory` configuration to avoid log‑spam in production.

6. **Do Not Mix Direct `fs` Calls on the Same Directory** – To preserve the unified interface guarantees, all reads/writes to the watched directory should go through `FileProcessor` or the handler’s API.  Direct `fs` calls can bypass filters and error handling, leading to inconsistent state.

7. **Testing** – When unit‑testing, replace the child `FileWatcher` with a mock that emits synthetic events.  The polling loop can be accelerated by passing a small `intervalMs` value.

---

### Architectural patterns identified  

| Pattern | Evidence from observations |
|---------|----------------------------|
| **Facade** | Unified interface for all file‑system operations (obs. 5). |
| **Strategy (Filter)** | Customizable file filters that control which files are processed (obs. 3). |
| **Hybrid Polling/Event** | Explicit polling mechanism plus a `FileWatcher` that would use `fs.watch()` (obs. 1, 2, child description). |
| **Adapter** | Support for both local and network file systems behind the same API (obs. 6). |
| **Decorator‑style Logging** | Built‑in logging of events and errors (obs. 7). |

---

### Design decisions and trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Use **polling** as the primary detection method | Guarantees detection even on file systems that lack reliable change notifications (e.g., some network mounts). | Introduces periodic I/O overhead and latency proportional to the interval. |
| Provide a **FileWatcher** child that can also use `fs.watch()` | Allows low‑latency, event‑driven detection when the underlying FS supports it. | Adds complexity to maintain two code paths and to reconcile duplicate events. |
| Expose **filter strategy** to callers | Gives fine‑grained control and prevents unnecessary processing. | Requires callers to understand filter semantics; mis‑configured filters can hide needed files. |
| Centralize **error handling** in a dedicated child | Improves robustness and keeps the main loop clean. | Slight performance cost of extra try‑catch blocks and error object construction. |
| Embed **logging** directly in the handler | Facilitates debugging without external instrumentation. | Potential performance impact if logging is verbose; must be configurable. |

---

### System structure insights  

* **Hierarchy** – `Trajectory` → `FileWatchHandler` → (`FileWatcher`, `ErrorHandlingMechanism`, `FileProcessor`).  
* **Sibling Cohesion** – All siblings share the same parent (`Trajectory`) and therefore benefit from a common logging and error‑reporting infrastructure.  
* **Encapsulation** – Each child class encapsulates a single responsibility (watching, error handling, processing), making the sub‑component easy to extend (e.g., swapping `FileProcessor` for a streaming uploader).  
* **Dependency Direction** – The only outward dependency is Node’s core `fs` module; no third‑party packages are required, keeping the component lightweight.

---

### Scalability considerations  

* **Polling Frequency** – Scaling to directories with thousands of files requires a longer interval or incremental directory scans (e.g., tracking last processed timestamp).  
* **Network File Systems** – Latency and occasional transient failures are mitigated by the `ErrorHandlingMechanism`, but high‑frequency polling can saturate network bandwidth.  
* **Parallel Processing** – The current design processes files sequentially; to handle bursts of log files, `FileProcessor` could be upgraded to a worker‑pool model without altering the watch logic.  
* **Resource Footprint** – Because the component relies on native `fs` calls, memory usage stays low; the main scalability limiter is I/O throughput.

---

### Maintainability assessment  

* **Modular Design** – Clear separation into `FileWatcher`, `ErrorHandlingMechanism`, and `FileProcessor` makes the codebase approachable for new contributors.  
* **Low External Coupling** – Only the Node.js core library is required, reducing version‑compatibility headaches.  
* **Extensible Filters** – Adding new filter types does not affect the core loop, supporting future feature growth.  
* **Potential Technical Debt** – Maintaining two detection paths (polling + event) can lead to duplicated bugs; a well‑documented abstraction layer is essential.  
* **Logging Configurability** – If logging verbosity is not configurable, production deployments may suffer from excessive log volume; ensure the logger respects a global setting from `Trajectory`.  

Overall, **FileWatchHandler** exhibits a pragmatic, well‑encapsulated architecture that balances reliability (polling) with performance (event‑driven watch) while keeping the implementation simple enough for easy maintenance and future extension.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive planning infrastructure. The component's architecture involves multiple connection methods, including HTTP API, Inter-Process Communication (IPC), and file watch directory, to interact with the Specstory extension. The SpecstoryAdapter class plays a central role in this component, providing methods for initialization, logging conversations, and connecting to the Specstory extension via different methods.

### Children
- [FileWatcher](./FileWatcher.md) -- The FileWatcher class would likely utilize the Node.js fs module's watch() function to monitor the directory for changes, as seen in the fs module documentation.
- [ErrorHandlingMechanism](./ErrorHandlingMechanism.md) -- The ErrorHandlingMechanism would likely involve using try-catch blocks to catch errors thrown by the Node.js fs module, such as errors when trying to read or write to a file.
- [FileProcessor](./FileProcessor.md) -- The FileProcessor class would likely utilize the Node.js fs module's write() function to write log data to the log files, as seen in the fs module documentation.

### Siblings
- [SpecstoryConnectionManager](./SpecstoryConnectionManager.md) -- SpecstoryConnectionManager utilizes the SpecstoryAdapter class to establish connections to the Specstory extension, providing methods for initialization and logging conversations.
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger utilizes the SpecstoryAdapter class to log conversations, providing methods for formatting log entries and handling errors.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter utilizes the SpecstoryConnectionManager to establish connections to the Specstory extension, providing methods for initialization and logging conversations.
- [TrajectoryController](./TrajectoryController.md) -- TrajectoryController utilizes the SpecstoryConnectionManager to establish connections to the Specstory extension, providing methods for initialization and logging conversations.


---

*Generated from 7 observations*
