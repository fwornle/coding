# AgentAgnosticArchitecturePattern
**Type:** Architecture
**Generated:** 2026-03-01T06:54:34.813Z

Let me explore the broader architecture to understand how this proxy fits into the agent-agnostic pattern.

Now I have a thorough understanding of the codebase. Here's the architectural analysis:

---

## AgentAgnosticArchitecturePattern — Deep Insight Document

### What It Is

The Agent-Agnostic Architecture Pattern is implemented in `integrations/llm-cli-proxy/src/server.ts` as an HTTP proxy bridge (port `12435`) that abstracts multiple LLM CLI tools (`claude`, `copilot`) behind a unified REST API. Docker containers connect via `host.docker.internal:12435`, gaining access to host-resident CLI tools without knowing or caring which agent backend fulfills the request. The pattern follows the same topology as the existing DMR service on port `12434` — a host-side service made accessible to containerized workloads.

The core principle is **platform independence**: consumers submit a `CompletionRequest` specifying a `provider` and `messages`, and the proxy resolves models, spawns CLI processes, and returns a normalized `CompletionResponse`. This decouples all downstream services from any specific LLM vendor's authentication flow, CLI interface, or argument syntax.

### Architecture and Design

**Provider Abstraction via `CLIConfig` Interface.** The central design decision is the `CLIConfig` interface (line 73–81) and the `CLI_CONFIGS` registry (line 83–128). Each provider — `claude-code` and `copilot` — is a self-contained configuration object that declares its binary command, version-check arguments, tier-to-model mappings, and argument-building functions (`buildArgs`, `buildArgsWithStdin`). Adding a new LLM backend requires only a new entry in this registry — no changes to routing, error handling, or response formatting.

**Tier-Based Model Resolution.** Rather than forcing callers to know specific model names (which change across providers), the API accepts a `tier` field (`fast`, `standard`, `premium`) that maps to provider-specific models. For example, `premium` maps to `opus` for claude-code but `claude-opus-4.6` for copilot. This is a deliberate trade-off: callers express intent ("I need a premium response") and the proxy resolves the concrete model. The `model` field provides an escape hatch for explicit selection.

**Normalized Error Taxonomy.** The `mapErrorToStatus` function (line 235–258) converts CLI-specific error strings into a consistent HTTP error taxonomy: `429/QUOTA_EXHAUSTED`, `401/AUTH_ERROR`, or `500/CLI_ERROR`. This ensures consumers don't need provider-specific error handling — they respond to semantic HTTP status codes regardless of which backend produced the error.

**Process Lifecycle Management.** The `spawnCLIWithTimeout` function (line 166–233) manages child process creation with clean environment isolation (stripping `ANTHROPIC_API_KEY` and `CLAUDECODE` to force OAuth auth paths), configurable timeouts with SIGTERM→SIGKILL escalation, and in-flight process tracking via the `inFlightProcesses` set. The graceful shutdown handler (line 372–397) ensures all spawned processes are terminated on SIGTERM/SIGINT.

### Implementation Details

**Request Flow.** The `/api/complete` POST handler (line 278–355) follows a strict pipeline: validate inputs → check provider availability → resolve model from tier/explicit → format messages into a prompt string → decide stdin vs. argument-based invocation (based on `MAX_CLI_ARG_LENGTH` of 200KB) → spawn CLI with timeout → map exit code to success/error response → return normalized `CompletionResponse` with estimated token counts and latency.

**Stdin vs. Argument Invocation.** A key implementation detail is the dual invocation path. Prompts under 200KB are passed as CLI arguments; larger prompts are piped via stdin (line 100–106, 309–316). Each provider's `useStdinForPrompt` and `buildArgsWithStdin` methods handle this differently — claude reads from stdin when no positional argument is given, while copilot uses `--prompt -` as a convention. This handles OS `ARG_MAX` limits transparently.

**Provider Health Monitoring.** The `refreshProviderStatuses` function (line 359–368) runs on startup and every 60 seconds (`PROVIDER_CHECK_INTERVAL_MS`), executing `--version` against each CLI binary with a 5-second timeout. The health endpoint (`GET /health`) exposes per-provider availability, version strings, server uptime, and in-flight request count — enabling both human monitoring and automated load balancing decisions.

**Token Estimation.** The `estimateTokens` function (line 142–144) uses a simple `length / 4` heuristic. This is a deliberate trade-off: accurate token counting would require provider-specific tokenizers, violating the agent-agnostic principle. The estimate is "good enough" for observability while maintaining zero provider-specific dependencies in the response path.

### Integration Points

The proxy integrates at two boundaries. **Upstream (consumers):** Any Docker container in the compose stack can reach `http://host.docker.internal:12435/api/complete` — the MCP semantic analysis service (`integrations/mcp-server-semantic-analysis`), code-graph-rag, or any other service needing LLM completions. The CORS middleware (`app.use(cors())`) permits browser-based dashboard access as well.

**Downstream (providers):** The proxy depends on host-installed CLI binaries — `claude` and `copilot` — which must be authenticated independently (OAuth flows, API keys managed outside the proxy). The environment scrubbing in `spawnCLIWithTimeout` (deleting `ANTHROPIC_API_KEY`, `CLAUDECODE`) is a deliberate integration decision to force the claude CLI onto its Max subscription OAuth path rather than pay-as-you-go API credits.

The proxy follows the same host-side service pattern as DMR on port `12434`, suggesting a broader architectural convention: host-resident services exposed to Docker via well-known ports on `host.docker.internal`.

### Usage Guidelines

**Adding a new provider:** Add an entry to `CLI_CONFIGS` with `command`, `versionArgs`, `tierModels`, `buildArgs`, and `buildArgsWithStdin`. Update the `CompletionRequest.provider` union type. No other changes needed.

**Choosing tier vs. model:** Use `tier` when the caller cares about quality/speed trade-offs but not specific model versions. Use `model` for reproducibility or when targeting a model not in the tier mapping. If both are provided, `model` takes precedence (line 301).

**Error handling for consumers:** Always check HTTP status codes semantically — `429` means retry later (quota), `503` means provider is down (try another), `504` means timeout (increase `timeout` field or simplify prompt), `401` means re-authenticate the CLI on the host.

**After code changes:** Per project conventions, run `npm run build` in the submodule, then rebuild and restart the Docker service if it runs containerized. Config files are bind-mounted and don't require rebuilds.

### Scalability & Maintainability Assessment

**Scalability:** The proxy is intentionally single-instance (bound to `127.0.0.1`) since it wraps host-local CLI tools. Horizontal scaling is limited by the host's ability to run concurrent CLI processes. The `inFlightProcesses` set provides backpressure visibility but no enforced concurrency limit — a potential improvement area.

**Maintainability:** The architecture scores highly on maintainability. The `CLIConfig` registry pattern makes provider additions O(1) complexity. The normalized interfaces (`CompletionRequest`/`CompletionResponse`) ensure consumers never couple to provider internals. The test suite (`server.test.ts`) validates the API contract without requiring actual CLI execution, using provider availability as a test condition rather than mocking CLI binaries. The single-file implementation (~410 lines) keeps cognitive overhead low while remaining fully typed with TypeScript strict mode.