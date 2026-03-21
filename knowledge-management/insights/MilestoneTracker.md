# MilestoneTracker

**Type:** Detail

The MilestoneTracker may implement a notification system, alerting project managers and team members when milestones are approaching or have been completed, using a mechanism similar to the EventDrive...

## What It Is  

**MilestoneTracker** is the core component that watches the progress of a project and determines when defined milestones have been reached or are about to be reached. The implementation lives alongside the integration layer in the repository, most notably interacting with the **`SpecstoryAdapter`** class located in **`lib/integrations/specstory-adapter.js`**. The adapter is the bridge to the external **Specstory** extension, allowing MilestoneTracker to fetch and update milestone data that resides outside the core code‑base. In the component hierarchy, MilestoneTracker is a child of **`ProjectMilestoneManager`**, which owns it and orchestrates its lifecycle. It sits on the same level as sibling components such as **MilestoneManager** (responsible for persisting milestone state) and **SpecstoryIntegration** (another consumer of the SpecstoryAdapter). Together they form the “milestone” slice of the larger project‑tracking system.

## Architecture and Design  

The observable architecture follows a classic **Adapter** pattern: `SpecstoryAdapter` abstracts the concrete API of the Specstory extension behind a stable JavaScript interface, shielding MilestoneTracker from changes in the external service. This decoupling enables MilestoneTracker to remain focused on business logic—evaluating dates, status, and dependencies—while delegating all communication concerns to the adapter.  

MilestoneTracker also appears to employ an **event‑driven** approach, hinted at by the reference to an “EventDrivenPipeline”‑like mechanism for notifications. When a milestone’s deadline approaches or is fulfilled, the component likely emits an internal event that downstream listeners (e.g., UI notification services, email dispatchers, or Slack bots) consume. This loosely‑coupled publish/subscribe style keeps the notification logic separate from the core tracking algorithm, improving testability and allowing new notification channels to be added without touching MilestoneTracker itself.  

The component relies on a **Trajectory** service (or module) to obtain contextual project information—such as the current phase, team assignments, or historical velocity. By pulling this data from a dedicated source, MilestoneTracker avoids embedding project‑wide state, reinforcing the single‑responsibility principle.  

Sibling **MilestoneManager** is noted to use a **SharedMemoryStore**‑style persistence, suggesting that MilestoneTracker may read from an in‑memory cache that is kept in sync with a more durable store. This design hints at a read‑through cache pattern where MilestoneTracker can quickly evaluate milestone conditions without incurring costly I/O, while MilestoneManager ensures durability.

## Implementation Details  

The heart of the integration is the **`SpecstoryAdapter`** class in `lib/integrations/specstory-adapter.js`. Although the source code is not provided, the naming convention and placement imply a thin wrapper around Specstory’s REST or RPC endpoints. Typical responsibilities would include authentication handling, request throttling, and translation of Specstory’s data schema into the internal representation expected by MilestoneTracker.  

MilestoneTracker itself likely exposes a public API such as `evaluateMilestones(projectId)` or `registerMilestone(milestoneDescriptor)`. Internally, it would query the **Trajectory** component for the current project context, then iterate over the list of milestones obtained via the adapter. For each milestone, it would compute time‑based thresholds (e.g., “X days before due”) and fire events through an internal **EventBus** or similar pipeline when thresholds are crossed. The “EventDrivenPipeline” reference suggests the presence of a pipeline object that accepts events, enriches them (perhaps adding recipient lists or formatting), and forwards them to concrete notifiers.  

Because **ProjectMilestoneManager** contains MilestoneTracker, the manager probably instantiates the tracker, injects the `SpecstoryAdapter` (and possibly the Trajectory service) via constructor injection, and registers the manager’s own listeners to react to milestone events—such as updating UI dashboards or persisting audit logs. The sibling **SpecstoryIntegration** component also consumes the same adapter, indicating that the adapter is a shared service rather than a per‑component instance, which reduces duplication and centralises error handling.

## Integration Points  

1. **SpecstoryAdapter (`lib/integrations/specstory-adapter.js`)** – The primary external dependency. All calls to the Specstory extension flow through this class, making it the contract surface for any component that needs milestone data.  

2. **Trajectory Component** – Provides contextual project information (current sprint, team velocity, etc.). MilestoneTracker queries this component before evaluating milestones, ensuring that calculations respect the latest project state.  

3. **Event Bus / Notification Pipeline** – Although not explicitly named, the “EventDrivenPipeline” pattern implies an internal event bus that other parts of the system subscribe to. Notification services (email, chat, UI alerts) hook into this bus to receive milestone‑related events.  

4. **ProjectMilestoneManager** – Acts as the orchestrator, creating the MilestoneTracker instance, wiring the adapter, and possibly exposing higher‑level methods like `triggerMilestoneCheckAllProjects()`.  

5. **MilestoneManager (Sibling)** – Persists milestone definitions and state, likely using a **SharedMemoryStore** pattern. MilestoneTracker reads from this store for fast access, while MilestoneManager writes to the backing database or file system.  

6. **SpecstoryIntegration (Sibling)** – Another consumer of the SpecstoryAdapter, possibly handling bulk imports or synchronization tasks that are distinct from the per‑project tracking performed by MilestoneTracker.

## Usage Guidelines  

When extending or consuming MilestoneTracker, developers should always obtain an instance through **ProjectMilestoneManager** rather than instantiating it directly. This guarantees that the required `SpecstoryAdapter` and Trajectory services are correctly injected, preserving the adapter‑based decoupling. All interactions with external milestone data must go through the adapter; direct HTTP calls to Specstory are discouraged because they bypass authentication handling and error‑translation logic baked into the adapter.  

If a new notification channel is required, developers should plug it into the existing event‑driven pipeline rather than modifying MilestoneTracker’s core logic. The pipeline’s contract typically expects an event object containing at least `{ milestoneId, projectId, status, timestamp }`. Adding a listener that formats and dispatches the event (e.g., to Slack) keeps the system modular and respects the single‑responsibility principle.  

When persisting additional milestone attributes, updates should be made in **MilestoneManager** and reflected in the shared memory store. MilestoneTracker will automatically pick up the new data on the next evaluation cycle, provided the data schema remains compatible with the adapter’s output.  

Finally, any changes to the Specstory API version must be confined to `lib/integrations/specstory-adapter.js`. Because this adapter isolates external changes, the rest of the system—including MilestoneTracker, ProjectMilestoneManager, and the notification pipeline—remains stable, reducing regression risk.

---

### Architectural Patterns Identified  
1. **Adapter Pattern** – `SpecstoryAdapter` abstracts the Specstory extension.  
2. **Event‑Driven (EventDrivenPipeline) Pattern** – Milestone notifications are emitted as events.  
3. **Shared Memory Store / Cache** – Implied by MilestoneManager’s persistence strategy, enabling fast reads for MilestoneTracker.  

### Design Decisions & Trade‑offs  
- **Adapter vs Direct Calls** – Choosing an adapter isolates external API volatility but adds an extra indirection layer.  
- **Event‑Driven Notifications** – Provides extensibility at the cost of added complexity in event routing and potential latency.  
- **In‑Memory Cache** – Improves evaluation speed but requires cache invalidation logic to stay consistent with the durable store.  

### System Structure Insights  
The milestone subsystem is organized as a small, well‑bounded cluster: `ProjectMilestoneManager` (orchestrator) → `MilestoneTracker` (logic) ↔ `SpecstoryAdapter` (integration) ↔ `Trajectory` (context) ↔ `MilestoneManager` (persistence). Sibling components share the adapter, reinforcing a single source of truth for external communication.  

### Scalability Considerations  
- **Horizontal Scaling** – Because MilestoneTracker relies on a shared in‑memory cache, scaling out to multiple nodes will require a distributed cache (e.g., Redis) or a cache‑coherency strategy.  
- **Event Volume** – The event pipeline must be capable of handling bursts when many milestones transition simultaneously (e.g., end‑of‑sprint). Using a message broker with back‑pressure handling (Kafka, RabbitMQ) would mitigate bottlenecks.  
- **Adapter Load** – Specstory’s rate limits should be respected; the adapter can implement request throttling or batching to avoid exceeding quotas.  

### Maintainability Assessment  
The clear separation of concerns—adapter for external calls, tracker for business rules, manager for persistence, and event pipeline for notifications—creates a maintainable codebase. Each piece can be unit‑tested in isolation, and changes to one (e.g., a new Specstory endpoint) are confined to a single file (`lib/integrations/specstory-adapter.js`). The primary maintenance risk lies in the shared memory cache consistency and ensuring that event listeners remain loosely coupled; disciplined documentation of event schemas and versioning will be essential as the system evolves.

## Hierarchy Context

### Parent
- [ProjectMilestoneManager](./ProjectMilestoneManager.md) -- ProjectMilestoneManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to connect to the Specstory extension and manage project milestones.

### Siblings
- [MilestoneManager](./MilestoneManager.md) -- The MilestoneManager may utilize a data storage mechanism, such as a database or file system, to persist project milestone information, similar to the SharedMemoryStore pattern.
- [SpecstoryIntegration](./SpecstoryIntegration.md) -- The SpecstoryIntegration uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to connect to the Specstory extension, allowing it to manage project milestones.

---

*Generated from 3 observations*
