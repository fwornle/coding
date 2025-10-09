# Installation Guide

## Prerequisites

### System Requirements

- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher
- **Memory**: Minimum 4GB RAM (8GB recommended)
- **Storage**: 2GB available space
- **Network**: Internet access for LLM APIs and web searches

### Operating System Support

- ✅ **macOS**: 10.15 (Catalina) or later
- ✅ **Linux**: Ubuntu 18.04+, CentOS 7+, or equivalent
- ✅ **Windows**: 10 or later (with WSL2 recommended)

### Required API Keys

The system requires API keys for various services:

```bash
# Required for semantic analysis
ANTHROPIC_API_KEY=your_claude_api_key

# Optional for fallback LLM
OPENAI_API_KEY=your_openai_api_key

# Optional for web search
GOOGLE_API_KEY=your_google_api_key
GOOGLE_CSE_ID=your_custom_search_engine_id
```

## Installation Methods

### Method 1: Quick Start (Recommended)

```bash
# Clone the repository
git clone https://github.com/your-org/semantic-analysis-system.git
cd semantic-analysis-system

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start the system
npm run start:agents
```

### Method 2: Development Setup

```bash
# Clone repository
git clone https://github.com/your-org/semantic-analysis-system.git
cd semantic-analysis-system

# Install dependencies with development tools
npm install --include=dev

# Set up pre-commit hooks
npm run setup:hooks

# Configure environment
cp .env.example .env
cp config/agents.example.yaml config/agents.yaml

# Edit configuration files
vim .env
vim config/agents.yaml

# Run tests
npm test

# Start in development mode
npm run dev
```

### Method 3: Docker Deployment

```bash
# Clone repository
git clone https://github.com/your-org/semantic-analysis-system.git
cd semantic-analysis-system

# Build Docker image
docker build -t semantic-analysis-system .

# Run with docker-compose
docker-compose up -d

# Check status
docker-compose ps
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# =============================================================================
# SEMANTIC ANALYSIS SYSTEM CONFIGURATION
# =============================================================================

# -----------------------------------------------------------------------------
# LLM Provider Configuration
# -----------------------------------------------------------------------------
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENAI_API_KEY=your_openai_api_key_here

# -----------------------------------------------------------------------------
# Search Provider Configuration
# -----------------------------------------------------------------------------
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_CSE_ID=your_custom_search_engine_id_here

# -----------------------------------------------------------------------------
# System Paths
# -----------------------------------------------------------------------------
CODING_TOOLS_PATH=/Users/<username>/Agentic/coding
CODING_KB_PATH=/Users/<username>/Agentic/coding

# -----------------------------------------------------------------------------
# Infrastructure Configuration
# -----------------------------------------------------------------------------
MQTT_BROKER_HOST=localhost
MQTT_BROKER_PORT=1883
JSON_RPC_PORT=8080
MCP_SERVER_PORT=3001

# -----------------------------------------------------------------------------
# Storage Configuration
# -----------------------------------------------------------------------------
SHARED_MEMORY_CODING=/Users/<username>/Agentic/coding/shared-memory-coding.json
SHARED_MEMORY_UI=/Users/<username>/Agentic/coding/shared-memory-ui.json
SHARED_MEMORY_RESI=/Users/<username>/Agentic/coding/shared-memory-resi.json

# -----------------------------------------------------------------------------
# Synchronization Configuration
# -----------------------------------------------------------------------------
GRAPH_DB_TYPE=mcp
AUTO_SYNC_ENABLED=true
CONFLICT_RESOLUTION_STRATEGY=latest-wins

# -----------------------------------------------------------------------------
# Deduplication Configuration
# -----------------------------------------------------------------------------
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-ada-002
SIMILARITY_THRESHOLD=0.8
AUTO_MERGE_THRESHOLD=0.95

# -----------------------------------------------------------------------------
# Logging Configuration
# -----------------------------------------------------------------------------
LOG_LEVEL=info
LOG_FORMAT=json
```

### Agent Configuration

Create `config/agents.yaml`:

```yaml
# =============================================================================
# SEMANTIC ANALYSIS SYSTEM - AGENT CONFIGURATION
# =============================================================================

agents:
  # ---------------------------------------------------------------------------
  # Semantic Analysis Agent
  # ---------------------------------------------------------------------------
  semantic-analysis:
    enabled: true
    llm:
      primary: claude
      fallback: openai
      claude:
        model: claude-3-sonnet-20240229
        maxTokens: 4000
        temperature: 0.1
      openai:
        model: gpt-4-turbo-preview
        maxTokens: 4000
        temperature: 0.1
    analysis:
      significanceThreshold: 7
      maxCommits: 50
      cacheTimeout: 300000  # 5 minutes
    
  # ---------------------------------------------------------------------------
  # Knowledge Graph Agent
  # ---------------------------------------------------------------------------
  knowledge-graph:
    enabled: true
    knowledgeApi:
      apiUrl: http://localhost:3001
      timeout: 10000
    ukb:
      ukbPath: /Users/<username>/Agentic/coding/bin/ukb
      sharedMemoryPath: /Users/<username>/Agentic/coding/shared-memory-coding.json
      autoSync: true
    validation:
      enableDuplicateCheck: true
      enableNameValidation: true
      enableMetadataValidation: true
    relations:
      createAutomaticRelations: true
      createCentralNodes: true
      createTechnologyRelations: true
  
  # ---------------------------------------------------------------------------
  # Synchronization Agent
  # ---------------------------------------------------------------------------
  synchronization:
    enabled: true
    graphDb:
      type: mcp  # mcp or graphology
      mcp:
        timeout: 30000
      graphology:
        host: localhost
        port: 3002
        timeout: 30000
    files:
      sharedMemoryPaths:
        - /Users/<username>/Agentic/coding/shared-memory-coding.json
        - /Users/<username>/Agentic/coding/shared-memory-ui.json
        - /Users/<username>/Agentic/coding/shared-memory-resi.json
      debounceDelay: 1000
    conflict:
      strategy: latest-wins  # latest-wins, merge, manual
      autoResolveThreshold: 0.95
    versioning:
      versionsPath: /Users/<username>/Agentic/coding/.versions
      maxVersions: 50
      compressionEnabled: true
  
  # ---------------------------------------------------------------------------
  # Deduplication Agent
  # ---------------------------------------------------------------------------
  deduplication:
    enabled: true
    embedding:
      provider: openai  # openai, sentence-transformers, local
      model: text-embedding-ada-002
      dimensions: 1536
      batchSize: 100
      maxLength: 8000
    similarity:
      metric: cosine  # cosine, euclidean, manhattan, dot, pearson, jaccard
      threshold: 0.8
      normalization: true
    merging:
      strategy: auto  # auto, weighted, priority, union, intersection, manual
      preserveHistory: true
      conflictResolution: merge
    automation:
      autoCheckThreshold: 0.9
      autoMerge: false
      autoMergeBatch: false
      batchThreshold: 0.9
    periodicDeduplication:
      enabled: true
      interval: 3600000  # 1 hour
  
  # ---------------------------------------------------------------------------
  # Coordinator Agent
  # ---------------------------------------------------------------------------
  coordinator:
    enabled: true
    workflows:
      maxConcurrent: 5
      timeout: 300000  # 5 minutes
    scheduling:
      enabled: true
      maxTasks: 100
    qualityAssurance:
      enabled: true
      validationLevel: strict  # strict, moderate, lenient
  
  # ---------------------------------------------------------------------------
  # Web Search Agent
  # ---------------------------------------------------------------------------
  web-search:
    enabled: true
    search:
      provider: google
      maxResults: 10
      timeout: 10000
    validation:
      validateUrls: true
      extractContent: true
      timeout: 5000

# =============================================================================
# INFRASTRUCTURE CONFIGURATION
# =============================================================================

mqtt:
  broker:
    host: localhost
    port: 1883
    keepalive: 60
    connectTimeout: 30000
    reconnectPeriod: 1000

rpc:
  server:
    host: localhost
    port: 8080
    timeout: 30000

mcp:
  server:
    host: localhost
    port: 3001
    timeout: 30000

# =============================================================================
# LOGGING CONFIGURATION
# =============================================================================

logging:
  level: info  # debug, info, warn, error
  format: json  # json, text
  file:
    enabled: true
    path: ./logs/semantic-analysis.log
    maxSize: 100MB
    maxFiles: 10
  console:
    enabled: true
    colorize: true

# =============================================================================
# MONITORING CONFIGURATION
# =============================================================================

monitoring:
  enabled: true
  metrics:
    enabled: true
    port: 9090
    interval: 30000
  health:
    enabled: true
    port: 8081
    path: /health
```

## Verification

### System Health Check

```bash
# Check system status
npm run status

# Check individual components
npm run check:mqtt
npm run check:rpc
npm run check:agents
```

### Test Installation

```bash
# Run comprehensive tests
npm test

# Run integration tests
npm run test:integration

# Run agent-specific tests
npm run test:agents

# Test semantic analysis
npm run test:analysis

# Test synchronization
npm run test:sync

# Test deduplication
npm run test:dedup
```

### Verify Agent Communication

```bash
# Test agent discovery
curl -X POST http://localhost:8080/coordinator/agents/discover

# Test semantic analysis
curl -X POST http://localhost:8080/semantic-analysis/analyze/code \
  -H "Content-Type: application/json" \
  -d '{"repository": "/path/to/repo", "depth": 5}'

# Test knowledge graph
curl -X POST http://localhost:8080/knowledge-graph/entity/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Entity",
    "entityType": "Pattern",
    "significance": 7,
    "observations": ["Test observation"]
  }'
```

## Troubleshooting

### Common Issues

#### 1. Port Conflicts

**Symptoms**: "EADDRINUSE" errors during startup

**Solutions**:
```bash
# Check port usage
lsof -i :1883  # MQTT
lsof -i :8080  # JSON-RPC
lsof -i :3001  # MCP

# Kill conflicting processes
kill -9 $(lsof -ti:1883)

# Use different ports in configuration
```

#### 2. Missing API Keys

**Symptoms**: Authentication errors, empty analysis results

**Solutions**:
```bash
# Verify environment variables
echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY

# Check .env file
cat .env | grep API_KEY

# Test API connectivity
npm run test:llm
```

#### 3. File Permission Issues

**Symptoms**: Cannot read/write shared memory files

**Solutions**:
```bash
# Check file permissions
ls -la /Users/<username>/Agentic/coding/shared-memory-*.json

# Fix permissions
chmod 644 /Users/<username>/Agentic/coding/shared-memory-*.json

# Check directory permissions
ls -la /Users/<username>/Agentic/coding/
```

#### 4. Agent Communication Failures

**Symptoms**: Agents not responding, timeout errors

**Solutions**:
```bash
# Check MQTT broker status
npm run check:mqtt

# Restart infrastructure
npm run restart:infrastructure

# Check agent logs
tail -f logs/semantic-analysis.log
```

### Debugging

#### Enable Debug Logging

```bash
# Set debug level in .env
LOG_LEVEL=debug

# Restart system
npm run restart

# Monitor logs
tail -f logs/semantic-analysis.log | jq '.'
```

#### Agent-Specific Debugging

```bash
# Debug specific agent
DEBUG=semantic-analysis:* npm run start:agents

# Debug synchronization
DEBUG=synchronization:* npm run start:agents

# Debug deduplication
DEBUG=deduplication:* npm run start:agents
```

#### Performance Profiling

```bash
# Enable performance monitoring
npm run start:profiler

# Check memory usage
npm run monitor:memory

# Analyze performance
npm run analyze:performance
```

## Post-Installation Setup

### 1. Initialize Knowledge Base

```bash
# Create initial knowledge structure
npm run init:knowledge

# Verify knowledge base
npm run check:knowledge
```

### 2. Configure Integration

```bash
# Set up UKB integration
npm run setup:ukb

# Configure MCP integration
npm run setup:mcp

# Test integrations
npm run test:integrations
```

### 3. Schedule Maintenance

```bash
# Set up log rotation
npm run setup:logrotate

# Configure health monitoring
npm run setup:monitoring

# Schedule periodic deduplication
npm run setup:scheduler
```

## Updating

### Update System

```bash
# Pull latest changes
git pull origin main

# Update dependencies
npm update

# Run migration scripts
npm run migrate

# Restart system
npm run restart
```

### Update Configuration

```bash
# Backup current configuration
cp config/agents.yaml config/agents.yaml.backup

# Update configuration
npm run update:config

# Validate configuration
npm run validate:config
```

## Uninstallation

### Complete Removal

```bash
# Stop all services
npm run stop

# Remove data (optional)
npm run clean:data

# Remove logs
npm run clean:logs

# Remove installation
rm -rf semantic-analysis-system/
```

### Preserve Data

```bash
# Stop services only
npm run stop

# Keep data and configuration intact
```

## Support

### Getting Help

- **Documentation**: [Semantic Analysis MCP Server](../../integrations/mcp-semantic-analysis.md)
- **Issues**: [GitHub Issues](https://github.com/your-org/semantic-analysis-system/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/semantic-analysis-system/discussions)

### Reporting Issues

When reporting issues, please include:

1. **System Information**:
   ```bash
   npm run info:system
   ```

2. **Configuration** (without API keys):
   ```bash
   npm run info:config
   ```

3. **Logs** (last 100 lines):
   ```bash
   tail -100 logs/semantic-analysis.log
   ```

4. **Steps to Reproduce**: Detailed reproduction steps

5. **Expected vs Actual Behavior**: Clear description of the issue