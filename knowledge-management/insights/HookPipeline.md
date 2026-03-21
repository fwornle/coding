# HookPipeline

**Type:** Detail

HookPipeline (HookOrchestrator.ts) utilizes a pub-sub pattern, enabling hooks to declare explicit subscription topics and facilitating loose coupling between hooks.

## What It Is  

**HookPipeline** is the core orchestration engine that lives inside `HookOrchestrator.ts`.  It is the concrete implementation that drives the life‑cycle of all registered hooks.  By sitting inside the `HookOrchestrator` component, HookPipeline acts as the single point where hook execution is scheduled, ordered, and monitored.  The pipeline relies on a **pub‑sub** model: each hook declares the topics it subscribes to, and the orchestrator (via the `SubscriptionManager` sibling) notifies the appropriate hooks when those topics are published.  In addition to the loose coupling afforded by pub‑sub, HookPipeline enforces an **explicit execution order**, guaranteeing that dependent hooks run in the correct sequence.  This combination makes HookPipeline the authoritative “centralized mechanism for hook execution” described in the observations.

---

## Architecture and Design  

The architecture surrounding HookPipeline is deliberately **centralized** yet **loosely coupled**.  The primary design pattern evident from the observations is the **publish‑subscribe (pub‑sub) pattern**.  Hooks act as *subscribers* by declaring the topics they care about; the `SubscriptionManager` (also defined in `HookOrchestrator.ts`) maintains a registry mapping topics to hook instances.  When a topic is emitted, the manager looks up the subscriber list and forwards the event to HookPipeline, which then schedules the hooks for execution.

A second, complementary design decision is the **ordered execution model**.  HookPipeline does not merely fire all subscribers in an undefined fashion; it respects a deterministic order that can be configured per‑hook.  This ordering solves the classic dependency problem where one hook must run before another (e.g., a validation hook before a persistence hook).  The orchestrator therefore provides both **decoupling** (via pub‑sub) and **dependency management** (via ordered execution) without forcing hooks to know about each other’s implementations.

The relationship diagram can be visualised as:

```
HookOrchestrator
│
├─ HookPipeline            ← central executor, orders hooks
├─ SubscriptionManager    ← topic → hook registry (pub‑sub)
└─ HookStore               ← persists hook metadata across restarts
```

All three live in the same source file (`HookOrchestrator.ts`), reinforcing the **single‑responsibility** split: HookPipeline focuses on *when* and *in what order* hooks run, SubscriptionManager focuses on *who* should be notified, and HookStore focuses on *what* information about hooks is persisted.

---

## Implementation Details  

Even though the source symbols are not listed, the observations give a clear picture of the key classes and their responsibilities:

1. **HookPipeline (in `HookOrchestrator.ts`)** – Implements the execution engine.  It receives a list of hook instances (likely injected or retrieved from `HookStore`) and a queue of topics emitted by the system.  For each topic, it asks `SubscriptionManager` for the matching hooks, then sorts those hooks according to a predefined order (perhaps an explicit priority field or a DAG‑derived sequence).  After sorting, it invokes each hook’s entry point (e.g., `run()` or `handle()`) synchronously or asynchronously, depending on the hook contract.

2. **SubscriptionManager (in `HookOrchestrator.ts`)** – Holds a **registry** where each entry maps a *topic string* to a collection of hook identifiers.  Hooks declare their subscription topics during registration, and the manager updates the map accordingly.  When HookPipeline publishes a topic, the manager performs an O(1) lookup to retrieve the relevant hooks, ensuring efficient notification even as the number of hooks grows.

3. **HookStore (in `HookOrchestrator.ts`)** – Provides persistence for hook metadata (e.g., name, version, subscription topics, ordering hints).  By persisting this data, the system can reconstruct the pipeline state after a restart, guaranteeing that the same ordering and subscription relationships are restored without manual re‑configuration.

The **centralized mechanism** mentioned in the observations means that all hook activity—registration, execution, and monitoring—is funneled through HookPipeline.  This makes it straightforward to add cross‑cutting concerns such as logging, metrics, or error handling at a single point, rather than scattering them across individual hooks.

---

## Integration Points  

HookPipeline sits at the heart of the hook subsystem and therefore interacts with several other components:

* **SubscriptionManager** – Directly queried for the list of hooks that subscribe to a given topic.  The contract is likely a method such as `getHooksForTopic(topic: string): Hook[]`.  This tight coupling is intentional: the pipeline must know *who* to invoke for each event.

* **HookStore** – Used during system start‑up to hydrate the pipeline with the full set of hook definitions.  HookPipeline may call `HookStore.loadAll()` to retrieve persisted metadata, then instantiate hook objects accordingly.

* **External Event Sources** – Anything in the broader application that publishes a topic (e.g., a user action, a background job completion, or an external API callback) will trigger HookPipeline.  The integration point is typically a thin façade that calls `HookPipeline.publish(topic, payload)`.

* **Monitoring / Observability** – Because HookPipeline is the single execution hub, any logging, tracing, or metric collection can be attached here.  This centralisation simplifies integration with observability platforms.

No additional dependencies are mentioned beyond these siblings, so the integration surface remains focused and well‑defined.

---

## Usage Guidelines  

1. **Declare Subscriptions Explicitly** – When implementing a new hook, always list the topics it cares about in its registration metadata.  This ensures the `SubscriptionManager` can correctly route events to the hook.

2. **Define Execution Order Early** – If a hook depends on another, specify an explicit order (e.g., a numeric priority or a “runAfter” reference).  HookPipeline will honour this ordering, preventing hidden runtime race conditions.

3. **Persist Hook Metadata** – Use `HookStore` to register new hooks or update existing ones.  Persisted metadata guarantees that the pipeline’s state survives restarts and that ordering/subscription information is not lost.

4. **Avoid Direct Hook Coupling** – Do not call another hook’s API directly.  All communication should happen via the pub‑sub topics, preserving the loose coupling that the architecture is built around.

5. **Handle Errors Within Hooks** – Since HookPipeline centralises execution, unhandled exceptions can halt the entire pipeline.  Hooks should catch and surface errors appropriately, possibly returning a status that HookPipeline can interpret (e.g., continue, retry, abort).

---

### Architectural Patterns Identified  

* **Publish‑Subscribe (pub‑sub)** – Explicit subscription topics, central registry, decoupled notification.  
* **Ordered Execution / Dependency Management** – Deterministic hook ordering to satisfy inter‑hook dependencies.  
* **Centralized Orchestration** – HookPipeline acts as the single authority for hook lifecycle management.

### Design Decisions and Trade‑offs  

* **Centralisation vs. Distribution** – By funneling all hook activity through HookPipeline, the system gains observability and easier debugging, but it also creates a potential bottleneck if the pipeline becomes a hot path.  
* **Explicit Topic Declaration** – Improves clarity and reduces accidental cross‑talk, yet requires developers to maintain accurate topic lists.  
* **Ordered Execution** – Guarantees correct sequencing but introduces the need for careful priority management; mis‑ordered hooks can cause subtle bugs.

### System Structure Insights  

The hook subsystem is encapsulated within `HookOrchestrator.ts`, with three cohesive siblings: `HookPipeline` (execution), `SubscriptionManager` (routing), and `HookStore` (persistence).  This co‑location simplifies code navigation and ensures that changes to one aspect (e.g., subscription handling) are visible alongside related concerns.

### Scalability Considerations  

* **Topic‑to‑Hook Lookup** – `SubscriptionManager`’s registry provides O(1) lookups, supporting a large number of topics and hooks without degrading performance.  
* **Pipeline Throughput** – As the number of hooks grows, the ordered execution model may become a linear bottleneck; parallelisation could be introduced for independent hooks, but that would require additional dependency analysis.  
* **Persistence Layer** – `HookStore` must be able to handle growing metadata; using a lightweight database or file‑based store with indexing can keep load times acceptable.

### Maintainability Assessment  

The architecture’s **clear separation of concerns** (execution, routing, persistence) makes the codebase approachable: developers can modify subscription logic without touching execution ordering, and vice‑versa.  The **pub‑sub contract** serves as a stable API surface, reducing the risk of breaking changes when adding new hooks.  However, the reliance on a single orchestrator means that any substantial refactor of HookPipeline will ripple through the entire hook system, so thorough testing and incremental rollout strategies are advisable.

## Hierarchy Context

### Parent
- [HookOrchestrator](./HookOrchestrator.md) -- HookOrchestrator uses a pub-sub pattern with HookOrchestrator.ts, each hook declaring explicit subscription topics

### Siblings
- [SubscriptionManager](./SubscriptionManager.md) -- SubscriptionManager (HookOrchestrator.ts) maintains a registry of hook subscriptions, allowing for efficient lookup and notification of subscribed hooks.
- [HookStore](./HookStore.md) -- HookStore (HookOrchestrator.ts) utilizes a data storage mechanism to persist hook metadata, ensuring that hook information is retained across system restarts.

---

*Generated from 3 observations*
