# Test-Coding.sh - Comprehensive System Test & Repair

## Overview

The `test-coding.sh` script provides comprehensive testing and automatic repair capabilities for the entire coding tools system. It can be run at any time to verify system health and fix issues.

## Usage

```bash
# Run from anywhere in the coding tools directory
./scripts/test-coding.sh

# Or with full path
/path/to/coding/scripts/test-coding.sh
```

## What It Tests

### Phase 1: Environment & Prerequisites
- ✅ Node.js, npm, Python3, jq, Git installations
- 🔧 Auto-installs missing dependencies via Homebrew/apt

### Phase 2: Core Installation  
- ✅ Installation files, git repository status
- ✅ Environment variables (CODING_TOOLS_PATH, CODING_REPO)
- ✅ PATH configuration
- 🔧 Auto-configures missing environment setup

### Phase 3: Knowledge Management Tools
- ✅ UKB/VKB command availability and functionality
- ✅ Memory visualizer installation and build status
- ✅ shared-memory.json integrity
- 🔧 Auto-repairs missing components

### Phase 4: AI Agent Detection
- ✅ Claude Code (claude-mcp) availability and configuration
- ✅ VSCode installation and extensions
- ✅ GitHub Copilot extension detection
- ✅ **VSCode KM Bridge extension** installation and status
- 🔧 Auto-installs VSCode KM Bridge if VSIX file exists

### Phase 5: MCP Servers & Integration
- ✅ MCP configuration files and processing
- ✅ Memory server and browserbase server status
- 🔧 Auto-installs and configures MCP servers

### Phase 6: Fallback Services (CoPilot Support)
- ✅ Fallback service file integrity
- ✅ Graphology dependency installation
- ✅ CoPilot HTTP server functionality
- 🔧 Auto-installs missing dependencies

### Phase 7: Conversation Logging
- ✅ Post-session logger functionality
- ✅ .specstory directory structure
- 🔧 Auto-creates missing directories

### Phase 8: Integration Testing
- ✅ End-to-end UKB functionality
- ✅ Git integration with shared-memory.json
- ✅ Knowledge base data integrity
- 🔧 Auto-repairs broken integrations

### Phase 9: Performance & Health
- ✅ Disk space usage analysis
- ✅ Permission checks and fixes
- ✅ Node modules health verification

### Phase 10: Final Status & Recommendations
- ✅ Agent availability summary
- ✅ Actionable next steps

## Output Features

### Verbose Colored Output
- 🔵 **[TEST]** - Test section headers
- 🔵 **[CHECK]** - Individual checks
- 🟢 **[PASS]** - Successful tests
- 🔴 **[FAIL]** - Failed tests  
- 🟡 **[REPAIR]** - Repair actions needed
- 🟢 **[FIXED]** - Successful repairs
- 🔵 **[INFO]** - Additional information
- 🟡 **[WARNING]** - Non-critical issues

### Summary Report
- Total tests passed/failed
- Number of repairs needed/completed  
- Success rate percentage
- Overall system status
- Quick start commands
- Specific next steps

## Exit Codes

- **0**: All tests passed
- **1**: Some tests failed (check output for details)

## Auto-Repair Capabilities

The script automatically fixes:
- Missing dependencies (Node.js, Python3, jq)
- Environment variable configuration
- PATH setup
- Missing directories (.specstory/history)
- File permissions (executable scripts)
- MCP configuration generation
- Knowledge base initialization
- Git integration setup
- VSCode extension installation (if VSIX exists)

## VSCode Extension Testing

For GitHub Copilot users, the script specifically:
1. **Detects VSCode installation**
2. **Checks for GitHub Copilot extensions**
3. **Verifies KM Bridge extension installation**
4. **Auto-installs KM Bridge** if VSIX file is available
5. **Provides installation instructions** if manual setup needed

## Example Output

```
============================================
 CODING TOOLS COMPREHENSIVE TEST & REPAIR
============================================

Test started at: Mon Jan 15 10:30:00 2024
Platform: Darwin

>>> PHASE 1: Environment & Prerequisites

[TEST] Checking system dependencies
  [CHECK] Node.js installation
  [PASS] Node.js found: v18.17.0
  
>>> PHASE 4: AI Agent Detection & Availability

[TEST] GitHub Copilot availability
  [CHECK] VSCode installation  
  [PASS] VSCode command found
  [CHECK] VSCode Knowledge Management Bridge extension
  [REPAIR] Installing VSCode Knowledge Management Bridge...
  [FIXED] VSCode KM Bridge extension installed

============================================
 TEST SUMMARY REPORT
============================================

Test Results:
  Tests Passed: 45
  Tests Failed: 2
  Repairs Needed: 3
  Repairs Completed: 3
  Success Rate: 96%

System Status:
  ⚠️  SYSTEM REPAIRED - RESTART SHELL

Available AI Agents:
✅ Claude Code (with MCP support)
✅ GitHub Copilot (with KM Bridge)
```

## When to Run

- **After initial installation** - Verify everything works
- **Before important work** - Ensure system is healthy
- **After system updates** - Check for broken components
- **When experiencing issues** - Auto-repair common problems
- **Regularly** - Maintain system health

## Integration with Documentation

Referenced in:
- [Installation Quick Start](../docs/installation/quick-start.md#verify-complete-installation)
- [Main README](../README.md#quick-start)
- [Documentation Index](../docs/README.md#common-commands)