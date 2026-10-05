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
# Where a repo's transcripts live (T9): repo_history_dir
source "$_AGENT_COMMON_DIR/lib/history-dir.sh"

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

  # Into the repo's LOCAL exclude file, never its tracked .gitignore: that file
  # belongs to the project, and writing it meant every `coding` launch left an
  # uncommitted change in the user's repo (and, in coding itself, re-added a
  # line T3 had already moved to .git/info/exclude). Same mechanism as
  # lib/history/repo-link.mjs uses for .coding/. Not a git repo yet = nothing
  # can be committed, so nothing to ignore.
  local exclude_file
  exclude_file="$(git -C "$project_dir" rev-parse --git-path info/exclude 2>/dev/null)" || return 0
  [[ "$exclude_file" = /* ]] || exclude_file="$project_dir/$exclude_file"
  mkdir -p "$(dirname "$exclude_file")" 2>/dev/null || return 0
  [ -f "$exclude_file" ] || touch "$exclude_file"

  # Essential entries that coding services create in target projects.
  # Each must be an exact line match (grep -xF) to avoid substring false positives.
  local entries=(
    ".constraint-monitor.yaml"
    ".claude/settings.local.json"
    ".health/"
    ".logs/"
    "logs/"
    "*.log"
    ".specstory/validation-report.json"
    ".specstory/change-log.json"
    # Session transcripts and the learning checkout. repo-link.mjs adds these
    # too once the repo has a .coding/; listed here as well so a launch that
    # could not set one up (no gh, declined, not yet decided) still never lets
    # `git add -A` sweep verbatim chat logs into the outer repo.
    ".specstory/history"
    ".coding/"
  )

  local added=false
  for entry in "${entries[@]}"; do
    if ! grep -qxF -- "$entry" "$exclude_file" 2>/dev/null; then
      if [ "$added" = false ]; then
        echo "# coding: runtime files (auto-added by coding startup)" >> "$exclude_file"
        added=true
      fi
      echo "$entry" >> "$exclude_file"
    fi
  done

  if [ "$added" = true ]; then
    log "✅ Added coding runtime entries to $exclude_file"
  fi
}
export -f ensure_coding_runtime_ignored

# ==============================================================================
# PER-REPO LEARNING REPO
# ==============================================================================
# Ensure <project>/.coding/ — the project's private <project>-history checkout
# (history/ + kb/); an older .specstory/history is migrated into it. The whole flow
# lives in lib/history/repo-link.mjs (one implementation, also used by
# bin/init-history.sh); this is only its launcher entry point. The tools repo is
# no exception: its coding-history checkout is <coding>/.coding/ too.
#
# First launch in a repo asks for the remote (Enter = the derived default, a
# URL — an existing teammate repo is cloned and shared — or 'skip'). The answer
# is recorded in ~/.coding/repos.yaml and never asked again. Older layouts (a
# nested .specstory/history checkout, a plain .specstory/history dir, the
# .history-repo-skipped marker) are migrated on the way. Honors
# $LSL_HISTORY_AUTO (yes|no) and $LSL_HISTORY_REMOTE_TEMPLATE.
ensure_private_history_repo() {
  local project_dir="$1"

  local coding_repo="${CODING_REPO:-$(cd "$_AGENT_COMMON_DIR/.." && pwd)}"
  # Never fails the launch: the module reports and exits 0 on its own errors.
  node "$coding_repo/lib/history/repo-link.mjs" ensure "$project_dir" >/dev/null || \
    log "⚠️  per-repo learning repo setup did not complete for $project_dir"
}
export -f ensure_private_history_repo

# Pull the project's learning checkout (and the shared clones of teammates'
# repos) at session start — D3's "automatic pull". In the background: a slow or
# absent network must not hold up the agent, and nothing the session writes
# conflicts with it (transcripts are per session; kb JSON merges by entity id
# through lib/kb/merge-driver.mjs). Changes are merged into the live graph by
# obs-api's /api/kb/reload, which the sync CLI calls when the pull moved HEAD.
pull_learning_repo() {
  local project_dir="$1"
  local coding_repo="${CODING_REPO:-$(cd "$_AGENT_COMMON_DIR/.." && pwd)}"
  mkdir -p "$coding_repo/.logs" 2>/dev/null
  ( node "$coding_repo/lib/history/sync.mjs" pull --repo "$project_dir" \
      >> "$coding_repo/.logs/learning-sync.log" 2>&1 & ) 2>/dev/null
  return 0
}
export -f pull_learning_repo

# ==============================================================================
# SESSION REMINDER
# ==============================================================================
# Newest transcript in a history dir: last YYYY/MM tranche, last file by name.
_latest_history_file() {
  local dir="$1" month
  month=$(ls -d "$dir"/[0-9][0-9][0-9][0-9]/[0-9][0-9] 2>/dev/null | tail -1)
  [ -n "$month" ] || return 0
  ls -1 "$month" 2>/dev/null | grep -E '\.(md|jsonl)$' | tail -1 | sed "s|^|$month/|"
}

# Show latest session log for continuity
show_session_reminder() {
  local target_project_dir="$1"
  local coding_repo="$2"

  local latest_session=""
  local session_location=""

  # Newest transcript BY FILENAME (date-encoded; mtimes are rewritten by
  # checkouts), in the target project first, then the coding repo.
  local dir candidate
  for dir in "$(repo_history_dir "$target_project_dir")" "$(repo_history_dir "$coding_repo")"; do
    candidate=$(_latest_history_file "$dir")
    [ -n "$candidate" ] || continue
    if [ -z "$latest_session" ] || [[ "$(basename "$candidate")" > "$(basename "$latest_session")" ]]; then
      latest_session="$candidate"
      if [ "$dir" = "$(repo_history_dir "$target_project_dir")" ]; then
        session_location="target project"
      else
        session_location="coding repo"
      fi
    fi
  done

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

  # The history dir the ETM writes into (.coding/history, T9).
  mkdir -p "$(repo_history_dir "$project_dir")"

  # Phase 33: global-lsl-coordinator.js is gone (deleted in 33-07). The host-side
  # coordinator at :3034 owns lifecycle now; this function just spawns ETM directly.
  # ETM (enhanced-transcript-monitor.js, reduced to a reporter in 33-04) POSTs
  # lsl_heartbeat signals to the coordinator on every poll cycle.

  # ETM is spawned here directly, and the host coordinator (:3034,
  # ensureEtmForActiveProjects) re-spawns it within 30s if it dies. There is no
  # longer a launchd branch: com.coding.etm was retired because it made `coding`
  # the ONLY project with two independent spawners. That duplication produced a
  # steady churn of singleton defers, and on 2026-08-27 it hid a 183-iteration
  # respawn loop for 1h47m — the coordinator's children logged nowhere, and the
  # launchd instance (which owned the only log file) was not the one looping.
  # One spawner per project, one log per project.
  #
  # Resolve the physical path once: pkill and the spawn below must agree on the
  # exact argv string, and a symlinked project_dir would make them differ.
  local project_real
  project_real=$(cd "$project_dir" 2>/dev/null && pwd -P) || project_real="$project_dir"

  # Match on the project-path ARGUMENT, not basename. A basename match is both
  # too broad (the script path itself contains "coding", so basename=coding
  # killed every ETM on the box) and too loose (a project named "rec" matches
  # "rec", "recorder", …). Anchor on the exact argv the spawn below uses.
  pkill -f "enhanced-transcript-monitor\.js ${project_real}\$" 2>/dev/null || true

  # Log outside the project: dropping transcript-monitor.log into the user's
  # working tree is litter they never asked for. Same path the coordinator's
  # auto-spawner writes to, so a project has ONE log across both spawn paths.
  mkdir -p "$coding_repo/.logs"
  local etm_log="$coding_repo/.logs/etm-$(basename "$project_dir").log"

  cd "$project_dir"
  # CRITICAL: Pass project_dir as argument to prevent fallback to process.cwd().
  # Env mirrors what the coordinator's auto-spawner sets (health-coordinator.js
  # ensureEtmForActiveProjects) so both spawn paths produce identical ETMs.
  CODING_AGENT="${CODING_AGENT:-claude}" \
  CODING_REPO="$coding_repo" \
  CODING_TOOLS_PATH="$coding_repo" \
  TRANSCRIPT_SOURCE_PROJECT="$project_real" \
    nohup node "$coding_repo/scripts/enhanced-transcript-monitor.js" "$project_real" > "$etm_log" 2>&1 &
  local new_pid=$!

  sleep 1
  if kill -0 "$new_pid" 2>/dev/null; then
    log "Transcript monitoring started (PID: $new_pid)"
  else
    log "Error: Transcript monitoring failed to start"
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
# (Phase 33 plan 33-14): start_global_lsl_monitoring() function and call sites
# fully removed. The host-side health-coordinator at :3034
# (com.coding.health-coordinator launchd job) owns LSL signal collection —
# ETM POSTs lsl_heartbeat directly to /signals; the coordinator records
# last_seen in /health/state.lsl[<sid>]; the statusline reader (33-04) GETs
# /health/state. No standalone monitoring daemon needed.
# ==============================================================================

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

  # The repo's learning checkout <project>/.coding/ — asked on first launch,
  # silent once answered. Only a tier that learns has anything to keep there:
  # `lsl` is the root of the learning chain, so harness never asks. An unset
  # CODING_FEATURES (a caller that did not resolve features) keeps the old
  # behaviour.
  if [[ -z "${CODING_FEATURES+x}" || " $CODING_FEATURES " == *" lsl "* ]]; then
    ensure_private_history_repo "$target_project_dir"
    pull_learning_repo "$target_project_dir"
  fi

  # Start robust transcript monitoring for target project
  if mkdir -p "$(repo_history_dir "$target_project_dir")" 2>/dev/null; then
    start_transcript_monitoring "$target_project_dir" "$coding_repo"
  else
    log "Warning: Could not create the history directory for transcript monitoring"
  fi

  # Start the health monitor for global session monitoring
  start_statusline_health_monitor "$coding_repo"

  # Phase 33 (plan 33-14): start_global_lsl_monitoring removed. ETM POSTs
  # lsl_heartbeat directly to coordinator at :3034; no standalone daemon needed.

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
export -f ensure_data_directory_ignored
export -f ensure_private_history_repo
export -f show_session_reminder
export -f _latest_history_file repo_history_dir
export -f start_transcript_monitoring
export -f start_statusline_health_monitor
export -f ensure_claude_md_with_skill_instruction
export -f ensure_agent_instructions
export -f ensure_statusline_config
export -f initialize_unified_hooks
export -f detect_corporate_network
export -f test_proxy_connectivity
export -f ensure_proxydetox_up
export -f configure_proxy_if_needed
export -f detect_network_and_configure_proxy
export -f agent_common_init
