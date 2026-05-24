# TieredModelSelectionPolicy

**Type:** Detail

The existence of multiple heterogeneous specialized agents (GitHistoryAgent, VibeHistoryAgent, CodeGraphAgent as named in parent context) makes tiered model selection architecturally significant: different agents performing different analytical tasks (graph traversal vs. narrative summarization) likely have very different cost-<USER_ID_REDACTED> sensitivity profiles.

# TieredModelSelectionPolicy

## What It Is

TieredModelSelectionPolicy is a model-selection strategy formally specified in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md` ("Tiered Model Selection Proposal"). It defines how the semantic-analysis MCP server chooses among different language models when dispatching work to its specialized analysis agents. The policy's operator-facing knobs are exposed through the companion document `integrations/mcp-server-semantic-analysis/docs/configuration.md` ("Configuration Reference"), which surfaces the tiered model settings as runtime-tunable parameters.

The fact that this policy warranted a dedicated proposal document — separate from the general configuration reference — signals that model selection is treated as a first-class architectural concern within the system rather than an incidental implementation detail. It sits as a child of the broader `ConfigurationSeparationConventions` and is also contained within the `Pipeline` component, meaning it both governs and is consumed by the orchestration layer that sequences specialized agents.

## Architecture and Design

The architectural rationale for a tiered policy emerges directly from the heterogeneity of the agents it serves. The parent `Pipeline` component is orchestrated by a coordinator agent that sequences specialized agents — `GitHistoryAgent`, `VibeHistoryAgent`, and `CodeGraphAgent` — all defined in `integrations/mcp-server-semantic-analysis/src/agents/`. These agents perform fundamentally different analytical tasks: `CodeGraphAgent` does structured graph traversal, `VibeHistoryAgent` performs narrative summarization of intent, and `GitHistoryAgent` reasons over commit-level history. Each of these workloads has a distinct cost-<USER_ID_REDACTED> sensitivity profile, which is precisely the condition that makes a tiered model assignment scheme valuable.

The design pattern here is best characterized as **policy-driven dispatch**: rather than hardcoding a single model into each agent, the policy externalizes the model-choice decision into a configurable mapping. This allows the same agent code to operate against a cheap/fast model for routine traversal-style work and an expensive/high-<USER_ID_REDACTED> model for tasks where reasoning depth dominates cost. The clear separation between the proposal document (the *why* and the *what*) and the configuration reference (the *how to tune*) reflects a deliberate documentation discipline aligned with `ConfigurationSeparationConventions`.

The policy is conceptually a sibling of `CoordinatorAgentOrchestration` under the `Pipeline` parent. Where `CoordinatorAgentOrchestration` decides *which agent runs and in what order*, TieredModelSelectionPolicy decides *which model backs each agent's invocation*. Together they form an orthogonal decomposition of pipeline decisions: orchestration handles control flow, while the model policy handles compute-resource binding.

## Implementation Details

The available observations do not enumerate concrete code symbols, classes, or functions implementing the policy — no code files were indexed against this entity. What is documented is the *specification surface*: the proposal in `TIERED-MODEL-PROPOSAL.md` and the operator-facing parameters in `configuration.md`. The implementation is therefore best understood as a configuration-driven mapping that the coordinator (or the agents themselves, on construction) consults when materializing an LLM client.

Given the agent layout in `integrations/mcp-server-semantic-analysis/src/agents/`, the policy almost certainly resolves a model identifier per agent type — keying off the agent's role (e.g., the role embodied by `GitHistoryAgent` vs. `CodeGraphAgent`) and yielding a model tier such as a small/cheap default versus a larger/more capable model for tasks that benefit from richer reasoning. The configuration reference is the canonical place where these tier-to-agent bindings are defined and overridden by operators.

Because no concrete classes are surfaced in the observations, downstream readers should treat `TIERED-MODEL-PROPOSAL.md` as the authoritative source for the algorithm and `configuration.md` as the source for the knob names, defaults, and override semantics.

## Integration Points

TieredModelSelectionPolicy integrates upward into the `Pipeline` component and laterally to `CoordinatorAgentOrchestration`. The coordinator agent that sequences the specialized agents is the natural consumer of the policy: when it constructs or invokes `GitHistoryAgent`, `VibeHistoryAgent`, or `CodeGraphAgent` from `integrations/mcp-server-semantic-analysis/src/agents/`, the model binding selected by the policy determines which LLM backend receives the request.

Integration with `ConfigurationSeparationConventions` is structural rather than functional — the policy is *contained by* that convention, meaning its settings are expected to live in the conventional configuration locations and follow the same separation rules (e.g., proposal docs distinct from operational configuration). This containment relationship is what makes `configuration.md` the appropriate exposure point for tunable parameters and `TIERED-MODEL-PROPOSAL.md` the appropriate home for the design rationale.

External integration points include the upstream LLM providers themselves: the tier abstraction implies the policy can route to multiple model backends, which means provider credentials, rate limits, and pricing tiers become operationally relevant when configuring this policy.

## Usage Guidelines

When extending or modifying the semantic-analysis pipeline, treat `TIERED-MODEL-PROPOSAL.md` as the design contract — any new agent added under `integrations/mcp-server-semantic-analysis/src/agents/` should be classified along the same cost-<USER_ID_REDACTED> axis and assigned a tier rather than hardcoding a model choice. This preserves the orthogonality between agent logic and model selection that the policy was created to maintain.

Operators tuning the system should make changes through the parameters documented in `configuration.md` rather than editing agent source. Because `GitHistoryAgent`, `VibeHistoryAgent`, and `CodeGraphAgent` have meaningfully different output characteristics, blanket model overrides should be avoided; per-agent (or per-tier) overrides preserve the per-task cost-<USER_ID_REDACTED> calibration that motivated the policy.

For **scalability**, the tiered approach is a deliberate cost-control mechanism: routing high-volume, low-complexity agent calls to cheaper models keeps aggregate inference cost bounded as pipeline throughput grows, while reserving expensive models for the narrative or reasoning-heavy stages. For **maintainability**, the strict separation between the proposal document, the configuration reference, and the agent implementations means that changes to model strategy (proposal), operational tuning (configuration), and agent behavior (code under `src/agents/`) can evolve independently — a strong indicator of a well-factored policy boundary. A trade-off worth noting is that this configurability shifts responsibility onto operators: misconfiguring tiers (e.g., assigning a weak model to `VibeHistoryAgent`) can silently degrade analytical <USER_ID_REDACTED> without producing an obvious failure mode, so changes to tier bindings should be reviewed with the same rigor as code changes.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- The pipeline is orchestrated by a coordinator agent that sequences specialized agents (GitHistoryAgent, VibeHistoryAgent, CodeGraphAgent, etc.) defined in integrations/mcp-server-semantic-analysis/src/agents/

### Siblings
- [CoordinatorAgentOrchestration](./CoordinatorAgentOrchestration.md) -- The parent component context explicitly names GitHistoryAgent, VibeHistoryAgent, and CodeGraphAgent as distinct specialized agents all residing in integrations/mcp-server-semantic-analysis/src/agents/, indicating a deliberate decomposition where each agent owns a single analysis domain (git history, vibe/intent history, and code graph respectively).


---

*Generated from 3 observations*
