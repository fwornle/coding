# Constraints - Code Quality Enforcement

Real-time code quality enforcement through PreToolUse hooks.

![Constraint Monitor Components](../images/constraint-monitor-components.png)

## What It Does

- **PreToolUse Hook Enforcement** - Blocks violations BEFORE tool execution
- **20 Active Constraints** - Security, architecture, code quality, PlantUML, documentation
- **Severity-Based Enforcement** - CRITICAL/ERROR blocks, WARNING/INFO allows
- **Compliance Scoring** - Real-time 0-10 scoring
- **Dashboard Monitoring** - Live violation feed at `http://localhost:3030`

## How It Works

![Constraint Violation Handling](../images/constraint-violation-handling.png)

1. **PreToolUse Hook Fires** - Before tool execution
2. **Constraint Check** - Analyzes parameters against 20 constraints
3. **Pattern Matching** - Regex patterns detect violations
4. **Severity Evaluation** - Determines enforcement action
5. **Decision**:
   - CRITICAL/ERROR: **BLOCK** (exit code 1)
   - WARNING/INFO: **ALLOW** with feedback (exit code 0)

## Severity Levels

| Severity | Impact | Enforcement | Tool Call |
|----------|--------|-------------|-----------|
| CRITICAL | -3.0 | BLOCK | Prevented |
| ERROR | -2.0 | BLOCK | Prevented |
| WARNING | -1.0 | ALLOW | Proceeds with warning |
| INFO | -0.5 | ALLOW | Proceeds with info |

## Active Constraints

### Security (2) - 100% Detection

| Constraint | Severity |
|------------|----------|
| `no-hardcoded-secrets` | CRITICAL |
| `no-eval-usage` | CRITICAL |

### Architecture (3) - 100% Detection

| Constraint | Severity |
|------------|----------|
| `no-parallel-files` | CRITICAL |
| `debug-not-speculate` | ERROR |
| `no-evolutionary-names` | ERROR |

### Code Quality (7)

| Constraint | Severity |
|------------|----------|
| `proper-error-handling` | ERROR |
| `no-console-log` | WARNING |
| `no-console-error` | WARNING |
| `no-console-warn` | WARNING |
| `no-var-declarations` | WARNING |
| `proper-function-naming` | INFO |
| `no-magic-numbers` | INFO |

### PlantUML (5)

| Constraint | Severity |
|------------|----------|
| `plantuml-standard-styling` | ERROR |
| `plantuml-file-organization` | INFO |
| `plantuml-file-location` | WARNING |
| `plantuml-diagram-workflow` | INFO |
| `plantuml-readability-guidelines` | INFO |

## Dashboard

**URL**: `http://localhost:3030`

**Features**:

- Real-time violation feed
- Compliance score gauge (0-10)
- 7-day trend chart
- Project selector
- Constraint toggles

### API Endpoints (Port 3031)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/violations` | GET | List violations |
| `/api/violations` | POST | Log violation |
| `/api/compliance/:project` | GET | Project compliance score |
| `/api/constraints` | GET | List enabled constraints |
| `/api/health` | GET | Health check |

## Configuration

**File**: `integrations/mcp-constraint-monitor/constraints.yaml`

```yaml
- id: no-hardcoded-secrets
  group: security
  pattern: 'API_KEY|SECRET|TOKEN pattern here'
  message: 'CRITICAL: Potential hardcoded secret detected'
  severity: critical
  enabled: true
  suggestion: Use environment variables instead
```

### Enable/Disable

```yaml
- id: no-console-log
  enabled: false  # Disable this constraint
```

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/pre-tool-hook-wrapper.js` | PreToolUse hook entry |
| `src/enforcement/ConstraintEnforcer.js` | Enforcement engine |
| `constraints.yaml` | Constraint definitions |
| `src/dashboard/api/` | REST API |
| `src/dashboard/ui/` | Next.js dashboard |

## Status Line Integration

Format: `[SHIELD {compliance}% {trajectory}]`

Example: `[SHIELD 94% IMP]` shows 94% compliance and "implementing" state.
