# Live Session Logging (LSL) System Troubleshooting Guide

## Table of Contents

1. [Quick Diagnostic Commands](#quick-diagnostic-commands)
2. [Common Issues & Solutions](#common-issues--solutions)
3. [Performance Issues](#performance-issues)
4. [Configuration Problems](#configuration-problems)
5. [File Management Issues](#file-management-issues)
6. [Monitoring & Health Problems](#monitoring--health-problems)
7. [Advanced Troubleshooting](#advanced-troubleshooting)
8. [Performance Tuning](#performance-tuning)
9. [Emergency Procedures](#emergency-procedures)
10. [Docker Mode Troubleshooting](#docker-mode-troubleshooting)

## Quick Diagnostic Commands

### System Health Check
```bash
# Run comprehensive validation
node scripts/validate-lsl-config.js

# Check system status
TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/combined-status-line.js

# Monitor transcript processing
TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js --test
```

### Basic Diagnostics
```bash
# Check environment
echo "USER: $USER"
echo "TRANSCRIPT_SOURCE_PROJECT: $TRANSCRIPT_SOURCE_PROJECT"
echo "LSL enabled: $(node -e 'console.log(process.env.LSL_ENABLED || "not set")')"

# Check directories
ls -la .specstory/
ls -la .specstory/logs/

# Check recent LSL files
find .specstory -name "*.md" -type f -mtime -1 | head -10
```

## Common Issues & Solutions

### 1. LSL Files Not Being Created

**Symptoms:**
- No `.md` files in `.specstory/` directory
- Missing session logs despite active conversations

**Diagnosis:**
```bash
# Check if LSL is enabled
echo $LSL_ENABLED

# Verify directory structure
ls -la .specstory/

# Check permissions
ls -ld .specstory/
```

**Solutions:**

**A. Enable LSL System:**
```bash
export LSL_ENABLED=true
echo 'export LSL_ENABLED=true' >> ~/.bashrc  # or ~/.zshrc
```

**B. Fix Directory Permissions:**
```bash
chmod 755 .specstory/
chmod 755 .specstory/logs/
```

**C. Create Missing Directories:**
```bash
mkdir -p .specstory/logs
mkdir -p .specstory/archived
```

### 2. Filename Format Issues

**Symptoms:**
- Files with old naming conventions
- Filename collisions between users
- Inconsistent file naming

**Diagnosis:**
```bash
# Check filename patterns
find .specstory -name "*.md" | grep -E "session.*\.md$" | head -5

# Run migration assessment
node docs/migration-scripts/assess-migration.js
```

**Solutions:**

**A. Run Migration:**
```bash
# Backup existing files
cp -r .specstory .specstory.backup

# Run migration
node docs/migration-scripts/migrate-lsl-files.js

# Validate results
node docs/migration-scripts/validate-migration.js
```

**B. Set User Hash:**
```bash
# Ensure USER environment is set
export USER=$(whoami)

# Verify hash generation
node -e "const crypto = require('crypto'); console.log(crypto.createHash('sha256').update(process.env.USER).digest('hex').substring(0, 6));"
```

### 3. Transcript Processing Failures

**Symptoms:**
- Transcript monitor crashes
- Missing content in LSL files
- Processing delays or hangs
- No LSL files being generated despite active sessions

**Diagnosis:**
```bash
# Check transcript monitor status (centralized health file)
cat .health/coding-transcript-monitor-health.json | jq '{status, activity}'

# Test transcript processing
TRANSCRIPT_DEBUG=true TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js --test

# Check for large transcript files
find ~/.claude/projects -name "*.jsonl" -size +100M
```

**Solutions:**

**A. Restart Transcript Monitor:**
```bash
# Kill existing monitors
pkill -f "enhanced-transcript-monitor"

# Start fresh
TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js &
```

**B. Handle Large Transcripts:**
```bash
# Process with timeout
timeout 60s TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/generate-proper-lsl-from-transcripts.js --mode=foreign --clean --fast

# Split large files if needed
split -l 1000 large-transcript.jsonl split-transcript-
```

**C. Clear Processing Cache:**
```bash
# Remove health file to reset state
rm -f .health/coding-transcript-monitor-health.json
rm -f .health/coding-transcript-monitor-state.json

# Clear temporary processing files
find /tmp -name "*transcript*" -mtime +1 -delete
```

**D. Recover Missing LSL Files:**
```bash
# Batch recover from transcripts (for coding project)
PROJECT_PATH=/Users/q284340/Agentic/coding CODING_REPO=/Users/q284340/Agentic/coding \
  node scripts/batch-lsl-processor.js from-transcripts ~/.claude/projects/-Users-q284340-Agentic-coding

# Recover specific date range
PROJECT_PATH=/Users/q284340/Agentic/coding CODING_REPO=/Users/q284340/Agentic/coding \
  node scripts/batch-lsl-processor.js retroactive 2024-12-01 2024-12-03
```

### 4. Configuration Validation Errors

**Symptoms:**
- Validation script reports errors
- System behaves inconsistently
- Configuration-related crashes

**Diagnosis:**
```bash
# Run full validation
node scripts/validate-lsl-config.js

# Check specific config files
cat .specstory/lsl-config.json 2>/dev/null || echo "LSL config missing"
cat scripts/config/redaction.config.js 2>/dev/null || echo "Redaction config missing"
```

**Solutions:**

**A. Generate Missing Configs:**
```bash
# Run deployment script to create configs
node scripts/deploy-multi-user-lsl.js

# Or create manually
mkdir -p .specstory
echo '{"enabled": true, "userHash": "'$(node -e "console.log(require('crypto').createHash('sha256').update(process.env.USER).digest('hex').substring(0, 6))")'", "version": "2.0"}' > .specstory/lsl-config.json
```

**B. Fix Configuration Errors:**
```bash
# Generate repair script
node scripts/validate-lsl-config.js --generate-repair

# Run repairs
bash lsl-repair-script.sh
```

## Performance Issues

### 1. Slow File Operations

**Symptoms:**
- Long delays when creating LSL files
- High CPU usage during logging
- Slow transcript processing

**Diagnosis:**
```bash
# Check file system performance
time ls .specstory/ > /dev/null

# Monitor file operations
iostat -x 1 5  # macOS: use `iostat -w 1 -c 5`

# Check disk space
df -h .specstory/
```

**Solutions:**

**A. Enable Compression:**
```javascript
// In LSL configuration
{
  "compression": {
    "enabled": true,
    "level": 6,
    "threshold": 1024
  }
}
```

**B. Optimize File Rotation:**
```javascript
// Reduce file size thresholds
{
  "rotation": {
    "maxFileSize": 25 * 1024 * 1024,  // 25MB instead of 50MB
    "rotationThreshold": 20 * 1024 * 1024  // 20MB trigger
  }
}
```

**C. Limit Archive Retention:**
```bash
# Clean old archives
find .specstory/archived -name "*.gz" -mtime +30 -delete

# Configure retention
node -e "
const config = require('./.specstory/lsl-config.json');
config.archival = { maxArchivedFiles: 20, retentionDays: 30 };
require('fs').writeFileSync('.specstory/lsl-config.json', JSON.stringify(config, null, 2));
"
```

### 2. Memory Issues

**Symptoms:**
- Node.js out-of-memory errors
- System becomes unresponsive
- Large memory consumption by LSL processes

**Diagnosis:**
```bash
# Check memory usage
ps aux | grep -E "(transcript|lsl)" | grep -v grep

# Monitor memory in real-time
top -p $(pgrep -f "enhanced-transcript-monitor")
```

**Solutions:**

**A. Increase Node.js Memory:**
```bash
# Set memory limit
export NODE_OPTIONS="--max_old_space_size=4096"

# Restart processes with higher limit
NODE_OPTIONS="--max_old_space_size=4096" TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js &
```

**B. Enable Streaming Processing:**
```bash
# Process transcripts in streaming mode
TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/generate-proper-lsl-from-transcripts.js --mode=stream --chunk-size=1000
```

**C. Clean Up Memory Periodically:**
```bash
# Add to crontab for automatic cleanup
echo "0 */6 * * * pkill -f transcript-monitor && sleep 5 && TRANSCRIPT_SOURCE_PROJECT=\"/path/to/project\" node scripts/enhanced-transcript-monitor.js &" | crontab -
```

### 3. High CPU Usage

**Symptoms:**
- System becomes slow
- High CPU usage by Node.js processes
- Fan noise or heat issues

**Diagnosis:**
```bash
# Identify CPU-intensive processes
top -o cpu | head -20

# Check specific LSL processes
ps aux | grep -E "(transcript|lsl)" | awk '{print $3, $11}'
```

**Solutions:**

**A. Reduce Processing Frequency:**
```javascript
// In monitoring configuration
{
  "monitoring": {
    "interval": 300000,  // 5 minutes instead of 1 minute
    "batchSize": 50,     // Smaller batches
    "throttleMs": 100    // Add throttling
  }
}
```

**B. Use Background Processing:**
```bash
# Process with lower priority
nice -n 19 TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js &
```

**C. Implement Rate Limiting:**
```bash
# Process with delays
TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/generate-proper-lsl-from-transcripts.js --throttle=1000
```

## Configuration Problems

### 1. Missing Environment Variables

**Symptoms:**
- "USER environment variable not set" errors
- "TRANSCRIPT_SOURCE_PROJECT not found" messages
- Inconsistent behavior across sessions

**Diagnosis:**
```bash
# Check all required environment variables
env | grep -E "(USER|TRANSCRIPT_SOURCE_PROJECT|LSL_)"

# Verify in different shells
bash -c 'env | grep USER'
zsh -c 'env | grep USER'
```

**Solutions:**

**A. Set Required Variables:**
```bash
# Set permanently in shell profile
echo 'export USER=$(whoami)' >> ~/.bashrc
echo 'export TRANSCRIPT_SOURCE_PROJECT="/path/to/your/project"' >> ~/.bashrc
echo 'export LSL_ENABLED=true' >> ~/.bashrc

# Reload shell
source ~/.bashrc
```

**B. Create Environment File:**
```bash
# Create .env file
cat > .env << EOF
USER=$(whoami)
TRANSCRIPT_SOURCE_PROJECT=$(pwd)
LSL_ENABLED=true
EOF

# Load in scripts
node -r dotenv/config scripts/enhanced-transcript-monitor.js
```

### 2. Incorrect Directory Structure

**Symptoms:**
- "Directory not found" errors
- Files created in wrong locations
- Permission denied errors

**Diagnosis:**
```bash
# Verify expected structure
tree .specstory/ 2>/dev/null || find .specstory/ -type d

# Check permissions
ls -la .specstory/
ls -la .specstory/*/
```

**Solutions:**

**A. Create Standard Structure:**
```bash
mkdir -p .specstory/{logs,archived,configs,temp}
chmod -R 755 .specstory/
```

**B. Fix Permissions Recursively:**
```bash
# Fix directory permissions
find .specstory -type d -exec chmod 755 {} \;

# Fix file permissions
find .specstory -type f -exec chmod 644 {} \;
```

### 3. Configuration File Corruption

**Symptoms:**
- JSON parse errors
- Invalid configuration warnings
- System falls back to defaults

**Diagnosis:**
```bash
# Validate JSON files
python -m json.tool .specstory/lsl-config.json
node -e "console.log(JSON.stringify(require('./.specstory/lsl-config.json'), null, 2))"
```

**Solutions:**

**A. Restore from Backup:**
```bash
# Check for backup
ls .specstory/*.backup

# Restore if available
cp .specstory/lsl-config.json.backup .specstory/lsl-config.json
```

**B. Regenerate Configuration:**
```bash
# Remove corrupted config
mv .specstory/lsl-config.json .specstory/lsl-config.json.corrupted

# Regenerate
node scripts/deploy-multi-user-lsl.js --config-only
```

## File Management Issues

### 1. File Rotation Problems

**Symptoms:**
- Files growing too large
- Rotation not triggering
- Archive files missing

**Diagnosis:**
```bash
# Check file sizes
ls -lh .specstory/*.md

# Verify rotation settings
grep -A 10 "rotation" .specstory/lsl-config.json
```

**Solutions:**

**A. Force Manual Rotation:**
```bash
# Rotate large files manually
for file in .specstory/*.md; do
  if [ $(stat -f%z "$file" 2>/dev/null || stat -c%s "$file") -gt 52428800 ]; then
    timestamp=$(date +"%Y%m%d_%H%M%S")
    gzip < "$file" > ".specstory/archived/$(basename "$file" .md)_${timestamp}.md.gz"
    > "$file"  # Truncate original
  fi
done
```

**B. Fix Rotation Configuration:**
```javascript
// Update configuration
const config = require('./.specstory/lsl-config.json');
config.rotation = {
  enabled: true,
  maxFileSize: 50 * 1024 * 1024,
  rotationThreshold: 40 * 1024 * 1024,
  checkInterval: 300000  // 5 minutes
};
require('fs').writeFileSync('.specstory/lsl-config.json', JSON.stringify(config, null, 2));
```

### 2. Archive Management Issues

**Symptoms:**
- Too many archive files
- Archive files not compressed
- Cannot find historical data

**Diagnosis:**
```bash
# Check archive directory
ls -lah .specstory/archived/

# Count archives
find .specstory/archived -name "*.gz" | wc -l

# Check compression ratio
du -sh .specstory/archived/
```

**Solutions:**

**A. Clean Old Archives:**
```bash
# Remove archives older than 90 days
find .specstory/archived -name "*.gz" -mtime +90 -delete

# Keep only latest 50 files
cd .specstory/archived
ls -t *.gz | tail -n +51 | xargs rm -f
```

**B. Compress Uncompressed Archives:**
```bash
# Compress .md files in archived directory
find .specstory/archived -name "*.md" -exec gzip {} \;
```

### 3. Permission and Access Issues

**Symptoms:**
- Cannot write to LSL files
- Permission denied when rotating
- Files owned by wrong user

**Diagnosis:**
```bash
# Check ownership
ls -la .specstory/

# Check running user
whoami
id

# Check file locks
lsof .specstory/*.md 2>/dev/null
```

**Solutions:**

**A. Fix Ownership:**
```bash
# Take ownership
sudo chown -R $(whoami):$(id -gn) .specstory/

# Set proper permissions
chmod -R u+rw .specstory/
```

**B. Release File Locks:**
```bash
# Kill processes holding files
lsof .specstory/*.md | awk 'NR>1 {print $2}' | sort -u | xargs kill

# Wait and retry
sleep 5
```

## Monitoring & Health Problems

### 1. Health Monitoring Not Working

**Symptoms:**
- `.transcript-monitor-health` file not updating
- No health status information
- Monitoring appears stopped

**Diagnosis:**
```bash
# Check health file
cat .transcript-monitor-health

# Look for monitoring processes
ps aux | grep -E "(transcript|monitor)" | grep -v grep

# Check system resources
uptime
free -h  # Linux
vm_stat  # macOS
```

**Solutions:**

**A. Restart Health Monitoring:**
```bash
# Remove stale health file
rm -f .transcript-monitor-health

# Restart monitoring
TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js &

# Verify restart
sleep 10 && cat .transcript-monitor-health
```

**B. Check Monitor Configuration:**
```javascript
// Verify monitoring is enabled
const config = require('./.specstory/lsl-config.json');
if (!config.monitoring?.enabled) {
  config.monitoring = { enabled: true, interval: 60000 };
  require('fs').writeFileSync('.specstory/lsl-config.json', JSON.stringify(config, null, 2));
}
```

### 2. Alert System Not Functioning

**Symptoms:**
- No notifications of system issues
- Missing error alerts
- Status changes not reported

**Solutions:**

**A. Test Alert Configuration:**
```bash
# Send test alert
node -e "
const logger = require('./scripts/lib/operational-logger');
logger.logError('Test alert', { test: true, source: 'troubleshooting' });
"
```

**B. Configure Alert Thresholds:**
```javascript
// Update alert configuration
{
  "alerts": {
    "enabled": true,
    "fileSize": { "warning": 40000000, "critical": 45000000 },
    "processingDelay": { "warning": 300000, "critical": 600000 },
    "errorRate": { "warning": 0.05, "critical": 0.10 }
  }
}
```

### 3. Metrics Collection Issues

**Symptoms:**
- Missing performance metrics
- Incomplete operational data
- Metrics not updating

**Solutions:**

**A. Reset Metrics Collection:**
```bash
# Clear metrics cache
rm -f .specstory/metrics/*.json

# Restart with fresh metrics
TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js --reset-metrics &
```

**B. Verify Metrics Configuration:**
```bash
# Check metrics directory
ls -la .specstory/metrics/

# Verify collection is enabled
grep -A 5 "metrics" .specstory/lsl-config.json
```

## Advanced Troubleshooting

### 1. Debug Mode Diagnostics

Enable comprehensive debugging for detailed troubleshooting:

```bash
# Enable all debug modes
DEBUG_STATUS=1 TRANSCRIPT_DEBUG=true LSL_DEBUG=1 TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js

# Debug specific components
DEBUG_LSL=1 node scripts/generate-proper-lsl-from-transcripts.js --mode=foreign --verbose

# Monitor debug output
tail -f .specstory/logs/debug.log
```

### 2. System Resource Analysis

```bash
# Comprehensive system check
echo "=== CPU Usage ==="
top -l 1 | grep "CPU usage"

echo "=== Memory Usage ==="
vm_stat | grep "Pages"

echo "=== Disk Usage ==="
df -h .specstory/

echo "=== File Handles ==="
lsof | grep -c $(whoami)

echo "=== Process Tree ==="
pstree -p $$ | grep -E "(node|transcript)"
```

### 3. Network and I/O Analysis

```bash
# Check for network-related issues
netstat -an | grep -E "(LISTEN|ESTABLISHED)" | grep -E ":[3-9][0-9]{3}"

# Monitor I/O operations
iostat -x 1 3  # Linux
iostat -w 1 -c 3  # macOS

# Check file system performance
time find .specstory -type f -name "*.md" -exec wc -l {} \; > /dev/null
```

## Performance Tuning

### 1. Optimization Settings

**Optimal Configuration for Different Use Cases:**

**A. High-Volume Projects:**
```javascript
{
  "performance": {
    "batchSize": 100,
    "processingInterval": 30000,
    "compressionLevel": 9,
    "enableStreaming": true,
    "memoryLimit": "2GB"
  },
  "rotation": {
    "maxFileSize": 25 * 1024 * 1024,
    "rotationThreshold": 20 * 1024 * 1024
  }
}
```

**B. Low-Resource Environments:**
```javascript
{
  "performance": {
    "batchSize": 25,
    "processingInterval": 120000,
    "compressionLevel": 3,
    "enableStreaming": false,
    "memoryLimit": "512MB"
  },
  "features": {
    "realTimeMonitoring": false,
    "advancedMetrics": false
  }
}
```

**C. Development/Testing:**
```javascript
{
  "performance": {
    "batchSize": 50,
    "processingInterval": 60000,
    "compressionLevel": 6,
    "enableDebugging": true
  },
  "logging": {
    "level": "debug",
    "includeStackTrace": true
  }
}
```

### 2. System-Level Optimizations

**A. File System:**
```bash
# Enable file system compression (if supported)
# macOS: diskutil apfs enableFileVault /
# Linux: tune2fs -o journal_data /dev/sdX

# Optimize for small files
echo 'vm.dirty_ratio = 5' | sudo tee -a /etc/sysctl.conf
echo 'vm.dirty_background_ratio = 2' | sudo tee -a /etc/sysctl.conf
```

**B. Process Priorities:**
```bash
# Set LSL processes to lower priority
renice 10 $(pgrep -f "enhanced-transcript-monitor")

# Use ionice for I/O priority (Linux)
ionice -c 3 -p $(pgrep -f "enhanced-transcript-monitor")
```

### 3. Monitoring Optimization

```bash
# Reduce monitoring frequency for stable systems
node -e "
const config = require('./.specstory/lsl-config.json');
config.monitoring.interval = 300000;  // 5 minutes
config.monitoring.healthCheckInterval = 600000;  // 10 minutes
require('fs').writeFileSync('.specstory/lsl-config.json', JSON.stringify(config, null, 2));
"

# Optimize log retention
find .specstory/logs -name "*.log" -mtime +7 -delete
```

## Emergency Procedures

### 1. System Recovery

**A. Complete System Reset:**
```bash
# Stop all LSL processes
pkill -f "transcript"
pkill -f "lsl"

# Backup current state
tar -czf lsl-backup-$(date +%Y%m%d_%H%M%S).tar.gz .specstory/

# Reset to clean state
rm -rf .specstory/temp/*
rm -f .transcript-monitor-health

# Restart from scratch
node scripts/deploy-multi-user-lsl.js

# Restore critical data if needed
# tar -xzf lsl-backup-*.tar.gz
```

**B. Emergency File Recovery:**
```bash
# Recover from Git if tracked
git status .specstory/
git checkout HEAD -- .specstory/*.md

# Recover from system backups
# Time Machine (macOS): tmutil compare
# Linux: check /var/backups or configured backup location

# Recover from LSL archives
find .specstory/archived -name "*.gz" -mtime -1 -exec zcat {} \; > emergency-recovery.md
```

### 2. Corruption Recovery

**A. Database/Index Recovery:**
```bash
# Rebuild file index
find .specstory -name "*.md" -type f > .specstory/file-index.txt

# Validate all JSON configs
for config in .specstory/*.json; do
  echo "Validating $config"
  python -m json.tool "$config" > /dev/null || echo "INVALID: $config"
done

# Regenerate corrupted configs
mv .specstory/lsl-config.json .specstory/lsl-config.json.corrupted
node scripts/deploy-multi-user-lsl.js --config-only
```

### 3. Performance Emergency

**A. High Resource Usage:**
```bash
# Emergency process termination
pkill -TERM -f "transcript"
sleep 5
pkill -KILL -f "transcript"

# Reduce resource usage temporarily
export NODE_OPTIONS="--max_old_space_size=1024"
nice -n 19 TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js --low-resource &

# Clean up large files
find .specstory -name "*.md" -size +100M -exec gzip {} \;
```

### 4. Data Loss Prevention

**A. Continuous Backup:**
```bash
# Set up automatic backup
echo "*/15 * * * * tar -czf ~/lsl-backup-\$(date +\\%Y\\%m\\%d_\\%H\\%M).tar.gz .specstory/" | crontab -

# Verify backup integrity
tar -tzf ~/lsl-backup-*.tar.gz > /dev/null && echo "Backup OK" || echo "Backup CORRUPTED"
```

**B. Real-time Sync:**
```bash
# Set up real-time directory sync (if available)
rsync -av --delete .specstory/ ~/lsl-sync/

# Monitor for changes and sync
fswatch .specstory/ | xargs -I {} rsync -av .specstory/ ~/lsl-sync/
```

## Docker Mode Troubleshooting

### 1. Container Health Issues

**Symptoms:**
- MCP servers show as "failed" in Claude Code
- Container not starting or crashing
- Health check endpoints not responding

**Diagnosis:**
```bash
# Check container status
docker compose -f docker/docker-compose.yml ps

# Check container logs
docker compose -f docker/docker-compose.yml logs coding-services

# Test health endpoints
curl http://localhost:3847/health  # Browser Access
curl http://localhost:3848/health  # Semantic Analysis
curl http://localhost:3849/health  # Constraint Monitor
curl http://localhost:3850/health  # Code Graph RAG
```

**Solutions:**

**A. Restart Containers:**
```bash
# Stop and restart all services
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d

# Wait for services to be healthy
docker compose -f docker/docker-compose.yml ps --format "table {{.Name}}\t{{.Status}}"
```

**B. Check Container Logs:**
```bash
# View real-time logs
docker compose -f docker/docker-compose.yml logs -f coding-services

# Check specific service startup
docker compose -f docker/docker-compose.yml logs coding-services | grep -E "(Starting|Listening|Error)"
```

**C. Rebuild Container:**
```bash
# Force rebuild without cache
docker compose -f docker/docker-compose.yml build --no-cache
docker compose -f docker/docker-compose.yml up -d
```

### 2. MCP SSE Connection Issues

**Symptoms:**
- Claude Code cannot connect to MCP servers
- "Connection refused" errors
- Stdio proxy timeouts

**Diagnosis:**
```bash
# Check if ports are listening
lsof -i :3847  # Browser Access
lsof -i :3848  # Semantic Analysis
lsof -i :3849  # Constraint Monitor
lsof -i :3850  # Code Graph RAG

# Test SSE endpoints
curl -v http://localhost:3848/health

# Check proxy configuration
cat ~/.claude.json | jq '.mcpServers'
```

**Solutions:**

**A. Verify Docker Mode is Active:**
```bash
# Check for Docker mode marker
ls -la .docker-mode

# Or check environment variable
echo $CODING_DOCKER_MODE

# Create marker if missing
touch .docker-mode
```

**B. Verify MCP Configuration:**
```bash
# Regenerate Docker MCP config
./scripts/generate-docker-mcp-config.sh

# Verify proxy paths are correct
cat ~/.claude.json | jq '.mcpServers."semantic-analysis".args'
```

**C. Check Proxy Process:**
```bash
# The stdio proxy should connect to the SSE server
# Test manually:
SEMANTIC_ANALYSIS_SSE_URL=http://localhost:3848 node integrations/mcp-server-semantic-analysis/dist/stdio-proxy.js
```

### 3. Port Mapping Problems

**Symptoms:**
- "Port already in use" errors
- Services binding to wrong interfaces
- Cannot access services from host

**Diagnosis:**
```bash
# Check port usage
lsof -i :3847-3850 | grep LISTEN
lsof -i :6333  # Qdrant
lsof -i :6379  # Redis
lsof -i :7687  # Memgraph

# Check Docker port mappings
docker compose -f docker/docker-compose.yml ps --format "table {{.Name}}\t{{.Ports}}"
```

**Solutions:**

**A. Stop Conflicting Services:**
```bash
# Kill processes using required ports
for port in 3847 3848 3849 3850; do
  pid=$(lsof -ti :$port)
  [ -n "$pid" ] && kill $pid
done

# Restart Docker services
docker compose -f docker/docker-compose.yml up -d
```

**B. Use Alternative Ports:**
```bash
# Update .env.ports with different ports
cat >> .env.ports << EOF
BROWSER_ACCESS_SSE_PORT=4847
SEMANTIC_ANALYSIS_SSE_PORT=4848
CONSTRAINT_MONITOR_SSE_PORT=4849
CODE_GRAPH_RAG_SSE_PORT=4850
EOF

# Restart with new ports
docker compose -f docker/docker-compose.yml up -d
```

### 4. Volume Mount Issues

**Symptoms:**
- Data not persisting after container restart
- Permission denied errors
- Missing configuration files in container

**Diagnosis:**
```bash
# Check volume mounts
docker inspect coding-services | jq '.[0].Mounts'

# Verify data directories exist
ls -la .data/
ls -la .specstory/

# Check permissions inside container
docker exec coding-services ls -la /coding/.data/
```

**Solutions:**

**A. Fix Directory Permissions:**
```bash
# Ensure directories exist with correct permissions
mkdir -p .data/knowledge-graph
mkdir -p .specstory/history
chmod -R 755 .data/ .specstory/

# Restart containers
docker compose -f docker/docker-compose.yml restart
```

**B. Verify Volume Configuration:**
```yaml
# docker-compose.yml volumes should include:
volumes:
  - ${CODING_REPO:-.}/.data:/coding/.data
  - ${CODING_REPO:-.}/.specstory:/coding/.specstory
  - ${HOME}/Agentic:/workspace
```

### 5. Database Container Issues

**Symptoms:**
- Qdrant, Redis, or Memgraph not connecting
- Database initialization failures
- Slow queries or timeouts

**Diagnosis:**
```bash
# Check database containers
docker compose -f docker/docker-compose.yml ps | grep -E "(qdrant|redis|memgraph)"

# Test database connectivity
curl http://localhost:6333/collections  # Qdrant
redis-cli -p 6379 ping              # Redis (if redis-cli installed)
docker exec memgraph cypher-shell -u memgraph -p memgraph "MATCH (n) RETURN count(n);"
```

**Solutions:**

**A. Restart Database Containers:**
```bash
# Restart specific database
docker compose -f docker/docker-compose.yml restart qdrant
docker compose -f docker/docker-compose.yml restart redis
docker compose -f docker/docker-compose.yml restart memgraph
```

**B. Check Database Logs:**
```bash
docker compose -f docker/docker-compose.yml logs qdrant
docker compose -f docker/docker-compose.yml logs memgraph
```

**C. Reset Database Data:**
```bash
# WARNING: This will delete all data!
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d
```

### 6. Switching Between Native and Docker Mode

**Symptoms:**
- Confusion about which mode is active
- Mixed configuration issues
- Services from wrong mode running

**Diagnosis:**
```bash
# Check current mode
if [ -f .docker-mode ] || [ "$CODING_DOCKER_MODE" = "true" ]; then
  echo "Docker mode active"
else
  echo "Native mode active"
fi

# Check for native services running
ps aux | grep -E "(semantic-analysis|constraint-monitor)" | grep -v grep

# Check for Docker services
docker compose -f docker/docker-compose.yml ps
```

**Solutions:**

**A. Switch to Docker Mode:**
```bash
# Stop native services
./bin/stop-services.sh

# Enable Docker mode
touch .docker-mode

# Start Docker services
docker compose -f docker/docker-compose.yml up -d

# Regenerate MCP config
./scripts/generate-docker-mcp-config.sh
```

**B. Switch to Native Mode:**
```bash
# Stop Docker services
docker compose -f docker/docker-compose.yml down

# Disable Docker mode
rm -f .docker-mode
unset CODING_DOCKER_MODE

# Start native services
./bin/start-services.sh
```

### 7. Docker Quick Reference

**Essential Commands:**
```bash
# Start all Docker services
docker compose -f docker/docker-compose.yml up -d

# Stop all Docker services
docker compose -f docker/docker-compose.yml down

# View logs
docker compose -f docker/docker-compose.yml logs -f

# Check health of all services
for port in 3847 3848 3849 3850; do
  echo "Port $port: $(curl -s http://localhost:$port/health | jq -r '.status // "failed"')"
done

# Full restart
docker compose -f docker/docker-compose.yml down && docker compose -f docker/docker-compose.yml up -d
```

**Port Reference:**
| Port | Service | Health Check |
|------|---------|--------------|
| 3847 | Browser Access SSE | `curl http://localhost:3847/health` |
| 3848 | Semantic Analysis SSE | `curl http://localhost:3848/health` |
| 3849 | Constraint Monitor SSE | `curl http://localhost:3849/health` |
| 3850 | Code Graph RAG SSE | `curl http://localhost:3850/health` |
| 6333 | Qdrant | `curl http://localhost:6333/collections` |
| 6379 | Redis | `redis-cli ping` |
| 7687 | Memgraph | Bolt protocol |

---

## Contact and Support

### Self-Service Resources

1. **Configuration Validator**: `node scripts/validate-lsl-config.js`
2. **Migration Assistant**: `node docs/migration-scripts/assess-migration.js`
3. **Health Monitor**: `TRANSCRIPT_SOURCE_PROJECT="/path" node scripts/enhanced-transcript-monitor.js --test`
4. **Debug Mode**: Add `DEBUG_STATUS=1 TRANSCRIPT_DEBUG=true` to any command

### Diagnostic Information Collection

Before seeking support, collect this diagnostic information:

```bash
# System information
echo "=== System Info ===" > lsl-diagnostics.txt
uname -a >> lsl-diagnostics.txt
node --version >> lsl-diagnostics.txt
echo "PWD: $(pwd)" >> lsl-diagnostics.txt

# Environment
echo -e "\n=== Environment ===" >> lsl-diagnostics.txt
env | grep -E "(USER|CODING|LSL)" >> lsl-diagnostics.txt

# Configuration
echo -e "\n=== Configuration ===" >> lsl-diagnostics.txt
cat .specstory/lsl-config.json 2>/dev/null >> lsl-diagnostics.txt || echo "No LSL config" >> lsl-diagnostics.txt

# Recent logs
echo -e "\n=== Recent Errors ===" >> lsl-diagnostics.txt
find .specstory/logs -name "*.log" -mtime -1 -exec tail -20 {} \; >> lsl-diagnostics.txt

# System status
echo -e "\n=== System Status ===" >> lsl-diagnostics.txt
node scripts/validate-lsl-config.js --summary >> lsl-diagnostics.txt 2>&1

echo "Diagnostics collected in lsl-diagnostics.txt"
```

### Common Support Scenarios

1. **First-time Setup**: Use `node scripts/deploy-multi-user-lsl.js`
2. **Migration Issues**: Run `node docs/migration-scripts/assess-migration.js` first
3. **Performance Problems**: Check [Performance Tuning](#performance-tuning) section
4. **File Corruption**: Follow [Emergency Procedures](#emergency-procedures)
5. **Configuration Errors**: Use `node scripts/validate-lsl-config.js --generate-repair`

---

*This troubleshooting guide covers the most common issues with the Enhanced Live Session Logging system. For additional support or to report bugs, refer to the project documentation or repository issues.*