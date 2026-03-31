# Subscription-Based LLM Providers Implementation

## Status: Direct HTTP / CLI Rewrite Complete

Subscription providers rewritten to eliminate SDK overhead. Copilot uses direct HTTP (~2s), Claude Code uses CLI shell-out with JSON output (~12s).

---

## Architecture

### Provider Hierarchy
```
BaseProvider (abstract)
  - CopilotProvider [Direct HTTP to Copilot API]
  - ClaudeCodeProvider [CLI shell-out with JSON output]
  - CLIProviderBase (abstract) [legacy, still used by proxy fallback]
  - OpenAICompatibleProvider
    - GroqProvider
    - OpenAIProvider
    - GeminiProvider
    - GitHubModelsProvider
  - AnthropicProvider
  - DMRProvider
  - OllamaProvider
  - MockProvider
```

### Key Change: No More SDK/CLI Subprocess Overhead

| Provider | Old Approach | New Approach | Latency |
|----------|-------------|-------------|---------|
| Copilot | `copilot-cli` subprocess via JSON-RPC | Direct HTTP POST to Copilot API | ~2-5s (was ~30s) |
| Claude Code | `claude --print` with token estimation | `claude -p` with `--output-format json` | ~12s (exact tokens) |

---

## Copilot Provider: Direct HTTP

**File:** `lib/llm/providers/copilot-provider.ts`

The copilot provider sends a direct HTTP POST to the GitHub Copilot chat completions endpoint (OpenAI-compatible):

```
POST https://copilot-api.{enterprise-host}/chat/completions
Authorization: Bearer <oauth-refresh-token>
Content-Type: application/json
User-Agent: opencode/1.0
Openai-Intent: conversation-edits
```

### Authentication

- **Source:** OAuth token from `~/.local/share/opencode/auth.json` (written by OpenCode)
- **Token field:** `refresh` from the `github-copilot-enterprise` or `github-copilot` entry
- **Enterprise URL:** Auto-detected from `enterpriseUrl` field → `https://copilot-api.{enterpriseUrl}`
- **Public fallback:** `https://api.githubcopilot.com` (when no enterprise URL)
- **Token refresh:** Re-reads auth.json at most every 60 seconds
- **401/403 handling:** Forces immediate re-read of auth.json

### Docker Support

In Docker (`LLM_CLI_PROXY_URL` set), the provider delegates to the host-side proxy bridge which has access to the auth tokens.

### No Longer Uses

- `CLIProviderBase` — extends `BaseProvider` directly
- `copilot-cli` subprocess — no CLI spawning
- `@github/copilot-sdk` — no SDK dependency

---

## Claude Code Provider: CLI Shell-Out

**File:** `lib/llm/providers/claude-code-provider.ts`

The claude-code provider shells out to the `claude` CLI in non-interactive mode:

```bash
claude -p "<prompt>" --output-format json --model sonnet --tools "" --no-session-persistence [--system-prompt "<sp>"]
```

### Authentication

- **Source:** Claude Max subscription OAuth token from macOS Keychain
- **Key entry:** `"Claude Code-credentials"` (managed by `claude` CLI)
- **CRITICAL:** `ANTHROPIC_API_KEY` must be **stripped** from the subprocess environment. If present, the CLI uses API credits instead of the Max OAuth subscription.
- **Also stripped:** `ANTHROPIC_AUTH_TOKEN`
- **Auth check:** `claude auth status` returns JSON with `loggedIn` and `authMethod` fields

### Why Not Direct API?

The Claude Max OAuth token **cannot** be used directly against `api.anthropic.com` from non-CLI clients — the API returns 401 (server-side client allowlisting). The `claude` CLI is the only supported client for subscription-based access.

### JSON Output

The `--output-format json` flag returns structured output with exact token counts:

```json
{
  "type": "result",
  "is_error": false,
  "result": "...",
  "usage": { "input_tokens": 123, "output_tokens": 456 },
  "modelUsage": {
    "claude-sonnet-4-20250514": {
      "inputTokens": 100,
      "outputTokens": 450,
      "cacheReadInputTokens": 23,
      "costUSD": 0.0
    }
  }
}
```

### No Longer Uses

- `CLIProviderBase` — extends `BaseProvider` directly
- `--print --silent` flags — uses `-p --output-format json` instead
- Token estimation — gets exact counts from JSON output
- `@anthropic-ai/claude-agent-sdk` — no SDK dependency

---

## Proxy Bridge Architecture

Both providers support Docker containers via the HTTP proxy bridge (`src/llm-proxy/llm-proxy.mjs`):

```
Docker Container                    Host Machine
┌──────────────┐                   ┌──────────────────────┐
│ LLM Service  │ ── HTTP ──────>  │ llm-proxy.mjs        │
│ ProviderReg  │  /api/complete   │  ├── Copilot: HTTP    │ ── POST ──> copilot-api.{host}
│              │  /health         │  └── Claude: CLI      │ ── spawn -> claude -p
└──────────────┘                   └──────────────────────┘
```

- **Copilot requests** on the proxy: Direct HTTP to Copilot API (same as host-side provider)
- **Claude requests** on the proxy: Shell out to `claude -p` CLI (host has keychain access)
- **API providers** (Groq, Anthropic, OpenAI): Direct HTTPS from container, no proxy needed

---

## Network Compatibility

| Scenario | Copilot (Direct HTTP) | Claude (CLI) |
|----------|----------------------|-------------|
| Outside VPN, no proxy | ✓ (~2s) | ✓ (~12s) |
| Inside VPN, corporate proxy | ✓ (~2s) | ✓ (~12s) |
| Docker container | ✓ (via proxy bridge) | ✓ (via proxy bridge) |

---

## Provider Priority

```yaml
fast:     ["copilot", "groq", "claude-code", "anthropic", "openai", "gemini", "github-models"]
standard: ["copilot", "groq", "claude-code", "anthropic", "openai", "gemini", "github-models"]
premium:  ["copilot", "groq", "claude-code", "anthropic", "openai", "gemini", "github-models"]
```

**Why Copilot first?** Direct HTTP scales with parallelism (~2s per call, even at high concurrency). Batch agents use `Promise.all` with concurrency 5-20.

---

## Configuration

Provider configs in `config/llm-providers.yaml`:

```yaml
providers:
  copilot:
    timeout: 120000
    models:
      fast: "claude-haiku-4.5"
      standard: "claude-sonnet-4.6"
      premium: "claude-opus-4.6"
    quotaTracking:
      enabled: true
      softLimitPerHour: 100

  claude-code:
    timeout: 120000
    models:
      fast: "haiku"
      standard: "sonnet"
      premium: "opus"
    quotaTracking:
      enabled: true
      softLimitPerHour: 100
```

---

## Performance Comparison

| Approach | Per-call latency | Method |
|----------|-----------------|--------|
| SDK spawn (original) | 30-120s | `copilot-cli` / `claude-agent-sdk` subprocess |
| CLI generic (previous) | 5-30s | `CLIProviderBase` with `--print --silent` |
| Direct HTTP + CLI JSON (current) | 2-15s | HTTP POST / `claude -p --output-format json` |

---

## Files

### Provider Files
1. `lib/llm/providers/copilot-provider.ts` — Direct HTTP to Copilot API
2. `lib/llm/providers/claude-code-provider.ts` — CLI shell-out with JSON output
3. `lib/llm/providers/base-provider.ts` — Abstract base (both extend this directly)
4. `lib/llm/providers/cli-provider-base.ts` — Legacy CLI base (kept for reference, unused by subscription providers)

### Infrastructure
5. `lib/llm/subscription-quota-tracker.ts` — Quota tracking with exponential backoff
6. `src/llm-proxy/llm-proxy.mjs` — HTTP proxy bridge for Docker containers

### Configuration
7. `config/llm-providers.yaml` — Provider configs, model tiers, network overrides

---

**Last updated:** 2026-03-31
