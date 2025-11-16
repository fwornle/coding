# MCP Constraint Monitor Integration

**Component**: [mcp-constraint-monitor](../../integrations/mcp-constraint-monitor/)
**Type**: MCP Server + Dashboard + PreToolUse Hooks
**Purpose**: Real-time code quality enforcement

---

## What It Provides

Real-time constraint monitoring that intercepts Claude Code tool calls BEFORE execution to enforce code quality standards.

### Core Features

- **18 Active Constraints** across Security, Architecture, Code Quality, PlantUML, Documentation
- **Severity-Based Enforcement**: CRITICAL/ERROR blocks, WARNING/INFO allows with feedback
- **PreToolUse Hook Integration**: Blocks violations before code is written
- **Dashboard Monitoring**: Live violation feed (port 3030)
- **REST API**: Programmatic access (port 3031)
- **Testing Framework**: Automated and interactive testing

### Integration Architecture

```
Claude attempts tool call
         ↓
PreToolUse Hook intercepts
         ↓
Constraint Monitor evaluates (integrations/mcp-constraint-monitor)
         ↓
    Violation? → YES → Block + error message
         ↓
        NO → Allow tool call
```

---

## Integration with Coding

### How It Connects

**1. PreToolUse Hooks** (Real-time Enforcement)

Configured in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /path/to/coding/integrations/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js"
      }]
    }]
  }
}
```

**2. PostToolUse Hooks** (LSL Logging)

Captures violations for analysis:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /path/to/coding/scripts/tool-interaction-hook-wrapper.js"
      }]
    }]
  }
}
```

### Usage in Workflows

**Automatic Enforcement:**
Constraints are enforced automatically on every tool call. No explicit usage required.

**Dashboard Access:**
```bash
# Start dashboard (automatic with install)
cd integrations/mcp-constraint-monitor
npm run dashboard  # Opens http://localhost:3030
```

**API Access:**
```bash
# Get constraint status
curl http://localhost:3031/api/status

# Get violations
curl http://localhost:3031/api/violations
```

---

## 18 Active Constraints

### Security (2) - 100% Detection
- `no-hardcoded-secrets` (CRITICAL)
- `no-eval-usage` (CRITICAL)

### Architecture (3) - 100% Detection
- `no-parallel-files` (CRITICAL)
- `debug-not-speculate` (ERROR)
- `no-evolutionary-names` (ERROR)

### Code Quality (5) - 20% Detection
- `proper-error-handling` (ERROR) ✅
- `no-console-log` (WARNING)
- `no-var-declarations` (WARNING)
- `proper-function-naming` (INFO)
- `no-magic-numbers` (INFO)

### PlantUML (5) - 40% Detection
- `plantuml-standard-styling` (ERROR) ✅
- `plantuml-file-location` (WARNING)
- `plantuml-diagram-workflow` (INFO)
- `plantuml-readability-guidelines` (INFO)
- `image-reference-pattern` (INFO) ✅

### Documentation (3) - 0% Detection
- `documentation-filename-format` (INFO)
- `update-main-readme` (INFO)
- `constraint-testing` (INFO)

---

## Testing

**Automated Testing:**
```bash
cd integrations/mcp-constraint-monitor
node test-all-constraints-comprehensive.js
```

**Interactive Testing:**
Use prompts from `INTERACTIVE-TEST-PROMPTS.md` in live Claude Code sessions.

**Evidence Collection:**
```bash
node collect-test-results.js  # Extracts evidence from LSL files
```

---

## Full Documentation

For complete documentation, see:

**[integrations/mcp-constraint-monitor/README.md](https://github.com/fwornle/mcp-constraint-monitor/blob/main/README.md)**

Topics covered:
- Complete constraint definitions
- Configuration guide
- Dashboard usage
- API reference
- Testing framework
- Pattern improvement guide

---

## See Also

- [Constraint Monitoring System](../constraints/README.md)
- [System Overview](../system-overview.md#constraint-monitoring)
- [Integration Overview](README.md)
