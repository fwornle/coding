# Phase 20: Foundation & OpenCode OM - Research

**Researched:** 2026-03-29
**Domain:** @mastra/opencode plugin installation, LLM proxy porting, LibSQL observation storage, token budget configuration
**Confidence:** HIGH

## Summary

Phase 20 establishes the foundation for observational memory in the coding project. The core work involves four distinct components: (1) installing the `@mastra/opencode` npm package (confirmed published as v0.0.16 with 136 versions), (2) porting the OKM LLM proxy from `rapid-automations` into this repo for subscription-based LLM access, (3) setting up per-project LibSQL observation storage at `.observations/`, and (4) creating a token budget configuration file.

The OKM proxy to port is a well-structured ~3,500-line TypeScript LLM service with provider registry, circuit breaker, caching, and an HTTP bridge server (`llm-proxy.mjs`, 353 lines). The proxy enables Docker containers to call back to host-side SDKs (Claude Agent SDK and Copilot SDK) without needing API keys. For Phase 20, we need a subset: the proxy bridge server + the two subscription providers (claude-code, copilot) + supporting infrastructure (types, base provider, config).

**Primary recommendation:** Port the LLM proxy incrementally -- start with the HTTP bridge server (`llm-proxy.mjs`) and the two SDK providers, then add the full LLMService facade. Install `@mastra/opencode@0.0.16` via npm. Use `.observations/config.json` for token budgets with fast/cheap model defaults.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Use the OKM proxy pattern from `rapid-automations/integrations/operational-knowledge-management` -- Docker container calls back to host agent's SDK (no direct API keys)
- D-02: Network-adaptive SDK routing: inside VPN -> Copilot Enterprise subscription, outside VPN -> Claude subscription (same pattern as `config/agents/opencode.sh` agent_pre_launch)
- D-03: Port the proxy code into this repo (copy from rapid-automations/OKM into `src/` or `integrations/`), not a shared package or submodule
- D-04: Observation DB lives at per-project `.observations/` directory (alongside `.specstory/`)
- D-05: Single shared LibSQL DB per project across all agents (Claude, OpenCode, Mastra) -- unified observation history
- D-06: Existing `.data/` convention is for pipeline data; observations are session data, hence separate `.observations/`
- D-07: `install.sh` installs `@mastra/opencode` via npm (try npm first, fall back to monorepo build if not published)
- D-08: `uninstall.sh` removes the plugin and cleans up
- D-09: `scripts/test-coding.sh` runs a full smoke test: start OpenCode briefly, verify observation DB is created, plugin hooks fire
- D-10: Token budgets configured via JSON config file at `.observations/config.json` per project
- D-11: Default model tier is fast/cheap (flash models -- Groq llama, gemini-flash) since observations are background work
- D-12: Config includes per-agent budgets, observer/reflector thresholds, model selection
- D-13: LSL and mastra operate independently in parallel -- no coordination needed
- D-14: Long-term vision: observations replace LSL as primary record. For THIS milestone: both run additively
- D-15: Observations and LSL files share session IDs for cross-referencing during the transition period

### Claude's Discretion
- Schema migration strategy for LibSQL (mastra handles this internally)
- Exact observation fields/structure (determined by mastra's MastraDBMessage type)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OCOM-01 | The mastra/opencode plugin is installed via install.sh (with uninstall.sh and test-coding.sh validation) | @mastra/opencode@0.0.16 confirmed on npm. Plugin exports `MastraPlugin` and reads config from `.opencode/mastra.json`. Install/uninstall patterns from existing `install_semantic_analysis()` function. Test pattern from `test_enhanced_lsl()`. |
| OCOM-02 | Observation storage uses LibSQL with configurable path and schema setup | @mastra/libsql@1.7.2 on npm. Plugin defaults to `.opencode/memory/observations.db` but accepts `storagePath` config. Decision D-04 overrides to `.observations/`. Schema managed by `LibSQLStore.init()` + `ObservationalMemory`. |
| OCOM-03 | Observer/reflector agents use the coding LLM proxy (Docker to host agent SDK) instead of direct API keys | OKM proxy (`llm-proxy.mjs`) provides HTTP bridge at port 8089. CopilotProvider and ClaudeCodeProvider support proxy fallback via `LLM_CLI_PROXY_URL`. Plugin uses OpenCode's credential resolution (`ctx.client.config.providers()`). |
| OCOM-04 | Token budget limits are configurable per observer/reflector agent to control LLM costs | Plugin config supports `observation.messageTokens`, `reflection.observationTokens`, and model selection. `.observations/config.json` will hold defaults. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@mastra/opencode` | 0.0.16 | OpenCode plugin for Mastra Observational Memory | Published npm package. Provides `MastraPlugin` that hooks into OpenCode's lifecycle. Dependencies: @mastra/core@1.16.0, @mastra/libsql@1.7.2, @mastra/memory@1.10.0 |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.86 | Claude Code subscription-based LLM access | Used by LLM proxy for Claude Max subscription OAuth. Already a dependency in OKM. |
| `@github/copilot-sdk` | ^0.2.0 | Copilot subscription-based LLM access | Used by LLM proxy for GitHub Copilot Enterprise. Persistent CopilotClient (JSON-RPC). |

### Supporting (from OKM, to port)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yaml` | ^2.8.2 | YAML config parsing for llm-providers.yaml | LLM proxy config loading |
| `express` | ^5.2.1 | HTTP server for LLM proxy (if upgrading from raw http) | Only if proxy grows beyond simple bridge |

### What NOT to Install
The `@mastra/opencode` plugin bundles its own dependencies (`@mastra/core`, `@mastra/libsql`, `@mastra/memory`). Do NOT install these separately in the coding project's `package.json` -- they come transitively.

**Installation:**
```bash
# OpenCode plugin (installed into coding project for plugin config)
npm install @mastra/opencode@0.0.16

# LLM proxy SDKs (installed on HOST, not in Docker)
npm install @anthropic-ai/claude-agent-sdk@^0.2.86 @github/copilot-sdk@^0.2.0
```

## Architecture Patterns

### Recommended Project Structure for New Components
```
src/
  llm-proxy/                    # Ported from OKM -- LLM proxy service
    llm-proxy.mjs               # HTTP bridge server (standalone, runs on host)
    providers/
      base-provider.ts          # Abstract base
      claude-code-provider.ts   # Claude Agent SDK provider
      copilot-provider.ts       # Copilot SDK provider
      groq-provider.ts          # Fast/cheap API provider (for observations)
    types.ts                    # Shared types
    config.ts                   # YAML config loader
    llm-service.ts              # High-level facade (optional for Phase 20)
    provider-registry.ts        # Provider chain resolution
    circuit-breaker.ts          # Failure isolation
    cache.ts                    # Response caching
  config/
    llm-providers.yaml          # Provider config (ported from OKM)
.observations/                  # Per-project observation storage
  config.json                   # Token budget config
  observations.db               # LibSQL database (created by plugin)
.opencode/
  mastra.json                   # Plugin config for @mastra/opencode
```

### Pattern 1: LLM Proxy Bridge (Host-to-Docker)
**What:** HTTP server on host exposes SDK-based LLM completions to Docker containers via `LLM_CLI_PROXY_URL`
**When to use:** Whenever Docker services need subscription-based LLM access (Claude Max, Copilot Enterprise)
**Key insight:** The proxy server (`llm-proxy.mjs`) is a standalone ~350-line Node.js script. It initializes both SDK clients at startup, then serves `/health` and `/api/complete` endpoints. Providers inside Docker check `LLM_CLI_PROXY_URL` env var and route through the proxy transparently.

```javascript
// Source: rapid-automations/OKM/docker/llm-proxy.mjs
// HTTP bridge: POST /api/complete { provider, messages, model }
// Returns: { content, provider, model, tokens, latencyMs }
// Health: GET /health -> { providers: { 'claude-code': { available }, copilot: { available } } }
```

### Pattern 2: Network-Adaptive Provider Selection
**What:** VPN detection determines which subscription provider to prioritize
**When to use:** Agent pre-launch and proxy initialization
**Source pattern:** `config/agents/opencode.sh` already implements this with `INSIDE_CN` detection

```bash
# From opencode.sh -- same pattern for observation LLM routing
if [ "$INSIDE_CN" = "true" ]; then
  # VPN: prioritize Copilot Enterprise (corporate subscription)
  export OBSERVATION_PROVIDER="copilot"
else
  # Public: prioritize Claude (personal subscription)
  export OBSERVATION_PROVIDER="claude-code"
fi
```

### Pattern 3: Plugin Config Convention
**What:** `@mastra/opencode` reads config from `.opencode/mastra.json`
**When to use:** Configuring the OpenCode OM plugin
**Verified from:** Package source inspection (index.js line 9: `CONFIG_FILE = ".opencode/mastra.json"`)

```json
{
  "model": "google/gemini-2.5-flash",
  "storagePath": ".observations/observations.db",
  "observation": {
    "messageTokens": 20000
  },
  "reflection": {
    "observationTokens": 90000
  }
}
```

### Pattern 4: install.sh Function Convention
**What:** Each integration gets an `install_<name>()` function with dependency checks, install, build, validation
**Source:** `install_semantic_analysis()` at line 678 of install.sh
**Key steps:** Check prerequisites -> install dependencies -> build if needed -> validate

### Anti-Patterns to Avoid
- **Sharing one LibSQL DB across concurrent writers:** Decision D-05 says single shared DB, but the plugin creates its own. Resolve by configuring the plugin's `storagePath` to point to the shared `.observations/observations.db`. The plugin is the primary writer during OpenCode sessions.
- **Installing @mastra/core separately:** It comes as a transitive dependency of @mastra/opencode. Double-installing creates version conflicts.
- **Running LLM proxy inside Docker:** The proxy MUST run on the host because it needs access to macOS Keychain (Claude OAuth) and `gh auth` (Copilot). Docker containers connect via `host.docker.internal`.
- **Using expensive models for observation:** Observations are background compression. Use gemini-2.5-flash or groq llama, not claude-opus.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Observation compression | Custom summarizer | @mastra/memory ObservationalMemory | 95% LongMemEval score, battle-tested Observer/Reflector architecture |
| LibSQL schema management | Manual CREATE TABLE | LibSQLStore.init() | Mastra handles schema creation, migration, and versioning internally |
| SDK lifecycle management | Per-request CLI spawns | Persistent SDK clients (CopilotClient, Agent SDK query()) | CLI spawn overhead is 2-5 seconds per call; SDKs maintain persistent connections |
| OpenCode plugin hooks | Custom OpenCode fork | @mastra/opencode MastraPlugin | Plugin handles message conversion, session lifecycle, credential resolution, toast notifications |
| Token counting | Custom tokenizer | @mastra/memory TokenCounter | Consistent with Mastra's threshold logic |

## Common Pitfalls

### Pitfall 1: Plugin Storage Path vs Decision D-04
**What goes wrong:** The @mastra/opencode plugin defaults to `.opencode/memory/observations.db` but decision D-04 requires `.observations/`
**Why it happens:** Plugin has its own default, project has a different convention
**How to avoid:** Set `storagePath` in `.opencode/mastra.json` to `.observations/observations.db` explicitly
**Warning signs:** DB file appearing in `.opencode/memory/` instead of `.observations/`

### Pitfall 2: Credential Resolution Timing
**What goes wrong:** Plugin tries to resolve OpenCode provider credentials before they're available
**Why it happens:** `resolveCredentials()` calls `ctx.client.config.providers()` which may not be ready immediately
**How to avoid:** The plugin already handles this with lazy `resolveCredentials()` called in the transform hook, not at init time. No action needed, but test with a fresh session.
**Warning signs:** "Failed to initialize Observational Memory" toast on session start

### Pitfall 3: LLM Proxy Not Started Before Docker Services
**What goes wrong:** Docker containers check `LLM_CLI_PROXY_URL` at initialization, find proxy unavailable, mark providers as permanently unavailable via circuit breaker
**Why it happens:** Proxy server must be running BEFORE Docker services start
**How to avoid:** Start proxy in agent_pre_launch or as a launchd/systemd service. Add health check retry logic.
**Warning signs:** `[llm:proxy] copilot: proxy check failed at http://host.docker.internal:8089/health`

### Pitfall 4: D-05 Single Shared DB vs Per-Agent Isolation
**What goes wrong:** Decision D-05 says single shared DB, but ARCHITECTURE.md recommends per-agent DBs to avoid lock contention
**Why it happens:** LibSQL/SQLite write locking. If mastracode and OpenCode plugin both write to the same .db, one may block.
**How to avoid:** For Phase 20 (OpenCode only), a single DB is fine -- only one writer at a time. The multi-writer concern becomes real in Phase 21 when mastracode joins. For now, use `.observations/observations.db` as the single shared path.
**Warning signs:** SQLITE_BUSY errors in plugin logs

### Pitfall 5: Node.js Version Requirement
**What goes wrong:** @mastra/opencode requires Node.js >= 22.13.0
**Why it happens:** Uses modern Node APIs (native fetch, import assertions)
**How to avoid:** Project already uses Node v25.8.1 -- no issue. But install.sh should validate.
**Warning signs:** SyntaxError or import failures

### Pitfall 6: OKM Proxy Port Scope Creep
**What goes wrong:** Porting all 3,526 lines of the OKM LLM module when only the proxy bridge is needed for Phase 20
**Why it happens:** The full LLMService facade includes budget tracking, sensitivity classification, mock service, metrics, etc.
**How to avoid:** For Phase 20, port ONLY: `llm-proxy.mjs` (353 lines, standalone), `types.ts` (subset), and the two SDK provider files for reference. The full LLMService can be ported in a later phase if needed for batch conversion (Phase 22).
**Warning signs:** Porting provider-registry.ts, circuit-breaker.ts, cache.ts before they're needed

## Code Examples

### @mastra/opencode Plugin Config (.opencode/mastra.json)
```json
// Source: verified from npm package dist/index.js
{
  "model": "google/gemini-2.5-flash",
  "storagePath": ".observations/observations.db",
  "observation": {
    "messageTokens": 20000
  },
  "reflection": {
    "observationTokens": 90000
  }
}
```

### Token Budget Config (.observations/config.json)
```json
{
  "version": 1,
  "defaults": {
    "model": "google/gemini-2.5-flash",
    "observation": {
      "messageTokens": 20000,
      "bufferTokens": 0.2
    },
    "reflection": {
      "observationTokens": 90000,
      "bufferTokens": 0.2
    }
  },
  "agents": {
    "opencode": {
      "model": "google/gemini-2.5-flash",
      "maxDailyTokens": 500000
    },
    "mastra": {
      "model": "google/gemini-2.5-flash",
      "maxDailyTokens": 500000
    },
    "claude": {
      "model": "groq/llama-3.3-70b-versatile",
      "maxDailyTokens": 1000000
    }
  }
}
```

### install.sh Function Pattern
```bash
# Source: install.sh line 678 (install_semantic_analysis pattern)
install_mastra_opencode() {
    echo -e "\n${CYAN}Installing Mastra OpenCode plugin...${NC}"
    cd "$CODING_REPO"

    # Check Node.js version
    local node_major=$(node -v | sed 's/v\([0-9]*\).*/\1/')
    if [[ $node_major -lt 22 ]]; then
        warning "Node.js >= 22.13.0 required for @mastra/opencode"
        return 1
    fi

    # Install plugin
    if npm install @mastra/opencode@latest; then
        success "Mastra OpenCode plugin installed"
    else
        warning "npm install failed, trying monorepo build..."
        # Fallback: clone mastra monorepo and build
        return 1
    fi

    # Create .observations directory
    mkdir -p .observations

    # Create default config if not exists
    if [[ ! -f ".observations/config.json" ]]; then
        cat > .observations/config.json << 'EOCFG'
{
  "version": 1,
  "defaults": {
    "model": "google/gemini-2.5-flash",
    "observation": { "messageTokens": 20000 },
    "reflection": { "observationTokens": 90000 }
  }
}
EOCFG
        success "Created default token budget config"
    fi

    # Create .opencode/mastra.json if not exists
    mkdir -p .opencode
    if [[ ! -f ".opencode/mastra.json" ]]; then
        cat > .opencode/mastra.json << 'EOCFG'
{
  "model": "google/gemini-2.5-flash",
  "storagePath": ".observations/observations.db",
  "observation": { "messageTokens": 20000 },
  "reflection": { "observationTokens": 90000 }
}
EOCFG
        success "Created OpenCode Mastra plugin config"
    fi

    cd "$CODING_REPO"
}
```

### test-coding.sh Smoke Test Pattern
```bash
# Source: test-coding.sh line 2453 (test_enhanced_lsl pattern)
test_mastra_opencode() {
    print_section "Testing Mastra OpenCode Plugin"
    local tests_passed=0
    local tests_total=5

    # Test 1: Package installed
    print_test "Mastra OpenCode package"
    if node -e "require.resolve('@mastra/opencode')" 2>/dev/null; then
        print_pass "Package installed"
        tests_passed=$((tests_passed + 1))
    else
        print_fail "Package not found"
    fi

    # Test 2: .observations directory
    print_test "Observations directory"
    if [[ -d "$CODING_REPO/.observations" ]]; then
        print_pass "Directory exists"
        tests_passed=$((tests_passed + 1))
    fi

    # Test 3: Config files
    print_test "Configuration files"
    if [[ -f "$CODING_REPO/.observations/config.json" ]] && \
       [[ -f "$CODING_REPO/.opencode/mastra.json" ]]; then
        print_pass "Config files present"
        tests_passed=$((tests_passed + 1))
    fi

    # Test 4: Plugin exports
    print_test "Plugin exports MastraPlugin"
    if timeout 10s node -e "
      import('@mastra/opencode').then(m => {
        if (m.MastraPlugin) console.log('MastraPlugin exported');
        else process.exit(1);
      }).catch(() => process.exit(1));
    " 2>/dev/null; then
        print_pass "MastraPlugin exports verified"
        tests_passed=$((tests_passed + 1))
    fi

    # Test 5: LibSQL DB can be created
    print_test "LibSQL database creation"
    if timeout 10s node -e "
      import { LibSQLStore } from '@mastra/libsql';
      const store = new LibSQLStore({ url: 'file:$CODING_REPO/.observations/test.db' });
      await store.init();
      console.log('DB initialized');
    " 2>/dev/null; then
        rm -f "$CODING_REPO/.observations/test.db"
        print_pass "LibSQL DB creation works"
        tests_passed=$((tests_passed + 1))
    fi

    print_summary "Mastra OpenCode" $tests_passed $tests_total
}
```

### LLM Proxy Bridge (Minimal Port)
```javascript
// Source: rapid-automations/OKM/docker/llm-proxy.mjs (lines 1-353)
// This is the COMPLETE standalone file to port. Key endpoints:
//
// GET /health -> { status: 'ok', providers: { 'claude-code': { available }, copilot: { available } } }
// POST /api/complete -> { content, provider, model, tokens: { input, output, total }, latencyMs }
//
// Start: LLM_PROXY_PORT=8089 node src/llm-proxy/llm-proxy.mjs
// Docker env: LLM_CLI_PROXY_URL=http://host.docker.internal:8089
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CLI spawning per LLM call | Persistent SDK clients (CopilotClient, Agent SDK) | OKM 2026-03 | Eliminates 2-5s spawn overhead per call |
| API key auth | Subscription OAuth (Claude Max, Copilot Enterprise) | OKM 2026-02 | Zero marginal cost for LLM calls |
| Per-agent observation DBs | Single shared LibSQL DB (D-05) | Phase 20 decision | Simpler querying, single source of truth |
| .data/observations/ path | .observations/ path (D-04/D-06) | Phase 20 decision | Separates session data from pipeline data |

## Open Questions

1. **Plugin vs Proxy Integration Point**
   - What we know: The @mastra/opencode plugin resolves credentials via `ctx.client.config.providers()` (OpenCode's built-in credential store). The LLM proxy is for Docker containers.
   - What's unclear: Does the OpenCode plugin need to use the LLM proxy at all, or does it use OpenCode's own provider credentials directly?
   - Recommendation: The plugin uses OpenCode's credentials natively. The LLM proxy is for future phases (batch converter in Phase 22, enhanced-transcript-monitor tap in Phase 23). For Phase 20, port the proxy but it may only be validated, not actively used by the plugin.

2. **Shared DB Write Contention in Future Phases**
   - What we know: D-05 requires single shared DB. Phase 20 has only one writer (OpenCode plugin).
   - What's unclear: How LibSQL handles concurrent writers from mastracode + OpenCode in Phase 21.
   - Recommendation: Proceed with single DB for Phase 20. Test concurrent writes in Phase 21. LibSQL has WAL mode which helps, but monitor for SQLITE_BUSY.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | @mastra/opencode (>=22.13.0) | Yes | v25.8.1 | -- |
| OpenCode CLI | Plugin testing | Yes | installed at ~/.opencode/bin/opencode | -- |
| Claude CLI | LLM proxy (claude-code provider) | Yes | /opt/homebrew/bin/claude | -- |
| npm | Package installation | Yes | (bundled with Node) | -- |
| @mastra/opencode | OCOM-01 | Yes (npm) | 0.0.16 | Monorepo build |
| @anthropic-ai/claude-agent-sdk | LLM proxy | Needs install | ^0.2.86 on npm | -- |
| @github/copilot-sdk | LLM proxy | Needs install | ^0.2.0 on npm | -- |

**Missing dependencies with no fallback:** None -- all dependencies are available.

**Missing dependencies with fallback:**
- `@mastra/opencode` is on npm (no fallback needed; D-07's monorepo fallback is unnecessary)

## OKM Proxy Port Inventory

### Files to Port (Minimal Set for Phase 20)

| Source File | Lines | Port Priority | Notes |
|-------------|-------|--------------|-------|
| `docker/llm-proxy.mjs` | 353 | MUST | Standalone HTTP bridge. Copy as-is to `src/llm-proxy/llm-proxy.mjs`. |
| `src/llm/types.ts` | 204 | MUST | Core types. Port subset: LLMCompletionRequest, LLMCompletionResult, ProviderName, ModelTier. |
| `config/llm-providers.yaml` | 70 | MUST | Provider config. Copy to `config/llm-providers.yaml`. Adjust provider priority for observation use case. |
| `src/llm/providers/base-provider.ts` | 41 | SHOULD | Abstract base. Small, clean. |
| `src/llm/providers/claude-code-provider.ts` | 251 | SHOULD | Reference for future TypeScript proxy. Not needed if using llm-proxy.mjs directly. |
| `src/llm/providers/copilot-provider.ts` | 239 | SHOULD | Reference for future TypeScript proxy. Not needed if using llm-proxy.mjs directly. |
| `src/llm/providers/cli-provider-base.ts` | 305 | DEFER | Only needed if converting proxy to TypeScript later. |
| `src/llm/llm-service.ts` | 543 | DEFER | Full facade with budget/sensitivity/metrics. Phase 22+ need. |
| `src/llm/provider-registry.ts` | 244 | DEFER | Chain resolution. Phase 22+ need. |
| `src/llm/circuit-breaker.ts` | ~80 | DEFER | Failure isolation. Proxy has inline retry. |
| `src/llm/cache.ts` | ~80 | DEFER | Response cache. Not needed for observation calls. |
| `src/llm/config.ts` | 242 | DEFER | YAML config loader. Proxy loads config inline. |

**Total MUST port: ~627 lines. Total SHOULD port: ~531 lines for reference.**

### Key Differences from OKM

1. **Storage path:** OKM uses `.data/observations/`, Phase 20 uses `.observations/`
2. **Provider priority:** OKM prioritizes copilot > claude-code. Phase 20 should follow network detection (VPN -> copilot, outside -> claude-code)
3. **Package scope:** OKM runs inside its own npm project. Phase 20 adds packages to the coding project's `package.json`
4. **Proxy lifecycle:** OKM starts proxy manually. Phase 20 should integrate proxy start into `agent_pre_launch` or `install.sh`

## Sources

### Primary (HIGH confidence)
- @mastra/opencode npm package v0.0.16 -- inspected dist/index.js and dist/index.d.ts directly
- @mastra/opencode package.json -- confirmed dependencies: @mastra/core@1.16.0, @mastra/libsql@1.7.2, @mastra/memory@1.10.0
- OKM proxy source at `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/` -- read all key files
- npm registry -- verified @mastra/opencode@0.0.16, @mastra/memory@1.10.0, @mastra/libsql@1.7.2, @mastra/core@1.17.0
- Existing coding project infrastructure -- config/agents/opencode.sh, install.sh, test-coding.sh patterns

### Secondary (MEDIUM confidence)
- STACK.md and ARCHITECTURE.md from milestone research -- comprehensive but some claims (observe() API) unverified against latest package

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages verified on npm with exact versions
- Architecture: HIGH -- OKM proxy source read in full, patterns verified against existing coding infrastructure
- Pitfalls: HIGH -- derived from concrete code analysis (storage paths, credential timing, proxy lifecycle)
- Plugin API: HIGH -- inspected actual dist/index.js from npm package

**Research date:** 2026-03-29
**Valid until:** 2026-04-15 (packages are actively updated; @mastra/opencode has 136 versions)
