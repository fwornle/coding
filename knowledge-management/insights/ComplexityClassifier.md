# ComplexityClassifier

**Type:** Detail

Because TIERED-MODEL-PROPOSAL.md distinguishes tiers by task complexity, the classifier must evaluate task-level signals—such as semantic scope, required reasoning depth, or operation type—rather than caller identity, separating it architecturally from the AgentTierPinMap override path.

# ComplexityClassifier: Technical Insight Document

## What It Is

The **ComplexityClassifier** is a routing-decision component nested within the **TierRouter** of the semantic analysis MCP server, with its conceptual foundation established in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` ("Tiered Model Selection Proposal"). It serves as the entry point for every routing decision performed by TierRouter, evaluating an incoming task and emitting a discrete tier label that downstream logic uses to select an appropriate model.

Functionally, the classifier is responsible for translating a task's intrinsic characteristics — its semantic scope, required reasoning depth, and operation type — into a categorical tier assignment. This assignment is the mechanism through which the tiered model selection strategy ensures that lightweight tasks avoid expensive frontier models, while complex tasks are escalated to more capable (and costlier) backends.

Although no concrete code symbols or implementation files are currently registered for this component (the structural inventory reports zero code symbols), the design is fully specified at the documentation level in TIERED-MODEL-PROPOSAL.md, which serves as the canonical source of truth for its behavior contract.

## Architecture and Design

The architectural pattern is a **classifier-then-router** pipeline: ComplexityClassifier performs categorization, and its parent TierRouter performs lookup-based dispatch on the result. Crucially, the classifier produces a *discrete tier label* rather than a raw numeric score. This design decision is deliberate — it allows TierRouter to perform a clean table lookup against the classification result without needing thresholding logic, normalization, or score-to-tier translation at the routing layer. The classifier "owns" the decision boundary; the router merely executes on it.

This component is also designed around a clear **separation of concerns** relative to its sibling, **AgentTierPinMap**. Where ComplexityClassifier evaluates *task-level signals* (semantic scope, reasoning depth, operation type), AgentTierPinMap — documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` ("Agent Architecture") — evaluates *caller identity* by associating specific agent identities with fixed tiers. The two siblings represent two distinct routing axes inside TierRouter: a content-aware path (ComplexityClassifier) and an identity-based override path (AgentTierPinMap). Architecturally, this means ComplexityClassifier must remain agnostic of *who* is invoking it and focused exclusively on *what* the task is.

The chosen pattern resembles a **strategy/policy decomposition**, with TierRouter acting as the policy coordinator and ComplexityClassifier supplying one classification strategy among potentially several inputs to the final dispatch decision. The proposal in TIERED-MODEL-PROPOSAL.md establishes complexity-based discrimination as the *foundational* routing principle, implying the classifier is invoked first in every routing pass, with sibling mechanisms layered as overrides or specializations.

## Implementation Details

The classifier's implementation contract, as derivable from the observations, centers on three operational expectations:

1. **Input domain**: Task-level metadata sufficient to assess semantic scope, reasoning depth, and operation type. The classifier does *not* receive caller identity as a primary input — that signal is routed through AgentTierPinMap instead.
2. **Output domain**: A discrete tier label drawn from the tier vocabulary established in TIERED-MODEL-PROPOSAL.md. The label is consumable directly by TierRouter without further transformation.
3. **Invocation position**: As the entry point of TierRouter, the classifier executes before any tier-specific dispatch logic runs.

No concrete classes, functions, or symbol-level implementations are presently catalogued for ComplexityClassifier (the code structure inventory shows zero symbols and no key files). The component exists today primarily as a documented design contract within the TIERED-MODEL-PROPOSAL.md proposal, indicating it is either pending implementation or implemented in a form not yet indexed by the symbol-extraction pipeline. Any implementer should treat TIERED-MODEL-PROPOSAL.md as the authoritative behavioral specification.

## Integration Points

The primary integration point is **TierRouter**, which contains ComplexityClassifier and consumes its output to drive model selection. Because the proposal defines the classifier as the foundational routing primitive, TierRouter's correctness depends on the classifier producing stable, well-defined tier labels for the full range of incoming tasks.

ComplexityClassifier coexists with its sibling **AgentTierPinMap** under the same parent. The two are designed to compose rather than conflict: AgentTierPinMap (defined per `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`) supplies fixed tier assignments for specific agents, which TierRouter can use to short-circuit or override the classifier's task-based determination. This implies that integration between the two siblings happens *inside* TierRouter's coordination logic, not via direct calls between the siblings themselves.

Downstream, the tier label produced by ComplexityClassifier feeds into the model-selection mechanism described in the tiered model selection proposal, ultimately determining whether a request is served by a lightweight model or escalated to a frontier model.

## Usage Guidelines

When working with or extending ComplexityClassifier, several conventions follow directly from its design:

- **Never feed caller identity into the classifier.** Identity-based routing is the explicit responsibility of AgentTierPinMap. Mixing these signals violates the separation between content-aware and identity-based routing established by the architecture.
- **Emit tier labels, not scores.** TierRouter expects to perform a clean lookup on the classifier's output. Returning raw numeric scores would force TierRouter to absorb threshold logic, breaking the clean classifier/router boundary.
- **Base classification on task-level signals only** — semantic scope, reasoning depth, and operation type are the canonical axes called out in the source observations. Adding new signals should be evaluated against this task-centric framing.
- **Treat TIERED-MODEL-PROPOSAL.md as the source of truth** for the tier vocabulary and the discrimination rules. The proposal establishes complexity-based tier discrimination as foundational; changes to the classifier's behavior should be reflected there first.
- **Preserve the lightweight-task escape valve.** The explicit goal stated in the parent component description is that lightweight tasks must avoid expensive frontier models. Any reclassification logic that erodes this property defeats the purpose of the tiered system.

For developers extending the routing system, the recommended pattern is to add new routing axes as additional siblings under TierRouter (following the precedent set by AgentTierPinMap) rather than overloading ComplexityClassifier with cross-cutting concerns.


## Hierarchy Context

### Parent
- [TierRouter](./TierRouter.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md defines the tiered model selection strategy, distinguishing tiers by task complexity so that lightweight tasks avoid expensive frontier models

### Siblings
- [AgentTierPinMap](./AgentTierPinMap.md) -- integrations/mcp-server-semantic-analysis/docs/architecture/agents.md ('Agent Architecture') is the primary reference for this construct, documenting how individual agent identities are associated with fixed tiers within the routing pipeline.


---

*Generated from 3 observations*
