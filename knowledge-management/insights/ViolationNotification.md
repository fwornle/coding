# ViolationNotification

**Type:** Detail

ViolationNotification would likely utilize a messaging or event-driven architecture to notify the dashboard of new violations, potentially leveraging webhooks, callbacks, or message queues

## What It Is  

`ViolationNotification` is the component responsible for informing the rest of the system (most notably the dashboard) that a new rule‑break has been detected. The implementation lives in the same module hierarchy as the **ViolationCaptureService** and is invoked from the `captureViolation()` function found in **`violation-capture.js`**. When `captureViolation()` records a fresh violation, it passes the relevant metadata—such as the rule identifier, the offending entity, timestamps, and any contextual data—to `ViolationNotification`. The component then distributes this information through one or more configurable channels (e.g., email, in‑app alerts, or log entries) so that stakeholders can react in a timely manner.

## Architecture and Design  

The observations point to an **event‑driven notification architecture**. `captureViolation()` acts as the event source, emitting a “violation‑captured” event that `ViolationNotification` consumes. The delivery mechanisms mentioned—webhooks, callbacks, or message queues—are classic event‑propagation techniques that decouple the producer (the capture service) from the consumers (the dashboard, email service, logging subsystem, etc.).  

Because the component must support **customizable notification channels**, the design implicitly follows a **strategy‑like pattern**: each channel (email, in‑app, logging) is likely encapsulated behind a common interface, allowing the parent `ViolationCaptureService` to select or compose the desired strategies at runtime. This keeps the core notification logic agnostic to the specifics of each delivery medium, promoting extensibility without touching the event‑generation path.

Interaction flow (as inferred from the hierarchy):  

1. `ViolationCaptureService` calls `captureViolation()` in `violation-capture.js`.  
2. `captureViolation()` constructs a violation payload and triggers `ViolationNotification`.  
3. `ViolationNotification` routes the payload through the configured channel strategies, which may push the message onto a queue, invoke a webhook, or send a direct callback.  
4. Downstream listeners—such as the dashboard UI, email dispatcher, or log writer—receive the notification and act accordingly.

## Implementation Details  

The only concrete entry point we have is the **`captureViolation()` function** inside **`violation-capture.js`**. Its responsibility is to detect a new violation, enrich it with metadata, and then hand the payload to `ViolationNotification`. While the source code is not present, the described behavior suggests the function performs the following steps:

* **Violation detection** – examines tool interactions, determines rule breach.  
* **Metadata assembly** – gathers identifiers, timestamps, and any additional context needed by downstream consumers.  
* **Notification dispatch** – calls a method on `ViolationNotification`, probably something like `notify(payload)`.

`ViolationNotification` itself is expected to expose a thin façade that abstracts the underlying delivery mechanisms. Internally, it likely maintains a registry of **channel handlers** (e.g., `EmailChannel`, `InAppChannel`, `LogChannel`). When `notify` is invoked, it iterates over the enabled handlers, handing each the same payload. Each handler then decides how to forward the data: an email handler might format an HTML message and hand it to an SMTP client; an in‑app handler could push the payload onto a WebSocket or publish it to a message queue that the dashboard subscribes to; the logging handler would simply write a structured entry to the system log.

Because the component is a child of **ViolationCaptureService**, it inherits any configuration that the service supplies—such as which channels are active for a given deployment or environment. This hierarchical configuration reduces duplication and ensures consistent notification behavior across the capture pipeline.

## Integration Points  

* **Parent – ViolationCaptureService** – owns `ViolationNotification` and supplies configuration (enabled channels, retry policies, etc.). The service also orchestrates the overall capture workflow, calling `captureViolation()` and handling any post‑notification steps (e.g., persisting the violation).  
* **Sibling – ViolationFilter** – runs before `ViolationNotification` is invoked. Its filtering logic (e.g., deduplication via a Set or Map) determines whether a violation is “new” enough to merit a notification. If a duplicate is filtered out, `ViolationNotification` is never called for that event.  
* **Sibling – ViolationStorage** – persists the violation after it has been captured and possibly after notification. Storage may be a database or file system; it does not directly interact with `ViolationNotification` but relies on the same payload structure, ensuring that what is stored matches what is communicated.  
* **External Consumers** – the dashboard UI, email service, and logging infrastructure are downstream consumers that subscribe to the channels exposed by `ViolationNotification`. Their contracts are defined by the payload shape produced by `captureViolation()`.

## Usage Guidelines  

1. **Trigger Only Through Capture Service** – Developers should never call `ViolationNotification` directly. Always use `ViolationCaptureService.captureViolation()` so that filtering and storage steps are respected.  
2. **Configure Channels Centrally** – Channel activation (email, in‑app, logging) should be defined in the `ViolationCaptureService` configuration file. Adding a new channel requires implementing a handler that conforms to the existing channel interface and registering it in the service’s configuration.  
3. **Payload Consistency** – The payload passed from `captureViolation()` must contain all fields expected by every channel (e.g., `ruleId`, `entityId`, `timestamp`, `details`). Missing fields can cause silent failures in downstream handlers.  
4. **Idempotency Awareness** – Because `ViolationFilter` may drop duplicates, ensure that any side‑effects in custom channels are idempotent or tolerant of repeated calls.  
5. **Monitoring and Retries** – If a channel uses a message queue or webhook, configure appropriate retry logic within the channel handler. Do not embed retry loops in `captureViolation()`; keep the capture path fast and non‑blocking.

---

### Architectural patterns identified  
* **Event‑driven notification** – `captureViolation()` emits an event consumed by `ViolationNotification`.  
* **Strategy‑like channel abstraction** – interchangeable notification channels (email, in‑app, logging) behind a common interface.

### Design decisions and trade‑offs  
* **Decoupling via events** improves scalability and allows independent evolution of consumers, but introduces latency if asynchronous queues are used.  
* **Channel strategy abstraction** provides extensibility (easy addition of new channels) at the cost of added indirection and the need for a disciplined interface contract.

### System structure insights  
`ViolationNotification` sits as a child of `ViolationCaptureService`, receiving a clean, filtered payload from `captureViolation()`. Its siblings (`ViolationFilter`, `ViolationStorage`) form a pipeline: filter → notification → storage. This linear flow simplifies reasoning about data lineage and ensures that every persisted violation has a corresponding notification (unless filtered).

### Scalability considerations  
* Because the notification path can be backed by message queues or webhooks, the system can scale horizontally by adding more consumer instances (e.g., multiple dashboard servers).  
* Channel handlers should be stateless to allow load‑balanced deployment.  
* High‑volume violation bursts may pressure the queue; configuring appropriate back‑pressure or burst‑handling policies is advisable.

### Maintainability assessment  
The clear separation of concerns—capture, filter, notification, storage—makes the codebase modular and easier to maintain. Adding or modifying a notification channel only requires changes within the channel handler and its registration, leaving the capture logic untouched. However, the reliance on implicit configuration (parent service supplying channel lists) mandates thorough documentation of the configuration schema to avoid mismatches between what the capture service expects and what the notification handlers provide.

## Hierarchy Context

### Parent
- [ViolationCaptureService](./ViolationCaptureService.md) -- ViolationCaptureService uses the captureViolation() function in the violation-capture.js file to capture violations from tool interactions

### Siblings
- [ViolationFilter](./ViolationFilter.md) -- The captureViolation() function in violation-capture.js likely utilizes a filtering mechanism to exclude duplicate violations, potentially leveraging a data structure like a Set or Map to track unique violations
- [ViolationStorage](./ViolationStorage.md) -- ViolationStorage would likely utilize a database or file storage system to persist captured violations, with potential considerations for data serialization, indexing, and querying

---

*Generated from 3 observations*
