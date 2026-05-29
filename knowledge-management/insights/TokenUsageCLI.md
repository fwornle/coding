# TokenUsageCLI

**Type:** Detail

The RAPID_LLM_PROXY_URL, LLM_CLI_PROXY_URL, and LLM_PROXY_URL environment variables documented in the project suggest the CLI tool distinguishes between proxy endpoints, with LLM_CLI_PROXY_URL specifically named for CLI-side usage.

## What It Is

`TokenUsageCLI` is a command-line interface tool residing in the `bin/` directory that exposes token usage metrics without requiring the visual Token Usage Dashboard described in `docs/architecture/token-usage.md`. As documented in `docs/getting-started.md`, the `bin/` directory represents the primary interaction layer for the project — scripts here are the intended entrypoints, not importable libraries. `TokenUsageCLI` follows this convention directly, providing terminal-accessible token consumption data for environments or workflows where the dashboard UI is unavailable or unnecessary.

## Architecture and Design

`TokenUsageCLI` sits within the `CLIToolConventions` parent grouping, which establishes the foundational rule that `bin/` scripts are entrypoints rather than modules. This architectural boundary is important: the CLI is designed to be invoked directly, not composed into other code. This is a deliberate separation between the visual dashboard layer (`docs/architecture/token-usage.md`) and programmatic/scripted access to the same underlying metrics.

A notable design decision is the distinction between proxy endpoints. The project documents three environment variables — `RAPID_LLM_PROXY_URL`, `LLM_PROXY_URL`, and `LLM_CLI_PROXY_URL` — and the naming of `LLM_CLI_PROXY_URL` strongly suggests that `TokenUsageCLI` is specifically wired to this endpoint rather than sharing the same proxy URL as the dashboard or rapid-access paths. This is a deliberate routing separation, likely reflecting differences in authentication, rate limiting, or latency tolerance between interactive UI usage and CLI-driven batch or scripted <USER_ID_REDACTED>.

The architecture mirrors a pattern where a single domain concept (token usage) is surfaced through multiple access layers (dashboard vs. CLI), each with its own proxy binding. This avoids coupling CLI workloads to dashboard traffic and allows independent scaling or configuration of each channel.

## Implementation Details

The tool is implemented as a script under `bin/`, consistent with the conventions established by `CLIToolConventions`. Based on the observations, its core responsibility is fetching and presenting token usage metrics — the same data domain as the Token Usage Dashboard — in a terminal-friendly format.

The proxy endpoint configuration via `LLM_CLI_PROXY_URL` is the primary runtime dependency. This environment variable must be set for the CLI to route requests correctly. The presence of three distinct proxy variables (`RAPID_LLM_PROXY_URL`, `LLM_CLI_PROXY_URL`, `LLM_PROXY_URL`) implies the codebase has explicit branching or configuration resolution logic that selects the appropriate endpoint based on execution context — and `TokenUsageCLI` resolves to `LLM_CLI_PROXY_URL` specifically.

The observations do not expose specific class names or internal function signatures within the CLI script itself, so further detail on parsing, formatting, or output structure cannot be grounded from the available sources.

## Integration Points

`TokenUsageCLI` integrates with the LLM proxy layer via `LLM_CLI_PROXY_URL`, making this environment variable its primary external dependency. It shares the token usage data domain with the Token Usage Dashboard component described in `docs/architecture/token-usage.md`, but accesses it through a separate proxy binding rather than a shared client.

As a member of `CLIToolConventions`, it is sibling to other `bin/` tools that follow the same entrypoint conventions documented in `docs/getting-started.md`. Developers working on any sibling CLI tool should expect the same structural rules to apply: self-contained scripts, environment-variable-driven configuration, and no assumption of an active UI context.

## Usage Guidelines

Developers invoking `TokenUsageCLI` must ensure `LLM_CLI_PROXY_URL` is set in their environment. Using `LLM_PROXY_URL` or `RAPID_LLM_PROXY_URL` in its place is likely incorrect and may route requests to an unintended proxy with different behavior or access controls.

Following `CLIToolConventions`, this script should be executed directly from `bin/` rather than imported or `require`d by other modules. The `docs/getting-started.md` documentation explicitly frames `bin/` tools as the interaction layer, not a library layer, and `TokenUsageCLI` should be treated accordingly. Any automation, CI job, or developer workflow that needs token usage data programmatically should invoke this script as a subprocess rather than attempting to reuse its internals.

When the Token Usage Dashboard is unavailable — such as in headless CI environments or remote SSH sessions — `TokenUsageCLI` is the canonical alternative for accessing the same metrics. Teams should document this as the fallback path rather than building ad hoc metric <USER_ID_REDACTED>.


## Hierarchy Context

### Parent
- [CLIToolConventions](./CLIToolConventions.md) -- docs/getting-started.md references bin/ tools as the primary interaction layer, indicating CLI scripts are the intended entrypoints rather than imported libraries


---

*Generated from 3 observations*
