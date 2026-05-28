# SemanticConstraintEvaluator

**Type:** Detail

The existence of both semantic-constraint-detection.md and semantic-detection-design.md implies a two-phase development: a design doc capturing intent and a separate operational doc describing the deployed behavior, indicating this component has non-trivial implementation complexity.

# SemanticConstraintEvaluator — Technical Reference

## What It Is

`SemanticConstraintEvaluator` is a component residing within the `ConstraintRuleEngine` subsystem, documented across two files in the `integrations/mcp-constraint-monitor/` integration layer:

- **`integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`** — the operational reference describing deployed behavior
- **`integrations/mcp-constraint-monitor/docs/semantic-detection-design.md`** — the design specification capturing architectural intent

Together, these documents describe an evaluator that detects constraint violations using **meaning-aware matching** rather than literal string or pattern comparison. This distinguishes it fundamentally from its sibling, `PatternConstraintEvaluator`, which operates on explicit structural rules sourced from `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. Where `PatternConstraintEvaluator` asks "does this invocation match this rule's structure?", `SemanticConstraintEvaluator` asks "does this invocation carry the meaning or intent that this constraint is designed to prevent?"

---

## Architecture and Design

The most significant architectural decision evident from the observations is the **deliberate separation of the semantic evaluation strategy from the core rule engine**. The existence of `semantic-detection-design.md` as a standalone design document — distinct from the operational `semantic-constraint-detection.md` — strongly implies that `SemanticConstraintEvaluator` was scoped and designed as an independently evolvable strategy, rather than being co-developed with `ConstraintRuleEngine` as a monolithic whole. This separation allows the semantic matching logic to be iterated on without destabilizing the broader rule evaluation pipeline.

Within `ConstraintRuleEngine`, `SemanticConstraintEvaluator` and `PatternConstraintEvaluator` represent two distinct evaluation strategies operating at different levels of abstraction. `PatternConstraintEvaluator` is structurally grounded — it derives its matching logic from the explicit constraint definitions in `constraint-configuration.md`. `SemanticConstraintEvaluator`, by contrast, operates at a meaning layer, suggesting it either supplements or post-processes the pattern-based evaluation, or handles constraint classes that are too semantically rich to be captured by configuration-driven rules alone.

The two-phase documentation structure (design doc + operational doc) is an architectural signal of **non-trivial implementation complexity**. Components that can be fully described in a single document rarely require this separation. The presence of both suggests there was meaningful divergence risk between intent and implementation — and that the team considered it important to preserve both the "why" and the "what" as separate knowledge artifacts.

---

## Implementation Details

The operational behavior is described in `semantic-constraint-detection.md` as a **semantic layer** — a term that explicitly positions this evaluator above the syntactic/structural layer where pattern matching operates. Meaning-aware matching implies the evaluator reasons about the *intent* or *semantic content* of tool invocations rather than their surface form, though the specific mechanism (embedding similarity, ontology lookup, LLM-assisted classification, or otherwise) is not resolvable from the available observations alone.

The design specification in `semantic-detection-design.md` captures the architectural intent for this semantic strategy, suggesting that the implementation was built to a deliberate design rather than evolving organically. This is consistent with the component's role: semantic evaluation is harder to get right incrementally, as changes to the matching strategy can produce non-obvious shifts in which invocations are flagged.

---

## Integration Points

`SemanticConstraintEvaluator` is contained within `ConstraintRuleEngine`, which serves as the orchestrating parent for constraint evaluation. The engine coordinates both evaluators, and `SemanticConstraintEvaluator` likely receives tool invocation data as input — the same class of input that `PatternConstraintEvaluator` receives from its configuration-driven pipeline.

The relationship with `PatternConstraintEvaluator` as a sibling is architecturally important. Since `PatternConstraintEvaluator` draws its rules from `constraint-configuration.md`, it handles the well-structured, explicitly enumerable constraint space. `SemanticConstraintEvaluator` is architecturally positioned to handle the residual space — constraints that are difficult to express as discrete patterns. This suggests the two evaluators may operate in a **complementary, non-overlapping** fashion within `ConstraintRuleEngine`, with routing or prioritization logic determining which evaluator is applied in a given context.

---

## Usage Guidelines

Developers working within `ConstraintRuleEngine` should treat `SemanticConstraintEvaluator` as a **high-complexity, independently evolvable component**. Changes to its matching strategy should be validated against `semantic-detection-design.md` to ensure alignment with original intent, and any behavioral updates should be reflected in `semantic-constraint-detection.md` to keep the operational documentation current.

Because semantic evaluation is meaning-based rather than configuration-driven, it does not share the same rule source as `PatternConstraintEvaluator`. Developers should not attempt to extend `SemanticConstraintEvaluator`'s behavior by modifying `constraint-configuration.md` — that file governs only the pattern-based sibling. Semantic evaluation strategy changes require direct engagement with the design documented in `semantic-detection-design.md`.

The two-document structure (`*-design.md` + `*-detection.md`) should be preserved as a convention for this component. If the semantic strategy is significantly revised, both documents should be updated in tandem — the design doc to capture the new intent, and the operational doc to describe the new deployed behavior.

---

## Architectural Patterns and Trade-offs Summary

| Dimension | Assessment |
|---|---|
| **Pattern** | Strategy pattern — semantic and pattern evaluators as swappable/composable strategies within `ConstraintRuleEngine` |
| **Key trade-off** | Semantic richness vs. interpretability — meaning-aware matching catches what patterns miss, but is harder to audit |
| **Separation of concern** | Design doc / operational doc split preserves intent vs. implementation distinction |
| **Scalability** | Independent evolution path is a scalability enabler for the semantic strategy; tight coupling to `ConstraintRuleEngine` is the boundary |
| **Maintainability** | Two-doc structure adds overhead but reduces risk of intent drift; requires discipline to keep both synchronized |


## Hierarchy Context

### Parent
- [ConstraintRuleEngine](./ConstraintRuleEngine.md) -- integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md describes a semantic layer for detecting constraint violations that uses meaning-aware matching rather than literal rule comparison

### Siblings
- [PatternConstraintEvaluator](./PatternConstraintEvaluator.md) -- integrations/mcp-constraint-monitor/docs/constraint-configuration.md serves as the rule source for this evaluator, defining the structure of constraints that get matched against tool invocations.


---

*Generated from 3 observations*
