Test your installation and fix common issues.

---

## Quick Health Check

Open the dashboard at [localhost:3032](http://localhost:3032); **Run Verification** re-checks
everything on demand:

![System Healthy](../images/system-healthy.png)

A healthy system reads **Healthy** with no critical issues. First confirm what is supposed to be
running — a feature switched off by your tier is not a failure:

```bash
coding-features status
```

If you see red indicators, follow the troubleshooting steps below.

---

## Automated Test Suite

The test script verifies all components:

```bash
# Check-only mode (default) — changes nothing, suggests each repair it would make
./scripts/test-coding.sh

# Interactive repair mode
./scripts/test-coding.sh --interactive

# Verbose output
./scripts/test-coding.sh --verbose
```

### Test Categories

| Test | What It Checks |
|------|----------------|
| Prerequisites | Node.js, Git, jq, Docker versions |
| Commands | `coding`, `coding-features`, `semantic` in PATH |
| Configuration | `.env`, hooks, MCP config |
| Services | Docker containers or native processes |
| Connectivity | Health endpoints, port availability |
| Knowledge Base | Graph database accessibility |

---

## Detailed Verification

### 1. Check Prerequisites

```bash
# Node.js 22 LTS or newer
node --version

# Git
git --version

# jq
jq --version

# Docker
docker --version
docker info
```

### 2. Verify Commands Available

```bash
# Should show help
coding --help
coding-features status

# Check locations
which coding
which coding-features
```

If commands not found, check your PATH:

```bash
echo $PATH | grep -q "Agentic/coding/bin" && echo "OK" || echo "Missing from PATH"
```

### 3. Check Docker Services

```bash
# List running containers
docker compose -f ~/Agentic/coding/docker/docker-compose.yml ps

# Expected output shows these services running:
# - coding-services (main MCP servers; graphify runs file-based inside this container)
# - qdrant (vector database)
# - redis (cache / queues)
```

### 4. Test Health Endpoints

```bash
# Semantic Analysis MCP
curl -s http://localhost:3848/health | jq .

# Constraint Monitor MCP
curl -s http://localhost:3031/health | jq .

# obs-api (knowledge store, retrieval)
curl -s http://localhost:12436/health | jq .

# Health coordinator
curl -s http://localhost:3034/health | jq .

# LLM proxy
curl -s http://localhost:12435/health | jq .

# Health Dashboard
curl -s http://localhost:3032/health | jq .
```

### 5. Verify LSL Monitor

```bash
# Check ETM heartbeats via the coordinator (Phase 33+: .health/*.json files
# stopped being written; coordinator's lsl slice is now the source of truth)
curl -fs http://localhost:3034/health/state \
  | jq '.lsl | to_entries | map(select(.key | endswith(":coding"))) | .[0].value | {status, lastBeat, projectName}'

# Check if monitor process is running
ps aux | grep -v grep | grep "enhanced-transcript-monitor"
```

### 6. Test Knowledge Base

```bash
# The live store answers (obs-api owns it)
curl -s 'http://localhost:12436/api/v1/entities?limit=1' | jq '.success'

# Where each project's knowledge is persisted
curl -s http://localhost:12436/api/kb/layout | jq
```

---

## Common Issues and Fixes

### Services Not Starting

**Symptoms**: Health check shows services as red/unavailable

**Fix**:
```bash
# Restart Docker services
docker compose -f docker/docker-compose.yml restart

# If that fails, rebuild
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d --build
```

### Port Conflicts

**Symptoms**: "Address already in use" errors

**Fix**:
```bash
# Find what's using the port (obs-api shown)
lsof -i :12436

# Kill the process or change port in .env.ports
nano .env.ports

# Restart services after port change
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d
```

### MCP Connection Errors

**Symptoms**: Claude can't connect to MCP servers

**Fix**:
```bash
# Verify MCP config
cat ~/.claude/settings.json | jq '.mcpServers'

# Reinstall hooks and config
./install.sh --mcp-only
```

### LSL Not Recording

**Symptoms**: No files in `.coding/history/`

**Fix**:
```bash
# Check ETM heartbeat via coordinator (Phase 33+)
curl -fs http://localhost:3034/health/state \
  | jq '.lsl | to_entries | map(select(.key | endswith(":coding")))'

# Restart monitor
coding --restart-monitor

# If still failing, check logs
tail -100 .logs/transcript-monitor-test.log
```

### Knowledge Base Corrupted

**Symptoms**: obs-api will not start or crash-loops on its store, the viewer shows errors,
the knowledge-base workflow fails.

The live store (LevelDB) is a machine-local cache: every project's knowledge is persisted in
its repo's `.coding/kb/` (see [Per-Repo Tenancy](../architecture/tenancy.md)), and a fresh
store hydrates from all of them. So the fix is to rebuild the cache, never to delete
`.coding/kb/`.

**Fix**:
```bash
# 1. Stop obs-api — the only process that owns the store
launchctl bootout gui/$(id -u)/com.coding.obs-api          # macOS
systemctl --user stop obs-api                              # Linux / WSL

# 2. Move the store aside (keep it until the rebuild is verified)
DATA_HOME=$(~/Agentic/coding/bin/coding-data-home)
mv "$DATA_HOME/var/knowledge-graph/leveldb" "$DATA_HOME/var/knowledge-graph/leveldb.broken"

# 3. Start obs-api again — it hydrates from every .coding/kb/ it can see
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.coding.obs-api.plist   # macOS
systemctl --user start obs-api                                                      # Linux / WSL

# 4. Check, then re-embed what is missing from Qdrant (idempotent)
curl -s 'http://localhost:12436/api/v1/entities?limit=1' | jq '.success'
node ~/Agentic/coding/dist/embedding/backfill.js
```

---

## Repair Commands

### Full Repair

```bash
./install.sh --repair
```

This will:
1. Check all prerequisites
2. Reinstall missing components
3. Rebuild Docker containers
4. Reset configuration to defaults
5. Restart all services

### Selective Repair

```bash
# Repair only MCP configuration
./install.sh --mcp-only

# Repair only hooks
./install.sh --hooks-only

# Rebuild Docker containers
cd docker && docker-compose build --no-cache && docker-compose up -d
```

### Reset to Clean State

!!! warning "Data Loss"
    This removes all local data including knowledge base and session logs.

```bash
# Stop everything
docker compose -f docker/docker-compose.yml down 2>/dev/null
pkill -f "coding"

# Remove state files
rm -rf .data .health .logs .cache
rm -f .transition-in-progress

# Reinstall
./install.sh
```

---

## Diagnostic Information

When reporting issues, include this diagnostic output:

```bash
# Generate diagnostic report
coding --diagnostics > diagnostics.txt

# Or manually collect:
echo "=== System ===" >> diagnostics.txt
uname -a >> diagnostics.txt
echo "=== Node ===" >> diagnostics.txt
node --version >> diagnostics.txt
echo "=== Docker ===" >> diagnostics.txt
docker --version >> diagnostics.txt
docker compose version >> diagnostics.txt
echo "=== Services ===" >> diagnostics.txt
docker compose -f docker/docker-compose.yml ps 2>&1 >> diagnostics.txt
echo "=== Health ===" >> diagnostics.txt
coding-features status >> diagnostics.txt 2>&1
curl -s http://localhost:3034/health/state >> diagnostics.txt 2>&1
```

---

## Related Documentation

- [Installation Guide](installation.md) - Fresh installation
- [Configuration](configuration.md) - API keys and settings
- [Troubleshooting Reference](../reference/troubleshooting.md) - Extended troubleshooting
