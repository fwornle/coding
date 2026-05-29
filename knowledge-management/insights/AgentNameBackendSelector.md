# AgentNameBackendSelector

**Type:** Detail

docs/architecture/agent-abstraction-api.md defines the unified API contract that all AGENT_NAME-selected backends must implement, decoupling callers from specific agent implementations

## AgentNameBackendSelector — Technical Insight Document

---

## What It Is

`AgentNameBackendSelector` is the mechanism by which a symbolic agent name (`AGENT_NAME`) is used as the primary dispatch key to select and instantiate a specific backend implementation at runtime. It is not a single file or class in isolation, but rather a **documented architectural convention** whose specification is distributed across two canonical documents:

- `docs/architecture/adding-new-agent.md` — defines the registration protocol that makes new backends recognizable to the selector
- `docs/architecture/agent-abstraction-api.md` — defines the contract that every selectable backend must satisfy

Together, these documents constitute the complete specification of the selector's behavior: what names are valid, how a name maps to an implementation, and what interface that implementation must expose.

`AgentNameBackendSelector` lives as a first-class sub-concern within the broader `AgentAgnosticDesignPrinciple`, which is explicitly named in `CLAUDE.md` as a core architectural constraint. This placement is significant — it means backend selection by name is not an implementation detail but a **deliberately designed, top-level extension point**.

---

## Architecture and Design

The design pattern here is a **registry-based strategy dispatch**: `AGENT_NAME` acts as a lookup key into a registry of backend implementations, each of which conforms to the same interface contract. This is the classic Strategy pattern operating through a named registry rather than direct injection.

The architecture separates three distinct concerns cleanly:

1. **Naming / Registration** (`adding-new-agent.md`) — the process by which a new backend announces its existence and associates itself with a name
2. **Selection** (`AGENT_NAME` as the dispatch key) — the runtime resolution of a name to a concrete implementation
3. **Invocation Contract** (`agent-abstraction-api.md`, surfaced also through `UnifiedAgentAbstractionAPI`) — the interface all resolved backends must satisfy

This three-part separation is a deliberate trade-off: it maximizes the number of backends that can coexist and be substituted without modifying call sites, at the cost of requiring every new backend to undergo a registration step. The payoff is that callers never reference a concrete backend class — they depend only on `AGENT_NAME` as configuration and the abstract API as their programming surface.

The relationship to its sibling `UnifiedAgentAbstractionAPI` is architecturally load-bearing. `AgentNameBackendSelector` handles *which* implementation to use; `UnifiedAgentAbstractionAPI` handles *how* to talk to whatever was selected. Neither is useful without the other — selecting a backend that doesn't conform to the unified API would break all callers, and having a unified API without a selector would require hardcoded backend references. Together they form the complete agent-agnostic subsystem that `AgentAgnosticDesignPrinciple` demands.

---

## Implementation Details

The selector's mechanics are driven by `AGENT_NAME` as a configuration variable. Based on the observations, the registration flow documented in `docs/architecture/adding-new-agent.md` is the authoritative guide for how a new backend becomes a valid value for `AGENT_NAME`. This implies the system maintains some form of registry or mapping — whether a dictionary, a factory function, or a convention-based import path — that `AGENT_NAME` is resolved against at startup or at first invocation.

The interface that every registered backend must implement is specified in `docs/architecture/agent-abstraction-api.md`. This document serves as both a compliance checklist for implementors and a stable dependency surface for callers. Because all backends must implement the same API, the selector can substitute any registered backend transparently — the caller's code does not change when `AGENT_NAME` changes.

The documentation structure itself encodes an important implementation rule: **registration (`adding-new-agent.md`) and interface compliance (`agent-abstraction-api.md`) are prerequisites that must both be satisfied before a backend is selectable**. A backend that is registered but does not implement the full API contract, or one that implements the API but is not registered, will not function correctly within this system.

---

## Integration Points

`AgentNameBackendSelector` integrates with the rest of the system at two boundaries:

**Upstream (configuration):** `AGENT_NAME` is listed as a key documented configuration point for the project. This means the selector's input comes from project-level configuration — likely an environment variable, a config file, or a CLI argument — rather than from code. This keeps the selection decision outside the application logic, enabling environment-specific backend switching without code changes.

**Downstream (invocation):** Once a backend is selected, all interaction proceeds through the interface defined in `UnifiedAgentAbstractionAPI` (specified in `docs/architecture/agent-abstraction-api.md`). This API is the sole contract between the rest of the application and the resolved backend. No component downstream of selection should reference backend-specific types or behaviors.

The parent principle, `AgentAgnosticDesignPrinciple`, provides the architectural mandate that justifies these integration constraints — any component that bypasses the selector or references a concrete backend directly is in violation of the stated core principle.

---

## Usage Guidelines

**When adding a new backend:** Follow `docs/architecture/adding-new-agent.md` in full. Registration is not optional — a backend that bypasses this process will not be reachable via `AGENT_NAME` and the selector will either fail silently or raise an error. After registration, verify full compliance with the API contract in `docs/architecture/agent-abstraction-api.md` before treating the backend as production-ready.

**When configuring the system:** `AGENT_NAME` should be treated as a required configuration value, not one with a hardcoded default in application logic. Embedding a default couples the codebase to a specific backend and undermines the agent-agnostic principle.

**When writing code that uses an agent:** Write exclusively against the interface described in `UnifiedAgentAbstractionAPI`. Any code that inspects `AGENT_NAME` at call sites to branch behavior is an architectural violation — the entire purpose of the selector is to make that branching unnecessary.

**Scalability consideration:** The registry-based model scales well for a moderate number of backends. Adding a new backend requires only satisfying two documented processes (registration + API compliance), with no changes to existing callers or the selector itself. The primary scalability risk is API surface growth in `UnifiedAgentAbstractionAPI` — if the shared API accumulates backend-specific accommodations, the abstraction degrades and the selector loses its transparency guarantee.

**Maintainability assessment:** The design is highly maintainable in its current form because the two governing documents (`adding-new-agent.md` and `agent-abstraction-api.md`) are the single source of truth for two clearly bounded concerns. As long as those documents remain authoritative and up-to-date, onboarding new backends and auditing existing ones remains a well-defined, documentation-driven process.


## Hierarchy Context

### Parent
- [AgentAgnosticDesignPrinciple](./AgentAgnosticDesignPrinciple.md) -- CLAUDE.md explicitly names agent-agnostic design as a core architectural principle, making backend independence a first-class documented constraint rather than an emergent property

### Siblings
- [UnifiedAgentAbstractionAPI](./UnifiedAgentAbstractionAPI.md) -- docs/architecture/agent-abstraction-api.md is titled 'Agent Abstraction API Reference', confirming it is the canonical specification for the backend-neutral interface


---

*Generated from 3 observations*
