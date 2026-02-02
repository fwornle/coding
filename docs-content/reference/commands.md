# Commands

CLI commands and shell usage reference.

## Core Commands

### coding

Launch Claude Code with all integrations.

```bash
# Default launch
coding --claude

# Specify project
coding --project ~/my-project

# Force specific agent
coding --claude    # Claude Code (default)
coding --copilot   # GitHub CoPilot

# Docker mode
touch .docker-mode && coding --claude

# Help
coding --help
```

### vkb

View Knowledge Base visualization.

```bash
# Open in browser
vkb

# Version info
vkb --version

# Debug mode
vkb --debug
```

## Testing Commands

### Installation Test

```bash
# Check-only mode (default, safe)
./scripts/test-coding.sh

# Interactive repair
./scripts/test-coding.sh --interactive

# Auto-repair coding-internal issues
./scripts/test-coding.sh --auto-repair

# Help
./scripts/test-coding.sh --help
```

### LSL Validation

```bash
# Validate LSL configuration
node scripts/validate-lsl-config.js

# Generate repair script
node scripts/validate-lsl-config.js --generate-repair
```

## Docker Commands

### Start/Stop Services

```bash
# Start all services
docker compose -f docker/docker-compose.yml up -d

# Stop all services
docker compose -f docker/docker-compose.yml down

# Restart
docker compose -f docker/docker-compose.yml restart
```

### View Logs

```bash
# All services
docker compose -f docker/docker-compose.yml logs -f

# Specific service
docker compose -f docker/docker-compose.yml logs -f coding-services
```

### Rebuild

```bash
# Rebuild after code changes
docker compose -f docker/docker-compose.yml build --no-cache
docker compose -f docker/docker-compose.yml up -d

# Remove volumes (data loss!)
docker compose -f docker/docker-compose.yml down -v
```

## Health Checks

### Docker Mode

```bash
# All health endpoints
for port in 3847 3848 3849 3850; do
  echo "Port $port: $(curl -s http://localhost:$port/health | jq -r '.status')"
done
```

### Native Mode

```bash
# LSL monitor health
cat .health/coding-transcript-monitor-health.json | jq '{status, activity}'

# Container status
docker compose -f docker/docker-compose.yml ps
```

## Knowledge Base

### Within Claude Code Session

```
# Incremental analysis
"ukb" or "update knowledge base"

# Full analysis
"full ukb" or "fully update knowledge base"
```

### Command Line

```bash
# Purge entities from date
node scripts/purge-knowledge-entities.js 2025-12-23

# Dry run
node scripts/purge-knowledge-entities.js 2025-12-23 --dry-run

# With options
node scripts/purge-knowledge-entities.js 2025-12-23 --team=coding --verbose
```

## LSL Recovery

```bash
# Recover LSL files from transcripts
PROJECT_PATH=/path/to/project CODING_REPO=/path/to/coding \
  node scripts/batch-lsl-processor.js from-transcripts ~/.claude/projects/-path-to-project

# Recover specific date range
PROJECT_PATH=/path/to/project CODING_REPO=/path/to/coding \
  node scripts/batch-lsl-processor.js retroactive 2024-12-01 2024-12-03
```

## Git Submodules

```bash
# Update all submodules
git submodule update --remote

# Initialize missing submodules
git submodule update --init --recursive

# Update specific submodule
git submodule update --remote integrations/mcp-server-semantic-analysis
```

## Debugging

### Enable Debug Output

```bash
# LSL debugging
DEBUG_STATUS=1 TRANSCRIPT_DEBUG=true node scripts/enhanced-transcript-monitor.js

# Full debug mode
DEBUG_LSL=1 node scripts/generate-proper-lsl-from-transcripts.js --mode=foreign --verbose
```

### Process Management

```bash
# Find running monitors
ps aux | grep enhanced-transcript-monitor

# Kill monitors
pkill -f enhanced-transcript-monitor

# Restart monitoring
coding --restart-monitor
```
