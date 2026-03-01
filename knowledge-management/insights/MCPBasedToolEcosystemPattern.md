# MCPBasedToolEcosystemPattern
**Type:** Architecture
**Generated:** 2026-03-01T06:54:34.813Z

Now let me explore the broader ecosystem for MCP-related components.

I now have sufficient code-level evidence to produce the analysis. Here's the comprehensive insight document:

---

# MCPBasedToolEcosystemPattern — Architectural Insight

## What It Is

The MCP-Based Tool Ecosystem Pattern is a **composable AI services architecture** implemented across the `integrations/` directory of the `coding` monorepo. The primary artifact analyzed is the **`llm-cli-proxy`** at `integrations/llm-cli-proxy/src/server.ts` — an HTTP proxy bridge on port `12435` that makes host-local CLI tools (`claude`, `copilot`) available to Docker containers via `host.docker.internal`. This service participates in a broader ecosystem of MCP (Model Context Protocol) servers including `mcp-server-semantic-analysis` (port 3848), `mcp-constraint-monitor`, `code-graph-rag`, and a `system-health-dashboard` (ports 3032/3033), all orchestrated through Docker Compose with bind-mounts and submodule-based build pipelines.

The pattern's core tenet is **composability**: each integration is an independent TypeScript service (its own `package.json`, `tsconfig.json`, build/test scripts) that exposes a well-defined HTTP or SSE interface. Services are composed at the Docker layer, with the host machine providing CLI-based LLM access that containers cannot obtain natively.

## Architecture and Design

### Provider Abstraction Layer

The `llm-cli-proxy` demonstrates the pattern's key architectural decision: **provider-agnostic abstraction over heterogeneous LLM backends**. The `CLIConfig` interface (lines 73–81 of `server.ts`) defines a uniform contract — `command`, `versionArgs`, `tierModels`, `buildArgs`, `useStdinForPrompt`, `buildArgsWithStdin` — that normalizes two fundamentally different CLIs (`claude` with `--print --model --output-format text` and `copilot` with `--prompt --model --silent`) behind a single `POST /api/complete` endpoint. This is a classic **Strategy Pattern**, where provider-specific invocation logic is encapsulated in configuration objects (`CLI_CONFIGS` map, lines 83–128) rather than scattered through request-handling code.

### Host-Bridge Architecture

The most significant design decision is the **host-bridge pattern**: the proxy binds exclusively to `127.0.0.1:12435` (line 59, `HOST = '127.0.0.1'`) and Docker containers reach it via `host.docker.internal`. This is explicitly acknowledged in the header comment as "Same pattern as DMR on port 12434" — indicating a deliberate, repeated architectural convention where host-side services expose capabilities that Docker cannot access directly (in this case, authenticated CLI tools with OAuth sessions). The pattern avoids embedding API keys in containers; instead, the proxy sanitizes the environment (lines 177–179: deleting `ANTHROPIC_API_KEY` and `CLAUDECODE` from `process.env`) to force CLI tools to use subscription-based OAuth rather than pay-per-token API keys.

### Tier-Based Model Resolution

The system implements a **tier abstraction** (lines 30–33, `tier?: 'fast' | 'standard' | 'premium'`) that maps quality-of-service tiers to concrete models. For `claude-code`, `fast` and `standard` resolve to `sonnet` while `premium` resolves to `opus`. For `copilot`, the same tiers map to `claude-haiku-4.5`, `claude-sonnet-4.5`, and `claude-opus-4.6`. This decouples callers from model-version churn — consumers request a tier, and the proxy handles model selection.

### Health and Observability

The `/health` endpoint (lines 267–275) follows the ecosystem's observability convention: it reports per-provider availability (`ProviderStatus` with `available`, `version`, `lastChecked`), in-flight request count, and server uptime. Provider availability is polled on a 60-second interval (`PROVIDER_CHECK_INTERVAL_MS`, line 62) using the same `spawnCLIWithTimeout` mechanism but with a 5-second timeout. This provides passive health monitoring without dedicated sidecar processes.

## Implementation Details

### Process Management (`spawnCLIWithTimeout`)

The core execution engine (lines 166–233) spawns CLI tools as child processes with full stdio piping. Key implementation details:

1. **Environment sanitization** (lines 177–179): The proxy explicitly removes `ANTHROPIC_API_KEY` and `CLAUDECODE` from the child process environment. This forces `claude` CLI to use OAuth/Max subscription authentication rather than a potentially rate-limited API key — a subtle but critical operational decision.

2. **Timeout enforcement**: A two-phase kill strategy — `SIGTERM` at timeout, then `SIGKILL` after 5 additional seconds (lines 192–198). The default timeout is 120 seconds (`DEFAULT_TIMEOUT_MS`, line 63).

3. **In-flight tracking**: A `Set<ChildProcess>` (line 68) tracks all running CLI processes. This enables the `/health` endpoint to report active requests and enables graceful shutdown to terminate all pending work.

4. **Large prompt handling**: When prompts exceed 200KB (`MAX_CLI_ARG_LENGTH`, line 64), the system switches from command-line arguments to stdin-based prompt delivery (`useStdinForPrompt` / `buildArgsWithStdin`), avoiding OS argument-length limits.

### Error Classification (`mapErrorToStatus`)

The error mapper (lines 235–258) performs **stderr pattern matching** to translate CLI error messages into appropriate HTTP status codes: rate-limit/quota errors → 429, authentication errors → 401, all others → 500. This is a pragmatic approach given that CLI tools lack structured error codes — the proxy parses human-readable error messages to provide structured API responses.

### Message Formatting

The `formatPrompt` function (lines 132–139) flattens the OpenAI-style messages array into a single text block with role prefixes (`System:`, `Assistant:`, or bare content for user messages). This is necessary because CLI tools accept flat text prompts rather than structured message arrays.

### Token Estimation

The `estimateTokens` function (line 142–144) uses the industry-standard heuristic of `text.length / 4` — a rough but serviceable approximation for response metadata. The proxy explicitly does not attempt precise tokenization, keeping the implementation dependency-free.

## Integration Points

### Docker Container Integration

Containers in the `coding-services` Docker Compose stack reach this proxy via `http://host.docker.internal:12435/api/complete`. The proxy sits alongside the DMR service (port 12434), establishing a convention where host-side services occupy the 12,4xx port range. The `cors()` middleware with default `*` origin (line 263) permits unrestricted cross-origin access, appropriate for an internal-only service.

### MCP Server Ecosystem

Per the project's `CLAUDE.md`, this proxy is one node in a broader composable services topology:
- **`mcp-server-semantic-analysis`** (port 3848): SSE-based workflow execution for batch analysis
- **`mcp-constraint-monitor`**: Constraint validation service
- **`code-graph-rag`**: Memgraph-backed code graph with NL query, call-graph, and similarity search
- **`system-health-dashboard`** (port 3032/3033): Unified health monitoring and management UI

These services follow a **submodule build pattern**: each is a git submodule with its own `npm run build` step that compiles TypeScript to `dist/`, followed by a Docker rebuild. The `llm-cli-proxy` uniquely runs on the host (not in Docker) because it needs access to locally-installed and authenticated CLI tools.

### Build Pipeline Integration

The project enforces a two-step build discipline documented in `CLAUDE.md`: (1) `npm run build` inside the submodule, then (2) `docker-compose build && docker-compose up -d`. The `llm-cli-proxy` uses standard TypeScript compilation (`tsc` → `dist/server.js`) with strict mode, declaration maps, and source maps enabled (`tsconfig.json`).

## Usage Guidelines

### Invocation Protocol

Consumers send a `POST` to `/api/complete` with a JSON body conforming to `CompletionRequest`: `provider` (`'claude-code'` or `'copilot'`), `messages` (role/content array), and optional `model`, `tier`, `maxTokens`, `temperature`, and `timeout`. **Prefer `tier` over explicit `model`** to maintain abstraction — use `'fast'` for quick tasks, `'standard'` for general use, `'premium'` for complex reasoning.

### Operational Considerations

1. **Authentication is implicit**: The proxy relies on the host machine's CLI tools being pre-authenticated (via `claude auth` or `copilot auth`). If a provider shows `available: false` on `/health`, the CLI is either not installed or not authenticated.

2. **No concurrent request limits**: The proxy spawns a new child process per request with no throttling. In high-load scenarios, this could exhaust system resources. The `inFlightRequests` health metric should be monitored.

3. **Timeout defaults**: The 120-second default timeout is generous for most completions. Callers can override via the `timeout` field in the request body.

### Scalability Considerations

The architecture is inherently **vertically bounded** — it depends on locally-installed CLI tools with single-machine authentication. It cannot horizontally scale across hosts. However, the provider abstraction layer makes it straightforward to add new backends by extending `CLI_CONFIGS` with a new provider entry. The tier mapping system also insulates callers from model upgrades.

### Maintainability Assessment

The codebase is a single 414-line `server.ts` file with comprehensive tests in `server.test.ts`. This is appropriate for a bridge service — additional abstraction would add overhead without benefit. The `CLIConfig` interface provides a clear extension point for new providers. The main maintenance risk is **CLI tool API drift** — if `claude` or `copilot` CLI flags change, the `buildArgs` functions need updating. The stderr-based error classification is inherently fragile and will need periodic updates as CLI error messages evolve.