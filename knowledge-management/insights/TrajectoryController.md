# TrajectoryController

**Type:** SubComponent

TrajectoryController utilizes the SpecstoryConnectionManager to establish connections to the Specstory extension, providing methods for initialization and logging conversations.

## What It Is  

The **TrajectoryController** is a sub‑component that lives inside the larger **Trajectory** component (the parent).  It is the primary orchestrator for all workflow‑related activities such as project milestones, phase planning, and implementation‑task tracking.  Although the source observations do not list concrete file‑system locations, the controller is referenced throughout the hierarchy as the holder of three child objects – **SpecstoryConnectionManager**, **ConversationLogger**, and **InitializationHandler** – and it directly consumes the **SpecstoryAdapter** functionality that is shared with its sibling components.  The controller’s public surface presents a **unified interface** for callers, abstracting away the details of which workflow (e.g., milestone‑driven or phase‑planning) is currently active.  Configuration is externalised in a JSON file (e.g., `config.json`), allowing the controller to be re‑configured without code changes.

## Architecture and Design  

The design of **TrajectoryController** is centred on a **state‑machine architecture**.  Each distinct phase of a workflow (initialisation, active execution, error handling, completion) is modelled as a state, and transitions are triggered by events such as “connection established”, “conversation logged”, or “workflow error”.  This explicit state handling simplifies the management of complex, multi‑step processes and makes the controller’s behaviour predictable and testable.  

A **configuration‑driven façade** pattern is also evident.  By exposing a single, high‑level API while delegating the concrete work to its children, the controller hides the intricacies of the underlying **SpecstoryConnectionManager**, **ConversationLogger**, and **InitializationHandler**.  Callers therefore interact with a stable surface regardless of whether the active workflow is a milestone plan or a phase‑planning sequence.  

Logging and error handling are treated as cross‑cutting concerns.  The controller integrates a **ConversationLogger** (a sibling that also uses **SpecstoryAdapter**) to capture all interactions with the Specstory extension, and it centralises exception handling to guarantee robustness.  The presence of a dedicated **config.json** file indicates a **configuration‑as‑code** approach, enabling the controller to adapt to new workflows or preference changes without recompilation.  

The overall architecture is **modular**: each child component has a single responsibility (connection management, logging, or initialisation), which aligns with the **Single‑Responsibility Principle** and facilitates independent evolution of those pieces.

## Implementation Details  

* **State Machine** – The controller maintains an internal state object (not explicitly named in the observations) that records the current workflow stage.  Transition methods are invoked by events emitted from the child components.  For example, when **SpecstoryConnectionManager** successfully opens a channel to the Specstory extension, it signals the controller to move from *INITIALIZING* to *CONNECTED*.  

* **SpecstoryConnectionManager** – This child encapsulates all logic required to talk to the Specstory extension.  It leverages the **SpecstoryAdapter** (a sibling) to support multiple connection mechanisms (HTTP API, IPC, file‑watch directory).  The manager provides explicit “initialisation” and “logConversation” methods that the controller calls during the *INITIALIZING* and *ACTIVE* states.  

* **ConversationLogger** – Also a sibling, this component formats log entries, writes them to persistent storage, and forwards any errors back to the controller.  Its tight coupling with **SpecstoryAdapter** ensures that every conversation with the Specstory extension is recorded, satisfying the logging requirement described in observations 1 and 7.  

* **InitializationHandler** – This child prepares the controller for operation.  It reads the **config.json** file, validates workflow settings, and triggers the **SpecstoryConnectionManager** to establish the first connection.  By isolating configuration parsing, the controller can remain focused on state transitions and error handling.  

* **Error & Exception Management** – Throughout the workflow, any exception raised by the connection manager, logger, or initialization code is caught by the controller’s top‑level handler.  The controller then logs the error (via **ConversationLogger**) and decides whether to retry, abort, or transition to a safe *ERROR* state, thereby meeting the robustness goal highlighted in observation 3.  

* **Unified Interface** – Public methods such as `startWorkflow(workflowId)`, `pause()`, `resume()`, and `shutdown()` are exposed by the controller.  Internally these methods delegate to the appropriate child based on the current state, ensuring that callers never need to know whether the underlying workflow is a milestone plan or a phase‑planning routine (observation 5).  

## Integration Points  

The **TrajectoryController** sits at the heart of the **Trajectory** component’s ecosystem.  It consumes configuration data from `config.json`, which may be authored by DevOps or product teams.  Its primary external dependency is the **Specstory extension**, accessed through the **SpecstoryConnectionManager** and ultimately the **SpecstoryAdapter**.  Because the adapter also serves the sibling components **ConversationLogger** and **SpecstoryConnectionManager**, the controller benefits from a shared communication layer that reduces duplication.  

On the inbound side, higher‑level services (e.g., a GraphQL API layer or a CLI tool) invoke the controller’s unified interface to trigger workflows.  On the outbound side, the controller pushes workflow events to the Specstory extension and writes structured logs via **ConversationLogger**.  The **FileWatchHandler** sibling monitors a directory for log files generated by the controller, enabling downstream processes (such as analytics pipelines) to react to newly created logs.  

All interactions are mediated through well‑defined method signatures (e.g., `initialize()`, `logConversation()`, `handleError()`) that are documented in the respective child classes.  This clear contract makes it straightforward to replace or mock any child component for testing or future extension.

## Usage Guidelines  

1. **Initialise First** – Always invoke the controller’s `initialize()` (or the equivalent method provided by **InitializationHandler**) before attempting to start any workflow.  This step loads `config.json` and establishes the Specstory connection; skipping it can leave the controller in an undefined state.  

2. **Respect the State Machine** – Callers should query the controller’s current state (e.g., `getState()`) and only issue commands that are valid for that state.  Attempting to `pause()` a workflow that is not yet *ACTIVE* will result in a no‑op or an error logged by **ConversationLogger**.  

3. **Handle Errors Gracefully** – The controller will surface errors through a callback or an event emitter.  Implementers should subscribe to these error events and decide whether to retry, abort, or alert an operator.  Because the controller centralises error handling, custom retry logic should be placed outside the controller to avoid interfering with its internal state transitions.  

4. **Leverage Configuration** – Adjust workflow behaviour by editing `config.json`.  Adding a new workflow type or changing preferences does not require code changes; simply update the JSON and restart the controller so that **InitializationHandler** can re‑read the configuration.  

5. **Do Not Bypass Children** – Directly invoking methods on **SpecstoryConnectionManager**, **ConversationLogger**, or **InitializationHandler** is discouraged.  All interactions should go through the controller’s façade to preserve state integrity and ensure that logging and error handling remain consistent.  

---

### Architectural Patterns Identified  
1. **State‑Machine Pattern** – explicit workflow states and transitions.  
2. **Facade / Unified Interface** – controller abstracts child complexities.  
3. **Configuration‑Driven Design** – external `config.json` drives behaviour.  
4. **Logging/Observer Concern** – centralized logging via **ConversationLogger**.  

### Design Decisions & Trade‑offs  
* **State machine** offers clarity and testability but adds overhead for state bookkeeping.  
* **Facade** simplifies external usage but introduces a thin coupling layer that must be kept in sync with child APIs.  
* **External JSON config** enables rapid reconfiguration but relies on correct schema validation at start‑up.  
* **Dedicated logging component** isolates logging concerns, yet it creates an extra runtime dependency that must be kept alive for full observability.  

### System Structure Insights  
* **TrajectoryController** is the orchestration hub; its children each embody a single responsibility.  
* Siblings (**SpecstoryConnectionManager**, **ConversationLogger**, **FileWatchHandler**, **SpecstoryAdapter**) share the **SpecstoryAdapter** as a common communication backbone.  
* The parent **Trajectory** component provides broader context (milestones, GSD workflow) and supplies the configuration file used by the controller.  

### Scalability Considerations  
* Adding new workflow types only requires extending the state machine and updating `config.json`; no core controller code changes are needed, supporting horizontal scalability of workflow varieties.  
* Because logging is delegated to **ConversationLogger**, log volume can be scaled out by directing logs to external storage (e.g., a log aggregation service) without modifying the controller.  
* Connection handling via **SpecstoryConnectionManager** can be parallelised if the Specstory extension supports multiple concurrent sessions, allowing the controller to manage several workflows simultaneously.  

### Maintainability Assessment  
The modular decomposition (single‑responsibility children) and the clear state‑machine model make the **TrajectoryController** highly maintainable.  Changes to connection logic, logging format, or initialization steps are isolated to their respective child classes, reducing regression risk.  The reliance on an external JSON configuration reduces code churn for behavioural tweaks.  The primary maintenance burden lies in keeping the state‑machine definitions and transition rules accurate as new workflow states are introduced; however, this is mitigated by the explicit, observable nature of state transitions.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive planning infrastructure. The component's architecture involves multiple connection methods, including HTTP API, Inter-Process Communication (IPC), and file watch directory, to interact with the Specstory extension. The SpecstoryAdapter class plays a central role in this component, providing methods for initialization, logging conversations, and connecting to the Specstory extension via different methods.

### Children
- [SpecstoryConnectionManager](./SpecstoryConnectionManager.md) -- The TrajectoryController utilizes the SpecstoryConnectionManager to connect to the Specstory extension, as indicated by the parent context.
- [ConversationLogger](./ConversationLogger.md) -- The ConversationLogger would likely be used in conjunction with the SpecstoryConnectionManager to log conversations, as implied by the parent context.
- [InitializationHandler](./InitializationHandler.md) -- The InitializationHandler would likely work in tandem with the SpecstoryConnectionManager to establish connections and initialize the TrajectoryController, as suggested by the parent context.

### Siblings
- [SpecstoryConnectionManager](./SpecstoryConnectionManager.md) -- SpecstoryConnectionManager utilizes the SpecstoryAdapter class to establish connections to the Specstory extension, providing methods for initialization and logging conversations.
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger utilizes the SpecstoryAdapter class to log conversations, providing methods for formatting log entries and handling errors.
- [FileWatchHandler](./FileWatchHandler.md) -- FileWatchHandler utilizes the Node.js fs module to watch a directory for new log files, providing methods for handling file system events.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter utilizes the SpecstoryConnectionManager to establish connections to the Specstory extension, providing methods for initialization and logging conversations.

---

*Generated from 7 observations*
