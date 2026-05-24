# AgentTierPolicy

**Type:** Detail

Because overrides are resolved before the TierRoutingTable lookup, an agent pinned to 'balanced' will always route to the balanced model even if the task classifier would have promoted it to 'powerful', establishing a priority order: agent policy > complexity classifier > default tier.

# AgentTierPolicy

## What It Is

`AgentTierPolicy` is a policy layer component within the tier selection subsystem of the semantic analysis MCP server, documented in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. It sits architecturally as a child of `TierRouter` and operates as a sibling alongside `TierRoutingTable`. Its purpose is to provide per-agent override hooks that allow specific agents (identified by an agent ID or role string) to be pinned to a fixed tier label, bypassing the dynamic tier selection logic that would otherwise be performed by the complexity-based classifier.

In effect, `AgentTierPolicy` answers the question: "Does this particular agent have an explicit tier preference that should override the default selection logic?" It is the first decision point consulted within `TierRouter` before any complexity analysis or default routing occurs. When an override exists, the policy short-circuits the normal classification flow; when no override is present, control falls through to the standard tier selection mechanism that ultimately resolves to a model via `TierRoutingTable`.

## Architecture and Design

The architectural approach mirrors the registry-style pattern established by `perAgentOverrides in LLMState`, which the parent analysis explicitly cites as the design analog. This is a **lookup-table override pattern**: a map keyed by agent identity (agent ID or role string) holds tier label values (such as `'balanced'` or `'powerful'`), and the policy resolves an agent to a tier by performing a simple key lookup. This design intentionally separates *policy* (which agent gets which tier) from *mechanism* (how a tier label translates to a concrete provider+model pair, which is the responsibility of the sibling `TierRoutingTable`).

The placement of `AgentTierPolicy` within `TierRouter` establishes a clear **priority chain** for tier resolution:

1. **AgentTierPolicy** (highest priority) — explicit per-agent pinning
2. **Complexity classifier** — dynamic, task-aware tier promotion/demotion
3. **Default tier** (lowest priority) — fallback when neither of the above produces a decision

This ordering is a deliberate design decision: by resolving overrides *before* the `TierRoutingTable` lookup and before the classifier runs, the system guarantees that an agent pinned to `'balanced'` will always route to the balanced model, even when the task classifier would otherwise have promoted the request to `'powerful'`. This makes `AgentTierPolicy` an **escape hatch** for operational concerns (cost control, stability requirements, capability matching) that should not be overridden by automated heuristics.

The separation of concerns between `AgentTierPolicy` and its sibling `TierRoutingTable` is notable: the policy decides *which tier label applies*, while the routing table decides *which provider and model that label resolves to*. This two-stage indirection means model swaps can occur without touching agent-specific policy, and agent overrides can be added or removed without disturbing the tier→model mapping.

## Implementation Details

Because no concrete code symbols are exposed in the current observation set, the implementation details are inferred from the design document at `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` and the explicit analogy to `perAgentOverrides in LLMState`. The expected structure is a map-like data structure (e.g., `Map<AgentId, TierLabel>` or an object literal) embedded in or referenced by `TierRouter`, where:

- **Keys** are agent identifiers — likely strings representing either a stable agent ID or a role descriptor.
- **Values** are tier labels from the canonical tier vocabulary (`'balanced'`, `'powerful'`, and any other tiers defined by the proposal).

The resolution function consulted by `TierRouter` is expected to be a simple lookup that returns either a tier label or a sentinel value (null/undefined) indicating no override. When a label is returned, `TierRouter` skips classification and proceeds directly to `TierRoutingTable` with the overridden label. When no label is returned, the standard classification pipeline runs.

Because the override is resolved *before* `TierRoutingTable` is consulted, the policy never sees or cares about provider or model identifiers — it operates purely in the tier-label namespace. This keeps `AgentTierPolicy` cleanly decoupled from concrete model deployments.

## Integration Points

The primary integration is with the parent `TierRouter`, which embeds `AgentTierPolicy` as the first stage of its tier resolution pipeline. `TierRouter` is responsible for invoking the policy lookup, interpreting its result, and either short-circuiting to `TierRoutingTable` with the overridden label or proceeding through the complexity classifier.

The downstream integration is indirect but critical: whatever tier label `AgentTierPolicy` emits is consumed by `TierRoutingTable`, which performs the final translation to a provider+model pair. Because of this contract, the set of valid tier labels emitted by `AgentTierPolicy` must remain synchronized with the keys recognized by `TierRoutingTable`. The authoritative source of this shared vocabulary is `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`.

The conceptual integration with `LLMState.perAgentOverrides` is also worth noting. While `AgentTierPolicy` is its own component, it follows the same registry pattern, suggesting that future refactoring could potentially unify these registries or share infrastructure. Developers familiar with `perAgentOverrides` should find `AgentTierPolicy` immediately familiar in shape and intent.

## Usage Guidelines

When adding a new agent override, place an entry in the `AgentTierPolicy` registry keyed by the agent's ID or role string, with the desired tier label as the value. Remember that this entry will **always** take precedence over the complexity classifier — use overrides sparingly and only when there is a clear operational reason (e.g., an agent must use a cheap model for cost reasons, or must use a powerful model because its prompts consistently require it).

Avoid using `AgentTierPolicy` as a substitute for proper classifier tuning. If the complexity classifier is consistently selecting the wrong tier for a class of tasks, the right fix is usually to adjust the classifier — not to add per-agent overrides that mask the underlying issue. Overrides accumulate as technical debt: each one is a permanent exception that future maintainers must reason about when debugging tier selection.

Ensure that any tier label written into `AgentTierPolicy` is one that `TierRoutingTable` knows how to resolve. Introducing a new tier label requires coordinated changes in both components, and `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` should be updated to reflect the canonical tier vocabulary.

Finally, when debugging unexpected model selection, always check `AgentTierPolicy` first. Because it sits at the top of the priority chain (agent policy > complexity classifier > default tier), it is the most common source of "why did this request land on model X?" confusion. The fact that an agent pinned to `'balanced'` will never be promoted to `'powerful'` is a feature, not a bug — but it must be understood by anyone trying to trace routing decisions.

---

### Architectural Patterns Identified
- **Registry-style override pattern** (analogous to `perAgentOverrides in LLMState`)
- **Chain of responsibility** for tier resolution: policy → classifier → default
- **Separation of policy from mechanism**: `AgentTierPolicy` (which tier) vs. `TierRoutingTable` (which model)
- **Escape-hatch / override hook** pattern embedded within a default selection pipeline

### Design Decisions and Trade-offs
- **Decision**: Resolve overrides *before* classification. **Trade-off**: Operators gain hard guarantees about agent-to-tier pinning, at the cost of the classifier's ability to react to unusual task complexity for pinned agents.
- **Decision**: Key by agent identity rather than task type. **Trade-off**: Simple and predictable, but cannot express "agent X uses tier A for short prompts and tier B for long prompts" — such logic must live in the classifier.
- **Decision**: Emit tier labels, not concrete models. **Trade-off**: Decouples policy from deployment, but requires the tier vocabulary in `AgentTierPolicy` to remain synchronized with `TierRoutingTable`.

### System Structure Insights
`AgentTierPolicy` is a leaf-level policy primitive within `TierRouter`. Together with its sibling `TierRoutingTable`, it composes a two-stage resolution pipeline: label selection (this component) followed by label-to-model mapping (the sibling). The parent `TierRouter` orchestrates the flow, ensuring overrides take precedence over the dynamic classifier.

### Scalability Considerations
The registry pattern scales linearly with the number of agents holding overrides — O(1) lookup per request, O(N) memory in the number of overridden agents. For realistic agent counts this is trivial. The primary scalability concern is *cognitive*: a large override registry becomes hard to reason about and can mask systemic classifier issues.

### Maintainability Assessment
The component is highly maintainable in isolation due to its simplicity (lookup map + priority placement). The main maintainability risks are external: (1) override entries can accumulate as undocumented exceptions, and (2) the implicit contract that override tier labels must be valid `TierRoutingTable` keys is not enforced at the type level based on available observations. Treating `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` as the single source of truth for the tier vocabulary mitigates the second risk; periodic audits of the override registry mitigate the first.


## Hierarchy Context

### Parent
- [TierRouter](./TierRouter.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md is the authoritative design document for tier selection strategy, making it the first place to read when understanding why a request lands on a specific model

### Siblings
- [TierRoutingTable](./TierRoutingTable.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md is explicitly identified as the authoritative design document for tier selection strategy, making it the canonical source for understanding how tier labels translate to provider+model pairs.


---

*Generated from 3 observations*
