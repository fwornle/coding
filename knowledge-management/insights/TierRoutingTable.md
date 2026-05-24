# TierRoutingTable

**Type:** Detail

The parent component analysis notes that tier labels map to 'specific provider+model combinations declared in llm-providers.yaml', indicating a two-layer indirection: tier label → routing table entry → provider configuration, so changing a provider requires only updating the routing table rather than every call site.

# TierRoutingTable

## What It Is

The `TierRoutingTable` is a routing/lookup component contained within the `TierRouter`, with its authoritative design captured in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. It functions as the mapping layer that translates abstract tier labels (such as `powerful`, or other tier identifiers defined by the tiered-model strategy) into concrete `provider+model` pairs that are themselves declared in `llm-providers.yaml`.

In essence, the `TierRoutingTable` is the data-driven dispatch table that backs the tier abstraction. It does not itself decide *which* tier a request should use — that responsibility lives upstream in classification logic and is mediated by sibling components like `AgentTierPolicy`. Instead, it answers the narrower question: "Given that the caller has asked for tier X, which configured provider and model entry from `llm-providers.yaml` should be invoked?"

Because `TIERED-MODEL-PROPOSAL.md` is explicitly identified as the canonical design source for tier selection strategy, the `TierRoutingTable` should be understood as the runtime materialization of the rules described in that document.

## Architecture and Design

The architecture of `TierRoutingTable` reflects a deliberate **two-layer indirection** pattern: a tier label first resolves through a routing table entry, which then references a provider configuration in `llm-providers.yaml`. This separation is the central design decision and gives the system its key property — changing a provider (or swapping models) requires only updating the routing table rather than touching every call site that requested that tier.

This is a direct application of the **open/closed principle** within the broader `LLMAbstraction` layer. Upstream classification code is closed to modification when models change: when a tier like `powerful` is re-pointed to a different underlying model, no caller — and importantly, no classification logic that decided `powerful` was appropriate — needs to be touched. The `TierRoutingTable` absorbs that change in a single, localized configuration update.

The component fits cleanly into its parent `TierRouter`. The `TierRouter` is the user-facing entry point ("which model should run this request?") and the `TierRoutingTable` is the internal data structure that makes the router's answer possible. Its sibling, `AgentTierPolicy`, sits atop the tier selection strategy and provides override hooks; this means the `TierRoutingTable` is consulted *after* policy decisions have settled on a tier, keeping the table itself free of policy concerns and purely focused on the label-to-provider mapping.

## Implementation Details

Concretely, the `TierRoutingTable` is the structure that holds entries keyed by tier label, with each entry resolving to a specific provider+model combination declared in `llm-providers.yaml`. The mechanics of the lookup are intentionally simple: a tier label comes in, a structured entry comes out, and that entry is what the calling code (via `TierRouter`) uses to instantiate or select the appropriate provider client.

The design document `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` is the canonical reference for how tier names are defined and what semantic guarantees each tier carries (e.g., what a tier like `powerful` is intended to convey about cost, latency, or capability). Any implementation work on `TierRoutingTable` should treat that proposal as the source of truth for which tiers must exist and what their general intent is, while the actual provider+model bindings live in `llm-providers.yaml`.

Because the table itself is configuration-driven (entries derive from `llm-providers.yaml` provider declarations), the implementation avoids hard-coding provider names or model identifiers into routing logic. This keeps the runtime structure of `TierRoutingTable` consistent with the broader `LLMAbstraction` layer's pattern of declarative provider configuration.

## Integration Points

The most direct integration is with the parent `TierRouter`, which contains and consults the `TierRoutingTable` to fulfill its routing responsibility. Above that, `AgentTierPolicy` — its sibling within the tier-selection subsystem — produces tier decisions that ultimately become the keys looked up in the `TierRoutingTable`. The flow is therefore: classification/agent code → `AgentTierPolicy` → tier label → `TierRouter` → `TierRoutingTable` → provider+model entry from `llm-providers.yaml`.

The downstream integration point is `llm-providers.yaml`, which is the source of provider and model definitions. The `TierRoutingTable` does not own provider details; it only references them. This means that adding a new provider, rotating credentials, or updating endpoint configuration happens in `llm-providers.yaml`, while re-pointing a tier to use that provider happens in the routing table — two distinct concerns kept in separate files.

The component also integrates implicitly with the broader `LLMAbstraction` layer by participating in its open/closed design. Any subsystem in the codebase that requests a tier rather than a specific model is effectively consuming the `TierRoutingTable` indirectly through `TierRouter`.

## Usage Guidelines

When working with `TierRoutingTable`, developers should observe a few important conventions. First, **never bypass the tier abstraction** by hard-coding a provider+model pair at a call site that already has a meaningful tier available; doing so defeats the entire purpose of the two-layer indirection and creates exactly the kind of coupling the design was built to avoid. Request a tier, let `TierRouter` consult the `TierRoutingTable`, and let the table resolve to the current preferred provider.

Second, when **changing a model assignment**, prefer updating the `TierRoutingTable` entry rather than introducing a new tier or modifying upstream classification logic. The design explicitly supports re-pointing tiers (e.g., moving `powerful` to a different model) as a single-point change. Introducing a new tier should be a deliberate design action — ideally reflected in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` — not a workaround for a configuration tweak.

Third, **respect the separation between routing and policy**. `AgentTierPolicy` is the correct place for override hooks and contextual tier selection adjustments; the `TierRoutingTable` should remain a pure label-to-provider mapping. Mixing policy logic into the table erodes the clean layering that makes the tier system maintainable.

Finally, for any non-trivial work on this component — especially changes that affect tier semantics rather than just bindings — consult `TIERED-MODEL-PROPOSAL.md` first. It is the authoritative design document and the first place to read when understanding why a request lands on a specific model.

### Architectural Patterns Identified
- **Two-layer indirection / lookup table**: tier label → routing entry → provider configuration.
- **Open/closed principle** within the `LLMAbstraction` layer: upstream code is closed to modification when models change.
- **Configuration-driven dispatch**: provider details live in `llm-providers.yaml`, not in code.
- **Separation of policy and mechanism**: `AgentTierPolicy` handles policy; `TierRoutingTable` handles mechanism.

### Design Decisions and Trade-offs
- **Decision**: Decouple tier semantics from provider names. **Trade-off**: Adds one layer of lookup at runtime, but localizes provider changes to a single table.
- **Decision**: Treat `TIERED-MODEL-PROPOSAL.md` as canonical. **Trade-off**: Requires discipline to keep doc and implementation in sync, but ensures shared understanding of tier semantics.
- **Decision**: Keep the routing table free of policy. **Trade-off**: Requires a separate `AgentTierPolicy` layer for overrides, but preserves the table's simplicity and testability.

### System Structure Insights
The tier subsystem forms a clean vertical slice: `AgentTierPolicy` (policy) → `TierRouter` (dispatch) → `TierRoutingTable` (mapping) → `llm-providers.yaml` (provider config). Each layer has a single, well-defined responsibility, and each can evolve largely independently of the others.

### Scalability Considerations
Scaling here is primarily about *configuration scalability* rather than runtime throughput. Adding tiers, providers, or model variants is an O(1) configuration change in either `TierRoutingTable` or `llm-providers.yaml`. Because the routing table is a simple lookup, runtime overhead is negligible regardless of how many tiers or providers are configured.

### Maintainability Assessment
Maintainability is the explicit strength of this design. The two-layer indirection means model swaps, provider rotations, and tier re-targeting are all localized changes that do not ripple into call sites or classification logic. The presence of an authoritative design document (`TIERED-MODEL-PROPOSAL.md`) further improves long-term maintainability by giving future contributors a single canonical reference for tier semantics, rather than forcing them to reverse-engineer intent from the routing entries themselves.


## Hierarchy Context

### Parent
- [TierRouter](./TierRouter.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md is the authoritative design document for tier selection strategy, making it the first place to read when understanding why a request lands on a specific model

### Siblings
- [AgentTierPolicy](./AgentTierPolicy.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md describes the tier selection strategy that this policy layer sits atop of, providing the override hooks referenced in the parent component's characterization of TierRouter.


---

*Generated from 3 observations*
