# AnthropicAdapter

**Type:** Detail

integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md ('Tiered Model Selection Proposal') documents a tiered model selection design, suggesting AnthropicAdapter must expose Claude variants (e.g., Haiku vs. Sonnet vs. Opus) at distinct cost/<USER_ID_REDACTED> tiers consumable by the TierRouter without knowing provider internals

# AnthropicAdapter — Technical Insight Document

## What It Is

`AnthropicAdapter` is a concrete provider adapter implementation that sits within the `PublicCloudProviders` sub-component of the broader `LLMAbstraction` layer. While the source observations do not pin down a specific file path for the adapter class itself, its role is well-defined by its parent context: it is one of at least three concrete public cloud provider adapters (alongside OpenAI and Groq adapters) that normalize provider-specific behavior to a shared interface contract. Given that the project is built on Anthropic's Claude SDK, `AnthropicAdapter` is the most likely primary adapter in the default execution path.

Functionally, the adapter encapsulates all Anthropic-specific concerns — authentication headers, request/response schemas, message formatting, and model selection — so that upstream callers in the `LLMAbstraction` layer interact with Anthropic's Claude API through the same uniform interface used for OpenAI or Groq. The tiered model selection design documented at `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` further constrains the adapter's surface: it must expose Claude variants (Haiku, Sonnet, Opus) at distinct cost/<USER_ID_REDACTED> tiers consumable by the `TierRouter`.

This entity is part of the default fallback path: when `getLLMMode()` resolves to `'public'` (i.e., no local override or alternative mode is set), `PublicCloudProviders` is selected, and `AnthropicAdapter` becomes available as the routing target.

## Architecture and Design

The architectural pattern at play is the **Adapter Pattern** combined with **Strategy Pattern** semantics. `AnthropicAdapter` adapts Anthropic's vendor-specific API to a normalized internal interface shared with sibling adapters (the OpenAI and Groq adapters). This design hides any provider-specific quirks — such as Anthropic's distinct system prompt handling, content block message schema, or `x-api-key`/`anthropic-version` header conventions — from callers higher in the stack. The contract boundary is enforced at the adapter level: downstream consumers should never need provider-specific branching logic.

The parent component `PublicCloudProviders` acts as a grouping/selection layer for cloud-hosted LLM backends. Its activation logic is gated by `getLLMMode()` returning `'public'`, which is the default fallback when no local or override mode is configured. This layered approach — `LLMAbstraction` → `PublicCloudProviders` → `AnthropicAdapter` — creates a clean delegation chain where each level has a single responsibility: abstraction routing, cloud-vs-local categorization, and provider-specific translation, respectively.

A crucial architectural element is the relationship with the `TierRouter`, described in the `TIERED-MODEL-PROPOSAL.md` design document. Rather than the router knowing about Claude model identifiers directly, `AnthropicAdapter` exposes its model lineup as tier-categorized capabilities (cheap/fast like Haiku, balanced like Sonnet, premium like Opus). This indirection means tier-routing decisions remain provider-agnostic: the router asks for a tier, and the adapter resolves the concrete model. This is a clean inversion-of-knowledge boundary that keeps cross-provider tier comparison feasible.

## Implementation Details

The provided observations do not include direct code symbols (`0 code symbols found`) or specific file paths for the adapter class, so concrete class members and method signatures cannot be enumerated here without inventing details. What can be stated with confidence, however, is the set of responsibilities the implementation must address based on its role in the surrounding architecture.

The adapter must implement the shared interface contract used by all `PublicCloudProviders` adapters. This means it provides normalized methods for at least the core LLM operations (e.g., completion or message generation), accepts a normalized request shape, and returns a normalized response shape regardless of how Anthropic's wire protocol differs from OpenAI's or Groq's. Anthropic-specific elements — including the message array structure with `role`/`content` blocks, the dedicated `system` parameter, header authentication, and API version pinning — are localized inside this adapter and never leak out.

For tier exposure, the adapter must surface Claude model variants in a form the `TierRouter` can consume according to the design in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. This implies a mapping table or declarative registration whereby Claude Haiku, Sonnet, and Opus models are associated with their respective cost/<USER_ID_REDACTED> tiers. The adapter, not the router, owns the knowledge of which Claude model serves which tier — a critical separation of concerns.

## Integration Points

`AnthropicAdapter` integrates with the system at three primary boundaries. **Upward**, it is selected and invoked by `PublicCloudProviders`, which is itself activated when `getLLMMode()` returns `'public'`. This selection logic determines whether `AnthropicAdapter` participates in a given request at all. **Laterally**, it shares an interface contract with its siblings — the OpenAI and Groq adapters — meaning any change to that shared interface ripples to all three implementations and must be coordinated.

**Outward**, the adapter depends on Anthropic's Claude SDK as its underlying transport. This dependency is fully encapsulated: callers do not need to know that the Anthropic SDK exists, what versions it supports, or how it constructs requests. The adapter is also the integration point for Anthropic-specific configuration — API keys, organizational identifiers, and model availability.

A further integration point is the `TierRouter` described in `TIERED-MODEL-PROPOSAL.md`. The adapter must publish or otherwise expose its model tier inventory in a way the router can query, enabling provider-agnostic tier-based routing across the full set of public cloud providers in `PublicCloudProviders`.

## Usage Guidelines

Developers extending or maintaining `AnthropicAdapter` should respect the encapsulation boundary it establishes. Provider-specific behavior — Anthropic header schemes, message formatting, error code mappings, rate limit semantics — must remain inside the adapter. Leaking Anthropic types or identifiers into the broader `LLMAbstraction` layer would undermine the entire purpose of having sibling adapters for OpenAI and Groq.

When adding new Claude model variants, update the adapter's tier mapping so the new model becomes available to the `TierRouter` through the abstraction defined in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`. Avoid hardcoding Claude model IDs anywhere outside this adapter; consumers should always request by tier or via the normalized interface.

Because `AnthropicAdapter` is on the default fallback path (engaged whenever `getLLMMode()` resolves to `'public'`), it is the most likely adapter to be exercised in standard operation. This makes its reliability, error handling, and observability disproportionately important. Failures here will be the most visible to end users, so defensive coding around Anthropic API errors, retries, and clear error normalization to the shared interface is essential.

Finally, when modifying the shared interface contract, coordinate changes simultaneously across `AnthropicAdapter` and its sibling adapters (OpenAI, Groq) within `PublicCloudProviders`. Drift between sibling implementations of the same contract is the principal risk in this design.

---

### Summary

1. **Architectural patterns identified**: Adapter Pattern (vendor API → normalized interface), Strategy Pattern (interchangeable provider implementations under `PublicCloudProviders`), and an Inversion of Knowledge boundary between the adapter and `TierRouter` for tier-based model selection.

2. **Design decisions and trade-offs**: Encapsulating all Anthropic-specific quirks inside one adapter improves cross-provider symmetry but requires disciplined contract maintenance across sibling adapters. Exposing models by tier rather than by identifier sacrifices some fine-grained control in exchange for provider-agnostic routing.

3. **System structure insights**: A clear three-tier hierarchy — `LLMAbstraction` → `PublicCloudProviders` → `AnthropicAdapter` — assigns one responsibility per layer (abstraction, cloud categorization, provider translation), with `getLLMMode()` gating entry to the public cloud branch.

4. **Scalability considerations**: New Claude models scale in by updating the adapter's tier mapping alone. New providers scale in as new sibling adapters under `PublicCloudProviders` without disturbing existing ones. The tier abstraction means cost/<USER_ID_REDACTED> optimization decisions scale independently of provider count.

5. **Maintainability assessment**: Maintainability is strong where the encapsulation discipline is honored — Anthropic concerns stay local, and the shared interface remains the only cross-cutting contract. The chief maintenance risk is drift between sibling adapters when the interface evolves; coordinated updates across `AnthropicAdapter`, the OpenAI adapter, and the Groq adapter are required to preserve the abstraction's integrity.


## Hierarchy Context

### Parent
- [PublicCloudProviders](./PublicCloudProviders.md) -- The parent component description references a 'public' LLMMode value, indicating cloud providers are the default fallback when no override or global mode is set in getLLMMode()


---

*Generated from 3 observations*
