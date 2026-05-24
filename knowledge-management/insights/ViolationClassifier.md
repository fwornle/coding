# ViolationClassifier

**Type:** Detail

Positioned at the output boundary of SemanticConstraintDetector, ViolationClassifier bridges the detection pipeline to downstream systems — referenced in the parent analysis as feeding 'persistence and dashboard display' — making it the key integration point where raw detection results are normalized into a schema shared across the constraint monitor integration.

## What It Is  

**ViolationClassifier** lives inside the *constraint‑monitor* integration at the path  
`integrations/mcp-constraint-monitor/` – it is referenced as a child of **SemanticConstraintDetector** in the design documentation (`semantic-detection-design.md`). Its sole responsibility is to take the raw results produced by the *semantic* detection pipeline and translate them into a **typed, display‑ready violation object**.  

The downstream consumer of this object is the dashboard component described in `integrations/mcp-constraint-monitor/dashboard/README.md`. The dashboard expects each violation to carry a **severity** (e.g., high, medium, low) and a **category** that can be filtered or grouped for visualisation. Because the *Constraint Configuration Guide* (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`) states that violations are configurable, the classifier does not hard‑code these values; instead it maps detector outcomes to the severity/category definitions supplied by the user configuration.

In short, **ViolationClassifier** is the normalization layer that bridges the detection engine (**SemanticConstraintDetector**) to persistence layers and UI components, guaranteeing a stable schema for all downstream users.

---

## Architecture and Design  

The architecture around **ViolationClassifier** follows a **pipeline‑boundary pattern**. The detection pipeline (implemented by **SemanticConstraintDetector** and its sibling **SemanticRuleEvaluator**) produces *raw detection events* – these are low‑level, implementation‑specific data structures that encode which semantic rule was triggered and the raw context of the breach.  

At the **output boundary** of this pipeline, **ViolationClassifier** performs two key design tasks:

1. **Configuration‑driven mapping** – it reads the user‑provided constraint configuration (see `constraint-configuration.md`) to obtain the mapping table that links rule identifiers to *severity* and *category* values. This keeps the classification logic decoupled from the detection logic and makes the system extensible without code changes.  

2. **Schema normalisation** – the classifier emits a **Violation DTO** (Data Transfer Object) that conforms to a contract expected by the dashboard and persistence layers. Because the dashboard documentation explicitly mentions rendering violations by severity or category, the DTO must contain fields such as `id`, `ruleName`, `severity`, `category`, `timestamp`, and a human‑readable `message`.

The design therefore isolates **business‑rule evaluation** (handled by **SemanticRuleEvaluator**) from **policy‑level representation** (handled by **ViolationClassifier**). This separation improves maintainability: changes to rule logic do not ripple into UI contracts, and updates to severity categories are performed via configuration files rather than code rewrites.

No additional architectural patterns (e.g., event‑driven, micro‑service) are mentioned in the observations, so the documented design remains a **modular, layered** approach within a single codebase.

---

## Implementation Details  

Although the source repository does not expose concrete class or function names for **ViolationClassifier**, the surrounding documentation provides enough clues to outline its internal mechanics:

* **Configuration Loader** – a component that parses the YAML/JSON files described in `constraint-configuration.md`. It builds an in‑memory map, e.g., `{ "ruleA": { "severity": "high", "category": "security" } }`. This loader is invoked when the detector starts up or when the configuration is refreshed.

* **Classification Engine** – a function (conceptually `classifyViolation(rawResult)`) that receives a *raw detection result* from **SemanticConstraintDetector**. It extracts the rule identifier, looks up the corresponding severity/category in the configuration map, and assembles the final **Violation DTO**.  

* **DTO Definition** – the violation object follows a schema that matches the dashboard’s expectations (as per `dashboard/README.md`). Typical fields include:
  * `violationId` – unique identifier generated at classification time.
  * `ruleName` – the name of the semantic rule that fired.
  * `severity` – value drawn from the configuration (e.g., *high*, *medium*, *low*).
  * `category` – logical grouping also supplied by configuration.
  * `message` – a formatted, user‑friendly description.
  * `timestamp` – when the violation was detected.

* **Error Handling** – if a rule identifier has no entry in the configuration, the classifier falls back to a default severity (likely *medium*) and marks the category as *unclassified*. This defensive behaviour ensures the pipeline never stalls because of missing configuration entries.

Because the code symbols are not listed, the implementation is inferred to be a **pure function** or lightweight class that does not maintain state beyond the configuration cache, making it easy to test in isolation.

---

## Integration Points  

1. **Upstream – SemanticConstraintDetector**  
   * **ViolationClassifier** receives its input directly from the detector’s output. The detector is documented in `semantic-constraint-detection.md` and `semantic-detection-design.md`, indicating that it emits raw detection objects. The classifier therefore depends on the detector’s *output contract* (e.g., a struct containing `ruleId`, `rawMessage`, and contextual metadata).

2. **Downstream – Dashboard & Persistence**  
   * The dashboard component (`dashboard/README.md`) consumes the classified violations to render severity‑based charts and category filters. The classifier must therefore serialize the DTO into a format the dashboard understands (likely JSON over an HTTP endpoint or a shared data store).  
   * Persistence layers (not explicitly described) are also downstream consumers; they store the violation records for audit and historical analysis. Because the classifier normalises the schema, the persistence implementation can rely on a stable table definition.

3. **Configuration Source**  
   * The classifier reads the constraint configuration files referenced in `constraint-configuration.md`. These files are the single source of truth for severity and category mappings, making the classifier’s behavior configurable at deployment time.

4. **Shared Utilities** – Any common utility libraries used for logging, ID generation, or timestamping are implicitly shared across the detection pipeline, though specific file paths are not listed.

Overall, **ViolationClassifier** sits at a clear **boundary interface**: it translates *internal detection artifacts* into *public violation artifacts* that other subsystems can safely consume without needing to understand the detection internals.

---

## Usage Guidelines  

* **Do not embed business rules in the classifier.** All severity and category decisions must be expressed in the configuration files described in `constraint-configuration.md`. Adding hard‑coded mappings will break the intended configurability and may cause divergence between the dashboard view and the actual policy.

* **Treat the classifier as a pure transformation step.** It should not retain mutable state beyond the configuration cache. This makes unit testing straightforward: feed a mock raw detection result and assert the resulting DTO matches the expected severity/category.

* **Validate configuration on startup.** Because the classifier falls back to defaults when a rule is missing, it is a best practice to run a validation pass that warns about unmapped rules. This prevents silent mis‑classifications in production.

* **Maintain schema compatibility with the dashboard.** If the dashboard evolves (e.g., adds a new field such as `sourceSystem`), update the DTO definition in the classifier and version the contract accordingly. The dashboard documentation (`dashboard/README.md`) should be consulted before any schema change.

* **Log classification decisions.** Including the rule identifier, resolved severity, and category in log entries aids troubleshooting when a violation appears unexpected in the UI.

---

### Architectural Patterns Identified
1. **Pipeline‑Boundary (Output Normalisation) Pattern** – isolates detection from downstream representation.  
2. **Configuration‑Driven Mapping** – severity and category are defined outside code, enabling runtime flexibility.

### Design Decisions and Trade‑offs
* **Separation of concerns** (detector vs. classifier) improves maintainability but adds an extra transformation step.  
* **Config‑driven severity** allows non‑developer policy changes but requires rigorous validation of configuration files.

### System Structure Insights
* **ViolationClassifier** is a child of **SemanticConstraintDetector**, acting as the final step before persistence and UI consumption.  
* It shares the same detection‑pipeline layer with its sibling **SemanticRuleEvaluator**, but focuses on output schema rather than rule logic.

### Scalability Considerations
* Because classification is a lightweight, stateless transformation, it scales horizontally with the detection pipeline.  
* The only potential bottleneck is the configuration lookup; caching the mapping in memory mitigates this.

### Maintainability Assessment
* High maintainability: clear contract, configuration‑driven, no embedded business logic.  
* Required discipline: keep configuration files in sync with rule definitions and ensure dashboard schema versioning is coordinated.


## Hierarchy Context

### Parent
- [SemanticConstraintDetector](./SemanticConstraintDetector.md) -- Documented in integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md and semantic-detection-design.md, indicating the detection logic is substantial enough to warrant both a user-facing doc and an internal design doc

### Siblings
- [SemanticRuleEvaluator](./SemanticRuleEvaluator.md) -- The existence of both a user-facing doc (integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md, titled 'Semantic Constraint Detection') and a separate internal design doc (integrations/mcp-constraint-monitor/docs/semantic-detection-design.md, titled 'Semantic Constraint Detection - Design Document') strongly implies that rule evaluation logic is architecturally complex enough to require distinct documentation for consumers and maintainers.


---

*Generated from 3 observations*
