# HealthStateStore

**Type:** Detail

currentState.services decouples probe execution from health consumers: other parts of the system read from this in-memory structure rather than triggering probes themselves, preventing redundant or uncoordinated health checks.

# HealthStateStore

## What It Is

HealthStateStore is the in-memory state container maintained inside `scripts/health-coordinator.js`, exposed through the `currentState.services` structure. It functions as the canonical, continuously-refreshed record of the most recently observed health status for every monitored service. Rather than being a standalone module or persistent database, it lives as a runtime data structure within the HealthCoordinator process, updated as probe results arrive from the coordinator's 5-second polling loop.

The store is organized as a per-service keyed map: each service participating in the monitoring system has its own entry under `currentState.services`, and that entry is overwritten with fresh results after every successful probe. This makes HealthStateStore the authoritative answer to the question "what is the health of service X right now?" for any consumer that needs it.

## Architecture and Design

The architectural approach embodied by HealthStateStore is a **cache-and-publish pattern layered on a polling loop**. The parent component, HealthCoordinator (`scripts/health-coordinator.js`), drives probing on a fixed 5-second cadence; HealthStateStore captures the output of each probe and holds it for consumption. This cleanly separates two concerns: the *production* of health data (probes performed by HealthCoordinator based on the rules in HealthVerificationRules) and the *consumption* of health data (other system components reading `currentState.services`).

This separation is a deliberate decoupling mechanism. Without HealthStateStore, every consumer interested in a service's health would need to invoke a probe itself, leading to redundant network calls, uncoordinated check timings, and potentially overwhelming the monitored services. By centralizing probe execution in HealthCoordinator and centralizing probe results in HealthStateStore, the system enforces a single, predictable probing rhythm regardless of how many consumers exist.

The design also reflects a clear hierarchical relationship: HealthCoordinator *contains* HealthStateStore as an internal piece of state, while its sibling, HealthVerificationRules (`config/health-verification-rules.json`), supplies the configuration that determines *which* services end up as keys in the store. The rules file defines the input domain; HealthStateStore holds the output codomain. Changes to the rules file directly influence which entries exist in `currentState.services` on the next polling iteration, without any code changes required.

## Implementation Details

The mechanics center on the polling loop inside `scripts/health-coordinator.js`. Every 5 seconds, the coordinator iterates the enabled rules defined in `config/health-verification-rules.json` and dispatches a probe for each corresponding service. When each probe result is received, HealthCoordinator writes that result into `currentState.services`, keyed by service identifier. The write happens immediately after the probe completes, ensuring the store always reflects the most recently observed health of each service.

Because state is organized as a keyed map rather than a list or rule-iteration structure, lookups are **O(1)**. A consumer asking for a specific service's health does not need to scan the full rule set or filter through historical entries — it simply reads the key. This characteristic is what makes the store practical for high-frequency reads, since polling consumers, dashboards, or routing decisions can query it without imposing meaningful CPU cost.

The store's update model is **last-write-wins per service key**. There is no history retention evident in the observations; each probe result overwrites the previous one for that service. This is consistent with the store's role as a "current state" snapshot rather than a time-series log. Consumers wanting historical health data would need to layer that capability elsewhere — HealthStateStore itself only answers "what is the situation now?"

## Integration Points

HealthStateStore's primary integration is upward into HealthCoordinator, which both owns the data structure and is solely responsible for writing to it. The write path flows: HealthVerificationRules (config) → HealthCoordinator (polling logic) → probe execution → `currentState.services` (HealthStateStore).

The read path is open to any component within the system that needs to know a service's health. Per the observations, these consumers read directly from `currentState.services` rather than triggering their own probes. This makes HealthStateStore a **shared dependency** for any health-aware behavior elsewhere in the codebase — routing logic, status endpoints, alerting hooks, or operational tooling would all consume from the same source of truth.

The relationship with the sibling HealthVerificationRules is indirect but tight: the rule set defines which service keys can legitimately appear in HealthStateStore. Disabling a rule in `config/health-verification-rules.json` means the corresponding service will no longer be refreshed on subsequent polling iterations. Enabling a new rule causes the service to begin appearing in the store after the next probe.

## Usage Guidelines

Developers integrating with HealthStateStore should treat it strictly as a **read-only data source** from outside HealthCoordinator. Direct mutation by consumers would violate the decoupling invariant that probe execution is the sole responsibility of the polling loop in `scripts/health-coordinator.js`. If new probing logic is needed, it should be added to HealthCoordinator (or expressed declaratively through HealthVerificationRules), not by side-writing to `currentState.services` from elsewhere.

Consumers should also be aware of the **5-second staleness window**. Because the store is refreshed by a polling loop rather than pushed in real time, the data in `currentState.services` may be up to one polling interval old. For most operational use cases this is acceptable, but components requiring sub-second freshness must account for this latency rather than assume the store is instantaneous.

To add a new service to HealthStateStore, modify `config/health-verification-rules.json` rather than touching `scripts/health-coordinator.js`. The rules file is the declarative entry point; the polling loop will automatically include the new service in subsequent iterations and begin populating its key in the store.

Finally, since the store keeps no history and operates on last-write-wins semantics, any feature requiring trend analysis, uptime computation, or incident timelines must build that capability on top of HealthStateStore — for example, by subscribing to writes or sampling `currentState.services` periodically into a separate persistent store. Treating HealthStateStore itself as a historical record will lead to incorrect assumptions about the data available.

## Summary of Key Insights

1. **Architectural pattern:** Centralized in-memory cache populated by a single polling producer (HealthCoordinator) and read by many consumers — a classic publish-via-shared-state decoupling.
2. **Design trade-offs:** Simplicity and O(1) reads are gained at the cost of up-to-5-second staleness and no historical retention; these are accepted because the store's purpose is current-state lookup, not time-series storage.
3. **System structure:** HealthStateStore sits inside HealthCoordinator, fed by rules from its sibling HealthVerificationRules, forming a clean config → coordinator → state → consumers pipeline.
4. **Scalability:** Per-service keying ensures lookup cost stays constant as the rule set grows; the main scaling pressure falls on HealthCoordinator's probe execution, not on the store itself.
5. **Maintainability:** New services are added declaratively via `config/health-verification-rules.json` without code changes, and the strict write-ownership by HealthCoordinator keeps the data flow easy to reason about.


## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- scripts/health-coordinator.js runs a polling loop every 5 seconds, iterating all enabled rules defined in config/health-verification-rules.json to determine which services to check

### Siblings
- [HealthVerificationRules](./HealthVerificationRules.md) -- config/health-verification-rules.json is the single authoritative source of monitoring configuration for scripts/health-coordinator.js; changes to this file directly alter which services participate in the next polling iteration without requiring code changes.


---

*Generated from 3 observations*
