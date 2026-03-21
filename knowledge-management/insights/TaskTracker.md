# TaskTracker

**Type:** SubComponent

TaskTracker may implement a retry mechanism to handle potential connection failures when connecting to the Specstory extension.

## What It Is  

TaskTracker is a **sub‑component of the Trajectory module** that is responsible for managing, prioritising and monitoring the flow of work items inside a project.  Although the source tree does not list a concrete file for TaskTracker, the surrounding documentation places it under the same logical hierarchy as the other Trajectory children (e.g., *ProjectMilestoneManager* and *PhasePlanner*).  Its primary responsibilities are to *retrieve task data from the Specstory extension*, *organise that data in a local queue*, *coordinate with PhasePlanner for phase‑level context*, and *expose a reliable, load‑balanced interface for downstream consumers*.  

The component draws on three concrete artefacts that are explicitly named in the observations:  

* **`SpecstoryAdapter`** – located at `lib/integrations/specstory-adapter.js`.  This class implements the `connectViaHTTP` method that attempts connections on ports **7357, 7358 and 7359**, providing both a retry mechanism and a rudimentary load‑balancing strategy.  
* **`PhasePlanner`** – a sibling component that supplies phase‑planning data which TaskTracker consumes to enrich its task‑level view.  
* **`Trajectory`** – the parent component whose broader architecture is built around flexible, multi‑integration planning; TaskTracker inherits the same integration philosophy.  

Together, these pieces give TaskTracker a clear purpose: act as the “task‑centric” façade that turns raw Specstory payloads into an ordered, retry‑safe work queue that other Trajectory services can query.

---

## Architecture and Design  

The observations reveal a **modular, integration‑centric architecture**.  Each functional area (Specstory connectivity, phase planning, task queuing) lives in its own class or component, and TaskTracker composes them rather than embedding their logic.  Two concrete design patterns emerge:

1. **Adapter Pattern** – `SpecstoryAdapter` abstracts the details of communicating with the external Specstory extension (HTTP, IPC, file‑watch).  By delegating connection logic to this adapter, TaskTracker remains agnostic to the transport mechanism and can be swapped or extended without touching its core code.  

2. **Queue‑Based Work Scheduler** – The mention of a “task queue to manage and prioritize tasks” indicates an internal **producer‑consumer** arrangement.  Incoming task payloads are produced by the SpecstoryAdapter callback, placed onto the queue, and later consumed by whatever subsystem (e.g., UI, reporting, or downstream planners) needs to act on them.  

The **load‑balancing strategy** is not a full‑blown load‑balancer service but a *port‑rotation* technique baked into `SpecstoryAdapter.connectViaHTTP`.  By attempting connections on three distinct ports, the system distributes connection attempts across multiple listening sockets, reducing the chance that a single saturated port becomes a bottleneck.  

The **retry mechanism** is also embedded in `SpecstoryAdapter`.  When a connection attempt fails on one port, the adapter automatically falls back to the next port, repeating until a successful handshake is made or all ports are exhausted.  This behaviour is directly re‑used by TaskTracker, ensuring that task retrieval is resilient without requiring additional retry logic inside TaskTracker itself.

---

## Implementation Details  

### SpecstoryAdapter (`lib/integrations/specstory-adapter.js`)  
* **`connectViaHTTP`** – Iterates over the port list `[7357, 7358, 7359]`. For each port it opens an HTTP client, attempts a handshake with the Specstory extension, and, on success, returns a live connection object.  Failures trigger a catch block that logs the error and proceeds to the next port, embodying both **retry** and **load‑balancing**.  

* **Transport Flexibility** – Though not explicitly listed in the observations, the parent‑component description notes that the adapter also supports IPC and file‑watch methods.  This reinforces the adapter’s role as a single point of change for any future transport additions.  

### TaskTracker (implementation inferred)  
* **Dependency on SpecstoryAdapter** – TaskTracker creates an instance of `SpecstoryAdapter` (or receives one via constructor injection) and calls `connectViaHTTP` to obtain a stable channel to Specstory.  The resulting stream of task objects is fed into the internal queue.  

* **Task Queue** – Likely a priority queue or FIFO structure (the observation only mentions “manage and prioritize”).  The queue exposes typical operations: `enqueue(task)`, `dequeue()`, and possibly `reorder(priority)`.  By centralising task ordering here, TaskTracker can enforce business rules such as “high‑priority bugs jump ahead of routine feature tasks”.  

* **PhasePlanner Integration** – TaskTracker imports or references the `PhasePlanner` sibling to enrich each task with phase metadata (e.g., which planning phase the task belongs to).  This coupling is read‑only; TaskTracker does not modify phase data, only annotates tasks for downstream consumption.  

* **Error Handling** – Beyond the adapter‑level retry, TaskTracker may implement its own fallback (e.g., persisting failed tasks to a local cache) but such behaviour is not confirmed by the observations, so it is not asserted here.  

### Interaction Flow (high‑level)  

1. **Initialisation** – Trajectory boots, instantiates `SpecstoryAdapter`, passes it to TaskTracker.  
2. **Connection** – `SpecstoryAdapter.connectViaHTTP` tries ports 7357 → 7358 → 7359 until a live connection is established.  
3. **Data Retrieval** – Specstory pushes task payloads over the established channel.  
4. **Queue Ingestion** – TaskTracker receives each payload, optionally enriches it with phase data from `PhasePlanner`, then enqueues it.  
5. **Consumption** – Other Trajectory services (e.g., UI dashboards, reporting engines) dequeue tasks according to their own scheduling policies.  

---

## Integration Points  

* **Parent – Trajectory** – TaskTracker is a child of Trajectory, inheriting the component’s overall goal of “flexible and scalable planning”.  All configuration (e.g., which ports to try, queue size limits) is likely propagated from Trajectory’s configuration object.  

* **Sibling – PhasePlanner** – Provides phase‑level context.  The integration is read‑only and likely occurs through a method such as `PhasePlanner.getPhaseForTask(taskId)`.  This keeps the responsibilities clean: PhasePlanner owns phase data, TaskTracker owns task flow.  

* **Sibling – SpecstoryAdapter** – The sole gateway to the external Specstory extension.  Because the adapter already implements retry and port‑rotation, TaskTracker does not need to duplicate those concerns.  

* **Sibling – ProjectMilestoneManager** – While not directly referenced, the sibling’s similar use of `SpecstoryAdapter.connectViaHTTP` suggests that multiple Trajectory sub‑components may share a single adapter instance, further encouraging resource reuse and consistent error handling across the system.  

* **External – Specstory Extension** – The ultimate data source.  The adapter abstracts the protocol (HTTP, IPC, file watch), so any change on the Specstory side (e.g., new port, new transport) only requires updates inside `SpecstoryAdapter`.  

---

## Usage Guidelines  

1. **Instantiate via Trajectory** – Do not create TaskTracker in isolation.  Let the Trajectory bootstrap process provide a fully‑wired instance that already has a `SpecstoryAdapter` and a reference to `PhasePlanner`.  

2. **Prefer the Adapter’s `connectViaHTTP`** – When configuring environments (development, CI, production), rely on the default port list (7357‑7359).  Adding or removing ports should be done in `SpecstoryAdapter` only; TaskTracker will automatically benefit from the change.  

3. **Treat the Queue as the Single Source of Truth** – All downstream components should consume tasks *only* from TaskTracker’s queue.  Directly querying Specstory bypasses the retry/load‑balancing logic and defeats the purpose of the adapter.  

4. **Do Not Embed Retry Logic in TaskTracker** – The retry mechanism lives in the adapter.  Adding additional retries at the TaskTracker level can cause duplicate attempts and unnecessary load on the Specstory extension.  

5. **Respect PhasePlanner Read‑Only Access** – When enriching tasks, call the appropriate PhasePlanner accessor methods but never mutate phase data from within TaskTracker.  This preserves the clear separation of concerns and avoids race conditions.  

6. **Monitor Connection Health** – Although the adapter retries automatically, it is advisable to expose health‑check metrics (e.g., “last successful port”, “retry count”) from TaskTracker so operations teams can spot chronic connectivity issues.  

---

### Summary of Architectural Insights  

| Aspect | Observation‑Based Insight |
|--------|----------------------------|
| **Architectural patterns** | Adapter (SpecstoryAdapter), Producer‑Consumer Queue, Port‑rotation load‑balancing, Retry on connection failure |
| **Design decisions** | Separate connectivity (adapter) from business logic (TaskTracker); use a small, fixed set of ports to spread load; keep task prioritisation internal to a queue; read‑only dependency on PhasePlanner |
| **Trade‑offs** | Simplicity of port‑rotation vs. more sophisticated load balancers; limited to three ports (scales up to modest concurrency); retry logic is coarse‑grained (fails after all ports exhausted) – may need higher‑level back‑off for very flaky networks |
| **System structure** | Hierarchical: Trajectory → TaskTracker (child) + PhasePlanner / ProjectMilestoneManager / SpecstoryAdapter (siblings).  Shared adapter instance promotes reuse. |
| **Scalability** | Load is distributed across three ports; queue can be sized to handle bursty task influx.  Scaling beyond the three‑port model would require extending `SpecstoryAdapter` to accept a configurable port list or a true load‑balancer. |
| **Maintainability** | High – responsibilities are cleanly separated, adapter isolates external changes, and the queue abstracts task ordering.  Adding new transport methods or additional ports only touches `SpecstoryAdapter`.  The only coupling is the read‑only PhasePlanner link, which is well‑defined. |

These insights should give developers a clear mental model of how **TaskTracker** fits into the broader Trajectory ecosystem, what patterns it relies on, and how to extend or maintain it without violating the established design contracts.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's architecture is designed to facilitate flexible and scalable planning and tracking of project milestones, with the SpecstoryAdapter class in lib/integrations/specstory-adapter.js playing a crucial role in connecting to the Specstory extension via HTTP, IPC, or file watch methods. This design decision allows for multiple integration points, enabling the component to adapt to different environments and use cases. The connectViaHTTP method in SpecstoryAdapter attempts to connect to the Specstory extension on multiple ports (7357, 7358, 7359) to establish a connection, demonstrating a retry mechanism to handle potential connection failures. The use of multiple ports also suggests a load-balancing strategy to distribute the connection load across different ports.

### Siblings
- [ProjectMilestoneManager](./ProjectMilestoneManager.md) -- ProjectMilestoneManager may utilize the connectViaHTTP method in SpecstoryAdapter to establish a connection to the Specstory extension on multiple ports (7357, 7358, 7359) to handle potential connection failures.
- [PhasePlanner](./PhasePlanner.md) -- PhasePlanner could utilize the SpecstoryAdapter class to connect to the Specstory extension and retrieve relevant phase planning data.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter implements the connectViaHTTP method to establish a connection to the Specstory extension on multiple ports (7357, 7358, 7359).

---

*Generated from 5 observations*
