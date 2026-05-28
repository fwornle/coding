# PatternConstraintEvaluator

**Type:** Detail

The separation of constraint-configuration.md (pattern rules) from semantic-constraint-detection.md (semantic rules) in the documentation structure reflects an architectural split between two distinct evaluator strategies within the ConstraintRuleEngine.

# PatternConstraintEvaluator — Technical Insight Document

## What It Is

`PatternConstraintEvaluator` is a rule evaluation component housed within the `ConstraintRuleEngine`, located in the `integrations/mcp-constraint-monitor` integration. It operates as the **pattern-based evaluation strategy** responsible for matching incoming tool invocations against explicitly defined constraint rules. Its rule source is `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`, which defines the structure and syntax of constraints. Its input data contract — the shape of the hook payload it receives — is formally documented in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`.

The evaluator sits at the intersection of two documents that together define its complete operational contract: one describes *what it matches against* (constraint configuration), and the other describes *what it receives as input* (hook payload schema). This clean separation of concerns is deliberate and architecturally significant.

---

## Architecture and Design

### Dual-Strategy Evaluation Within ConstraintRuleEngine

The most important architectural insight here is that `ConstraintRuleEngine` employs **two distinct evaluation strategies**, each encapsulated in its own evaluator:

| Evaluator | Strategy | Rule Source Document |
|---|---|---|
| `PatternConstraintEvaluator` | Literal / structural pattern matching | `constraint-configuration.md` |
| `SemanticConstraintEvaluator` | Meaning-aware semantic matching | `semantic-constraint-detection.md` |

The documentation structure itself encodes this architectural split. The fact that pattern rules and semantic rules live in *separate documentation files* is not merely organizational hygiene — it reflects a hard architectural boundary between two fundamentally different matching philosophies within the same parent engine.

```
ConstraintRuleEngine
├── PatternConstraintEvaluator   ← constraint-configuration.md (rules)
│                                ← CLAUDE-CODE-HOOK-FORMAT.md (input schema)
└── SemanticConstraintEvaluator  ← semantic-constraint-detection.md (rules + strategy)
```

### Pattern-Based Matching Philosophy

`PatternConstraintEvaluator` operates on **literal, structural rule comparison** — the classic approach where a constraint is defined as an explicit pattern (e.g., tool name, parameter shape, value range) and a hook payload either matches or does not match based on direct structural evaluation. This is distinct from what `SemanticConstraintEvaluator` does: the sibling evaluator uses meaning-aware matching, which implies tolerance for paraphrase, intent inference, or embedding-based similarity.

The design trade-off is deliberate:

- **Pattern evaluation is deterministic and auditable.** A developer can read `constraint-configuration.md` and predict exactly which tool invocations will be flagged.
- **Semantic evaluation is flexible but less predictable.** It handles cases where the literal structure of a request doesn't reveal its intent.

By separating these into two evaluators rather than a single hybrid, the architecture keeps each strategy independently testable, configurable, and replaceable.

---

## Implementation Details

### Input: The Hook Payload

The evaluator's input is governed by `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`. This document defines the data contract — the precise schema of the payload that arrives when a Claude Code hook fires. Every field the `PatternConstraintEvaluator` inspects during rule matching must exist within this schema. This means the hook format document is effectively a **stability contract**: changes to the hook payload schema have direct consequences for which constraint patterns can be expressed and evaluated.

### Rules: Constraint Configuration

The evaluator's rule definitions live in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. This document defines:

- How constraints are structured (fields, operators, values)
- What aspects of a tool invocation can be constrained (tool name, parameters, etc.)
- The rule syntax that the evaluator's matching logic interprets

The relationship between the configuration document and the hook format document is tightly coupled by design: a constraint rule can only reference fields that exist in the hook payload. Any expansion of matchable constraint dimensions requires coordinated changes to both documents.

### No Discovered Code Symbols

It is worth noting that no concrete code symbols (class definitions, function signatures) were surfaced in the observations. The current understanding of `PatternConstraintEvaluator` is derived entirely from documentation and architectural inference. This suggests either that the implementation is not yet written (documentation-first design), or that the codebase was not traversed at the symbol level during analysis.

---

## Integration Points

### Parent: ConstraintRuleEngine

`PatternConstraintEvaluator` is contained by and invoked from `ConstraintRuleEngine`. The engine acts as the orchestrator that decides when to invoke pattern evaluation versus semantic evaluation. It is reasonable to infer that the engine routes a given hook payload to one or both evaluators and aggregates their verdicts, though the exact routing logic is not documented in the available observations.

### Sibling: SemanticConstraintEvaluator

The relationship with `SemanticConstraintEvaluator` is architecturally complementary. Where `PatternConstraintEvaluator` enforces rules that can be expressed as explicit structural patterns, `SemanticConstraintEvaluator` (documented in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`) handles constraint violations that require understanding *meaning* rather than structure. Developers authoring constraint rules must decide which evaluator is the right vehicle for a given constraint — a decision that has implications for rule expressiveness, false-positive rates, and auditability.

### Hook Integration Layer

The hook integration layer (governed by `CLAUDE-CODE-HOOK-FORMAT.md`) is the upstream producer of the payloads this evaluator consumes. The evaluator has no influence over what data arrives — it can only operate on what the hook format exposes. This makes `CLAUDE-CODE-HOOK-FORMAT.md` a **hard dependency boundary**: the evaluator's capabilities are bounded by the richness of the hook payload schema.

---

## Usage Guidelines

### Authoring Pattern Constraints

When writing constraints intended for `PatternConstraintEvaluator`, authors should work from `constraint-configuration.md` as the authoritative rule syntax reference, and cross-reference `CLAUDE-CODE-HOOK-FORMAT.md` to ensure that every field referenced in a rule actually exists in the hook payload. Constraints that reference non-existent payload fields will silently fail to match or produce errors depending on the evaluator's error handling posture.

### Choosing Pattern vs. Semantic Evaluation

The key decision for constraint authors is whether a violation is **structurally detectable** or **semantically detectable**. If a constraint can be expressed as "tool name equals X" or "parameter Y exceeds value Z," it belongs in pattern configuration. If the constraint requires reasoning about intent — e.g., "this invocation is attempting to exfiltrate data even though it uses a permitted tool" — it belongs in the semantic layer managed by `SemanticConstraintEvaluator`.

### Stability and Change Management

Because `PatternConstraintEvaluator` is sandwiched between two external contracts (`CLAUDE-CODE-HOOK-FORMAT.md` on input, `constraint-configuration.md` on rules), changes to either document have cascading effects. Teams should treat both documents as **versioned interfaces** and coordinate constraint rule migrations when the hook format evolves.

---

## Architectural Patterns Identified

- **Strategy Pattern**: `ConstraintRuleEngine` delegates evaluation to interchangeable evaluator strategies (`PatternConstraintEvaluator`, `SemanticConstraintEvaluator`), each implementing a distinct matching algorithm.
- **Data Contract Separation**: Input schema (`CLAUDE-CODE-HOOK-FORMAT.md`) and rule schema (`constraint-configuration.md`) are maintained as separate artifacts, preventing conflation of "what we receive" with "what we check."
- **Documentation-Driven Architecture**: The architectural split between evaluators is encoded in — and can be read from — the documentation structure itself, suggesting a documentation-first or documentation-parallel development approach.

## Design Decisions and Trade-offs

| Decision | Trade-off |
|---|---|
| Separate pattern and semantic evaluators | Clarity and testability vs. potential redundant payload parsing |
| Pattern rules in external config doc | Auditability and no-code rule authoring vs. coupling to doc format |
| Hook format as input contract | Clean boundary vs. evaluator capability limited by hook schema richness |

## Maintainability Assessment

The architecture is **well-structured for maintainability** given its clear separation of concerns and externalized rule configuration. The primary maintainability risk is the **implicit coupling** between `CLAUDE-CODE-HOOK-FORMAT.md` and `constraint-configuration.md` — changes to one may silently invalidate rules in the other without a formal versioning or validation mechanism. Establishing a schema validation step that cross-references hook payload fields against constraint rule field references would significantly reduce this risk.


## Hierarchy Context

### Parent
- [ConstraintRuleEngine](./ConstraintRuleEngine.md) -- integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md describes a semantic layer for detecting constraint violations that uses meaning-aware matching rather than literal rule comparison

### Siblings
- [SemanticConstraintEvaluator](./SemanticConstraintEvaluator.md) -- integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md describes a semantic layer that uses meaning-aware matching rather than literal rule comparison, distinguishing it architecturally from pattern-based evaluation.


---

*Generated from 3 observations*
