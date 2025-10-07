# API Keys Setup Guide

Configure LLM provider API keys for semantic analysis capabilities.

## Overview

The semantic analysis system supports both Claude (Anthropic) and OpenAI providers. You can configure one or both API keys depending on your preferences and requirements.

## Configuration File

API keys are configured in the semantic analysis system's environment file:

```bash
/path/to/coding/semantic-analysis-system/.env
```

## Configuration Options

### Option 1: Anthropic Claude Only (Recommended)

```bash
# Primary provider configuration
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
DEFAULT_LLM_PROVIDER=claude

# Optional: Disable OpenAI fallback
OPENAI_API_KEY=
```

**Benefits:**
- Claude provides excellent code analysis capabilities
- Strong reasoning for pattern recognition
- Good conversation insight extraction

### Option 2: OpenAI Only

```bash
# Primary provider configuration  
OPENAI_API_KEY=sk-your-actual-openai-key-here
DEFAULT_LLM_PROVIDER=openai

# Optional: Disable Anthropic
ANTHROPIC_API_KEY=
```

**Benefits:**
- Fast response times
- Good general-purpose analysis
- Wide API compatibility

### Option 3: Both Providers (Fallback Support)

```bash
# Primary provider
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
DEFAULT_LLM_PROVIDER=claude

# Fallback provider
OPENAI_API_KEY=sk-your-actual-openai-key-here
```

**Benefits:**
- Automatic fallback if primary provider fails
- Load balancing capabilities
- Provider redundancy

## API Key Acquisition

### Anthropic Claude API Key

1. Visit [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in to your account
3. Navigate to "API Keys" section
4. Click "Create Key"
5. Copy the key (starts with `sk-ant-`)

### OpenAI API Key

1. Visit [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in to your account
3. Navigate to "API Keys" section
4. Click "Create new secret key"
5. Copy the key (starts with `sk-`)

## Security Best Practices

### Environment File Security

```bash
# Set proper file permissions
chmod 600 semantic-analysis-system/.env

# Add to .gitignore to prevent accidental commits
echo "semantic-analysis-system/.env" >> .gitignore
```

### Key Rotation

- Rotate API keys regularly (every 3-6 months)
- Use separate keys for development and production
- Monitor API usage for unusual patterns

### Cost Management

```bash
# Set usage limits in provider dashboards
# Monitor costs regularly
# Use rate limiting for development

# Optional: Set cost alerts
ANTHROPIC_MONTHLY_LIMIT=100  # $100 limit
OPENAI_MONTHLY_LIMIT=50      # $50 limit
```

## Validation

### Test Configuration

```bash
# Check system status
mcp-status

# Test semantic analysis (with agents running)
cd semantic-analysis-system
npm run start:agents

# In another terminal
node -e "
const client = require('./mcp-server/clients/semantic-analysis-client.js');
const c = new client.SemanticAnalysisClient();
c.connect().then(() => console.log('✓ Connected')).catch(console.error);
"
```

### Verify Provider Access

The system will log which providers are configured:

```
✓ API keys configured: ANTHROPIC_API_KEY
✓ Primary provider: claude
✓ Fallback provider: openai (not configured)
```

## Troubleshooting

### Common Issues

#### "No valid API keys found"

**Problem**: Neither API key is configured or both have placeholder values.

**Solution**:
```bash
# Check current configuration
cat semantic-analysis-system/.env | grep API_KEY

# Ensure at least one key is set
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
```

#### "Invalid API key" errors

**Problem**: API key is incorrect or expired.

**Solution**:
1. Verify key format (sk-ant-... or sk-...)
2. Check key permissions in provider dashboard
3. Regenerate key if necessary

#### "Rate limit exceeded"

**Problem**: Too many requests to provider API.

**Solution**:
```bash
# Add rate limiting configuration
LLM_RATE_LIMIT_PER_MINUTE=10
LLM_REQUEST_TIMEOUT=30000
```

### Debug Mode

Enable detailed logging for troubleshooting:

```bash
# Add to .env file
LOG_LEVEL=debug
LLM_DEBUG_MODE=true

# Check logs
tail -f semantic-analysis-system/logs/semantic-analysis.log
```

## Integration with System Components

### UKB-CLI Integration

UKB-CLI automatically uses configured providers for analysis:

```bash
# Uses configured LLM provider
ukb --interactive

# Force specific provider (if both configured)
ukb --provider claude
ukb --provider openai
```

### MCP Tool Integration

Claude Code MCP tools use the configured providers:

```javascript
// In Claude Code session
await mcp__semantic__analyze_repository({
  repository: "/path/to/repo",
  provider: "claude"  // optional override
});
```

### VSCode CoPilot Integration

CoPilot HTTP server uses configured providers:

```bash
# API call uses configured provider
curl -X POST http://localhost:8765/api/semantic/analyze-repository \
  -H "Content-Type: application/json" \
  -d '{"repository": "/path/to/repo"}'
```

## Cost Optimization

### Usage Monitoring

```bash
# Monitor API usage
tail -f semantic-analysis-system/logs/semantic-analysis.log | grep "API_USAGE"

# Check provider dashboards regularly
# Set up billing alerts
```

### Efficient Usage Patterns

```bash
# Use batch processing for multiple files
ukb --files "src/**/*.js" --batch

# Cache results for repeated analysis
ENABLE_ANALYSIS_CACHE=true
CACHE_TTL_HOURS=24
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No* | `your-anthropic-api-key` | Anthropic Claude API key |
| `OPENAI_API_KEY` | No* | `your-openai-api-key` | OpenAI API key |
| `DEFAULT_LLM_PROVIDER` | No | `claude` | Primary provider to use |
| `LLM_RATE_LIMIT_PER_MINUTE` | No | `20` | Request rate limit |
| `LLM_REQUEST_TIMEOUT` | No | `30000` | Request timeout (ms) |
| `LLM_DEBUG_MODE` | No | `false` | Enable debug logging |

*At least one API key is required for semantic analysis functionality.

---

**Next Steps:**
- [Quick Start Guide](../getting-started.md) - Set up the system
- [System Diagnostics](system-diagnostics.md) - Verify configuration
- [Troubleshooting](troubleshooting.md) - Resolve common issues