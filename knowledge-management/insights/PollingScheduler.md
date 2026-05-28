# PollingScheduler

**Type:** Detail

Based on the SubComponent description, health-coordinator.js polls service-probe.js results every 5 seconds, establishing a fixed-interval scheduling pattern rather than event-driven probing.

# PollingScheduler — Technical Insight Document

## What It Is

PollingScheduler is the fixed-interval scheduling mechanism embedded within `health-coordinator.js`, responsible for driving repeated liveness checks across all registered services at a consistent 5-second cadence. It is not a standalone file or class but rather a logical sub-component of HealthCoordinator — the scheduling behavior is implemented directly inside `health-coordinator.js` as part of the coordinator's core loop. Its sole responsibility is to tick at regular intervals and dispatch probe invocations to `service-probe.js` for each service in the registry.

## Architecture and Design

The design adopts a **fixed-interval polling pattern** rather than an event-driven or reactive approach. Every 5 seconds, the scheduler triggers a full sweep of all registered services — currently four: the Next.js dashboard, the Node.js API, Memgraph, and Redis. This is a deliberate architectural choice that prioritizes **temporal predictability** over responsiveness. Because every service is checked on the same interval tick, the system produces a uniform heartbeat cadence rather than staggered or on-demand health signals.

The relationship between PollingScheduler and its parent, HealthCoordinator, is tightly coupled by design. HealthCoordinator owns the service registry and the scheduling loop; PollingScheduler is the rhythmic engine that gives that registry meaning by periodically activating it. The scheduler does not make decisions about service health — it only ensures that `service-probe.js` is invoked for each entry, leaving interpretation to the coordinator layer above it.

A notable design trade-off here is **simplicity versus efficiency**. A fixed 5-second loop is easy to reason about and guarantees no service is ever silently skipped, but it also means all four probe calls are dispatched within a single interval tick regardless of whether any service state has changed. There is no back-off, no jitter, and no priority differentiation between services.

## Implementation Details

The scheduling mechanism within `health-coordinator.js` iterates over the full set of registered services on each 5-second interval and calls `service-probe.js` for each one in turn. With four services registered, each polling cycle dispatches up to four probe checks — one per service — making the per-cycle probe count directly proportional to the number of registered services.

The 5-second interval is the single configurable (or at least singular) timing constant governing the entire health monitoring cadence. There is no evidence from the observations of dynamic interval adjustment, conditional skipping, or per-service timing variation. The loop is uniform: every service, every tick.

`service-probe.js` acts as the execution target for each scheduled call. PollingScheduler's job ends at invocation — it hands off to the probe layer and waits for the next tick. The liveness heartbeat data refreshed by these calls flows back into HealthCoordinator's state, where it can be surfaced to consumers of health information.

## Integration Points

PollingScheduler integrates directly with two entities:

1. **HealthCoordinator** (`health-coordinator.js`) — PollingScheduler is contained within HealthCoordinator and depends on it for the service registry. The coordinator provides the list of services to iterate over on each tick.

2. **service-probe.js** — This is the outbound integration target. On each interval tick, PollingScheduler drives `service-probe.js` invocations for each registered service. The probe module is responsible for the actual liveness check mechanics; PollingScheduler only ensures those checks are triggered at regular intervals.

There are no other integration points evident from the observations. The scheduler does not directly interact with the Next.js dashboard, Node.js API, Memgraph, or Redis — those are targets of `service-probe.js`, sitting one layer below.

## Usage Guidelines

**Interval sensitivity:** The 5-second polling interval is the heartbeat of the entire health monitoring system. Changes to this value affect all four registered services simultaneously. Developers should treat this constant carefully — shortening it increases probe frequency and system load linearly with the number of registered services; lengthening it increases the window during which a downed service goes undetected.

**Service registration:** Because PollingScheduler iterates over all registered services on every tick, adding a new service to the registry automatically includes it in every future polling cycle. There is no per-service opt-in or scheduling configuration — all services share the same interval.

**No event-driven override:** The current design has no mechanism for triggering an out-of-band probe check. If a service is suspected to be down between ticks, the architecture provides no shortcut — the next scheduled tick is the earliest opportunity for a refresh. Developers relying on immediate health feedback should account for up to a 5-second staleness window in any consuming logic.

**Probe failure handling:** PollingScheduler's behavior on probe failure is not defined within its own scope — that concern belongs to `service-probe.js` and HealthCoordinator. The scheduler itself is fire-and-iterate; it does not conditionally skip or retry within a single tick based on probe outcomes.

---

### Scalability Considerations

The current design scales linearly in probe work per tick: four services mean four probe calls every 5 seconds. This is entirely manageable at the current service count. However, if the registry grows significantly, the flat iteration model could introduce tick-to-tick drift if probe calls are synchronous and slow. Introducing parallelism at the probe dispatch layer (rather than sequential iteration) would be the natural mitigation path, though no such mechanism is evident from current observations.

### Maintainability Assessment

The fixed-interval, uniform-sweep design is highly maintainable in its current form — there is minimal conditional logic, no per-service scheduling state, and a single timing constant to reason about. The tight containment within `health-coordinator.js` means changes to polling behavior are localized. The main maintainability risk is the implicit coupling between interval frequency and the number of services: as the registry grows, the operational cost of the interval grows with it, which may not be immediately obvious to a developer adding a new service entry.


## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- health-coordinator.js polls service-probe.js results every 5 seconds, providing a consistent liveness heartbeat for Next.js dashboard, Node.js API, Memgraph, and Redis


---

*Generated from 3 observations*
