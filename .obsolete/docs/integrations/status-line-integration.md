# Status Line Integration

The MCP Constraint Monitor integrates seamlessly with Claude Code's status line to provide real-time feedback about your coding environment health and constraint compliance.

## Real-Time Guardrails

**⚠️ Important**: The constraint monitor uses **pre-tool hook prevention** for real-time constraint enforcement. Violations are blocked before execution, not detected after.

**Hook Integration:**
- **PreToolUse**: Prevents tool execution that would violate constraints
- **UserPromptSubmit**: Checks user prompts for constraint violations
- **Real-time Status**: Updates status line based on hook activity and health monitoring

## Status Line Format

The constraint monitor appears as part of the comprehensive Claude Code status line:

```
[GCM✅] [C🟢] [🛡️ 85% 🔍EX] [🧠API✅]
```

The constraint monitor component is: `[🛡️ 85% 🔍EX]`

## Status Line Components

### 🛡️ Compliance Score

**Icon**: 🛡️ (Shield)
**Meaning**: Constraint monitoring and compliance protection

**Status Format**: `[🛡️ {percentage}% {trajectory}]`

**Status Indicators:**
- **🛡️85%** - Compliance percentage (0-100% scale)
- **🛡️⚠️** - Active violations detected (yellow)
- **🛡️❌** - Constraint monitor offline (red)

**Compliance Ranges:**
- **90%+** - Excellent compliance 🟢
- **70-89%** - Good compliance 🔵
- **50-69%** - Warning compliance 🟡
- **<50%** - Poor compliance 🔴

**Compliance Calculation Algorithm:**
- Starts at 100% (perfect compliance)
- Base penalty: 5% per unique constraint violated in 24h
- Volume penalty: 2% per excess violation beyond unique constraints
- Recent violations (1h) weighted more heavily
- Minimum score: 0%

### 🔍 Trajectory Status

**Purpose**: Shows current development activity pattern based on violation patterns

**Trajectory Detection Logic:**
- **🔍EX** (Exploring): No violations in last hour, some in last 6h
- **📈ON** (On Track): No violations in last 6 hours
- **📉OFF** (Off Track): More than 3 violations in last hour
- **⚙️IMP** (Implementing): Active development with managed violations
- **✅VER** (Verifying): Testing phase, few violations
- **🚫BLK** (Blocked): High violation rate indicating issues

**Note**: Trajectory information was removed from the main status line display to reduce clutter. Only the shield symbol and compliance percentage are shown.

### ⚠️ Violation Count

**Display**: Only shown when violations are present
**Format**: `[🛡️ {percentage}% ⚠️ {count}]`

**Violation States:**
- **No violations** - Clean percentage display: `[🛡️ 85% 🔍EX]`
- **With violations** - Warning display: `[🛡️ 72% ⚠️ 3]`
- **Critical violations** - Multiple violations: `[🛡️ 45% ⚠️ 8]`

## Example Status Lines

### All Systems Operational
```
[GCM✅] [C🟢] [🛡️ 92% 🔍EX] [🧠API✅]
```
- Configuration manager operational
- Core services healthy
- Excellent compliance (92%)
- Currently exploring/researching
- Semantic analysis API operational

### Warning State with Violations
```
[GCM✅] [C🟡] [🛡️ 68% ⚠️ 3] [🧠API⚠️]
```
- Configuration manager operational
- Some core services degraded
- Low compliance (68%) with 3 violations
- Semantic analysis API degraded

### Critical Issues
```
[GCM❌] [C🔴] [🛡️ ❌] [🧠API❌]
```
- Configuration manager offline
- Core services failed
- Constraint monitor offline
- Semantic analysis API offline

## Color Coding

The entire status line uses color coding:

- **🟢 Green**: All systems healthy, good compliance
- **🟡 Yellow**: Some degradation or warnings
- **🔴 Red**: Critical issues or poor compliance

## Health Monitoring

The status line includes comprehensive health monitoring indicators:

### System Health Status
- **🟢 Green Shield**: All systems operational, hooks active, API responsive
- **🟡 Yellow Shield**: Degraded performance, some warnings detected
- **🔴 Red Shield**: Critical issues, hooks offline, or API unresponsive

### Dashboard Integration
- **Click Action**: Status line is clickable - opens web dashboard at `http://localhost:3030`
- **Real-time Updates**: Status updates every 5 seconds with latest metrics
- **Health API**: Continuous monitoring of `/api/health` endpoint

### Performance Metrics
The status line reflects real-time performance:
- **Hook Response Time**: Sub-5ms constraint checking
- **API Latency**: Dashboard and MCP server response times
- **Memory Usage**: System resource utilization
- **Database Status**: SQLite, Qdrant, and Redis connectivity

## Integration Architecture

The constraint monitor integrates with Claude Code through a unified status line system:

### Main Status Line Configuration
`~/.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/q284340/Agentic/coding/scripts/combined-status-line-wrapper.js"
  }
}
```

### Constraint Monitor API Integration
The main status line calls the constraint monitor API:
- **Endpoint**: `http://localhost:3031/api/violations`
- **Method**: GET with project parameter
- **Response**: JSON with violation data and metadata
- **Timeout**: 2 seconds with graceful fallback

### Service Dependencies
- **MCP Constraint Monitor Service**: Must be running on port 3031
- **Constraint API**: Provides real-time violation data
- **Local Data Files**: Fallback when API unavailable

### Hook Configuration (Required for Real-Time)
`.claude/settings.local.json` - **Required for real-time constraint enforcement**:
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "node /path/to/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js"
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "node /path/to/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js"
      }]
    }]
  }
}
```

**⚠️ Important**: The status line integration is separate from hook configuration. Status monitoring works independently of real-time prevention hooks.

### Architecture Components
- **Status Line Display**: Visual feedback in Claude Code
- **Hook Prevention**: Real-time constraint enforcement
- **API Service**: Data provider for both systems
- **Dashboard**: Web interface for detailed monitoring

## Troubleshooting

**Constraint Component Shows [🛡️ ❌]:**
1. Check constraint monitor API: `curl http://localhost:3031/api/health`
2. Start constraint monitor service: `cd integrations/mcp-constraint-monitor && npm run api`
3. Verify port availability: `lsof -i :3031`
4. Check service logs: `cd integrations/mcp-constraint-monitor && npm run logs`

**Inaccurate Compliance Percentages:**
1. Review recent violations: `curl http://localhost:3031/api/violations?project=coding`
2. Check constraint configuration files
3. Verify time synchronization (violations are time-sensitive)
4. Clear cache and restart service

**Status Line Not Updating:**
1. Verify main status line configuration in `~/.claude/settings.json`
2. Test manually: `node scripts/combined-status-line-wrapper.js`
3. Check script permissions: `ls -la scripts/combined-status-line*`
4. Review Claude Code logs for errors

**Component Integration Issues:**
1. Ensure constraint monitor API is accessible from main status script
2. Check network connectivity and timeouts
3. Verify project detection (current directory context)
4. Test individual component: `curl http://localhost:3031/api/violations?project=coding`

## Customization

### Custom Icons

You can customize status line icons by modifying the configuration:

```yaml
# constraints.yaml
statusLine:
  icons:
    shield: "🛡️"
    exploring: "🔍"
    onTrack: "📈"
    violations: "⚠️"
  colors:
    excellent: "green"
    good: "cyan"
    warning: "yellow"
    critical: "red"
```

### Update Frequency

Control how often the status line updates:

```yaml
statusLine:
  updateInterval: 1000  # milliseconds
  realTimeUpdates: true
```

## Technical Implementation

### API Integration
The constraint monitor provides status data through RESTful APIs:

```javascript
// Called by main status line script
const response = await fetch('http://localhost:3031/api/violations?project=coding');
const data = await response.json();
```

### Data Processing
1. **Violation Analysis**: Recent violations are analyzed for patterns
2. **Compliance Calculation**: Percentage-based scoring algorithm
3. **Trajectory Detection**: Activity pattern recognition
4. **Status Formatting**: Integration with main status line format

### Performance Characteristics
- **API Response Time**: <200ms typical
- **Cache Duration**: 5 seconds for violation data
- **Update Frequency**: Every 5 seconds via Claude Code timer
- **Failover**: Graceful degradation to cached data

### Data Flow
```
Constraint Violations → JSON Storage → API Endpoint → Status Line → Claude Code Display
        ↓                    ↓             ↓              ↓              ↓
   Real-time Detection → File System → HTTP Response → Aggregation → Visual Feedback
```

---

*The constraint monitor integration provides real-time visual feedback about coding compliance as part of Claude Code's comprehensive development environment monitoring system.*