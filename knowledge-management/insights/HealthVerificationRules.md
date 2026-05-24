# HealthVerificationRules

**Type:** Detail

config/health-verification-rules.json is the single authoritative source of monitoring configuration for scripts/health-coordinator.js; changes to this file directly alter which services participate in the next polling iteration without requiring code changes.

# HealthVerificationRules

## What It Is

HealthVerificationRules is implemented as a JSON configuration artifact located at `config/health-verification-rules.json`. It serves as the single authoritative source of monitoring configuration consumed by `scripts/health-coordinator.js`. Rather than being a code module with classes or functions, this entity is a declarative ruleset that defines the universe of services subject to health probing, along with the per-service parameters needed to perform those probes.

Within the broader hierarchy, HealthVerificationRules sits beneath HealthCoordinator, which owns and operates the polling loop. The coordinator reads this file at the start of every 5-second cycle to determine which services participate in that iteration. Each rule entry encodes an `enabled` flag and probe-specific parameters such as endpoint, timeout, and expected response — a self-contained specification that the coordinator interprets generically.

This design positions HealthVerificationRules as the configuration boundary between operational policy (what to monitor and how) and execution logic (how to run the polling loop and dispatch probes). Operators can change the monitored topology purely by editing this file, without modifying any JavaScript code.

## Architecture and Design

The architectural approach exhibits a clean **configuration-driven design** pattern. By externalizing the per-service probe parameters into `config/health-verification-rules.json`, the coordinator logic in `scripts/health-coordinator.js` remains generic — it doesn't hardcode service names, endpoints, or timeout values. Instead, it iterates the rules and applies each rule's parameters at runtime. This is effectively a **strategy-by-configuration** pattern: different check strategies are achieved through differing rule contents rather than through polymorphic code paths.

The `enabled` flag on each rule introduces a **soft-disable mechanism**, distinct from rule deletion. This is an intentional design trade-off: operators preserve the rule definition (with all its endpoint, timeout, and expected-response metadata) while temporarily suspending its evaluation. This avoids the friction of reconstructing rule definitions when re-enabling monitoring for a service, and it provides an audit-friendly record of services that were previously monitored.

The relationship with HealthCoordinator is unidirectional and pull-based: HealthCoordinator reads HealthVerificationRules at the top of each 5-second iteration. There is no push notification or hot-reload contract evident in the observations — the design relies on each polling cycle naturally picking up the latest file contents. This keeps the synchronization model simple at the cost of a small latency window (up to one cycle) before changes take effect.

Alongside its sibling HealthStateStore, HealthVerificationRules forms one half of a clean separation of concerns: HealthVerificationRules defines *what should be checked*, while HealthStateStore (written to via `currentState.services` after each probe completes) records *what was observed*. The coordinator mediates between these two by reading rules, executing probes, and writing results, leaving each store responsible for a single dimension of the monitoring system's state.

## Implementation Details

Each rule in `config/health-verification-rules.json` is a structured entry containing at minimum:

- An `enabled` boolean flag that gates whether the rule is evaluated in the current cycle
- Probe parameters such as `endpoint` (the target URL or service address), `timeout` (how long to wait for a response), and `expected response` (what constitutes a successful probe outcome)

The consumption mechanics live in `scripts/health-coordinator.js`. At the start of every 5-second cycle, the coordinator loads the rule set and evaluates the `enabled` flag for each entry. Disabled rules are skipped entirely — they incur no network cost and produce no state update. Enabled rules are dispatched as probes using their declared parameters.

Because the parameters are interpreted generically, adding a new monitored service requires only appending a new rule object to the JSON file. The coordinator does not need new conditional branches, new functions, or new imports. Similarly, adjusting how a single service is probed (e.g., raising its timeout or changing its expected response signature) is a configuration-only change.

Once a probe completes, the result flows into the sibling HealthStateStore — specifically, `currentState.services` is updated to reflect the most recently observed health. This write happens within the same 5-second polling iteration that originated the probe, ensuring tight coupling between rule evaluation and state recording without introducing intermediate queues or buffers.

## Integration Points

The primary integration is with the parent component HealthCoordinator (`scripts/health-coordinator.js`), which is the sole consumer of `config/health-verification-rules.json`. The interface between them is the JSON file's schema — the set of fields (`enabled`, `endpoint`, `timeout`, `expected response`, etc.) that the coordinator expects to find and interpret.

Indirectly, HealthVerificationRules also integrates with the sibling HealthStateStore. Although there is no direct read or write between the rules file and the state store, the rules effectively determine the *keys* under `currentState.services` that will be populated: only services whose rules are enabled will see their state refreshed in each cycle. A service whose rule is disabled will retain whatever state was last recorded (or none, if it was never enabled).

External integration takes the form of the target services themselves. Each rule's `endpoint` parameter points to a service that must respond within the configured `timeout` and produce output matching the `expected response`. The set of monitored services is thus an emergent property of the rule file's contents, not something declared in code.

## Usage Guidelines

When adding monitoring for a new service, append a new rule entry to `config/health-verification-rules.json` with all required fields populated. There is no need to edit `scripts/health-coordinator.js` — the coordinator will pick up the new rule on its next 5-second cycle.

To temporarily suspend monitoring for a service, prefer flipping its `enabled` flag to `false` rather than deleting the rule. This preserves the rule's configuration (endpoint, timeout, expected response) for easy re-activation and serves as a record of services that have been monitored historically. Deletion should be reserved for cases where the service has been permanently retired.

When tuning probe parameters, remember that changes take effect at the start of the next polling cycle — within at most 5 seconds. There is no manual reload step required. However, treat the JSON file as a critical operational artifact: malformed JSON will likely prevent the coordinator from loading any rules, halting monitoring entirely.

Keep probe parameters realistic relative to the target service's characteristics. A `timeout` shorter than the service's typical response time will cause false negatives, while an overly permissive `expected response` matcher may mask real degradations. Because the coordinator applies these parameters generically, the <USER_ID_REDACTED> of monitoring depends directly on the accuracy of each rule's contents.

Finally, recognize the division of responsibility: HealthVerificationRules defines intent (what to check), while HealthStateStore reflects reality (what was observed). When debugging, consult both — a missing entry in `currentState.services` typically means the corresponding rule is disabled or absent, not that the probe failed.

## Summary Analysis

**Architectural patterns identified:** Configuration-driven design, strategy-by-configuration, separation of policy from mechanism, soft-disable via feature flags, pull-based synchronization on a fixed polling interval.

**Design decisions and trade-offs:** Externalizing rules to JSON optimizes for operational agility at the cost of losing compile-time validation of rule structure. The `enabled` flag trades a small amount of file clutter for the ability to suspend without losing configuration. The 5-second poll cadence trades immediacy for predictable load.

**System structure insights:** The rules file, the coordinator, and the state store form a clean triad — declarative intent, imperative execution, and observed state — each isolated to a single responsibility. This makes the system easy to reason about at any layer independently.

**Scalability considerations:** The linear iteration over all enabled rules each cycle scales with the number of monitored services. At large scale, the 5-second window becomes a budget that all enabled probes must fit within; long timeouts on many services could pressure this. The flat JSON structure is easy to scan at small-to-moderate scales but offers no built-in grouping or sharding for very large rule sets.

**Maintainability assessment:** Highly maintainable for its current scope. New services are added by configuration alone, and probe behavior is transparent from reading the rule file. The lack of code symbols in HealthVerificationRules itself means there is no logic drift risk — all behavior lives in the coordinator that consumes the file, keeping the configuration surface narrow and inspectable.


## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- scripts/health-coordinator.js runs a polling loop every 5 seconds, iterating all enabled rules defined in config/health-verification-rules.json to determine which services to check

### Siblings
- [HealthStateStore](./HealthStateStore.md) -- health-coordinator.js writes to currentState.services after each probe result is received within the 5-second polling loop, ensuring the store always reflects the most recently observed health of each service.


---

*Generated from 3 observations*
