# ConversationLevelInference

**Type:** Detail

A companion document integrations/mcp-constraint-monitor/docs/semantic-detection-design.md ('Semantic Constraint Detection - Design Document') exists alongside the operational doc, indicating this inference approach was treated as a significant enough architectural choice to warrant a dedicated design rationale — a new developer should consult both files to understand the intent behind the conversation-scope design.

# ConversationLevelInference

## What It Is

`ConversationLevelInference` is a sub-component of `SemanticConstraintDetector` whose architectural definition is documented across two files in the `integrations/mcp-constraint-monitor/docs/` directory: the operational specification in `semantic-constraint-detection.md` and the rationale in `semantic-detection-design.md`. As stated in `semantic-constraint-detection.md`, the detector "operates at conversation-level inference, meaning it analyzes intent and meaning across message context rather than matching surface-level text patterns." This single sentence captures the defining architectural decision of the sub-component: it is the inference scope and strategy that the parent detector uses to evaluate constraints.

Rather than being a discrete class with a narrow API, `ConversationLevelInference` represents a *mode of operation* — a commitment that the constraint detection logic reasons about intent and meaning aggregated over multiple messages, not over individual strings in isolation. It is the semantic boundary that defines how much context the detector must hold when making a decision.

Because the source observations report 0 code symbols and no key files beyond the two documentation artifacts, the entity is currently best understood as a documented architectural contract enforced by `SemanticConstraintDetector` rather than as a standalone code artifact.

## Architecture and Design

The architectural posture of `ConversationLevelInference` is a deliberate rejection of surface-level pattern matching. This is significant: it positions the parent `SemanticConstraintDetector` away from regex- or keyword-based filtering and toward a model-driven, context-aware analysis pipeline. The implication, drawn directly from the observation that prior message context must inform each evaluation, is that the detector cannot be a stateless per-message filter. It is either stateful (maintaining conversation history internally) or context-window-dependent (receiving the assembled conversation each time it is invoked).

The decision to formalize this approach with both an operational document (`semantic-constraint-detection.md`) and a dedicated design document (`semantic-detection-design.md`) signals that the conversation-scope choice was treated as a first-class architectural decision rather than an implementation detail. New developers approaching the parent `SemanticConstraintDetector` are expected to consult both files to understand not just *what* the detector does but *why* it operates at this scope.

The design pattern at play is closest to a **Context-Aware Evaluator**: an interpreter that takes a window of conversational state and produces a semantic judgment, as opposed to a **Pattern Matcher** that produces a verdict from a single string. This choice trades simplicity and statelessness for fidelity of judgment.

## Implementation Details

The observations contain no enumerable code symbols, classes, or functions for `ConversationLevelInference` itself — its implementation is encapsulated within its parent `SemanticConstraintDetector`. What the observations *do* establish about implementation mechanics is the following:

1. **Input shape**: The detector must accept (or have access to) more than the current message. The conversation history, or a sliding window thereof, is part of its working input.
2. **Evaluation target**: The detector reasons about *intent and meaning*, language that strongly implies an LLM- or embedding-based inference step rather than deterministic string operations.
3. **Output semantics**: Constraint violations or compliance are determined by the aggregate semantic trajectory of the conversation, not by any single token sequence.

The absence of code symbols means the inference machinery itself (model calls, prompt construction, context-window management, history truncation strategy) lives behind the `SemanticConstraintDetector` abstraction and is not separately exposed. Developers extending this component should treat the two documentation files as the authoritative specification until corresponding code is surfaced.

## Integration Points

The primary integration point is the containment relationship: `SemanticConstraintDetector` contains `ConversationLevelInference`. This means any caller of the parent detector implicitly invokes conversation-level inference — there is no documented alternative inference mode in the observations. Callers of the detector must therefore be prepared to supply, or otherwise make available, sufficient conversational context.

The component lives within the `integrations/mcp-constraint-monitor/` subsystem, indicating that it is part of an MCP (Model Context Protocol) integration responsible for monitoring constraints during model interactions. This situates `ConversationLevelInference` at the junction between the MCP message stream (which naturally provides multi-turn context) and the constraint evaluation layer (which consumes that context to render judgments).

Beyond the parent `SemanticConstraintDetector` and the two documentation files, the observations identify no further dependencies, sibling components, or downstream consumers. The integration surface, as currently documented, is narrow and well-defined.

## Usage Guidelines

Developers working with `ConversationLevelInference` — necessarily by working through its parent `SemanticConstraintDetector` — should observe the following conventions grounded in the documented design:

- **Do not bypass the conversation-scope contract.** Resist the temptation to add fast-path regex or keyword filters in front of the detector. The deliberate rejection of surface-level pattern matching is the central architectural commitment; introducing surface-level shortcuts undermines the semantic fidelity the component is designed to provide.
- **Supply adequate context.** Because the detector is context-window-dependent, calling it with truncated or single-message input degrades its accuracy. Callers should preserve and pass the prior message history as much as the system's context window allows.
- **Consult both documentation files before modifying behavior.** The operational `semantic-constraint-detection.md` describes *what* the detector does; the companion `semantic-detection-design.md` explains *why*. Changes that violate the design rationale should be discussed before being implemented.
- **Treat statefulness as an explicit concern.** Whether history is held internally or passed in externally, any change to lifecycle, caching, or windowing of conversation context has direct correctness implications for the detector's judgments.

### Summary Assessment

- **Architectural patterns identified**: Context-Aware Evaluator over stateless Pattern Matcher; documentation-as-specification given the absence of exposed code symbols.
- **Design decisions and trade-offs**: Conversation-level scope chosen over per-message scope, trading statelessness and simplicity for semantic accuracy and intent recognition.
- **System structure insights**: A thin conceptual sub-component fully encapsulated by `SemanticConstraintDetector` within the `integrations/mcp-constraint-monitor/` subsystem.
- **Scalability considerations**: Conversation-window dependence means cost and latency scale with history size; truncation and windowing policies (not documented in the observations) are the natural levers.
- **Maintainability assessment**: Maintainability is currently anchored in documentation rather than code. The pairing of an operational doc with a design-rationale doc is a positive signal, but the absence of enumerable code symbols means changes to inference behavior are likely to require navigating the parent detector's internals directly.


## Hierarchy Context

### Parent
- [SemanticConstraintDetector](./SemanticConstraintDetector.md) -- According to integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md, the detector operates at conversation-level inference, meaning it analyzes intent and meaning across message context rather than matching surface-level text patterns.


---

*Generated from 3 observations*
