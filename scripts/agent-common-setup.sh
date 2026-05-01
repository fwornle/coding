#!/bin/bash

# Agent-Agnostic Common Setup Functions
# Shared initialization logic for all coding agents (Claude, CoPilot, etc.)
#
# This script must be sourced by agent-specific launchers:
#   source "$(dirname $0)/agent-common-setup.sh"

set -e

# Helper function for logging
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Resolve this script's directory for sourcing sibling scripts
_AGENT_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source CN/proxy detection
source "$_AGENT_COMMON_DIR/detect-network.sh"

# ==============================================================================
# GITIGNORE VALIDATION
# ==============================================================================
# Ensure .specstory/history/logs/ is not ignored by gitignore
# This is critical for classification logs from both live logging and batch processing
ensure_specstory_logs_tracked() {
  local project_dir="$1"
  local gitignore_file="$project_dir/.gitignore"

  # Skip if no .gitignore exists
  if [ ! -f "$gitignore_file" ]; then
    return 0
  fi

  # Check if logs/ pattern exists and .specstory/history/logs/ is not exempted
  if grep -q "^logs/" "$gitignore_file" 2>/dev/null; then
    if ! grep -q "^\!\.specstory/history/logs/" "$gitignore_file" 2>/dev/null; then
      log "⚠️  .gitignore has 'logs/' pattern that will ignore .specstory/history/logs/classification/"
      log "🔧 Adding exception '!.specstory/history/logs/' to .gitignore..."

      # Insert the exception right after the logs/ line (cross-platform compatible)
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' '/^logs\//a\
!.specstory/history/logs/
' "$gitignore_file"
      else
        sed -i '/^logs\//a\
!.specstory/history/logs/
' "$gitignore_file"
      fi

      if [ $? -eq 0 ]; then
        log "✅ Added .specstory/history/logs/ exception to .gitignore"
      else
        log "❌ Failed to update .gitignore - please manually add: !.specstory/history/logs/"
      fi
    fi
  fi
}

# Ensure .data/ directory is ignored in gitignore
# This directory contains MCP Memory LevelDB files (volatile runtime data)
ensure_data_directory_ignored() {
  local project_dir="$1"
  local gitignore_file="$project_dir/.gitignore"

  # Create .gitignore if it doesn't exist
  if [ ! -f "$gitignore_file" ]; then
    touch "$gitignore_file"
  fi

  # Check if the granular .data/ patterns are already present
  if ! grep -q "^\.data/knowledge-graph/" "$gitignore_file" 2>/dev/null; then
    log "🔧 Adding .data/ patterns to .gitignore (ignore binary DB, track JSON exports)..."

    # Remove old blanket .data/ ignore if present
    if grep -q "^\.data/$" "$gitignore_file" 2>/dev/null; then
      # Use sed to remove the old pattern (cross-platform compatible)
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' '/^\.data\/$/d' "$gitignore_file"
      else
        sed -i '/^\.data\/$/d' "$gitignore_file"
      fi
      log "  Removed old blanket .data/ pattern"
    fi

    # Add granular .data/ patterns to gitignore
    echo "" >> "$gitignore_file"
    echo "# MCP Memory LevelDB (volatile runtime data)" >> "$gitignore_file"
    echo "# Ignore binary database files, but track JSON exports" >> "$gitignore_file"
    echo ".data/knowledge-graph/" >> "$gitignore_file"
    echo ".data/knowledge.db" >> "$gitignore_file"
    echo ".data/knowledge.db-shm" >> "$gitignore_file"
    echo ".data/knowledge.db-wal" >> "$gitignore_file"
    echo ".data/backups/" >> "$gitignore_file"
    echo "" >> "$gitignore_file"
    echo "# Track knowledge exports (git-reviewable JSON)" >> "$gitignore_file"
    echo "!.data/" >> "$gitignore_file"
    echo "!.data/knowledge-export/" >> "$gitignore_file"
    echo "!.data/knowledge-config.json" >> "$gitignore_file"

    log "✅ Added granular .data/ patterns to .gitignore"
  fi
}

# Ensure coding infrastructure runtime files are gitignored in target projects
# These are created by coding services and should never be committed
ensure_coding_runtime_ignored() {
  local project_dir="$1"
  local gitignore_file="$project_dir/.gitignore"

  # Create .gitignore if it doesn't exist
  if [ ! -f "$gitignore_file" ]; then
    touch "$gitignore_file"
  fi

  # Essential entries that coding services create in target projects.
  # Each must be an exact line match (grep -xF) to avoid substring false positives.
  local entries=(
    ".constraint-monitor.yaml"
    ".claude/settings.local.json"
    ".health/"
    ".logs/"
    "logs/"
    "*.log"
    ".specstory/trajectory/live-state.json"
    ".specstory/validation-report.json"
    ".specstory/change-log.json"
  )

  local added=false
  for entry in "${entries[@]}"; do
    # Use -xF for exact whole-line matching (prevents ".specstory/trajectory/..." matching ".specstory/")
    if ! grep -qxF -- "$entry" "$gitignore_file" 2>/dev/null; then
      if [ "$added" = false ]; then
        echo "" >> "$gitignore_file"
        echo "# Coding infrastructure runtime files (auto-added by coding startup)" >> "$gitignore_file"
        added=true
      fi
      echo "$entry" >> "$gitignore_file"
    fi
  done

  if [ "$added" = true ]; then
    log "✅ Added coding runtime entries to .gitignore"
  fi
}
export -f ensure_coding_runtime_ignored

# ==============================================================================
# SESSION REMINDER
# ==============================================================================
# Show latest session log for continuity
show_session_reminder() {
  local target_project_dir="$1"
  local coding_repo="$2"

  # Check target project directory first
  local target_specstory_dir="$target_project_dir/.specstory/history"
  local coding_specstory_dir="$coding_repo/.specstory/history"

  local latest_session=""
  local session_location=""

  # Look for recent sessions in target project
  if [ -d "$target_specstory_dir" ]; then
    latest_session=$(ls -t "$target_specstory_dir"/*.md 2>/dev/null | head -1)
    if [ -n "$latest_session" ]; then
      session_location="target project"
    fi
  fi

  # Also check coding repo for comparison
  if [ -d "$coding_specstory_dir" ]; then
    local coding_session=$(ls -t "$coding_specstory_dir"/*.md 2>/dev/null | head -1)
    if [ -n "$coding_session" ]; then
      # Compare timestamps if both exist
      if [ -n "$latest_session" ]; then
        if [ "$coding_session" -nt "$latest_session" ]; then
          latest_session="$coding_session"
          session_location="coding repo"
        fi
      else
        latest_session="$coding_session"
        session_location="coding repo"
      fi
    fi
  fi

  if [ -n "$latest_session" ] && [ -f "$latest_session" ]; then
    local session_file=$(basename "$latest_session")
    echo "📋 Latest session log: $session_file ($session_location)"
    echo "💡 Reminder: Ask the agent to read the session log for continuity"
    echo ""
  fi
}

# ==============================================================================
# TRANSCRIPT MONITORING (LSL)
# ==============================================================================
# Start Global LSL Coordinator for robust transcript monitoring
start_transcript_monitoring() {
  local project_dir="$1"
  local coding_repo="$2"

  log "Using Global LSL Coordinator for robust transcript monitoring: $(basename "$project_dir")"

  # Create .specstory directory if needed
  if [ ! -d "$project_dir/.specstory/history" ]; then
    mkdir -p "$project_dir/.specstory/history"
  fi

  # Ensure .specstory/history/logs/ is tracked in git
  ensure_specstory_logs_tracked "$project_dir"

  # Use global coordinator to ensure robust LSL
  if node "$coding_repo/scripts/global-lsl-coordinator.js" ensure "$project_dir" $$; then
    log "Global LSL Coordinator: LSL setup successful"
  else
    log "Warning: Global LSL Coordinator setup failed, falling back to direct monitor"

    # Fallback: direct monitor startup (backward compatibility)
    pkill -f "enhanced-transcript-monitor.js.*$(basename "$project_dir")" 2>/dev/null || true
    cd "$project_dir"
    # CRITICAL: Pass project_dir as argument to prevent fallback to process.cwd()
    CODING_AGENT="${CODING_AGENT:-claude}" nohup node "$coding_repo/scripts/enhanced-transcript-monitor.js" "$project_dir" > transcript-monitor.log 2>&1 &
    local new_pid=$!

    sleep 1
    if kill -0 "$new_pid" 2>/dev/null; then
      log "Fallback transcript monitoring started (PID: $new_pid)"
    else
      log "Error: Both coordinator and fallback transcript monitoring failed"
    fi
  fi
}

# ==============================================================================
# STATUSLINE HEALTH MONITOR
# ==============================================================================
# Start StatusLine Health Monitor daemon (global monitoring for all sessions)
# Uses mkdir-based locking (atomic on POSIX, works on macOS and Linux)
start_statusline_health_monitor() {
  local coding_repo="$1"
  local pidfile="$coding_repo/.pids/statusline-health-monitor.pid"
  local lockdir="$coding_repo/.pids/statusline-health-monitor.lock.d"

  # Ensure .pids directory exists
  mkdir -p "$coding_repo/.pids"

  # Use mkdir for atomic locking (works on macOS and Linux)
  # mkdir is atomic on POSIX systems - only one process can create the dir
  if ! mkdir "$lockdir" 2>/dev/null; then
    # Check if lock is stale (older than 60 seconds)
    if [ -d "$lockdir" ]; then
      local lock_age
      lock_age=$(find "$lockdir" -maxdepth 0 -mmin +1 2>/dev/null | wc -l)
      if [ "$lock_age" -gt 0 ]; then
        log "Removing stale lock directory"
        rm -rf "$lockdir"
        mkdir "$lockdir" 2>/dev/null || {
          log "StatusLine Health Monitor startup in progress by another process"
          return 0
        }
      else
        log "StatusLine Health Monitor startup in progress by another process"
        return 0
      fi
    fi
  fi

  # Ensure lock is cleaned up on exit
  trap "rm -rf '$lockdir' 2>/dev/null" EXIT

  # Check PID file first (faster than pgrep)
  if [ -f "$pidfile" ]; then
    local existing_pid
    existing_pid=$(cat "$pidfile" 2>/dev/null)
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
      # Verify it's actually the health monitor (not a recycled PID)
      if ps -p "$existing_pid" -o args= 2>/dev/null | grep -q "statusline-health-monitor"; then
        log "StatusLine Health Monitor already running (PID: $existing_pid)"
        rm -rf "$lockdir" 2>/dev/null
        return 0
      fi
    fi
    # Stale PID file, remove it
    rm -f "$pidfile"
  fi

  # Double-check with pgrep (catches monitors started outside this function)
  if pgrep -f "statusline-health-monitor.js.*--daemon" >/dev/null 2>&1; then
    local running_pid
    running_pid=$(pgrep -f "statusline-health-monitor.js.*--daemon" | head -1)
    log "StatusLine Health Monitor already running (PID: $running_pid)"
    echo "$running_pid" > "$pidfile"
    rm -rf "$lockdir" 2>/dev/null
    return 0
  fi

  log "Starting StatusLine Health Monitor daemon..."

  # Start the health monitor daemon in background
  cd "$coding_repo"
  nohup node scripts/statusline-health-monitor.js --daemon --auto-heal > .logs/statusline-health-daemon.log 2>&1 &
  local health_monitor_pid=$!

  # Write PID file immediately
  echo "$health_monitor_pid" > "$pidfile"

  # Brief wait to check if it started successfully
  sleep 1
  if kill -0 "$health_monitor_pid" 2>/dev/null; then
    log "✅ StatusLine Health Monitor started (PID: $health_monitor_pid)"
  else
    log "⚠️ StatusLine Health Monitor may have failed to start"
    rm -f "$pidfile"
  fi

  # Release lock
  rm -rf "$lockdir" 2>/dev/null
}

# ==============================================================================
# BROWSER ACCESS SSE SERVER
# ==============================================================================
# Start the shared browser-access SSE server for parallel Claude sessions
start_browser_access_server() {
  local coding_repo="$1"
  local browser_access_dir="$coding_repo/integrations/browser-access"

  # Check if the SSE server is already running on port 3847
  if lsof -i :3847 -sTCP:LISTEN >/dev/null 2>&1; then
    log "Browser access SSE server already running"
    return 0
  fi

  # Check if the server script exists
  if [ ! -f "$browser_access_dir/browser-access-server" ]; then
    log "⚠️ Browser access server script not found"
    return 1
  fi

  log "Starting browser access SSE server..."

  # Start the server with required environment variables
  cd "$browser_access_dir"
  LOCAL_CDP_URL="${LOCAL_CDP_URL:-ws://localhost:9222}" \
    ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
    ./browser-access-server start >/dev/null 2>&1

  if lsof -i :3847 -sTCP:LISTEN >/dev/null 2>&1; then
    log "✅ Browser access SSE server started on port 3847"
  else
    log "⚠️ Browser access SSE server may have failed to start"
  fi
}

# ==============================================================================
# GLOBAL LSL MONITORING
# ==============================================================================
# Start Global LSL Coordinator monitoring daemon for auto-recovery
start_global_lsl_monitoring() {
  local coding_repo="$1"

  # Check if Global LSL Coordinator monitoring is already running
  if pgrep -f "global-lsl-coordinator.js monitor" >/dev/null 2>&1; then
    log "Global LSL Coordinator monitoring already running"
    return 0
  fi

  log "Starting Global LSL Coordinator monitoring daemon for auto-recovery..."

  # Start the coordinator monitoring daemon in background
  cd "$coding_repo"
  nohup node scripts/global-lsl-coordinator.js monitor > .logs/global-lsl-coordinator-monitor.log 2>&1 &
  local coordinator_pid=$!

  # Brief wait to check if it started successfully
  sleep 1
  if kill -0 "$coordinator_pid" 2>/dev/null; then
    log "✅ Global LSL Coordinator monitoring started (PID: $coordinator_pid)"
  else
    log "⚠️ Global LSL Coordinator monitoring may have failed to start"
  fi
}

# ==============================================================================
# CLAUDE.md SETUP
# ==============================================================================
# Ensure CLAUDE.md exists with mandatory documentation-style skill instruction
# This ensures all projects have the critical rules, especially new projects
ensure_claude_md_with_skill_instruction() {
  local target_project="$1"
  local coding_repo="$2"
  local claude_md="$target_project/CLAUDE.md"

  # Skip if we're in the coding repo itself (already managed)
  if [ "$target_project" = "$coding_repo" ]; then
    return 0
  fi

  # Template for minimal CLAUDE.md if file doesn't exist
  local minimal_claude_md='# CLAUDE.md - Project Development Guidelines

## 🚨🚨🚨 CRITICAL GLOBAL RULE: NO PARALLEL VERSIONS EVER 🚨🚨🚨

**This rule applies to ALL projects and must NEVER be violated.**

### ❌ NEVER CREATE FILES OR FUNCTIONS WITH EVOLUTIONARY NAMES:

- `v2`, `v3`, `v4`, `v5` (version suffixes)
- `enhanced`, `improved`, `better`, `new`, `advanced`, `pro`
- `simplified`, `simple`, `basic`, `lite`
- `fixed`, `patched`, `updated`, `revised`, `modified`
- `temp`, `temporary`, `backup`, `copy`, `duplicate`, `clone`
- `alt`, `alternative`, `variant`
- `final`, `draft`, `test`, `experimental`

### ✅ ALWAYS DO THIS INSTEAD:

1. **Edit the original file directly**
2. **Debug and trace to find the root cause**
3. **Fix the underlying problem, not create workarounds**
4. **Refactor existing code rather than duplicating it**

---

## 🚨 CRITICAL: MANDATORY DOCUMENTATION-STYLE SKILL USAGE

**ABSOLUTE RULE**: When working with PlantUML, Mermaid, or any documentation diagrams, you MUST invoke the `documentation-style` skill FIRST.

### When to Use

ALWAYS invoke the `documentation-style` skill when:

- Creating or modifying PlantUML (.puml) files
- Generating PNG files from PlantUML diagrams
- Working with Mermaid diagrams
- Creating or updating any documentation artifacts
- User mentions: diagrams, PlantUML, PUML, PNG, visualization, architecture diagrams

### How to Invoke

Before any diagram work, execute:

```text
Use Skill tool with command: "documentation-style"
```

### Why This Matters

- Enforces strict naming conventions (lowercase + hyphens only)
- Prevents incremental naming violations (no v2, v3, etc.)
- Ensures proper PlantUML validation workflow
- Applies correct style sheets automatically
- Prevents ASCII/line art in documentation

**ENFORCEMENT**: Any diagram work without first invoking this skill is a CRITICAL ERROR.

---

## 🚨 GLOBAL: MANDATORY VERIFICATION RULE

**CRITICAL**: NEVER CLAIM SUCCESS OR COMPLETION WITHOUT VERIFICATION

**ABSOLUTE RULE**: Before stating ANY result, completion, or success:

1. **ALWAYS run verification commands** to check the actual state
2. **ALWAYS show proof** with actual command output
3. **NEVER assume or guess** - only report what you can verify
4. **If verification shows failure**, report the failure accurately

**WHY THIS MATTERS**: False success claims waste time and break user trust. ALWAYS verify before reporting.
'

  # Check if CLAUDE.md exists
  if [ ! -f "$claude_md" ]; then
    log "📝 Creating CLAUDE.md with mandatory skill instructions..."
    echo "$minimal_claude_md" > "$claude_md"
    log "✅ Created CLAUDE.md with documentation-style skill instruction"
  else
    # Check if the file has the documentation-style skill section
    if ! grep -q "MANDATORY DOCUMENTATION-STYLE SKILL USAGE" "$claude_md" 2>/dev/null; then
      log "⚠️  CLAUDE.md exists but missing documentation-style skill instruction"
      log "💡 Please manually add the skill instruction section from ~/.claude/CLAUDE.md"
      log "   or run: cat ~/.claude/CLAUDE.md >> $claude_md"
    fi
  fi
}

# ==============================================================================
# AGENT INSTRUCTION GENERATION
# ==============================================================================
# Generate agent-specific instruction files at launch time
# Copilot gets .github/copilot-instructions.md, OpenCode gets skill refs in CLAUDE.md
ensure_agent_instructions() {
  local target_project="$1"
  local coding_repo="$2"
  local generator="$coding_repo/scripts/generate-agent-instructions.sh"

  if [[ ! -x "$generator" ]]; then
    log "⚠️  generate-agent-instructions.sh not found, skipping"
    return 0
  fi

  CODING_REPO="$coding_repo" "$generator" "$target_project" "$coding_repo"
}

# ==============================================================================
# STATUSLINE CONFIG
# ==============================================================================
# Claude Code's native statusLine is owned by GSD (context window display).
# The coding project's combined-status-line.js is used for tmux only.
# This function ensures project settings.local.json does NOT override the
# global GSD statusline by removing any stale statusLine entries.
ensure_statusline_config() {
  local target_project="$1"
  local coding_repo="$2"
  local claude_dir="$target_project/.claude"
  local settings_file="$claude_dir/settings.local.json"

  # Remove any statusLine from project settings — GSD owns the Claude status line,
  # tmux owns the terminal status bar via combined-status-line.js
  if [ -f "$settings_file" ] && grep -q '"statusLine"' "$settings_file" 2>/dev/null; then
    if command -v jq >/dev/null 2>&1; then
      local temp_file=$(mktemp)
      jq 'del(.statusLine)' "$settings_file" > "$temp_file" && mv "$temp_file" "$settings_file"
      log "Removed statusLine from project settings (GSD owns Claude status line)"
    fi
  fi
}

# ==============================================================================
# UNIFIED HOOKS INITIALIZATION
# ==============================================================================
# Initialize the unified hook system for the current agent
initialize_unified_hooks() {
  local target_project_dir="$1"
  local coding_repo="$2"
  local agent_type="${CODING_AGENT:-claude}"

  # Set environment variables for the hook system
  export CODING_HOOKS_CONFIG="$coding_repo/config/hooks-config.json"
  export CODING_AGENT_ADAPTER_PATH="$coding_repo/lib/agent-api/adapters"
  export CODING_TRANSCRIPT_FORMAT="$agent_type"

  # Create user-level hooks directory if it doesn't exist
  local user_hooks_dir="$HOME/.coding-tools"
  if [ ! -d "$user_hooks_dir" ]; then
    mkdir -p "$user_hooks_dir"
    log "Created user hooks directory: $user_hooks_dir"
  fi

  # Create project-level hooks directory if it doesn't exist
  local project_hooks_dir="$target_project_dir/.coding"
  if [ ! -d "$project_hooks_dir" ]; then
    mkdir -p "$project_hooks_dir"
    log "Created project hooks directory: $project_hooks_dir"
  fi

  log "Unified hooks system initialized for agent: $agent_type"
}

# ==============================================================================
# MAIN INITIALIZATION
# ==============================================================================
# Main initialization function called by agent-specific launchers
agent_common_init() {
  local target_project_dir="$1"
  local coding_repo="$2"

  log "Initializing agent-common setup..."
  log "Target project: $target_project_dir"
  log "Coding services from: $coding_repo"

  # Detect corporate network and configure proxy if needed
  detect_network_and_configure_proxy

  # Initialize the unified hooks system
  initialize_unified_hooks "$target_project_dir" "$coding_repo"

  # Ensure .data/ directory is ignored (MCP Memory LevelDB runtime data)
  ensure_data_directory_ignored "$target_project_dir"
  ensure_coding_runtime_ignored "$target_project_dir"

  # Start robust transcript monitoring for target project
  if [ -d "$target_project_dir/.specstory" ] || mkdir -p "$target_project_dir/.specstory/history" 2>/dev/null; then
    start_transcript_monitoring "$target_project_dir" "$coding_repo"
  else
    log "Warning: Could not create .specstory directory for transcript monitoring"
  fi

  # Start the health monitor for global session monitoring
  start_statusline_health_monitor "$coding_repo"

  # Start the Global LSL Coordinator monitoring for auto-recovery
  start_global_lsl_monitoring "$coding_repo"

  # Start the browser access SSE server for parallel sessions
  start_browser_access_server "$coding_repo"

  # Ensure CLAUDE.md exists with mandatory skill instructions (especially for new projects)
  ensure_claude_md_with_skill_instruction "$target_project_dir" "$coding_repo"

  # Generate agent-specific instruction files (Copilot, OpenCode)
  ensure_agent_instructions "$target_project_dir" "$coding_repo"

  # Ensure statusLine config is present (Claude-specific but harmless for others)
  ensure_statusline_config "$target_project_dir" "$coding_repo"

  # Show session summary for continuity
  show_session_reminder "$target_project_dir" "$coding_repo"

  log "Agent-common setup complete"
}

# Export functions for use in agent-specific launchers
export -f log
export -f ensure_specstory_logs_tracked
export -f ensure_data_directory_ignored
export -f show_session_reminder
export -f start_transcript_monitoring
export -f start_statusline_health_monitor
export -f start_global_lsl_monitoring
export -f start_browser_access_server
export -f ensure_claude_md_with_skill_instruction
export -f ensure_agent_instructions
export -f ensure_statusline_config
export -f initialize_unified_hooks
export -f detect_corporate_network
export -f test_proxy_connectivity
export -f configure_proxy_if_needed
export -f detect_network_and_configure_proxy
export -f agent_common_init
