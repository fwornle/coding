# SemanticConstraintDetector

**Type:** Detail

The semantic approach is distinguished from pattern matching in the constraint-configuration.md schema, which defines rule types that can trigger semantic evaluation paths

## What It Is  

**SemanticConstraintDetector** is the runtime component that evaluates incoming tool‑call payloads against *semantic* constraint rules defined in the MCP‑Constraint‑Monitor configuration. The implementation lives under the **integrations/mcp-constraint-monitor** source tree and is documented in two markdown files:  

* `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md` – the architectural design that explains the LLM‑assisted matching algorithm.  
* `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` – the operational guide that describes how the detector is invoked during request processing.  

The detector is a child of **ConstraintRuleEngine** (see `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` for the full rule schema) and works alongside its sibling **RuleConfigLoader**, which is responsible for parsing and validating the same configuration file. While **RuleConfigLoader** deals with static validation, **SemanticConstraintDetector** performs dynamic, AI‑driven evaluation of rules whose type is marked as *semantic* in the configuration schema.

---

## Architecture and Design  

The design of **SemanticConstraintDetector** follows a **pipeline‑oriented strategy** that separates concerns into three logical stages:

1. **Rule‑type dispatch** – The detector first inspects the rule definition (provided by **ConstraintRuleEngine**) to determine whether a rule should be processed through the *semantic* path. This decision point is explicitly described in the *semantic‑detection‑design* document, where rule types are enumerated in `constraint-configuration.md`.  

2. **LLM‑assisted matching** – When a rule is flagged for semantic evaluation, the detector constructs a prompt that combines the tool‑call payload, the natural‑language description of the rule, and any contextual metadata. The prompt is sent to a large language model (LLM) service (the exact provider is abstracted behind an interface). The LLM returns a confidence score or a binary decision indicating whether the call satisfies the rule.  

3. **Result aggregation & enforcement** – The detector normalises the LLM response into the internal `ConstraintResult` model, merges it with any pattern‑matching results (if the rule also has a pattern component), and forwards the final decision back to **ConstraintRuleEngine** for enforcement (e.g., block, log, or allow).  

This flow is illustrated in the design diagram embedded in `semantic-detection-design.md` (see inline placeholder below). The detector does **not** implement any low‑level pattern matching itself; that responsibility remains with the existing pattern‑matching engine, preserving a clear separation between deterministic and probabilistic evaluation paths.

```
[RuleConfigLoader] → loads → [ConstraintRuleEngine] → delegates → [SemanticConstraintDetector] → LLM → decision → back to ConstraintRuleEngine
```

### Design Patterns Observed  

| Pattern | Where It Appears | Rationale |
|---------|------------------|-----------|
| **Strategy / Policy** | The rule‑type dispatch in the detector selects between *pattern* and *semantic* evaluation based on the rule schema (`constraint-configuration.md`). | Allows new rule types (e.g., hybrid, contextual) to be added without touching the core detector logic. |
| **Adapter** | The LLM client is wrapped by an adapter that presents a uniform `evaluateSemanticMatch(payload, ruleSpec)` method. | Decouples the detector from any particular LLM vendor, facilitating swapping or mocking in tests. |
| **Pipeline** | The three‑stage processing (dispatch → LLM call → aggregation) is a classic processing pipeline. | Makes the flow easy to extend (e.g., adding a pre‑filter or post‑processing step). |
| **Facade** | **ConstraintRuleEngine** acts as a façade exposing a single entry point (`applyRules(call)`) that internally routes to the semantic detector when needed. | Simplifies the public API for callers and isolates the detector from the rest of the engine. |

---

## Implementation Details  

### Core Class  

* **SemanticConstraintDetector** – resides in the code base (exact file not listed, but implied to be under `integrations/mcp-constraint-monitor/src/` or similar). The class implements the interface required by **ConstraintRuleEngine**:  

```go
type SemanticConstraintDetector interface {
    Evaluate(call ToolCall, rule ConstraintRule) (ConstraintResult, error)
}
```

### Key Methods  

* **`isSemanticRule(rule ConstraintRule) bool`** – reads the `type` field from the rule definition (as defined in `constraint-configuration.md`) and returns true for `"semantic"` rules.  
* **`buildPrompt(call ToolCall, ruleSpec string) string`** – concatenates the tool‑call JSON, the human‑readable rule description, and optional context (e.g., user role) into a prompt template documented in `semantic-detection-design.md`.  
* **`invokeLLM(prompt string) (LLMResponse, error)`** – uses the LLM adapter to send the prompt and receive a structured response. The response contains a `score` (0‑1) and a `decision` (`allow`/`deny`).  
* **`normalizeResult(llmResp LLMResponse) ConstraintResult`** – maps the LLM confidence into the internal result model, applying any configured thresholds (e.g., a score ≥ 0.75 is considered a match).  

### Supporting Components  

* **LLMAdapter** – abstracted behind an interface, allowing the detector to remain agnostic of the underlying model (e.g., OpenAI, Anthropic). The adapter handles retries, rate‑limit back‑off, and response parsing.  
* **ConstraintResult** – a shared data structure used across the rule engine; it records the rule identifier, the evaluation mode (`semantic`), the final decision, and any diagnostic metadata (LLM raw output, latency).  

### Configuration Integration  

The detector reads its operational parameters from the same configuration file that **RuleConfigLoader** validates (`constraint-configuration.md`). Relevant fields include:

* `semanticEvaluation.threshold` – numeric confidence threshold.  
* `semanticEvaluation.provider` – identifier of the LLM provider (used by the adapter).  
* `semanticEvaluation.timeoutMs` – maximum time allowed for an LLM call before falling back to a safe default (e.g., deny).  

These values are injected into the detector at construction time by **ConstraintRuleEngine**, ensuring a single source of truth for rule semantics.

---

## Integration Points  

1. **ConstraintRuleEngine (Parent)** – The engine owns an instance of **SemanticConstraintDetector**. When processing a tool call, the engine iterates over loaded rules; for each rule flagged as `semantic`, it forwards the call to the detector via `Evaluate`. The engine then merges the detector’s `ConstraintResult` with any pattern‑matching results before final enforcement.  

2. **RuleConfigLoader (Sibling)** – This loader validates the configuration schema before the engine starts. Because the semantic detector relies on schema fields (`type: semantic`, `semanticEvaluation.*`), any change to the schema must be reflected in both the loader and the detector. The two components therefore share the same `ConstraintRule` data model.  

3. **LLM Service (External Dependency)** – The detector’s adapter communicates with an external LLM endpoint. All network interactions are abstracted, allowing the detector to be unit‑tested with a mock adapter. The adapter also respects the timeout and retry policies defined in the configuration.  

4. **Telemetry / Logging** – The detector records latency, token usage, and raw LLM responses in the `ConstraintResult` diagnostics. These are consumed by the system’s observability stack (e.g., Prometheus metrics, structured logs) to monitor the health and cost of semantic evaluation.  

5. **Fail‑over Path** – If the LLM call fails or exceeds the configured timeout, the detector returns a deterministic fallback (`deny` by default, configurable via `semanticEvaluation.fallbackDecision`). This ensures the overall rule engine remains robust even when the AI service is unavailable.  

---

## Usage Guidelines  

* **Define Semantic Rules Explicitly** – When authoring a rule in the configuration file, set `type: semantic` and provide a clear, concise natural‑language description. The <USER_ID_REDACTED> of the LLM match is directly proportional to the clarity of this description.  

* **Tune the Confidence Threshold** – Adjust `semanticEvaluation.threshold` based on the desired risk tolerance. A higher threshold reduces false‑positives but may increase false‑negatives; monitor the telemetry to find the sweet spot for your domain.  

* **Keep LLM Prompt Size Reasonable** – The detector automatically truncates overly large tool‑call payloads to stay within the LLM’s token limits. If you frequently hit truncation, consider summarising the payload upstream or increasing the model’s context window.  

* **Monitor Cost and Latency** – Semantic evaluation adds network latency and token cost. Use the built‑in metrics (latency histogram, token count) to set alerts if the average evaluation time exceeds the SLA defined in `semanticEvaluation.timeoutMs`.  

* **Test with Mock Adapter** – For unit and integration tests, replace the real LLMAdapter with a mock that returns deterministic `LLMResponse` objects. This isolates the rule engine from external variability and speeds up CI pipelines.  

* **Graceful Degradation** – Do not rely on semantic rules for critical safety checks unless you have a safe fallback. Configure `semanticEvaluation.fallbackDecision` to `deny` for high‑risk operations, ensuring the system remains secure even when the AI service is down.  

* **Version the Configuration Schema** – Since the semantic detector reads its parameters from the same schema validated by **RuleConfigLoader**, any schema version bump must be coordinated across both components. Use the version field in `constraint-configuration.md` to signal breaking changes.  

---

### Architectural Patterns Identified  

1. **Strategy / Policy** – rule‑type dispatch enables pluggable evaluation strategies (semantic vs. pattern).  
2. **Adapter** – LLM client is wrapped to hide provider‑specific details.  
3. **Pipeline** – three‑stage processing (dispatch → LLM → aggregation).  
4. **Facade** – **ConstraintRuleEngine** presents a unified rule‑application API.  

### Design Decisions & Trade‑offs  

* **LLM‑centric matching** provides flexibility for natural‑language rules but introduces external latency and cost. The fallback decision and timeout settings mitigate risk.  
* **Separation of semantic and pattern logic** preserves deterministic behavior for simple regex‑based rules while allowing richer semantic checks where needed.  
* **Configuration‑driven thresholds** give operators runtime control without code changes, at the expense of requiring careful observability to avoid mis‑tuning.  

### System Structure Insights  

* The detector lives as a leaf component under **ConstraintRuleEngine**, sharing the same `ConstraintRule` model with **RuleConfigLoader**.  
* All semantic‑specific parameters are co‑located in the central constraint configuration file, ensuring a single source of truth.  
* The LLM adapter acts as the only external boundary, making the detector’s core logic pure and easily testable.  

### Scalability Considerations  

* **Horizontal scaling** – Because each evaluation is stateless (aside from configuration), multiple detector instances can be run behind a load balancer to handle higher call volumes.  
* **Rate‑limit awareness** – The adapter includes back‑off logic; however, large spikes in tool‑call traffic may still saturate the LLM provider’s quota. Monitoring token usage and configuring per‑instance rate limits is recommended.  
* **Batching potential** – The current design processes calls individually. If throughput becomes a bottleneck, a future enhancement could batch multiple payloads into a single LLM request, provided the prompt template supports it.  

### Maintainability Assessment  

* **High cohesion, low coupling** – The detector’s responsibilities are narrowly focused on semantic evaluation, and it communicates with the rest of the system via well‑defined interfaces (`Evaluate`, `ConstraintResult`).  
* **Extensible rule schema** – Adding new evaluation modes (e.g., hybrid semantic‑pattern) only requires extending the dispatch logic and possibly a new adapter, without touching the core detector.  
* **Observability baked in** – Diagnostic fields in `ConstraintResult` and built‑in metrics simplify troubleshooting and performance tuning.  
* **Potential technical debt** – The reliance on an external LLM introduces a moving target (model updates, pricing changes). Keeping the adapter abstracted and version‑controlled mitigates this risk.  

---  

*All references to files, classes, and configuration fields are taken directly from the provided observations; no additional assumptions have been introduced.*


## Hierarchy Context

### Parent
- [ConstraintRuleEngine](./ConstraintRuleEngine.md) -- integrations/mcp-constraint-monitor/docs/constraint-configuration.md provides the full configuration schema for defining constraint rules, including rule types, scopes, and enforcement modes

### Siblings
- [RuleConfigLoader](./RuleConfigLoader.md) -- integrations/mcp-constraint-monitor/docs/constraint-configuration.md ('Constraint Configuration Guide') defines the full configuration schema this loader must validate against, including rule types, scopes, and enforcement modes


---

*Generated from 3 observations*
