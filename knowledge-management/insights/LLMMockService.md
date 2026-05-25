# LLMMockService

**Type:** SubComponent

As a singleton-style controller (implied by 'service' naming convention and the PSM singleton pattern described in the parent DockerizedServices), llm-mock-service.ts likely exposes a global mode-get/set interface consumed by agent factory or dispatcher code in the semantic analysis server.

# LLMMockService — Technical Insight Document

## What It Is

LLMMockService is implemented in `llm-mock-service.ts`, located in the `mock/` subdirectory of the semantic analysis server (under `integrations/mcp-server-semantic-analysis/`). It functions as a SubComponent within the broader DockerizedServices parent, serving as the controller that governs how LLM backends are selected and substituted across the MCP semantic analysis server's agent population. Rather than performing inference itself, it acts as a mode-routing facade that determines whether agents receive responses from a deterministic mock provider, a local model, or a public API endpoint.

The service is governed by three distinct operational modes — `mock`, `local`, and `public` — formally documented in `integrations/mcp-server-semantic-analysis/docs/configuration.md`. These modes can be toggled at runtime without rebuilding the underlying Docker image, making the service a critical configuration surface for operators running the containerized stack. Its placement in the `mock/` subdirectory is deliberate: it isolates this substitution machinery from production LLM routing code, preventing accidental cross-contamination between test scaffolding and live inference paths.

![LLMMockService — Architecture](images/llmmock-service-architecture.png)

## Architecture and Design

The architectural approach evident in `llm-mock-service.ts` follows a **singleton-style controller pattern**, consistent with the broader PSM (ProcessStateManager) singleton convention established by the parent DockerizedServices layer. The "service" suffix in its naming is intentional and signals that a single, globally-accessible mode-management instance is consumed by downstream callers — likely the agent factory or dispatcher code within the semantic analysis server. This design ensures that mode changes propagate atomically to all agents that consult the controller, rather than each agent maintaining its own divergent configuration.

A key architectural decision is the **strategy pattern overlay** implied by the three-mode toggle. Each mode (`mock`/`local`/`public`) represents a distinct backend strategy, and the service abstracts the selection logic behind a uniform interface. The mock mode delegates to the child component `MockResponseProvider`, which supplies deterministic responses for offline operation. The local and public modes presumably hand off to real LLM clients, but the routing decision is centralized in `llm-mock-service.ts`.

The service also implements a **per-agent override capability**, as documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`. This means individual agents can be pinned to a specific LLM mode independent of the global default — a hierarchical configuration model where agent-level settings take precedence over the singleton's global state. This trade-off accepts increased configuration complexity in exchange for fine-grained experimental control, allowing operators to, for instance, run most agents on the public API while pinning a single agent to mock mode for debugging.

## Implementation Details

While the observations do not enumerate specific code symbols within `llm-mock-service.ts`, the design surface can be inferred from its responsibilities. The service almost certainly exposes a global **mode-get/set interface** — methods that read and mutate the current LLM mode — which is the primary contract consumed by agent construction code elsewhere in the MCP server. The singleton instance is the authoritative source of truth for "which backend should an agent use right now."

The substitution mechanics in mock mode rely on the child entity `MockResponseProvider`, which is contained within LLMMockService. This containment relationship means `MockResponseProvider` is invoked by `llm-mock-service.ts` whenever the active mode resolves to `mock`, returning deterministic, reproducible responses suitable for CI environments. The deterministic nature of these responses is what makes fully offline operation viable inside Docker — there is no network egress, no API key, and no nondeterminism that would break snapshot-style test assertions.

![LLMMockService — Relationship](images/llmmock-service-relationship.png)

Configuration ingestion likely occurs at service initialization, reading values that originate from the environment variables or config files described in `docs/configuration.md`. Because the service must support per-agent overrides, it likely accepts an optional agent identifier when <USER_ID_REDACTED>, returning the effective mode after applying override precedence rules over the global default.

## Integration Points

The most significant integration is with the **agent layer** of the MCP semantic analysis server. Per `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, agents consult LLMMockService when they need to determine which LLM backend to invoke. This makes the service a foundational dependency for any agent-driven workflow — every inference request implicitly flows through the mode resolution logic before reaching an actual LLM provider.

LLMMockService is contained by **DockerizedServices**, which provides the broader containerization and lifecycle management context. The parent's wrapper scripts (`api-service.js`, `dashboard-service.js`) and `lib/service-starter.js` retry logic handle process orchestration, while LLMMockService operates within the running MCP server container as an in-process module. The PSM singleton pattern used elsewhere in DockerizedServices is mirrored here, providing architectural consistency across the suite.

The service contains **MockResponseProvider** as a child component — this is the only direct dependency-down relationship in the current model. MockResponseProvider is invoked exclusively when mock mode is active, and it encapsulates the deterministic response generation that distinguishes mock operation from local or public modes. The remaining backends (local model runners, public API clients) are presumably referenced through other modules that LLMMockService dispatches to, though those are not enumerated in the current observations.

Configuration consumers — including the documentation set under `integrations/mcp-server-semantic-analysis/docs/` — depend on the public mode contract remaining stable. Changes to mode names or override semantics would require coordinated updates across `configuration.md`, `agents.md`, and any agent factory code that constructs mode-aware clients.

## Usage Guidelines

Developers working with LLMMockService should respect its placement in the `mock/` subdirectory: production LLM routing code should not import directly from this module unless it specifically needs to interact with the mode-toggle facade. The isolation is intentional, and bypassing it risks coupling production paths to test scaffolding.

When operating the containerized stack, prefer **mock mode for CI pipelines** where external API access may be blocked or where deterministic outputs are required for reproducible test runs. Switching modes does not require a Docker image rebuild — the toggle is a runtime configuration concern, so operators should update environment configuration rather than rebuilding artifacts when changing backends.

For agent authors, use the **per-agent override** capability sparingly. Global mode selection is the default and is easier to reason about; per-agent pinning should be reserved for cases where a specific agent genuinely requires a different backend (for example, a debugging agent that must remain on mock mode regardless of global configuration). Document any per-agent overrides clearly, because they create configuration state that is not visible from the global mode setting alone.

When extending LLMMockService — for instance, adding a new backend mode — ensure that the new mode is documented in `integrations/mcp-server-semantic-analysis/docs/configuration.md` and that the singleton contract is preserved. New modes should follow the existing three-mode pattern (`mock`/`local`/`public`) in spirit: each mode should represent a distinct, well-defined backend strategy rather than a variation of an existing one. If the new mode requires deterministic test substitution, consider implementing a sibling to MockResponseProvider rather than overloading the existing one.

Finally, treat the service as a **lifecycle-aware singleton** in line with the PSM pattern used by DockerizedServices. Mode state should be established during container startup and remain stable through normal operation; mid-flight mode changes are technically supported but should be regarded as an exceptional operation rather than a routine one, since in-flight inference requests may have already committed to a particular backend before the toggle takes effect.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasses the MCP semantic analysis server, constraint monitor (API on port 3031, dashboard on port 3030), code-graph-rag integration, and supporting databases (Memgraph, Redis). The architecture uses wrapper scripts (api-service.js, dashboard-service.js) that spawn child processes, register them with a ProcessStateManager (PSM) singleton, and forward OS signals for graceful shutdown. Services are classified as required or optional with retry-with-backoff startup logic handled by lib/service-starter.js.

### Children
- [MockResponseProvider](./MockResponseProvider.md) -- Based on parent context, llm-mock-service.ts resides in the mock/ subdirectory of the semantic analysis server, indicating intentional isolation from production LLM routing logic.


---

*Generated from 5 observations*
