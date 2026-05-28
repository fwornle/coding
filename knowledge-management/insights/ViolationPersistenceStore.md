# ViolationPersistenceStore

**Type:** Detail

ViolationPersistenceStore class in `violation-persistence-store.ts` exposes a `queryViolations()` method that retrieves historical constraint violation records, enabling dashboard and status-line consumers to access persisted violation state beyond the lifecycle of in-memory hook execution.

# ViolationPersistenceStore — Technical Insight Document

---

## What It Is

`ViolationPersistenceStore` is implemented in `violation-persistence-store.ts` and lives within the broader **ConstraintSystem**, which contains it as a dedicated persistence subsystem. Its core responsibility is to durably record constraint violations that are detected during hook execution, making those records available to consumers — dashboards and status-line integrations — well beyond the transient lifetime of the in-memory process that originally detected the violation.

The class sits at the boundary between two fundamentally different execution contexts: the ephemeral, event-driven world of hook execution (where violations are first discovered) and the persistent, query-oriented world of monitoring consumers (dashboards, status lines) that need stable, historical access to violation state. As documented in `integrations/mcp-constraint-monitor/README.md`, violations are expected to survive hook execution and surface to dashboards, which is the founding rationale for this store's existence as a separate architectural artifact rather than a simple in-memory buffer.

---

## Architecture and Design

### Separation of Write Path and Read Path

The most significant design decision evident from the observations is a deliberate **segregation of the write path from the read path**. The rule engine — which detects violations during hook execution — constitutes the write path. `ViolationPersistenceStore` then serves as the stable substrate that decouples that write path from all consumers. `integrations/mcp-constraint-monitor/docs/status-line-integration.md` explicitly confirms that status-line consumers read violation state through an interface that is distinct from the write path triggered by the rule engine. This is a classic **CQRS-adjacent** separation: the mechanism that produces violation records is architecturally isolated from the mechanism that <USER_ID_REDACTED> them.

This design decision carries meaningful trade-offs. By separating concerns, the store allows consumers to evolve independently — a status-line integration can be added, removed, or modified without touching the rule engine's violation-emission logic. The cost is the coordination overhead of ensuring writes from the rule engine are faithfully reflected in the store before consumers read. Whether the store provides synchronous write guarantees or eventual consistency is not directly observable from the provided sources, but the architecture implies the store must handle this boundary robustly.

### Durable Store vs. Transient Hook State

The `integrations/mcp-constraint-monitor/README.md` observation draws an explicit contrast between the durable store and "transient hook execution state." This implies the architectural decision that hook execution state is intentionally not the source of truth for violations — it is only the detection mechanism. The store is the source of truth. This pattern protects against data loss when hook processes terminate, restart, or are restarted mid-session, which is a realistic operational concern in a constraint monitoring integration context.

---

## Implementation Details

### `queryViolations()` — The Primary Read Interface

The central public API of `ViolationPersistenceStore` is its `queryViolations()` method. Based on the observation that it "retrieves historical constraint violation records," this method is the canonical interface through which all consumers — dashboard renderers and status-line integrations alike — access persisted violation state. The method's framing as a *query* over *historical records* strongly implies it operates over a collection that accumulates over time rather than reflecting only the most recent state, making it suitable for audit-style inspection as well as live monitoring.

The fact that `queryViolations()` is described as enabling access "beyond the lifecycle of in-memory hook execution" confirms that the store's backing mechanism is non-volatile relative to hook process lifetime. Whether this is file-backed, database-backed, or another durable mechanism is not specified in the available observations, but the semantics of "historical records" suggests append-friendly storage behavior.

### Class Structure and Self-Containment

The hierarchy context notes a somewhat recursive relationship where `ViolationPersistenceStore` contains `ViolationPersistenceStore` as a child component. This likely reflects the documentation tooling's representation of the class being its own primary artifact within its namespace, rather than a true compositional recursion. The class appears to be self-contained with no sub-components described in the observations.

---

## Integration Points

### ConstraintSystem (Parent)

`ViolationPersistenceStore` is contained within **ConstraintSystem**, which positions it as a supporting infrastructure component within the broader constraint enforcement architecture. The ConstraintSystem presumably houses the rule engine (write path) alongside this store, making the store an internal persistence service rather than a standalone microservice.

### Dashboard Consumers

As described in `integrations/mcp-constraint-monitor/README.md`, dashboards read from the store to surface persisted violation state. These consumers depend on `queryViolations()` as their data access layer and have no direct coupling to hook execution internals.

### Status-Line Integration

`integrations/mcp-constraint-monitor/docs/status-line-integration.md` describes status-line consumers as a distinct reader class. Their read interface is explicitly noted as separate from the write path, confirming that `ViolationPersistenceStore` serves as the integration contract between the constraint detection engine and lightweight UI surfaces like status lines.

### Rule Engine (Write Path)

The rule engine — the component that detects violations during hook execution — is the implied writer to this store. The store's design explicitly isolates readers from this write mechanism, meaning the rule engine writes to the store as a side effect of constraint evaluation, and all consumers thereafter use `queryViolations()` rather than any direct hook-state inspection.

---

## Usage Guidelines

**Treat `queryViolations()` as the canonical read interface.** Consumers should never attempt to access hook execution state directly for violation data. The store exists precisely to provide a stable, lifecycle-independent read surface, and bypassing it would couple consumers to transient state with no durability guarantees.

**Writers should use the store as the single source of truth.** The rule engine's violation detection results should be committed to `ViolationPersistenceStore` promptly during hook execution. Given that hook state is explicitly described as transient, any violation not written to the store before hook process termination should be considered lost. Defensive write patterns — writing before any operation that could terminate the hook process — are implied by the architecture.

**Consumer implementations should assume historical record semantics.** Because `queryViolations()` is described as retrieving *historical* records, consumers should be prepared for the result set to grow over time. Dashboard and status-line consumers should apply appropriate filtering or pagination if the volume of historical violations is operationally significant.

**Do not couple new consumers to the write path.** The architectural separation of read and write paths documented in `status-line-integration.md` is an intentional design boundary. New integrations requiring access to violation state should be built against `queryViolations()`, not against the rule engine's internal violation emission mechanisms.

---

## Architectural Patterns Identified

| Pattern | Evidence |
|---|---|
| Read/Write path separation | `status-line-integration.md` explicitly distinguishes read interface from write path |
| Durable state over transient execution state | README contrasts persistent store with in-memory hook state |
| Query-oriented read interface | `queryViolations()` method semantics imply historical record retrieval |
| Infrastructure service within a subsystem | Contained within ConstraintSystem, serving multiple consumer types |

---

## Scalability and Maintainability Assessment

The architecture's primary scalability consideration is the growth of the historical violation record set over time. Because `queryViolations()` is described as retrieving historical records, the store must eventually address record volume — whether through retention policies, pagination, or indexed querying. The current observations provide no evidence of such mechanisms, suggesting this may be an area for future design attention as the system matures.

Maintainability is well-served by the clean separation between detection (rule engine), persistence (this store), and consumption (dashboards, status lines). Each layer can evolve independently. The store's narrow public interface (`queryViolations()` as the primary observable API) minimizes the surface area that consumers depend on, making internal implementation changes low-risk with respect to consumer breakage.


## Hierarchy Context

### Parent
- [ViolationPersistenceStore](./ViolationPersistenceStore.md) -- integrations/mcp-constraint-monitor/README.md describes violations being persisted and surfaced to dashboards, implying a durable store separate from in-memory hook execution state

### Children
- [ViolationPersistenceStore](./ViolationPersistenceStore.md) -- integrations/mcp-constraint-monitor/README.md describes violations being persisted and surfaced to dashboards, implying a store separate from transient hook execution state


---

*Generated from 3 observations*
