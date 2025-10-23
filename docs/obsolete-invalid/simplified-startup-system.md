# Simplified Startup System

## Overview

The coding agent system has been simplified to use a reliable, straightforward startup approach that replaces the previous complex lifecycle management system.

## Current Architecture

### Entry Points
- **`bin/coding`** - Main unified launcher for both Claude and CoPilot
- **`coding --claude`** - Launches Claude Code with MCP integration
- **`coding --copilot`** - Launches GitHub CoPilot with knowledge management

### Startup Flow
1. **Main Launcher** (`bin/coding`) determines which agent to use
2. **Agent Launcher** (`scripts/launch-claude.sh` or `scripts/launch-copilot.sh`) calls startup script
3. **Simple Startup** (`start-services.sh`) starts all required services
4. **Agent Launch** - Starts the appropriate coding agent

### Services Started
- **VKB Server** (port 8080) - Knowledge visualization server
- **MQTT Broker** (port 1883) - Message broker for agent communication
- **JSON-RPC Server** (port 8081) - Remote procedure calls
- **MCP Server** (port 8082) - Model Context Protocol server (when available)

## Key Files

### ✅ Currently Used
- `bin/coding` - Main launcher
- `scripts/launch-claude.sh` - Claude launcher
- `scripts/launch-copilot.sh` - CoPilot launcher
- `start-services.sh` - Simple startup script
- `scripts/claude-mcp-launcher.sh` - MCP integration
- `scripts/start-auto-logger.sh` - Auto-logging functionality

### ❌ Removed (Complex System)
- `lib/services/start-services.js` - Complex Node.js startup system
- `lib/services/lifecycle-manager.js` - Service lifecycle management
- `lib/services/port-manager.js` - Port management system
- `lib/services/health-monitor.js` - Health monitoring system
- `semantic-analysis-system/lib/startup/robust-startup.js` - Robust startup system
- `config/services.yaml` - Service configuration

## Benefits of Simplified System

### Reliability
- No complex dependency management
- No health monitoring failures
- No timeout issues
- No port conflict resolution complexity

### Speed
- Fast startup (5-10 seconds vs 30+ seconds)
- No elaborate validation processes
- No health check delays

### Maintainability
- Easy to understand and modify
- Clear, linear execution flow
- Shell script simplicity
- No complex Node.js orchestration

### Debugging
- Clear logs in simple files
- No complex error handling chains
- Easy to trace execution flow

## Usage

### Basic Usage
```bash
# Start with auto-detection
coding

# Force specific agent
coding --claude
coding --copilot

# Get help
coding --help
```

### Service Management
```bash
# Check running services
lsof -i :8080 -i :8081 -i :8082 -i :1883

# View logs
cat vkb-server.log
cat semantic-analysis-system/semantic-analysis.log

# Check service status
cat .services-running.json
```

### Manual Service Control
```bash
# Start services manually
./start-services.sh

# Kill services on specific ports
kill -9 $(lsof -t -i :8080)
kill -9 $(lsof -t -i :1883)
```

## Troubleshooting

### Common Issues
1. **Port conflicts** - Script automatically kills conflicting processes
2. **Service startup failures** - Check logs for specific errors
3. **MCP server not starting** - Often starts later, check logs

### Debug Steps
1. Check if ports are available: `lsof -i :8080 -i :8081 -i :8082 -i :1883`
2. View startup logs: `cat vkb-server.log` and `cat semantic-analysis-system/semantic-analysis.log`
3. Check service status: `cat .services-running.json`
4. Restart services: `./start-services.sh`

## Migration Notes

The system has been migrated from a complex, over-engineered startup system to a simple, reliable approach. The previous system had:
- Complex dependency management
- Health monitoring with frequent failures
- Lifecycle management with timeout issues
- Port conflict resolution that often failed

The new system:
- Uses simple shell scripts
- Kills conflicting processes directly
- Starts services with minimal validation
- Provides clear logs and status tracking

This change improves reliability, reduces complexity, and makes the system much easier to maintain and debug.