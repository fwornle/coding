#!/bin/bash
# Claude Knowledge Management System - Uninstall Script
# Removes installations but preserves data

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CODING_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${YELLOW}🗑️  Claude Knowledge Management System - Uninstaller${NC}"
echo -e "${YELLOW}===================================================${NC}"
echo ""
echo -e "${RED}⚠️  WARNING: This will remove installed components${NC}"
echo -e "${GREEN}✅ Your knowledge data (shared-memory.json) will be preserved${NC}"
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
        sed -i '/# Claude Knowledge Management System/,+3d' "$rc_file" 2>/dev/null || true
        echo "  Cleaned $rc_file"
    fi
done

echo -e "\n${BLUE}🗑️  Removing installed components...${NC}"
# Remove bin directory
if [[ -d "$CLAUDE_REPO/bin" ]]; then
    rm -rf "$CLAUDE_REPO/bin"
    echo "  Removed bin directory"
fi

# Remove memory-visualizer (if installed by us)
if [[ -d "$CLAUDE_REPO/memory-visualizer" ]]; then
    rm -rf "$CLAUDE_REPO/memory-visualizer"
    echo "  Removed memory-visualizer"
fi

# Clean up node_modules in MCP servers
for dir in "browser-access" "claude-logger-mcp"; do
    if [[ -d "$CLAUDE_REPO/$dir/node_modules" ]]; then
        rm -rf "$CLAUDE_REPO/$dir/node_modules"
        echo "  Removed $dir/node_modules"
    fi
    if [[ -d "$CLAUDE_REPO/$dir/dist" ]]; then
        rm -rf "$CLAUDE_REPO/$dir/dist"
        echo "  Removed $dir/dist"
    fi
done

# Remove logs
rm -f "$CLAUDE_REPO/install.log" 2>/dev/null || true
rm -f /tmp/ukb-*.log 2>/dev/null || true
rm -f /tmp/vkb-server.* 2>/dev/null || true

echo -e "\n${GREEN}✅ Uninstall completed!${NC}"
echo -e "${GREEN}📊 Your knowledge data has been preserved in:${NC}"
echo "   $CLAUDE_REPO/shared-memory.json"
echo ""
echo "To reinstall, run: ./install.sh"