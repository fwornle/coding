# ARCHITECTURALPattern
**Type:** Architecture
**Generated:** 2026-03-01T07:09:09.460Z

Here is the comprehensive architectural insight document for the `llm-cli-proxy`:

---

## What It Is

The `llm-cli-proxy` is an HTTP proxy bridge implemented in `src/server.ts` (414 lines) that exposes local CLI-based LLM tools (`claude`, `copilot`) as a REST API. It runs on the host machine at `127.0.0.1:12435` and is designed to be consumed by Docker containers via `host.docker.internal:12435`. The project lives at `integrations/llm-cli-proxy/` and follows the same host-side service pattern as "DMR" on port 12434, as noted in the source header comment (line 7). It is a single-file TypeScript/Express server with strict typing (`tsconfig.json` enables `strict: true`) compiled to ESM (`"type": "module"` in `package.json`).

## Architecture and Design

**1. Adapter/Bridge Pattern.** The core architectural pattern is a Bridge: it decouples Docker-containerized consumers from host-only CLI tools by exposing a uniform HTTP JSON API (`POST /api/complete`). Consumers send a provider-agnostic `CompletionRequest` with `messages`, `model`, and `tier` fields; the proxy translates this into provider-specific CLI invocations via the `CLIConfig` interface (lines 73–81). This abstraction means callers never need to know the CLI flags for `claude --print --model sonnet --output-format text` vs. `copilot --prompt ... --model ... --silent`.

**2. Provider Registry (Strategy Pattern).** The `CLI_CONFIGS` record (lines 83–128) acts as a strategy registry. Each provider entry (`claude-code`, `copilot`) encapsulates: the binary name, version-check arguments, tier-to-model mappings, and two argument-building strategies (`buildArgs` for normal prompts, `buildArgsWithStdin` for large prompts exceeding `MAX_CLI_ARG_LENGTH` of 200 KB). Adding a new LLM CLI tool requires only adding a new entry to this record — no changes to routing or process management.

**3. Stateless Request Handling with In-Memory State.** The server is stateless per-request but maintains two pieces of in-memory state: `providerStatuses` (periodically refreshed availability cache) and `inFlightProcesses` (a `Set<ChildProcess>` tracking active CLI subprocesses). This design enables the health endpoint (`GET /health`) to report real-time provider availability, uptime, and concurrency without external dependencies like Redis or a database.

**4. Environment Isolation.** The `spawnCLIWithTimeout` function (lines 166–233) deliberately strips `ANTHROPIC_API_KEY` and `CLAUDECODE` from the child process environment (lines 177–179). This is a conscious design decision documented in comments: it forces the `claude` CLI to use OAuth/Max subscription billing rather than depleted pay-as-you-go API credits, and prevents nested session detection.

## Implementation Details

**Process Lifecycle Management.** Each LLM request spawns a child process via `spawn()` with `stdio: ['pipe', 'pipe', 'pipe']`. The `spawnCLIWithTimeout` function implements a two-stage timeout: after `timeoutMs` it sends `SIGTERM`, then a secondary 5-second timer sends `SIGKILL` if the process hasn't exited. Every spawned process is tracked in `inFlightProcesses` and removed on close or error, ensuring the health endpoint's `inFlightRequests` counter stays accurate.

**Model Resolution Chain.** The completion endpoint resolves the model through a priority chain at line 301: explicit `model` parameter → tier-based lookup via `config.tierModels[tier]` → `config.defaultModel`. The tier system maps semantic tiers (`fast`, `standard`, `premium`) to concrete model identifiers, e.g., `claude-code` maps `premium` → `opus` while `copilot` maps `premium` → `claude-opus-4.6`.

**Error Classification.** The `mapErrorToStatus` function (lines 235–258) performs stderr string matching to classify CLI errors into HTTP-appropriate responses: rate limit/quota errors → 429, authentication errors → 401, everything else → 500. The completion handler additionally maps timeouts to 504 (line 349). This gives consumers actionable HTTP status codes rather than opaque 500s.

**Message Formatting.** The `formatPrompt` function (lines 132–139) flattens the OpenAI-style `messages` array into a single text prompt, prefixing system messages with `System:` and assistant messages with `Assistant:`. User messages pass through unprefixed. This is necessary because CLI tools accept a single prompt string, not structured message arrays.

**Token Estimation.** Token counts in the response are estimated at ~4 characters per token (line 142–144). This is a rough heuristic for response metadata — not used for any billing or truncation logic.

## Integration Points

**Docker Integration.** The primary consumer pattern is Docker containers accessing `http://host.docker.internal:12435`. The server binds to `127.0.0.1` (not `0.0.0.0`), so it is only accessible from the local machine and Docker's special host networking — not from the network. CORS is configured to allow all origins (`cors()` with defaults = `*`), appropriate for a localhost-only service.

**CLI Tool Dependencies.** The server depends on `claude` and `copilot` CLI binaries being installed and authenticated on the host machine. Provider availability is probed at startup and every 60 seconds (`PROVIDER_CHECK_INTERVAL_MS`) via `--version` checks. The health endpoint exposes this status, allowing consumers to check availability before sending requests.

**Sibling Service: DMR.** The source comment explicitly references a "DMR" service on port 12434 using the "same pattern." This suggests a family of host-side bridge services in the `integrations/` directory, all following the convention of Express servers on high-numbered ports bridging host-only resources into Docker.

**Test Infrastructure.** The test file `src/server.test.ts` uses Node's built-in test runner (`node:test`) with zero external test dependencies. Tests fork the server process on a separate port (19435) using `tsx` for TypeScript execution, validating health endpoints, request validation, and CORS headers. Notably, actual CLI completion calls are intentionally skipped to avoid cost and latency.

## Usage Guidelines

**Adding a New Provider.** Add a new entry to `CLI_CONFIGS` with the binary name, version args, tier model mappings, and argument builders. The provider will automatically appear in health checks and be routable via the `provider` field in requests.

**Environment Variables.** The only configuration knob is `LLM_CLI_PROXY_PORT` (default `12435`). All other settings (timeout, stdin threshold, check interval) are hardcoded constants — change them in source if needed.

**Graceful Shutdown.** The server handles `SIGTERM` and `SIGINT`, killing all in-flight CLI processes before exiting. When deploying as a managed service, send `SIGTERM` and allow up to 5 seconds for cleanup.

**Build & Deploy.** Per the project's CLAUDE.md guidelines, after any source change: `npm run build` (compiles to `dist/`), then Docker rebuild if containerized. The compiled output includes declaration maps and source maps for debugging.

---

### Summary Assessments

| Dimension | Assessment |
|---|---|
| **Patterns** | Bridge/Adapter (CLI→HTTP), Strategy (provider configs), Process Pool (in-flight tracking) |
| **Key Trade-off** | Simplicity (single file, no framework) vs. scalability (one process per request, no queuing) |
| **Structure** | Monolithic single-file server; extensible via `CLI_CONFIGS` registry |
| **Scalability** | Limited by OS process spawning; no request queuing or concurrency limits beyond OS defaults |
| **Maintainability** | High — strict TypeScript, clear interfaces, single responsibility, ~400 LOC total |