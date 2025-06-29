# Semantic Analysis System - Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the semantic analysis system.

## Quick Diagnosis

### System Health Check

First, check the overall system status:

**Via Claude Code:**
```
get_system_status {}
```

**Via Command Line:**
```bash
semantic-cli status
```

**Via JSON-RPC:**
```bash
curl -X POST http://localhost:3001/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "system.getHealth",
    "id": "1"
  }'
```

### Common Status Indicators

- 🟢 **Healthy**: All agents responding, no errors
- 🟡 **Degraded**: Some agents slow or experiencing errors
- 🔴 **Error**: Critical agents offline or system unavailable

## Agent-Specific Issues

### Semantic Analysis Agent

#### Issue: Analysis requests timing out

**Symptoms:**
- Long response times (>60 seconds)
- Timeout errors in logs
- Incomplete analysis results

**Causes:**
- Large repository size
- LLM provider rate limits
- Insufficient memory

**Solutions:**

1. **Reduce analysis scope:**
```json
{
  "repository": "/path/to/repo",
  "depth": 5,                    // Reduce from default 10
  "excludeFiles": [
    "node_modules/**",
    "*.min.js",
    "dist/**"
  ],
  "significanceThreshold": 7     // Increase to filter results
}
```

2. **Check LLM provider status:**
```bash
# Check Claude API status
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  https://api.anthropic.com/v1/messages \
  -X POST -d '{"model":"claude-3-sonnet-20240229","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'

# Check OpenAI API status  
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/chat/completions \
  -X POST -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

3. **Increase memory allocation:**
```bash
export NODE_OPTIONS="--max-old-space-size=4096"  # 4GB
```

4. **Switch to fallback provider:**
```json
{
  "analysis": {
    "primaryProvider": "openai",
    "fallbackProvider": "claude"
  }
}
```

#### Issue: "No insights found" or empty results

**Symptoms:**
- Analysis completes but returns empty insights array
- Very low significance scores
- Missing pattern detection

**Causes:**
- Significance threshold too high
- Repository contains mostly non-code files
- Analysis patterns not matching codebase

**Solutions:**

1. **Lower significance threshold:**
```json
{
  "significanceThreshold": 3     // Lower from default 5
}
```

2. **Specify file patterns:**
```json
{
  "includeFiles": [
    "**/*.js",
    "**/*.ts", 
    "**/*.jsx",
    "**/*.tsx",
    "**/*.py",
    "**/*.java"
  ]
}
```

3. **Enable verbose analysis:**
```json
{
  "analysisTypes": ["patterns", "architecture", "performance", "security"],
  "verboseLogging": true
}
```

### Web Search Agent

#### Issue: Search requests failing

**Symptoms:**
- "Search provider unavailable" errors
- Empty search results
- Rate limit errors

**Causes:**
- Search provider API limits exceeded
- Network connectivity issues
- Invalid search provider configuration

**Solutions:**

1. **Check network connectivity:**
```bash
# Test DuckDuckGo connectivity
curl "https://duckduckgo.com/?q=test&format=json"

# Test if behind corporate firewall
curl -v https://api.duckduckgo.com
```

2. **Configure alternative search providers:**
```yaml
# config/search-providers.yaml
providers:
  primary: duckduckgo
  fallback: bing
  bing:
    apiKey: ${BING_API_KEY}
    endpoint: https://api.bing.microsoft.com/v7.0/search
  google:
    apiKey: ${GOOGLE_API_KEY}
    searchEngineId: ${GOOGLE_CSE_ID}
```

3. **Adjust rate limits:**
```yaml
# config/agents.yaml
webSearch:
  rateLimits:
    requestsPerMinute: 30      # Reduce from default 60
    batchSize: 3               # Reduce from default 5
```

4. **Enable search result caching:**
```yaml
webSearch:
  caching:
    enabled: true
    ttl: 7200                  # 2 hours
    maxSize: 1000
```

#### Issue: Poor search result quality

**Symptoms:**
- Irrelevant search results
- Low relevance scores
- Missing important documentation

**Causes:**
- Overly broad search queries
- Insufficient result filtering
- Missing domain-specific sources

**Solutions:**

1. **Improve search queries:**
```json
{
  "query": "React hooks best practices 2024",  // Add year for recent results
  "filters": {
    "domains": [
      "reactjs.org",
      "developer.mozilla.org",
      "github.com"
    ],
    "language": "en",
    "timeframe": "year"
  }
}
```

2. **Add technical domain filters:**
```yaml
webSearch:
  domainBoosts:
    "github.com": 1.5
    "stackoverflow.com": 1.3
    "developer.mozilla.org": 1.4
    "docs.microsoft.com": 1.2
```

3. **Configure quality thresholds:**
```yaml
webSearch:
  qualityFilters:
    minRelevanceScore: 0.6
    maxAge: "1y"
    requireOfficialDocs: false
```

### Knowledge Graph Agent

#### Issue: Entity creation failures

**Symptoms:**
- "Entity validation failed" errors
- Duplicate entity warnings
- Sync with UKB failing

**Causes:**
- Invalid entity format
- Missing required fields
- Conflicting entity names

**Solutions:**

1. **Validate entity structure:**
```json
{
  "name": "React Context Pattern",        // Required, unique
  "entityType": "ArchitecturalPattern",  // Required, valid type
  "significance": 8,                     // Required, 1-10
  "observations": [                      // Required, non-empty
    "Provides global state management",
    "Prevents prop drilling"
  ],
  "metadata": {                          // Optional but recommended
    "technologies": ["React", "JavaScript"],
    "references": ["https://react.dev/reference/react/createContext"],
    "source": "repository-analysis"
  }
}
```

2. **Handle duplicate entities:**
```yaml
knowledgeGraph:
  duplicateHandling:
    strategy: "merge"                    # or "skip", "overwrite"
    mergeFields: ["observations", "references"]
    preserveSignificance: "highest"
```

3. **Fix UKB sync issues:**
```bash
# Check UKB accessibility
ukb --help

# Verify shared-memory.json permissions
ls -la shared-memory.json

# Manual sync test
ukb --interactive << EOF
Test Entity
TestType  
5
Test observation
EOF
```

#### Issue: Slow knowledge operations

**Symptoms:**
- Long delays in entity creation
- Search timeouts
- Memory usage warnings

**Causes:**
- Large knowledge base size
- Inefficient search indexing
- Memory leaks

**Solutions:**

1. **Optimize knowledge base:**
```bash
# Compact knowledge base
semantic-cli knowledge compact

# Rebuild search index
semantic-cli knowledge reindex

# Clean old entities
semantic-cli knowledge clean --older-than 30d --significance-below 4
```

2. **Configure memory limits:**
```yaml
knowledgeGraph:
  memory:
    maxEntities: 10000
    maxRelations: 50000
    cacheSize: "512MB"
    gcInterval: "5m"
```

3. **Enable database mode:**
```yaml
knowledgeGraph:
  storage:
    type: "sqlite"               # Instead of file-based
    path: "knowledge.db"
    indexing: true
    compression: true
```

### Coordinator Agent

#### Issue: Workflow execution failures

**Symptoms:**
- Workflows stuck in "running" state
- Step failures cascade
- Incomplete results

**Causes:**
- Agent dependencies unavailable
- Step timeouts
- Resource exhaustion

**Solutions:**

1. **Check agent availability:**
```bash
# List active agents
semantic-cli agents list

# Check agent health
semantic-cli agents health semantic-analysis
semantic-cli agents health web-search
semantic-cli agents health knowledge-graph
```

2. **Increase step timeouts:**
```yaml
coordinator:
  stepTimeouts:
    analyze-repository: "300s"    # 5 minutes
    search-web: "60s"            # 1 minute
    create-entity: "30s"         # 30 seconds
```

3. **Configure retry policies:**
```yaml
coordinator:
  retryPolicy:
    maxAttempts: 3
    initialDelay: "5s"
    maxDelay: "60s"
    backoffMultiplier: 2.0
    retryableErrors:
      - "TIMEOUT_ERROR"
      - "NETWORK_ERROR"
      - "RATE_LIMIT_ERROR"
```

4. **Enable workflow recovery:**
```bash
# Resume failed workflow
semantic-cli workflow resume <workflow-id> --from-step <step-id>

# Cancel stuck workflow
semantic-cli workflow cancel <workflow-id>
```

## Communication Issues

### MQTT Broker Problems

#### Issue: Agents not communicating

**Symptoms:**
- Agents appear online but don't respond
- Events not propagating
- Workflow coordination failures

**Causes:**
- MQTT broker offline
- Network connectivity issues
- Authentication failures

**Solutions:**

1. **Check MQTT broker status:**
```bash
# Test MQTT connectivity
mosquitto_sub -h localhost -p 1883 -t "system/heartbeat" -C 1

# Check broker logs
tail -f /var/log/mosquitto/mosquitto.log
```

2. **Restart MQTT broker:**
```bash
# Using systemd
sudo systemctl restart mosquitto

# Using Docker
docker restart semantic-analysis-mqtt

# Manual start
mosquitto -c /etc/mosquitto/mosquitto.conf -d
```

3. **Verify agent subscriptions:**
```bash
# Monitor agent topics
mosquitto_sub -h localhost -p 1883 -t "agent/+/heartbeat" -v

# Check for authentication issues
mosquitto_sub -h localhost -p 1883 -u <username> -P <password> -t "#"
```

### JSON-RPC Server Issues

#### Issue: RPC calls failing

**Symptoms:**
- Connection refused errors
- Method not found errors
- Request timeouts

**Causes:**
- RPC server not running
- Port conflicts
- Method registration failures

**Solutions:**

1. **Check RPC server status:**
```bash
# Check if port is listening
netstat -an | grep :3001
lsof -i :3001

# Test RPC connectivity
curl -X POST http://localhost:3001/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.ping","id":"1"}'
```

2. **Restart RPC server:**
```bash
# Find and kill existing process
pkill -f "semantic-rpc-server"

# Start RPC server
node semantic-analysis-system/communication/rpc-server.js
```

3. **Check method registration:**
```bash
# List available methods
curl -X POST http://localhost:3001/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.listMethods","id":"1"}'
```

## Configuration Issues

### Environment Variables

#### Issue: Missing or invalid API keys

**Symptoms:**
- Authentication errors
- LLM provider failures
- Search provider unavailable

**Solutions:**

1. **Verify environment variables:**
```bash
# Check required variables
echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY
echo $CODING_TOOLS_PATH
echo $CODING_KB_PATH

# Test API key validity
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  https://api.anthropic.com/v1/messages \
  -X POST -d '{"model":"claude-3-sonnet-20240229","max_tokens":1,"messages":[{"role":"user","content":"test"}]}'
```

2. **Set environment variables:**
```bash
# Add to ~/.bashrc or ~/.zshrc
export ANTHROPIC_API_KEY="your_key_here"
export OPENAI_API_KEY="your_key_here"
export CODING_TOOLS_PATH="/path/to/coding/tools"
export CODING_KB_PATH="/path/to/shared-memory.json"

# Reload shell
source ~/.bashrc
```

3. **Use environment file:**
```bash
# Create .env file
cat > .env << EOF
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
CODING_TOOLS_PATH=/path/to/coding/tools
CODING_KB_PATH=/path/to/shared-memory.json
EOF

# Load environment
set -a; source .env; set +a
```

### File Permissions

#### Issue: Permission denied errors

**Symptoms:**
- Cannot read/write shared-memory.json
- Log file creation failures
- Configuration file access denied

**Solutions:**

1. **Fix file permissions:**
```bash
# Fix shared-memory.json permissions
chmod 644 shared-memory.json
chown $USER:$USER shared-memory.json

# Fix directory permissions
chmod 755 semantic-analysis-system/
chmod -R 755 semantic-analysis-system/config/
```

2. **Create missing directories:**
```bash
# Create log directory
mkdir -p logs/
chmod 755 logs/

# Create cache directory
mkdir -p cache/
chmod 755 cache/
```

## Performance Issues

### High Memory Usage

#### Issue: System consuming excessive memory

**Symptoms:**
- Out of memory errors
- System slowdown
- Process crashes

**Causes:**
- Memory leaks in agents
- Large knowledge base in memory
- Inefficient caching

**Solutions:**

1. **Monitor memory usage:**
```bash
# Check process memory
ps aux | grep semantic

# Monitor in real-time
top -p $(pgrep -f semantic)

# Check Node.js heap usage
node --inspect semantic-analysis-system/agents/semantic-analysis-agent.js
```

2. **Configure memory limits:**
```bash
# Set Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=2048"

# Set system limits
ulimit -v 4194304  # 4GB virtual memory
```

3. **Optimize caching:**
```yaml
# config/performance.yaml
caching:
  maxMemoryUsage: "1GB"
  evictionPolicy: "lru"
  gcInterval: "5m"
  
agents:
  semantic-analysis:
    cacheSize: "256MB"
  web-search:
    cacheSize: "128MB"
```

### Slow Response Times

#### Issue: Long delays in agent responses

**Symptoms:**
- Requests taking >30 seconds
- Timeout errors
- Poor user experience

**Causes:**
- Network latency
- LLM provider throttling
- Inefficient algorithms

**Solutions:**

1. **Enable request prioritization:**
```yaml
coordinator:
  prioritization:
    enabled: true
    highPriority: ["analyze_repository"]
    mediumPriority: ["search_web"]
    lowPriority: ["sync_with_ukb"]
```

2. **Configure parallel processing:**
```yaml
coordinator:
  parallelism:
    maxConcurrentRequests: 5
    maxConcurrentPerAgent: 2
    requestQueueSize: 50
```

3. **Optimize LLM requests:**
```yaml
semantic-analysis:
  llm:
    requestTimeout: "30s"
    batchRequests: true
    maxTokens: 2048
    temperature: 0.1
```

## Logging and Debugging

### Enable Debug Logging

```bash
# Set debug log level
export LOG_LEVEL=debug

# Enable component-specific logging
export DEBUG="semantic:*,mqtt:*,rpc:*"

# Start with verbose logging
semantic-cli start --verbose
```

### Log File Locations

```bash
# System logs
tail -f logs/semantic-analysis.log

# Agent-specific logs
tail -f logs/semantic-analysis-agent.log
tail -f logs/web-search-agent.log
tail -f logs/knowledge-graph-agent.log
tail -f logs/coordinator-agent.log

# MQTT broker logs
tail -f logs/mqtt.log

# RPC server logs
tail -f logs/rpc-server.log
```

### Debug Specific Issues

```bash
# Debug repository analysis
semantic-cli debug analyze-repository /path/to/repo --verbose

# Debug web search
semantic-cli debug search-web "React patterns" --verbose

# Debug knowledge operations
semantic-cli debug create-entity --name "Test" --type "Test" --significance 5

# Debug workflow execution
semantic-cli debug workflow repository-analysis --dry-run
```

## Getting Help

### Check Documentation

1. [API Reference](./api-reference.md) - Detailed API documentation
2. [Architecture](./architecture.md) - System architecture overview
3. [Workflows](./workflows.md) - Workflow configuration and usage
4. [Configuration](./configuration.md) - System configuration guide

### Community Support

1. **GitHub Issues**: Report bugs and request features
2. **Discussions**: Ask questions and share experiences
3. **Documentation**: Contribute to documentation improvements

### Advanced Diagnostics

For complex issues, collect comprehensive diagnostic information:

```bash
# Generate diagnostic report
semantic-cli diagnostics generate --output diagnostic-report.json

# Test all system components
semantic-cli test all --verbose

# Validate configuration
semantic-cli validate config
```

The diagnostic report includes:
- System configuration
- Agent status and health
- Recent error logs
- Performance metrics
- Network connectivity tests
- API key validation results

This information helps identify the root cause of complex issues and provides context for support requests.