# SemanticConstraintDetection

**Type:** Detail

The presence of a dedicated design document (`semantic-detection-design.md`) alongside the operational spec (`semantic-constraint-detection.md`) suggests semantic detection was a deliberate architectural choice, likely selected over simpler rule-based matching to handle implicit or context-dependent constraint violations.

# SemanticConstraintDetection

## What It Is

SemanticConstraintDetection is a subsystem within the broader `MCPConstraintMonitor` module, documented across two complementary specifications located at `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` and `integrations/mcp-constraint-monitor/docs/semantic-detection-design.md`. The dual-document structure — one operational guide and one design rationale — signals that this is a non-trivial component whose behavior cannot be fully captured by reference material alone, requiring separate articulation of the reasoning behind its architectural choices.

As a child component of `MCPConstraintMonitor`, SemanticConstraintDetection is responsible for evaluating whether incoming operations or content violate established constraints based on semantic meaning rather than surface-level pattern matching. This positions it as the analytical core of the constraint enforcement pipeline: while the parent monitor orchestrates the overall workflow, SemanticConstraintDetection performs the actual interpretive work of recognizing constraint violations that may be implicit, contextual, or expressed in varied forms.

The component operates within a documentation-rich ecosystem that includes its sibling `ClaudeCodeHookDataFormat` (specified in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`) and the externally managed constraint definitions in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. Together these define the input boundary, the rule corpus, and the detection logic respectively.

## Architecture and Design

The architectural posture of SemanticConstraintDetection reflects a deliberate choice of semantic analysis over simpler rule-based matching. The existence of `semantic-detection-design.md` as a dedicated design document — separate from the operational specification — strongly suggests that this choice was justified by the need to handle implicit or context-dependent constraint violations that purely lexical or regex-based approaches would miss. This is consistent with the broader purpose of `MCPConstraintMonitor`, which "monitors and enforces constraints" in a manner that presumably needs to be robust across varied expressions of the same underlying intent.

A key architectural decision evident from the observations is the **decoupling of detection logic from constraint definitions**. Constraint rules are managed externally in `constraint-configuration.md`, while detection mechanics live in their own documentation. This separation of concerns enables the system to be user-configurable: operators can modify, add, or remove constraints without touching the detection engine itself. This pattern is analogous to a rules-engine architecture where the inference logic and the rule base evolve independently.

The component also sits downstream of a well-defined ingestion boundary. Its sibling `ClaudeCodeHookDataFormat` establishes the payload schema that Claude Code emits when invoking the constraint monitor as a hook consumer. SemanticConstraintDetection therefore operates on a stable, contract-driven input, which simplifies its implementation by allowing it to assume a known data shape rather than handling arbitrary input formats. This contract-first approach across siblings indicates an intentional layered design within `MCPConstraintMonitor`.

## Implementation Details

The current observations focus primarily on the documentation structure and design intent rather than specific code symbols — no code symbols were enumerated for this component. The implementation is described through two coordinated documents: `semantic-constraint-detection.md` covers the operational mechanics (what the system does and how to use it), while `semantic-detection-design.md` captures the rationale (why it was built this way and what alternatives were considered).

From these documentation patterns, the implementation can be inferred to follow a pipeline shape: input arrives via the hook format established by `ClaudeCodeHookDataFormat`, is evaluated against rules loaded from `constraint-configuration.md`-specified definitions, and produces a detection verdict. The semantic dimension of this evaluation distinguishes it from rule-based predecessors — rather than matching strings or regex patterns, the detector reasons about the meaning of operations relative to constraint intent.

Because the detection logic is decoupled from the constraint definitions, the implementation likely exposes a generic evaluation interface that consumes rule objects and content payloads rather than embedding domain-specific rule semantics directly into code. This indirection is what makes the user-configurability described in the observations possible.

## Integration Points

SemanticConstraintDetection has three primary integration surfaces evident from the observations. First, it integrates **upward** with its parent `MCPConstraintMonitor`, which contains it and presumably invokes it as part of the monitoring workflow. The parent module is documented in `integrations/mcp-constraint-monitor/README.md` and provides the orchestration context within which detection occurs.

Second, it integrates **laterally** with its sibling `ClaudeCodeHookDataFormat`, which defines the schema of incoming payloads. SemanticConstraintDetection consumes data conforming to this format, making the hook format effectively its input contract. Any changes to the Claude Code hook payload structure would propagate through this interface and require corresponding adjustments in the detector's input handling.

Third, it integrates with the **constraint configuration layer** documented in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. This is a data-driven integration: the configuration provides the rule corpus that the detector evaluates against. Because this relationship is configuration-driven rather than code-coupled, the detector can adapt to new constraints without code changes, but it also depends on the configuration format remaining stable or versioned.

## Usage Guidelines

Developers working with SemanticConstraintDetection should consult both documentation files: `semantic-constraint-detection.md` for operational usage and `semantic-detection-design.md` for understanding why the system behaves as it does. The presence of a separate design document is itself a signal — changes that conflict with the documented design rationale should be reviewed carefully, as they may undermine the reasons semantic detection was chosen over simpler alternatives.

When defining new constraints, work within `constraint-configuration.md`'s specified format rather than modifying the detector itself. The decoupling between rules and detection logic is intentional, and bypassing it by hardcoding rules into the detector would erode the configurability that distinguishes this system. Treat the constraint configuration as the canonical place to express enforcement intent.

When integrating new input sources, respect the boundary established by `ClaudeCodeHookDataFormat`. If input must arrive in a different shape, transform it to conform to the hook format before passing it to the detector rather than building parallel input paths within SemanticConstraintDetection. This preserves the single, well-defined ingestion contract that the parent `MCPConstraintMonitor` system relies on.

Finally, recognize that semantic detection is more expensive and less predictable than lexical matching. Use it where its strengths are needed — implicit or context-dependent violations — and accept that test cases must cover semantic equivalence classes rather than just string variants. Maintainability of this component depends on keeping the rule corpus, the input contract, and the detection logic evolving in coordination rather than in isolation.


## Hierarchy Context

### Parent
- [MCPConstraintMonitor](./MCPConstraintMonitor.md) -- The MCPConstraintMonitor module in integrations/mcp-constraint-monitor/README.md monitors and enforces constraints

### Siblings
- [ClaudeCodeHookDataFormat](./ClaudeCodeHookDataFormat.md) -- Specified in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`, this document establishes the payload schema that Claude Code emits when invoking the constraint monitor as a downstream hook consumer, forming the primary ingestion boundary of the system.


---

*Generated from 3 observations*
