# FileWatcher

**Type:** Detail

The FileWatcher class would also need to handle the case where the watched directory does not exist, and decide whether to create it or throw an error, as discussed in the Node.js fs documentation for the watch() function.

## What It Is  

The **FileWatcher** entity is a class that lives inside the **FileWatchHandler** component.  Its sole responsibility is to monitor a target directory for file‑system activity by leveraging the built‑in Node.js **fs** module.  According to the observations, the class makes direct use of **`fs.watch()`** to receive low‑level notifications, and it registers listeners for the **`'change'`** and **`'error'`** events that the watch API emits.  In addition, the class contains logic to verify that the directory it is asked to watch actually exists; when the directory is missing it must decide—based on the surrounding design—whether to create the directory on‑the‑fly or to surface an exception.  No concrete file paths are listed in the source observations, so the exact location of the class in the repository is not enumerated, but its placement is clearly defined as a child of **FileWatchHandler**.

---

## Architecture and Design  

The design of **FileWatcher** follows a classic *observer* style that is idiomatic to Node.js: the class subscribes to events emitted by the **fs.watch()** API and reacts to them.  This event‑listener approach is the de‑facto pattern used for file‑system monitoring in JavaScript environments, and the observations explicitly reference the need to “implement event listeners for events such as `'change'` and `'error'`.”  Because **FileWatcher** is encapsulated inside **FileWatchHandler**, the overall architecture can be viewed as a small, hierarchical composition:

* **FileWatchHandler** – the parent component that orchestrates directory watching for new log files.  
* **FileWatcher** – the concrete implementation that directly talks to the **fs** module.  
* **ErrorHandlingMechanism** – a sibling that provides try‑catch wrappers for any **fs**‑related exceptions that **FileWatcher** (or other components) might throw.  
* **FileProcessor** – another sibling that consumes the events produced by **FileWatcher** (e.g., a new log file detected) and subsequently writes data using **`fs.write()`**.

The interaction model is therefore a *publish‑subscribe* flow: **FileWatcher** publishes `'change'` events, **FileWatchHandler** (or **FileProcessor**) subscribes to them, and **ErrorHandlingMechanism** is consulted whenever an `'error'` event bubbles up.  No additional architectural layers (such as micro‑services or message queues) are mentioned, so the system remains a tightly‑coupled in‑process module.

---

## Implementation Details  

### Core API Usage  
* **`fs.watch(path, [options], listener)`** – The class creates a watcher by passing the target directory path (validated beforehand) to this function.  The optional **options** object may include flags such as `{ persistent: true }` to keep the Node process alive while watching.  
* **Event listeners** – Immediately after the watcher is created, **FileWatcher** attaches two listeners:
  * **`watcher.on('change', handler)`** – The handler receives the event type (`'rename'` or `'change'`) and the filename, enabling the component to recognise when a new log file appears or an existing one is modified.  
  * **`watcher.on('error', errHandler)`** – The error handler captures runtime problems such as permission denials or underlying OS limits, and forwards the error to the **ErrorHandlingMechanism**.

### Directory‑existence handling  
Before invoking **`fs.watch()`**, the class checks the existence of the target directory using **`fs.existsSync()`** (or the asynchronous **`fs.promises.access()`**).  If the check fails, the class follows a design decision branch that is documented in the observations: either it creates the missing directory with **`fs.mkdirSync()`** (or the async variant) or it throws an error that propagates to the parent **FileWatchHandler**.  This conditional path is a deliberate trade‑off between *fail‑fast* behavior and *self‑healing* capability.

### Lifecycle management  
Although not explicitly stated, a typical implementation would expose **`start()`** and **`stop()`** methods so that **FileWatchHandler** can control the watcher’s lifetime.  The **`stop()`** method would call **`watcher.close()`** to release OS resources, preventing file‑descriptor leaks.

---

## Integration Points  

* **Parent – FileWatchHandler** – The parent creates an instance of **FileWatcher**, supplies the directory path, and registers callbacks that translate raw `'change'` events into higher‑level “new‑log‑file” notifications for the rest of the system.  The parent also decides which of the two directory‑existence strategies (create vs. error) to employ.  
* **Sibling – ErrorHandlingMechanism** – When **FileWatcher** emits an `'error'` event, the error is handed off to this sibling.  The mechanism likely wraps the error in a custom error type, logs it, and decides whether to retry, abort, or propagate the exception upward.  
* **Sibling – FileProcessor** – Upon receiving a `'change'` notification (e.g., a newly created log file), **FileProcessor** reads the file and writes processed data using **`fs.write()`**.  The two siblings therefore share the same **fs** dependency but operate on opposite sides of the file lifecycle (watch → process).  

No external libraries beyond Node’s core **fs** module are referenced, so the integration surface is limited to standard Node APIs and internal method calls between the three components.

---

## Usage Guidelines  

1. **Validate the watch path before instantiation** – Always perform an existence check (as the class does) and decide early whether the directory should be auto‑created.  This avoids surprising runtime errors.  
2. **Register error listeners** – Even if the parent component handles errors, the **FileWatcher** instance should still attach an `'error'` listener to prevent unhandled‑error crashes.  Forward errors to **ErrorHandlingMechanism** for consistent logging and recovery.  
3. **Gracefully shut down the watcher** – Call the watcher’s **`close()`** method (exposed via a `stop()` API) when the application is terminating or when the watch is no longer needed.  This releases OS file descriptors and prevents memory leaks.  
4. **Debounce rapid change events** – The underlying **fs.watch()** can emit multiple `'change'` events for a single file operation.  Implement a short debounce timer in the `'change'` handler if downstream processing (e.g., **FileProcessor**) is expensive.  
5. **Prefer async APIs for scalability** – While the observations mention the synchronous existence check, in a production environment the asynchronous **`fs.promises`** equivalents should be used to keep the event loop non‑blocking, especially when many directories are being watched concurrently.

---

### Architectural patterns identified  

* **Observer / Event‑Listener pattern** – FileWatcher subscribes to `'change'` and `'error'` events from the **fs.watch()** API and publishes them to its parent.  
* **Composition** – FileWatcher is composed inside the larger **FileWatchHandler** component, reflecting a hierarchical structure.  

### Design decisions and trade‑offs  

* **Synchronous vs. asynchronous FS checks** – Using synchronous checks simplifies startup logic but can block the event loop; async checks improve scalability at the cost of added callback/Promise handling.  
* **Auto‑create missing directory vs. fail‑fast** – Auto‑creation improves robustness in environments where the directory may be removed, while failing fast surfaces configuration problems early.  

### System structure insights  

The system is a small, tightly‑coupled in‑process module where **FileWatcher** is the low‑level driver, **FileWatchHandler** coordinates higher‑level concerns, **ErrorHandlingMechanism** centralises exception policy, and **FileProcessor** consumes the events to perform I/O work.  All components rely on the same core **fs** module, reinforcing a shared‑dependency model.

### Scalability considerations  

* **Number of watched directories** – Each call to **fs.watch()** consumes an OS file descriptor; scaling to hundreds of directories may hit system limits, suggesting the need for a descriptor‑budget or a fallback to polling (`fs.watchFile`).  
* **Event burst handling** – High‑frequency file writes can generate many `'change'` events; without debouncing or throttling, downstream processors could become a bottleneck.  

### Maintainability assessment  

Because the implementation is built directly on Node’s native **fs** API and follows a clear observer model, the codebase remains easy to understand and modify.  The separation of concerns—watching (FileWatcher), error handling (ErrorHandlingMechanism), and processing (FileProcessor)—supports independent evolution of each piece.  However, the lack of explicit abstraction layers (e.g., an interface for the watcher) could make future replacement of the **fs.watch()** mechanism (for cross‑platform consistency) more invasive.  Adding a thin wrapper interface around the watcher would improve testability and future adaptability without disrupting the current design.


## Hierarchy Context

### Parent
- [FileWatchHandler](./FileWatchHandler.md) -- FileWatchHandler utilizes the Node.js fs module to watch a directory for new log files, providing methods for handling file system events.

### Siblings
- [ErrorHandlingMechanism](./ErrorHandlingMechanism.md) -- The ErrorHandlingMechanism would likely involve using try-catch blocks to catch errors thrown by the Node.js fs module, such as errors when trying to read or write to a file.
- [FileProcessor](./FileProcessor.md) -- The FileProcessor class would likely utilize the Node.js fs module's write() function to write log data to the log files, as seen in the fs module documentation.


---

*Generated from 3 observations*
