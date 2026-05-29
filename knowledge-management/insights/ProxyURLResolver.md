# ProxyUrlResolver

**Type:** SubComponent

llm-with-process.ts checks RAPID_LLM_PROXY_URL first, then falls back to LLM_CLI_PROXY_URL, then LLM_PROXY_URL, and finally a port-based default, creating a priority chain that allows environment-specific overrides without code changes

## What It Is

`ProxyUrlResolver` is a URL resolution sub-component embedded directly within `llm-with-process.ts`, which serves as the direct-fetch wrapper layer inside LLMAbstraction. Rather than existing as a standalone class or module, the resolver is a logical component — a priority chain of environment variable lookups that determines which proxy endpoint all LLM traffic should target at runtime.

## Architecture and Design

The resolver implements a **priority-chain fallback pattern**: it checks `RAPID_LLM_PROXY_URL` first, then `LLM_CLI_PROXY_URL`, then `LLM_PROXY_URL`, and finally defaults to a port-based localhost address. This ordering reflects a deliberate hierarchy of specificity — from a named production target down to a zero-config local development default.

![ProxyUrlResolver — Architecture](images/proxy-url-resolver-architecture.png)

The key architectural decision is centralization. Rather than distributing proxy URL logic across individual provider implementations (Anthropic, OpenAI, Groq, DMR), resolution is consolidated inside `llm-with-process.ts`. This means all three execution modes that LLMAbstraction supports — mock, local, and public — funnel through the same resolution logic. A routing inconsistency at the URL level is therefore structurally impossible regardless of which mode or provider is active.

The separation between `RAPID_LLM_PROXY_URL` and the generic `LLM_PROXY_URL` is a meaningful design signal. The rapid-llm-proxy endpoint is the telemetry-injecting target, and `llm-with-process.ts` exists specifically to reach it by bypassing standard SDK clients. Treating `RAPID_LLM_PROXY_URL` as the primary production variable reinforces that distinction — it is not just another proxy, but the canonical routing destination for instrumented inference traffic.

![ProxyUrlResolver — Relationship](images/proxy-url-resolver-relationship.png)

## Implementation Details

The resolution logic lives entirely within `llm-with-process.ts`. The chain evaluates environment variables in order, using the first defined value. This is idiomatic Node.js environment handling and keeps the implementation minimal — no configuration files, no registry, no external service discovery. The port-based localhost fallback is the lowest-priority rung and exists so that local development requires zero environment setup; developers can run the proxy on a known port and get working resolution automatically.

The fact that `llm-with-process.ts` bypasses SDK clients is directly related to why `ProxyUrlResolver` exists here rather than elsewhere in LLMAbstraction. SDK clients for Anthropic, OpenAI, and Groq have their own base URL handling, but none of them accommodate the process-tag injection that the rapid-llm-proxy endpoint requires. The direct-fetch wrapper owns both concerns — constructing the request with telemetry headers and resolving the target URL — keeping them co-located.

## Integration Points

`ProxyUrlResolver` is exclusively consumed by `llm-with-process.ts` within the broader LLMAbstraction parent. It has no interface with the mock service or the DMR (Docker Model Runner) provider, both of which are sibling execution paths inside LLMAbstraction that handle their own endpoint configuration independently. The resolver's scope is intentionally narrow: it answers one question (where is the proxy?) for one consumer (the direct-fetch wrapper).

The environment variables it reads — `RAPID_LLM_PROXY_URL`, `LLM_CLI_PROXY_URL`, and `LLM_PROXY_URL` — are the external integration surface. These are documented project-level variables, meaning deployment environments (CI, staging, production) are expected to configure the appropriate variable rather than modifying code.

## Usage Guidelines

Developers should set `RAPID_LLM_PROXY_URL` for any production or staging environment where telemetry-tagged inference routing is required — this is the primary intended target. `LLM_CLI_PROXY_URL` provides an override for CLI-specific tooling contexts without disturbing the production variable. `LLM_PROXY_URL` acts as a generic fallback for environments that predate the rapid-proxy naming convention. Local development requires no variable at all, relying on the port-based default.

Because resolution logic is centralized in `llm-with-process.ts`, any change to proxy routing priority or fallback behavior should be made there exclusively. Adding a new environment variable override means inserting it into the chain at the appropriate priority level — before `RAPID_LLM_PROXY_URL` only if it represents a more specific context, or between existing entries if it slots into the existing specificity hierarchy. Distributing resolution logic to other provider files would break the centralization guarantee that all execution modes resolve URLs consistently.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local inference backends. It provides three distinct execution modes (mock, local, public) with per-agent overrides stored in a workflow-progress.json file, allowing dynamic routing without code changes. The architecture consists of a mock service for testing, a DMR (Docker Model Runner) provider for local inference, and a direct-fetch wrapper (llm-with-process.ts) that bypasses the SDK to inject telemetry process tags into the rapid-llm-proxy endpoint.


---

*Generated from 5 observations*
