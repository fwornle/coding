# IdentifiedPattern
**Type:** Architecture
**Generated:** 2026-03-01T07:44:02.379Z

Now let me look at broader context to understand how this fits into the larger system.

Here is the comprehensive technical insight document:

---

## What It Is

The **LLM CLI Proxy** is an HTTP bridge server implemented in `src/server.ts` within `integrations/llm-cli-proxy/`. It runs on the host machine at `127.0.0.1:12435` and exposes local CLI-based LLM tools (`claude` and `copilot`) as a unified HTTP API. Docker containers access it via `host.docker.internal:12435`, bridging the gap between containerized services that need LLM completions and CLI tools that only exist on the host (with their OAuth sessions, filesystem access, and subscription credentials).

The project is a single-file TypeScript/Express server (`src/server.ts`) with a companion test file (`src/server.test.ts`). It follows the same host-side service pattern described in its header comment as the "DMR on port 12434" — a convention in this codebase where host-only capabilities are exposed to Docker containers through small, dedicated HTTP proxies on sequential ports.

## Architecture and Design

**Provider Abstraction via CLIConfig**: The central architectural decision is the `CLIConfig` interface (lines 73–81), which normalizes two fundamentally different CLI tools behind a unified contract. Each provider declares its `command`, `versionArgs`, `tierModels`, `defaultModel`, and two argument-building strategies — `buildArgs` for argument-based invocation and `buildArgsWithStdin` for large prompts exceeding `MAX_CLI_ARG_LENGTH` (200KB). This Strategy pattern allows adding new CLI providers by simply adding a new entry to `CLI_CONFIGS` without modifying routing or process management logic.

**Process-per-Request Model**: Rather than maintaining persistent connections or using SDK-based API calls, the proxy spawns a fresh child process (`spawn()` from `child_process`) for every completion request. This is a deliberate trade-off: it avoids managing connection pooling or session state for CLI tools that aren't designed for programmatic use, at the cost of per-request process overhead. The `spawnCLIWithTimeout` function (lines 166–233) encapsulates the full lifecycle — environment sanitization, stdout/stderr capture, timeout enforcement with SIGTERM→SIGKILL escalation, and in-flight process tracking.

**Environment Sanitization**: A notable security/correctness decision at lines 177–179: the proxy strips `ANTHROPIC_API_KEY` and `CLAUDECODE` from the environment before spawning CLI processes. This forces the `claude` CLI to use OAuth-based Max subscription authentication rather than pay-as-you-go API credits, and prevents nested session detection. This reveals an architecture where the proxy is designed to run inside a developer's environment alongside other Claude sessions.

**Tier-to-Model Resolution**: The `CompletionRequest` type supports both explicit `model` selection and a `tier` abstraction (`fast`, `standard`, `premium`) that maps to provider-specific models. For `claude-code`, tiers map to `sonnet`/`opus`; for `copilot`, they map to specific versioned models like `claude-haiku-4.5` through `claude-opus-4.6`. This decouples callers from provider-specific model names, enabling the proxy to upgrade models without changing client code.

## Implementation Details

**Single-File Architecture**: The entire server lives in `src/server.ts` (414 lines). It's structured in clearly-delineated sections: logging utilities → type definitions → configuration constants → state management → provider CLI mapping → helper functions → Express routes → lifecycle management. This monolithic approach is appropriate for the service's narrow scope and makes deployment straightforward (`node dist/server.js`).

**Error Classification** (`mapErrorToStatus`, lines 235–258): The proxy parses CLI stderr output to map unstructured text errors to semantic HTTP status codes. Rate limiting, quota exhaustion, and credit balance errors become `429 QUOTA_EXHAUSTED`; authentication failures become `401 AUTH_ERROR`; everything else is `500 CLI_ERROR`. This heuristic approach handles the fact that CLI tools don't return structured error codes.

**Timeout Mechanism**: The `spawnCLIWithTimeout` function implements a two-phase timeout: `SIGTERM` first, then `SIGKILL` after 5 seconds if the process hasn't terminated (lines 192–198). The default timeout is 120 seconds (`DEFAULT_TIMEOUT_MS`), configurable per-request. Timeouts surface as HTTP `504 GATEWAY_TIMEOUT`.

**Token Estimation**: The `estimateTokens` function (line 142–144) uses a simple `text.length / 4` heuristic. This is intentionally approximate — the proxy doesn't have access to tokenizers, and the estimate is used only for informational response metadata, not billing or quota enforcement.

**Message Formatting**: `formatPrompt` (lines 132–140) flattens the OpenAI-style `messages` array into a single text prompt with `System:`, `Assistant:`, and bare-user prefixes. This lossy transformation is necessary because CLI tools don't accept structured message arrays — they take a single prompt string.

## Integration Points

**Docker → Host Bridge**: The primary integration pattern is Docker containers calling `http://host.docker.internal:12435/api/complete`. This is referenced in the startup log (line 404) and is consistent with the project's `CLAUDE.md` guidelines about submodules running in Docker containers.

**Provider CLIs**: The proxy depends on `claude` and `copilot` being installed and authenticated on the host machine. Provider availability is checked at startup and re-checked every 60 seconds (`PROVIDER_CHECK_INTERVAL_MS`). The health endpoint (`GET /health`) exposes real-time provider status including version strings and availability flags.

**Sibling Services**: The log files in `logs/` (e.g., `semantic-analysis-2026-02-*.log`) suggest this proxy is consumed by the `mcp-server-semantic-analysis` integration, which likely uses it for LLM completions during code analysis workflows. The port 12435 follows sequentially after DMR on 12434, establishing a convention of host-side services in the 12430+ range.

**API Surface**: Two endpoints — `GET /health` (returns `HealthResponse` with provider statuses, uptime, in-flight count) and `POST /api/complete` (accepts `CompletionRequest`, returns `CompletionResponse`). The API uses CORS (`*`), accepts 10MB JSON payloads, and follows REST conventions with semantic HTTP status codes (400, 401, 429, 503, 504).

## Usage Guidelines

**Adding New Providers**: Extend the `CLI_CONFIGS` record with a new `CLIConfig` entry. The provider name becomes a valid value for `CompletionRequest.provider`. No routing changes needed — the config-driven design handles discovery, health checks, and invocation automatically.

**Model Selection**: Prefer using `tier` over explicit `model` in requests. This allows the proxy to upgrade underlying models without breaking clients. Tiers: `fast` (lowest latency), `standard` (balanced), `premium` (highest quality).

**Environment**: The proxy must run on the host, not in Docker, since it needs access to host-installed CLI tools and their authentication state. The `LLM_CLI_PROXY_PORT` environment variable overrides the default port. Never set `ANTHROPIC_API_KEY` in the proxy's environment — it intentionally strips this to use subscription-based auth.

**Rebuild Requirements**: Per `CLAUDE.md`, after code changes: `cd integrations/llm-cli-proxy && npm run build` compiles TypeScript to `dist/`. If running in a Docker-managed context, a container rebuild may also be needed, though this service typically runs directly on the host.

**Testing**: Tests use Node's built-in test runner (`node:test`) with `tsx` for TypeScript execution. Run with `npm test`. Tests start a real server on port 19435 to avoid conflicts with a running instance. The test suite validates request validation, error handling, CORS, and health reporting but deliberately avoids making real CLI calls.

---

### Summary of Key Architectural Decisions

| Decision | Trade-off |
|---|---|
| Process-per-request spawning | Simplicity over performance; appropriate for infrequent, long-running LLM calls |
| CLI stderr parsing for errors | Fragile but necessary; CLI tools lack structured error APIs |
| Environment stripping (API keys) | Forces subscription auth; prevents accidental billing |
| Single-file monolith | Easy to deploy and understand; appropriate for ~400 LOC |
| Config-driven provider registry | Extensible without code changes to routing; new providers are data |
| Tier abstraction over models | Decouples callers from provider churn; models can be swapped transparently |
| Host-only binding (127.0.0.1) | Security: not exposed to network; Docker uses host.docker.internal |