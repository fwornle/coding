# Scripts Directory

This directory contains utility scripts for the Coding Knowledge Management System.

## Scripts

### Core System Scripts

- **`sync-shared-knowledge.sh`** - Prepares MCP memory sync operations
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

## Organization

Scripts are organized here to keep the repository root clean while maintaining easy access for the core system functionality.

### Main Scripts in Root
- `install.sh` - Installation script
- `uninstall.sh` - Uninstallation script

### Command Wrappers in bin/
- `bin/claude-mcp` - Universal wrapper (added to PATH)
- `bin/ukb` - Universal wrapper (added to PATH)  
- `bin/vkb` - Universal wrapper (added to PATH)

### Component-Specific Scripts
- `browser-access/` - Browser automation scripts
- `knowledge-management/` - Knowledge management tools (ukb, vkb)