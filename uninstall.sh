#!/bin/bash
# Coding Tools System - Uninstall Script
# Removes installations but preserves data

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CODING_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${YELLOW}🗑️  Coding Tools System - Uninstaller${NC}"
echo -e "${YELLOW}=========================================${NC}"
echo ""
echo -e "${RED}⚠️  WARNING: This will remove installed components${NC}"
echo -e "${GREEN}✅ Your knowledge data (shared-memory*.json) will be preserved${NC}"
echo ""
read -p "Continue with uninstall? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

echo -e "\n${BLUE}🔧 Removing shell configuration...${NC}"
# Remove from common shell configs
for rc_file in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"; do
    if [[ -f "$rc_file" ]]; then
        # Remove old Claude Knowledge Management System entries
        sed -i '/# Claude Knowledge Management System/,+3d' "$rc_file" 2>/dev/null || true
        # Remove new Coding Tools entries
        sed -i '/# Coding Tools - Start/,/# Coding Tools - End/d' "$rc_file" 2>/dev/null || true
        # Remove any CODING_TOOLS_PATH or CODING_REPO entries
        sed -i '/CODING_TOOLS_PATH/d' "$rc_file" 2>/dev/null || true
        sed -i '/CODING_REPO/d' "$rc_file" 2>/dev/null || true
        # Remove team configuration
        sed -i '/# Coding Tools - Team Configuration/,+1d' "$rc_file" 2>/dev/null || true
        sed -i '/CODING_TEAM/d' "$rc_file" 2>/dev/null || true
        # Remove any PATH additions for coding tools
        sed -i '/knowledge-management.*coding/d' "$rc_file" 2>/dev/null || true
        echo "  Cleaned $rc_file"
    fi
done

echo -e "\n${BLUE}🗑️  Removing installed components...${NC}"
# Remove bin directory
if [[ -d "$CODING_REPO/bin" ]]; then
    rm -rf "$CODING_REPO/bin"
    echo "  Removed bin directory"
fi

# Remove memory-visualizer (if installed by us)
if [[ -d "$CODING_REPO/memory-visualizer" ]]; then
    rm -rf "$CODING_REPO/memory-visualizer"
    echo "  Removed memory-visualizer"
fi

# Remove mcp-server-browserbase (if installed by us)
if [[ -d "$CODING_REPO/integrations/mcp-server-browserbase" ]]; then
    rm -rf "$CODING_REPO/integrations/mcp-server-browserbase"
    echo "  Removed mcp-server-browserbase"
fi

# Remove semantic analysis MCP server (Node.js)
if [[ -d "$CODING_REPO/integrations/mcp-server-semantic-analysis" ]]; then
    echo "  Removing semantic analysis MCP server..."
    
    # Remove node_modules
    if [[ -d "$CODING_REPO/integrations/mcp-server-semantic-analysis/node_modules" ]]; then
        rm -rf "$CODING_REPO/integrations/mcp-server-semantic-analysis/node_modules"
        echo "    Removed Node.js dependencies"
    fi
    
    # Remove built dist directory
    if [[ -d "$CODING_REPO/integrations/mcp-server-semantic-analysis/dist" ]]; then
        rm -rf "$CODING_REPO/integrations/mcp-server-semantic-analysis/dist"
        echo "    Removed built TypeScript files"
    fi
    
    # Remove logs directory
    if [[ -d "$CODING_REPO/integrations/mcp-server-semantic-analysis/logs" ]]; then
        rm -rf "$CODING_REPO/integrations/mcp-server-semantic-analysis/logs"
        echo "    Removed semantic analysis logs"
    fi
    
    # Note: We preserve the source code since it might be a local development environment
    echo "  Semantic analysis MCP server cleaned (source code preserved)"
fi

# Remove Serena MCP server (Python uv)
if [[ -d "$CODING_REPO/integrations/serena" ]]; then
    echo "  Removing Serena MCP server..."
    
    # Remove .venv directory (uv virtual environment)
    if [[ -d "$CODING_REPO/integrations/serena/.venv" ]]; then
        rm -rf "$CODING_REPO/integrations/serena/.venv"
        echo "    Removed Python virtual environment"
    fi
    
    # Remove __pycache__ directories
    find "$CODING_REPO/integrations/serena" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    echo "    Removed Python cache files"
    
    # Remove .pyc files
    find "$CODING_REPO/integrations/serena" -name "*.pyc" -type f -exec rm -f {} + 2>/dev/null || true
    
    # Remove uv.lock file
    if [[ -f "$CODING_REPO/integrations/serena/uv.lock" ]]; then
        rm -f "$CODING_REPO/integrations/serena/uv.lock"
        echo "    Removed uv lock file"
    fi
    
    # Note: We preserve the source code since it might be a local development environment
    echo "  Serena MCP server cleaned (source code preserved)"
fi

# Clean up node_modules in MCP servers
for dir in "integrations/browser-access" "integrations/claude-logger-mcp" "integrations/mcp-server-semantic-analysis" "mcp-memory-server"; do
    if [[ -d "$CODING_REPO/$dir/node_modules" ]]; then
        rm -rf "$CODING_REPO/$dir/node_modules"
        echo "  Removed $dir/node_modules"
    fi
    if [[ -d "$CODING_REPO/$dir/dist" ]]; then
        rm -rf "$CODING_REPO/$dir/dist"
        echo "  Removed $dir/dist"
    fi
done

# Remove .coding-tools directory
if [[ -d "$HOME/.coding-tools" ]]; then
    rm -rf "$HOME/.coding-tools"
    echo "  Removed ~/.coding-tools"
fi

# Remove logs
rm -f "$CODING_REPO/install.log" 2>/dev/null || true
rm -f /tmp/ukb-*.log 2>/dev/null || true
rm -f /tmp/vkb-server.* 2>/dev/null || true

# Remove MCP configuration files
echo -e "\n${BLUE}🔧 Removing MCP configuration files...${NC}"
rm -f "$CODING_REPO/claude-code-mcp-processed.json" 2>/dev/null || true

# Remove user-level MCP configuration (optional - ask user)
echo ""
read -p "Remove user-level MCP configuration? This affects all projects using Claude Code. (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    USER_MCP_CONFIG="$HOME/.config/claude-code-mcp.json"
    if [[ -f "$USER_MCP_CONFIG" ]]; then
        rm -f "$USER_MCP_CONFIG"
        echo "  Removed user-level MCP configuration"
    fi

    # Remove from Claude app directory
    if [[ "$OSTYPE" == "darwin"* ]]; then
        CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        CLAUDE_CONFIG_DIR="$HOME/.config/Claude"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        CLAUDE_CONFIG_DIR="${APPDATA:-$HOME/AppData/Roaming}/Claude"
    fi

    if [[ -n "$CLAUDE_CONFIG_DIR" ]] && [[ -f "$CLAUDE_CONFIG_DIR/claude-code-mcp.json" ]]; then
        rm -f "$CLAUDE_CONFIG_DIR/claude-code-mcp.json"
        echo "  Removed Claude app MCP configuration"
    fi
else
    echo "  Keeping user-level MCP configuration"
fi

# Remove constraint monitor and LSL hooks
echo -e "\n${BLUE}🔗 Removing Hooks (Constraints + LSL)...${NC}"
SETTINGS_FILE="$HOME/.claude/settings.json"

if [[ ! -f "$SETTINGS_FILE" ]]; then
    echo "  No settings file found - hooks already removed"
else
    # Check if jq is available
    if ! command -v jq >/dev/null 2>&1; then
        echo -e "${YELLOW}  ⚠️  jq not found - cannot automatically remove hooks${NC}"
        echo "  Please manually edit: $SETTINGS_FILE"
        echo "  Remove PreToolUse hooks containing 'pre-tool-hook-wrapper.js'"
        echo "  Remove PostToolUse hooks containing 'tool-interaction-hook-wrapper.js'"
    else
        # Backup settings file
        BACKUP_FILE="${SETTINGS_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$SETTINGS_FILE" "$BACKUP_FILE"
        echo "  Backed up settings to: $BACKUP_FILE"

        # Remove both PreToolUse and PostToolUse hooks
        TEMP_FILE=$(mktemp)
        jq 'if .hooks.PreToolUse then
                .hooks.PreToolUse = [
                    .hooks.PreToolUse[] |
                    select(.hooks[]?.command | contains("pre-tool-hook-wrapper.js") | not)
                ]
            else . end |
            if .hooks.PreToolUse == [] then
                del(.hooks.PreToolUse)
            else . end |
            if .hooks.PostToolUse then
                .hooks.PostToolUse = [
                    .hooks.PostToolUse[] |
                    select(.hooks[]?.command | contains("tool-interaction-hook-wrapper.js") | not)
                ]
            else . end |
            if .hooks.PostToolUse == [] then
                del(.hooks.PostToolUse)
            else . end' "$SETTINGS_FILE" > "$TEMP_FILE"

        # Validate and apply
        if jq empty "$TEMP_FILE" 2>/dev/null; then
            mv "$TEMP_FILE" "$SETTINGS_FILE"
            echo "  ✅ Removed PreToolUse and PostToolUse hooks from settings"
        else
            rm -f "$TEMP_FILE"
            echo -e "${RED}  ❌ Failed to update settings - JSON validation failed${NC}"
            echo "  Original settings preserved in: $BACKUP_FILE"
        fi
    fi
fi

echo -e "\n${GREEN}✅ Uninstall completed!${NC}"
echo -e "${GREEN}📊 Your knowledge data has been preserved:${NC}"
echo "   $CODING_REPO/shared-memory.json (if exists)"

# List team-specific knowledge files
TEAM_FILES=$(find "$CODING_REPO" -name "shared-memory-*.json" 2>/dev/null || true)
if [[ -n "$TEAM_FILES" ]]; then
    echo -e "${GREEN}📊 Team-specific knowledge files preserved:${NC}"
    echo "$TEAM_FILES" | while read -r file; do
        [[ -n "$file" ]] && echo "   $(basename "$file")"
    done
fi

echo ""
echo "To reinstall, run: ./install.sh"
echo "Your team configuration will need to be set up again during installation."