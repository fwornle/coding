# LLM Documentation Update - Resume Plan

## Session Issue
Bash tool output capture was broken (all commands returned empty). Likely related to tmux wrapper for coding sessions. Session needs restart.

## What's DONE

### 1. PlantUML Diagrams (CREATED - need PNG generation)
- `docs/puml/llm-provider-architecture.puml` - CREATED
- `docs/puml/llm-tier-routing.puml` - CREATED
- PNGs NOT generated yet (bash was broken). Run after restart:
  ```bash
  plantuml docs/puml/llm-provider-architecture.puml
  mv docs/puml/llm-provider-architecture.png docs/images/
  plantuml docs/puml/llm-tier-routing.puml
  mv docs/puml/llm-tier-routing.png docs/images/
  ```

### 2. Constraint Added
- `.constraint-monitor.yaml` - Added `no-java-jar-plantuml` constraint (critical, Bash tool filter)
- `CLAUDE.md` - Added PlantUML CLI rule to Technical Standards
- `MEMORY.md` - Updated with PlantUML CLI lesson

## What's LEFT TO DO

### 3. Create New Architecture Doc (Step 2)
**CREATE** `docs-content/architecture/llm-architecture.md`
- Overview of lib/llm/ unified layer
- 8 providers with model IDs from `config/llm-providers.yaml`
- Tier-based routing (fast/standard/premium) with priorities
- Infrastructure: circuit breaker, LRU cache, metrics
- Consumer integration (SemanticAnalyzer, UnifiedInferenceEngine, SemanticValidator)
- DI hooks: MockServiceInterface, BudgetTrackerInterface, SensitivityClassifierInterface
- Mode routing: mock/local/public
- Mermaid diagram (inline fallback since PNGs may not be ready)
- Config reference to `config/llm-providers.yaml`

### 4. Update `docs-content/guides/llm-providers.md` (Step 3)
Current file is 293 lines. Key changes:
- Lines 54-58: Update Anthropic models: `claude-3-5-sonnet-20241022` -> `claude-sonnet-4-5`, `claude-3-haiku-20240307` -> `claude-haiku-4-5`
- Lines 68-72: Update OpenAI models: `gpt-4o` -> `gpt-4.1`, `gpt-4o-mini` -> `gpt-4.1-mini`
- Lines 175-206: Replace "Provider Fallback Chain" with tier-based routing section
- Lines 338-343: Update cost table: `Anthropic Claude 3.5` -> `Anthropic Claude Sonnet 4.5`, `OpenAI GPT-4o` -> `OpenAI GPT-4.1`
- Add GitHub Models as new provider section after Gemini
- Add "Unified LLM Layer" section explaining lib/llm/
- Update summary: "5 different LLM providers" -> "8 different LLM providers"

### 5. Update `docs/provider-configuration.md` (Step 4)
- Line 23: `GROK_API_KEY` -> `GROQ_API_KEY`
- Line 119: `GROK_API_KEY` -> `GROQ_API_KEY`
- Lines 48-58: Update "Provider Priority" from flat chain to tier-based
- Add GitHub Models to Supported Providers table
- Add reference to `lib/llm/` and `config/llm-providers.yaml`

### 6. Update `docs/getting-started.md` (Step 5)
- Line 248: `GROK_API_KEY` -> `GROQ_API_KEY`
- Line 253: "GPT-4, GPT-3.5" -> "GPT-4.1, o4-mini"
- Add `GITHUB_TOKEN` to API keys section
- Add mention of lib/llm/ unified provider layer

### 7. Update `docs/integrations/mcp-semantic-analysis.md` (Step 6)
- Line 19: "3-tier LLM chain" -> "tier-based LLM routing via lib/llm/"
- Line 42: Replace "Custom LLM (primary) -> Anthropic Claude (secondary) -> OpenAI GPT (fallback)" with tier-based routing
- Line 182: Update "LLM Provider: Anthropic Claude (primary), OpenAI GPT (fallback)"

### 8. Update `docs-content/integrations/semantic-analysis.md` (Step 7)
- Line 29: "3-tier LLM chain" -> "tier-based routing via lib/llm/"

### 9. Update `docs/knowledge-management/continuous-learning-system.md` (Step 8)
- Line 141-143: Fallback chain -> tier-based via lib/llm/
- Line 355: `anthropic/claude-3.5-sonnet` -> `anthropic/claude-sonnet-4-5`

### 10. Update SA README `integrations/mcp-server-semantic-analysis/README.md` (Step 9)
- Line 46: "6-Tier LLM Provider Chain" -> "Tier-based LLM Routing via lib/llm/"
- Lines 126-139: Replace entire "6-Tier LLM Provider Chain" section with tier-based routing
- Line 131: Remove old chain `Groq -> Gemini -> Custom LLM -> Anthropic -> OpenAI -> Ollama`
- Line 179: Update LLM Provider Priority
- Line 322: "3-tier provider chain" -> "tier-based routing via lib/llm/"
- Mermaid diagrams: Update External Services section (Custom LLM -> lib/llm/)

### 11. Update SA Architecture Docs (Step 10)
**`integrations/mcp-server-semantic-analysis/docs/architecture/README.md`**:
- Line 150: "5-tier chain: Groq -> Gemini -> Custom -> Anthropic -> OpenAI" -> tier-based via lib/llm/
- Line 170: Same for QualityAssuranceAgent
- Line 197: Same for ObservationGenerationAgent
- Line 246: SemanticAnalyzer "5-tier provider chain" -> "delegates to lib/llm/ LLMService"
- Line 285: "AI Providers: Anthropic Claude, OpenAI GPT" -> "AI Providers: via lib/llm/ (8 providers)"

**`integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`**:
- Replace ALL 11 occurrences of "Groq -> Gemini -> Custom -> Anthropic -> OpenAI" with "Tier-based via lib/llm/ (fast/standard/premium)"
- Line 264: SemanticAnalyzer "5-tier provider chain" -> "delegates to lib/llm/ LLMService"
- Lines 317-332: Update LLM Integration Summary table Provider Chain column

**`integrations/mcp-server-semantic-analysis/docs/installation/README.md`**:
- Line 32: `gemini-2.0-flash-exp` -> `gemini-2.5-flash`
- Line 39: `claude-sonnet-4-20250514` -> `claude-sonnet-4-5`
- Line 47: `gpt-4` -> `gpt-4.1`

### 12. Update Constraint Monitor Docs (Step 11)
**`integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`**:
- Lines 69-80: Update model routing map:
  - `anthropic/claude-3-haiku-20240307` -> `anthropic/claude-haiku-4-5`
  - `groq/qwen-2.5-32b-instruct` -> `groq/llama-3.3-70b-versatile`
- Lines 88-89: `GROK_API_KEY` -> `GROQ_API_KEY`
- Add note about SemanticValidator delegating to lib/llm/

**`integrations/mcp-constraint-monitor/docs/semantic-detection-design.md`**:
- Line 63: `Claude Haiku, GPT-4o-mini, Gemini 1.5 Flash` -> `Claude Haiku 4.5, GPT-4.1-mini, Gemini 2.5 Flash`
- Lines 106-107: `claude-3-haiku-20240307` -> `claude-haiku-4-5`
- Line 112: `Gemini 1.5 Flash` -> `Gemini 2.5 Flash`
- Line 117: `GPT-4o-mini` -> `GPT-4.1-mini`
- Line 145: `model: 'claude-3-haiku-20240307'` -> `model: 'claude-haiku-4-5'`
- Line 146: `model: 'gemini-1.5-flash'` -> `model: 'gemini-2.5-flash'`

### 13. Update MkDocs Navigation (Step 12)
**`mkdocs.yml`** - Add under Architecture section:
```yaml
    - LLM Architecture: architecture/llm-architecture.md
```

### 14. Verification (Step 13)
After all edits:
```bash
grep -r "GROK_API_KEY" --include="*.md" docs/ docs-content/ integrations/*/docs/
grep -r "claude-3-haiku\|gpt-4o\|gemini-2.0-flash\|gemini-1.5" --include="*.md" docs/ docs-content/ integrations/*/docs/
```
Both should return 0 results (excluding .specstory/ history).

## Key Reference: Current Model Names (from config/llm-providers.yaml)

| Provider | Fast | Standard | Premium |
|----------|------|----------|---------|
| Groq | llama-3.1-8b-instant | llama-3.3-70b-versatile | openai/gpt-oss-120b |
| Anthropic | claude-haiku-4-5 | claude-sonnet-4-5 | claude-opus-4-6 |
| OpenAI | gpt-4.1-mini | gpt-4.1 | o4-mini |
| Gemini | gemini-2.5-flash | gemini-2.5-flash | gemini-2.5-pro |
| GitHub Models | gpt-4.1-mini | gpt-4.1 | o4-mini |
| DMR | ai/llama3.2 (local) | - | - |
| Ollama | local models | - | - |
| Mock | simulated | - | - |

## Tier Priority Chains
- **Fast**: Groq
- **Standard**: Groq -> Anthropic -> OpenAI
- **Premium**: Anthropic -> OpenAI -> Groq
- **Local fallback**: DMR -> Ollama (always available)

## Files Already Read (no need to re-read)
All 16 target files were fully read in the broken session. The edit instructions above reference exact line numbers from those reads.
