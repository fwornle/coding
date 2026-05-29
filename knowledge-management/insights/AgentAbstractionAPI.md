# AgentAbstractionAPI

**Type:** Detail

docs/architecture/agent-abstraction-api.md is explicitly listed as 'Agent Abstraction API Reference', making it the canonical contract document that agent shell scripts in config/agents/ must conform to

# AgentAbstractionAPI — Technical Insight Document

## What It Is

The AgentAbstractionAPI is the canonical contract layer for agent integration within the system, formally documented at `docs/architecture/agent-abstraction-api.md`. This document serves as the authoritative specification that all agent shell scripts residing under `config/agents/` must conform to. It is not an executable interface in the traditional sense but rather a **specification-as-contract**: a normative document that defines what every agent integration must expose, declare, and handle in order to be considered a valid participant in the system.

It exists as a defined sub-component within AgentConfigConventions, the broader convention system governing the `config/agents/` directory. Within that parent context, AgentAbstractionAPI occupies the role of the abstract contract layer — defining *what* must be true of any agent — while AgentConfigConventions as a whole defines *how* agents are registered and structured operationally.

## Architecture and Design

The design reflects a **two-layer documentation architecture**: `docs/architecture/agent-abstraction-api.md` establishes the abstract contract (the "what must be implemented"), while `docs/agent-integration-guide.md` provides the practical integration guidance (the "how to implement it"). This separation of concerns between specification and guidance is a deliberate design decision that keeps the contract stable and provider-agnostic while allowing the integration guide to evolve with implementation patterns.

A critical architectural decision embedded in the API is **multi-provider credential unification**. The explicit documentation of both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` as recognized components indicates that the abstraction is designed to accommodate heterogeneous provider credential schemes under a single unified interface. Rather than coupling the contract to any one provider's authentication model, the API acknowledges that agent shell scripts may need to declare and configure credentials from multiple, distinct upstream AI providers. This is a meaningful trade-off: it broadens compatibility at the cost of requiring the contract to remain aware of provider-specific credential naming conventions.

The relationship to the sibling component AgentShellScriptProtocol is architecturally significant. While AgentAbstractionAPI defines the abstract contract, AgentShellScriptProtocol governs the concrete shell-level protocol — specifically the standard exports `AGENT_NAME` and `AGENT_REQUIRES_COMMANDS` that every `config/agents/` script must declare. Together, these two components form a coherent specification stack: AgentAbstractionAPI at the conceptual/contract layer, AgentShellScriptProtocol at the executable/declaration layer.

## Implementation Details

The implementation of the AgentAbstractionAPI is documentation-driven rather than code-driven. The primary artifact is `docs/architecture/agent-abstraction-api.md`, which functions as the reference manual for agent shell script authors. The contract it defines is enforced by convention and documentation rather than by a runtime type system or interface enforcement mechanism — a pragmatic choice for a shell-script-based integration layer.

The multi-provider credential model is a key implementation detail. The API explicitly names `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` as documented components, meaning agent shell scripts are expected to declare, validate, or pass through these environment variables as part of their conformance to the contract. This implies that the abstraction layer does not attempt to normalize credential names but instead enumerates the known credential schemes agents may need to surface.

The parent component AgentConfigConventions further contextualizes implementation: `docs/architecture/adding-new-agent.md` provides the step-by-step convention for registering a new agent provider, meaning the full implementation lifecycle for a new agent — from abstract contract conformance through to registration — is covered across three coordinated documents (`agent-abstraction-api.md`, `agent-integration-guide.md`, and `adding-new-agent.md`).

## Integration Points

The AgentAbstractionAPI integrates directly with the shell scripts in `config/agents/`, which are the concrete implementations of the contract. Each script in that directory is, by definition, an implementation of the abstraction defined here. The contract's credential components (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) create an implicit dependency on the host environment's secrets management approach — the API assumes these values are available in the execution environment.

The companion document `docs/agent-integration-guide.md` is a direct integration-layer dependency: developers implementing a new agent are expected to consult both the abstract contract and the integration guide in tandem. The sibling AgentShellScriptProtocol governs the shell-level exports (`AGENT_NAME`, `AGENT_REQUIRES_COMMANDS`) that any implementation of this API must also satisfy, creating a cross-cutting conformance requirement between the two specifications.

## Usage Guidelines

Developers adding a new agent provider must treat `docs/architecture/agent-abstraction-api.md` as the primary normative reference — it defines what the shell script must conform to. The integration guide at `docs/agent-integration-guide.md` should be consulted alongside it for practical implementation steps, and `docs/architecture/adding-new-agent.md` provides the registration procedure within AgentConfigConventions.

Any agent shell script placed under `config/agents/` must satisfy both this API contract and the AgentShellScriptProtocol's requirements simultaneously. Specifically, `AGENT_NAME` and `AGENT_REQUIRES_COMMANDS` exports (per AgentShellScriptProtocol) are expected in conjunction with the credential and interface requirements of AgentAbstractionAPI.

When working with multi-provider agents, developers should be explicit about which credential environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) the agent depends on, as these are documented contract elements — undeclared credential dependencies represent a contract violation and will likely cause silent runtime failures rather than explicit errors given the shell-based implementation model.

---

**Scalability Consideration:** The enumeration of provider credentials within the contract (rather than a generic `AGENT_API_KEY` abstraction) is a pragmatic but bounded approach. As additional providers are integrated, the contract will require explicit updates to name new credential variables, creating a maintenance coupling between provider expansion and contract revision.

**Maintainability Assessment:** The three-document coordination pattern (`agent-abstraction-api.md`, `agent-integration-guide.md`, `adding-new-agent.md`) distributes contract knowledge across multiple files, which improves separation of concerns but requires disciplined cross-document consistency maintenance. The documentation-as-contract model is maintainable at small-to-medium agent counts but would benefit from a machine-checkable conformance mechanism as the `config/agents/` directory grows.


## Hierarchy Context

### Parent
- [AgentConfigConventions](./AgentConfigConventions.md) -- config/agents/ directory holds per-agent shell scripts that declare environment-specific setup, with docs/architecture/adding-new-agent.md codifying the step-by-step convention for registering a new provider

### Siblings
- [AgentShellScriptProtocol](./AgentShellScriptProtocol.md) -- Project documentation lists AGENT_NAME and AGENT_REQUIRES_COMMANDS as key documented components, indicating these are standard exports expected in every agent shell script under config/agents/


---

*Generated from 3 observations*
