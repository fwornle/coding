# IntegrationOnboarding

**Type:** Detail

integrations/mcp-constraint-monitor/docs/constraint-configuration.md ('Constraint Configuration Guide') and integrations/mcp-server-semantic-analysis/docs/installation/README.md ('Installation Guide') show that each integration maintains its own installation and configuration onboarding path rather than relying on a shared guide.

# IntegrationOnboarding — Technical Reference

## What It Is

`IntegrationOnboarding` represents the decentralized onboarding model adopted across the integrations in this repository. Rather than a single, shared getting-started guide, each integration owns its entire onboarding surface. The concrete implementations of this pattern are visible across three primary locations:

- `integrations/code-graph-rag/CONTRIBUTING.md` — contribution-specific guidance scoped to code-graph-rag
- `integrations/code-graph-rag/docs/claude-code-setup.md` — tooling setup for the Graph-Code MCP server within Claude Code
- `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` — installation and constraint configuration onboarding
- `integrations/mcp-server-semantic-analysis/docs/installation/README.md` — installation guide for the semantic analysis server

Each of these files represents a discrete onboarding artifact maintained independently within its integration's directory tree. Collectively, they define the `IntegrationOnboarding` pattern as it exists within `MCPServerPattern`.

---

## Architecture and Design

The overarching design decision here is **onboarding autonomy per integration**. There is no evidence of a shared onboarding framework or central setup guide that integrations delegate to. Instead, every integration owns its full onboarding lifecycle — from installation through configuration and contribution — as a self-contained documentation set living alongside the integration's code.

This design is consistent with how `MCPServerPattern` structures its entry points: each integration maintains a top-level `README.md` (e.g., `integrations/mcp-constraint-monitor/README.md`, `integrations/mcp-server-semantic-analysis/README.md`, `integrations/code-graph-rag/README.md`) as the primary tool description. The `IntegrationOnboarding` artifacts extend that entry point downward into progressively more specific concerns — installation, configuration, tooling setup, and contribution norms.

The sibling entity `ArchitectureDoc` follows a parallel structure: `integrations/mcp-server-semantic-analysis/docs/architecture/` separates concerns across `agents.md`, `tools.md`, and `integration.md`. This reveals a broader documentation philosophy in `MCPServerPattern` where both onboarding and architecture documentation are **concern-separated and integration-local**, rather than centralized. The trade-off is deliberate: each integration can evolve its own setup requirements independently without coordinating against a shared guide, at the cost of potential duplication across integrations.

A notable specialization within code-graph-rag's onboarding is the existence of `docs/claude-code-setup.md` — a setup document scoped explicitly to configuring the Graph-Code MCP server within Claude Code. This indicates that some integrations carry **tooling-specific onboarding** that goes beyond generic installation steps, reflecting the reality that MCP server integrations may have host-application-specific configuration requirements.

---

## Implementation Details

The onboarding structure can be decomposed into three functional layers based on the observed files:

**1. Contribution Guidance (`CONTRIBUTING.md`):** `integrations/code-graph-rag/CONTRIBUTING.md` scopes contribution norms to a single integration. This means contributor workflow, code standards, and PR conventions for code-graph-rag are documented independently of any top-level project `CONTRIBUTING.md`. This is a meaningful design choice — it allows integration-specific contribution rules (e.g., graph schema conventions, RAG pipeline testing requirements) without polluting or overloading a global guide.

**2. Tooling and Environment Setup:** `integrations/code-graph-rag/docs/claude-code-setup.md` provides step-by-step instructions for a specific runtime configuration — the Graph-Code MCP server within Claude Code. This document type represents the most specialized layer of onboarding, addressing a concrete host-tool integration scenario. Its existence as a separate document (rather than being embedded in a general README) suggests these setup paths can be complex enough to warrant dedicated treatment.

**3. Installation and Configuration (`docs/installation/README.md`, `docs/constraint-configuration.md`):** Both `integrations/mcp-server-semantic-analysis/docs/installation/README.md` and `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` represent the core operational onboarding path — getting the integration running and correctly configured. The fact that `mcp-constraint-monitor` names its guide after constraint configuration (rather than generic installation) suggests its onboarding is domain-specific, foregrounding the configuration model that governs the monitor's behavior.

---

## Integration Points

`IntegrationOnboarding` sits directly inside `MCPServerPattern`, meaning every integration that follows the MCP server pattern is expected to carry its own onboarding documentation. The `README.md` at each integration root acts as the entry point, with `IntegrationOnboarding` artifacts forming the next layer of depth — reachable via links or directory navigation from the root README.

The relationship with `ArchitectureDoc` is structural rather than dependency-based. Where `ArchitectureDoc` (as seen in `integrations/mcp-server-semantic-analysis/docs/architecture/`) addresses the *why and how* of system design, `IntegrationOnboarding` addresses *how to get started and contribute*. Both are peer concerns under `MCPServerPattern`, and mature integrations are expected to maintain both.

There is no observed shared utility, script, or template that onboarding documents inherit from. Each integration's onboarding is authored independently, suggesting that the "integration point" between onboarding artifacts and the rest of the system is primarily navigational (via README links and directory structure) rather than programmatic.

---

## Usage Guidelines

**New integrations should replicate the three-layer onboarding structure** observed here: a root README as the entry point, an installation/configuration guide under `docs/`, and a `CONTRIBUTING.md` if the integration has non-trivial contribution requirements. Where a specific hosting tool (like Claude Code) requires bespoke setup, that should be captured in a dedicated setup document (following the `claude-code-setup.md` model) rather than expanding the root README.

**Configuration-heavy integrations should name their onboarding docs after the configuration domain**, as `mcp-constraint-monitor` does with `constraint-configuration.md`. This surfaces the most critical onboarding concern immediately to new users rather than burying it in a generic installation guide.

**Onboarding docs should remain integration-local.** The architecture deliberately avoids a centralized onboarding guide. Developers should resist the impulse to abstract common steps into a shared document unless there is strong evidence of duplication across multiple integrations — premature centralization would couple integration onboarding paths that may legitimately diverge.

**Contribution guides should be scoped explicitly.** `integrations/code-graph-rag/CONTRIBUTING.md` demonstrates that integration-specific contribution conventions are worth documenting separately. When an integration has a distinct domain model, testing strategy, or workflow, a local `CONTRIBUTING.md` prevents those norms from being lost or misapplied to other integrations.

---

## Scalability and Maintainability Assessment

The decentralized onboarding model scales well as integrations grow in number and diverge in complexity — each integration team can evolve its own onboarding without coordination overhead. However, this model places the maintenance burden squarely on integration owners. There is no mechanism observed that would flag onboarding docs as stale when underlying tooling or configuration changes.

The three-layer structure (README → installation/configuration → tooling-specific setup) is a sustainable pattern, but only if integration owners treat onboarding docs as first-class artifacts. The existence of a dedicated `claude-code-setup.md` for code-graph-rag, which is tooling-specific, introduces a potential maintenance liability if Claude Code's MCP configuration interface changes — that document has no shared base to inherit updates from.

Overall, the maintainability of `IntegrationOnboarding` is **proportional to the discipline of individual integration owners**, which is a common trade-off in decentralized documentation architectures.


## Hierarchy Context

### Parent
- [MCPServerPattern](./MCPServerPattern.md) -- Each integration maintains a top-level README.md describing the tool interface: integrations/mcp-constraint-monitor/README.md ('MCP Constraint Monitor'), integrations/mcp-server-semantic-analysis/README.md ('MCP Server - Semantic Analysis'), and integrations/code-graph-rag/README.md each serve as the primary tool description entry point.

### Siblings
- [ArchitectureDoc](./ArchitectureDoc.md) -- integrations/mcp-server-semantic-analysis/docs/architecture/ contains three focused documents: agents.md ('Agent Architecture'), tools.md ('Tool Extensions'), and integration.md ('Integration Patterns'), separating concerns across agent design, tool extension points, and integration behavior.


---

*Generated from 3 observations*
