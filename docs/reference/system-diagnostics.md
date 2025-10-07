# System Diagnostics

Guide to diagnosing and troubleshooting system issues.

## Quick Diagnostic

Run the system test script:

```bash
./scripts/test-coding.sh
```

**Output**:
```
✅ Git: Installed
✅ Node.js: v18.17.0
✅ npm: 9.6.7
✅ jq: 1.6
✅ MCP Server: Running
✅ VKB Server: Healthy
✅ Constraint Monitor: Active
```

## Component Health Checks

### 1. Core Services

**Check all services**:
```bash
# VKB Server
curl -f http://localhost:8080/health || echo "VKB DOWN"

# Constraint Monitor API
curl -f http://localhost:3031/api/status || echo "CM API DOWN"

# Constraint Monitor Dashboard
curl -f http://localhost:3030/ || echo "CM Dashboard DOWN"
```

### 2. MCP Servers

**Test semantic analysis**:
```bash
cd integrations/mcp-server-semantic-analysis
npm test
```

**Test constraint monitor**:
```bash
cd integrations/mcp-constraint-monitor
npm test
```

### 3. Knowledge Management

**Test UKB**:
```bash
ukb --help
which ukb
```

**Test VKB**:
```bash
vkb --help
which vkb
```

### 4. Session Logging

**Check LSL system**:
```bash
ls -la .specstory/history/
tail -f .specstory/history/*$(date +%Y-%m-%d)*.md
```

**Verify transcript monitor**:
```bash
ps aux | grep enhanced-transcript-monitor
```

## Network Diagnostics

### Port Availability

**Check for port conflicts**:
```bash
lsof -i :8080  # VKB Server
lsof -i :3030  # CM Dashboard
lsof -i :3031  # CM API
lsof -i :8765  # Semantic Analysis API
```

**Kill processes on port**:
```bash
lsof -ti:8080 | xargs kill
```

### Firewall & Proxy

**Test connectivity**:
```bash
# Test API access
curl -I https://api.anthropic.com
curl -I https://api.openai.com

# Test with proxy
export HTTP_PROXY=http://proxy:port
export HTTPS_PROXY=http://proxy:port
curl -I https://api.anthropic.com
```

## API Key Validation

### Anthropic

```bash
curl https://api.anthropic.com/v1/messages \
  -H "anthropic-version: 2023-06-01" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 10,
    "messages": [{"role": "user", "content": "test"}]
  }'
```

**Expected**: 200 OK with JSON response
**Error**: 401 = Invalid key, 429 = Rate limit

### OpenAI

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "test"}],
    "max_tokens": 10
  }'
```

## Performance Diagnostics

### Memory Usage

```bash
# System memory
free -h  # Linux
vm_stat  # macOS

# Node.js processes
ps aux | grep node | awk '{print $2, $4, $11}' | sort -k2 -rn

# Detailed memory
node --expose-gc -e "console.log(process.memoryUsage())"
```

### CPU Usage

```bash
# Real-time monitoring
top -p $(pgrep -d',' node)

# CPU per process
ps aux | grep node | awk '{print $2, $3, $11}' | sort -k2 -rn
```

### Disk Space

```bash
# Overall usage
df -h

# Directory sizes
du -sh ~/Agentic/coding/*
du -sh .specstory/history/
du -sh .cache/
```

## Log Analysis

### Application Logs

**Recent errors**:
```bash
# Semantic analysis logs
tail -100 integrations/mcp-server-semantic-analysis/logs/*.log | grep ERROR

# Constraint monitor logs
tail -100 integrations/mcp-constraint-monitor/logs/*.log | grep ERROR

# System logs
journalctl -u coding --since "1 hour ago" | grep ERROR
```

### Session Logs

**Recent sessions**:
```bash
ls -lt .specstory/history/ | head -10
```

**Parse session log**:
```bash
# Extract tool calls
jq -r '.[] | select(.type=="tool_use") | .name' < session.jsonl

# Count exchanges
grep "## Key Activities" .specstory/history/latest.md -A 100 | grep "###" | wc -l
```

## Database Diagnostics

### Shared Memory Files

**Check integrity**:
```bash
# Validate JSON
jq . shared-memory-coding.json > /dev/null && echo "Valid" || echo "Invalid"

# Count entities
jq '.nodes | length' shared-memory-coding.json

# Check size
du -h shared-memory-*.json
```

### Backups

**Verify backups exist**:
```bash
ls -lh .backups/shared-memory-*.json
```

## Configuration Validation

### MCP Configuration

**Validate syntax**:
```bash
cat ~/.config/claude-code/mcp.json | jq .
```

**Check paths**:
```bash
# Verify paths in config exist
jq -r '.mcpServers | to_entries[] | .value.args[]' ~/.config/claude-code/mcp.json | while read path; do
  [ -f "$path" ] && echo "✅ $path" || echo "❌ $path"
done
```

### Environment Variables

**Check all required vars**:
```bash
# Required
echo "ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:0:10}..."

# Optional
echo "OPENAI_API_KEY: ${OPENAI_API_KEY:0:10}..."
echo "CODING_AGENT: $CODING_AGENT"
echo "DEBUG: $DEBUG"
```

## Automated Diagnostic Report

**Generate comprehensive report**:
```bash
cat > diagnostic-report.sh << 'EOF'
#!/bin/bash
echo "=== System Diagnostic Report ==="
echo "Date: $(date)"
echo ""

echo "## System Info"
uname -a
node --version
npm --version
git --version

echo ""
echo "## Service Status"
curl -sf http://localhost:8080/health && echo "✅ VKB" || echo "❌ VKB"
curl -sf http://localhost:3031/api/status && echo "✅ CM API" || echo "❌ CM API"

echo ""
echo "## Resource Usage"
echo "Memory:"
free -h 2>/dev/null || vm_stat | head -5
echo "Disk:"
df -h | grep -E '/$|/home'

echo ""
echo "## Recent Errors"
grep -r "ERROR" integrations/*/logs/*.log 2>/dev/null | tail -5

echo ""
echo "## API Keys"
[ -n "$ANTHROPIC_API_KEY" ] && echo "✅ ANTHROPIC_API_KEY" || echo "❌ ANTHROPIC_API_KEY"
[ -n "$OPENAI_API_KEY" ] && echo "✅ OPENAI_API_KEY" || echo "⚠️  OPENAI_API_KEY (optional)"
EOF

chmod +x diagnostic-report.sh
./diagnostic-report.sh
```

## Common Diagnostic Patterns

### Service Won't Start

**Checklist**:
1. Check port is available: `lsof -i :PORT`
2. Verify dependencies installed: `npm ls`
3. Check file permissions: `ls -la`
4. Review recent logs: `tail -50 logs/*.log`

### High Resource Usage

**Checklist**:
1. Identify process: `ps aux | grep node | sort -k3 -rn`
2. Check for memory leaks: Monitor memory over time
3. Review active workflows: `curl http://localhost:8765/api/status`
4. Clear caches: `rm -rf .cache/`

### Data Corruption

**Checklist**:
1. Validate JSON: `jq . shared-memory-*.json`
2. Check file sizes: `ls -lh shared-memory-*.json`
3. Restore from backup: `cp .backups/shared-memory-*.json ./`
4. Rebuild from source: Re-run UKB analysis

## Emergency Procedures

### Complete Reset

```bash
# Stop all services
pkill -f enhanced-transcript-monitor
pkill -f vkb-server
pkill -f constraint-monitor

# Clear caches
rm -rf .cache/
rm -rf */node_modules/.cache/

# Rebuild
npm install
npm run build

# Restart
coding
```

### Backup Recovery

```bash
# Restore shared memory
cp .backups/shared-memory-coding-$(date +%Y%m%d).json shared-memory-coding.json

# Restore session logs
cp .backups/.specstory/ .specstory/ -r
```

## See Also

- [Troubleshooting Guide](../troubleshooting.md) - Problem resolution
- [API Keys Setup](api-keys-setup.md) - API configuration
- [Commands Reference](commands.md) - CLI commands
- [Getting Started](../getting-started.md) - Installation guide
