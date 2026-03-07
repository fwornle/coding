# ViolationStorage

**Type:** Detail

The captureViolation() function in violation-capture.js may interact with ViolationStorage through an API or interface, allowing for standardized storage and retrieval of violation data

## What It Is  

`ViolationStorage` is the persistent backing component used by the **ViolationCaptureService** to keep a record of every rule‑or policy breach that the system detects.  The only concrete file reference we have is the `violation‑capture.js` module, whose `captureViolation()` function is expected to call into **ViolationStorage** through a well‑defined API or interface.  The storage implementation itself is not hard‑coded; the observations indicate that it may be backed by a relational or NoSQL database **or** a file‑based store, depending on the deployment’s performance and durability requirements.  Because it lives inside the **ViolationCaptureService** hierarchy, `ViolationStorage` is the authoritative source of truth for later stages such as filtering (handled by the sibling **ViolationFilter**) and notification (handled by the sibling **ViolationNotification**).

## Architecture and Design  

The design that emerges from the observations is a classic *separation‑of‑concerns* layout.  `captureViolation()` in `violation‑capture.js` does **not** embed persistence logic; instead it delegates to an abstraction exposed by **ViolationStorage**.  This abstraction behaves like a repository‑style interface: callers supply a violation object, and the storage layer handles serialization, indexing, and eventual retrieval.  The abstraction also encapsulates **data‑retention policies** –‑ rules that automatically expire or purge old records –‑ which keeps the lifecycle logic out of the capture path.

Interaction between components follows a *pipeline* model:

1. **ViolationCaptureService** receives raw violation data from tooling.  
2. `captureViolation()` (in `violation‑capture.js`) forwards the data to **ViolationStorage** via its API.  
3. The stored record is then available to **ViolationFilter**, which may use an in‑memory `Set`/`Map` to de‑duplicate before further processing.  
4. When a new violation survives filtering, **ViolationNotification** picks it up, employing an *event‑driven* mechanism (webhooks, callbacks, or a message queue) to push the information to the dashboard.

Thus, **ViolationStorage** sits at the heart of a linear flow, acting as the stable “source of truth” while remaining loosely coupled to both its parent (the capture service) and its siblings (filter and notification).

## Implementation Details  

Although no concrete symbols are listed, the observations give us enough to outline the internal mechanics:

* **Persistence Backend** – The storage layer likely abstracts over either a database client (e.g., PostgreSQL, MongoDB) or a file system writer (JSON, CSV, or binary blobs).  The choice is driven by the need for *indexing* (to support fast queries on violation type, timestamp, or severity) and *serialization* (converting in‑memory violation objects to a storable format).  

* **API / Interface** – `captureViolation()` calls a method such as `storeViolation(violation)` on **ViolationStorage**.  The method signature is probably generic enough to accept a plain JavaScript object describing the violation (e.g., `{ id, ruleId, assetId, timestamp, details }`).  By keeping the contract simple, the capture code remains agnostic to the underlying storage technology.

* **Retention Management** – A configurable policy module lives inside **ViolationStorage**.  It may run a scheduled job (e.g., a `setInterval`‑based timer or a cron‑style task) that scans stored records and removes those older than a configured TTL or that exceed a quota.  This keeps the data store from growing without bound and satisfies regulatory constraints.

* **Indexing Strategy** – To enable efficient look‑ups, the implementation likely creates indexes on fields that are frequently queried, such as `ruleId` or `timestamp`.  In a file‑based approach, this could be a secondary lookup structure (e.g., a Map of timestamps to file offsets) that is rebuilt on startup.

* **Error Handling & Idempotency** – Because `captureViolation()` may be invoked repeatedly for the same event, **ViolationStorage** probably returns a status indicating whether the record was newly created or already existed.  This allows the sibling **ViolationFilter** to safely ignore duplicates.

## Integration Points  

* **Parent – ViolationCaptureService** – The service owns an instance of **ViolationStorage** and passes it to `captureViolation()` in `violation‑capture.js`.  The service is responsible for initializing the storage (e.g., opening DB connections or creating storage directories) and for shutting it down cleanly.

* **Sibling – ViolationFilter** – After a violation is persisted, the filter reads from **ViolationStorage** (or receives a notification) to decide if the record is a duplicate.  The filter’s use of a `Set`/`Map` suggests that it may cache recently seen violation IDs, reducing the need for repeated DB look‑ups.

* **Sibling – ViolationNotification** – This component subscribes to events emitted by **ViolationStorage** (or by the capture service after a successful store) and forwards them downstream via webhooks, callbacks, or a message queue.  The event‑driven nature of the notification path is explicitly called out in the observations.

* **External Dependencies** – Depending on the chosen backend, **ViolationStorage** may depend on database drivers (`pg`, `mongoose`, etc.) or on file‑system utilities (`fs`, `path`).  It also likely relies on a serialization library (JSON.stringify, protobuf, etc.) and a scheduling library for retention jobs.

## Usage Guidelines  

1. **Treat `ViolationStorage` as a black‑box repository** – Call only the documented API (e.g., `storeViolation`, `queryViolations`, `purgeOld`).  Do not reach into the underlying DB or file system directly, as this would break the abstraction and make future backend swaps difficult.  

2. **Respect the retention policy** – When writing custom violation types, ensure that any metadata required for automated purging (such as a `createdAt` timestamp) is present.  Missing fields may cause the retention job to skip those records, leading to uncontrolled growth.  

3. **Leverage idempotent writes** – If the same violation may be reported multiple times, include a stable identifier (e.g., a hash of rule‑ID + asset‑ID + timestamp) so that **ViolationStorage** can detect duplicates.  This works hand‑in‑hand with **ViolationFilter**’s de‑duplication logic.  

4. **Avoid heavyweight payloads** – Since the storage may be indexed for fast queries, keep the `details` field concise or store large blobs elsewhere and reference them by ID.  This improves query performance and reduces storage costs.  

5. **Monitor retention jobs** – Configure alerts for the retention scheduler to surface failures (e.g., permission errors on file deletion or DB transaction failures).  A stalled retention process can quickly fill up storage and affect system stability.

---

### 1. Architectural patterns identified  

* **API/Interface abstraction** – `captureViolation()` interacts with **ViolationStorage** through a defined contract, decoupling capture logic from persistence.  
* **Event‑driven notification** – The sibling **ViolationNotification** consumes storage‑related events (webhooks, callbacks, or message‑queue messages) to inform downstream dashboards.  
* **Retention‑policy strategy** – A configurable policy that periodically expires or purges old records, akin to a strategy pattern for lifecycle management.  

### 2. Design decisions and trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Support both DB and file‑based backends | Flexibility for deployments with different durability/performance needs | Increases code complexity; must maintain two persistence paths and ensure feature parity (indexing, retention). |
| Centralized retention job | Guarantees storage does not grow unchecked, satisfies compliance | Introduces a background process that must be monitored; may cause temporary performance spikes during bulk purges. |
| Minimal API surface (store/query/purge) | Keeps capture code simple and encourages loose coupling | Limits advanced queries unless additional methods are added later, potentially requiring API expansion. |

### 3. System structure insights  

* **ViolationCaptureService** owns **ViolationStorage**, establishing a parent‑child relationship where the service orchestrates lifecycle (initialisation, shutdown).  
* **ViolationFilter** and **ViolationNotification** are siblings that consume the same persisted data but apply orthogonal concerns (deduplication vs. outward communication).  
* The overall system follows a *linear processing pipeline*: capture → store → filter → notify, with each stage isolated behind its own interface.

### 4. Scalability considerations  

* **Indexing** on frequently queried fields (rule ID, timestamp) enables the storage layer to handle growing volumes without degrading read performance.  
* **Retention policies** cap the data set size, preventing unbounded growth and allowing the backend to scale horizontally (e.g., sharding a DB) if needed.  
* If the file‑based backend is used, consider partitioning data by date directories to avoid single‑file bottlenecks.  
* The event‑driven path used by **ViolationNotification** can be scaled out by adding more consumers to the message queue without touching **ViolationStorage**.

### 5. Maintainability assessment  

The clear separation between capture, storage, filtering, and notification makes the codebase modular and easy to reason about.  Because **ViolationStorage** exposes a narrow, well‑defined API, changes to the underlying persistence technology (e.g., swapping PostgreSQL for DynamoDB) can be confined to the storage implementation without rippling through the capture or filter logic.  The only maintainability risk lies in supporting multiple backends simultaneously; rigorous automated tests for both paths are essential.  Overall, the design promotes high maintainability, provided that the retention scheduler and indexing logic are kept under version‑controlled configuration and are exercised in CI pipelines.


## Hierarchy Context

### Parent
- [ViolationCaptureService](./ViolationCaptureService.md) -- ViolationCaptureService uses the captureViolation() function in the violation-capture.js file to capture violations from tool interactions

### Siblings
- [ViolationFilter](./ViolationFilter.md) -- The captureViolation() function in violation-capture.js likely utilizes a filtering mechanism to exclude duplicate violations, potentially leveraging a data structure like a Set or Map to track unique violations
- [ViolationNotification](./ViolationNotification.md) -- ViolationNotification would likely utilize a messaging or event-driven architecture to notify the dashboard of new violations, potentially leveraging webhooks, callbacks, or message queues


---

*Generated from 3 observations*
