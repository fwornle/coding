# 🛡️ /lg - Live Guardrails Slash Command

## Overview

The `/lg` (Live Guardrails) slash command provides instant access to the constraint monitor dashboard and real-time compliance status from anywhere in Claude Code.

## Installation

The command is automatically installed in `~/.claude/commands/lg` and is available globally across all projects.

## Usage

### Basic Commands

```bash
/lg              # Show status and open dashboard (default)
/lg status       # Show detailed status only
/lg dashboard    # Open dashboard only  
/lg violations   # Show recent violations
/lg help         # Show help information
```

### Examples

#### Quick Status Check
```bash
/lg status
```
Output:
```
🛡️ Live Guardrails - System Status
═══════════════════════════════════════════════
📊 Current Status: 🛡️ 8.5 🔍EX 🧠 ✅

🎯 Detailed Metrics:
📊 Compliance: 8.5/10.0
✅ Status: No active violations
🔍 Activity: Exploring
🟢 Risk Level: Low
```

#### Open Dashboard
```bash
/lg dashboard
```
Opens the web dashboard at `http://localhost:3001/dashboard`

## Features

### Real-Time Monitoring
- **Compliance Score**: Live 0-10 scoring of code quality
- **Violation Tracking**: Instant detection of constraint violations
- **Trajectory Indicators**: Shows current development patterns
- **Risk Assessment**: Low/Medium/High risk levels

### Dashboard Capabilities
- **Visual Metrics**: Charts and graphs of compliance trends
- **Activity Feed**: Real-time event logging
- **Constraint Configuration**: Enable/disable specific rules
- **Historical Analysis**: Track improvements over time

### Status Line Integration
The `/lg` command works alongside the status line display:
- Status Line: `🛡️ 8.5 🔍EX 🧠 ✅`
- Use `/lg` for detailed information

## Status Indicators

| Icon | Meaning |
|------|---------|
| 🛡️ | Constraint Monitor active |
| 🔍 | Exploring trajectory |
| ⚠️ | Active violations |
| ✅ | No violations |
| 🧠 | Semantic Analysis |
| 🟢 | Low risk |
| 🟡 | Medium risk |
| 🔴 | High risk |

## Trajectory States

- **🔍EX** - Exploring: Trying new patterns
- **📈ON** - On Track: Following best practices
- **📉OFF** - Off Track: Deviating from standards
- **🚫BLK** - Blocked: Critical issues detected
- **⚙️IMP** - Implementing: Active development
- **✅VER** - Verifying: Testing phase

## Technical Details

### Location
- Global Command: `~/.claude/commands/lg`
- Dashboard Server: Port 3001
- Constraint Monitor: `integrations/mcp-constraint-monitor/`

### Dependencies
- Node.js for dashboard server
- MCP Constraint Monitor service
- Docker (for Qdrant and Redis)

### Architecture
```
/lg command
  ├── Status Check (combined-status-line.js)
  ├── Constraint Details (constraint-status-line.js)
  └── Dashboard Launch (dashboard server)
```

## Troubleshooting

### Dashboard Won't Open
```bash
# Check if server is running
ps aux | grep "dashboard-server"

# Manually start dashboard
cd /Users/q284340/Agentic/coding
./integrations/mcp-constraint-monitor/bin/dashboard
```

### No Status Data
```bash
# Verify services are running
cd /Users/q284340/Agentic/coding
./start-services.sh
```

### Permission Issues
```bash
# Ensure command is executable
chmod +x ~/.claude/commands/lg
```

## Integration with Other Commands

- **`./bin/status`** - Alternative status command
- **`./bin/dashboard`** - Direct dashboard launcher
- **`ukb`** - Update knowledge base
- **`vkb`** - View knowledge base

## Best Practices

1. **Regular Checks**: Use `/lg status` periodically to monitor compliance
2. **Fix Violations Quickly**: Address issues as they arise
3. **Review Dashboard Daily**: Check trends and patterns
4. **Customize Rules**: Adjust constraints for your project needs
5. **Track Progress**: Monitor compliance score improvements

## Available Globally

The `/lg` command is available in all projects, not just the coding repository. It automatically detects and connects to the constraint monitor service when available.

## Quick Reference Card

```
/lg              → Status + Dashboard
/lg status       → Detailed metrics
/lg dashboard    → Web interface
/lg violations   → Issue list
/lg help         → Command help

Status: 🛡️ 8.5 🔍EX 🧠 ✅
         │   │   │    └─ Services
         │   │   └────── Trajectory  
         │   └────────── Score
         └────────────── Shield
```