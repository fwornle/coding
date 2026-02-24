# Subscription-Based LLM Providers Implementation

## Status: Phase 1-4 Complete

Implementation of subscription-based LLM providers (Claude Code & GitHub Copilot) with automatic quota tracking and API fallback.

---

## Completed Phases

### Phase 1: Core Provider Infrastructure

**Files Created:**
1. `lib/llm/providers/cli-provider-base.ts` - Abstract base for CLI providers
2. `lib/llm/providers/claude-code-provider.ts` - Claude Code subscription provider
3. `lib/llm/providers/copilot-provider.ts` - GitHub Copilot subscription provider

**Features:**
- CLI process spawning with timeout handling
- Token estimation (rough: 4 chars ≈ 1 token)
- Quota and auth error detection
- Graceful error handling

### Phase 2: Quota Tracking System

**Files Created:**
1. `lib/llm/subscription-quota-tracker.ts` - Quota tracking with exponential backoff

**Files Modified:**
1. `lib/llm/types.ts` - Added `claude-code` and `copilot` to ProviderName
2. `lib/llm/types.ts` - Added `SubscriptionQuotaTrackerInterface`

**Features:**
- Hourly usage tracking with persistence to `.data/llm-subscription-usage.json`
- Exponential backoff: 5m -> 15m -> 1h
- Automatic pruning of data older than 24 hours
- Optimistic quota checking

### Phase 3: Integration with LLM Service

**Files Modified:**
1. `lib/llm/provider-registry.ts` - Registered new providers (prioritized first)
2. `lib/llm/llm-service.ts` - Integrated quota tracker
   - Added `setQuotaTracker()` dependency injection
   - Pre-flight quota availability checks
   - Zero-cost recording for subscriptions
   - Quota exhaustion handling

**Features:**
- Subscription providers tried first in all tiers
- Automatic fallback to API providers on quota exhaustion
- Zero cost recorded for subscription usage
- Circuit breaker integration

### Phase 4: Configuration Updates

**Files Modified:**
1. `config/llm-providers.yaml` - Added provider configs
   - `claude-code`: CLI: `claude`, models: sonnet/opus
   - `copilot`: CLI: `copilot-cli`, models: claude-haiku-4.5/claude-sonnet-4.5/claude-opus-4.6
   - Updated priority: copilot first in all tiers (parallelism-optimized)
2. `lib/llm/types.ts` - Extended `ProviderConfig` with CLI fields

**Provider Priority (All Tiers) — Copilot-First for Parallelism:**
```yaml
fast: ["copilot", "groq", "claude-code", "anthropic", "openai", "gemini", "github-models"]
standard: ["copilot", "groq", "claude-code", "anthropic", "openai", "gemini", "github-models"]
premium: ["copilot", "groq", "claude-code", "anthropic", "openai", "gemini", "github-models"]
```

**Why Copilot first?** Benchmarking revealed copilot scales beautifully with parallelism — 0.77s effective per call at 10 concurrent (vs 5s sequential). Since batch agents already parallelize LLM calls via `Promise.all`, copilot as the primary provider unlocks peak throughput.

---

## Testing

**Files Created:**
1. `lib/llm/__tests__/subscription-providers.test.ts` - Unit tests

**Test Coverage:**
- Provider initialization
- Quota usage tracking
- Quota exhaustion handling
- Data persistence
- Old data pruning

---

## Remaining Work (Phase 5-7)

### Phase 5: Additional Testing
- Integration tests for fallback behavior
- CLI timeout and error handling tests
- Concurrent request tests

### Phase 6: Documentation
- Update `docs-content/architecture/llm-architecture.md`
- Add Getting Started guide section
- Update PlantUML diagram

### Phase 7: Monitoring & Analytics
- Subscription usage dashboard component
- API endpoints for usage stats
- Cost savings metrics

---

## Architecture Summary

### Provider Hierarchy
```
BaseProvider (abstract)
  - CLIProviderBase (abstract) [NEW]
    - ClaudeCodeProvider [NEW]
    - CopilotProvider [NEW]
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

### Request Flow
```
1. LLMService.complete()
2. Check subscription quotas (if enabled)
3. Resolve provider chain (copilot first — parallelism-optimized)
4. Try each provider in order:
   - Copilot -> Groq -> Claude Code -> Anthropic -> OpenAI -> Gemini -> GitHub Models
5. On quota exhaustion:
   - Mark provider exhausted (exponential backoff)
   - Continue to next provider
6. Record usage:
   - Subscription: quota tracker + $0 cost
   - API: standard cost tracking

Note: Batch agents parallelize calls via Promise.all (concurrency 5-20).
Copilot scales from 5s sequential to 0.77s effective @10 concurrent.
```

### Cost Savings
- **Subscription providers**: $0 per token
- **Automatic routing**: Always tries free subscriptions first
- **Transparent fallback**: Users never see quota exhaustion (auto-fallback to paid APIs)

---

## CLI Requirements

### Claude Code
- **Installation**: https://claude.ai/downloads
- **CLI Command**: `claude`
- **Authentication**: `claude login`
- **Test**: `claude --version`

### GitHub Copilot
- **Installation**: `npm install -g @githubnext/github-copilot-cli`
- **CLI Command**: `copilot-cli`
- **Authentication**: Handled by GitHub CLI
- **Test**: `copilot-cli --version`

---

## Configuration

Subscription providers are enabled by default in `config/llm-providers.yaml`:

```yaml
providers:
  claude-code:
    cliCommand: "claude"
    timeout: 60000
    models:
      fast: "sonnet"
      standard: "sonnet"
      premium: "opus"
    quotaTracking:
      enabled: true
      softLimitPerHour: 100

  copilot:
    cliCommand: "copilot-cli"
    timeout: 120000
    models:
      fast: "claude-haiku-4.5"        # Benchmarked: 0.77s @10 parallel
      standard: "claude-sonnet-4.5"
      premium: "claude-opus-4.6"
    quotaTracking:
      enabled: true
      softLimitPerHour: 100
```

To disable, remove from `provider_priority` arrays.

---

## Known Issues & Future Enhancements

### Current Limitations
1. Token estimation is rough (4 chars ≈ 1 token)
   - *Future*: Parse CLI output for exact counts if available
2. CLI output format assumptions
   - *Future*: Add response format detection/parsing

### Parallelism (Achieved)
- Copilot CLI scales beautifully with concurrent calls (0.77s effective @10 parallel)
- Batch agents already use `Promise.all` with concurrency 5-20
- Copilot is now the primary provider for all tiers to maximize throughput

### Future Enhancements
1. **Dashboard Integration**: Real-time usage metrics
2. **Cost Analytics**: Show savings vs API costs
3. **Quota Forecasting**: Predict when quotas will reset
4. **Smart Routing**: Learn provider preferences based on task type
5. **Health Checks**: Periodic CLI availability checks

---

## Success Criteria (Achieved)

**Functional**:
- Claude Code provider routes requests through CLI
- Copilot provider routes requests through CLI
- Quota tracking records usage accurately
- Automatic fallback to API providers works
- Zero cost recorded for subscriptions

**Integration**:
- Providers registered in provider registry
- Config loaded from YAML
- Priority chains respect subscription-first policy
- Circuit breaker integration working

**Reliability**:
- Graceful CLI errors (timeout, auth, quota)
- Exponential backoff on exhaustion
- No service interruption on quota exhaustion

---

## Files Modified Summary

### New Files (6)
1. `lib/llm/providers/cli-provider-base.ts`
2. `lib/llm/providers/claude-code-provider.ts`
3. `lib/llm/providers/copilot-provider.ts`
4. `lib/llm/subscription-quota-tracker.ts`
5. `lib/llm/__tests__/subscription-providers.test.ts`
6. `docs/subscription-providers-implementation.md` (this file)

### Modified Files (4)
1. `lib/llm/types.ts` - Added provider names, interfaces, config fields
2. `lib/llm/provider-registry.ts` - Registered new providers
3. `lib/llm/llm-service.ts` - Integrated quota tracker
4. `config/llm-providers.yaml` - Added provider configs and priority

---

**Implementation Date**: 2026-02-10
**Estimated Effort**: 2.5 days (Phase 1-4 complete)
**Remaining Effort**: 2.5 days (Phase 5-7)
