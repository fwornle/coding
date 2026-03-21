# MilestoneManager

**Type:** Detail

The MilestoneManager may implement validation and error handling mechanisms to ensure that project milestone data is accurate and consistent, using a pattern similar to the LLMRetryPolicy.

## What It Is  

**MilestoneManager** is the core service responsible for creating, updating, and deleting project milestone data inside the **ProjectMilestoneManager** domain. It lives under the same logical layer as its siblings **MilestoneTracker** and **SpecstoryIntegration**, and its implementation is tightly coupled to the **SpecstoryAdapter** found in `lib/integrations/specstory-adapter.js`. The manager does not expose its own source files in the current observation set, but its responsibilities are inferred from the way the parent component **ProjectMilestoneManager** and the sibling components interact with the Specstory extension through the shared adapter. In practice, MilestoneManager acts as the business‑logic façade that validates milestone payloads, persists them (likely via a storage mechanism reminiscent of the *SharedMemoryStore* pattern), and applies retry/error‑handling strategies similar to the *LLMRetryPolicy*.

---

## Architecture and Design  

The architecture that emerges from the observations is a **layered, adapter‑driven design**. At the outermost edge, the **SpecstoryAdapter** (`lib/integrations/specstory-adapter.js`) encapsulates all communication with the external Specstory extension, presenting a clean, domain‑specific interface to the internal components. MilestoneManager consumes this adapter, which is a textbook **Adapter pattern**: it translates the generic Specstory API into Milestone‑centric operations (create, update, delete).  

Within MilestoneManager itself, two secondary patterns are hinted at:

1. **SharedMemoryStore‑like persistence** – the manager “may utilize a data storage mechanism, such as a database or file system, to persist project milestone information.” This suggests a **Repository‑style abstraction** that hides the concrete storage (DB, file) behind a simple CRUD contract.  

2. **LLMRetryPolicy‑style validation and error handling** – the manager “may implement validation and error handling mechanisms… using a pattern similar to the LLMRetryPolicy.” This points to a **Retry/Policy pattern** that wraps external calls (through SpecstoryAdapter) and internal validation steps, automatically retrying transient failures and surfacing consistent error objects.

The parent component **ProjectMilestoneManager** aggregates MilestoneManager, exposing it to higher‑level workflows. Its siblings—**MilestoneTracker** and **SpecstoryIntegration**—also depend on the same SpecstoryAdapter, indicating **shared integration logic** and reducing duplication across the domain.

---

## Implementation Details  

Although no concrete code symbols for MilestoneManager are listed, the observations let us reconstruct its internal scaffolding:

* **SpecstoryAdapter Dependency** – MilestoneManager imports the adapter from `lib/integrations/specstory-adapter.js`. All external milestone actions (e.g., `adapter.createMilestone(payload)`, `adapter.updateMilestone(id, payload)`) are delegated to this module, ensuring that any change to the Specstory API only requires updates inside the adapter.

* **Persistence Layer** – The manager likely holds a reference to a storage service (e.g., `MilestoneStore`) that follows the *SharedMemoryStore* conventions: simple `get`, `set`, `delete` methods backed by either an in‑memory cache, a relational DB, or a file system. This abstraction enables quick reads for UI components while guaranteeing durability for long‑term reporting.

* **Validation & Retry** – Before invoking the adapter, MilestoneManager validates incoming milestone objects (checking required fields such as `title`, `dueDate`, `status`). Validation errors are wrapped in a consistent error type. When calling the adapter, the manager wraps the call in a retry loop modeled after *LLMRetryPolicy*: transient network errors trigger a configurable number of retries with exponential back‑off, while permanent failures are propagated immediately.

* **Error Propagation** – All errors, whether from validation, persistence, or the adapter, are normalized into a common error schema. This simplifies consumption by the parent **ProjectMilestoneManager**, which can surface user‑friendly messages or trigger compensating actions.

* **Public API** – The manager likely exports methods such as `createMilestone(data)`, `updateMilestone(id, data)`, `deleteMilestone(id)`, and `listMilestones(filter)`. These methods orchestrate validation → persistence → external synchronization via the adapter, ensuring data consistency across the local store and the Specstory extension.

---

## Integration Points  

1. **SpecstoryAdapter (`lib/integrations/specstory-adapter.js`)** – The sole external integration point. Both MilestoneManager and its siblings (MilestoneTracker, SpecstoryIntegration) rely on this file to speak to Specstory. Any change in the Specstory API must be reflected only here, preserving the stability of MilestoneManager’s contract.

2. **ProjectMilestoneManager (Parent)** – Acts as the orchestrator for the whole milestone domain. It instantiates MilestoneManager and forwards higher‑level commands (e.g., “create a new project milestone”) to it. The parent may also combine results from MilestoneTracker and SpecstoryIntegration, using the same underlying adapter.

3. **Persistence Service (Implicit)** – Though not named, the storage mechanism is an integration point with the broader system’s data layer (e.g., a shared DB connection pool or a file‑system service). It must conform to the *SharedMemoryStore* expectations to guarantee atomicity and consistency.

4. **Validation/Policy Layer** – The retry‑policy component, inspired by *LLMRetryPolicy*, may be a shared utility used across the codebase for handling flaky external calls. MilestoneManager plugs into this utility to gain consistent retry behavior.

---

## Usage Guidelines  

* **Always go through the SpecstoryAdapter** – Direct calls to the Specstory API from MilestoneManager (or any sibling) bypass the adapter and break the single‑source‑of‑truth principle. Keep all external interactions encapsulated in `lib/integrations/specstory-adapter.js`.

* **Validate before persisting** – Invoke MilestoneManager’s validation helpers before attempting to store data. This prevents corrupt milestone records from entering the persistence layer and ensures that retry logic only handles recoverable errors.

* **Respect the retry policy** – Do not implement ad‑hoc retry loops around adapter calls. Use the built‑in policy (mirroring *LLMRetryPolicy*) to benefit from exponential back‑off and centralized error handling.

* **Treat the storage abstraction as opaque** – Whether MilestoneManager ends up using a database, a file, or an in‑memory cache should be invisible to callers. Rely on the manager’s CRUD methods; avoid reaching into the underlying store directly.

* **Coordinate with sibling components** – Since MilestoneTracker and SpecstoryIntegration share the same adapter, any change to the adapter’s public interface must be communicated across these components. Consider versioning the adapter if breaking changes are unavoidable.

---

### 1. Architectural patterns identified  
* **Adapter pattern** – `SpecstoryAdapter` abstracts the Specstory extension.  
* **Repository/SharedMemoryStore‑style persistence** – MilestoneManager likely uses a storage abstraction that mimics the SharedMemoryStore contract.  
* **Retry/Policy pattern** – Validation and error handling follow a pattern similar to *LLMRetryPolicy*.  

### 2. Design decisions and trade‑offs  
* **Centralised integration via SpecstoryAdapter** reduces duplication but creates a single point of failure; the retry policy mitigates this.  
* **Abstracted persistence** grants flexibility (swap DB ↔ file) at the cost of added indirection and the need for a well‑defined contract.  
* **Validation before persistence** ensures data integrity but may add latency for large bulk operations; the trade‑off favors correctness over raw speed.  

### 3. System structure insights  
* **Parent‑child relationship** – ProjectMilestoneManager owns MilestoneManager, providing a clear domain boundary.  
* **Sibling sharing** – MilestoneTracker and SpecstoryIntegration reuse the same adapter, indicating a cohesive integration layer.  
* **Layered flow** – UI or higher‑level services → ProjectMilestoneManager → MilestoneManager → Validation → Persistence → SpecstoryAdapter → Specstory extension.  

### 4. Scalability considerations  
* **Adapter bottleneck** – If many concurrent milestone operations hit Specstory, the adapter must be thread‑safe and possibly pool connections.  
* **Storage abstraction** – Switching from in‑memory to a distributed DB can scale read/write throughput without changing MilestoneManager logic.  
* **Retry policy** – Configurable back‑off limits prevent cascading failures under load, but aggressive retries could amplify load on Specstory; tuning is essential.  

### 5. Maintainability assessment  
* **High cohesion, low coupling** – By isolating external calls in `lib/integrations/specstory-adapter.js` and keeping validation/retry logic reusable, the codebase is easy to reason about and modify.  
* **Clear contract boundaries** – The CRUD API of MilestoneManager and the adapter’s methods act as stable interfaces, reducing ripple effects of changes.  
* **Potential risk** – Absence of explicit tests or concrete implementations in the observation set means that future developers must rely on documentation and the defined patterns; adding unit tests around the adapter and retry policy would further improve maintainability.

## Hierarchy Context

### Parent
- [ProjectMilestoneManager](./ProjectMilestoneManager.md) -- ProjectMilestoneManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to connect to the Specstory extension and manage project milestones.

### Siblings
- [MilestoneTracker](./MilestoneTracker.md) -- The SpecstoryAdapter class in lib/integrations/specstory-adapter.js is used to connect to the Specstory extension, enabling the MilestoneTracker to manage project milestones.
- [SpecstoryIntegration](./SpecstoryIntegration.md) -- The SpecstoryIntegration uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to connect to the Specstory extension, allowing it to manage project milestones.

---

*Generated from 3 observations*
