# ViolationPersistenceService

**Type:** SubComponent

The ViolationPersistenceService follows a semantic constraint detection approach, as described in integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md

## What It Is  

The **ViolationPersistenceService** is a sub‑component of the `ConstraintSystem` that is responsible for persisting, formatting, and presenting violation records produced by the semantic constraint detection pipeline. Its implementation lives inside the *mcp‑constraint‑monitor* integration – the primary documentation for the service is found in the following paths:  

* `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` – describes the graph‑database persistence mechanism it employs.  
* `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` – outlines the semantic detection approach that generates the violations it stores.  
* `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` – defines the exact record format and the batch‑processing strategy used when writing to the store.  
* `integrations/mcp-constraint-monitor/dashboard/README.md` – details the dashboard UI that visualises the stored violations.  

In the component hierarchy, `ConstraintSystem` **contains** the `ViolationPersistenceService`, and the service **contains** a child component called `ViolationStorage` that encapsulates the low‑level data‑access logic.

---

## Architecture and Design  

The architecture of `ViolationPersistenceService` is deliberately aligned with the modular design of its parent `ConstraintSystem`. It follows a **separation‑of‑concerns** approach: the service itself orchestrates the flow of violation data, while the nested `ViolationStorage` handles the concrete interaction with the underlying graph database. This mirrors the sibling `GraphDatabaseAdapter` pattern used by the `ContentValidationModule`, indicating a shared persistence strategy across the constraint monitoring suite.

Two architectural approaches are evident from the observations:

1. **Graph‑Database Persistence** – The service writes violation records into a graph database, as described in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. This choice enables rich relationship modeling between violations, constraints, and the content artifacts they reference, facilitating downstream queries and impact analysis.

2. **Batch Processing** – Violation records are accumulated and persisted in batches, a technique documented in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. Batching reduces the number of write transactions against the graph store, improving throughput and minimizing contention under high‑volume validation runs.

The service also adopts a **semantic constraint detection** model (`semantic-constraint-detection.md`) that produces violations based on meaning‑level analysis rather than simple syntactic checks. This higher‑level detection feeds richer violation data into the persistence pipeline, which the dashboard (`dashboard/README.md`) then renders for operators.

---

## Implementation Details  

Although the source repository does not expose explicit class or function names for `ViolationPersistenceService`, the documentation outlines its functional building blocks:

* **ViolationStorage** – The child component encapsulates the low‑level CRUD operations against the graph database. It likely provides methods such as `saveBatch(records[])` and `queryViolations(criteria)`, leveraging the configuration defined in `constraint-configuration.md`.

* **Record Formatting** – Before persistence, each violation is transformed into the **CLAUDE‑CODE‑HOOK‑FORMAT**, a structured representation that includes fields for constraint identifiers, offending content snippets, severity, and contextual metadata. The format specification lives in `CLAUDE-CODE-HOOK-FORMAT.md` and is the contract both the detection engine (`ContentValidationModule`) and the storage layer adhere to.

* **Batch Engine** – The service aggregates incoming violations into batches whose size and flush interval are dictated by the same CLAUDE‑CODE‑HOOK‑FORMAT documentation. When a batch reaches its threshold, the service invokes `ViolationStorage` to write the entire batch atomically to the graph database.

* **Dashboard Integration** – The dashboard component (`dashboard/README.md`) reads persisted violation nodes directly from the graph store, applying the same semantic relationships that the detection engine established. The service therefore must expose query endpoints or views that the dashboard can consume, ensuring that the visualisation stays in sync with the stored data.

* **Interaction with ContentValidationModule** – The detection side, embodied by the `ContentValidationModule`, pushes violation objects to the `ViolationPersistenceService`. This hand‑off is likely performed via a well‑defined interface (e.g., `recordViolation(violation)`) that abstracts away the storage details, allowing the validation logic to remain agnostic of persistence concerns.

---

## Integration Points  

1. **ContentValidationModule** – The primary producer of violation data. It calls into the `ViolationPersistenceService` to store each semantic violation it discovers. This relationship is highlighted in Observation 1.

2. **GraphDatabaseAdapter** – Although a sibling component, the adapter provides the underlying driver and connection handling for the graph database used by `ViolationStorage`. The shared usage of a graph persistence layer suggests that both the `ContentValidationModule` (via its own adapter usage) and the `ViolationPersistenceService` rely on a common database configuration defined in `constraint-configuration.md`.

3. **HookConfigurationManager** – The `HookConfigLoader` (`lib/agent-api/hooks/hook-config.js`) merges hook configurations that may include parameters governing the batch size, persistence toggles, or format versions for the CLAUDE‑CODE‑HOOK. These configuration values flow into the `ViolationPersistenceService` at start‑up, influencing how it processes and stores violations.

4. **Dashboard** – The UI component located under `integrations/mcp-constraint-monitor/dashboard/` reads from the same graph store. It expects violation records to conform to the CLAUDE‑CODE‑HOOK format, allowing it to render tables, graphs, and drill‑down views without additional transformation.

5. **ConstraintSystem (Parent)** – As the container, `ConstraintSystem` orchestrates the lifecycle of `ViolationPersistenceService`. It likely initializes the service during system boot, injects the required configuration, and may expose health‑check endpoints that monitor the service’s ability to write to the graph database.

---

## Usage Guidelines  

* **Always supply violations in the CLAUDE‑CODE‑HOOK format** – The service validates incoming payloads against the schema defined in `CLAUDE-CODE-HOOK-FORMAT.md`. Deviations will cause the batch to be rejected, potentially halting persistence for the entire batch.

* **Respect batch boundaries** – When integrating new validation hooks, configure the batch size and flush interval to match the operational load. Overly large batches can increase memory pressure, while tiny batches erode the performance benefits described in Observation 7.

* **Leverage the shared graph configuration** – Reuse the connection settings from `constraint-configuration.md` to avoid duplicate configuration files. This ensures consistency with the `GraphDatabaseAdapter` used by sibling components.

* **Do not bypass ViolationStorage** – Directly accessing the graph database from outside the service defeats the encapsulation provided by `ViolationStorage`. All reads and writes should go through the service’s public API to guarantee format compliance and batch handling.

* **Monitor the dashboard** – Use the dashboard (`dashboard/README.md`) as a validation step after deploying new constraint rules. It provides immediate visual feedback on whether violations are being recorded correctly and helps spot anomalies early.

---

### Architectural patterns identified  

1. **Graph‑Database Persistence** – Centralized storage of violation entities in a graph model.  
2. **Batch Processing** – Accumulation of violations into configurable batches before persisting.  
3. **Semantic Constraint Detection** – High‑level analysis feeding structured violation data.  
4. **Separation of Concerns (Service ↔ Storage)** – `ViolationPersistenceService` orchestrates while `ViolationStorage` handles direct DB interaction.  

### Design decisions and trade‑offs  

* **Graph DB vs. Relational DB** – Chosen for relationship richness, at the cost of a steeper learning curve and potentially higher operational overhead.  
* **Batching** – Improves write throughput but introduces latency for the first record in a batch and requires careful memory management.  
* **Strict Formatting** – Guarantees downstream compatibility (dashboard, queries) but imposes rigidity on producers of violation data.  

### System structure insights  

* `ConstraintSystem` → `ViolationPersistenceService` → `ViolationStorage` forms a clear vertical slice dedicated to violation lifecycle management.  
* Sibling components (`ContentValidationModule`, `HookConfigurationManager`, `GraphDatabaseAdapter`) share the same persistence backbone, promoting reuse of configuration and drivers.  

### Scalability considerations  

* **Horizontal scaling** can be achieved by adding more instances of `ViolationPersistenceService` that write to the same graph cluster, provided batch coordination is stateless or uses a distributed queue.  
* **Batch size tuning** is critical: larger batches increase write efficiency but may delay visibility in the dashboard; smaller batches improve freshness but increase transaction overhead.  
* The graph database must be provisioned for write‑heavy workloads, especially during peak validation cycles.  

### Maintainability assessment  

* The clear delineation between service orchestration and storage logic (`ViolationStorage`) simplifies future refactoring or swapping of the underlying graph engine.  
* Centralized configuration (via `HookConfigLoader` and `constraint-configuration.md`) reduces duplication and eases environment‑specific adjustments.  
* Dependence on a single, well‑documented record format (CLAUDE‑CODE‑HOOK) ensures that changes to the schema are localized, though any schema evolution will require coordinated updates across the detection module, persistence service, and dashboard.  

Overall, the **ViolationPersistenceService** exemplifies a focused, well‑documented sub‑component that leverages graph persistence and batch processing to reliably store semantic constraint violations while providing operators with an actionable dashboard view.

## Diagrams

### Relationship

## Architecture Diagrams

## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component's modular architecture allows for a clear separation of concerns, with each sub-component interacting through well-defined interfaces. For instance, the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) interacts with the GraphDatabaseAdapter for graph database persistence and semantic analysis. This modular design enables easier maintenance and updates to individual components without affecting the overall system. Furthermore, the HookConfigLoader (lib/agent-api/hooks/hook-config.js) loads and merges hook configurations from user-level and project-level sources, applying project config overrides. This design decision allows for flexible configuration management and customization of hook behaviors.

### Children
- [ViolationStorage](./ViolationStorage.md) -- The ViolationPersistenceService is mentioned in the context of the ConstraintSystem, implying a tight integration with the system's core functionality.

### Siblings
- [ContentValidationModule](./ContentValidationModule.md) -- The ContentValidationAgent in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts interacts with the GraphDatabaseAdapter for graph database persistence and semantic analysis.
- [HookConfigurationManager](./HookConfigurationManager.md) -- The HookConfigLoader in lib/agent-api/hooks/hook-config.js loads and merges hook configurations from user-level and project-level sources.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- The GraphDatabaseAdapter is used by the ContentValidationAgent in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts

---

*Generated from 7 observations*
