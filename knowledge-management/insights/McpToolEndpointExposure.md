# McpToolEndpointExposure

**Type:** Detail

The MCP server pattern, referenced in docs/agent-integration-guide.md and docs/architecture/system-overview.md, enables orchestrating agents to treat pipeline stages as discrete tool invocations rather than direct function calls.

# McpToolEndpointExposure — Technical Insight Document

## What It Is

`McpToolEndpointExposure` is a design detail contained within the Pipeline component, which itself is hosted inside `integrations/mcp-server-semantic-analysis`. It represents the specific mechanism by which pipeline control logic is surfaced as discrete, callable MCP (Model Context Protocol) tool endpoints — making pipeline stages accessible to orchestrating agents through a standardized tool-invocation interface rather than through direct programmatic coupling.

This is not a standalone service or module but rather a structural characteristic of how the Pipeline is exposed within the MCP server boundary. The "exposure" in the name is precise: the concern here is the act of wrapping and presenting pipeline functionality as tool endpoints that external agents can discover and invoke.

## Architecture and Design

The core architectural decision captured by `McpToolEndpointExposure` is the **translation layer between pipeline control logic and the MCP tool protocol**. Rather than agents calling pipeline functions directly, the MCP server pattern — documented in `docs/agent-integration-guide.md` and `docs/architecture/system-overview.md` — interposes a tool-invocation boundary. Each pipeline stage or control action becomes a named tool that an orchestrating agent can call as an opaque unit of work.

This design reflects a deliberate **decoupling strategy**. Agents described in `docs/architecture/adding-new-agent.md` interact with the semantic analysis pipeline purely through the MCP tool interface, meaning they carry no direct code dependencies on pipeline internals. The Pipeline's internal structure — its stages, their sequencing, their data contracts — is an implementation detail hidden behind the tool endpoint surface. This is an inversion of the typical library-dependency model: consumers depend on a protocol, not on code.

The trade-off inherent in this approach is a degree of indirection and serialization overhead at every pipeline invocation. The gain is a clean contract boundary: the pipeline can evolve internally without breaking agents, and new agents (per `docs/architecture/adding-new-agent.md`) can be introduced without requiring access to pipeline source code.

## Implementation Details

Within `integrations/mcp-server-semantic-analysis`, the Pipeline component hosts `McpToolEndpointExposure` as the detail responsible for registering pipeline control actions as MCP tools. The MCP server framework provides the scaffolding for tool registration, schema declaration, and dispatch — `McpToolEndpointExposure` is the point where pipeline-specific logic is bound into that framework.

Concretely, this means pipeline stages are wrapped such that their inputs and outputs conform to whatever schema the MCP tool protocol requires. An orchestrating agent invoking a tool endpoint triggers the corresponding pipeline control logic through this wrapper, receiving results in a protocol-normalized form. The pipeline itself remains agnostic to the MCP layer; the exposure detail owns the translation.

The observations do not specify individual class names or function signatures within this component, so the precise registration mechanics cannot be detailed here. However, the structural location within `integrations/mcp-server-semantic-analysis` confirms this is an integration-layer concern, not a core pipeline concern.

## Integration Points

`McpToolEndpointExposure` sits at the intersection of two systems: the semantic analysis Pipeline (its parent) and the orchestrating agents that consume it. The Pipeline provides the logic being exposed; the MCP server infrastructure (`integrations/mcp-server-semantic-analysis`) provides the transport and protocol layer. `McpToolEndpointExposure` is the seam between them.

Agents onboarded per `docs/architecture/adding-new-agent.md` are the primary consumers of the endpoints this detail creates. The agent integration guide (`docs/agent-integration-guide.md`) and system overview (`docs/architecture/system-overview.md`) together define the contract that agents rely on — any change to how endpoints are exposed here has downstream implications for all agents using those tools.

There are no sibling components explicitly identified in the observations, but by nature of its position within Pipeline, `McpToolEndpointExposure` is the outward-facing surface of everything the Pipeline does. It effectively owns the public API of the pipeline within the MCP ecosystem.

## Usage Guidelines

Developers adding new pipeline stages or modifying existing ones should treat `McpToolEndpointExposure` as the mandatory registration point for any functionality that orchestrating agents need to access. Pipeline logic that is not surfaced through this detail is invisible to agents — it exists only as internal implementation.

When onboarding a new agent (following `docs/architecture/adding-new-agent.md`), developers should consult `docs/agent-integration-guide.md` to understand which tool endpoints are available and what their expected input/output schemas are. Agents should not attempt to bypass the MCP tool boundary to call pipeline logic directly, as this would reintroduce the coupling this architecture is designed to eliminate.

Changes to the endpoint surface — renaming tools, altering schemas, removing endpoints — are breaking changes for any agent currently consuming those tools. Versioning or backward-compatibility conventions for tool endpoints should be established and respected, even though the observations do not describe a specific versioning scheme at this time.

---

**Architectural Patterns Identified:** Protocol-mediated decoupling (MCP tool protocol as interface boundary); integration-layer wrapping of domain logic.

**Key Design Trade-off:** Indirection and serialization cost in exchange for zero code-level coupling between agents and pipeline internals.

**Scalability Consideration:** New agents can be added without pipeline changes; new pipeline capabilities require only endpoint registration, not agent-side code changes — both axes of growth are independently manageable.

**Maintainability Assessment:** High, within its constraints. The boundary is clean and the responsibility is singular. The main maintenance risk is endpoint schema drift breaking consumers, which requires disciplined change management at this surface.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- Pipeline is hosted within the `integrations/mcp-server-semantic-analysis` directory, establishing it as an MCP server that exposes pipeline control as tool endpoints to orchestrating agents


---

*Generated from 3 observations*
