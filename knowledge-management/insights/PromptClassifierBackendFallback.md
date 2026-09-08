# PromptClassifierBackendFallback

**Type:** Detail

[Architecture Notes] [LLM] No file in this set implements or references a prompt-classifier-specific backend fallback; documentation or a parent entity asserting otherwise should be cross-checked against scripts/prompt-classifier-service.mjs and config/prompt-classifier.yaml.; [LLM] Resilience logic (retry, backoff, timeout, degrade) is concentrated in lib/service-starter.js and not uniformly applied — scripts/api-service.js and scripts/dashboard-service.js bypass it entirely, creating two different failure-handling tiers within the same service-startup subsystem.; [LLM] docker/entrypoint.sh and scripts/generate-docker-mcp-config.sh both implement independent 'feature enabled?' checks (one via a JSON snapshot + Node inline script, the other via `bin/coding-features enabled codegraph`), which is a duplicated-authority risk if the two ever diverge on how an unknown/missing feature should be treated.; [LLM] The `withDeadline` timer-leak fix in lib/service-starter.js is a good candidate for extraction into a shared utility if other components (e.g. a classifier health-check) need the same race-without-leak semantics.

# PromptClassifierBackendFallback — Technical Insight Document

## What It Is

PromptClassifierBackendFallback, as named and positioned under its parent LLMMockService, does not correspond to any concrete implementation within the supplied file set. None of docker/entrypoint.sh, lib/service-starter.js, scripts/api-service.js, scripts/dashboard-service.js, or scripts/generate-docker-mcp-config.sh reference a prompt classifier, judge, or offload backend. The actual implementation surface for this concept — scripts/prompt-classifier-service.mjs and config/prompt-classifier.yaml — is not present in this file set and must be treated as the ground truth once available. This document therefore records the closest analogous patterns that exist in the current codebase, which future work on the real classifier fallback should either reuse or explicitly diverge from.

The two strongest analogues are the required-vs-degraded service classification in lib/service-starter.js and the registry-lookup-with-literal-fallback pattern in scripts/generate-docker-mcp-config.sh. Any existing documentation that asserts this file set implements classifier-backend fallback logic is stale and should be cross-checked against the actual classifier files before being trusted.

## Architecture and Design

Several distinct fallback/resilience shapes coexist in the codebase, and it's important not to conflate them when designing the real classifier fallback. First, lib/service-starter.js's `startServiceWithRetry` implements graceful degradation: a service is either `required` (failure blocks startup) or optional (failure yields a `{status: 'degraded', healthy: false}` object). This is a binary up/down decision, not a multi-backend switch — there is no secondary backend attempted.

Second, scripts/generate-docker-mcp-config.sh implements a genuine try-then-fallback pattern for the code-graph MCP server: it attempts `node scripts/code-graph-config.mjs mcp-entry` to resolve the backend from config/code-graph.json, and falls back to a hardcoded literal JSON block (the `graphify` HTTP entry) if resolution fails. This is architecturally the closest shape to what a classifier backend fallback needs — try a configured/discoverable backend, warn, and fail over to a known-good default — though it operates at container-config-generation time, not at runtime request time.

Third, docker/entrypoint.sh's feature gating is explicitly fail-open: missing or unreadable features.json causes everything to stay enabled, and unknown feature keys default to enabled. This mirrors the parent LLMMockService's design philosophy — cross-boundary state (host vs. container, or mock/local/public LLM modes) is persisted in a shared artifact rather than re-derived independently on each side, avoiding host/container drift. However, this fail-open stance is flagged as a potential mismatch for a classifier fallback used for cost control, where an unreachable judge should fail open on verdict but must never silently escalate spend.

## Implementation Details

`startServiceWithRetry` (lib/service-starter.js) applies exponential backoff between retries of the same start function via `retryDelay * Math.pow(2, attempt - 1)`, but this only masks transient startup races, not systemic backend failures — a distinction the classifier fallback design must respect since a broken model backend is not a transient race.

The `withDeadline` helper in the same file fixes a specific timer-leak bug: naively racing `work` against a timeout promise leaves the losing timer armed if `work` resolves first, holding the Node event loop open. The fix wraps cleanup in `finally { clearTimeout(timer) }`. This is flagged explicitly as a reusable primitive for any future classifier health check needing bounded-wait semantics without leaking timers in short-lived CLI invocations.

The CODE_GRAPH_ENTRY block in scripts/generate-docker-mcp-config.sh demonstrates the registry-then-literal-fallback mechanics concretely: shell-level invocation of a Node script for dynamic resolution, with a hardcoded JSON fallback block as the safety net on failure. docker/entrypoint.sh's PROGRAM_FEATURES loop uses an inline `node -e` snippet where `value === false ? "false" : "true"` encodes the fail-open default at the expression level.

By contrast, scripts/api-service.js and scripts/dashboard-service.js are bare spawn-and-forward wrappers with zero retry, timeout, or fallback logic — they propagate the child process's exit code directly.

## Integration Points

Under its parent LLMMockService, PromptClassifierBackendFallback would presumably need to interoperate with the mock/local/public mode switching described for llm-mock-service.ts, which itself depends on shared-file-based state rather than independently derived policy — the same pattern docker/entrypoint.sh uses for feature snapshots. This suggests the eventual classifier fallback should also consider whether backend selection state needs to be persisted/shared across host and container boundaries rather than recomputed.

Within the current codebase, the nearest integration points are lib/service-starter.js (for retry/degrade/deadline primitives) and scripts/generate-docker-mcp-config.sh (for the try-registry/fall-back-to-literal shape). There is also a duplicated-authority risk worth noting: docker/entrypoint.sh and scripts/generate-docker-mcp-config.sh both implement independent "feature enabled?" checks (JSON snapshot + inline Node vs. `bin/coding-features enabled codegraph`), and a classifier fallback must avoid adding a third, divergent authority for backend/feature status.

## Usage Guidelines

Until scripts/prompt-classifier-service.mjs and config/prompt-classifier.yaml are available for direct inspection, treat any claims about this entity's runtime behavior as provisional. When implementing the real fallback, prefer reusing the `withDeadline` timer-cleanup pattern from lib/service-starter.js rather than reimplementing `Promise.race` timeout handling. Model the try-then-fallback flow after scripts/generate-docker-mcp-config.sh's CODE_GRAPH_ENTRY resolution rather than the binary required/degraded logic in `startServiceWithRetry`, since a classifier needs an actual secondary backend, not just an on/off state.

Critically, do not inherit docker/entrypoint.sh's fail-open-by-default philosophy uncritically: while appropriate for feature gating (where running too much is easier to diagnose than running nothing), an unreachable classifier/judge backend should fail open only on verdict, never in a way that silently escalates spend. Finally, be aware of the two-tier resilience inconsistency already present in the codebase — services wired through `startServiceWithRetry` get retry/backoff/degrade semantics, while api-service.js/dashboard-service.js do not — and ensure the classifier fallback is deliberately placed in the appropriate tier rather than accidentally inheriting the thin-wrapper behavior.


## Hierarchy Context

### Parent
- [LLMMockService](./LLMMockService.md) -- [LLM] The docker/entrypoint.sh script implements a feature-gating override mechanism that reads a host-written snapshot (/coding/.coding/runtime/features.json) and translates it into supervisord include files at /etc/supervisor/features.d/disabled.conf. This is architecturally significant because the container cannot run the feature resolver itself — ~/.coding/features.yaml lives on the host and is never mounted — so the container is forced into a consumer role, trusting a flattened JSON artifact rather than re-deriving policy. The `enabled` check inside the embedded `node -e` snippet explicitly treats any value other than `false` (including an unknown/missing key) as enabled, which is a deliberate fail-open default: an older host snapshot that predates a new feature must never accidentally disable it. This mirrors the LLM mock/local/public mode design in llm-mock-service.ts, where cross-boundary state (host vs container) is persisted in a shared file artifact rather than derived independently on each side, avoiding drift between host and containerized views of the same configuration.


---

*Generated from 9 observations*
