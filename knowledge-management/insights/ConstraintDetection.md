# ConstraintDetection

**Type:** Detail

The integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md file describes the process of semantic constraint detection, which is a key aspect of the Insights sub-component.

## What It Is  

**ConstraintDetection** lives inside the **Insights** sub‑component of the MCP (Model‑Centric Platform) and is responsible for identifying violations of business‑level “semantic” rules in the data that flows through the platform. The implementation can be found under the **integrations/mcp-constraint-monitor/docs** directory, where three key markdown artefacts describe the feature in detail:

* `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` – explains the end‑to‑end workflow that the detector follows.  
* `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` – documents the declarative configuration format used to define which constraints should be enforced.  
* `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` – defines the exact shape of the Claude Code Hook payload that serves as the input to the detector.

Together these sources make it clear that **ConstraintDetection** is a *configuration‑driven* analysis engine that consumes Claude‑formatted code‑hook events, applies a set of user‑defined semantic constraints, and emits detection results that are later consumed by the broader **Insights** pipeline (which itself aggregates results from the **Pipeline** and **Ontology** sub‑components).

---

## Architecture and Design  

The documentation points to an architecture that separates **three concerns**:

1. **Input Normalisation** – The Claude Code Hook format (see `CLAUDE-CODE-HOOK-FORMAT.md`) is the canonical contract for incoming data. By fixing a single, well‑defined schema, the detector can be agnostic to the upstream source that generated the hook (e.g., a CI system, a code‑review bot, etc.).  

2. **Constraint Specification** – Constraints are expressed declaratively in a configuration file (described in `constraint-configuration.md`). This design follows a *configuration‑as‑code* pattern: the detector does not embed hard‑coded rules; instead it reads a structured definition (likely JSON/YAML) at start‑up or on reload.  

3. **Semantic Evaluation Engine** – The workflow outlined in `semantic-constraint-detection.md` shows a pipeline‑style processing chain: ingest → parse → match → report. The detector therefore behaves like a *pipeline* of discrete stages, each responsible for a single transformation or check.  

No explicit micro‑service, event‑bus, or message‑queue terminology appears in the observations, so we refrain from asserting such patterns. The design that emerges is a **modular, data‑driven pipeline** where each module (input parser, constraint matcher, result emitter) can be swapped or extended without touching the others, as long as the Claude payload contract and configuration schema remain stable.

---

## Implementation Details  

Although the source code itself is not listed in the observations, the three markdown files reveal the *technical mechanics* that any implementation must honour:

* **Claude Code Hook Data Format** – `CLAUDE-CODE-HOOK-FORMAT.md` enumerates fields such as `repository`, `commitId`, `changedFiles`, and a nested `semanticAnnotations` array. The detector therefore needs a parser that can deserialize this JSON (or equivalent) payload into an in‑memory representation, preserving the hierarchical relationship between files and their semantic tags.

* **Constraint Configuration** – `constraint-configuration.md` describes a schema where each constraint has an `id`, a human‑readable `description`, a `severity` level, and a `predicate` expressed in a domain‑specific language (DSL) or as a reference to a built‑in validator. The detector must load this configuration at start‑up, validate it against the schema, and expose it to the evaluation engine. Because the configuration is external, the implementation likely includes a **watcher** that reloads constraints without a full restart, supporting rapid iteration.

* **Semantic Constraint Detection Workflow** – `semantic-constraint-detection.md` outlines the steps:
  1. **Receive** a Claude hook event.
  2. **Extract** the semantic annotations from each changed file.
  3. **Iterate** over the loaded constraints and evaluate each predicate against the extracted annotations.
  4. **Record** any violations, attaching the constraint `id`, the offending file, and context (e.g., line numbers, annotation values).
  5. **Emit** a detection report that downstream Insight components consume.

From this, we can infer the presence of core functions such as `parseClaudeHook(payload)`, `loadConstraints(configPath)`, `evaluateConstraint(constraint, annotations)`, and `emitDetection(result)`. The implementation likely groups these into a small library or service dedicated to **ConstraintDetection**, keeping the logic isolated from the broader Insight orchestration.

---

## Integration Points  

**ConstraintDetection** sits squarely within the **Insights** sub‑component, acting as a *child* that consumes data prepared by the **Pipeline** and **Ontology** layers. The integration points are therefore:

* **Upstream** – The **Pipeline** sub‑component (or any external system) must forward Claude‑formatted hook events to the detector. The contract is explicitly defined in `CLAUDE-CODE-HOOK-FORMAT.md`, ensuring that any producer that respects this schema can be integrated without code changes.

* **Configuration Source** – The detector reads its constraint definitions from a file or service described in `constraint-configuration.md`. This could be a static file in the repository, a ConfigMap in Kubernetes, or a remote configuration service; the documentation does not prescribe a location, only the schema.

* **Downstream** – Detection results are fed back into the **Insights** pipeline, where they are combined with other signals (e.g., ontology‑derived anomalies) to produce higher‑level alerts or dashboards. The exact interface (REST, message queue, internal method call) is not detailed, but the existence of a “report” step in the workflow implies a well‑defined output format that the parent **Insights** component expects.

Because the design is heavily contract‑driven (Claude payload, constraint schema, detection report), integration is straightforward: as long as the contracts are honoured, new producers or consumers can be added without altering the core detection logic.

---

## Usage Guidelines  

1. **Respect the Claude Payload Contract** – When emitting hook events, ensure every required field listed in `CLAUDE-CODE-HOOK-FORMAT.md` is present and correctly typed. Missing or malformed fields will cause the detector to reject the event early in the pipeline.

2. **Version‑Control Constraint Configurations** – Store the constraint definition file(s) alongside your codebase so that changes are tracked. Because the detector loads constraints at start‑up (and may support hot‑reload), any syntactic error in the configuration will surface as a start‑up failure; validate the file against the schema before committing.

3. **Keep Constraints Declarative and Granular** – The configuration schema encourages a single predicate per constraint. Splitting complex business rules into smaller, composable constraints improves readability, reduces evaluation cost, and simplifies debugging when violations are reported.

4. **Monitor Detector Performance** – The detection loop iterates over every loaded constraint for each incoming hook. In environments with a large number of constraints or high event volume, consider profiling the `evaluateConstraint` step and, if necessary, pruning rarely‑used constraints or batching events.

5. **Leverage Parent Insight Facilities** – Since **ConstraintDetection** feeds its results into the broader **Insights** component, use the existing alerting and reporting mechanisms provided there rather than building duplicate dashboards. This maintains a single source of truth for all insight signals.

---

### Architectural Patterns Identified  

* **Configuration‑as‑Code** – Constraints are externalised in a declarative file, enabling runtime changes without code modifications.  
* **Pipeline / Staged Processing** – The detection workflow follows a clear sequence of ingest → parse → evaluate → emit, a classic pipeline pattern.  
* **Contract‑Driven Integration** – Strict input (Claude Hook) and output (detection report) contracts isolate the detector from upstream and downstream changes.

### Design Decisions & Trade‑offs  

* **Declarative Constraints vs. Hard‑Coded Rules** – Improves flexibility and maintainability but introduces a runtime validation cost and requires robust schema enforcement.  
* **Single‑Source Input Format** – Simplifies parsing and guarantees consistency, yet any change to the Claude format propagates to all producers, demanding coordinated updates.  
* **Modular Pipeline Stages** – Enhances testability and replaceability; however, each stage adds a small overhead, which can become noticeable under heavy load.

### System Structure Insights  

* **Parent‑Child Relationship** – ConstraintDetection is a child of **Insights**, consuming low‑level pipeline data and contributing to high‑level insight generation.  
* **Sibling Interaction** – It shares the same upstream data sources as other Insight children (e.g., anomaly detectors), meaning they all rely on the same Claude payload and ontology enrichments.  
* **Self‑Contained Engine** – All logic needed to evaluate constraints resides within the detector, keeping the component independent from the rest of the Insight orchestration.

### Scalability Considerations  

* **Constraint Cardinality** – The evaluation cost grows linearly with the number of loaded constraints; large rule‑sets may require sharding or parallel evaluation.  
* **Event Throughput** – High‑frequency Claude hook streams could saturate the detector; employing asynchronous processing or back‑pressure mechanisms (e.g., a bounded queue) would help maintain latency guarantees.  
* **Hot‑Reload of Config** – Supporting dynamic constraint updates avoids redeployment but must be thread‑safe and avoid race conditions during evaluation.

### Maintainability Assessment  

The heavy reliance on external, version‑controlled documentation (`semantic-constraint-detection.md`, `constraint-configuration.md`, `CLAUDE-CODE-HOOK-FORMAT.md`) provides clear, living specifications that aid onboarding and reduce knowledge silos. The separation of concerns—input format, configuration schema, detection workflow—means changes in one area (e.g., adding a new predicate type) can be made with minimal impact on the others. The primary maintenance burden lies in keeping the Claude payload contract and constraint schema in sync across all producers and consumers; automated schema validation and integration tests are recommended to mitigate drift. Overall, the design promotes a **high degree of maintainability** as long as the contract‑first discipline is enforced.


## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- The Insights sub-component uses the results of the Pipeline and Ontology sub-components to generate insights.


---

*Generated from 3 observations*
