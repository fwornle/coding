#!/bin/bash
# Claude MCP launcher - starts Claude with MCP config and loads shared knowledge

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the coding repo directory from environment or fallback to script location
if [[ -n "$CODING_REPO" ]]; then
    CODING_REPO_DIR="$CODING_REPO"
else
    # Fallback: assume script is in the repo root
    CODING_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# Export for Claude Code to know where the knowledge base is
export CODING_KNOWLEDGE_BASE="$CODING_REPO_DIR/.data/knowledge-graph"
export CODING_KNOWLEDGE_EXPORT="$CODING_REPO_DIR/.data/knowledge-export"
export CODING_TOOLS_PATH="$CODING_REPO_DIR"

# Path to the MCP config file
# Priority: 1) Docker mode if detected, 2) Environment variable, 3) Default local config
if [[ "$CODING_DOCKER_MODE" == "true" ]] && [[ -f "$CODING_REPO_DIR/claude-code-mcp-docker.json" ]]; then
    MCP_CONFIG="$CODING_REPO_DIR/claude-code-mcp-docker.json"
    echo -e "${BLUE}🐳 Using Docker MCP config${NC}"
elif [[ -n "$MCP_CONFIG" ]] && [[ -f "$MCP_CONFIG" ]]; then
    # MCP_CONFIG already set from environment (e.g., by launch-claude.sh)
    echo -e "${BLUE}Using MCP config from environment: $MCP_CONFIG${NC}"
else
    MCP_CONFIG="$CODING_REPO_DIR/claude-code-mcp-processed.json"
fi

# Check if the MCP config file exists
if [[ ! -f "$MCP_CONFIG" ]]; then
    echo "Error: MCP config file not found at $MCP_CONFIG"
    exit 1
fi

# Display minimal startup information
echo -e "${BLUE}🚀 Starting Claude Code with MCP Integration${NC}"

# Check if shared memory exists and show summary
if [[ -f "$SHARED_MEMORY" ]]; then
    entity_count=$(jq '.entities | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
    relation_count=$(jq '.relations | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
    echo -e "${GREEN}🧠 Knowledge Base: $entity_count entities, $relation_count relations${NC}"
    
    # Create startup reminder for Claude
    SYNC_DIR="$CODING_REPO_DIR/.mcp-sync"
    mkdir -p "$SYNC_DIR"
    cat > "$SYNC_DIR/startup-reminder.md" << 'STARTUP_EOF'
# 🚨 CLAUDE CODE STARTUP CHECKLIST 🚨

## MANDATORY FIRST STEPS:

1. **Query VKB for patterns:**
   ```
   vkb search "ConditionalLoggingPattern"
   vkb search "ReduxStateManagementPattern"
   vkb search "ClaudeCodeStartupPattern"
   ```

2. **Apply patterns immediately:**
   - ❌ NEVER use console.log 
   - ✅ ALWAYS use Logger class
   - ❌ NEVER use local React state
   - ✅ ALWAYS use Redux patterns

3. **Knowledge Management Rules:**
   - ❌ NEVER edit GraphDB files (.data/knowledge-graph/) directly
   - ✅ ALWAYS use: ukb --interactive or ukb --auto
   - ✅ Use vkb to visualize knowledge graph
   - ✅ ukb is in PATH and works from anywhere
   - 📊 Knowledge stored in GraphDB, exported to .data/knowledge-export/*.json

4. **Verify logging is working:**
   - Check if today's session is being logged
   - Ensure appropriate .specstory/history location

## ⚠️ FAILURE TO FOLLOW = ARCHITECTURAL MISTAKES ⚠️

STARTUP_EOF

fi

# Run knowledge sync preparation  
SYNC_SCRIPT="$CODING_REPO_DIR/scripts/sync-shared-knowledge.sh"
if [[ -x "$SYNC_SCRIPT" ]]; then
    "$SYNC_SCRIPT" > /dev/null 2>&1
fi

# Validate MCP services are ready before starting Claude
VALIDATION_SCRIPT="$CODING_REPO_DIR/scripts/validate-mcp-startup.sh"
if [[ -x "$VALIDATION_SCRIPT" ]]; then
    echo -e "${YELLOW}🔍 Validating MCP services...${NC}"
    if ! "$VALIDATION_SCRIPT"; then
        echo -e "${RED}❌ MCP services validation failed${NC}"
        echo -e "${YELLOW}💡 Try running: ./start-services.sh${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ MCP services validated successfully${NC}"
fi

# Set up post-session conversation logging
POST_SESSION_LOGGER="$CODING_REPO_DIR/scripts/post-session-logger.js"
FALLBACK_LOGGER="$CODING_REPO_DIR/scripts/post-session-logger.js"
if [[ -f "$POST_SESSION_LOGGER" ]]; then
    
    # Set up trap to trigger post-session logging on exit
    cleanup() {
        # Prevent multiple cleanup runs
        if [[ "$CLEANUP_RUNNING" == "true" ]]; then
            return 0
        fi
        export CLEANUP_RUNNING=true

        echo -e "${GREEN}✅ Session complete${NC}"

        # In Docker mode, containers persist across sessions - no cleanup needed
        # In native mode, PSM (Process State Manager) handles service cleanup via launch-claude.sh trap
        # LSL (Live Session Logging) handles transcript capture during the session

        # Check if LSL captured the session (look for recent .md files with correct naming pattern)
        local session_found=false
        for project_dir in "$(pwd)" "$CODING_REPO_DIR"; do
            if [[ -d "$project_dir/.specstory/history" ]]; then
                # LSL files are named: YYYY-MM-DD_HHMM-HHMM_<hash>.md
                local recent_files=$(find "$project_dir/.specstory/history" -name "*.md" -newermt '10 minutes ago' 2>/dev/null | head -1)
                if [[ -n "$recent_files" ]]; then
                    session_found=true
                    break
                fi
            fi
        done

        if [[ "$session_found" == "true" ]]; then
            echo -e "${GREEN}📄 Session logged by LSL${NC}"
        fi
    }
    # Register trap for multiple signals to ensure it runs
    trap cleanup EXIT INT TERM HUP
    
    # Launch Claude normally (without exec to preserve trap)
    # Run Claude directly with proper argument handling
    NODE_NO_WARNINGS=1 claude --mcp-config "$MCP_CONFIG" "$@"
    CLAUDE_EXIT_CODE=$?
    
    # Exit with Claude's exit code (this will trigger the trap)
    exit $CLAUDE_EXIT_CODE
else
    # Launch Claude without logging
    NODE_NO_WARNINGS=1 exec claude --mcp-config "$MCP_CONFIG" "$@"
fi