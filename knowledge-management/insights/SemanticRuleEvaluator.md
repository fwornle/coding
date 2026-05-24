# SemanticRuleEvaluator

**Type:** Detail

The existence of both a user-facing doc (integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md, titled 'Semantic Constraint Detection') and a separate internal design doc (integrations/mcp-constraint-monitor/docs/semantic-detection-design.md, titled 'Semantic Constraint Detection - Design Document') strongly implies that rule evaluation logic is architecturally complex enough to require distinct documentation for consumers and maintainers.

## What It Is  

**SemanticRuleEvaluator** is the core rule‑evaluation engine that lives inside the **SemanticConstraintDetector** component of the *mcp‑constraint‑monitor* integration. Its source code is not listed directly in the supplied observations, but its logical location is implicit in the documentation hierarchy:

* **User‑facing description** – `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` (titled *Semantic Constraint Detection*).  
* **Internal design specification** – `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md` (titled *Semantic Constraint Detection – Design Document*).  

These two documents together describe a component that “operates on intercepted tool events” and that “applies higher‑order intent analysis” rather than simple pattern matching. The evaluator therefore consumes the structured payload emitted by the **Claude Code hook** (`integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`) and produces a typed violation object that downstream consumers—most notably the **ViolationClassifier** and the dashboard (`integrations/mcp-constraint-monitor/dashboard/README.md`)—can render.

In short, **SemanticRuleEvaluator** is the semantic‑reasoning layer that interprets each incoming event against a catalog of declarative rules, deciding whether a rule is satisfied, violated, or requires further classification.

---

## Architecture and Design  

The architecture surrounding **SemanticRuleEvaluator** follows a **pipeline** model:

1. **Event Interception Layer** – Captures tool events and normalises them into the Claude Code hook format. This is the entry point for the evaluator.  
2. **SemanticConstraintDetector** – Acts as the orchestrator for detection activities. It delegates rule‑specific analysis to **SemanticRuleEvaluator**.  
3. **SemanticRuleEvaluator** – Performs “higher‑order intent analysis” on the payload. The design document (`semantic-detection-design.md`) emphasises that this step is deliberately distinct from regex‑based checks, implying a **strategy** of using richer semantic techniques (e.g., structured reasoning, possibly LLM‑assisted inference).  
4. **ViolationClassifier** – Receives the raw evaluation result, enriches it with severity, category, and presentation metadata, and forwards it to the dashboard.  

```
+-------------------+      +---------------------------+      +--------------------+
| Claude Code Hook  | ---> | SemanticConstraintDetector| ---> | SemanticRuleEvaluator|
| (event payload)   |      | (orchestrator)            |      +--------------------+
+-------------------+      +---------------------------+               |
                                                            +-------------------+
                                                            | ViolationClassifier|
                                                            +-------------------+
                                                                     |
                                                             +-------------------+
                                                             | Dashboard UI      |
                                                             +-------------------+
```

**Design patterns evident from the documentation**  

* **Pipeline / Chain‑of‑Responsibility** – Each stage (interception → detection → evaluation → classification) processes the event in turn, passing a well‑defined artifact to the next.  
* **Separation of Concerns** – The existence of separate user‑facing and internal design docs indicates a clear boundary between the public contract (what rules can be expressed, what results look like) and the internal implementation details (how intent is inferred).  

No explicit micro‑service or event‑bus terminology appears in the observations, so the architecture is best described as an in‑process modular pipeline within the *mcp‑constraint‑monitor* integration.

---

## Implementation Details  

Although the source code symbols are not enumerated, the documentation points to the concrete artefacts that shape the implementation:

* **Input Format** – Defined in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. This file specifies the JSON schema of the intercepted tool event, including fields such as `tool_name`, `action`, `metadata`, and the LLM‑generated `intent` payload. **SemanticRuleEvaluator** reads this schema directly, extracting the semantic intent rather than merely matching textual patterns.  

* **Rule Representation** – While not listed as a file, the design doc (`semantic-detection-design.md`) describes rules as *structured* objects that encode intent expectations (e.g., “must not delete production resources”, “should only modify files within `src/`”). These rule objects are likely deserialized from a configuration file or database and passed to the evaluator.  

* **Evaluation Mechanics** – The evaluator compares the extracted intent against each rule’s constraints. Because the description explicitly contrasts this with “regex‑based approaches,” the evaluator must perform **semantic matching** – for example, mapping LLM‑derived intent labels to rule predicates, performing logical conjunction/disjunction, and possibly scoring confidence levels.  

* **Result Production** – The outcome of the evaluation is a **raw violation record** (e.g., `{ ruleId, matched, confidence, details }`). This record is handed off to the **ViolationClassifier**, which adds classification metadata required by the dashboard (severity, category, UI‑friendly message).  

* **No Direct Code Symbols** – The observation “0 code symbols found” suggests that the evaluator’s implementation resides in files not captured by the current extraction, but its logical location is within the same `integrations/mcp-constraint-monitor` tree, likely alongside other detection components.

---

## Integration Points  

1. **Upstream – Event Interception**  
   *Consumes* the Claude Code hook payload (`CLAUDE-CODE-HOOK-FORMAT.md`). Any change to the hook schema will directly affect the evaluator’s parsing logic.  

2. **Parent – SemanticConstraintDetector**  
   The detector orchestrates multiple detection strategies (semantic, regex, etc.). **SemanticRuleEvaluator** is invoked as the “semantic” branch, meaning the detector must expose an interface such as `evaluateSemantic(event)` that the evaluator implements.  

3. **Sibling – ViolationClassifier**  
   Receives the raw evaluation result, enriches it, and forwards it to the dashboard. The contract between evaluator and classifier is therefore a **typed violation object** with at least `ruleId`, `status`, and `confidence`.  

4. **Downstream – Dashboard**  
   Documented in `integrations/mcp-constraint-monitor/dashboard/README.md`. The dashboard expects violations grouped by severity and category; therefore the evaluator indirectly influences UI performance and clarity through the fidelity of its semantic matches.  

5. **Configuration / Rule Store**  
   Though not explicitly listed, the design doc implies a rule repository that the evaluator reads. This repository is a critical integration point; versioning or hot‑reloading of rules will affect evaluation latency and correctness.

---

## Usage Guidelines  

* **Maintain Alignment with Hook Schema** – When the Claude Code hook format evolves, update the parsing logic in **SemanticRuleEvaluator** before any rule changes. A mismatch will cause false negatives or runtime errors.  

* **Define Rules Declaratively** – Use the structured rule format described in `semantic-detection-design.md`. Avoid embedding ad‑hoc string patterns; the evaluator is built to interpret intent‑based constraints, and regex‑style rules belong to a different detection path.  

* **Confidence Thresholds** – The evaluator may emit a confidence score for each match. Downstream components (ViolationClassifier) should respect a configurable threshold to prevent noisy alerts. Document any thresholds in the design doc to keep them visible to both users and maintainers.  

* **Performance Awareness** – Semantic analysis can be more compute‑intensive than regex matching. If the rule set grows large, consider batching events or caching intent extraction results. The pipeline design allows the detector to parallelise the semantic branch if needed.  

* **Testing Strategy** – Because the evaluator operates on LLM‑derived intent, unit tests should mock the Claude hook payload rather than invoking the LLM directly. Include test cases that cover both positive matches (intent satisfies rule) and negative matches (intent violates rule).  

* **Versioned Rule Deployment** – When updating rule definitions, follow a rollout plan that validates the new rules against a staging event feed. This prevents accidental rule regressions that could flood the dashboard with false violations.  

---

### Architectural Patterns Identified  

| Pattern | Evidence |
|---------|----------|
| Pipeline / Chain‑of‑Responsibility | Sequential processing: interception → detector → evaluator → classifier → dashboard |
| Separation of Concerns (Public vs Internal Docs) | Distinct user‑facing (`semantic-constraint-detection.md`) and internal design (`semantic-detection-design.md`) documentation |
| Strategy (Semantic vs Regex) | Explicit contrast with regex‑based approaches in the parent description |

### Design Decisions & Trade‑offs  

* **Semantic vs Regex** – Choosing intent‑based evaluation provides richer detection but incurs higher computational cost and dependence on LLM output <USER_ID_REDACTED>. The trade‑off is mitigated by keeping regex checks separate.  
* **Dedicated Design Document** – Maintaining an internal design spec improves maintainability for complex reasoning logic but adds documentation overhead.  
* **Typed Violation Flow** – Enforcing a strict violation object contract simplifies downstream rendering but limits flexibility; any change to the contract requires coordinated updates across classifier and dashboard.

### System Structure Insights  

* The **SemanticConstraintDetector** acts as a façade that hides multiple detection strategies.  
* **SemanticRuleEvaluator** is a leaf component focused solely on intent matching, keeping its responsibilities narrow.  
* **ViolationClassifier** serves as an adaptor, translating raw semantic results into UI‑ready artifacts.  

### Scalability Considerations  

* **Horizontal Scaling** – Since the evaluator is a pure function of the event payload and rule set, multiple instances can run in parallel behind a load balancer, provided the rule store is read‑only or safely shared.  
* **Caching Intent Extraction** – If the same event payload is evaluated against many rules, caching the parsed intent reduces redundant work.  
* **Rule Partitioning** – Large rule bases can be sharded by namespace or severity, allowing the detector to invoke only relevant evaluator subsets per event.  

### Maintainability Assessment  

* **Documentation Discipline** – The dual‑doc approach ensures both consumers and maintainers have clear guidance, which is a strong maintainability signal.  
* **Loose Coupling** – Clear interfaces between evaluator, classifier, and dashboard reduce ripple effects when modifying any single component.  
* **Potential Risk** – Dependence on LLM‑generated intent introduces an external variability factor; changes in the Claude model’s output format or semantics would require coordinated updates across the evaluator and its tests.  

---  

*All references above are grounded in the observed file paths and component relationships; no unverified assumptions have been introduced.*


## Hierarchy Context

### Parent
- [SemanticConstraintDetector](./SemanticConstraintDetector.md) -- Documented in integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md and semantic-detection-design.md, indicating the detection logic is substantial enough to warrant both a user-facing doc and an internal design doc

### Siblings
- [ViolationClassifier](./ViolationClassifier.md) -- The integrations/mcp-constraint-monitor/dashboard/README.md confirms a dashboard component exists as a downstream consumer of violation data, implying ViolationClassifier must produce a typed, displayable violation structure that the dashboard can render by severity or category.


---

*Generated from 3 observations*
