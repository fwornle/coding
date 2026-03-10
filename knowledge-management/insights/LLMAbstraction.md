# LLMAbstraction

**Type:** Component

LLMAbstraction is a component of the Coding project. Abstraction layer over LLM providers (Anthropic, OpenAI, Groq) enabling provider-agnostic model calls, tier-based routing, and mock mode for testing.. It contains 0 sub-components: .

## What It Is  

**LLMAbstraction** is the dedicated component that lives inside the **Coding** project and provides a unified, provider‑agnostic façade over the three large‑language‑model (LLM) services used by the system: **Anthropic**, **OpenAI**, and **Groq**. The implementation lives in the source tree under the files **`src/llm-service.ts`** (the concrete service class) and **`src/llm-mock-service.ts`** (the mock‑mode implementation). By exposing a single, consistent API, the rest of the codebase can request a model call without needing to know which vendor will actually fulfil the request. In addition to abstracting the provider details, the component also supports **tier‑based routing** – a policy that decides, at run‑time, which provider (or which pricing tier within a provider) should be used for a given request – and a **mock mode** that substitutes the real providers with a deterministic stub for testing and CI pipelines.

The component does not contain any sub‑components of its own; instead it is a leaf node in the hierarchy beneath the root **Coding** component. Its siblings – **LiveLoggingSystem**, **DockerizedServices**, **Trajectory**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis** – each address orthogonal concerns (logging, containerisation, planning, knowledge graph handling, design guidance, constraint enforcement, and semantic analysis respectively). This placement makes LLMAbstraction the single source of truth for any part of the system that needs to interact with an LLM, whether that part is the logging system that records prompts, the trajectory planner that generates task descriptions, or the semantic analysis pipeline that extracts meaning from code.

---

## Architecture and Design  

The design of LLMAbstraction follows a **provider‑strategy** approach. The core class in **`llm-service.ts`** acts as the *context* that delegates the actual request to a concrete provider implementation selected at run‑time. The selection logic embodies the **tier‑based routing** policy: based on configuration (e.g., cost tier, latency requirements, or feature availability) the service chooses the appropriate provider adapter (Anthropic, OpenAI, or Groq). This mirrors the classic **Strategy pattern**, where each provider adapter implements a common interface (e.g., `callModel(request): Promise<Response>`), allowing the context to remain oblivious to vendor‑specific details.

For testing, the component swaps the real service with the **mock implementation** found in **`llm-mock-service.ts`**. This mock class implements the same interface as the production adapters, enabling seamless substitution via dependency injection. The presence of a dedicated mock service reflects an **Adapter pattern** used to present a uniform contract to callers while hiding the underlying mock behaviour. Because the mock is a full‑featured stand‑in, developers can write unit and integration tests that exercise the routing and response handling logic without incurring external API calls or cost.

Interaction with other components is straightforward: any sibling that needs an LLM call imports the exported façade from **`llm-service.ts`** (or the mock façade when running in test mode). There is no direct coupling to the concrete provider SDKs; those dependencies are encapsulated inside the provider adapters. This isolation supports the **Separation of Concerns** principle and keeps the LLMAbstraction component focused on routing, abstraction, and testability.

---

## Implementation Details  

1. **`llm-service.ts`** – This file defines the primary service class (e.g., `LLMService`). It holds configuration that describes the routing tiers (such as a JSON map of tier → provider). When a consumer calls `LLMService.invoke(request)`, the service:
   * Inspects the request metadata (e.g., required latency, budget, or model capability).
   * Looks up the appropriate tier in the routing table.
   * Instantiates or retrieves the concrete provider adapter (AnthropicAdapter, OpenAIAdapter, GroqAdapter) that implements the shared interface.
   * Delegates the request to the adapter and returns the provider’s response.

2. **Provider adapters** – Although not listed explicitly in the observations, the description of “provider‑agnostic model calls” implies that each vendor has a thin wrapper implementing the shared contract. These adapters translate the generic request shape into the vendor‑specific HTTP payloads, handle authentication (API keys), and normalise the response format.

3. **`llm-mock-service.ts`** – This mock module implements the same interface as the real adapters. Its `invoke` method returns pre‑canned responses or deterministic data derived from the request payload. The mock can be toggled via an environment flag (e.g., `LLM_MOCK_MODE=true`) or a configuration entry in the parent **Coding** component, allowing the entire system to run in an isolated test environment.

4. **Configuration & Tier Routing** – The routing rules are stored in a configuration file (likely JSON or YAML) that lives alongside the service code. The rules map logical tiers (e.g., `fast`, `cheap`, `high‑quality`) to concrete providers and possibly to specific model identifiers (e.g., `gpt‑4o`, `claude‑3‑sonnet`). Because the routing logic resides in a single place, updating a tier (for cost optimisation or new provider onboarding) requires only a change to this config, not to any consumer code.

5. **Exported façade** – Both the real and mock implementations expose a single exported symbol (e.g., `export const llm = new LLMService(...)`). Consumers import this symbol, guaranteeing that they always talk to the same abstraction layer regardless of the underlying mode.

---

## Integration Points  

LLMAbstraction sits at the intersection of several other major components:

* **LiveLoggingSystem** – When a user session generates a prompt, the logging system records the raw request and the eventual LLM response. It does so by invoking the LLMAbstraction façade, ensuring that logs capture the exact payload that traversed the provider‑agnostic layer.
* **Trajectory** – The planning component may generate high‑level task descriptions that need to be expanded into detailed instructions via an LLM. It calls the abstraction layer, relying on tier‑based routing to balance speed (for rapid prototyping) against cost (for production runs).
* **SemanticAnalysis** – This pipeline analyses code and commit history, occasionally delegating to an LLM for natural‑language summarisation. By using the same abstraction, the analysis service can switch between real providers and the mock service without code changes.
* **DockerizedServices** – The containerisation layer packages the LLMAbstraction service together with its configuration and mock assets, ensuring that the same image can be deployed in development, staging, or production environments. The mock mode is particularly useful in CI containers where external network calls are undesirable.
* **ConstraintSystem** – Any policy that restricts usage (e.g., maximum tokens per month) can be enforced by inspecting the tier chosen by LLMAbstraction before the request is forwarded, creating a natural integration point for governance.

All dependencies flow **into** LLMAbstraction (provider SDKs, configuration files) and **out** via a clean, versioned TypeScript interface. No sibling component directly imports a vendor SDK, preserving a low coupling architecture.

---

## Usage Guidelines  

1. **Always import the façade** – Consumers should import the exported instance from `llm-service.ts` (or the mock façade when the `LLM_MOCK_MODE` flag is set). Directly importing provider SDKs circumvents the abstraction and should be avoided.

2. **Specify routing metadata** – When calling `llm.invoke(request)`, include a `tier` field (e.g., `"fast"` or `"high‑quality"`). This field drives the tier‑based routing logic; omitting it will fall back to the default tier defined in the configuration.

3. **Prefer mock mode for tests** – Unit tests, integration tests, and CI pipelines should enable mock mode via environment configuration. The mock service guarantees deterministic responses and eliminates external API latency or cost.

4. **Guard against provider limits** – Although the abstraction hides vendor specifics, developers should still respect known limits (e.g., maximum token count) by checking the response metadata returned by the service. The `Response` object includes fields such as `usage.tokens` that can be inspected.

5. **Update routing via configuration only** – Adding a new provider or re‑balancing tiers should be done by editing the routing configuration file, not by modifying consumer code. After a config change, a service restart (or hot‑reload if supported) is sufficient to apply the new routing rules.

6. **Version control the mock responses** – When extending the mock service, store the canned responses alongside the test suite. This practice ensures that test expectations remain stable across code changes.

---

### Architectural patterns identified  

* **Strategy pattern** – Provider adapters selected at run‑time based on tier routing.  
* **Adapter pattern** – Uniform interface for real providers and the mock implementation.  
* **Dependency injection / Configuration‑driven selection** – Routing logic driven by external configuration, enabling easy swapping of providers.  

### Design decisions and trade‑offs  

* **Provider‑agnostic façade** – Gains flexibility and reduces duplication, at the cost of an extra indirection layer and the need to maintain adapters for each vendor.  
* **Tier‑based routing** – Allows cost/latency optimisation but introduces complexity in configuration management and requires careful monitoring to avoid unintended provider overload.  
* **Mock service** – Improves testability and CI speed, yet developers must keep mock responses in sync with real provider behaviour to avoid false confidence.  

### System structure insights  

LLMAbstraction is a leaf component under the **Coding** root, acting as a shared service for all siblings that need language‑model capabilities. Its isolation from vendor SDKs enforces a clean contract and makes the overall system more modular.  

### Scalability considerations  

Because routing is configuration‑driven, scaling horizontally (e.g., running multiple instances of the service behind a load balancer) does not affect provider selection. Adding new providers or tiers is a matter of extending the config and supplying a new adapter, which scales well as the ecosystem of LLM vendors grows.  

### Maintainability assessment  

The clear separation of concerns—routing logic, provider adapters, and mock implementation—supports high maintainability. The single source of truth for routing reduces the risk of divergent behaviour across components. However, the component’s health depends on keeping the adapters up‑to‑date with each vendor’s API changes; a systematic version‑upgrade process for the provider SDKs is essential to prevent drift.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: LiveLoggingSystem is a component of the Coding project. Live session logging infrastructure capturing Claude Code conversations. Handles session windo; LLMAbstraction: LLMAbstraction is a component of the Coding project. Abstraction layer over LLM providers (Anthropic, OpenAI, Groq) enabling provider-agnostic model c; DockerizedServices: DockerizedServices is a component of the Coding project. Docker containerization layer for all coding services including semantic analysis MCP, constr; Trajectory: Trajectory is a component of the Coding project. AI trajectory and planning system managing project milestones, GSD workflow, phase planning, and impl; KnowledgeManagement: KnowledgeManagement is a component of the Coding project. Knowledge graph storage, query, and lifecycle management including the VKB server, graph dat; CodingPatterns: CodingPatterns is a component of the Coding project. General programming wisdom, design patterns, best practices, and coding conventions applicable ac; ConstraintSystem: ConstraintSystem is a component of the Coding project. Constraint monitoring and enforcement system that validates code actions and file operations ag; SemanticAnalysis: SemanticAnalysis is a component of the Coding project. Multi-agent semantic analysis pipeline (batch-analysis workflow) that processes git history and.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- LiveLoggingSystem is a component of the Coding project. Live session logging infrastructure capturing Claude Code conversations. Handles session windowing, file routing, classification layers, and transcript capture.. It contains 0 sub-components: .
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices is a component of the Coding project. Docker containerization layer for all coding services including semantic analysis MCP, constraint monitor, code-graph-rag, and supporting databases.. It contains 0 sub-components: .
- [Trajectory](./Trajectory.md) -- Trajectory is a component of the Coding project. AI trajectory and planning system managing project milestones, GSD workflow, phase planning, and implementation task tracking.. It contains 0 sub-components: .
- [KnowledgeManagement](./KnowledgeManagement.md) -- KnowledgeManagement is a component of the Coding project. Knowledge graph storage, query, and lifecycle management including the VKB server, graph database, entity persistence, and knowledge decay tracking.. It contains 2 sub-components: ManualLearning, OnlineLearning.
- [CodingPatterns](./CodingPatterns.md) -- CodingPatterns is a component of the Coding project. General programming wisdom, design patterns, best practices, and coding conventions applicable across the project. Catch-all for entities not fitting other components.. It contains 0 sub-components: .
- [ConstraintSystem](./ConstraintSystem.md) -- ConstraintSystem is a component of the Coding project. Constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions.. It contains 0 sub-components: .
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a component of the Coding project. Multi-agent semantic analysis pipeline (batch-analysis workflow) that processes git history and LSL sessions to extract and persist structured knowledge entities.. It contains 3 sub-components: Pipeline, Ontology, Insights.


---

*Generated from 4 observations*
