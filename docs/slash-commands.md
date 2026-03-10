# Custom Slash Commands

This document describes the custom slash commands available in the coding system. These commands are installed globally in `~/.claude/commands/` and work across all projects.

---

## 📚 /sl - Session Log Reader

**Purpose**: Read recent session logs for continuity across work sessions

### Usage

```bash
/sl           # Read the most recent session log
/sl 3         # Read the last 3 session logs
/sl 5         # Read the last 5 session logs
```

### What It Does

The `/sl` command provides intelligent session continuity with **context-aware behavior**:

#### In Non-Coding Projects (e.g., nano-degree, curriculum-alignment)
1. **Determines current project** from directory path
2. **Finds local session logs** in current project's `.specstory/history/`
3. **Finds redirected logs** in `coding/.specstory/history/*_from-<project>.md`
4. **Presents combined summary** of both local and redirected work

#### In Coding Project
1. **Confirms coding project** from directory path
2. **Finds local coding logs** (WITHOUT `_from-` postfix)
3. **Finds ALL redirected logs** from all projects (`*_from-*.md`)
4. **Presents comprehensive summary** showing:
   - Direct coding infrastructure work
   - Cross-project work from all projects
   - Holistic view of all development activities

### Session Log Locations

**Local Project Sessions**:
```
<project>/.specstory/history/2025-10-15_0600-0700_g9b30a.md
```

**Cross-Project Sessions (redirected to coding)**:
```
coding/.specstory/history/2025-10-15_0600-0700_g9b30a_from-curriculum-alignment.md
```

### Filename Format

- **Standard**: `YYYY-MM-DD_HHMM-HHMM_<userid-hash>.md`
- **Cross-project**: `YYYY-MM-DD_HHMM-HHMM_<userid-hash>_from-<project>.md`

### Context Determination

The command uses **context-aware logic** based on current project:

**In Non-Coding Projects:**
- Reads (n) local project logs + (n) redirected logs from coding
- Example: `/sl 2` in nano-degree reads:
  - 2 newest from `nano-degree/.specstory/history/*.md`
  - 2 newest from `coding/.specstory/history/*_from-nano-degree.md`

**In Coding Project:**
- Reads (n) local coding logs + (n) redirected logs from ALL projects
- Example: `/sl 2` in coding reads:
  - 2 newest from `coding/.specstory/history/*.md` (no `_from-` postfix)
  - 2 newest from `coding/.specstory/history/*_from-nano-degree.md`
  - 2 newest from `coding/.specstory/history/*_from-curriculum-alignment.md`
  - 2 newest from `coding/.specstory/history/*_from-*.md` (any other projects)

### Example Output

#### Example 1: `/sl` in Non-Coding Project (nano-degree)

```
📋 Session Log Summary (Last Session)
══════════════════════════════════════

📁 Project: nano-degree
⏰ Local Session: 2025-10-17 14:00-15:00
🔄 Redirected Session: 2025-10-17 15:00-16:00

Local Activities:
• Course content development
• Updated learning modules
• Fixed exercise code examples

Redirected Activities (from coding):
• Developed new LSL logging system
• Fixed post-session-logger syntax error
• Updated slash command documentation

💡 Combined Context: Course work + infrastructure improvements
```

#### Example 2: `/sl 2` in Coding Project

```
📋 Session Log Summary (Last 2 Sessions)
══════════════════════════════════════

📁 Project: coding (infrastructure)
⏰ Sessions: 2025-10-17 14:00-18:00

Coding Infrastructure Work:
• Centralized health monitoring system
• Updated MCP service configuration
• Fixed transcript monitor processes

Cross-Project Work:
nano-degree (2 sessions):
  • Course module refactoring
  • Exercise solution updates

curriculum-alignment (2 sessions):
  • Dashboard UI improvements
  • API endpoint fixes

💡 Holistic Context: Infrastructure + all project work
```

### When to Use `/sl`

- **Starting a new session** - Get context from previous work
- **After a break** - Remember what you were doing
- **Context switching** - Understand recent activities in a project
- **Cross-project work** - See how coding infrastructure work relates to projects

---

## 🔒 /lg - Live Guardrails

**Purpose**: Access constraint monitor dashboard and real-time compliance status

### Usage

```bash
/lg              # Show status and open dashboard (default)
/lg status       # Show detailed status only
/lg dashboard    # Open dashboard only
/lg violations   # Show recent violations
/lg help         # Show help information
```

### What It Does

The `/lg` command provides instant access to:

- **Compliance scoring** (0-10 scale)
- **Violation tracking** (real-time)
- **Trajectory indicators** (development patterns)
- **Risk assessment** (Low/Medium/High)

### Status Display

```bash
/lg status
```

Output:
```
🔒 Live Guardrails - System Status
═══════════════════════════════════════════════
📊 Current Status: 🔒 8.5 🔍EX 🧠 ✅

🎯 Detailed Metrics:
📊 Compliance: 8.5/10.0
✅ Status: No active violations
🔍 Activity: Exploring
🟢 Risk Level: Low

📈 Recent Activity:
• Last violation: 2 hours ago (no-console-log)
• Sessions monitored: 3/3 active
• Compliance trend: ↗️ Improving
```

### Dashboard Access

```bash
/lg dashboard
```

Opens web interface at `http://localhost:3001/dashboard` showing:

- **Real-time metrics**: Visual charts and graphs
- **Activity feed**: Live event logging
- **Constraint configuration**: Enable/disable rules
- **Historical analysis**: Compliance trends over time
- **Violation details**: Code snippets and fix suggestions

### Status Indicators

| Icon | Meaning |
|------|---------|
| 🔒 | Constraint Monitor active |
| 🔍 EX | Exploring (gathering information) |
| 📈 ON | On Track (productive trajectory) |
| ⚙️ IMP | Implementing (active code changes) |
| ✅ VER | Verifying (testing/validation) |
| 🚫 BLK | Blocked (constraint intervention) |
| 🧠 | Semantic Analysis active |
| ✅ | No violations detected |
| ⚠️ | Active violations present |

### Risk Levels

| Level | Icon | Score Range | Meaning |
|-------|------|-------------|---------|
| Low | 🟢 | 8.0 - 10.0 | Excellent compliance |
| Medium | 🟡 | 5.0 - 7.9 | Some violations |
| High | 🔴 | 0.0 - 4.9 | Critical issues |

### Violation Types

The Live Guardrails system monitors for:

**Critical Violations** (BLOCKING):
- Hardcoded secrets/API keys
- Dynamic code execution
- Parallel file creation (v2, enhanced, improved)
- Architectural violations

**Error Violations** (BLOCKING):
- Empty catch blocks
- Evolutionary naming patterns
- Missing error handling

**Warning Violations** (ALLOWED with feedback):
- Console.log usage
- Deprecated variable declarations
- Code style issues

### Integration with Status Line

The `/lg` command complements the status line display:

**Status Line**: `🔒 8.5 🔍EX 🧠 ✅`
- Quick visual indicator in every message
- Compact format

**`/lg` Command**: Detailed breakdown
- Full compliance metrics
- Violation history
- Trajectory analysis
- Risk assessment

### When to Use `/lg`

- **Before committing code** - Check compliance score
- **After constraint violations** - See detailed feedback
- **Periodic health checks** - Monitor code quality trends
- **Understanding trajectory** - See if you're on track
- **Reviewing violations** - Examine recent issues and fixes

---

## 🔄 Command Workflow Integration

### Session Start Workflow

```bash
# 1. Read previous session for context
/sl

# 2. Check current compliance status
/lg status

# 3. Begin work with context and quality awareness
```

### During Development

- **Status line** provides continuous monitoring: `🔒 8.5 🔍EX`
- **`/lg`** for detailed checks when needed
- **Constraint violations** block critical issues automatically

### Session End Workflow

```bash
# 1. Final compliance check
/lg status

# 2. Review any violations
/lg violations

# 3. Session logs automatically captured for next /sl
```

---

## 📍 Installation & Configuration

### Automatic Installation

Both commands are automatically installed when you run:

```bash
cd /Users/q284340/Agentic/coding
./install.sh
```

### Installation Location

Commands are installed in:
```
~/.claude/commands/sl.md
~/.claude/commands/lg.md
```

### Verification

Check if commands are available:
```bash
ls -la ~/.claude/commands/
```

You should see both `sl.md` and `lg.md` files.

### Global Availability

Once installed, commands work in:
- ✅ All coding projects
- ✅ Any Claude Code session
- ✅ All subdirectories
- ✅ Different terminal sessions

---

## 🔍 Troubleshooting

### `/sl` Not Finding Logs

**Issue**: Command reports no session logs found

**Solutions**:
1. Check if `.specstory/history/` directory exists
2. Verify session logs were created (LSL system running)
3. Check file permissions on .specstory directory

```bash
ls -la .specstory/history/
# Should show *.md files with recent timestamps
```

### `/lg` Dashboard Not Opening

**Issue**: Dashboard command fails or shows connection error

**Solutions**:
1. Verify constraint monitor is running:
   ```bash
   lsof -i :3001
   ```

2. Start the dashboard manually:
   ```bash
   cd /Users/q284340/Agentic/coding/integrations/mcp-constraint-monitor
   npm run dashboard
   ```

3. Check constraint monitor installation:
   ```bash
   ls -la /Users/q284340/Agentic/coding/integrations/mcp-constraint-monitor/
   ```

### Commands Not Available

**Issue**: Claude Code doesn't recognize `/sl` or `/lg`

**Solutions**:
1. Verify installation:
   ```bash
   ls -la ~/.claude/commands/
   ```

2. Re-run installer if needed:
   ```bash
   cd /Users/q284340/Agentic/coding
   ./install.sh
   ```

3. Restart Claude Code session

---

## 📚 Related Documentation

- **[Live Session Logging System](lsl/README.md)** - LSL architecture and configuration
- **[Constraint Monitoring System](constraint-monitoring-system.md)** - Detailed constraint enforcement docs
- **[Status Line System](health-system/README.md)** - Visual status indicators
- **[Getting Started Guide](getting-started.md)** - Installation and setup

---

*These commands are part of the unified coding semantic analysis & knowledge management system.*
