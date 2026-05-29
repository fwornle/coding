# SingletonResetPattern

**Type:** Detail

This pattern is documented in the OntologyConfigManager sub-component description as a deliberate architectural decision, trading global mutability for simplicity of access across the SemanticAnalysis component.

# SingletonResetPattern

## What It Is

The `SingletonResetPattern` is a deliberate architectural convention implemented within `OntologyConfigManager`, describing both the singleton lifecycle management strategy and the explicit test-isolation mechanism provided by its `reset()` method. Rather than a standalone class or file, this pattern is a named design decision embedded in the `OntologyConfigManager` sub-component, documenting how a globally shared configuration state is safely managed across agents, subsystems, and test boundaries within a single process.

## Architecture and Design

The core architectural trade-off here is explicit: `OntologyConfigManager` sacrifices immutability and strict encapsulation in favor of simplicity of access. Because all agents and subsystems within the `SemanticAnalysis` component share a single `OntologyConfigManager` instance, any consumer anywhere in the process can read current configuration without dependency injection or context threading. This is a classic singleton trade-off — reduced coupling overhead at the cost of introducing global mutable state.

What distinguishes this from an unreflective use of the singleton pattern is the deliberate inclusion of a `reset()` method as a first-class part of the design. The architecture acknowledges that global mutable state creates a real hazard for testing: without a reset mechanism, the singleton's state persists for the entire process lifetime, meaning one unit test's configuration changes would bleed directly into subsequent tests. The `reset()` method resolves this by restoring defaults programmatically, eliminating the need to restart the process between tests.

This pattern is documented as an intentional decision within the `OntologyConfigManager` sub-component description, meaning it is not accidental drift but a recognized design commitment. The naming of the pattern itself (`SingletonResetPattern`) signals that the team considers this a reusable or at least explicitly communicable convention worth encoding in architectural documentation.

## Implementation Details

The mechanics rest on two pillars: the singleton instantiation guarantee and the `reset()` method contract. The singleton ensures that all agents and subsystems within the process resolve to the same `OntologyConfigManager` instance — configuration written by one agent is immediately visible to all others, with no synchronization or propagation step required. This makes configuration access cheap and consistent across the `SemanticAnalysis` component.

The `reset()` method is the engineered escape valve. Its purpose is narrowly scoped: restore the singleton's internal state to its default configuration values without destroying or replacing the instance itself. This means the singleton identity (and any references held to it) remains valid after a reset — only the configuration values change. This is important because it means test teardown does not need to rebuild object graphs that reference `OntologyConfigManager`; it simply calls `reset()` and the shared instance is clean for the next test.

No specific file paths or code symbols were surfaced in the available observations, so the exact implementation of the reset logic (whether it re-reads a defaults file, zeroes fields, or copies from a frozen baseline) is not confirmable from current sources. The behavioral contract, however, is clear from the parent `OntologyConfigManager` context.

## Integration Points

The `SingletonResetPattern` as a design convention touches every consumer of `OntologyConfigManager` within the `SemanticAnalysis` component. Any agent or subsystem that reads configuration is implicitly depending on the singleton, and therefore implicitly subject to state changes made by any other consumer. This shared visibility is the integration surface — there is no per-agent configuration isolation at runtime.

The `reset()` method's integration point is specifically the test layer. It is the designated mechanism for test isolation, and its existence implies a testing convention: test setups or teardowns that exercise `OntologyConfigManager`-dependent code should call `reset()` to prevent state leakage. Without this contract being honored in tests, the singleton's global nature becomes a source of flaky, order-dependent test behavior.

## Usage Guidelines

Developers working within the `SemanticAnalysis` component should treat `OntologyConfigManager` as a process-scoped shared resource. Configuration mutations made during runtime will affect all agents simultaneously, so changes should be intentional and well-understood in terms of their broadcast effect. There is no mechanism described for scoped or per-agent configuration overrides — the singleton is the single source of truth.

In test code, `reset()` must be called between tests that modify or depend on specific `OntologyConfigManager` state. The safest convention is to call `reset()` in test teardown unconditionally for any test touching configuration, rather than relying on tests to restore individual values they changed. This defensive approach prevents subtle ordering dependencies from accumulating as the test suite grows.

The deliberate documentation of this pattern is itself a maintainability signal: the team recognized that an undocumented singleton with a `reset()` method would be confusing — why does a production class have a method that exists only for tests? By naming and documenting the `SingletonResetPattern`, the design makes the intent legible and prevents future developers from removing `reset()` as apparent dead code or from adding per-instance configuration in ways that break the shared-state contract.

---

**Key Trade-offs Summary:**

| Concern | Decision |
|---|---|
| Access simplicity | Singleton — no injection required |
| Global mutability risk | Accepted, documented explicitly |
| Test isolation | `reset()` method as first-class API |
| Process restart for test cleanup | Eliminated by `reset()` |
| Per-agent config isolation | Not supported by design |


## Hierarchy Context

### Parent
- [OntologyConfigManager](./OntologyConfigManager.md) -- `OntologyConfigManager` is implemented as a singleton, meaning all agents and subsystems within a process share one configuration state; the explicit `reset()` method exists specifically to restore defaults between unit tests without restarting the process


---

*Generated from 3 observations*
