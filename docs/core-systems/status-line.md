# Status Line System Architecture

## Overview

The Claude Code status line system provides real-time monitoring of the development environment through a modular, service-oriented architecture. The system aggregates status information from multiple independent services and presents it as a unified, color-coded status display.

## Trajectory Integration

The status line system integrates with the real-time trajectory analysis system to display current development states. The trajectory states are read directly from `.specstory/trajectory/live-state.json`, which is maintained by the trajectory analysis system using AI-powered inference.

**Key Features**:
- **Real-time trajectory integration**: `getTrajectoryState()` method reads from trajectory system
- **Proper formatting**: Trajectory symbols with correct spacing (e.g., `🔍 EX`)
- **AI-powered analysis**: Uses Groq gpt-oss-20b model for trajectory classification
- **Live state reading**: Displays actual development trajectory states in real-time

**Integration Architecture Diagrams**:
- [Status Line Trajectory Integration](../images/status-line-trajectory-integration.png) - Current integration architecture
- [Real-Time Trajectory Analysis Flow](../images/real-time-trajectory-analysis-flow.png) - Complete system flow

## System Architecture

```
Claude Code → Wrapper → Main Script → Service APIs → Status Display
     ↓           ↓          ↓            ↓             ↓
  5s Timer → Env Setup → Aggregator → Data Sources → [GCM✅] [C🟢 CA🟢] [🛡️ 85% 🔍 EX] [🏥✅] [🧠API✅]
```

**Current Project Highlighting**: The status line automatically underlines the abbreviation of the current active project (determined by `TRANSCRIPT_SOURCE_PROJECT` or working directory) to provide visual context about which project you're currently working in.

### Component Layers

1. **Integration Layer**: Claude Code configuration and timer
2. **Execution Layer**: Wrapper script for environment setup
3. **Orchestration Layer**: Main aggregation script
4. **Service Layer**: Individual status providers
5. **Presentation Layer**: Formatted status output

## Core Components

### 1. Claude Code Integration

**File**: `~/.claude/settings.json`
**Purpose**: Configures Claude Code to execute status line command

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/q284340/Agentic/coding/scripts/combined-status-line-wrapper.js"
  }
}
```

**Behavior**:
- Executes status command every 5 seconds
- Displays output in Claude Code status bar
- Applies color coding based on overall status

### 2. Execution Wrapper

**File**: `scripts/combined-status-line-wrapper.js`
**Purpose**: Environment setup and script execution

**Responsibilities**:
- Sets `CODING_REPO` environment variable
- Establishes proper working directory context
- Executes main status aggregation script
- Handles execution errors gracefully

### 3. Main Status Aggregator

**File**: `scripts/combined-status-line.js`
**Purpose**: Central orchestration and status aggregation

**Key Methods**:
- `buildCombinedStatus()` - Main orchestration method
- `getGlobalConfigStatus()` - GCM status checking
- `getGlobalHealthStatus()` - Multi-project session health monitoring
- `getConstraintStatus()` - Constraint monitoring data
- `getSemanticStatus()` - AI/API status checking
- `getTrajectoryState()` - Real-time trajectory state from trajectory system
- `getProjectAbbreviation()` - Smart project name abbreviation generation

**Data Flow**:
1. Parallel status collection from all services
2. Individual component status determination
3. Overall health calculation
4. Color coding application
5. Formatted output generation

### 4. Service Providers

#### Global Configuration Manager (GCM)
**Purpose**: System-wide configuration and service discovery
**Checks**: Port availability, environment variables, service registry
**Output**: `[GCM✅]`, `[GCM⚠️]`, or `[GCM❌]`

#### Session Services (Multi-Project Display)
**Purpose**: Monitor health of all active project sessions
**Source**: Global health monitor reading from `.logs/statusline-health-status.txt`
**Output**: `[C🟢 CA🟢]`, `[C🟡(idle) ND🔴(old)]`, etc.

**Features**:
- **Multi-project monitoring**: Displays all projects with active sessions
- **Current project highlighting**: Underlines the current project's abbreviation using ANSI escape codes (`\u001b[4m...\u001b[24m`)
- **Smart abbreviations**: Automatically generates readable abbreviations (C=coding, CA=curriculum-alignment, ND=nano-degree)
- **Individual health icons**: Each project shows its own health status (🟢/🟡/🔴)
- **Status reasons**: Yellow/red statuses include brief reason codes in parentheses (e.g., `CA🟡(idle)`, `ND🔴(old)`)

**Current Project Detection**:
- Uses `TRANSCRIPT_SOURCE_PROJECT` environment variable
- Falls back to current working directory (`process.cwd()`)
- Compares project name against session entries to determine which to underline

**Health Status Reasons**:
When a project session shows yellow (🟡) or red (🔴) status, a short reason code is displayed:
- `idle` - Session exists but not actively streaming exchanges
- `stale` - Health data is slightly outdated (90s-2min old)
- `old` - Health data is too old (2min-6hrs)
- `err` - Error occurred while checking health
- `warn` - General warning state
- `down` - Unhealthy or failed state

**Example Outputs**:
- `[C🟢 CA🟢]` - Both projects healthy and streaming
- `[C🟢 CA🟡(idle)]` - C is active, CA session idle
- `[C🟡(stale) CA🔴(old)]` - C has stale data, CA has old data

#### Constraint Monitor (🛡️)
**File**: `integrations/mcp-constraint-monitor/src/status/constraint-status-line.js`
**API**: `http://localhost:3031/api/violations`
**Purpose**: Coding compliance and constraint violations
**Output**: `[🛡️ {percentage}% {trajectory}]`

**Trajectory State Integration**: Trajectory information is read in real-time from the trajectory analysis system via `.specstory/trajectory/live-state.json`, not from constraint monitor data.

**Compliance Calculation**:
- Starts at 100% (perfect compliance)
- Deducts points for constraint violations
- Base penalty: 5% per unique constraint violated
- Volume penalty: 2% per excess violation
- Range: 0-100%

**Trajectory States** (from Real-Time Trajectory Analysis System):
- `🔍 EX` (Exploring): Research and analysis phase
- `📈 ON` (On Track): Focused implementation
- `📉 OFF` (Off Track): Diverged from plan
- `⚙️ IMP` (Implementing): Active coding
- `✅ VER` (Verifying): Testing and validation
- `🚫 BLK` (Blocked): Stuck or waiting

**Trajectory State Source**: Real-time trajectory states are read from `.specstory/trajectory/live-state.json` which is maintained by the trajectory analysis system using AI-powered inference (Groq gpt-oss-20b model) to classify development activity patterns.

#### Real-Time Trajectory Analysis Integration
**File**: `.specstory/trajectory/live-state.json`
**Component**: `src/live-logging/RealTimeTrajectoryAnalyzer.js`
**Purpose**: AI-powered trajectory classification and session state tracking
**Integration**: Direct file-based reading via `getTrajectoryState()` method

**Trajectory State Management**:
- Real-time AI analysis classifies development activity patterns
- States updated via Groq `gpt-oss-20b` model inference
- State persistence in JSON format with timestamps and confidence scores
- Fallback to default state (🔍 EX) if file unavailable

**State Classification Process**:
1. **Exchange Analysis**: AI evaluates Claude Code conversation patterns
2. **State Inference**: Groq model classifies activity into trajectory states
3. **State Persistence**: Updates live-state.json with new state and metadata
4. **Status Integration**: Status line reads current state in real-time

**Example State File Structure**:
```json
{
  "currentState": "implementing",
  "lastUpdate": 1759590073127,
  "stateHistory": [
    {
      "timestamp": 1759590073126,
      "from": "exploring",
      "to": "implementing",
      "confidence": 0.8,
      "reasoning": "User is performing code modifications..."
    }
  ]
}
```

#### Semantic Analysis Engine (🧠)
**Purpose**: AI-powered code analysis and API health
**Checks**: API connectivity, response times, credit limits
**Output**: `[🧠API✅]`, `[🧠API⚠️]`, or `[🧠API❌]`

#### Health Verifier (🏥)
**File**: `scripts/health-verifier.js`
**API**: System Health Dashboard at `http://localhost:3032` (frontend) and `http://localhost:3033` (API)
**Purpose**: Automatic system health verification with auto-healing capabilities
**Output**: `[🏥✅]`, `[🏥⚠️{count}]`, `[🏥❌{count}]`, `[🏥🟡]`, `[🏥⏰]`, or `[🏥💤]`

**Health States**:
- `[🏥✅]` - All health checks passed (healthy system)
- `[🏥⚠️{count}]` - Warning-level violations detected (count shows number of issues)
- `[🏥❌{count}]` - Critical issues detected (count shows number of critical failures)
- `[🏥🟡]` - System degraded but no specific violations
- `[🏥⏰]` - Health data is stale (>5 minutes old)
- `[🏥💤]` - Health verifier offline or not running

**Monitoring Coverage**:
- **Databases**: LevelDB locks, Qdrant availability, graph integrity
- **Services**: VKB server, constraint monitor, dashboard server, health API (self-monitoring)
- **Processes**: Stale PIDs, zombie processes, resource usage

**Auto-Healing**: Automatically restarts failed services when violations are detected (see [Health Verification System](health-verification.md) for details)

## Status States and Transitions

### Health States

| State | Color | Criteria |
|-------|-------|----------|
| Healthy | Green (🟢) | All services operational, compliance >90% |
| Warning | Yellow (🟡) | Some degradation, compliance 50-89% |
| Critical | Red (🔴) | Service failures, compliance <50% |

### Service State Matrix

| Component | Operational | Degraded | Failed |
|-----------|------------|----------|--------|
| GCM | ✅ | ⚠️ | ❌ |
| Sessions | <u>C</u>🟢 CA🟢 | <u>C</u>🟡 CA🟢 | <u>C</u>🔴 CA🔴 |
| Constraint | 85% 🔍 EX | ⚠️ violations | ❌ offline |
| Health | 🏥✅ | 🏥⚠️2 | 🏥❌5 |
| Semantic | API✅ | API⚠️ | API❌ |

*Note: Underline indicates current active project*

## Data Collection

### Constraint Monitor Integration

The constraint monitor provides the most complex data through a dedicated integration:

**Service Architecture**:
- **MCP Server**: `integrations/mcp-constraint-monitor/`
- **API Endpoint**: `POST /api/violations`
- **Status Provider**: `src/status/constraint-status-line.js`
- **Dashboard**: Next.js React application with Redux

**Data Pipeline**:
1. **Violation Detection**: Real-time constraint checking
2. **Data Storage**: JSON files and in-memory cache
3. **API Serving**: RESTful endpoints for status queries
4. **Status Generation**: Compliance calculation and trajectory detection
5. **Integration**: Called by main status aggregator

### API Communication

**Request Pattern**:
```javascript
const response = await fetch('http://localhost:3031/api/violations?project=coding');
const data = await response.json();
```

**Response Format**:
```json
{
  "data": [
    {
      "constraint_id": "no-parallel-versions",
      "timestamp": "2025-01-04T09:45:00Z",
      "severity": "error",
      "resolved": false
    }
  ],
  "metadata": {
    "project": "coding",
    "timeframe": "24h"
  }
}
```

## Performance Characteristics

### Timing
- **Update Frequency**: 5 seconds (Claude Code timer)
- **Service Timeout**: 2 seconds per service
- **Cache Duration**: 5 seconds for constraint data
- **Total Response Time**: <500ms typical

### Caching Strategy
- **Constraint Data**: 5-second cache to reduce API load
- **Service Status**: Real-time checks (no caching)
- **Configuration**: Static data cached until restart

### Error Handling
- **Service Timeout**: Graceful degradation to cached data
- **API Failures**: Fall back to local data files
- **Network Issues**: Display offline status indicators
- **Partial Failures**: Continue with available services

## Configuration

### Environment Variables
- `CODING_REPO`: Project root directory path
- `CONSTRAINT_API_PORT`: Constraint monitor API port (default: 3031)
- `NODE_ENV`: Environment mode (development/production)

### Service Discovery
Services are discovered through:
1. Environment variables
2. Default port scanning
3. Configuration files
4. Docker container inspection

### Customization Options
- Update intervals per component
- Service endpoints and ports
- Display format and colors
- Timeout and retry settings

## Deployment

### Prerequisites
- Node.js runtime
- Docker (for core services)
- MCP Constraint Monitor service
- Proper file permissions

### Installation
1. Configure Claude Code settings
2. Start constraint monitor: `cd integrations/mcp-constraint-monitor && npm run api`
3. Verify script permissions: `chmod +x scripts/combined-status-line*`
4. Test manually: `node scripts/combined-status-line-wrapper.js`

### Monitoring
- Check status line display in Claude Code
- Monitor service logs for errors
- Verify API endpoint availability
- Test individual service responses

## Security Considerations

### API Access
- Local-only APIs (localhost binding)
- No external network access required
- Service authentication through local ports

### Data Privacy
- No sensitive data transmitted
- Local file system access only
- No external logging or tracking

### Process Security
- Scripts run with user permissions
- No elevated privileges required
- Sandboxed execution environment

## Troubleshooting

### Common Issues

**Status Line Not Appearing**
1. Check Claude Code configuration
2. Verify script file permissions
3. Test manual execution

**Slow Updates**
1. Check service response times
2. Verify network connectivity
3. Review timeout configurations

**Incorrect Data**
1. Check service API responses
2. Verify data file integrity
3. Clear cache and restart

### Diagnostic Commands

```bash
# Test status line manually
node scripts/combined-status-line-wrapper.js

# Check constraint monitor API
curl http://localhost:3031/api/health

# Verify service status
docker ps
lsof -i :3031

# Debug with verbose output
DEBUG=status-line node scripts/combined-status-line.js
```

## Future Enhancements

### Planned Features
- WebSocket real-time updates
- Historical status trending
- Custom alerting rules
- Performance metrics dashboard

### Extensibility
- Plugin architecture for new services
- Custom status providers
- Configurable display formats
- Integration with external monitoring

---

*This documentation provides complete technical details for understanding, maintaining, and extending the Claude Code status line system.*