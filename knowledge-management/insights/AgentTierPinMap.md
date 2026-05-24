# AgentTierPinMap

**Type:** Detail

Separating static agent-to-tier bindings from dynamic complexity scoring (ComplexityClassifier) prevents per-request classification overhead for well-understood agents and provides a stable override path for agents whose cost or capability requirements are contractually fixed.

# AgentTierPinMap — Technical Insight Document

## What It Is

AgentTierPinMap is a routing construct documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` ("Agent Architecture"), which serves as the primary reference for understanding how individual agent identities are bound to fixed tiers within the routing pipeline. It is a structural component contained within TierRouter, alongside its sibling ComplexityClassifier, and functions as a lookup table that maps specific agent identities to predetermined model tiers.

In essence, AgentTierPinMap encodes static, declarative bindings between an agent (the caller or invoking identity) and a tier (a model class within the tiered-selection strategy defined in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`). Where the broader tiered-model approach discriminates routing decisions by inferred task complexity, the pin map represents the deterministic counterpart: known agents whose tier assignment is fixed regardless of the content of any individual request.

The pin map is conceptual/architectural in the current documented state — no concrete code symbols are exposed in this construct's file footprint — but its presence shapes how TierRouter sequences its routing decisions and how operators reason about per-agent cost and capability guarantees.

## Architecture and Design

The architectural approach evident from the observations is a **priority-ordered routing strategy** within TierRouter. The existence of AgentTierPinMap implies that TierRouter consults agent-identity bindings *before* delegating to its sibling ComplexityClassifier. This produces a short-circuit pattern: when an incoming request originates from a pinned agent, the pin map yields an immediate tier decision and the complexity scoring path is bypassed entirely. When no pin entry matches, control falls through to ComplexityClassifier, which — per `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` — applies the foundational complexity-based discrimination that otherwise governs every routing decision.

This is a classic **override + default** composition. AgentTierPinMap is the override layer (a static decision table), and ComplexityClassifier is the dynamic default (a scoring engine that runs whenever no override applies). The two siblings are intentionally complementary: one trades flexibility for determinism and zero per-request cost; the other trades cost for adaptive accuracy. TierRouter, as the parent, owns the orchestration that decides which path runs.

The design also reflects a **separation of concerns** principle. Static agent-to-tier bindings are kept structurally distinct from dynamic complexity scoring. This means changes to pinning policy (e.g., contractually fixing an agent to a specific tier) do not perturb the classifier, and tuning of the classifier's complexity heuristics does not risk regressing agents whose tier is a hard requirement.

## Implementation Details

The current observations describe AgentTierPinMap at the architectural-documentation level rather than the code level — the construct surfaces zero code symbols, and `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` is its primary reference. The implementation mechanics therefore should be understood as a documented contract rather than a concrete class hierarchy.

Mechanically, the pin map behaves as a key-value mapping where the key is an agent identity (the requesting agent's stable identifier) and the value is a tier selection drawn from the tier vocabulary established in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. Within TierRouter's request-handling flow, the pin map is consulted first: a lookup against the agent identity either yields a tier (terminating the decision) or returns no match (delegating to ComplexityClassifier).

Because the pin map short-circuits classification, it avoids the cost of running complexity scoring for well-understood agents on every request. This is significant for agents that issue high request volumes or whose behavior is sufficiently predictable that classification would consistently produce the same tier — paying the classifier cost in those cases would be wasted work. The pin map captures that knowledge once, declaratively, instead of recomputing it per request.

## Integration Points

The most direct integration is upward into its parent **TierRouter**, which owns AgentTierPinMap and orchestrates the lookup-then-classify sequence. TierRouter is the component that physically invokes the pin map and decides whether its result is authoritative or whether to fall through to the next stage.

Laterally, AgentTierPinMap integrates by contrast with its sibling **ComplexityClassifier**. The two share TierRouter as a parent and share the tier vocabulary from `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`, but they do not call each other; their relationship is mediated entirely by TierRouter's ordering policy. ComplexityClassifier remains the entry point for every routing decision that lacks a pin entry, preserving the document's stated principle that complexity-based discrimination is the foundational routing mechanism.

Downstream, both AgentTierPinMap and ComplexityClassifier feed tier decisions into whatever model-selection or dispatch logic TierRouter exposes — the pin map's output is interchangeable with the classifier's output from the perspective of consumers, which is what makes the override pattern coherent.

The broader integration story sits within the `integrations/mcp-server-semantic-analysis` package, where the tiered-model proposal frames why distinguishing tiers by task complexity matters: to keep lightweight tasks off expensive frontier models. AgentTierPinMap participates in that cost-management mission by giving operators a deterministic lever for agents whose tier needs are known a priori.

## Usage Guidelines

When deciding whether to add an agent to AgentTierPinMap, the guiding question is whether that agent's tier requirement is **contractually fixed or operationally stable**. The observations explicitly call out two motivating cases: agents with fixed cost requirements and agents with fixed capability requirements. If an agent's appropriate tier could legitimately vary based on the complexity of individual requests, it should be left unpinned so ComplexityClassifier can make per-request decisions.

Pinning should be treated as an **override**, not a default. Over-pinning erodes the value of ComplexityClassifier, because it removes the adaptive routing that makes tiered selection worthwhile in the first place. Conversely, under-pinning forces the classifier to repeatedly resolve the same agent to the same tier, wasting classification cycles. The pin map is most valuable when used surgically for agents where determinism, cost predictability, or capability guarantees outweigh adaptive routing.

Operators should treat `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` as the authoritative reference for which agents are pinned and why. Because the pin map short-circuits classification, any change to its contents directly alters production routing behavior and bypasses the safety net of complexity scoring — pin entries should therefore be documented with the rationale (cost contract, capability requirement, or behavioral guarantee) that justifies the override.

Finally, when reasoning about debugging or unexpected tier selections, the pin map is the first place to look: if a request's tier disagrees with what ComplexityClassifier would have chosen, the pin map is almost certainly the cause, because it is the only path inside TierRouter that can preempt the classifier's decision.

---

### Summary of Key Insights

1. **Architectural patterns identified**: Override + default composition; priority-ordered routing strategy with short-circuit evaluation; separation of static declarative configuration from dynamic scoring logic.
2. **Design decisions and trade-offs**: Determinism and zero per-request cost (pin map) vs. adaptive accuracy (ComplexityClassifier); operators trade flexibility for predictability when pinning an agent.
3. **System structure insights**: TierRouter is the orchestrator; AgentTierPinMap and ComplexityClassifier are complementary siblings that share a tier vocabulary but never call each other directly.
4. **Scalability considerations**: Pin-map lookups avoid the per-request cost of complexity scoring for high-volume or predictable agents, reducing classifier load and stabilizing latency for pinned identities.
5. **Maintainability assessment**: The construct is currently documentation-anchored (`integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`) rather than code-anchored, which keeps the policy surface small and reviewable but means changes to pinning are governance decisions as much as engineering ones — each entry should carry a documented rationale.


## Hierarchy Context

### Parent
- [TierRouter](./TierRouter.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md defines the tiered model selection strategy, distinguishing tiers by task complexity so that lightweight tasks avoid expensive frontier models

### Siblings
- [ComplexityClassifier](./ComplexityClassifier.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md ('Tiered Model Selection Proposal') establishes complexity-based tier discrimination as the foundational routing principle, making the classifier the entry point for every routing decision inside TierRouter.


---

*Generated from 3 observations*
