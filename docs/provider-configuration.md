# Provider Configuration

The system is **completely provider-agnostic** - use any LLM provider you prefer!

## Quick Setup

### 1. Install Provider SDK(s)

Only install what you'll use:

```bash
npm install groq-sdk              # Groq (recommended - fastest, cheapest)
npm install @anthropic-ai/sdk     # Anthropic (high quality)
npm install openai                # OpenAI or local models
npm install @google/generative-ai # Google Gemini
```

### 2. Configure API Key(s)

Add to `.env`:

```bash
GROK_API_KEY=your-groq-key           # For Groq
ANTHROPIC_API_KEY=your-anthropic-key # For Anthropic
OPENAI_API_KEY=your-openai-key       # For OpenAI
GOOGLE_API_KEY=your-google-key       # For Gemini
LOCAL_MODEL_ENDPOINT=http://localhost:11434  # For Ollama/vLLM
```

### 3. Verify

```bash
node scripts/enhanced-transcript-monitor.js

# Check startup logs for: "[UnifiedInferenceEngine] <provider> SDK loaded"
```

## Supported Providers

| Provider | Best For | Cost | Privacy | Speed |
|----------|----------|------|---------|-------|
| **Groq** | Most tasks | 💰 Cheapest | ☁️ Cloud | ⚡ Fastest |
| **Anthropic** | Quality | 💰💰 Mid | ☁️ Cloud | ⚡⚡ Fast |
| **OpenAI** | GPT-4 | 💰💰💰 High | ☁️ Cloud | ⚡⚡ Fast |
| **Gemini** | Google | 💰💰 Mid | ☁️ Cloud | ⚡⚡ Fast |
| **Local** | Privacy | 🆓 Free | 🔒 Local | ⚡⚡⚡ Variable |

## Provider Priority

System automatically selects providers in this order:

1. **Groq** (cheapest, fastest)
2. **Anthropic** (high quality)
3. **OpenAI** (GPT-4)
4. **Gemini** (Google)
5. **Local** (Ollama/vLLM)

If a provider fails, automatic fallback to the next available provider.

## Using with Different Agents

### Claude Code (Anthropic)

```bash
echo "ANTHROPIC_API_KEY=your-key" >> .env
npm install @anthropic-ai/sdk
coding
```

### GitHub CoPilot / Cursor (OpenAI)

```bash
echo "OPENAI_API_KEY=your-key" >> .env
npm install openai
# Use with your editor
```

### Any Agent + Groq

```bash
echo "GROK_API_KEY=your-key" >> .env
npm install groq-sdk
# Works with ANY coding agent!
```

### Local Models (Privacy-First)

```bash
# Start Ollama
ollama serve
ollama pull llama3.3:70b

# Configure
echo "LOCAL_MODEL_ENDPOINT=http://localhost:11434" >> .env
npm install openai  # Ollama uses OpenAI-compatible API
```

## Troubleshooting

### "Cannot find package '@anthropic-ai/sdk'"

**This is normal** if you haven't installed that provider. The system will use other available providers.

To fix: Install the SDK you need

```bash
npm install @anthropic-ai/sdk
echo "ANTHROPIC_API_KEY=your-key" >> .env
```

### "No providers initialized"

You need at least ONE provider configured:

```bash
# Check .env file
cat .env

# Make sure you have at least one API key AND installed the SDK
npm install groq-sdk  # Or whichever provider you chose
```

### Trajectory analyzer not available

**This is normal** if no provider SDKs are installed yet. The monitor still works for basic logging. To enable trajectory analysis, install at least one provider SDK.

## Sensitive Data Routing

For sensitive data, the system automatically routes to local models:

```javascript
// Automatically uses local model
const result = await engine.infer(prompt, {
  operationType: 'sensitive-analysis'
});

// Or explicitly request local
const result = await engine.infer(prompt, {}, {
  privacy: 'local'
});
```

## Summary

✅ **Agent-Agnostic**: Works with Claude Code, CoPilot, Cursor, any coding agent
✅ **Provider-Agnostic**: Supports 5 different LLM providers
✅ **Optional Dependencies**: Install only what you need
✅ **Automatic Fallback**: Circuit breaker pattern for reliability
✅ **Privacy-First**: Route sensitive data to local models
✅ **Cost-Optimized**: Smart routing to cheapest provider

**You are NOT locked into Anthropic!** 🎉
