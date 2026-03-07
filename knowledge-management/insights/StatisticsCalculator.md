# StatisticsCalculator

**Type:** SubComponent

The sub-component supports customizable statistics computation through its configure function in statistics-calculator.ts, allowing users to define custom statistics formulas

## What It Is  

**StatisticsCalculator** is a dedicated sub‑component that lives in the file `statistics-calculator.ts`. Its primary responsibility is to derive quantitative insights from the historical record of constraint violations maintained by the **ViolationHistory** interface (defined in `violation-history.ts`). By aggregating violation severity, frequency, and timestamps, the calculator produces a set of statistics that can be consumed by higher‑level components such as the **ConstraintSystem** parent. The component is deliberately scoped: it does not manage persistence or UI concerns, but instead focuses on data‑centric operations—filtering out stale entries, normalising disparate metrics, and exposing the results through a notification channel for any interested listeners.

## Architecture and Design  

The design of **StatisticsCalculator** follows a **data‑aggregation + processing pipeline** architecture. The pipeline begins with raw violation records supplied via the `ViolationHistory` contract, proceeds through a **filtering stage** (to discard irrelevant or outdated entries), then a **normalisation stage** (to bring metrics from different workflows onto a common scale), and finally a **statistics computation stage** implemented by the `calculateStatistics` function. This staged approach is evident from the observations that mention a filtering mechanism and a data‑normalisation technique, both residing in `statistics-calculator.ts`.

Two classic design patterns surface in the implementation:

1. **Observer (notification mechanism)** – The component “provides a notification mechanism … for alerting listeners about changes to computed statistics.” This implies an event‑emitter or callback registration model that decouples statistic producers from consumers, allowing other parts of the system (e.g., UI dashboards or alerting services) to react without tight coupling.

2. **Strategy (customisable computation)** – Through the exported `configure` function, callers can inject custom formulas for statistic calculation. This mirrors the Strategy pattern: the core aggregation logic remains stable while the actual metric definitions can be swapped at runtime.

The component’s architecture is intentionally **modular** and **self‑contained**, mirroring the broader modular philosophy of its parent **ConstraintSystem**, whose sibling sub‑components (e.g., `WorkflowLayoutComputer`, `ContentValidationAgent`, `ViolationCaptureService`) each adopt distinct approaches (graph‑based, rules‑based, event‑driven). This diversity underscores a design decision to let each sub‑component use the paradigm that best fits its domain while still fitting into a unified parent container.

## Implementation Details  

The heart of the calculator is the `calculateStatistics` function in `statistics-calculator.ts`. It receives a collection of violation records (conforming to the `ViolationHistory` interface) and iterates over them, extracting three key dimensions:

* **Severity** – a numeric or enumerated weight that influences the impact score.  
* **Frequency** – how often a particular violation type occurs within the examined window.  
* **Timestamp** – used both for time‑based weighting and for the **filtering mechanism** that removes records older than a configurable threshold.

Before any aggregation, the component applies its **filtering mechanism**. Although the exact predicate is not listed, the observation clarifies that irrelevant or outdated data is excluded, which likely involves checking the timestamp against a “look‑back” period or discarding violations that do not match a severity mask.

Next, the **data‑normalisation technique** rescales raw severity and frequency values so that statistics remain comparable across workflows that may have different baseline violation rates. Normalisation could be a min‑max scaling or a statistical z‑score; the observation only guarantees consistency across workflows.

The `configure` function allows callers to supply a custom statistics formula—perhaps a callback that receives the pre‑processed violation set and returns a bespoke metric object. This extensibility is key for teams that need domain‑specific KPIs beyond the default severity/frequency aggregates.

Finally, once the statistics object is produced, the **notification mechanism** dispatches an event (or invokes registered callbacks) to inform any subscribed listeners that the statistical snapshot has changed. This decouples the calculator from downstream consumers, enabling flexible integration patterns such as real‑time dashboards, automated remediation triggers, or logging pipelines.

## Integration Points  

**StatisticsCalculator** sits directly under the **ConstraintSystem** component, which orchestrates multiple sub‑components. The parent likely instantiates the calculator, injects the `ViolationHistory` implementation (perhaps a repository or in‑memory store), and subscribes to its notifications to react to updated metrics. Because the sibling **ViolationCaptureService** is event‑driven and captures constraint violations, it is a natural upstream data source for the calculator’s `ViolationHistory`. Conversely, the sibling **WorkflowLayoutComputer** may consume the statistics to adjust workflow visualisations, while **ContentValidationAgent** could use them to prioritise validation rules based on historical severity.

The calculator’s public API consists of at least three exported members:

* `calculateStatistics` – the core computation entry point.  
* `configure` – a setter for custom formula injection.  
* Notification hooks (e.g., `onStatisticsUpdated` or an event emitter) – for downstream listeners.

All interactions are mediated through TypeScript interfaces (`ViolationHistory`) and plain objects, keeping the coupling lightweight. No external services or databases are referenced directly in the observations, indicating that persistence concerns are handled elsewhere (most likely by the parent or by the `ViolationCaptureService`).

## Usage Guidelines  

When integrating **StatisticsCalculator**, developers should first ensure that a concrete implementation of the `ViolationHistory` interface is available and populated with up‑to‑date violation records. The calculator expects this data to be **chronologically accurate**, as the filtering stage relies on timestamps to discard stale entries.  

If the default severity/frequency aggregates suffice, simply invoke `calculateStatistics` after any batch of violations is persisted. For environments where domain‑specific KPIs are required (e.g., weighted risk scores, trend analyses), use the `configure` function to register a custom formula before the first calculation; the configuration is typically immutable for the lifetime of the calculator instance to avoid inconsistent results.  

Subscribe to the notification mechanism early in the application lifecycle if you need real‑time reactions—register callbacks before the first calculation to guarantee you do not miss the initial emission. Remember that the notification payload contains the **computed statistics object**, not the raw violations, so downstream code should treat it as read‑only.  

Finally, respect the **filtering thresholds** and **normalisation parameters** (if exposed) when tuning the component for performance or accuracy. Over‑aggressive filtering may omit useful data, while under‑normalisation can lead to misleading cross‑workflow comparisons.

---

### Architectural patterns identified
1. **Observer pattern** – notification mechanism for statistic changes.  
2. **Strategy pattern** – `configure` function enables pluggable statistics formulas.  
3. **Pipeline/Filter‑Normalize‑Aggregate pattern** – staged processing of violation data.

### Design decisions and trade‑offs
* **Modular isolation** – StatisticsCalculator handles only computation, leaving persistence and UI to other components; this improves testability but requires careful contract definition (`ViolationHistory`).  
* **Configurable formulas** – provides flexibility at the cost of added runtime complexity and the need for validation of user‑supplied functions.  
* **Filtering vs. completeness** – aggressive filtering reduces noise and improves performance but may discard edge‑case violations that could be diagnostically valuable.

### System structure insights
* The component is a leaf node under **ConstraintSystem**, with clear upstream (violation capture) and downstream (notification listeners) relationships.  
* Sibling sub‑components each adopt domain‑specific paradigms, illustrating a “plug‑and‑play” modular architecture where each child can evolve independently.  

### Scalability considerations
* **Data volume** – As the number of stored violations grows, the aggregation pipeline could become a bottleneck; incremental updates or windowed processing may be required.  
* **Custom formulas** – Complex user‑provided strategies can increase CPU usage; profiling or sandboxing may be needed for large‑scale deployments.  
* **Notification fan‑out** – If many listeners subscribe, broadcasting updates could impact latency; a pub/sub broker or throttling mechanism could mitigate this.

### Maintainability assessment
* **High cohesion** – All logic related to statistics lives in a single file (`statistics-calculator.ts`), making the component easy to locate and modify.  
* **Loose coupling** – Reliance on the `ViolationHistory` interface and observer callbacks reduces direct dependencies, simplifying future refactors.  
* **Extensibility** – The `configure` hook and clear separation of filtering/normalisation stages support straightforward addition of new metrics.  
* **Potential risk** – Absence of explicit type safety around custom formulas (if they are raw callbacks) could introduce runtime errors; adding typed strategy interfaces would improve robustness.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes a modular design, with sub-components such as the ContentValidationAgent and the ViolationCaptureService, each responsible for a specific aspect of constraint enforcement. For instance, the ContentValidationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts, uses filePathPatterns and commandPatterns to extract references from entity content, demonstrating a clear separation of concerns. This modular approach allows for easier maintenance and updates, as each sub-component can be modified or extended independently without affecting the overall system.

### Siblings
- [WorkflowLayoutComputer](./WorkflowLayoutComputer.md) -- WorkflowLayoutComputer uses a graph-based data structure in workflow-layout-computer.ts to model workflow dependencies and compute layouts
- [ContentValidationAgent](./ContentValidationAgent.md) -- ContentValidationAgent uses a rules-based approach in content-validation-agent.ts to validate entity content against predefined constraints
- [ViolationCaptureService](./ViolationCaptureService.md) -- ViolationCaptureService uses a event-driven approach in violation-capture-service.ts to capture and process constraint violations


---

*Generated from 7 observations*
