# SemanticConstraintDetector

**Type:** SubComponent

Documented in integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md and semantic-detection-design.md, indicating the detection logic is substantial enough to warrant both a user-facing doc and an internal design doc

# SemanticConstraintDetector — Technical Insight Document

## What It Is

The `SemanticConstraintDetector` is a SubComponent of the broader `ConstraintSystem`, implemented within the `integrations/mcp-constraint-monitor/` integration. Its documentation lives in two complementary files: `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` (the user-facing reference) and `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md` (the internal design document). The presence of both documents signals that this detector is not a thin wrapper over regex matching — it represents a deliberate architectural investment in meaning-aware constraint evaluation that warrants both consumer documentation and maintainer-oriented design rationale.

Functionally, the detector is responsible for evaluating code actions and file operations against semantic rules — constraints that depend on the *meaning* of code rather than its surface text. It complements the simpler pattern-matching path inside `ConstraintSystem` by handling cases where regex or string-equality checks would produce too many false positives (or miss too many violations). The component is co-located with `constraint-configuration.md` under `integrations/mcp-constraint-monitor/docs/`, indicating that its semantic rules are authored and configured alongside the standard constraint definitions consumed by the rest of the monitor.

![SemanticConstraintDetector — Architecture](images/semantic-constraint-detector-architecture.png)

Within the entity hierarchy, the detector owns two child SubComponents: `SemanticRuleEvaluator`, which executes the actual rule logic against incoming events, and `ViolationClassifier`, which categorizes and shapes detected violations into a structured form suitable for downstream consumers such as the `ConstraintMonitorDashboard`.

## Architecture and Design

The architectural pivot evident from `semantic-detection-design.md` is the separation of **semantic detection** from **pattern-based detection**. This implies a *layered violation-checking pipeline* inside `ConstraintSystem`: cheaper, deterministic pattern checks run first, with semantic evaluation reserved for rules that genuinely require interpretation. This is a classic layered-filter pattern — fast pre-filters reduce the load on the expensive semantic stage, which likely involves LLM-based or AST-based analysis given that a dedicated design document was warranted rather than inline implementation notes.

The detector is integrated into the same hook-based architecture documented in `integrations/mcp-constraint-monitor/README.md`. That means semantic checks are not invoked through a separate API surface; instead, they are triggered as part of the unified pre-tool/post-tool hook interception flow that the parent `ConstraintSystem` manages. Hook events arrive via `HookEventRouter` (whose envelope format is captured in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`), are matched against configurations resolved by `HookConfigurationLoader` (which merges user-level `~/.coding-tools/hooks.json` with project-level `.coding/hooks.json`), and — when semantic rules apply — are dispatched into `SemanticConstraintDetector`.

Internally, the detector decomposes responsibility across its two children. `SemanticRuleEvaluator` carries the heavy logic of interpreting a rule and an action together; the fact that it deserves its own user-facing and design-level documentation suggests its evaluation strategy is non-trivial and likely pluggable across analysis backends. `ViolationClassifier` operates as a downstream stage that converts raw evaluator output into a typed violation structure — one that the `ConstraintMonitorDashboard` (a self-contained UI sub-project at `integrations/mcp-constraint-monitor/dashboard/`) can render by severity or category.

## Implementation Details

The detector is structured as a small internal pipeline: incoming hook event → `SemanticRuleEvaluator` → `ViolationClassifier` → emitted violation record. `SemanticRuleEvaluator` is the analytical core. Because the design document treats semantic detection as architecturally distinct from pattern matching, the evaluator is the natural home for any AST traversal, semantic embedding lookup, or LLM-mediated reasoning that the system performs. Its dual documentation (`semantic-constraint-detection.md` for consumers, `semantic-detection-design.md` for maintainers) reinforces that the evaluator's contract — what it accepts, what semantic primitives it supports, what guarantees it makes — is stable enough to publish externally while the internals remain free to evolve.

`ViolationClassifier` complements the evaluator by transforming raw detection outputs into a structured, displayable form. The `integrations/mcp-constraint-monitor/dashboard/README.md` confirms that a dashboard exists as a downstream consumer, which constrains the classifier's output: violations must be typed and carry enough metadata (severity, category, originating rule) for the dashboard to group and present them. This separation of "did we detect a problem?" from "how should the problem be categorized?" keeps the evaluator focused on truth-finding and the classifier focused on presentation semantics.

![SemanticConstraintDetector — Relationship](images/semantic-constraint-detector-relationship.png)

Configuration is unified with the rest of the constraint system: semantic rules are authored alongside conventional constraints in the same configuration surface described by `constraint-configuration.md`. This means developers do not invoke a separate API to enable semantic checks — they declare rules, and the detector picks up the ones whose evaluation mode requires semantic analysis. Concrete code-symbol enumeration is not available in the current observation set, so implementation specifics below the documentation layer (exact class signatures, file names) should be confirmed against the source under `integrations/mcp-constraint-monitor/`.

## Integration Points

The detector's primary upstream integration is with the hook interception flow of `ConstraintSystem`. As described in `integrations/mcp-constraint-monitor/README.md`, Claude Code's native hook events (pre-tool, post-tool, startup, shutdown) are routed through a unified hook manager; `SemanticConstraintDetector` is invoked as one of the validators in that flow. This makes its input contract effectively the Claude Code hook event envelope defined in `CLAUDE-CODE-HOOK-FORMAT.md` and parsed by the sibling `HookEventRouter`.

On the configuration side, the detector depends on rules loaded by `HookConfigurationLoader`, which establishes a clear precedence between user-level (`~/.coding-tools/hooks.json`) and project-level (`.coding/hooks.json`) sources. Semantic rules participate in this same two-level merge, so a project can extend or override globally configured semantic constraints without bypassing the detector.

Downstream, the detector feeds violation records into the persistence layer that the parent `ConstraintSystem` exposes for dashboard display. The `ConstraintMonitorDashboard` consumes this stream — its existence as a self-contained UI under `integrations/mcp-constraint-monitor/dashboard/` is what makes `ViolationClassifier`'s typed-output contract necessary in the first place. Internally, the detector composes its two children: `SemanticRuleEvaluator` provides the analytical capability, and `ViolationClassifier` provides the output normalization, with the detector itself orchestrating their interaction.

## Usage Guidelines

When authoring new constraints, developers should first ask whether a rule can be expressed as a pattern; if so, it belongs in the pattern-based path of `ConstraintSystem` rather than as a semantic rule. Semantic rules are more expressive but also more expensive to evaluate, and the layered design implied by `semantic-detection-design.md` is built on the assumption that semantic detection is the exception rather than the default. Use it for rules whose intent cannot be captured by literal text matching — for example, constraints that depend on code structure, type relationships, or contextual meaning.

Rules should be declared in the same configuration surface documented by `constraint-configuration.md`, taking advantage of the two-level loading model: cross-project defaults belong in `~/.coding-tools/hooks.json`, while project-specific semantic rules belong in `.coding/hooks.json`. When adding a new semantic rule type, consult `semantic-detection-design.md` for the evaluator's extension contract before modifying `SemanticRuleEvaluator`, and ensure any new violation shape is reflected in `ViolationClassifier` so the dashboard can render it correctly.

Finally, because the detector runs inside the hook interception flow, its evaluation latency is on the critical path for Claude Code tool invocations. Rule authors should be mindful that expensive semantic checks affect interactive responsiveness; if the evaluator supports caching or precomputation, prefer rules that exploit those facilities. Treat `semantic-constraint-detection.md` as the authoritative user-facing reference for what the detector can express, and `semantic-detection-design.md` as the source of truth for how it expresses it internally.

## Summary of Key Insights

1. **Architectural patterns**: Layered violation-checking pipeline (pattern-based pre-filter → semantic evaluator → violation classifier), hook-based interception inherited from `ConstraintSystem`, and a clear evaluator/classifier separation among child components.
2. **Design decisions and trade-offs**: Explicit split between semantic and pattern detection trades implementation complexity for expressive power; dual documentation (consumer + design) trades doc maintenance overhead for clearer API stability; unified configuration with standard constraints trades a narrower semantic-only surface for authoring consistency.
3. **System structure**: The detector is a mid-tier SubComponent — child of `ConstraintSystem`, parent of `SemanticRuleEvaluator` and `ViolationClassifier` — and a peer-in-flow to `HookEventRouter` and `HookConfigurationLoader`.
4. **Scalability considerations**: Semantic evaluation is inherently more expensive than pattern matching, and because it executes inside the pre/post-tool hook path, the layered design (cheap checks first) is essential to keep tool-invocation latency acceptable as the rule set grows.
5. **Maintainability assessment**: Strong — the separation into `SemanticRuleEvaluator` and `ViolationClassifier`, the existence of a dedicated design document, and the co-located configuration documentation all indicate the component was designed for ongoing evolution rather than as a one-off feature.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a constraint monitoring and enforcement subsystem that validates code actions and file operations against configured rules during Claude Code sessions. It operates through a hook-based architecture where Claude Code's native hook events (pre-tool, post-tool, startup, shutdown, etc.) are intercepted and routed through a unified hook manager that loads configuration from both user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json) sources. The system captures violations in real time, persists them for dashboard display, and supports semantic constraint detection beyond simple pattern matching.

### Children
- [SemanticRuleEvaluator](./SemanticRuleEvaluator.md) -- The existence of both a user-facing doc (integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md, titled 'Semantic Constraint Detection') and a separate internal design doc (integrations/mcp-constraint-monitor/docs/semantic-detection-design.md, titled 'Semantic Constraint Detection - Design Document') strongly implies that rule evaluation logic is architecturally complex enough to require distinct documentation for consumers and maintainers.
- [ViolationClassifier](./ViolationClassifier.md) -- The integrations/mcp-constraint-monitor/dashboard/README.md confirms a dashboard component exists as a downstream consumer of violation data, implying ViolationClassifier must produce a typed, displayable violation structure that the dashboard can render by severity or category.

### Siblings
- [ConstraintMonitorDashboard](./ConstraintMonitorDashboard.md) -- Lives in integrations/mcp-constraint-monitor/dashboard/ with its own README.md, indicating it is a self-contained UI sub-project within the broader mcp-constraint-monitor integration
- [HookConfigurationLoader](./HookConfigurationLoader.md) -- The two-level configuration model (user-level and project-level hooks.json) is documented in integrations/mcp-constraint-monitor/README.md, establishing a clear precedence/merge strategy between global and per-project rules
- [HookEventRouter](./HookEventRouter.md) -- Claude Code hook data format is documented in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md, defining the event envelope the router must parse for each hook type


---

*Generated from 5 observations*
