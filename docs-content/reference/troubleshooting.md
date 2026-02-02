# Troubleshooting

Common issues and solutions.

## Quick Diagnostics

```bash
# System health check
./scripts/test-coding.sh

# LSL validation
node scripts/validate-lsl-config.js

# Docker services status
docker compose -f docker/docker-compose.yml ps
```

## Installation Issues

### Commands Not Found

```bash
# Reload shell configuration
source ~/.bashrc  # or ~/.zshrc

# Verify PATH
echo $PATH | grep coding

# If missing, reinstall
./install.sh --update-shell-config
```

### Permission Errors

```bash
# Make scripts executable
chmod +x install.sh
chmod +x bin/*

# Run installer
./install.sh
```

### MCP Servers Not Loading

```bash
# Check MCP configuration
cat ~/.config/Claude/claude_desktop_config.json

# Reinstall MCP config
./install.sh --update-mcp-config

# Check server logs
ls ~/.claude/logs/mcp*.log
```

## LSL Issues

### LSL Files Not Generated

```bash
# Check if monitor is running
ps aux | grep enhanced-transcript-monitor

# Check health file
cat .health/coding-transcript-monitor-health.json

# Restart monitor
coding --restart-monitor
```

### Classification Not Working

```bash
# Check classification logs
ls -la .specstory/logs/classification/

# Verify configuration
cat config/live-logging-config.json | jq '.embedding_classifier'
```

### Recovery from Transcripts

```bash
# Batch recover LSL files
PROJECT_PATH=/path/to/project CODING_REPO=/path/to/coding \
  node scripts/batch-lsl-processor.js from-transcripts ~/.claude/projects/-path-to-project

# Recover specific date range
PROJECT_PATH=/path/to/project CODING_REPO=/path/to/coding \
  node scripts/batch-lsl-processor.js retroactive 2024-12-01 2024-12-03
```

## Docker Mode Issues

### Container Won't Start

```bash
# Check logs
docker compose -f docker/docker-compose.yml logs coding-services

# Force rebuild
docker compose -f docker/docker-compose.yml build --no-cache
docker compose -f docker/docker-compose.yml up -d
```

### Port Conflicts

```bash
# Find process using port
lsof -i :3848

# Kill conflicting process
kill $(lsof -ti :3848)

# Or change ports in .env.ports
```

### Connection Refused

```bash
# Verify Docker mode is active
ls -la .docker-mode

# Check container status
docker compose -f docker/docker-compose.yml ps

# Test health endpoint
curl -v http://localhost:3848/health
```

### Volume Permission Issues

```bash
# Fix directory permissions
mkdir -p .data/knowledge-graph .specstory/history
chmod -R 755 .data/ .specstory/

# Restart
docker compose -f docker/docker-compose.yml restart
```

## Knowledge Base Issues

### VKB Won't Start

```bash
# Check if installed
ls -la integrations/memory-visualizer/

# If missing, initialize submodule
git submodule update --init --recursive integrations/memory-visualizer
cd integrations/memory-visualizer
npm install && npm run build

# Test viewer
vkb --debug
```

### Missing Knowledge Export

```bash
# Check knowledge-export files
ls -la .data/knowledge-export/*.json

# If missing, graph database will create on next run
```

## Constraint Monitor Issues

### Dashboard Not Loading

```bash
# Check if services are running
lsof -i :3030
lsof -i :3031

# Start dashboard
cd integrations/mcp-constraint-monitor
PORT=3030 npm run dashboard
```

### Hooks Not Firing

```bash
# Check hook configuration
cat ~/.claude/settings.json | jq '.hooks'

# Verify hook script exists
ls -la integrations/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js
```

## Performance Issues

### High Memory Usage

```bash
# Increase Node.js memory
export NODE_OPTIONS="--max_old_space_size=4096"

# Restart with higher limit
NODE_OPTIONS="--max_old_space_size=4096" coding --claude
```

### Slow Processing

```bash
# Process with lower priority
nice -n 19 node scripts/enhanced-transcript-monitor.js &

# Reduce monitoring frequency in config
```

## Complete Reset

If installation is corrupted:

```bash
# Uninstall
./uninstall.sh

# Remove all data (WARNING: loses knowledge base)
rm -rf ~/.coding-tools/
rm -rf integrations/memory-visualizer/node_modules
rm -rf .data/knowledge-export/*.json

# Reinstall
./install.sh
source ~/.bashrc
```

## Getting Help

### Diagnostic Information

```bash
# Collect diagnostics
echo "=== System Info ===" > diagnostics.txt
uname -a >> diagnostics.txt
node --version >> diagnostics.txt
echo "PWD: $(pwd)" >> diagnostics.txt

echo -e "\n=== Environment ===" >> diagnostics.txt
env | grep -E "(USER|CODING|LSL)" >> diagnostics.txt

echo -e "\n=== Configuration ===" >> diagnostics.txt
cat .specstory/lsl-config.json 2>/dev/null >> diagnostics.txt

echo "Diagnostics collected in diagnostics.txt"
```

### Support Resources

- [GitHub Issues](https://github.com/fwornle/coding/issues)
- [Documentation](../index.md)
- Configuration Validator: `node scripts/validate-lsl-config.js`
