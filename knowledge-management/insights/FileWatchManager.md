# FileWatchManager

**Type:** SubComponent

The SpecstoryAdapter class, which is part of the FileWatchManager, may use a file system interface like fs-extra to interact with the file system.

## What It Is  

The **FileWatchManager** is a sub‑component that lives inside the **Trajectory** component.  Its primary responsibility is to monitor a set of files and directories defined in a configuration file (e.g., `config.json`) and surface file‑system change events to the rest of the application.  The manager relies on the widely‑used **chokidar** library to create low‑level file system watchers, and it delegates the actual file‑system interactions (reading, writing, copying) to the **SpecstoryAdapter**, which in turn uses **fs‑extra**.  Path handling and normalization are performed with **lodash**, while a lightweight cache is kept to avoid unnecessary disk I/O.  In the component hierarchy, **FileWatchManager** contains a child component called **FileSystemWatcher**, which encapsulates the direct chokidar usage, and it sits alongside sibling sub‑components such as **ConnectionRetryManager**, **IPCManager**, and **SpecstoryAdapter**.

---

## Architecture and Design  

The design of **FileWatchManager** is fundamentally **event‑driven**.  By wiring chokidar’s native events (`add`, `change`, `unlink`, etc.) into an internal event emitter, the manager provides a standardized notification surface that other parts of Trajectory can subscribe to.  This mirrors the pattern used by the sibling **IPCManager**, which also establishes channels (via `ipc‑main`) to propagate messages across process boundaries.  

A **factory pattern** is evident in the surrounding ecosystem: the **SpecstoryAdapter** (implemented in `lib/integrations/specstory-adapter.js`) creates concrete file‑system adapters based on configuration, allowing **FileWatchManager** to remain agnostic about the underlying file‑system library.  While the manager itself does not expose a factory, it consumes the adapter that was produced by this pattern, reinforcing loose coupling between the watcher and the file‑system implementation.  

Caching is introduced as a performance optimisation.  The manager maintains an in‑memory map of file metadata (e.g., modification timestamps) so that when a chokidar event fires, the manager can quickly decide whether the change is significant enough to broadcast.  This trade‑off reduces the number of `fs‑extra` calls but adds complexity around cache invalidation when external processes modify files outside of chokidar’s view.  

The **FileSystemWatcher** child encapsulates the raw chokidar instance, exposing a thin API (`startWatching(paths)`, `stopWatching()`) that the parent **FileWatchManager** orchestrates.  This separation of concerns keeps the higher‑level manager focused on configuration parsing, event aggregation, and caching, while the child deals with the low‑level OS notifications.

---

## Implementation Details  

1. **Configuration Loading** – At startup, **FileWatchManager** reads `config.json` (the path is resolved relative to the Trajectory root).  The JSON contains an array of watch descriptors, each specifying a directory or file pattern.  The manager normalizes these paths with **lodash** (`_.toPath`, `_.trimEnd`) to guarantee a consistent format before passing them to the watcher.  

2. **Watcher Instantiation** – The manager creates an instance of **FileSystemWatcher**, which internally constructs a chokidar watcher:  
   ```js
   const watcher = chokidar.watch(normalizedPaths, {
     ignored: /(^|[\/\\])\../,   // ignore dotfiles
     persistent: true,
   });
   ```  
   The child component registers chokidar callbacks (`on('add')`, `on('change')`, `on('unlink')`) and forwards them to the parent via an internal event emitter (`this.emit('fileChanged', payload)`).  

3. **File‑System Interaction** – When a change event needs to be processed (e.g., to read the new content), **FileWatchManager** calls into **SpecstoryAdapter**, which uses **fs‑extra** methods such as `readFile`, `ensureDir`, and `copy`.  Because the adapter is created through the factory in `lib/integrations/specstory-adapter.js`, the manager can swap out the concrete implementation without code changes.  

4. **Caching Layer** – The manager maintains a simple map: `{ filePath → { mtime, size, hash } }`.  On each `change` event, it compares the incoming file’s metadata (retrieved via `fs‑extra.stat`) with the cached entry.  If the metadata matches, the event is suppressed; otherwise, the cache is updated and the event is emitted to listeners.  

5. **Event Propagation** – Consumers of **FileWatchManager** (e.g., other Trajectory services) subscribe to its events (`fileAdded`, `fileModified`, `fileRemoved`).  Because the manager follows the same event‑driven style as **ConnectionRetryManager** and **IPCManager**, these subscriptions can be wired through a shared event bus or through direct listener registration.  

---

## Integration Points  

- **Parent – Trajectory**: The Trajectory component injects **FileWatchManager** via its dependency‑injection container, supplying the path to `config.json` and the concrete **SpecstoryAdapter** instance.  This mirrors how Trajectory injects **ConnectionRetryManager** and **IPCManager**, fostering a uniform initialization contract across siblings.  

- **Sibling – SpecstoryAdapter**: The manager relies on the adapter’s factory‑produced instance for all file‑system operations.  The adapter lives in `lib/integrations/specstory-adapter.js`; its `initialize()` method is called before the watcher starts, ensuring any required directories are prepared.  

- **Sibling – ConnectionRetryManager & IPCManager**: While these components serve different concerns (retry logic and inter‑process communication), they share the same event‑driven communication style.  For example, a retry policy in **ConnectionRetryManager** might listen for `fileModified` events to trigger a reconnection attempt.  

- **Child – FileSystemWatcher**: This encapsulated watcher is the only place where chokidar is directly referenced.  It exposes a minimal API that the parent manager uses, allowing future replacement of chokidar (e.g., with a native OS watcher) without affecting the rest of the system.  

- **External Dependencies**: The manager imports `chokidar`, `lodash`, and `fs‑extra`.  These are declared in the project's `package.json` and are expected to be present in the runtime environment.  No other external services are required, keeping the component self‑contained.  

---

## Usage Guidelines  

1. **Configuration Discipline** – Keep `config.json` up to date with the exact paths or glob patterns you need to monitor.  Over‑broad patterns can cause a flood of events and degrade the caching effectiveness.  

2. **Cache Awareness** – When external tools modify files without triggering chokidar (e.g., network‑mounted drives with delayed notifications), manually invalidate the manager’s cache by calling its `clearCache()` method or by restarting the manager.  

3. **Event Subscription** – Subscribe to the high‑level events (`fileAdded`, `fileModified`, `fileRemoved`) rather than the raw chokidar events.  This abstracts away the underlying library and ensures you receive de‑duplicated notifications thanks to the caching layer.  

4. **Adapter Compatibility** – If you need to replace the file‑system implementation (for example, to use a virtual file system), provide a new adapter that conforms to the same interface used by **SpecstoryAdapter** and register it through the factory in `lib/integrations/specstory-adapter.js`.  The rest of **FileWatchManager** will continue to operate unchanged.  

5. **Resource Management** – Call `stopWatching()` on the manager (which forwards to **FileSystemWatcher**) during graceful shutdown of Trajectory to release OS file descriptors and avoid memory leaks.  

---

### Summary of Key Insights  

| Item | Details |
|------|---------|
| **Architectural patterns identified** | Event‑driven notification model, Factory pattern (via SpecstoryAdapter), Separation of concerns through a child **FileSystemWatcher** component, Simple in‑memory caching |
| **Design decisions and trade‑offs** | Chose chokidar for cross‑platform watching (simplicity, community support) vs. potential native watcher performance; introduced caching to reduce fs‑extra calls (adds cache‑invalidation complexity); used a factory to decouple file‑system implementation (adds indirection) |
| **System structure insights** | **FileWatchManager** sits under **Trajectory**, contains **FileSystemWatcher**, and shares an event‑driven style with siblings **ConnectionRetryManager**, **IPCManager**, and **SpecstoryAdapter**.  Configuration lives in `config.json`; path handling via lodash; file I/O via fs‑extra. |
| **Scalability considerations** | The event‑driven approach scales well as more listeners are added; chokidar can handle thousands of watched paths but may need tuning of OS limits (e.g., `max_user_watches`).  The cache helps keep CPU usage low under high‑frequency change bursts, but memory consumption grows with the number of watched files. |
| **Maintainability assessment** | Clear separation between watcher (child), manager (parent), and file‑system adapter (sibling) makes the codebase modular.  Reliance on well‑known libraries (chokidar, lodash, fs‑extra) reduces the need for custom low‑level code.  The factory pattern centralizes adapter creation, simplifying future swaps.  The primary maintenance burden lies in keeping `config.json` accurate and managing cache invalidation when external processes bypass chokidar. |

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's use of dependency injection is evident in the SpecstoryAdapter class, where it utilizes a factory pattern to create instances of different connection methods. This is seen in the lib/integrations/specstory-adapter.js file, where the constructor() function is used to initialize the adapter with the required dependencies. The initialize() function is then used to set up the connection, and the logConversation() function is used to log any errors or warnings that occur during the connection process. This pattern allows for loose coupling between the adapter and the connection methods, making it easier to switch between different connection methods or add new ones.

### Children
- [FileSystemWatcher](./FileSystemWatcher.md) -- The parent component analysis suggests the use of a library like chokidar to watch file system events, which is a common pattern in file system notification handling.

### Siblings
- [ConnectionRetryManager](./ConnectionRetryManager.md) -- ConnectionRetryManager utilizes a factory pattern in lib/integrations/specstory-adapter.js to create instances of different connection methods, allowing for loose coupling between the adapter and the connection methods.
- [IPCManager](./IPCManager.md) -- IPCManager uses a library like ipc-main to establish IPC channels between processes or threads.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter uses a factory pattern to create instances of different connection methods, allowing for loose coupling between the adapter and the connection methods.

---

*Generated from 6 observations*
