# LLMAbstraction

**Type:** Component

LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls through three distinct execution paths: mock mode (for testing), local inference via Docker Model Runner (DMR), and public cloud providers (Anthropic, OpenAI, Groq) routed through a rapid-llm-proxy. The system supports per-agent and global mode switching stored in `.data/workflow-progress.json`, allowing runtime toggling between modes without code changes. Provider selection follows a priority chain from per-agent overrides to global mode to legacy flags.

The architecture centers on a proxy-mediated request pattern where most LLM calls route through a local rapid-llm-proxy daemon (default port 12435) via `/api/complete`, enabling centralized token tracking, tier-based routing, and telemetry attribution. The `llm-with-process.ts` module exists specifically to inject a `process` tag into proxy requests — a gap in the SDK's `LLMService.complete()` that caused all wave-analysis calls to appear as `process='unknown'` in token-usage telemetry. DMR provider uses an OpenAI-compatible API at `localhost:${DMR_PORT}/engines/v1` for fully local inference.

Key patterns include: environment-variable-driven URL resolution with multiple fallback levels, singleton client instances with health-check caching, YAML-based provider configuration with env-var expansion, and SDK-shape response normalization ensuring downstream consumers work unchanged regardless of which provider path was taken.

# LLMAbstraction — Technical Reference

## What It Is

LLMAbstraction is the provider-agnostic LLM execution layer for the Coding project, implemented primarily across `llm-mock-service.ts`, `llm-with-process.ts`, and `dmr-provider.ts`, with YAML configuration in `config/dmr-config.yaml` and runtime state persisted to `.data/workflow-progress.json`. It abstracts over three distinct execution paths — mock mode (for testing), local inference via Docker Model Runner (DMR), and public cloud providers (Anthropic, OpenAI, Groq) routed through a `rapid-llm-proxy` daemon — behind a unified interface that downstream call-sites consume without needing to know which path is active.

As a child of the Coding root component, LLMAbstraction serves the same agent-agnostic philosophy seen throughout the project (described in CodingPatterns): just as agent configurations are unified under `config/agent-profiles.json`, LLM provider configurations are unified under a single abstraction layer that routes at runtime. Its five child components — AgentModeRouter, ProxyUrlResolver, ProxyMediatedLLMClient, DMRLocalInferenceProvider, and MockModeProvider — each own a discrete slice of this routing and execution responsibility.

## Architecture and Design

![LLMAbstraction — Architecture](images/llmabstraction-architecture.png)

The central architectural decision is **proxy-mediated request routing**: most LLM calls do not reach cloud providers directly but instead pass through a local `rapid-llm-proxy` daemon (default port 12435) via its `/api/complete` endpoint. This indirection centralizes token tracking, tier-based routing, and telemetry attribution in one place rather than scattering them across individual provider clients. The proxy is treated as a stable local interface; the actual provider backend (Anthropic, OpenAI, Groq) is the proxy's concern, not the application's.

The three execution paths form a clear priority hierarchy managed by AgentModeRouter. The `getLLMMode()` function in `llm-mock-service.ts` resolves mode through a three-tier chain: per-agent override in `llmState.perAgentOverrides` → global `llmState.globalMode` → legacy `mockLLM` boolean flag. This design means a single agent can be pinned to mock mode while all others use DMR or cloud, without any code changes — only state in `.data/workflow-progress.json` changes. The legacy flag at the bottom of the chain provides backward-compatible migration without breaking existing callers.

A notable design gap and its targeted fix reveal the system's pragmatic approach: the `@rapid/llm-proxy` SDK's `LLMService.complete()` had no mechanism to inject a `process` tag, causing all wave-analysis calls to appear as `process='unknown'` in token-usage telemetry. Rather than forking the SDK, the system introduces `llm-with-process.ts` as a **thin direct-fetch wrapper** that bypasses the SDK solely to inject this field. This is a deliberate surgical fix — the module does one thing, and ProxyMediatedLLMClient documents exactly why it exists.

![LLMAbstraction — Relationship](images/llmabstraction-relationship.png)

## Implementation Details

**AgentModeRouter / `llm-mock-service.ts`** owns both mode resolution and persistence. `getLLMMode()` implements the three-tier priority chain. `setGlobalLLMMode()` and `setAgentLLMMode()` write to `.data/workflow-progress.json` (with the path made Docker-aware via `CODING_ROOT` env var override) while simultaneously maintaining the legacy `mockLLM` boolean, ensuring nothing that reads the old structure breaks during migration.

**ProxyMediatedLLMClient / `llm-with-process.ts`** has two responsibilities: URL resolution via `resolveProxyCompleteUrl()` and response normalization. The URL resolver implements four fallback levels — `RAPID_LLM_PROXY_URL` → `LLM_CLI_PROXY_URL` → `LLM_PROXY_URL` → `http://<CONNECTION_STRING_REDACTED> `OntologyRegistry` (accessed via a `LegacyOntologyAdapter` shim) to classify extracted observations into upper/lower ontology classes with configurable heuristic and LLM-assisted classification modes. The `OntologyClassificationAgent` manages lifecycle (initialize → classify → suggest extensions) and attaches `OntologyMetadata` (class, confidence, method, version) to every entity before persistence. Storage was migrated from a legacy `GraphDatabaseAdapter`+`PersistenceAgent` trio to a `KmCoreAdapter` surface in Phase 42.x, with field names preserved for minimal call-site disruption.

Key cross-cutting concerns include: LLM calls routed through `@rapid/llm-proxy`'s `LLMService` with token usage telemetry via `attachTokenLogger`; optional code-graph-rag integration via `CodeGraphAgent` (Tree-sitter AST + Memgraph) that gracefully degrades when the `uv` CLI or Memgraph TCP connection is unavailable; content staleness detection combining reference-pattern regex scanning and git-commit correlation via `GitStalenessDetector`; and trace files written to `logs/` for debugging non-fatally.


---

*Generated from 8 observations*
