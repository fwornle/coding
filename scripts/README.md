# Scripts Directory

This directory contains utility scripts for the Coding Knowledge Management System.

## Scripts

### Agent Launcher Scripts

- **`launch-agent-common.sh`** - Shared agent orchestration (all agents)
  - Central `launch_agent()` function handling the full 18-step startup pipeline
  - Sources agent config, detects Docker mode, starts services, registers sessions
  - Calls agent hook functions (`agent_check_requirements`, `agent_pre_launch`, `agent_cleanup`)
  - Delegates to `tmux-session-wrapper.sh` for tmux wrapping at the final step
  - Usage: Sourced by agent-specific launchers or `launch-generic.sh`

- **`launch-claude.sh`** - Thin wrapper for Claude Code agent
  - Sources `agent-common-setup.sh` and `launch-agent-common.sh`
  - Delegates to `launch_agent()` with `config/agents/claude.sh`

- **`launch-copilot.sh`** - Thin wrapper for CoPilot agent
  - Sources `agent-common-setup.sh` and `launch-agent-common.sh`
  - Delegates to `launch_agent()` with `config/agents/copilot.sh`

- **`launch-generic.sh`** - Generic launcher for any config-driven agent
  - Fallback used by `bin/coding` when no agent-specific launcher exists
  - Takes agent config file path as first argument
  - Usage: `launch-generic.sh config/agents/<name>.sh [args...]`

- **`tmux-session-wrapper.sh`** - Shared tmux wrapper for all coding agents
  - Wraps any agent command in a tmux session with the coding status bar
  - Handles tmux nesting (configures current session if already inside tmux)
  - Propagates all required environment variables into the tmux session
  - Optional pipe-pane I/O capture for non-native agents (when `AGENT_ENABLE_PIPE_CAPTURE=true`)
  - Launches `capture-monitor.js` for prompt detection and hook firing
  - Usage: `source tmux-session-wrapper.sh && tmux_session_wrapper <command> [args...]`

- **`capture-monitor.js`** - I/O capture monitor for non-native agents
  - Polls tmux pipe-pane capture file at 200ms intervals
  - Detects user prompts via `AGENT_PROMPT_REGEX` environment variable
  - Fires hooks via `copilot-bridge.sh` (prompt submission, session events)
  - Logs session data as JSON lines for LSL integration
  - Started automatically by `tmux-session-wrapper.sh` when capture is enabled

### Core System Scripts

- **`sync-knowledge-base.sh`** - Prepares MCP memory sync operations
  - Called automatically by `claude-mcp` at startup
  - Creates sync trigger files for automatic knowledge base loading
  - Usage: Called internally by claude-mcp

### Utility Scripts  

- **`cleanup-aliases.sh`** - Removes old aliases from shell session
  - Used during installation to clean up conflicting aliases
  - Usage: `source scripts/cleanup-aliases.sh`

- **`normalize-specstory-filenames.sh`** - Normalizes .specstory log filenames
  - Converts spaces to hyphens in conversation log filenames
  - Usage: Run from knowledge-management directory

- **`start-auto-logger.sh`** - Automatic conversation logging via I/O interception
  - Called automatically by `claude-mcp` at startup
  - Intercepts stdin/stdout streams to capture conversations
  - Usage: Called internally by claude-mcp (not run directly)

- **`claude-mcp-launcher.sh`** - Main Claude MCP launcher with knowledge base integration
  - Loads shared-memory.json summary and activates MCP memory server
  - Starts automatic conversation logging via start-auto-logger.sh
  - Usage: Called by bin/claude-mcp wrapper (not run directly)

### Testing Scripts

- **`test-coding.sh`** - Comprehensive installation verification
  - **`--check-only`** (default): Reports issues without making changes
  - **`--interactive`**: Prompts before each repair action
  - **`--auto-repair`**: Fixes coding-internal issues automatically
  - Never auto-installs system packages - only suggests commands
  - Usage: `./scripts/test-coding.sh [--check-only|--interactive|--auto-repair]`

## Organization

Scripts are organized here to keep the repository root clean while maintaining easy access for the core system functionality.

### Main Scripts in Root
- `install.sh` - Safe installation with confirmation prompts
- `uninstall.sh` - Uninstallation with shell config restoration

### Agent Config Files in config/agents/
- `config/agents/claude.sh` - Claude Code agent definition
- `config/agents/copilot.sh` - GitHub CoPilot agent definition
- `config/agents/opencode.sh` - OpenCode agent definition (proof of concept)
- Adding a new agent requires only creating a config file here

### Command Wrappers in bin/
- `bin/coding` - Main entry point, routes to agent launchers via config
- `bin/claude-mcp` - Universal wrapper (added to PATH)
- `bin/ukb` - Universal wrapper (added to PATH)
- `bin/vkb` - Universal wrapper (added to PATH)

### Component-Specific Scripts
- `browser-access/` - Browser automation scripts
- `knowledge-management/` - Knowledge management tools