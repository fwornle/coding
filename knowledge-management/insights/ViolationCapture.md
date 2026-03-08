# ViolationCapture

**Type:** SubComponent

ViolationCapture employs the integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts to capture constraint violations from tool interactions.

## What It Is  

ViolationCapture is the **centralised sub‑component** responsible for detecting, recording and persisting constraint‑violation events that arise from tool interactions throughout the *ConstraintSystem*.  The implementation lives in the same repository as the other agents and utilities and is wired together through the **content‑validation‑agent** located at  

```
integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts
```  

This agent is the entry point for the tool‑level checks that surface violations.  Once a violation is identified, ViolationCapture forwards the information to the **GraphDatabase** layer (via its child *GraphDatabasePersistence*) for durable storage and later export as JSON.  The component also relies on the **Logger** (via the `centralLog` wrapper) to emit diagnostic information, and on the **HookManager** to receive hook events that trigger the capture workflow.  In short, ViolationCapture is the “single source of truth” for all constraint‑violation data that powers the dashboard view of the system.

---

## Architecture and Design  

The architecture surrounding ViolationCapture is **modular** and **orchestrated**.  Each sibling component (ContentValidator, HookManager, Logger, GraphDatabase, AgentManager) lives in its own file and owns a distinct responsibility, a design explicitly highlighted in the parent **ConstraintSystem** description.  ViolationCapture sits at the intersection of three concerns:

1. **Detection** – The `content-validation-agent.ts` parses entities and flags violations; this logic is encapsulated in the **ContentValidator** sibling, which delegates to the agent.  
2. **Orchestration** – The **HookManager** acts as a central dispatcher for hook events.  By loading configuration and routing events to registered handlers, it provides a lightweight *mediator*‑style layer that allows ViolationCapture to be invoked without tight coupling to the callers.  
3. **Persistence** – ViolationCapture forwards the captured payload to **GraphDatabasePersistence**, a child component that abstracts the underlying **GraphDatabase** API.  The persistence layer automatically synchronises the stored data to a JSON export, ensuring that downstream dashboards receive a consistent snapshot.

Although no explicit “design pattern” labels appear in the observations, the observable structure maps cleanly onto well‑known patterns:

| Observed Behaviour | Implicit Pattern |
|--------------------|------------------|
| Separate files per agent / validator / manager | **Modular / Component‑Based** organization |
| HookManager loading configs and dispatching to handlers | **Mediator / Event‑Dispatcher** style |
| `centralLog` wrapping a logger instance | **Wrapper / Facade** for logging |
| GraphDatabasePersistence isolating persistence details | **Repository / Data‑Access** abstraction |
| Automatic JSON export after persistence | **Synchronization** between storage and presentation layers |

These patterns together enable a clear separation of concerns while still allowing ViolationCapture to act as the single aggregation point for violation data.

---

## Implementation Details  

### Core Flow  

1. **Tool Interaction → ContentValidationAgent**  
   The `content-validation-agent.ts` (under `integrations/mcp-server-semantic-analysis/src/agents/`) receives raw artefacts from the tooling pipeline.  It parses entities, validates references and identifies any constraint breaches.  

2. **Agent → ContentValidator**  
   The **ContentValidator** component consumes the agent’s output.  Its responsibility is to translate raw validation results into a structured *violation* object that ViolationCapture can store.  

3. **ViolationCapture Invocation**  
   When a violation object is ready, ViolationCapture is called—typically from a hook handler registered with **HookManager**.  The hook manager loads its configuration, matches the “violation‑captured” event, and dispatches the payload to ViolationCapture’s public API (the exact function name is not listed, but the flow is evident from the observations).  

4. **Logging**  
   Immediately upon receipt, ViolationCapture emits a diagnostic entry via the **Logger**.  The `centralLog` function provides a thin wrapper, guaranteeing a uniform log format across the subsystem.  

5. **Persistence**  
   ViolationCapture forwards the structured violation to its child **GraphDatabasePersistence**.  This class encapsulates all interactions with the **GraphDatabase**—creating nodes/edges, running queries, and ensuring that each persisted record is also written to a JSON export file.  The export mechanism is described as “automatic JSON export sync,” meaning that after each write the JSON representation is refreshed without additional developer effort.  

### Key Classes / Functions  

| Entity | Role | Notable Member(s) |
|--------|------|-------------------|
| `content-validation-agent.ts` | Parses source artefacts and flags violations | – |
| **ContentValidator** | Transforms raw agent output into ViolationCapture‑ready objects | – |
| **ViolationCapture** (sub‑component) | Central hub for storing violation data | – (public capture method inferred) |
| **HookManager** | Loads hook configs, dispatches events to handlers | – |
| **Logger** (`centralLog`) | Simple wrapper for logging | `centralLog(message: string)` |
| **GraphDatabasePersistence** | Persistence façade for GraphDatabase | – (methods for create/update, JSON sync) |
| **GraphDatabase** | Underlying graph store used by Persistence | – |

Because the source observations do not list explicit method signatures, the description focuses on the responsibilities and the data flow between these named entities.

---

## Integration Points  

ViolationCapture is tightly coupled to three primary integration surfaces:

1. **ContentValidationAgent / ContentValidator** – The detection side.  Any change to the parsing logic or to the shape of the violation payload must be reflected in the contract that ViolationCapture expects.  This contract is implicit; developers should keep the JSON schema of the violation object stable.  

2. **HookManager** – The event‑driven entry point.  Hook configurations (likely JSON/YAML files read by HookManager) determine when ViolationCapture is invoked.  Adding new hook types or altering existing ones requires updating HookManager’s configuration and possibly extending the handler registration code.  

3. **GraphDatabasePersistence** – The storage side.  ViolationCapture delegates all persistence concerns to this child component.  If the underlying graph database technology changes (e.g., switching from Neo4j to another graph store), only GraphDatabasePersistence needs to be updated, leaving ViolationCapture untouched.  

Additionally, the **Logger** is a cross‑cutting concern; any modification to logging levels or formats should be made inside `centralLog` so that all components—including ViolationCapture—continue to emit consistent logs.

---

## Usage Guidelines  

* **Treat ViolationCapture as the sole writer** for constraint‑violation records.  Direct writes to the GraphDatabase bypassing ViolationCapture will break the automatic JSON sync and may cause dashboard inconsistencies.  
* **Maintain the violation payload schema** as defined by the ContentValidator output.  Adding new fields should be backward compatible, and any downstream consumer (dashboard) must be updated in lockstep.  
* **Register hook handlers through HookManager** rather than invoking ViolationCapture directly from ad‑hoc code.  This preserves the central orchestration model and ensures that logging and error handling remain consistent.  
* **Rely on the Logger’s `centralLog`** for any diagnostic output related to violation capture.  Avoid creating separate logger instances; this keeps log aggregation simple.  
* **When extending persistence** (e.g., adding indexes, changing export format), modify only GraphDatabasePersistence.  ViolationCapture’s public API remains stable, protecting callers from persistence‑layer churn.  

Following these conventions keeps the subsystem loosely coupled, easy to test, and aligned with the modular philosophy of the broader ConstraintSystem.

---

## Summary of Architectural Insights  

| 1️⃣ Architectural patterns identified |
|---------------------------------------|
| Modular / component‑based file separation (each agent, validator, manager in its own file) |
| Mediator / event‑dispatcher style via HookManager |
| Wrapper / façade for logging (`centralLog`) |
| Repository / data‑access abstraction in GraphDatabasePersistence |
| Automatic synchronization (graph → JSON export) |

| 2️⃣ Design decisions and trade‑offs |
|------------------------------------|
| **Centralised capture** simplifies dashboard data consistency but creates a single point of failure; high‑availability would require replication of the persistence layer. |
| **Hook‑driven orchestration** decouples detection from capture, enabling easy addition of new event sources, yet introduces indirect control flow that can be harder to trace during debugging. |
| **Graph‑based persistence** gives rich relationship modelling for violations, at the cost of requiring a graph DB runtime and associated operational overhead. |
| **Automatic JSON export** removes manual serialization steps, improving developer productivity, but couples the export format tightly to the internal graph schema. |

| 3️⃣ System structure insights |
|------------------------------|
| ViolationCapture sits under **ConstraintSystem** and owns **GraphDatabasePersistence** as its child, forming a clear parent‑child persistence relationship. |
| Sibling components (ContentValidator, HookManager, Logger, GraphDatabase, AgentManager) each provide a distinct service that ViolationCapture consumes, illustrating a clean separation of concerns. |
| The shared use of `content-validation-agent.ts` across several siblings indicates a **single source of truth** for validation logic, reducing duplication. |

| 4️⃣ Scalability considerations |
|-------------------------------|
| Because violations are persisted in a graph database, scaling horizontally will depend on the underlying graph DB’s clustering capabilities. |
| HookManager can distribute events across multiple handler instances, allowing the capture pipeline to be parallelised if the event volume grows. |
| JSON export is performed automatically after each write; for very high write rates, batching or asynchronous export may be required to avoid I/O bottlenecks. |

| 5️⃣ Maintainability assessment |
|-------------------------------|
| The modular layout (one file per agent/manager) promotes easy navigation and low cognitive load for new developers. |
| Centralising logging through `centralLog` and persistence through GraphDatabasePersistence isolates cross‑cutting concerns, making future refactors straightforward. |
| The reliance on a single agent file (`content-validation-agent.ts`) means changes to validation logic have wide impact; careful versioning and thorough tests are essential. |
| Overall, the design favours **readability and replaceability** (agents can be swapped) while keeping the core capture flow stable, which bodes well for long‑term maintainability.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem employs a modular architecture, with each agent having its own file and responsibility. For instance, the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) is responsible for parsing entities and verifying references in the codebase. This modular approach allows for easier maintenance and updates, as each agent can be modified or replaced without affecting the entire system. Furthermore, the use of a separate file for each agent promotes code organization and readability, making it easier for new developers to understand the system's architecture.

### Children
- [GraphDatabasePersistence](./GraphDatabasePersistence.md) -- The GraphDatabase class is likely to be used for persistence, given the parent context of ConstraintSystem and ViolationCapture

### Siblings
- [ContentValidator](./ContentValidator.md) -- ContentValidator utilizes the ContentValidationAgent in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts to parse entities and verify references.
- [HookManager](./HookManager.md) -- HookManager utilizes a modular approach, allowing for easier maintenance and updates as each hook can be modified or replaced without affecting the entire system.
- [Logger](./Logger.md) -- Logger utilizes the centralLog function as a simple logger wrapper to provide a logging mechanism for the system.
- [GraphDatabase](./GraphDatabase.md) -- GraphDatabase utilizes the integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts to handle graph database persistence and querying.
- [AgentManager](./AgentManager.md) -- AgentManager utilizes the integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts to manage the ContentValidationAgent.


---

*Generated from 7 observations*
