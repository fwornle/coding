# Status Line Icons Reference

## Overview

The Claude Code status line displays real-time information about your coding environment using emoji icons and color coding. This reference explains what each icon means.

## Status Line Format

```
🛡️ 8.5 🔍EX 🧠 ✅
```

## Icon Reference

### 🛡️ Live Guardrails (Constraint Monitor)

**Icon**: 🛡️ (Shield)  
**Meaning**: Constraint monitoring and compliance protection

**Status Indicators:**
- **🛡️8.5** - Compliance score (0-10 scale)
- **🛡️⚠️** - Some violations detected (yellow)
- **🛡️❌** - Constraint monitor offline (red)

**Colors:**
- 🟢 Green: Excellent compliance (9.0+)
- 🔵 Cyan: Good compliance (7.0-8.9)
- 🟡 Yellow: Warning compliance (<7.0)
- 🔴 Red: Critical violations or offline

### 📊 Trajectory Status

**Purpose**: Shows your current development activity pattern

**Icons & Meanings:**
- **🔍 EX** - **Exploring**: Researching, understanding, analyzing
- **📈 ON** - **On Track**: Focused implementation work
- **📉 OFF** - **Off Track**: Diverged from planned work
- **⚙️ IMP** - **Implementing**: Active coding/building
- **✅ VER** - **Verifying**: Testing, validation, review
- **🚫 BLK** - **Blocked**: Stuck, waiting, dependencies

### 🧠 Semantic Analysis Engine

**Icon**: 🧠 (Brain)  
**Meaning**: AI-powered code analysis and insights

**Status Indicators:**
- **🧠✅** - Semantic analysis operational (green)
- **🧠⚠️** - Semantic analysis degraded (yellow)  
- **🧠❌** - Semantic analysis offline (red)

## Example Status Lines

### All Systems Operational
```
🛡️9.2 📈ON 🧠✅
```
- Excellent compliance (9.2/10)
- On track with focused work
- All systems operational

### Warning State
```
🛡️6.8 🔍EX 🧠⚠️
```
- Low compliance (6.8/10) needs attention
- Exploring/researching phase
- Semantic analysis degraded

### Critical Issues
```
🛡️❌ 🚫BLK 🧠❌
```
- Constraint monitor offline
- Work is blocked
- Semantic analysis offline

## Color Coding

The entire status line is colored based on the worst status:

- **🟢 Green**: All systems healthy
- **🟡 Yellow**: Some degradation or warnings
- **🔴 Red**: Critical issues or systems offline

## Configuration

The status line is configured in:
- **Global**: `~/.claude/settings.json`
- **Project**: `.claude/settings.local.json`

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/combined-status-line.js"
  }
}
```

## Troubleshooting

**No Status Line**: Check if services are running with `./start-services.sh`

**Red Status**: 
1. Check Docker is running
2. Verify services with: `docker ps`
3. Restart services: `./start-services.sh`

**Yellow Status**: Check logs for warnings, may continue working normally

---

*This status line provides real-time feedback about your development environment health and coding compliance.*