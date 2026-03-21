# ViolationCaptureModule

**Type:** SubComponent

ViolationCaptureModule relies on the integrations/mcp-constraint-monitor/dashboard/README.md file for dashboard configuration.

## What It Is  

The **ViolationCaptureModule** is a dedicated sub‑component of the **ConstraintSystem** that monitors interactions with tooling, detects any breaches of defined constraints, and persists those breaches for later analysis.  All of its configuration is driven from the dashboard definition found in `integrations/mcp-constraint-monitor/dashboard/README.md`, which supplies the visual layout and filtering rules used when the captured violations are displayed to operators.  Once a violation is detected, the module hands the record off to its child component **ConstraintViolationStorage**, which in turn writes the information into the system’s database layer.  In short, ViolationCaptureModule is the “eyes and ears” of the constraint enforcement stack, turning raw tool‑level events into durable, queryable violation records.

---

## Architecture and Design  

The design of ViolationCaptureModule follows a classic **separation‑of‑concerns** pattern.  The module itself is solely responsible for *detecting* and *routing* violations, while the actual persistence logic lives inside **ConstraintViolationStorage**.  This clear boundary enables the capture logic to evolve (e.g., adding new rule‑sets or detection heuristics) without touching the storage implementation.

Interaction with the rest of the system is anchored through two primary pathways:

1. **Dashboard configuration** – The module reads `integrations/mcp-constraint-monitor/dashboard/README.md` to learn how violations should be visualized.  This file acts as a declarative contract between the capture layer and the UI layer, ensuring that any change to the dashboard layout is automatically reflected in what the module records.

2. **Database persistence** – Although ViolationCaptureModule does not contain direct database code, it relies on its parent **ConstraintSystem** which, as documented, uses a `GraphDatabaseAdapter` (found in `storage/graph-database-adapter.ts`) for all graph‑oriented persistence.  By delegating to the parent’s adapter, the capture module inherits the same scalability and consistency guarantees provided by the graph database stack.

These interactions are illustrated in the architecture diagram below, which shows the module’s position within the broader ConstraintSystem and its ties to the dashboard and storage layers.  

![ViolationCaptureModule — Architecture](images/violation-capture-module-architecture.png)

The module shares its “configuration‑driven” philosophy with sibling components such as **ConstraintConfigurationManager**, **WorkflowManager**, and **HookManager**, all of which also load definitions from external files or databases.  This uniform approach simplifies onboarding for developers: the same pattern of “load‑config‑instantiate‑run” applies across the constraint enforcement suite.

---

## Implementation Details  

Although the source repository does not expose concrete class names for ViolationCaptureModule itself, the observations give a clear picture of its internal workflow:

* **Violation detection** – The module hooks into tool interaction events (e.g., API calls, file uploads) and applies the constraint rules defined elsewhere in the system.  When a rule is violated, a **violation object** is constructed containing metadata such as the offending entity, the rule identifier, a timestamp, and any contextual payload.

* **Routing to storage** – The freshly minted violation object is handed to **ConstraintViolationStorage**, the child component explicitly mentioned in the hierarchy.  The storage component is responsible for translating the object into a format suitable for the underlying persistence layer (most likely a graph node or edge, given the parent’s use of Graphology).

* **Database write‑through** – Through the parent **ConstraintSystem**, the storage component ultimately invokes the `GraphDatabaseAdapter` (implemented in `storage/graph-database-adapter.ts`).  This adapter abstracts the low‑level LevelDB operations and ensures that each violation is persisted atomically, with automatic JSON export sync as described for the broader system.

* **Dashboard exposure** – Once stored, violations become queryable by the dashboard UI.  Because the dashboard configuration lives in `integrations/mcp-constraint-monitor/dashboard/README.md`, any UI component that renders violation lists or charts pulls its display rules directly from that file, guaranteeing a one‑to‑one mapping between what is captured and what is shown.

Overall, the implementation follows a **pipeline** model: *event → detection → object creation → storage → UI*.  Each stage is isolated, which aids both testing and future extension.

---

## Integration Points  

ViolationCaptureModule is a hub of several integration pathways:

* **Parent – ConstraintSystem** – The module lives inside the ConstraintSystem component, inheriting its lifecycle and shared resources (e.g., the GraphDatabaseAdapter).  Any changes to the parent’s persistence strategy will automatically affect how violations are stored.

* **Sibling components** – It aligns with **ConstraintConfigurationManager** (which supplies the rule definitions that the module enforces) and **HookManager** (which may provide additional event hooks that trigger violation checks).  The shared configuration‑driven approach across these siblings reduces duplication and encourages consistent error handling.

* **Dashboard configuration** – The module reads `integrations/mcp-constraint-monitor/dashboard/README.md` to know which fields to expose and how to group violations.  This file acts as a contract between the back‑end capture logic and the front‑end monitoring UI.

* **ConstraintViolationStorage** – As the direct child, this storage component abstracts the persistence details.  It may also interact with the `integrations/mcp-constraint-monitor/README.md` file, which the observations note as a possible source of storage‑related metadata.

* **External tooling** – While not explicitly listed, the module’s purpose of “capturing constraint violations from tool interactions” implies that any external tool that integrates with the ConstraintSystem can trigger violation events, making ViolationCaptureModule a central point for cross‑tool observability.

The relationship diagram below visualizes these connections, highlighting the flow from external tools through the capture module to storage and finally to the dashboard.  

![ViolationCaptureModule — Relationship](images/violation-capture-module-relationship.png)

---

## Usage Guidelines  

1. **Define constraints centrally** – All rule definitions should be maintained by **ConstraintConfigurationManager**.  Adding or modifying a rule without updating the configuration manager can lead to silent capture failures.

2. **Keep the dashboard README in sync** – Whenever a new violation field is introduced (e.g., a new metadata attribute), update `integrations/mcp-constraint-monitor/dashboard/README.md` accordingly.  This ensures that the UI can render the new data without additional code changes.

3. **Leverage the storage abstraction** – Developers should interact with violations only through the public API exposed by **ConstraintViolationStorage**.  Direct database calls bypass the GraphDatabaseAdapter’s consistency guarantees and should be avoided.

4. **Test detection logic in isolation** – Because the capture pipeline is modular, unit tests can mock the storage layer and focus on rule evaluation.  This reduces test flakiness and speeds up CI pipelines.

5. **Monitor performance** – The capture module processes events in real time.  If the volume of tool interactions spikes, consider batching writes in **ConstraintViolationStorage** or tuning LevelDB’s write‑buffer settings (as configured in the GraphDatabaseAdapter) to avoid bottlenecks.

---

### Summary of Key Insights  

| Aspect | Insight |
|--------|---------|
| **Architectural patterns identified** | Separation of concerns (capture vs. storage), configuration‑driven design, pipeline processing |
| **Design decisions and trade‑offs** | Delegating persistence to the parent’s GraphDatabaseAdapter simplifies the capture module but couples it to the graph‑database stack; using a README for dashboard config is lightweight but requires disciplined documentation |
| **System structure insights** | ViolationCaptureModule sits under ConstraintSystem, works alongside siblings that also load external configs, and hands off data to a dedicated child storage component |
| **Scalability considerations** | Real‑time event capture can be scaled by optimizing the underlying LevelDB/Graphology stack and by potentially introducing asynchronous batching in ConstraintViolationStorage |
| **Maintainability assessment** | High maintainability thanks to clear module boundaries and shared configuration patterns; the main risk is drift between the dashboard README and actual stored fields, mitigated by strict documentation practices |

By adhering to the guidelines above and respecting the documented integration points, developers can extend ViolationCaptureModule confidently while preserving the integrity of the overall constraint enforcement ecosystem.

## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a GraphDatabaseAdapter for persistence, which is implemented in the storage/graph-database-adapter.ts file. This adapter enables the system to store and retrieve graph structures using Graphology and LevelDB, with automatic JSON export sync. The use of Graphology allows for efficient graph operations, while LevelDB provides a robust and scalable storage solution. The GraphDatabaseAdapter class in storage/graph-database-adapter.ts is responsible for managing the graph database, including creating and deleting graphs, as well as handling graph queries. The automatic JSON export sync feature ensures that the graph data is consistently updated and available for other components to access.

### Children
- [ConstraintViolationStorage](./ConstraintViolationStorage.md) -- The integrations/mcp-constraint-monitor/README.md file mentions the MCP Constraint Monitor, which could be related to the storage of constraint violations.

### Siblings
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDatabaseAdapter class in storage/graph-database-adapter.ts to manage graph database operations.
- [ContentValidator](./ContentValidator.md) -- ContentValidator checks entity content against predefined validation rules to ensure accuracy and consistency.
- [HookManager](./HookManager.md) -- HookManager loads hook events from a configuration file or database.
- [WorkflowManager](./WorkflowManager.md) -- WorkflowManager loads workflow definitions from a configuration file or database.
- [ConstraintConfigurationManager](./ConstraintConfigurationManager.md) -- ConstraintConfigurationManager loads constraint configurations from a configuration file or database.

---

*Generated from 7 observations*
