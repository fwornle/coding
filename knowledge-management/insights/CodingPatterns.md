# CodingPatterns

**Type:** Component

CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design patterns, and best practices that permeate the entire codebase. The project follows consistent patterns visible across its configuration, tooling, and documentation: agent abstractions use a constructor+initialize+execute lifecycle, shell scripts in bin/ follow a proxy/delegation pattern to underlying services, and configuration is externalized into config/ YAML/JSON files rather than hardcoded values. The system emphasizes agent-agnostic design, enabling multiple AI backends (Claude, Copilot, Mastra, OpenCode) to operate under a unified interface.

# CodingPatterns: Technical Reference

## What It Is

CodingPatterns is the cross-cutting architectural layer of the Coding project, functioning as a catalog of conventions and design principles that unify the system's disparate components. Rather than mapping to a single implementation path, it manifests across multiple directories: agent adapters in `config/agents/` (claude.sh, copilot.sh, mastra.sh, opencode.sh), CLI entry points in `bin/` (coding, coding.bat, llm, vkb), externalized configuration in `config/` (llm-providers.yaml, agent-profiles.json, hooks-config.json, logging-config.json), team definitions in `config/teams/` (coding.json, agentic.json, ui.json), and process orchestration in `docker/` (supervisord.conf, entrypoint.sh). Its codification lives in documentation such as `docs/architecture/adding-new-agent.md` and `CLAUDE.md`, which elevate these conventions from implicit practice to first-class architectural constraints.

As a child of the Coding root, CodingPatterns exists precisely because the project spans several substantial subsystems—LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, ConstraintSystem, and SemanticAnalysis—each of which independently exhibits the same conventions. CodingPatterns names and formalizes those conventions so they can be reasoned about, extended, and enforced consistently.

![CodingPatterns — Relationship](images/coding-patterns-relationship.png)

## Architecture and Design

The architecture of CodingPatterns is best understood as five interlocking design principles, each implemented as a child entity with its own scope.

**AgentAdapterPattern** governs how AI backends are integrated. The four shell scripts in `config/agents/` act as uniform adapters: regardless of whether the underlying provider is Claude, Copilot, Mastra, or OpenCode, the invocation surface is identical. This is reinforced by `docs/architecture/agent-abstraction-api.md`, which defines the contract all adapters must satisfy. The pattern insulates the rest of the system from provider-specific invocation details, making LLMAbstraction's provider-agnostic routing tractable.

**CLIEntryPointPattern** enforces a strict separation between user-facing commands and implementation logic. The `bin/` scripts are deliberately thin—they are proxies that delegate downward, not orchestrators. `CLAUDE.md` names this delegation intent explicitly, which means it is a documented constraint rather than an emergent shortcut. This pairs naturally with DockerizedServices, where the same delegation logic appears in `docker/entrypoint.sh` proxying to supervisord.

**ExternalizedConfiguration** disperses all behavioral configuration into `config/` files organized by concern: provider routing (`llm-providers.yaml`), agent behavior (`agent-profiles.json`), hook lifecycle (`hooks-config.json`), and observability (`logging-config.json`). Credentials follow the same principle at the environment variable level—`LLM_PROXY_URL`, `RAPID_LLM_PROXY_URL`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` are never in-code constants. This directly enables LLMAbstraction's three execution modes (mock, local, public) to be switched without code changes, and supports ConstraintSystem's hook configuration without recompilation.

**DeclarativeTeamComposition** extends externalization specifically to multi-agent workflow assembly. `config/teams/coding.json`, `agentic.json`, and `ui.json` define agent membership and roles as data, meaning new team configurations can be created or modified at runtime without touching application code. This is the mechanism by which the AgentAgnosticDesignPrinciple becomes operational: the system doesn't need to know at compile time which agents will participate in a workflow.

**AgentAgnosticDesignPrinciple** is the overarching design constraint that the other four patterns collectively enforce. `CLAUDE.md` names it explicitly as a core architectural principle, giving it the status of a documented invariant rather than an aspiration.

![CodingPatterns — Architecture](images/coding-patterns-architecture.png)

## Implementation Details

The agent adapter implementation in `config/agents/` uses shell scripts as the adapter layer rather than a language-level abstraction. This is a deliberate trade-off: shell scripts are provider-neutral, require no runtime dependencies, and can be executed by any orchestration layer. The cost is limited composability, but the uniform invocation interface compensates by making the adapters interchangeable from the caller's perspective. The constructor+initialize+execute lifecycle documented for agent abstractions maps onto how these scripts are sourced and invoked.

Configuration externalization is implemented with per-concern file granularity rather than a single monolithic config. This means `hooks-config.json` can be modified to adjust ConstraintSystem behavior without touching `llm-providers.yaml`, and `logging-config.json` changes are isolated from agent profiles. The KnowledgeManagement component mirrors this pattern at the persistence layer: `graph-database-config.json` externalizes the graph backend configuration, and the GraphKMStore uses JSON export sync as a secondary format alongside graph-native persistence.

The `docker/` process management pattern uses supervisord (`supervisord.conf` + `entrypoint.sh`) to orchestrate multiple services within a single container. This is documented in `docs/health-system/dual-supervisor-resolution`, indicating the pattern was intentional enough to warrant a dedicated architecture diagram. DockerizedServices implements this directly, and the pattern is consistent with the broader delegation idiom: `entrypoint.sh` delegates to supervisord, which delegates to individual service processes.

The extensibility pattern codified in `docs/architecture/adding-new-agent.md` is particularly significant. By documenting a repeatable procedure for adding agents, the project converts extensibility from an emergent property into an explicit architectural affordance. New providers can be added by following the documented steps: creating a shell adapter in `config/agents/`, registering in `llm-providers.yaml`, and defining behavior in `agent-profiles.json`.

## Integration Points

CodingPatterns integrates pervasively rather than through a single interface. LLMAbstraction consumes ExternalizedConfiguration directly—its per-agent overrides in `workflow-progress.json` and provider routing in `llm-providers.yaml` are instances of the externalization pattern. The `llm-with-process.ts` direct-fetch wrapper and DMR provider both operate under the AgentAgnosticDesignPrinciple by conforming to the unified provider interface.

ConstraintSystem's hook-based interception architecture is configured through `hooks-config.json`, making it a direct consumer of ExternalizedConfiguration. The pre-tool and post-tool hook events that drive constraint evaluation are registered declaratively rather than in code, consistent with the pattern's intent.

LiveLoggingSystem and SemanticAnalysis both operate as downstream consumers of agent outputs, and both benefit from the AgentAdapterPattern's uniform invocation surface—they receive normalized outputs regardless of which AI backend produced them. KnowledgeManagement's graph-first persistence with JSON export sync is itself an instance of the externalized, human-readable artifact pattern that CodingPatterns establishes for configuration.

DockerizedServices is the most direct structural consumer of the CLIEntryPointPattern and the supervisor process management pattern, implementing both in `docker/entrypoint.sh` and `docker/supervisord.conf`.

## Usage Guidelines

When adding a new AI backend, follow `docs/architecture/adding-new-agent.md` exactly. The documented sequence—shell adapter in `config/agents/`, provider entry in `llm-providers.yaml`, behavior definition in `agent-profiles.json`—is not optional scaffolding; it is what makes the new backend participate correctly in DeclarativeTeamComposition and remain compliant with the AgentAgnosticDesignPrinciple.

Configuration changes should always go to the appropriate `config/` file rather than into code. Credentials must be environment variables; any deviation from this breaks the externalization contract that enables environment-specific deployments (mock, local, public) to work without code changes.

New CLI entry points in `bin/` should follow the delegation idiom: keep the entry point thin, proxy to service logic below, and avoid accumulating business logic at the command layer. This is what keeps the user-facing surface stable as the underlying implementation evolves.

When defining new multi-agent workflows, use `config/teams/` JSON files. Team composition is data, not code—this is the mechanism that keeps the system adaptable without recompilation. Any workflow that hardcodes agent selection violates DeclarativeTeamComposition and couples the workflow to a specific backend configuration.

The supervisor-based container pattern in `docker/` should be treated as the standard deployment unit for services that require co-located process management. New services added to the Docker environment should register with `supervisord.conf` and expose health endpoints compatible with the dual probe mechanism (HTTP health endpoint + TCP port check) documented in `docs/health-system/dual-supervisor-resolution`.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude C; LLMAbstraction: LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local ; DockerizedServices: DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint mo; KnowledgeManagement: The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lif; CodingPatterns: CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design pattern; ConstraintSystem: The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interac; SemanticAnalysis: The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized a.

### Children
- [AgentAdapterPattern](./AgentAdapterPattern.md) -- docs/architecture/agent-abstraction-api.md defines the unified Agent Abstraction API that all backends must conform to, serving as the contract between adapters and consumers
- [CLIEntryPointPattern](./CLIEntryPointPattern.md) -- CLAUDE.md describes bin/ scripts as proxies that delegate to underlying services, establishing delegation as the explicit architectural intent rather than an implementation detail
- [DeclarativeTeamComposition](./DeclarativeTeamComposition.md) -- config/teams/ directory holds JSON files that define which agents participate in a team and their roles, as described in the architecture documentation
- [ExternalizedConfiguration](./ExternalizedConfiguration.md) -- LLM_PROXY_URL, RAPID_LLM_PROXY_URL, OPENAI_API_KEY, and ANTHROPIC_API_KEY are all documented as environment variables rather than in-code constants, enforcing externalization at the credential level
- [AgentAgnosticDesignPrinciple](./AgentAgnosticDesignPrinciple.md) -- CLAUDE.md explicitly names agent-agnostic design as a core architectural principle, making backend independence a first-class documented constraint rather than an emergent property

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude Code—into a unified format. It handles session windowing (time-window identifiers like '0800-0900'), multi-user support via SHA-256 user hashing, file routing with rotation thresholds, and transcript capture from agent-native formats. The system bridges raw agent transcripts to a normalized LSL format used downstream by semantic analysis and knowledge management pipelines.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local inference backends. It provides three distinct execution modes (mock, local, public) with per-agent overrides stored in a workflow-progress.json file, allowing dynamic routing without code changes. The architecture consists of a mock service for testing, a DMR (Docker Model Runner) provider for local inference, and a direct-fetch wrapper (llm-with-process.ts) that bypasses the SDK to inject telemetry process tags into the rapid-llm-proxy endpoint.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, and Redis into a unified Docker Compose deployment. The architecture centers on docker/docker-compose.yml and docker/Dockerfile.coding-services with supervisord.conf managing multiple processes within a container. Service health is verified through two probe mechanisms: HTTP health endpoints and TCP port checks, used by the health coordinator to track service liveness with strict contracts (never returning 'healthy', only 'running'/'stopped'/'unknown').
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lifecycle management, and graph query capabilities. It is built on a Graphology in-memory graph with LevelDB as the persistence backend, exposing entities with typed attributes (System, Project, Pattern) and relationships. The system supports both local graph operations and integration with external graph databases like Memgraph via the CodeGraphAgent, which uses Tree-sitter AST parsing to index repositories into a queryable knowledge graph.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions. It operates through a hook-based interception architecture where pre-tool and post-tool hook events capture agent actions, evaluate them against constraint rules, and record violations for persistence and dashboard display. The system bridges live session activity with persistent storage via the ViolationCaptureService, which writes violations to JSONL logs and maintains a JSON history file in the .mcp-sync directory for dashboard consumption.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized agents to extract, classify, validate, and persist structured knowledge from git history and LSL (Live Session Log) sessions. It combines AST-based code graph construction, LLM-powered semantic insight generation, ontology classification, and content validation into a coordinated batch-analysis workflow. The pipeline produces structured knowledge entities enriched with ontology metadata before persisting them to a graph-based knowledge store.


---

*Generated from 8 observations*
